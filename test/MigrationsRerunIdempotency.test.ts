/**
 * CO4 E1/C4 — migration re-run / idempotency suite on a FRESH database.
 *
 * Verifies the documented runner behavior (gap-tolerant readdir/filter/sort,
 * per-file transaction, name-tracked in schema_migrations) without changing
 * it: fresh full run, idempotent re-run, 002/003 gap tolerance,
 * partial-failure recovery, and tracking-row integrity.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import pathGuard from '../src/shared/PathGuard.js';

const EXPECTED_VERSIONS = [
  '001_initial_schema',
  '004_evolution_proposals',
  '005_recipe_source_refs',
  '006_lifecycle_transition_events',
  '007_evolution_type_simplification',
  '008_recipe_warnings',
  '009_knowledge_dimension_id',
  '010_source_graph',
  '011_guard_violations_attribution',
  '012_plans',
  '013_git_diff_checkpoints',
];

describe('Migrations re-run / idempotency (fresh DB)', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-migrations-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function appliedVersions(): string[] {
    return (
      connection
        .db!.prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: string }>
    ).map((row) => row.version);
  }

  test('fresh run applies every migration file and creates the core tables', async () => {
    await connection.runMigrations();

    expect(appliedVersions()).toEqual(EXPECTED_VERSIONS);

    const tables = (
      connection.db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    for (const table of [
      'knowledge_entries',
      'code_entities',
      'recipe_source_refs',
      'plans',
      'git_diff_checkpoints',
      'audit_logs',
    ]) {
      expect(tables).toContain(table);
    }
  });

  test('full re-run is idempotent: no re-application, no errors, data preserved', async () => {
    await connection.runMigrations();
    const firstRun = connection
      .db!.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version')
      .all();

    connection
      .db!.prepare(
        "INSERT INTO knowledge_entries (id, title, createdAt, updatedAt) VALUES ('mig-keep', 'Survives re-run', 1, 1)"
      )
      .run();

    await connection.runMigrations();

    const secondRun = connection
      .db!.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version')
      .all();
    // Identical rows incl. applied_at — nothing was re-applied.
    expect(secondRun).toEqual(firstRun);
    const kept = connection
      .db!.prepare("SELECT title FROM knowledge_entries WHERE id = 'mig-keep'")
      .get() as { title: string };
    expect(kept.title).toBe('Survives re-run');
  });

  test('gap tolerance: 002/003 gaps are not errors and order follows filename sort', async () => {
    await connection.runMigrations();
    const versions = appliedVersions();

    // Documented gaps: 002 never existed; 003 was deleted with the remote schema.
    expect(versions.some((version) => version.startsWith('002'))).toBe(false);
    expect(versions.some((version) => version.startsWith('003'))).toBe(false);
    // Runner applies in filename sort order despite the holes.
    expect(versions).toEqual([...versions].sort());
    expect(versions[0]).toBe('001_initial_schema');
    expect(versions[1]).toBe('004_evolution_proposals');
  });

  test('partial-failure recovery: lost tracking row + missing table heal on re-run', async () => {
    await connection.runMigrations();

    // Simulate a crash where 005 work was lost but later migrations survived:
    // its table is gone and schema_migrations has no row for it.
    connection.db!.exec('DROP TABLE recipe_source_refs');
    connection
      .db!.prepare("DELETE FROM schema_migrations WHERE version = '005_recipe_source_refs'")
      .run();
    expect(appliedVersions()).toHaveLength(EXPECTED_VERSIONS.length - 1);

    await connection.runMigrations();

    expect(appliedVersions()).toEqual(EXPECTED_VERSIONS);
    // The table is back and usable.
    const count = connection.db!.prepare('SELECT count(*) AS n FROM recipe_source_refs').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  test('tracking rows carry parseable applied_at timestamps and a unique version key', async () => {
    await connection.runMigrations();

    const rows = connection
      .db!.prepare('SELECT version, applied_at FROM schema_migrations')
      .all() as Array<{ version: string; applied_at: string }>;
    expect(rows).toHaveLength(EXPECTED_VERSIONS.length);
    for (const row of rows) {
      expect(Number.isNaN(Date.parse(row.applied_at))).toBe(false);
    }
    // version is the PRIMARY KEY: duplicate inserts must violate it.
    expect(() =>
      connection
        .db!.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ('001_initial_schema', 'x')"
        )
        .run()
    ).toThrow(/UNIQUE|PRIMARY/i);
  });

  test('a fresh second database reaches the identical schema (run-twice equivalence)', async () => {
    await connection.runMigrations();
    const schemaA = connection
      .db!.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all();

    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-migrations-b-'));
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDirB, knowledgeBaseDir: 'Alembic' });
    resetDrizzle();
    const connectionB = new DatabaseConnection({ path: '.asd/alembic.db' });
    try {
      await connectionB.connect();
      await connectionB.runMigrations();
      const schemaB = connectionB
        .db!.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
      expect(schemaB).toEqual(schemaA);
    } finally {
      connectionB.close();
      resetDrizzle();
      fs.rmSync(tmpDirB, { recursive: true, force: true });
    }
  });
});

/**
 * Train A — ViolationsStore writer attribution (misuse-harvest S2 finding).
 *
 * guard_violations rows previously had no record of which tool/surface
 * wrote them. Migration 011 adds nullable tool/surface columns; writers
 * that know their identity record it, unknown writers stay NULL.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { ViolationsStore } from '../src/service/guard/ViolationsStore.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('ViolationsStore writer attribution', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let store: ViolationsStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'train-a-violations-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    store = new ViolationsStore(null, connection.getDrizzle());
  });

  afterEach(() => {
    vi.useRealTimers();
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('migration 011 adds the tool/surface columns', () => {
    const columns = (
      connection.db!.prepare("PRAGMA table_info('guard_violations')").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    expect(columns).toContain('tool');
    expect(columns).toContain('surface');
  });

  test('attributed writes persist tool and surface on the row', () => {
    const id = store.appendRun({
      filePath: 'src/a.ts',
      violations: [{ ruleId: 'r1', severity: 'warning', line: 3 }],
      summary: 'guard review round 1: 0E 1W',
      tool: 'alembic_code_guard',
      surface: 'project-intelligence/guard-audit',
    });

    const row = connection
      .db!.prepare('SELECT tool, surface FROM guard_violations WHERE id = ?')
      .get(id) as { tool: string; surface: string };
    expect(row).toEqual({
      tool: 'alembic_code_guard',
      surface: 'project-intelligence/guard-audit',
    });
  });

  test('writers without identity record NULL attribution (no invented names)', () => {
    const id = store.appendRun({
      filePath: 'src/b.ts',
      violations: [{ ruleId: 'r2', severity: 'error', line: 9 }],
      summary: 'Guard file check: 1E 0W',
    });

    const row = connection
      .db!.prepare('SELECT tool, surface FROM guard_violations WHERE id = ?')
      .get(id) as { tool: string | null; surface: string | null };
    expect(row).toEqual({ tool: null, surface: null });
  });

  test('rule clear preserves other violations and original run attribution', async () => {
    const mixed = store.appendRun({
      filePath: 'src/a.ts',
      violations: [
        { ruleId: 'r1', line: 1 },
        { ruleId: 'r2', line: 2 },
      ],
      summary: 'Historical two-rule audit',
      tool: 'alembic_code_guard',
      surface: 'guard-audit',
    });
    store.appendRun({ filePath: 'src/b.ts', violations: [{ ruleId: 'r1' }] });
    const unrelated = store.appendRun({ filePath: 'src/c.ts', violations: [{ ruleId: 'r3' }] });
    const before = store.getRuns().find((run) => run.id === mixed)!;

    expect(await store.clear({ ruleId: 'r1' })).toBeUndefined();
    expect(store.getRuns().map((run) => run.id)).toEqual([mixed, unrelated]);
    expect(store.getRuns()[0]).toEqual({
      ...before,
      violations: [{ ruleId: 'r2', line: 2 }],
      violationCount: 1,
    });
    expect(
      connection.db!.prepare('SELECT tool, surface FROM guard_violations WHERE id = ?').get(mixed)
    ).toEqual({ tool: 'alembic_code_guard', surface: 'guard-audit' });
    expect(store.getStats().totalViolations).toBe(2);
  });

  test('file and rule filters intersect; unknown rule leaves all rows intact', async () => {
    store.appendRun({ filePath: 'src/a.ts', violations: [{ ruleId: 'r1' }, { ruleId: 'r2' }] });
    const otherFile = store.appendRun({ filePath: 'src/b.ts', violations: [{ ruleId: 'r1' }] });
    const original = store.getRuns();
    await store.clear({ ruleId: 'unknown' });
    expect(store.getRuns()).toEqual(original);
    await store.clear({ file: 'src/a.ts', ruleId: 'r1' });
    expect(store.getRunsByFile('src/a.ts')[0].violations).toEqual([{ ruleId: 'r2' }]);
    expect(store.getRunsByFile('src/b.ts')[0].id).toBe(otherFile);
    await store.clear({ file: 'src/a.ts' });
    expect(store.getRuns().map((run) => run.id)).toEqual([otherFile]);
    expect(await store.clearAll()).toBeUndefined();
    expect(store.getRuns()).toEqual([]);
  });

  test('same-second deduplication compares with the most recently inserted run', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_500);
    const first = store.appendRun({
      filePath: 'src/a.ts',
      violations: [{ ruleId: 'r1', line: 1 }],
    });
    const latest = store.appendRun({
      filePath: 'src/a.ts',
      violations: [{ ruleId: 'r2', line: 2 }],
    });
    expect(store.appendRun({ filePath: 'src/a.ts', violations: [{ ruleId: 'r2', line: 2 }] })).toBe(
      latest
    );
    expect(store.getRunsByFile('src/a.ts').map((run) => run.id)).toEqual([first, latest]);
  });

  test('selective clear rolls back all edits when a later DB update fails', async () => {
    for (const filePath of ['src/a.ts', 'src/b.ts']) {
      store.appendRun({ filePath, violations: [{ ruleId: 'r1' }, { ruleId: 'r2' }] });
    }
    const original = store.getRuns();
    connection.db!.exec(
      "CREATE TRIGGER reject_clear BEFORE UPDATE ON guard_violations WHEN OLD.file_path = 'src/b.ts' BEGIN SELECT RAISE(ABORT, 'injected clear failure'); END;"
    );
    await expect(store.clear({ ruleId: 'r1' })).rejects.toThrow('injected clear failure');
    expect(store.getRuns()).toEqual(original);
  });
});

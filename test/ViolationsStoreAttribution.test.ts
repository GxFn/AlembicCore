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
});

/**
 * CO4 E2 — repository/code floor suite (real SQLite, full migrations).
 *
 * Real-behavior tests for CodeEntityRepositoryImpl: upsert semantics on the
 * (entityId, entityType, projectRoot) composite key, batch operations,
 * ordered queries, JSON metadata round-trips, and project-scoped deletes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { CodeEntityRepositoryImpl } from '../src/repository/code/CodeEntityRepository.js';
import pathGuard from '../src/shared/PathGuard.js';

const PROJECT = '/proj/alpha';

describe('CodeEntityRepository floor', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let repo: CodeEntityRepositoryImpl;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-code-repo-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    repo = new CodeEntityRepositoryImpl(connection.getDrizzle());
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function entity(overrides: Record<string, unknown> = {}) {
    return {
      entityId: 'svc.UserService',
      entityType: 'class',
      projectRoot: PROJECT,
      name: 'UserService',
      filePath: 'src/services/UserService.ts',
      protocols: ['Resettable'],
      metadata: { nodeType: 'internal' },
      ...overrides,
    };
  }

  test('upsert creates then updates on the composite key without duplicating', async () => {
    const created = await repo.upsert(entity());
    expect(created.id).toBeGreaterThan(0);
    expect(created.protocols).toEqual(['Resettable']);

    const updated = await repo.upsert(entity({ name: 'UserServiceV2' }));
    expect(updated.name).toBe('UserServiceV2');
    expect(await repo.getEntityCount(PROJECT)).toBe(1);
  });

  test('same entityId in a different projectRoot is a separate row', async () => {
    await repo.upsert(entity());
    await repo.upsert(entity({ projectRoot: '/proj/beta' }));
    expect(await repo.getEntityCount(PROJECT)).toBe(1);
    expect(await repo.getEntityCount('/proj/beta')).toBe(1);
    expect(await repo.getEntityCount()).toBe(2);
  });

  test('batchUpsert returns the row count and an empty batch is a no-op', async () => {
    expect(await repo.batchUpsert([])).toBe(0);
    const count = await repo.batchUpsert([
      entity({ entityId: 'a.A', name: 'A' }),
      entity({ entityId: 'b.B', name: 'B' }),
    ]);
    expect(count).toBe(2);
    expect(await repo.getEntityCount(PROJECT)).toBe(2);
  });

  test('batchInsertIgnore skips existing composite keys instead of updating them', async () => {
    await repo.upsert(entity({ name: 'Original' }));
    // Return value counts processed entities (2), not actual inserts; the
    // contract that matters is the conflict-skip below.
    const processed = await repo.batchInsertIgnore([
      entity({ name: 'ShouldNotOverwrite' }),
      entity({ entityId: 'new.New', name: 'New' }),
    ]);
    expect(processed).toBe(2);
    const kept = await repo.findByEntityId('svc.UserService', 'class', PROJECT);
    expect(kept?.name).toBe('Original');
    expect(await repo.getEntityCount(PROJECT)).toBe(2);
  });

  test('listByType and searchByName return name-ascending ordered results', async () => {
    await repo.batchUpsert([
      entity({ entityId: 'c.Zeta', name: 'Zeta' }),
      entity({ entityId: 'a.Alpha', name: 'Alpha' }),
      entity({ entityId: 'b.Mid', name: 'Mid' }),
    ]);

    const byType = await repo.listByType('class', PROJECT);
    expect(byType.map((row) => row.name)).toEqual(['Alpha', 'Mid', 'Zeta']);

    const byName = await repo.searchByName('a', PROJECT);
    expect(byName.map((row) => row.name)).toEqual(['Alpha', 'Zeta']);
  });

  test('searchByName respects the entityType filter and the limit option', async () => {
    await repo.batchUpsert([
      entity({ entityId: 'f.fetchUser', entityType: 'function', name: 'fetchUser' }),
      entity({ entityId: 'c.UserService', name: 'UserService' }),
      entity({ entityId: 'c.UserStore', name: 'UserStore' }),
    ]);

    const functionsOnly = await repo.searchByName('user', PROJECT, { entityType: 'function' });
    expect(functionsOnly.map((row) => row.name)).toEqual(['fetchUser']);

    const limited = await repo.searchByName('user', PROJECT, { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  test('countByType groups counts per entityType', async () => {
    await repo.batchUpsert([
      entity({ entityId: 'a.A' }),
      entity({ entityId: 'b.B' }),
      entity({ entityId: 'f.f', entityType: 'function', name: 'f' }),
    ]);
    expect(await repo.countByType(PROJECT)).toEqual({ class: 2, function: 1 });
  });

  test('deleteByFile and clearProject report deleted row counts', async () => {
    await repo.batchUpsert([
      entity({ entityId: 'a.A', filePath: 'src/a.ts' }),
      entity({ entityId: 'a.B', filePath: 'src/a.ts' }),
      entity({ entityId: 'c.C', filePath: 'src/c.ts' }),
    ]);

    expect(await repo.deleteByFile('src/a.ts', PROJECT)).toBe(2);
    expect(await repo.findByFile('src/a.ts', PROJECT)).toEqual([]);
    expect(await repo.clearProject(PROJECT)).toBe(1);
    expect(await repo.getEntityCount(PROJECT)).toBe(0);
  });

  test('module queries filter by metadata nodeType via json_extract', async () => {
    await repo.batchUpsert([
      entity({
        entityId: 'm.Local',
        entityType: 'module',
        name: 'Local',
        metadata: { nodeType: 'internal' },
      }),
      entity({
        entityId: 'm.Ext',
        entityType: 'module',
        name: 'Ext',
        metadata: { nodeType: 'external' },
      }),
    ]);

    const locals = await repo.findLocalModules(PROJECT);
    expect(locals.map((row) => row.name)).toEqual(['Local']);

    const externals = await repo.findModulesByNodeTypes(PROJECT, ['external']);
    expect(externals.map((row) => row.name)).toEqual(['Ext']);
    expect(await repo.findModulesByNodeTypes(PROJECT, [])).toEqual([]);
    expect(await repo.countModulesByNodeType(PROJECT, 'external')).toBe(1);
  });

  test('metadata and protocols JSON round-trip through reads', async () => {
    await repo.upsert(
      entity({ protocols: ['A', 'B'], metadata: { nodeType: 'internal', depth: 3 } })
    );
    const found = await repo.findByEntityIdOnly('svc.UserService', PROJECT);
    expect(found?.protocols).toEqual(['A', 'B']);
    expect(found?.metadata).toEqual({ nodeType: 'internal', depth: 3 });
  });

  test('lookups for absent rows return null/empty rather than throwing', async () => {
    expect(await repo.findById(99_999)).toBeNull();
    expect(await repo.findByEntityId('nope', 'class', PROJECT)).toBeNull();
    expect(await repo.findByFile('src/none.ts', PROJECT)).toEqual([]);
    expect(repo.existsByName('Ghost')).toBe(false);
  });
});

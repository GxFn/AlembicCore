/**
 * CO4 E2 — repository/sync floor suite (real SQLite, full migrations).
 *
 * Real-behavior tests for RawDbSyncAdapter against the real schema:
 * upsert statement semantics (create-protected columns), existence checks,
 * orphan queries, deprecation writes, and the CO3 W1 typed-error contract
 * for audit-insert failures exercised repo-side.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { RawDbSyncAdapter } from '../src/repository/sync/SyncRepoAdapter.js';
import { PersistenceError } from '../src/shared/errors/index.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('SyncRepoAdapter floor', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let adapter: RawDbSyncAdapter;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-sync-repo-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    adapter = new RawDbSyncAdapter(connection.db! as never);
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const COLS = ['id', 'title', 'lifecycle', 'sourceFile', 'createdBy', 'createdAt', 'updatedAt'];

  function insertEntry(id: string, title: string, lifecycle = 'active', sourceFile = `${id}.md`) {
    adapter.createUpsertStmt(COLS).run(id, title, lifecycle, sourceFile, 'tester', 100, 100);
  }

  test('createUpsertStmt inserts a new row', () => {
    expect(adapter.entryExists('e1')).toBe(false);
    insertEntry('e1', 'First');
    expect(adapter.entryExists('e1')).toBe(true);
  });

  test('upsert on conflict updates data columns but protects id/createdBy/createdAt', () => {
    insertEntry('e1', 'Original');
    adapter.createUpsertStmt(COLS).run('e1', 'Renamed', 'active', 'e1.md', 'intruder', 999, 200);

    const row = connection
      .db!.prepare(
        'SELECT title, createdBy, createdAt, updatedAt FROM knowledge_entries WHERE id = ?'
      )
      .get('e1') as { title: string; createdBy: string; createdAt: number; updatedAt: number };
    expect(row.title).toBe('Renamed');
    // Create-protected columns keep their original values on conflict.
    expect(row.createdBy).toBe('tester');
    expect(row.createdAt).toBe(100);
    expect(row.updatedAt).toBe(200);
  });

  test('entryExists is false for unknown ids', () => {
    expect(adapter.entryExists('ghost')).toBe(false);
  });

  test('createAuditInsertStmt produces a working statement on the real schema', () => {
    const stmt = adapter.createAuditInsertStmt();
    expect(stmt).not.toBeNull();
    stmt!.run(
      'audit-1',
      100,
      'sync',
      '{"source":"test"}',
      'manual_knowledge_edit',
      'e1',
      '{}',
      'violation_detected',
      null,
      0
    );
    const row = connection
      .db!.prepare('SELECT actor, action FROM audit_logs WHERE id = ?')
      .get('audit-1') as { actor: string; action: string };
    expect(row).toEqual({ actor: 'sync', action: 'manual_knowledge_edit' });
  });

  test('W1 contract repo-side: missing audit_logs table → PersistenceError, not null', () => {
    connection.db!.exec('DROP TABLE audit_logs');

    let caught: unknown;
    try {
      adapter.createAuditInsertStmt();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).code).toBe('PERSISTENCE_ERROR');
    expect((caught as PersistenceError).details).toMatchObject({
      operation: 'audit-insert-prepare',
      table: 'audit_logs',
    });
  });

  test('findActiveEntriesWithSourceFile excludes deprecated rows and null sourceFile', () => {
    insertEntry('active-1', 'A');
    insertEntry('dep-1', 'D', 'deprecated');
    connection
      .db!.prepare(
        "INSERT INTO knowledge_entries (id, title, lifecycle, createdAt, updatedAt) VALUES ('nofile-1', 'N', 'active', 1, 1)"
      )
      .run();

    const rows = adapter.findActiveEntriesWithSourceFile();
    expect(rows).toEqual([{ id: 'active-1', sourceFile: 'active-1.md' }]);
  });

  test('deprecateEntry flips lifecycle and records reason + timestamp', () => {
    insertEntry('e1', 'ToDeprecate');
    adapter.deprecateEntry('e1', 'orphaned .md removed', 555);

    const row = connection
      .db!.prepare(
        'SELECT lifecycle, rejectionReason, updatedAt FROM knowledge_entries WHERE id = ?'
      )
      .get('e1') as { lifecycle: string; rejectionReason: string; updatedAt: number };
    expect(row).toEqual({
      lifecycle: 'deprecated',
      rejectionReason: 'orphaned .md removed',
      updatedAt: 555,
    });
    expect(adapter.findActiveEntriesWithSourceFile()).toEqual([]);
  });

  test('deprecateEntry on an unknown id changes nothing and does not throw', () => {
    insertEntry('e1', 'Stays');
    expect(() => adapter.deprecateEntry('ghost', 'reason', 1)).not.toThrow();
    const row = connection
      .db!.prepare('SELECT lifecycle FROM knowledge_entries WHERE id = ?')
      .get('e1') as { lifecycle: string };
    expect(row.lifecycle).toBe('active');
  });
});

/**
 * CO4 E2 — repository/sourceref floor suite (real SQLite, full migrations).
 *
 * Real-behavior tests for RecipeSourceRefRepositoryImpl: composite-key
 * upsert, status transitions, stale accounting, path replacement, the
 * FK cascade from knowledge_entries, and the missing-table read guard.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { RecipeSourceRefRepositoryImpl } from '../src/repository/sourceref/RecipeSourceRefRepository.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('RecipeSourceRefRepository floor', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let repo: RecipeSourceRefRepositoryImpl;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-sourceref-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    repo = new RecipeSourceRefRepositoryImpl(connection.getDrizzle());
    // recipe_source_refs.recipe_id has an FK to knowledge_entries(id).
    for (const id of ['r1', 'r2']) {
      connection
        .db!.prepare(
          'INSERT INTO knowledge_entries (id, title, createdAt, updatedAt) VALUES (?, ?, 1, 1)'
        )
        .run(id, `Recipe ${id}`);
    }
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('upsert inserts then updates the (recipeId, sourcePath) composite row', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 10 });
    expect(repo.findOne('r1', 'src/a.ts')?.status).toBe('active');

    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', status: 'stale', verifiedAt: 20 });
    expect(repo.count()).toBe(1);
    const updated = repo.findOne('r1', 'src/a.ts');
    expect(updated?.status).toBe('stale');
    expect(updated?.verifiedAt).toBe(20);
  });

  test('findByRecipeId / findBySourcePath / findByStatus partition rows correctly', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/b.ts', status: 'stale', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r2', sourcePath: 'src/a.ts', verifiedAt: 1 });

    expect(repo.findByRecipeId('r1')).toHaveLength(2);
    expect(repo.findBySourcePath('src/a.ts')).toHaveLength(2);
    expect(repo.findByStatus('stale')).toHaveLength(1);
    expect(repo.findStale()[0]?.sourcePath).toBe('src/b.ts');
    expect(repo.findByRecipeId('ghost')).toEqual([]);
  });

  test('updateStatus reports row effect and records newPath for renames', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });

    expect(repo.updateStatus('r1', 'src/a.ts', 'renamed', 'src/moved/a.ts')).toBe(true);
    expect(repo.updateStatus('r1', 'src/none.ts', 'stale')).toBe(false);

    const renamed = repo.findRenamed();
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.newPath).toBe('src/moved/a.ts');
  });

  test('replaceSourcePath rewrites the key, resets status to active and clears newPath', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/old.ts', status: 'renamed', verifiedAt: 1 });

    repo.replaceSourcePath('r1', 'src/old.ts', 'src/new.ts', 99);

    expect(repo.findOne('r1', 'src/old.ts')).toBeNull();
    const moved = repo.findOne('r1', 'src/new.ts');
    expect(moved?.status).toBe('active');
    expect(moved?.newPath).toBeNull();
    expect(moved?.verifiedAt).toBe(99);
  });

  test('getStaleCountsByRecipe aggregates stale vs total per recipe', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', status: 'stale', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/b.ts', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r2', sourcePath: 'src/c.ts', verifiedAt: 1 });

    const counts = repo.getStaleCountsByRecipe();
    expect(counts).toEqual([{ recipeId: 'r1', staleCount: 1, totalCount: 2 }]);
  });

  test('getStaleCountsByRecipe treats drifted refs as stale work', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', status: 'drifted', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/b.ts', status: 'stale', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/c.ts', verifiedAt: 1 });

    const counts = repo.getStaleCountsByRecipe();
    expect(counts).toEqual([{ recipeId: 'r1', staleCount: 2, totalCount: 3 }]);
  });

  test('findActiveByRecipeIds excludes stale refs and handles empty input', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/b.ts', status: 'stale', verifiedAt: 1 });

    const active = repo.findActiveByRecipeIds(['r1', 'r2']);
    expect(active).toHaveLength(1);
    expect(active[0]?.sourcePath).toBe('src/a.ts');
    expect(repo.findActiveByRecipeIds([])).toEqual([]);
  });

  test('deleting the knowledge entry cascades to its source refs (FK ON DELETE CASCADE)', () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });
    expect(repo.count()).toBe(1);

    connection.db!.prepare("DELETE FROM knowledge_entries WHERE id = 'r1'").run();
    expect(repo.count()).toBe(0);
  });

  test('isAccessible reflects table availability', () => {
    expect(repo.isAccessible()).toBe(true);
    connection.db!.exec('DROP TABLE recipe_source_refs');
    expect(repo.isAccessible()).toBe(false);
  });
});

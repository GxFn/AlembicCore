import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { computeContentHash } from '../src/shared/contentHash.js';
import {
  FileDiffSnapshotStore,
  normalizeSnapshotPath,
  reconcileSnapshotHashes,
  type SnapshotData,
} from '../src/workflows/surfaces/persistence/FileDiffSnapshotStore.js';

describe('normalizeSnapshotPath', () => {
  it('prefers project-relative path derived from absolute file path', () => {
    const rel = normalizeSnapshotPath(
      {
        path: '/repo/Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift',
        relativePath: 'Middleware/AuthMiddleware.swift',
      },
      '/repo'
    );

    expect(rel).toBe('Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift');
  });

  it('falls back to scanner relativePath when absolute path is outside project', () => {
    const rel = normalizeSnapshotPath(
      {
        path: '/tmp/AuthMiddleware.swift',
        relativePath: 'Middleware/AuthMiddleware.swift',
      },
      '/repo'
    );

    expect(rel).toBe('Middleware/AuthMiddleware.swift');
  });
});

describe('reconcileSnapshotHashes', () => {
  it('maps legacy short snapshot paths to unique current project-relative paths', () => {
    const result = reconcileSnapshotHashes(
      {
        'Middleware/AuthMiddleware.swift': 'old-auth-hash',
        'Sources/App.swift': 'app-hash',
      },
      ['Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift', 'Sources/App.swift']
    );

    expect(result.hashes).toEqual({
      'Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift': 'old-auth-hash',
      'Sources/App.swift': 'app-hash',
    });
    expect(result.remapped).toEqual({
      'Middleware/AuthMiddleware.swift':
        'Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift',
    });
    expect(result.ambiguous).toEqual([]);
  });

  it('keeps ambiguous legacy paths unchanged', () => {
    const result = reconcileSnapshotHashes(
      {
        'Middleware/AuthMiddleware.swift': 'old-auth-hash',
      },
      [
        'Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift',
        'Sources/Feature/Networking/Middleware/AuthMiddleware.swift',
      ]
    );

    expect(result.hashes).toEqual({
      'Middleware/AuthMiddleware.swift': 'old-auth-hash',
    });
    expect(result.remapped).toEqual({});
    expect(result.ambiguous).toEqual(['Middleware/AuthMiddleware.swift']);
  });
});

describe('FileDiffSnapshotStore.computeDiff', () => {
  it('reports a canonical modified file instead of legacy added/deleted noise', () => {
    const store = new FileDiffSnapshotStore({ getDrizzle: () => ({}) });
    const snapshot: SnapshotData = {
      id: 'snap_legacy',
      sessionId: null,
      projectRoot: '/repo',
      createdAt: new Date(0).toISOString(),
      durationMs: 0,
      fileCount: 1,
      dimensionCount: 0,
      candidateCount: 0,
      primaryLang: null,
      fileHashes: {
        'Middleware/AuthMiddleware.swift': 'old-auth-hash',
      },
      dimensionMeta: {},
      episodicData: null,
      isIncremental: false,
      parentId: null,
      changedFiles: [],
      affectedDims: [],
      status: 'complete',
    };

    const diff = store.computeDiff(
      snapshot,
      [
        {
          path: '/repo/Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift',
          relativePath: 'Middleware/AuthMiddleware.swift',
          content: 'new auth middleware content',
        },
      ],
      '/repo'
    );

    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([
      'Sources/Infrastructure/Networking/Middleware/AuthMiddleware.swift',
    ]);
    expect(diff.deleted).toEqual([]);
  });
});

describe('FileDiffSnapshotStore file content authority', () => {
  let projectRoot: string;
  let runtime: AlembicDatabaseRuntime;
  let store: FileDiffSnapshotStore;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-file-diff-content-'));
    pathGuard.configure({ projectRoot, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
    store = new FileDiffSnapshotStore(runtime.connection);
  });

  afterEach(() => {
    runtime?.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('uses disk bytes consistently when a scanned file omits content', () => {
    const filePath = path.join(projectRoot, 'source.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');
    const files = [{ path: filePath }];
    const snapshotId = store.save({ projectRoot, allFiles: files });
    const snapshot = store.getById(snapshotId);

    expect(snapshot).not.toBeNull();
    expect(store.computeDiff(snapshot!, files, projectRoot)).toMatchObject({
      unchanged: ['source.ts'],
      modified: [],
      changeRatio: 0,
    });

    fs.writeFileSync(filePath, 'export const value = 2;\n');
    expect(store.computeDiff(snapshot!, files, projectRoot)).toMatchObject({
      unchanged: [],
      modified: ['source.ts'],
    });
  });

  it('preserves an explicitly empty scan instead of replacing it with disk content', () => {
    const filePath = path.join(projectRoot, 'source.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');
    const files = [{ path: filePath, content: '' }];
    const snapshotId = store.save({ projectRoot, allFiles: files });
    const snapshot = store.getById(snapshotId);

    expect(snapshot?.fileHashes['source.ts']).toBe(computeContentHash(''));
    expect(store.computeDiff(snapshot!, files, projectRoot)).toMatchObject({
      unchanged: ['source.ts'],
      modified: [],
      changeRatio: 0,
    });
  });
});

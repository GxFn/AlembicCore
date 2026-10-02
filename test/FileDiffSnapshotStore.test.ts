import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { computeContentHash } from '../src/shared/contentHash.js';
import {
  FileDiffSnapshotStore,
  normalizeSnapshotPath,
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

  // 存进去的快照由仓储读回核对：这个存储只有写入一侧。
  const savedHashes = async (snapshotId: string) =>
    (await createAlembicRepositories(runtime.connection).generateRepository.findById(snapshotId))
      ?.fileHashes;

  it('hashes the bytes on disk when a scanned file omits content', async () => {
    const filePath = path.join(projectRoot, 'source.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');
    const first = store.save({ projectRoot, allFiles: [{ path: filePath }] });

    expect(await savedHashes(first)).toEqual({
      'source.ts': computeContentHash('export const value = 1;\n'),
    });

    fs.writeFileSync(filePath, 'export const value = 2;\n');
    const second = store.save({ projectRoot, allFiles: [{ path: filePath }] });
    expect(await savedHashes(second)).toEqual({
      'source.ts': computeContentHash('export const value = 2;\n'),
    });
  });

  it('preserves an explicitly empty scan instead of replacing it with disk content', async () => {
    const filePath = path.join(projectRoot, 'source.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');
    const snapshotId = store.save({ projectRoot, allFiles: [{ path: filePath, content: '' }] });

    expect(await savedHashes(snapshotId)).toEqual({ 'source.ts': computeContentHash('') });
  });
});

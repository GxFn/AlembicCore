import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import {
  SourceGraphFreshnessService,
  SourceGraphIndexer,
  SourceGraphService,
} from '../src/service/source-graph/index.js';
import { createProjectDescriptor } from '../src/shared/ProjectScope.js';

describe('SourceGraphIndexer', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-indexer-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds a full source graph generation with file inventory, symbols, imports, and fresh status', async () => {
    writeFixture(
      'src/index.ts',
      "import { helper } from './util';\nexport class App {}\nhelper();\n"
    );
    writeFixture('src/util.ts', 'export function helper() { return 1; }\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(repositories.sourceGraphRepository);
    const result = await indexer.buildFull({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-full',
      now: 1000,
      includeExtensions: ['.ts'],
    });

    expect(result.snapshot).toMatchObject({
      generationId: 'gen-full',
      repoId: 'fixture',
      projectScope: 'src',
      status: 'indexed',
      fileCount: 2,
      edgeCount: 1,
    });
    expect(result.status.ready).toBe(true);
    expect(result.files.map((file) => file.repoRelativePath)).toStrictEqual([
      'src/index.ts',
      'src/util.ts',
    ]);
    expect(result.symbols.map((symbol) => symbol.displayName)).toEqual(
      expect.arrayContaining(['index.ts', 'util.ts', 'App', 'helper'])
    );
    expect(result.edges[0]).toMatchObject({
      kind: 'imports',
      fromFilePath: 'src/index.ts',
      toFilePath: 'src/util.ts',
    });
  });

  it.each([
    'incremental',
    'inspect',
  ])('does not interpret an unreadable source directory as deletion during %s', async (operation) => {
    writeFixture('src/kept.ts', 'export const kept = 1;\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = {
      projectRoot: tmpDir,
      projectScope: 'src',
      repoId: 'fixture',
      includeExtensions: ['.ts'],
    };
    await indexer.buildFull({ ...input, generationId: 'before-read-failure' });
    const fault = Object.assign(new Error('source directory is unreadable'), { code: 'EACCES' });
    const read = vi.spyOn(fsPromises, 'readdir').mockRejectedValueOnce(fault);
    try {
      const result =
        operation === 'incremental'
          ? indexer.buildIncremental({
              ...input,
              baseGenerationId: 'before-read-failure',
              generationId: 'failed-read',
            })
          : new SourceGraphFreshnessService(sourceGraphRepository).inspect(input);
      await expect(result).rejects.toThrow('source directory is unreadable');
      expect(await sourceGraphRepository.getSnapshot('failed-read')).toBeNull();
      expect(await sourceGraphRepository.listFiles('before-read-failure')).toHaveLength(1);
    } finally {
      read.mockRestore();
    }
  });

  it('retains incoming file imports while invalidating symbol edges into changed target files', async () => {
    writeFixture(
      'src/index.ts',
      "import { oldTarget } from './target';\nexport function caller() { oldTarget(); }\n"
    );
    writeFixture('src/target.ts', 'export function oldTarget() {}\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = {
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      includeExtensions: ['.ts'],
    };
    await indexer.buildFull({ ...input, generationId: 'before-symbol-change' });
    await sourceGraphRepository.upsertEdge({
      generationId: 'before-symbol-change',
      edgeId: 'caller-to-old-target',
      kind: 'calls',
      fromSymbolId: 'src/index.ts#caller',
      toSymbolId: 'src/target.ts#oldTarget',
      fromFilePath: 'src/index.ts',
      toFilePath: 'src/target.ts',
      siteFilePath: 'src/index.ts',
    });
    writeFixture('src/target.ts', 'export function newTarget() {}\n');
    const result = await indexer.buildIncremental({
      ...input,
      baseGenerationId: 'before-symbol-change',
      generationId: 'after-symbol-change',
      changedFiles: ['src/target.ts'],
    });
    expect(result.symbols.some((symbol) => symbol.symbolId === 'src/target.ts#oldTarget')).toBe(
      false
    );
    expect(result.edges.filter((edge) => edge.kind === 'imports')).toHaveLength(1);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toEqual([]);
  });

  it('uses a projectScopeDescriptor as the default source graph boundary', async () => {
    writeFixture('Alembic/src/index.ts', 'export const alembic = 1;\n');
    writeFixture('AlembicCore/src/index.ts', 'export const core = 1;\n');
    writeFixture('AlembicPlugin/src/index.ts', 'export const plugin = 1;\n');
    writeFixture('Test/src/index.ts', 'export const test = 1;\n');
    writeFixture('wakeflow-ledger/src/index.ts', 'export const ledger = 1;\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(repositories.sourceGraphRepository);
    const result = await indexer.buildFull({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScopeDescriptor: createSourceGraphProjectScope(tmpDir),
      generationId: 'gen-workspace-config',
      now: 1500,
      includeExtensions: ['.ts'],
    });

    expect(result.files.map((file) => file.repoRelativePath).sort()).toEqual([
      'Alembic/src/index.ts',
      'AlembicCore/src/index.ts',
      'AlembicPlugin/src/index.ts',
    ]);
    expect(result.files.map((file) => file.repoRelativePath).join('\n')).not.toContain('Test/');
    expect(result.files.map((file) => file.repoRelativePath).join('\n')).not.toContain(
      'wakeflow-ledger/'
    );
    expect(result.snapshot.projectScope).toMatch(/^project-scope-/);
  });

  it('detects stale filesystem changes and builds an incremental generation with deletion cleanup', async () => {
    writeFixture(
      'src/index.ts',
      "import { helper } from './util';\nexport class App {}\nhelper();\n"
    );
    writeFixture('src/util.ts', 'export function helper() { return 1; }\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const sourceGraphRepository = repositories.sourceGraphRepository;
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    await indexer.buildFull({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-full',
      now: 1000,
      includeExtensions: ['.ts'],
    });

    writeFixture(
      'src/util.ts',
      'export function helper() { return 2; }\nexport const changed = true;\n'
    );
    writeFixture(
      'src/new.ts',
      "import { helper } from './util';\nexport function next() { return helper(); }\n"
    );
    fs.unlinkSync(path.join(tmpDir, 'src/index.ts'));

    const freshness = await new SourceGraphFreshnessService(sourceGraphRepository).inspect({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      now: 2000,
      includeExtensions: ['.ts'],
    });

    expect(freshness.freshness).toMatchObject({
      status: 'stale',
      pendingFileCount: 2,
      staleFileCount: 1,
      nextAction: 'run_incremental_source_graph_index',
    });
    expect(freshness.changedFiles).toStrictEqual(['src/new.ts', 'src/util.ts']);
    expect(freshness.deletedFiles).toStrictEqual(['src/index.ts']);
    expect(freshness.status.ready).toBe(false);

    const incremental = await indexer.buildIncremental({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      baseGenerationId: 'gen-full',
      generationId: 'gen-incremental',
      now: 3000,
      includeExtensions: ['.ts'],
    });

    expect(incremental.changedFiles).toStrictEqual(['src/new.ts', 'src/util.ts']);
    expect(incremental.deletedFiles).toStrictEqual(['src/index.ts']);
    expect(incremental.snapshot).toMatchObject({
      generationId: 'gen-incremental',
      status: 'indexed',
      fileCount: 2,
      edgeCount: 1,
    });
    expect(await sourceGraphRepository.findFile('gen-incremental', 'src/index.ts')).toBeNull();
    expect(
      (await sourceGraphRepository.findFile('gen-incremental', 'src/util.ts'))?.contentHash
    ).not.toBe((await sourceGraphRepository.findFile('gen-full', 'src/util.ts'))?.contentHash);
    expect(
      await sourceGraphRepository.findEdgesForFile('gen-incremental', 'src/index.ts')
    ).toHaveLength(0);
    expect(incremental.status.ready).toBe(true);
  });

  it('preserves unchanged importers when their target changes, disappears, and returns', async () => {
    writeFixture(
      'src/index.ts',
      "import { helper } from './util';\nexport const value = helper();\n"
    );
    writeFixture('src/util.ts', 'export function helper() { return 1; }\n');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const indexer = new SourceGraphIndexer(repository);
    const options = { projectRoot: tmpDir, repoId: 'fixture', projectScope: 'src' };
    const full = await indexer.buildFull({ ...options, generationId: 'imports-full', now: 1000 });
    const expectedEdge = {
      kind: 'imports',
      fromFilePath: 'src/index.ts',
      toFilePath: 'src/util.ts',
    };
    expect(full.edges).toEqual([expect.objectContaining(expectedEdge)]);

    writeFixture('src/util.ts', 'export function helper() { return 222; }\n');
    const edited = await indexer.buildIncremental({
      ...options,
      generationId: 'imports-edited',
      now: 2000,
    });
    expect(edited.changedFiles).toEqual(['src/util.ts']);
    expect(edited.edges).toEqual([
      expect.objectContaining({ ...expectedEdge, generationId: 'imports-edited' }),
    ]);

    fs.unlinkSync(path.join(tmpDir, 'src/util.ts'));
    const deleted = await indexer.buildIncremental({
      ...options,
      generationId: 'imports-deleted',
      now: 3000,
    });
    expect(deleted.deletedFiles).toEqual(['src/util.ts']);
    expect(deleted.edges).toEqual([]);

    // 未修改的 importer 没有可保留的入边；目标重新出现后仍须从真实 import 恢复。
    writeFixture('src/util.ts', 'export function helper() { return 3; }\n');
    const restored = await indexer.buildIncremental({
      ...options,
      generationId: 'imports-restored',
      now: 4000,
    });
    expect(restored.changedFiles).toEqual(['src/util.ts']);
    expect(restored.edges).toEqual([
      expect.objectContaining({ ...expectedEdge, generationId: 'imports-restored' }),
    ]);
  });

  it('records partial and degraded accounting for large, unsupported, timeout, and parse-failed files', async () => {
    writeFixture('src/ok.ts', 'export const ok = true;\n');
    writeFixture('src/large.ts', `export const large = '${'x'.repeat(120)}';\n`);
    writeFixture('src/timeout.ts', `export const slow = '${'y'.repeat(60)}';\n`);
    writeFixture('src/Broken.ts', 'SOURCE_GRAPH_PARSE_FAILURE\n');
    // Track2-b(2026-07-11):Swift 走 AST 解析(不再 unsupported)——正向断言其 parsed;
    // 真正 unsupported 的样本换 ruby(不在 AST_PARSER_LANGUAGES)。
    writeFixture('src/App.swift', 'struct App {}\n');
    writeFixture('src/legacy.rb', 'class Legacy; end\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const service = new SourceGraphService(repositories.sourceGraphRepository);
    const result = await service.buildFullIndex({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-degraded',
      now: 4000,
      includeExtensions: ['.ts', '.swift', '.rb'],
      maxFileSizeBytes: 100,
      maxParseBytes: 40,
    });

    expect(result.snapshot).toMatchObject({
      status: 'partial',
      fileCount: 6,
      parseErrorCount: 4,
    });
    expect(result.snapshot.freshness.status).toBe('partial');
    expect(result.status.ready).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code).sort()).toStrictEqual([
      'catch-up-failed',
      'large-file-skipped',
      'parser-timeout',
      'unsupported-language',
    ]);
    expect(result.files.map((file) => [file.repoRelativePath, file.parseStatus])).toEqual(
      expect.arrayContaining([
        ['src/App.swift', 'parsed'],
        ['src/legacy.rb', 'skipped'],
        ['src/Broken.ts', 'failed'],
        ['src/large.ts', 'skipped'],
        ['src/timeout.ts', 'partial'],
      ])
    );
    // Swift AST 实体真实入库(struct App 以 class kind 归一)。
    expect(
      result.symbols.some(
        (symbol) => symbol.filePath === 'src/App.swift' && symbol.displayName === 'App'
      )
    ).toBe(true);
  });

  function writeFixture(repoRelativePath: string, content: string): void {
    const absolutePath = path.join(tmpDir, repoRelativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }

  function createSourceGraphProjectScope(projectRoot: string) {
    return createProjectDescriptor({
      controlRoot: projectRoot,
      dataRoot: path.join(projectRoot, '.asd', 'workspaces', 'source-graph-fixture'),
      folders: [
        {
          displayName: 'Alembic',
          path: path.join(projectRoot, 'Alembic'),
          repositoryId: 'alembic',
          role: 'primary-source',
        },
        {
          displayName: 'AlembicCore',
          path: path.join(projectRoot, 'AlembicCore'),
          repositoryId: 'alembic-core',
          role: 'source',
        },
        {
          displayName: 'AlembicPlugin',
          path: path.join(projectRoot, 'AlembicPlugin'),
          repositoryId: 'alembic-plugin',
          role: 'source',
        },
      ],
      projectId: 'source-graph-fixture',
      projectScopeId: 'project-scope-source-graph-fixture',
    });
  }
});

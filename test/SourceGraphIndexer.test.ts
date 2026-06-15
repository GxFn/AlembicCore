import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import {
  SourceGraphFreshnessService,
  SourceGraphIndexer,
  SourceGraphService,
} from '../src/service/source-graph/index.js';

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

  it('uses workspace.config repoNames as the default source graph boundary', async () => {
    writeFixture(
      'workspace.config.json',
      JSON.stringify(
        {
          repoNames: ['Alembic', 'AlembicCore', 'AlembicPlugin'],
          repositories: [
            { name: 'Alembic', mode: 'external', path: 'Alembic' },
            { name: 'AlembicCore', mode: 'external', path: 'AlembicCore' },
            { name: 'AlembicPlugin', mode: 'external', path: 'AlembicPlugin' },
            { name: 'Test', mode: 'internal', path: 'Test' },
          ],
        },
        null,
        2
      )
    );
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

  it('records partial and degraded accounting for large, unsupported, timeout, and parse-failed files', async () => {
    writeFixture('src/ok.ts', 'export const ok = true;\n');
    writeFixture('src/large.ts', `export const large = '${'x'.repeat(120)}';\n`);
    writeFixture('src/timeout.ts', `export const slow = '${'y'.repeat(60)}';\n`);
    writeFixture('src/Broken.ts', 'SOURCE_GRAPH_PARSE_FAILURE\n');
    writeFixture('src/App.swift', 'struct App {}\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const service = new SourceGraphService(repositories.sourceGraphRepository);
    const result = await service.buildFullIndex({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-degraded',
      now: 4000,
      includeExtensions: ['.ts', '.swift'],
      maxFileSizeBytes: 100,
      maxParseBytes: 40,
    });

    expect(result.snapshot).toMatchObject({
      status: 'partial',
      fileCount: 5,
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
        ['src/App.swift', 'skipped'],
        ['src/Broken.ts', 'failed'],
        ['src/large.ts', 'skipped'],
        ['src/timeout.ts', 'partial'],
      ])
    );
  });

  function writeFixture(repoRelativePath: string, content: string): void {
    const absolutePath = path.join(tmpDir, repoRelativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
});

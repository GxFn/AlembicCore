/**
 * Track2(2026-07-10):SourceGraphLifecycleService.catchUpOnStartup 激活回归。
 * 该服务此前全仓零调用方(四表恒 0 行);本测锁"无快照→全量/fresh→noop/
 * 文件变更→增量"的幂等编排,即主体挖掘准备段的生产语义。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../../src/database.js';
import { SourceGraphLifecycleService } from '../../src/index.js';
import { pathGuard } from '../../src/io.js';
import { createAlembicRepositories } from '../../src/repositories.js';
import { SourceGraphIndexer } from '../../src/service/source-graph/SourceGraphIndexer.js';

describe('SourceGraphLifecycleService.catchUpOnStartup(Track2 激活)', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-catchup-'));
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

  it('Track2-b:Swift 文件经 AST 出实体(此前非 JS 系一律 skipped,0 符号)', async () => {
    write(
      'Sources/Feed/FeedViewModel.swift',
      [
        'import AOXFoundationKit',
        '',
        'final class FeedViewModel {',
        '    var title: String = ""',
        '    func load() {',
        '    }',
        '}',
        '',
      ].join('\n')
    );
    const repositories = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(
      repositories.sourceGraphRepository as ConstructorParameters<
        typeof SourceGraphLifecycleService
      >[0]
    );
    const result = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(result.action).toBe('built-full');
    // module 符号 + class FeedViewModel + func load + var title ≥ 4。
    expect(result.durableTables.source_graph_symbols).toBeGreaterThanOrEqual(4);
    const symbolNames = (result.build?.symbols ?? []).map((symbol) => symbol.displayName);
    expect(symbolNames).toContain('FeedViewModel');
    expect(symbolNames).toContain('load');
  });

  it('无快照→全量建库;再跑→fresh noop;改文件→增量', async () => {
    write('src/index.ts', "import { helper } from './util';\nexport const app = helper();\n");
    write('src/util.ts', 'export function helper() { return 1; }\n');
    const repositories = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(
      repositories.sourceGraphRepository as ConstructorParameters<
        typeof SourceGraphLifecycleService
      >[0]
    );

    // 契约语序:reason=触发场景(startup-catch-up),action=实际动作(built-full/...)。
    const first = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(first.action).toBe('built-full');
    expect(first.durableTables.source_graph_files).toBeGreaterThanOrEqual(2);
    expect(first.durableTables.source_graph_symbols).toBeGreaterThan(0);
    expect(first.durableTables.source_graph_edges).toBeGreaterThan(0);

    const second = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(second.action).toBe('fresh-noop');

    write('src/util.ts', 'export function helper() { return 2; }\nexport const extra = 3;\n');
    const third = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(third.action).toBe('built-incremental');
  });

  it('rebuilds unchanged source after the extractor identity changes, then resumes fresh noop', async () => {
    write('src/stable.ts', 'export function stable() { return 1; }\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(sourceGraphRepository);
    const input = { projectRoot: tmpDir, projectScope: 'src', includeExtensions: ['.ts'] };
    await lifecycle.catchUpOnStartup({
      ...input,
      extractorVersion: 'engine-a',
      generationId: 'identity-a',
      now: 1000,
    });

    const upgraded = await lifecycle.catchUpOnStartup({
      ...input,
      extractorVersion: 'engine-b',
      generationId: 'identity-b',
      now: 2000,
    });

    expect(upgraded.action).toBe('built-full');
    expect(upgraded.build?.snapshot.extractionVersion).toBe('engine-b');
    expect(await sourceGraphRepository.listSymbols('identity-b')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'stable',
          metadata: expect.objectContaining({ extractorVersion: 'engine-b' }),
        }),
      ])
    );
    expect((await sourceGraphRepository.getSnapshot('identity-a'))?.extractionVersion).toBe(
      'engine-a'
    );
    const unchanged = await lifecycle.catchUpOnStartup({
      ...input,
      extractorVersion: 'engine-b',
      generationId: 'identity-unneeded',
      now: 3000,
    });
    expect(unchanged.action).toBe('fresh-noop');
    expect(unchanged.generationId).toBe('identity-b');
    expect(await sourceGraphRepository.getSnapshot('identity-unneeded')).toBeNull();
  });

  it('does not inherit old extractor facts when direct incremental indexing upgrades one changed file', async () => {
    write('src/stable.ts', 'export function stable() { return 1; }\n');
    write('src/edited.ts', 'export const first = 1;\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = { projectRoot: tmpDir, projectScope: 'src', includeExtensions: ['.ts'] };
    await indexer.buildFull({
      ...input,
      extractorVersion: 'engine-a',
      generationId: 'incremental-a',
      now: 1000,
    });
    write('src/edited.ts', 'export const first = 1;\nexport const added = 2;\n');

    const upgraded = await indexer.buildIncremental({
      ...input,
      extractorVersion: 'engine-b',
      baseGenerationId: 'incremental-a',
      generationId: 'incremental-b',
      now: 2000,
    });

    expect(upgraded.snapshot.metadata.mode).toBe('full');
    const files = await sourceGraphRepository.listFiles('incremental-b');
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.metadata.extractorVersion === 'engine-b')).toBe(true);
    expect(files.every((file) => file.indexedAt === 2000)).toBe(true);
    const symbols = await sourceGraphRepository.listSymbols('incremental-b');
    expect(symbols.map((symbol) => symbol.displayName)).toEqual(
      expect.arrayContaining(['stable', 'first', 'added'])
    );
    expect(symbols.every((symbol) => symbol.metadata.extractorVersion === 'engine-b')).toBe(true);
  });

  it('reextracts unchanged partial files when the parser budget increases', async () => {
    write('src/stable.ts', 'export function stable() { return 1; }\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(sourceGraphRepository);
    const input = { projectRoot: tmpDir, projectScope: 'src', includeExtensions: ['.ts'] };
    const limited = await lifecycle.catchUpOnStartup({
      ...input,
      generationId: 'budget-small',
      maxParseBytes: 1,
      now: 1000,
    });
    expect(limited.freshness.status).toBe('partial');
    expect(limited.build?.symbols.map((symbol) => symbol.displayName)).not.toContain('stable');

    const recovered = await lifecycle.catchUpOnStartup({
      ...input,
      generationId: 'budget-raised',
      maxParseBytes: 10000,
      now: 2000,
    });

    expect(recovered.action).toBe('built-full');
    expect(recovered.freshness.status).toBe('fresh');
    expect((await sourceGraphRepository.listFiles('budget-raised'))[0].parseStatus).toBe('parsed');
    expect(
      (await sourceGraphRepository.listSymbols('budget-raised')).map((symbol) => symbol.displayName)
    ).toContain('stable');
  });

  it('rebuilds when two empty source scopes have the same file inventory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'empty-one'));
    fs.mkdirSync(path.join(tmpDir, 'empty-two'));
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(sourceGraphRepository);
    await lifecycle.catchUpOnStartup({
      projectRoot: tmpDir,
      projectScope: 'empty-one',
      generationId: 'scope-one',
      now: 1000,
    });

    const switched = await lifecycle.catchUpOnStartup({
      projectRoot: tmpDir,
      projectScope: 'empty-two',
      generationId: 'scope-two',
      now: 2000,
    });

    expect(switched.action).toBe('built-full');
    expect((await sourceGraphRepository.getSnapshot('scope-two'))?.projectScope).toBe('empty-two');
    expect((await sourceGraphRepository.getSnapshot('scope-one'))?.projectScope).toBe('empty-one');
  });

  it('does not inherit an explicit base from another scope even when the visible files are unchanged', async () => {
    write('src/nested/stable.ts', 'export function stable() { return 1; }\n');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    await indexer.buildFull({
      projectRoot: tmpDir,
      projectScope: 'src',
      generationId: 'scope-base',
      now: 1000,
    });

    const switched = await indexer.buildIncremental({
      projectRoot: tmpDir,
      projectScope: 'src/nested',
      baseGenerationId: 'scope-base',
      generationId: 'scope-nested',
      now: 2000,
    });

    expect(switched.snapshot.metadata.mode).toBe('full');
    expect(switched.snapshot.projectScope).toBe('src/nested');
    expect(await sourceGraphRepository.listFiles('scope-nested')).toEqual([
      expect.objectContaining({ repoRelativePath: 'src/nested/stable.ts', indexedAt: 2000 }),
    ]);
    expect((await sourceGraphRepository.getSnapshot('scope-base'))?.projectScope).toBe('src');
  });

  function write(relPath: string, content: string) {
    const absolute = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { CodeGraphProcess } from '../src/infrastructure/analysis/CodeGraphProcess.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import {
  SourceGraphFreshnessService,
  SourceGraphIndexer,
  SourceGraphService,
} from '../src/service/source-graph/index.js';
import { SourceGraphLifecycleService } from '../src/service/source-graph/SourceGraphLifecycle.js';
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
    vi.restoreAllMocks();
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists actual SDK declarations without comment symbols, lost collisions or a replaced module anchor', async () => {
    const content = [
      'import {',
      '  helper,',
      "} from './util.js';",
      "// import './ghost';",
      'const requireExample = "require(\'./ghost\')";',
      'const importExample = `',
      "import './ghost';",
      "export * from './ghost';",
      '`;',
      "object.import('./ghost');",
      '// export class Phantom {}',
      'const text = "export class StringGhost {}";',
      'export const load = () => helper();',
      'export class A { get value() { return 1; } set value(input: number) {} run() {} }',
      'export class B { run() {} }',
      'export const module = 1;',
    ].join('\n');
    writeFixture('src/index.ts', content);
    writeFixture('src/util.ts', 'export function helper() { return 1; }');
    writeFixture('src/ghost.ts', 'export const ghost = 1;');
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const dataRoot = path.join(tmpDir, 'private');
    const runtimeRoot = path.join(dataRoot, '.asd/codegraph-sessions');
    const originalReplace = sourceGraphRepository.replaceGeneration.bind(sourceGraphRepository);
    const publish = vi
      .spyOn(sourceGraphRepository, 'replaceGeneration')
      .mockImplementation(async (input) => {
        // 最后一条符号不是提交点；SDK scope 必须先关闭，清理失败不能事后留下成功generation。
        expect(fs.readdirSync(runtimeRoot)).toEqual([]);
        return originalReplace(input);
      });
    const result = await new SourceGraphIndexer(sourceGraphRepository).buildFull({
      projectRoot: tmpDir,
      projectScope: 'src',
      generationId: 'sdk-declarations',
      codeGraph: { dataRoot },
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(result.status.ready).toBe(true);
    expect(result.files.find((file) => file.repoRelativePath === 'src/index.ts')?.contentHash).toBe(
      crypto.createHash('sha256').update(content).digest('hex')
    );
    const symbols = result.symbols.filter((symbol) => symbol.filePath === 'src/index.ts');
    expect(symbols.map((symbol) => symbol.displayName)).not.toEqual(
      expect.arrayContaining(['Phantom'])
    );
    expect(symbols.some((symbol) => symbol.displayName === 'StringGhost')).toBe(false);
    expect(symbols.find((symbol) => symbol.symbolId === 'src/index.ts#load')).toMatchObject({
      kind: 'variable',
      metadata: { declarationKind: 'const' },
    });
    expect(symbols.map((symbol) => symbol.symbolId)).toEqual(
      expect.arrayContaining(['src/index.ts#A', 'src/index.ts#A.run', 'src/index.ts#B.run'])
    );
    expect(symbols.find((symbol) => symbol.symbolId === 'src/index.ts#module')?.kind).toBe(
      'module'
    );
    expect(symbols.find((symbol) => symbol.displayName === 'module')?.symbolId).not.toBe(
      'src/index.ts#module'
    );
    expect(symbols.filter((symbol) => symbol.qualifiedName === 'A.value')).toHaveLength(2);
    expect(new Set(symbols.map((symbol) => symbol.symbolId)).size).toBe(symbols.length);
    // 验证实际SQLite代际，不只校验构建器返回值；正文/模板/同名成员不能持久化成伪import。
    const persistedEdges = await sourceGraphRepository.listGenerationEdges('sdk-declarations');
    expect(persistedEdges.map((edge) => [edge.fromFilePath, edge.toFilePath])).toEqual([
      ['src/index.ts', 'src/util.ts'],
    ]);
    expect(result.edges[0].fromSymbolId).toBe('src/index.ts#module');
  });

  it('rebuilds a legacy generation with the actual SDK identity then reuses only the matching generation', async () => {
    writeFixture('src/index.ts', 'export class App { run() { return 1; } }');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const lifecycle = new SourceGraphLifecycleService(repository);
    const input = { projectRoot: tmpDir, projectScope: 'src' };
    const legacy = await lifecycle.catchUpOnStartup({
      ...input,
      generationId: 'legacy',
      now: 1000,
    });
    expect(legacy.build?.symbols.some((symbol) => symbol.symbolId === 'src/index.ts#App.run')).toBe(
      false
    );
    const sdkInput = { ...input, codeGraph: { dataRoot: path.join(tmpDir, 'private') } };
    const sdk = await lifecycle.catchUpOnStartup({ ...sdkInput, generationId: 'sdk', now: 2000 });
    expect(sdk.action).toBe('built-full');
    expect(sdk.build?.snapshot.extractionVersion).toContain('source-graph-codegraph-v1:');
    expect(sdk.build?.symbols.some((symbol) => symbol.symbolId === 'src/index.ts#App.run')).toBe(
      true
    );
    expect((await repository.getSnapshot('legacy'))?.extractionVersion).toBe(
      'source-graph-indexer-v1'
    );
    const reopen = new SourceGraphLifecycleService(repository);
    expect((await reopen.catchUpOnStartup({ ...sdkInput, now: 3000 })).action).toBe('fresh-noop');
    writeFixture('src/index.ts', 'export class App { next() { return 22; } }');
    const incremental = await reopen.catchUpOnStartup({
      ...sdkInput,
      generationId: 'sdk-next',
      now: 4000,
    });
    expect(incremental.action).toBe('built-incremental');
    expect(incremental.build?.symbols.map((symbol) => symbol.symbolId)).toContain(
      'src/index.ts#App.next'
    );
    expect(incremental.build?.symbols.map((symbol) => symbol.symbolId)).not.toContain(
      'src/index.ts#App.run'
    );
  });

  it('uses one source text for SDK symbols and hashes even when the live file changes after the read', async () => {
    const source = 'export const boundVersion = 1;';
    writeFixture('src/index.mts', source);
    const filePath = path.join(tmpDir, 'src/index.mts');
    const read = fsPromises.readFile.bind(fsPromises);
    let reads = 0;
    vi.spyOn(fsPromises, 'readFile').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (args[0] === filePath) {
        reads += 1;
        fs.writeFileSync(filePath, 'export const laterVersion = 2;');
      }
      return result;
    });
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const result = await new SourceGraphIndexer(repository).buildFull({
      projectRoot: tmpDir,
      projectScope: 'src',
      codeGraph: { dataRoot: path.join(tmpDir, 'private') },
    });
    expect(reads).toBe(1);
    expect(result.files[0]).toMatchObject({
      language: 'typescript',
      contentHash: crypto.createHash('sha256').update(source).digest('hex'),
    });
    expect(result.symbols.map((symbol) => symbol.displayName)).toContain('boundVersion');
    expect(result.symbols.map((symbol) => symbol.displayName)).not.toContain('laterVersion');
  });

  it.each([
    'abort',
    'failure',
  ])('does not publish a generation when SDK cleanup ends with %s', async (mode) => {
    writeFixture('src/index.ts', 'export const value = 1;');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const indexer = new SourceGraphIndexer(repository);
    const input = { projectRoot: tmpDir, projectScope: 'src' };
    await indexer.buildFull({ ...input, generationId: 'prior' });
    const controller = new AbortController();
    const dataRoot = path.join(tmpDir, 'private');
    const close = CodeGraphProcess.prototype.close;
    const reason = new DOMException('Cancelled before generation publication', 'AbortError');
    vi.spyOn(CodeGraphProcess.prototype, 'close').mockImplementation(async function (...args) {
      await close.apply(this, args);
      if (mode === 'abort') {
        controller.abort(reason);
      } else {
        throw new Error('SDK cleanup failed');
      }
    });
    await expect(
      indexer.buildFull({
        ...input,
        generationId: 'cancelled',
        codeGraph: { dataRoot },
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ message: mode === 'abort' ? reason.message : 'SDK cleanup failed' });
    expect(await repository.getSnapshot('cancelled')).toBeNull();
    expect(await repository.getSnapshot('prior')).not.toBeNull();
    expect(fs.readdirSync(path.join(dataRoot, '.asd/codegraph-sessions'))).toEqual([]);
  });

  it('excludes the shared private runtime with custom exclusions and leaves another session untouched', async () => {
    writeFixture('src/index.ts', 'export const value = 1;');
    writeFixture('.asd/codegraph-sessions/other/config.json', '{}');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const lifecycle = new SourceGraphLifecycleService(repository);
    const input = { projectRoot: tmpDir, ignoreDirectories: [], codeGraph: { dataRoot: tmpDir } };
    const result = await lifecycle.catchUpOnStartup(input);
    expect(result.build?.files.map((file) => file.repoRelativePath)).toEqual(['src/index.ts']);
    expect(result.freshness.status).toBe('fresh');
    expect(fs.readdirSync(path.join(tmpDir, '.asd/codegraph-sessions'))).toEqual(['other']);
    expect((await lifecycle.catchUpOnStartup(input)).action).toBe('fresh-noop');
  });

  it.each([
    false,
    true,
  ])('does not treat an empty declared ProjectScope as permission to scan its control root (SDK=%s)', async (sdk) => {
    writeFixture('loose.ts', 'export const outsideDeclaredScope = 1;');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const dataRoot = path.join(tmpDir, 'private');
    const projectScopeDescriptor = createProjectDescriptor({
      controlRoot: tmpDir,
      dataRoot,
      folders: [],
    });
    await expect(
      new SourceGraphIndexer(repository).buildFull({
        projectRoot: tmpDir,
        generationId: 'empty-declared-scope',
        projectScopeDescriptor,
        ...(sdk ? { codeGraph: { dataRoot } } : {}),
      })
    ).rejects.toThrow('source folder');
    expect(await repository.getSnapshot('empty-declared-scope')).toBeNull();
    expect(fs.existsSync(path.join(dataRoot, '.asd/codegraph-sessions'))).toBe(false);
  });

  it('reports real syntax and SDK coverage failures while a parser-marker string remains valid source', async () => {
    writeFixture('src/broken.ts', 'export class Broken {');
    writeFixture('src/namespace.ts', 'export namespace Models { export class Box {} }');
    writeFixture('src/valid.ts', 'export const marker = "SOURCE_GRAPH_PARSE_FAILURE";');
    const repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const result = await new SourceGraphIndexer(repository).buildFull({
      projectRoot: tmpDir,
      projectScope: 'src',
      codeGraph: { dataRoot: path.join(tmpDir, 'private') },
    });
    expect(result.snapshot.status).toBe('partial');
    expect(result.status.ready).toBe(false);
    expect(result.files.map((file) => [file.repoRelativePath, file.parseStatus])).toEqual([
      ['src/broken.ts', 'failed'],
      ['src/namespace.ts', 'failed'],
      ['src/valid.ts', 'parsed'],
    ]);
    expect(result.symbols.map((symbol) => symbol.displayName)).toContain('marker');
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === 'catch-up-failed')).toBe(
      true
    );
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

  it('retains every generation edge across full and unchanged incremental builds beyond query limits', async () => {
    const edgeCount = 501;
    const imports: string[] = [];
    for (let index = 0; index < edgeCount; index++) {
      const name = `dependency-${String(index).padStart(3, '0')}`;
      imports.push(`import './${name}';`);
      writeFixture(`src/${name}.ts`, `export const dependency${index} = ${index};\n`);
    }
    writeFixture('src/index.ts', `${imports.join('\n')}\n`);
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = {
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      includeExtensions: ['.ts'],
    };

    const full = await indexer.buildFull({ ...input, generationId: 'complete-base' });
    const incremental = await indexer.buildIncremental({
      ...input,
      baseGenerationId: full.snapshot.generationId,
      generationId: 'complete-incremental',
    });

    // 完整代际读取不能套用面向查询的默认 50 / 最大 500 条输出预算。
    expect({
      storedFull: full.snapshot.edgeCount,
      returnedFull: full.edges.length,
      storedIncremental: incremental.snapshot.edgeCount,
      returnedIncremental: incremental.edges.length,
    }).toEqual({
      storedFull: edgeCount,
      returnedFull: edgeCount,
      storedIncremental: edgeCount,
      returnedIncremental: edgeCount,
    });
    expect(incremental.changedFiles).toEqual([]);
    expect(incremental.deletedFiles).toEqual([]);
    expect(incremental.edges.map((edge) => edge.edgeId).sort()).toEqual(
      full.edges.map((edge) => edge.edgeId).sort()
    );
    expect(incremental.status.ready).toBe(true);
  });

  it('shares NodeNext source fallback while preserving exact JavaScript and relative import precedence', async () => {
    writeFixture(
      'src/index.ts',
      [
        "import './util.js';",
        "import './view.js';",
        "import './exact.js';",
        "import './choice';",
        "import '@/util';",
      ].join('\n')
    );
    for (const file of ['util.ts', 'view.tsx', 'exact.js', 'exact.ts', 'choice.js', 'choice.ts']) {
      writeFixture(`src/${file}`, 'export const value = 1;\n');
    }
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = { projectRoot: tmpDir, projectScope: 'src', repoId: 'fixture' };
    const full = await indexer.buildFull({ ...input, generationId: 'nodenext-base' });
    expect(full.edges.map((edge) => [edge.source, edge.toFilePath]).sort()).toEqual([
      ['./choice', 'src/choice.ts'],
      ['./exact.js', 'src/exact.js'],
      ['./util.js', 'src/util.ts'],
      ['./view.js', 'src/view.tsx'],
    ]);

    // 文件集合变化会重新解析未改动的 importer；真实 .js 出现/消失不能锁死旧TS边。
    writeFixture('src/util.js', 'export const emitted = true;\n');
    const emitted = await indexer.buildIncremental({
      ...input,
      baseGenerationId: full.snapshot.generationId,
      generationId: 'nodenext-emitted',
    });
    expect(emitted.edges.find((edge) => edge.source === './util.js')?.toFilePath).toBe(
      'src/util.js'
    );
    fs.unlinkSync(path.join(tmpDir, 'src/util.js'));
    const restored = await indexer.buildIncremental({
      ...input,
      baseGenerationId: emitted.snapshot.generationId,
      generationId: 'nodenext-source-restored',
    });
    expect(restored.edges.find((edge) => edge.source === './util.js')?.toFilePath).toBe(
      'src/util.ts'
    );
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

  it('retains unchanged parsing gaps and diagnostics until those files are reparsed or deleted', async () => {
    writeFixture('src/ok.ts', 'export const ok = 1;\n');
    writeFixture('src/broken.ts', 'SOURCE_GRAPH_PARSE_FAILURE\n');
    writeFixture('src/legacy.rb', 'class Legacy; end\n');
    writeFixture('src/partial.ts', `export const partial = '${'p'.repeat(60)}';\n`);
    writeFixture('src/large.ts', `export const large = '${'l'.repeat(120)}';\n`);
    const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
    const indexer = new SourceGraphIndexer(sourceGraphRepository);
    const input = {
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      includeExtensions: ['.ts', '.rb'],
      maxFileSizeBytes: 100,
      maxParseBytes: 40,
    };
    const full = await indexer.buildFull({ ...input, generationId: 'parsing-gaps-base' });
    expect(full.snapshot.parseErrorCount).toBe(4);

    const unchanged = await indexer.buildIncremental({
      ...input,
      baseGenerationId: full.snapshot.generationId,
      generationId: 'parsing-gaps-unchanged',
    });
    writeFixture('src/ok.ts', 'export const ok = 22;\n');
    const changed = await indexer.buildIncremental({
      ...input,
      baseGenerationId: unchanged.snapshot.generationId,
      generationId: 'parsing-gaps-changed',
      changedFiles: ['src/ok.ts'],
    });

    for (const result of [unchanged, changed]) {
      expect(result.snapshot).toMatchObject({
        status: 'partial',
        parseErrorCount: 4,
        freshness: { status: 'partial' },
      });
      expect(result.status.ready).toBe(false);
      expect(result.diagnostics).toEqual(full.diagnostics);
      expect(result.files.filter((file) => file.parseStatus !== 'parsed')).toHaveLength(4);
    }

    // 缺口真正修复/删除后才能解除旧诊断，不能永久继承上一代的降级状态。
    for (const file of ['broken.ts', 'partial.ts', 'large.ts']) {
      writeFixture(`src/${file}`, 'export const repaired = 1;\n');
    }
    fs.unlinkSync(path.join(tmpDir, 'src/legacy.rb'));
    const repaired = await indexer.buildIncremental({
      ...input,
      baseGenerationId: changed.snapshot.generationId,
      generationId: 'parsing-gaps-repaired',
    });
    expect(repaired.snapshot).toMatchObject({
      status: 'indexed',
      parseErrorCount: 0,
      freshness: { status: 'fresh' },
    });
    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.status.ready).toBe(true);
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

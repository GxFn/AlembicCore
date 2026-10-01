import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/core/ast/index.js';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import type {
  FileSymbolContext,
  ProjectEvidenceContext,
  ProjectImpactContext,
  ProjectModuleDependencyContext,
  ProjectRelationRequest,
  ProjectRelationWalkContext,
  ProjectSymbolListContext,
} from '../src/domain/project-context/index.js';
import { pathGuard } from '../src/io.js';
import { createProjectRelations, ProjectContext } from '../src/project-context.js';
import { createAlembicRepositories } from '../src/repositories.js';
import {
  type AnalysisBenchmarkFixture,
  materializeBenchmarkFixture,
} from './fixtures/analysis-benchmark/index.js';
import { objcAppFixture } from './fixtures/analysis-benchmark/objcApp.js';
import { swiftAppFixture } from './fixtures/analysis-benchmark/swiftApp.js';
import { tsMonorepoFixture } from './fixtures/analysis-benchmark/tsMonorepo.js';
import { tsNodeNextFixture } from './fixtures/analysis-benchmark/tsNodeNext.js';

const roots: string[] = [];
const databases: AlembicDatabaseRuntime[] = [];
afterEach(async () => {
  for (const runtime of databases.splice(0)) {
    runtime.close();
  }
  pathGuard._reset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** 把一组文件写成项目、建好索引，返回关系查询入口。数据库放在项目之外。 */
async function openProject(
  files: Record<string, string>,
  options: { externalEngine?: boolean; index?: boolean } = {}
) {
  const projectRoot = await temporaryRoot('alembic-relations-');
  const dataRoot = await temporaryRoot('alembic-relations-data-');
  await materializeBenchmarkFixture({ files } as AnalysisBenchmarkFixture, projectRoot);
  pathGuard.configure({ projectRoot: dataRoot, knowledgeBaseDir: 'Alembic' });
  const runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  databases.push(runtime);
  const relations = createProjectRelations({
    repository: createAlembicRepositories(runtime.connection).sourceGraphRepository,
  });
  const indexOptions = {
    projectRoot,
    ...(options.externalEngine ? { codeGraph: { dataRoot } } : {}),
  };
  const index = options.index === false ? undefined : await relations.ensureIndex(indexOptions);
  const ask = (request: Omit<ProjectRelationRequest, 'scope'>) =>
    relations.query({ ...request, scope: { projectRoot } });
  return { projectRoot, relations, index, ask, reindex: () => relations.ensureIndex(indexOptions) };
}

/** 关系写成"来源 种类 目标 [链接器 / 分级]"，便于按集合比较。 */
const describeRelations = (data: { relations: ProjectRelationWalkContext['relations'] }) =>
  data.relations
    .map(
      (relation) =>
        `${relation.from?.label} ${relation.kind} ${relation.to?.label} [${relation.resolution?.linker} / ${relation.resolution?.tier}]`
    )
    .sort();
const names = (symbols: { qualifiedName?: string; name: string }[]) =>
  symbols.map((symbol) => symbol.qualifiedName ?? symbol.name);
const paths = (files: { filePath: string }[]) => files.map((file) => file.filePath);

describe('project relations', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  it('TypeScript: answers who calls, what is called, who creates and who imports, across files', async () => {
    const { projectRoot, index, ask } = await openProject(tsNodeNextFixture.files);
    // 带 package.json 的项目照样就绪。
    expect(index).toMatchObject({ available: true, freshness: 'fresh', coverageGaps: 0 });

    // 1. 文件里的声明：与按文件现算的 file-symbols 是同一组符号、同一批引用。
    const listed = await ask({ kind: 'symbols', target: { filePath: 'src/math.ts' } });
    const live = await ProjectContext.execute({
      kind: 'file-symbols',
      scope: { projectRoot },
      payload: { filePath: 'src/math.ts' },
    });
    expect((listed.data as ProjectSymbolListContext).symbols).toEqual(
      (live.data as FileSymbolContext).symbols
    );

    // 3. 谁调用了 add：同文件的方法，以及另一个文件里经直接导入与经 barrel 改名导入的两处。
    const callers = await ask({
      kind: 'callers',
      target: { filePath: 'src/math.ts', symbol: 'add' },
    });
    expect(callers.errors).toBeUndefined();
    const callersData = callers.data as ProjectRelationWalkContext;
    expect(callersData.anchor.symbol?.qualifiedName).toBe('add');
    expect(names(callersData.symbols)).toEqual(['total', 'Calculator.double']);
    expect(describeRelations(callersData)).toEqual([
      'Calculator.double calls add [lexical / certain]',
      'total calls add [import-binding / certain]',
      'total calls add [import-binding / certain]',
    ]);
    // 每条关系都带可复核的引用：发生位置所在的文件、行与内容哈希。
    for (const relation of callersData.relations) {
      expect(relation.ref).toMatchObject({ kind: 'relation-site', level: 'file-flow' });
      expect(relation.ref?.metadata?.hash).toMatch(/^[a-f0-9]{16}$/);
      expect(relation.fromRef?.kind).toBe('file-symbol');
    }

    // 2. total 调用了谁。
    const callees = await ask({ kind: 'callees', target: { symbol: 'total' } });
    expect(names((callees.data as ProjectRelationWalkContext).symbols)).toEqual(['add', 'clamp']);

    // 走两跳：total → add；build → Calculator.create → Calculator（实例化也是调用）。
    const deep = await ask({ kind: 'callees', target: { symbol: 'build' }, depth: 2 });
    const deepData = deep.data as ProjectRelationWalkContext;
    expect(names(deepData.symbols)).toEqual(['Calculator', 'Calculator.create', 'describe']);
    expect(Object.values(deepData.distances).sort()).toEqual([1, 1, 1]);

    // 5. 谁创建了 Calculator 的实例。
    const instantiations = await ask({
      kind: 'instantiations',
      target: { symbol: 'Calculator' },
    });
    expect(names((instantiations.data as ProjectRelationWalkContext).symbols)).toEqual([
      'build',
      'Calculator.create',
    ]);

    // 文件之间：谁导入了 math.ts，app.ts 导入了谁。
    const importers = await ask({ kind: 'importers', target: { filePath: 'src/math.ts' } });
    expect(paths((importers.data as ProjectRelationWalkContext).files)).toEqual([
      'src/app.ts',
      'src/barrel.ts',
    ]);
    const imports = await ask({ kind: 'imports', target: { filePath: 'src/app.ts' } });
    expect(paths((imports.data as ProjectRelationWalkContext).files)).toEqual([
      'src/barrel.ts',
      'src/math.ts',
      'src/util.ts',
    ]);

    // 7. 改了 util.ts 会波及导入它的文件，以及用到它声明的函数；它自己不依赖别人。
    const impact = await ask({ kind: 'impact', changedFiles: ['src/util.ts'] });
    const impactData = impact.data as ProjectImpactContext;
    expect(paths(impactData.changedFiles)).toEqual(['src/util.ts']);
    expect(paths(impactData.impactedFiles)).toEqual(['src/app.ts', 'src/barrel.ts']);
    expect(names(impactData.impactedSymbols)).toEqual(['build', 'total']);
    expect(impactData.truncated).toBe(false);

    // 按名字找声明。
    const search = await ask({ kind: 'search', query: 'Calculator' });
    expect(names((search.data as ProjectSymbolListContext).symbols)).toEqual(
      expect.arrayContaining(['Calculator', 'Calculator.create'])
    );
  });

  it('checks whether a relation ref still matches the current source', async () => {
    const { projectRoot, ask, reindex } = await openProject(tsNodeNextFixture.files);
    const callers = await ask({ kind: 'callers', target: { symbol: 'clamp' } });
    const relation = (callers.data as ProjectRelationWalkContext).relations[0];
    expect(relation.label).toBe('total calls clamp');

    // 8. 引用对象与它的 id 字符串都能复核，并带回发生位置的源码。
    for (const ref of [relation.ref, relation.ref?.id]) {
      const evidence = await ask({ kind: 'evidence', target: { ref }, includeText: true });
      expect(evidence.data).toMatchObject({
        kind: 'evidence',
        current: true,
        indexed: true,
        file: { filePath: 'src/app.ts' },
        text: expect.stringContaining('clamp(result, 0, 100)'),
      });
    }

    // 文件改了：旧引用不再成立，也不给现在那一行的内容。
    const appFile = path.join(projectRoot, 'src/app.ts');
    await fs.writeFile(appFile, `// moved\n${await fs.readFile(appFile, 'utf8')}`);
    const stale = (
      await ask({ kind: 'evidence', target: { ref: relation.ref }, includeText: true })
    ).data as ProjectEvidenceContext;
    expect(stale).toMatchObject({ current: false, indexed: false });
    expect(stale.reason).toContain('changed');
    expect(stale.text).toBeUndefined();

    // 索引追上之后，同一个问题给出新的引用，它是当前的。
    await reindex();
    const refreshed = (await ask({ kind: 'callers', target: { symbol: 'clamp' } }))
      .data as ProjectRelationWalkContext;
    expect(refreshed.relations[0].ref?.id).not.toBe(relation.ref?.id);
    expect(
      (await ask({ kind: 'evidence', target: { ref: refreshed.relations[0].ref } })).data
    ).toMatchObject({ current: true, indexed: true });
  });

  it('reports a missing index, an unknown target and an ambiguous name as explicit errors', async () => {
    const empty = await openProject(tsNodeNextFixture.files, { index: false });
    const unavailable = await empty.ask({ kind: 'callers', target: { symbol: 'add' } });
    expect(unavailable.index).toMatchObject({ available: false, nextAction: 'build_source_graph' });
    expect(unavailable.errors).toEqual([
      expect.objectContaining({ code: 'query-unavailable', retryable: true }),
    ]);
    expect(unavailable.data).toMatchObject({ available: false });

    const { ask } = await openProject({
      'src/a.ts': 'export function run() {}\n',
      'src/b.ts': 'export function run() {}\nexport function only() { run(); }\n',
    });
    expect((await ask({ kind: 'callers', target: { symbol: 'missing' } })).errors).toEqual([
      expect.objectContaining({ code: 'not-found' }),
    ]);
    const ambiguous = await ask({ kind: 'callers', target: { symbol: 'run' } });
    expect(ambiguous.errors).toEqual([expect.objectContaining({ code: 'ambiguous' })]);
    expect(ambiguous.errors?.[0].message).toContain('src/a.ts:1 run');
    // 加上文件就唯一了。
    const narrowed = await ask({
      kind: 'callers',
      target: { symbol: 'run', filePath: 'src/b.ts' },
    });
    expect(names((narrowed.data as ProjectRelationWalkContext).symbols)).toEqual(['only']);
    // 只给位置：取包住这一行的声明。
    const byLine = await ask({ kind: 'callees', target: { filePath: 'src/b.ts', line: 2 } });
    expect((byLine.data as ProjectRelationWalkContext).anchor.symbol?.name).toBe('only');
    expect(names((byLine.data as ProjectRelationWalkContext).symbols)).toEqual(['run']);
    expect((await ask({ kind: 'callers' })).errors).toEqual([
      expect.objectContaining({ code: 'invalid-scope' }),
    ]);
  });

  it('TypeScript and JavaScript: walks the type hierarchy in both directions', async () => {
    const { ask } = await openProject({
      'src/base.ts': 'export interface Port {}\nexport class Base {}\n',
      'src/impl.ts': [
        "import { Base, type Port } from './base.js';",
        'export class Middle extends Base implements Port {}',
        'export class Leaf extends Middle {}',
      ].join('\n'),
      'src/legacy.js': [
        "import { Leaf } from './impl.js';",
        'export class Legacy extends Leaf {}',
        'export function make() { return new Legacy(); }',
      ].join('\n'),
    });

    // 4. 谁继承它、谁实现它；向下走到底。
    const subtypes = await ask({ kind: 'subtypes', target: { symbol: 'Base' }, depth: 4 });
    const data = subtypes.data as ProjectRelationWalkContext;
    expect(names(data.symbols)).toEqual(['Middle', 'Leaf', 'Legacy']);
    expect(describeRelations(data)).toEqual([
      'Leaf extends Middle [heritage / certain]',
      'Legacy extends Leaf [heritage / certain]',
      'Middle extends Base [heritage / certain]',
    ]);
    expect(
      names(
        (
          (await ask({ kind: 'subtypes', target: { symbol: 'Port' } }))
            .data as ProjectRelationWalkContext
        ).symbols
      )
    ).toEqual(['Middle']);
    const supertypes = await ask({ kind: 'supertypes', target: { symbol: 'Legacy' }, depth: 4 });
    expect(names((supertypes.data as ProjectRelationWalkContext).symbols)).toEqual([
      'Leaf',
      'Middle',
      'Base',
      'Port',
    ]);
    // JS 文件里的 new 同样是"谁创建了它"。
    expect(
      names(
        (
          (await ask({ kind: 'instantiations', target: { symbol: 'Legacy' } }))
            .data as ProjectRelationWalkContext
        ).symbols
      )
    ).toEqual(['make']);
  });

  it('aggregates cross-module edges into module dependencies', async () => {
    const { ask } = await openProject(tsMonorepoFixture.files);

    // 6. 模块之间谁依赖谁。模块来自发现层的 workspace 包，依赖来自索引里跨模块的边。
    const result = await ask({ kind: 'module-dependencies' });
    expect(result.errors).toBeUndefined();
    const data = result.data as ProjectModuleDependencyContext;
    const nameOf = new Map(data.modules.map((module) => [module.id, module.name]));
    const describeDependency = (dependency: (typeof data.dependencies)[number]) =>
      `${nameOf.get(dependency.from)} -> ${nameOf.get(dependency.to)} ${JSON.stringify(dependency.counts)} trustedOnly=${dependency.trustedOnly}`;
    expect(data.dependencies.map(describeDependency).sort()).toEqual([
      '@bench/app -> @bench/core {"imports":2,"calls":2} trustedOnly=0',
      '@bench/app -> @bench/tools {"imports":1,"calls":1} trustedOnly=0',
      // 这个包的入口是按目录惯例找回的：依赖成立，但全部只是可信档。
      '@bench/app -> @bench/ui {"imports":1,"calls":1} trustedOnly=2',
    ]);
    // 夹具里有一个文件不属于任何 workspace 成员，它没有归属，如实计数。
    expect(data.unownedFiles).toBe(1);
    // 每一对依赖带几条可以复核的关系。
    const toCore = data.dependencies.find(
      (dependency) => nameOf.get(dependency.to) === '@bench/core'
    );
    expect(toCore?.samples.length).toBeGreaterThan(0);
    expect(toCore?.samples[0].ref?.kind).toBe('relation-site');

    // 只看与一个模块有关的依赖；它被谁依赖也在其中。
    const focused = (await ask({ kind: 'module-dependencies', module: '@bench/ui' }))
      .data as ProjectModuleDependencyContext;
    expect(focused.dependencies.map(describeDependency)).toEqual([
      '@bench/app -> @bench/ui {"imports":1,"calls":1} trustedOnly=2',
    ]);
    expect((await ask({ kind: 'module-dependencies', module: 'nope' })).errors).toEqual([
      expect.objectContaining({ code: 'not-found' }),
    ]);
  });

  it('Swift: cross-file relations come from the external engine and are marked trusted', async () => {
    const { index, ask } = await openProject(swiftAppFixture.files, { externalEngine: true });
    expect(index).toMatchObject({ available: true, externalEngine: 'linked' });

    const callers = (await ask({ kind: 'callers', target: { symbol: 'Repo.load' } }))
      .data as ProjectRelationWalkContext;
    expect(names(callers.symbols)).toEqual(expect.arrayContaining(['Service.greet']));
    expect(callers.relations.every((relation) => relation.resolution?.linker === 'codegraph')).toBe(
      true
    );
    expect(callers.relations.every((relation) => relation.resolution?.tier === 'trusted')).toBe(
      true
    );

    // 同文件的隐式 self 调用是自有链接器的确定档。
    const sameFile = (await ask({ kind: 'callers', target: { symbol: 'Service.transform' } }))
      .data as ProjectRelationWalkContext;
    expect(describeRelations(sameFile)).toContain(
      'Service.greet calls Service.transform [lexical / certain]'
    );

    const conformers = (await ask({ kind: 'subtypes', target: { symbol: 'Greeter' } }))
      .data as ProjectRelationWalkContext;
    expect(names(conformers.symbols)).toEqual(['Service']);
    const created = (await ask({ kind: 'instantiations', target: { symbol: 'Repo' } }))
      .data as ProjectRelationWalkContext;
    expect(names(created.symbols)).toEqual(expect.arrayContaining(['bootstrap', 'Repo.make']));

    // 改了 Repo.swift 会波及用到它的声明所在的文件。
    const impact = (await ask({ kind: 'impact', changedFiles: ['Sources/App/Repo.swift'] }))
      .data as ProjectImpactContext;
    expect(paths(impact.impactedFiles)).toEqual(
      expect.arrayContaining(['Sources/App/Service.swift', 'Sources/App/Counter.swift'])
    );
  }, 60_000);

  it('Objective-C: callers of selectors and protocol conformance across files', async () => {
    const { index, ask } = await openProject(objcAppFixture.files, { externalEngine: true });
    expect(index).toMatchObject({ available: true, externalEngine: 'linked' });

    const callers = (await ask({ kind: 'callers', target: { symbol: 'User.initWithName:age:' } }))
      .data as ProjectRelationWalkContext;
    expect(names(callers.symbols)).toEqual(
      expect.arrayContaining(['User.guestUser', 'UserService.loginWithName:completion:'])
    );
    const conformers = (
      await ask({ kind: 'subtypes', target: { symbol: 'NetworkClientDelegate' } })
    ).data as ProjectRelationWalkContext;
    expect(names(conformers.symbols)).toEqual(['UserService']);
    const importers = (await ask({ kind: 'importers', target: { filePath: 'Models/User.h' } }))
      .data as ProjectRelationWalkContext;
    expect(paths(importers.files)).toEqual(
      expect.arrayContaining(['Models/User.m', 'Services/UserService.m'])
    );
  }, 60_000);
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/core/ast/index.js';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import type { FileFlowContext } from '../src/domain/project-context/index.js';
import { pathGuard } from '../src/io.js';
import { withProjectContextSession } from '../src/project-context.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { SourceGraphIndexer } from '../src/service/source-graph/index.js';
import {
  ANALYSIS_BENCHMARK_FIXTURES,
  type AnalysisBenchmarkFixture,
  type BenchmarkLinkSource,
  materializeBenchmarkFixture,
  type ObservedRelation,
  scoreBenchmarkFixture,
} from './fixtures/analysis-benchmark/index.js';

/**
 * 目标项目分析基准：四种主要语言的小项目，逐条核对"调用点 → 目标声明"。
 *
 * 这里的数字是棘轮，不是愿望：每一格是当前引擎的实际命中数 [命中, 期望总数]。
 * 能力提升时由对应阶段把数字抬高；数字下降或出现禁止的边都算回归。
 * 列含义见 fixtures/analysis-benchmark/types.ts 的 BenchmarkLinkSource。
 *
 * 同一批期望在两个观察面上各算一次：ProjectContext 的 file-flow（按文件现算）与
 * SourceGraph 索引（整个项目入库后的边）。两者共用同一组链接器，只有 convention 一列不同：
 * 按目录惯例找回源码的包入口只进索引（可信档），file-flow 不给。
 */
type Scores = Record<string, Record<BenchmarkLinkSource, [number, number]>>;

const FILE_FLOW_SCORES: Scores = {
  'ts-nodenext': {
    lexical: [2, 2],
    'import-binding': [7, 7],
    convention: [0, 0],
    external: [0, 1],
    future: [0, 1],
  },
  'tsx-bundler': {
    lexical: [0, 0],
    'import-binding': [4, 4],
    convention: [0, 0],
    external: [0, 0],
    future: [0, 0],
  },
  'ts-monorepo': {
    lexical: [0, 0],
    'import-binding': [4, 4],
    convention: [0, 1],
    external: [0, 0],
    future: [0, 0],
  },
  'swift-app': {
    lexical: [5, 5],
    'import-binding': [0, 0],
    convention: [0, 0],
    external: [0, 8],
    future: [0, 2],
  },
  'objc-app': {
    lexical: [0, 0],
    'import-binding': [0, 0],
    convention: [0, 0],
    external: [0, 16],
    future: [0, 0],
  },
};

/** 索引在 file-flow 的基础上多出按惯例找回的包入口。 */
const withConventions = (scores: Scores): Scores =>
  Object.fromEntries(
    Object.entries(scores).map(([name, row]) => [
      name,
      { ...row, convention: [row.convention[1], row.convention[1]] as [number, number] },
    ])
  );

const SOURCE_GRAPH_SCORES = withConventions(FILE_FLOW_SCORES);

/**
 * 同一批期望，索引接入 CodeGraph 之后的分数：自有链接器的各列不变，其余由可信档的外部边贡献。
 * 没命中的两条是有意留在候选档的：`created.run()`（接收者来自工厂方法的返回值）与
 * `[service logout]`（不带参数的选择器，只凭名字唯一不足以采信）。
 */
const EXTERNAL_ENGINE_SCORES: Scores = {
  ...SOURCE_GRAPH_SCORES,
  'ts-nodenext': { ...SOURCE_GRAPH_SCORES['ts-nodenext'], external: [1, 1] },
  'swift-app': { ...SOURCE_GRAPH_SCORES['swift-app'], external: [8, 8], future: [2, 2] },
  'objc-app': { ...SOURCE_GRAPH_SCORES['objc-app'], external: [15, 16] },
};

const roots: string[] = [];
const databases: AlembicDatabaseRuntime[] = [];
afterEach(async () => {
  for (const runtime of databases.splice(0)) {
    runtime.close();
  }
  pathGuard._reset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function materialize(fixture: AnalysisBenchmarkFixture): Promise<string> {
  const projectRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-analysis-benchmark-'))
  );
  roots.push(projectRoot);
  await materializeBenchmarkFixture(fixture, projectRoot);
  return projectRoot;
}

/** 走宿主实际使用的 live ProjectContext；只收已解析且带目标文件的关系。 */
async function observeFileFlowRelations(
  fixture: AnalysisBenchmarkFixture
): Promise<ObservedRelation[]> {
  const projectRoot = await materialize(fixture);
  const observed: ObservedRelation[] = [];
  await withProjectContextSession(async (context) => {
    for (const filePath of Object.keys(fixture.files)) {
      if (filePath.endsWith('.json')) {
        continue;
      }
      const response = await context.execute({
        kind: 'file-flow',
        scope: { projectRoot },
        payload: { filePath },
      });
      // 解析器不支持的文件（如 ObjC 头文件）没有 data；它们只是没有贡献，不是测试错误。
      const flow = response.data as FileFlowContext | undefined;
      for (const relation of flow?.callees ?? []) {
        if (relation.unresolved || !relation.to?.filePath || !relation.to.symbol) {
          continue;
        }
        observed.push({
          kind: 'calls',
          fromFile: filePath,
          line: relation.range?.startLine ?? 0,
          toFile: relation.to.filePath,
          toSymbol: relation.to.symbol,
          toQualifiedName: relation.to.qualifiedName,
        });
      }
    }
  });
  return observed;
}

/**
 * 整个项目建一代索引，取其中连到声明的边。数据库放在项目之外，不进清单。
 * withExternalEngine 打开 CodeGraph 这个外部链接来源；候选档的边不是事实，不计入观察。
 */
async function observeSourceGraphRelations(
  fixture: AnalysisBenchmarkFixture,
  withExternalEngine = false
): Promise<ObservedRelation[]> {
  const projectRoot = await materialize(fixture);
  const dataRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-analysis-benchmark-data-'))
  );
  roots.push(dataRoot);
  pathGuard.configure({ projectRoot: dataRoot, knowledgeBaseDir: 'Alembic' });
  const runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  databases.push(runtime);
  const { sourceGraphRepository } = createAlembicRepositories(runtime.connection);
  const result = await new SourceGraphIndexer(sourceGraphRepository).buildFull({
    projectRoot,
    generationId: `benchmark-${fixture.name}`,
    ...(withExternalEngine ? { codeGraph: { dataRoot } } : {}),
  });
  if (withExternalEngine) {
    expect(result.snapshot.metadata.externalLinker).toMatchObject({ status: 'linked' });
  }
  const symbols = new Map(result.symbols.map((symbol) => [symbol.symbolId, symbol]));
  return result.edges.flatMap((edge) => {
    if ((edge.metadata.resolution as { tier?: string } | undefined)?.tier === 'candidate') {
      return [];
    }
    const target = edge.toSymbolId ? symbols.get(edge.toSymbolId) : undefined;
    const kind =
      edge.kind === 'calls'
        ? ('calls' as const)
        : edge.kind === 'implements' || edge.kind === 'extends'
          ? ('implements' as const)
          : undefined;
    if (!kind || !target || !edge.siteFilePath || !edge.site) {
      return [];
    }
    return [
      {
        kind,
        fromFile: edge.siteFilePath,
        line: edge.site.startLine,
        toFile: target.filePath,
        toSymbol: target.displayName,
        toQualifiedName: target.qualifiedName,
      },
    ];
  });
}

describe('target project analysis benchmark', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  const observers = {
    'file-flow': { observe: observeFileFlowRelations, scores: FILE_FLOW_SCORES },
    'source-graph': { observe: observeSourceGraphRelations, scores: SOURCE_GRAPH_SCORES },
  };

  it.each(
    Object.keys(observers).flatMap((surface) =>
      ANALYSIS_BENCHMARK_FIXTURES.map(
        (fixture) => [fixture.name, surface as keyof typeof observers, fixture] as const
      )
    )
  )('%s keeps its resolved relations and reports no forbidden edge on %s', async (_name, surface, fixture) => {
    const score = scoreBenchmarkFixture(fixture, await observers[surface].observe(fixture));

    // 误报优先于召回：禁止行上出现任何已解析关系都直接失败。
    expect(score.violations).toEqual([]);
    expect(score.found).toEqual(observers[surface].scores[fixture.name]);
  });

  it.each(ANALYSIS_BENCHMARK_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    '%s gains only trusted relations from the external engine',
    async (_name, fixture) => {
      const score = scoreBenchmarkFixture(
        fixture,
        await observeSourceGraphRelations(fixture, true)
      );

      // 外部引擎只能增加命中，不能带来任何禁止的边，也不能让自有链接器的命中变少。
      expect(score.violations).toEqual([]);
      expect(score.found).toEqual(EXTERNAL_ENGINE_SCORES[fixture.name]);
    },
    60_000
  );

  it('declares a score row for every fixture', () => {
    expect(Object.keys(FILE_FLOW_SCORES).sort()).toEqual(
      ANALYSIS_BENCHMARK_FIXTURES.map((fixture) => fixture.name).sort()
    );
  });
});

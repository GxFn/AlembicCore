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
 * 目标项目分析基准：四种主要语言各一个小项目，逐条核对"调用点 → 目标声明"。
 *
 * 这里的数字是棘轮，不是愿望：每一格是当前引擎的实际命中数 [命中, 期望总数]。
 * 能力提升时由对应阶段把数字抬高；数字下降或出现禁止的边都算回归。
 * 列含义见 fixtures/analysis-benchmark/types.ts 的 BenchmarkLinkSource。
 *
 * 同一批期望在两个观察面上各算一次：ProjectContext 的 file-flow（按文件现算）与
 * SourceGraph 索引（整个项目入库后的边）。两者共用同一组链接器，分数必须一致。
 */
const CURRENT_SCORES: Record<string, Record<BenchmarkLinkSource, [number, number]>> = {
  'ts-nodenext': {
    lexical: [2, 2],
    'import-binding': [7, 7],
    external: [0, 1],
    future: [0, 1],
  },
  'tsx-bundler': {
    lexical: [0, 0],
    'import-binding': [3, 3],
    external: [0, 1],
    future: [0, 0],
  },
  'swift-app': {
    lexical: [5, 5],
    'import-binding': [0, 0],
    external: [0, 8],
    future: [0, 2],
  },
  'objc-app': {
    lexical: [0, 0],
    'import-binding': [0, 0],
    external: [0, 16],
    future: [0, 0],
  },
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

/** 整个项目建一代索引，取其中连到声明的边。数据库放在项目之外，不进清单。 */
async function observeSourceGraphRelations(
  fixture: AnalysisBenchmarkFixture
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
  });
  const symbols = new Map(result.symbols.map((symbol) => [symbol.symbolId, symbol]));
  return result.edges.flatMap((edge) => {
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
    'file-flow': observeFileFlowRelations,
    'source-graph': observeSourceGraphRelations,
  };

  it.each(
    Object.keys(observers).flatMap((surface) =>
      ANALYSIS_BENCHMARK_FIXTURES.map(
        (fixture) => [fixture.name, surface as keyof typeof observers, fixture] as const
      )
    )
  )('%s keeps its resolved relations and reports no forbidden edge on %s', async (_name, surface, fixture) => {
    const score = scoreBenchmarkFixture(fixture, await observers[surface](fixture));

    // 误报优先于召回：禁止行上出现任何已解析关系都直接失败。
    expect(score.violations).toEqual([]);
    expect(score.found).toEqual(CURRENT_SCORES[fixture.name]);
  });

  it('declares a score row for every fixture', () => {
    expect(Object.keys(CURRENT_SCORES).sort()).toEqual(
      ANALYSIS_BENCHMARK_FIXTURES.map((fixture) => fixture.name).sort()
    );
  });
});

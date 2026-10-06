/**
 * 决策④(2026-07-11):source_graph 证据进 evidence starters 的 eval 开关注入回归。
 * 锁三条契约:①不传 sourceGraphResult(生产默认)→ 无 sourceGraphInventory starter,
 * 行为零变化;②传入且 symbols>0 且维度是结构/架构/命名类 → 产出计数型 starter;
 * ③无关维度或 symbols=0 → 不产出(不给 AI 空库存提示)。
 */
import { describe, expect, it } from 'vitest';
import type { DimensionDef } from '../../src/types/ProjectSnapshot.js';
import { buildEvidenceStarters } from '../../src/workflows/surfaces/host-agent/briefing/EvidenceStarterBuilder.js';

const ARCHITECTURE_DIM: DimensionDef = {
  id: 'architecture-patterns',
  label: '架构模式',
  guide: '识别项目分层与模块结构',
};

const SOURCE_GRAPH_RESULT = {
  action: 'built-full',
  durableTables: {
    source_graph_files: 180,
    source_graph_symbols: 2285,
    source_graph_edges: 44,
  },
};

describe('buildEvidenceStarters sourceGraphInventory(决策④ eval 开关注入)', () => {
  it.each([
    'partial',
    'degraded',
    'stale',
    'unavailable',
  ])('keeps %s inventory counts from becoming a ready-evidence claim', (status) => {
    const starter = buildEvidenceStarters(ARCHITECTURE_DIM, {
      sourceGraphResult: {
        ...SOURCE_GRAPH_RESULT,
        freshness: { status },
        status: { ready: false },
      },
    })?.sourceGraphInventory;
    expect(starter?.hint).not.toContain('已就绪');
    expect(starter?.data).toMatchObject({
      files: 180,
      symbols: 2285,
      freshness: status,
      ready: false,
    });
  });

  it('marks inventory ready only with explicit fresh and ready evidence', () => {
    const starter = buildEvidenceStarters(ARCHITECTURE_DIM, {
      sourceGraphResult: {
        ...SOURCE_GRAPH_RESULT,
        freshness: { status: 'fresh' },
        status: { ready: true },
      },
    })?.sourceGraphInventory;
    expect(starter?.hint).toContain('已就绪');
    expect(starter?.data).toMatchObject({ freshness: 'fresh', ready: true });
  });
  it('生产默认(不传 sourceGraphResult)不产出 starter,行为零变化', () => {
    const starters = buildEvidenceStarters(ARCHITECTURE_DIM, {});
    expect(starters?.sourceGraphInventory).toBeUndefined();
  });

  it('结构/架构类维度 + 实体计数>0 → 产出计数型 starter(明细留给检索工具)', () => {
    const starters = buildEvidenceStarters(ARCHITECTURE_DIM, {
      sourceGraphResult: SOURCE_GRAPH_RESULT,
    });
    const starter = starters?.sourceGraphInventory;
    expect(starter).toBeDefined();
    expect(starter?.hint).toContain('built-full');
    expect(starter?.data).toStrictEqual({ files: 180, symbols: 2285, edges: 44 });
    expect(starter?.strength).toBeGreaterThan(0);
  });

  it('无关维度(错误处理类)不产出——starter 只路由给结构/架构/命名维度', () => {
    const starters = buildEvidenceStarters(
      { id: 'error-handling', label: '错误处理', guide: '异常捕获与降级路径' },
      { sourceGraphResult: SOURCE_GRAPH_RESULT }
    );
    expect(starters?.sourceGraphInventory).toBeUndefined();
  });

  it('symbols=0(库刚建空/降级)不产出——不给 AI 空库存提示', () => {
    const starters = buildEvidenceStarters(ARCHITECTURE_DIM, {
      sourceGraphResult: {
        action: 'built-full',
        durableTables: { source_graph_files: 0, source_graph_symbols: 0, source_graph_edges: 0 },
      },
    });
    expect(starters?.sourceGraphInventory).toBeUndefined();
  });
});

describe('buildEvidenceStarters 全景与依赖图', () => {
  const dim: DimensionDef = { id: 'architecture', label: 'Architecture', guide: 'boundaries' };

  it('reads coupling hotspots and cycles from the normalized ProjectContext panorama', () => {
    const starters = buildEvidenceStarters(dim, {
      panoramaResult: {
        couplingHotspots: [
          { module: 'Networking', fanIn: 11, fanOut: 3 },
          { module: 'Leaf', fanIn: 1, fanOut: 0 },
        ],
        cyclicDependencies: [{ cycle: ['A', 'B'], severity: 'A <-> B' }],
      },
    });

    // 进或出达到 5 的模块才算高耦合。
    expect(starters?.couplingHotspots?.data).toEqual(['Networking (fanIn=11, fanOut=3)']);
    expect(starters?.cyclicDependencies?.data).toEqual([{ cycle: 'A → B', severity: 'A <-> B' }]);
  });

  it('still reads the legacy panorama shape (module map and cycles)', () => {
    const starters = buildEvidenceStarters(dim, {
      panoramaResult: {
        modules: new Map([['core', { name: 'core', fanIn: 7, fanOut: 0 }]]),
        cycles: [{ cycle: ['core', 'ui'], severity: 'warning' }],
      },
    });

    expect(starters?.couplingHotspots?.data).toEqual(['core (fanIn=7, fanOut=0)']);
    expect(starters?.cyclicDependencies?.data).toEqual([
      { cycle: 'core → ui', severity: 'warning' },
    ]);
  });

  it('ranks the dependency overview by how many modules depend on each node', () => {
    const starters = buildEvidenceStarters(dim, {
      depGraphData: {
        nodes: [{ id: 'app', label: 'App' }, { id: 'ui', label: 'UI' }, 'core'],
        edges: [
          { from: 'app', to: 'ui', type: 'imports' },
          { from: 'app', to: 'core', type: 'imports' },
          // 同一对模块的第二种关系不让 core 多一个依赖方。
          { from: 'app', to: 'core', type: 'calls' },
          { from: 'ui', to: 'core', type: 'imports' },
        ],
      },
    });

    expect(starters?.dependencyOverview?.data).toEqual({
      totalModules: 3,
      totalEdges: 4,
      topModules: ['core', 'UI', 'App'],
    });
  });

  it('keeps the declared node order when the graph has no edges', () => {
    const starters = buildEvidenceStarters(dim, {
      depGraphData: { nodes: ['b', 'a'], edges: [] },
    });

    expect(starters?.dependencyOverview?.data).toMatchObject({ topModules: ['b', 'a'] });
  });
});

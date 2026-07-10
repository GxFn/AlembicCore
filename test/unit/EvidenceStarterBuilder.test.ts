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

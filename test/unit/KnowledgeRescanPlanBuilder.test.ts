/**
 * KnowledgeRescanPlanBuilder — U1 per-cell gap + D2 tier 默认表
 *
 * 覆盖：#1 双路（moduleBindings→per-cell gap/createBudget；不传→cellPlans undefined、per-dimension 不变）、
 * #2 perCellTarget 优先级 binding.targetRecipes ?? D2[tier]（S5/M3/L2 + env + guard，tier 由 modules.length）、
 * #4 floor 正交（per-cell 不污染 per-dimension 覆盖账本）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeRescanPlan,
  resolveModuleTier,
  resolvePerCellTargetDefault,
} from '../../src/workflows/capabilities/planning/knowledge/KnowledgeRescanPlanBuilder.js';

// 单测最小输入，仅驱动 per-cell 路径（auditSummary/dimensions 空桩；返回放宽以便直读 cellPlans）。
function plan(opts: Record<string, unknown>): any {
  return buildKnowledgeRescanPlan({
    recipeEntries: [],
    auditSummary: { results: [] },
    dimensions: [],
    ...opts,
  } as unknown as Parameters<typeof buildKnowledgeRescanPlan>[0]);
}

describe('KnowledgeRescanPlanBuilder — U1 per-cell gap + D2 tier', () => {
  it('U1 #1 双路：moduleBindings 提供 → per-cell gap/createBudget；不提供 → cellPlans undefined（per-dimension 不变）', () => {
    // A: moduleA×dimX target=3 / coverage=1 → gap=2；B: moduleB×dimY target=2 / coverage=2 → gap=0（满）
    const withBindings = plan({
      moduleBindings: [
        { moduleId: 'A', dimensionId: 'dimX', perCellCoverage: 1, targetRecipes: 3 },
        { moduleId: 'B', dimensionId: 'dimY', perCellCoverage: 2, targetRecipes: 2 },
      ],
    });
    expect(withBindings.cellPlans).toBeDefined();
    const cellA = withBindings.cellPlans.find((c: { moduleId: string }) => c.moduleId === 'A');
    const cellB = withBindings.cellPlans.find((c: { moduleId: string }) => c.moduleId === 'B');
    expect(cellA).toMatchObject({ perCellTarget: 3, perCellCoverage: 1, gap: 2, createBudget: 2 });
    expect(cellB).toMatchObject({ perCellTarget: 2, perCellCoverage: 2, gap: 0, createBudget: 0 });

    // 不传 moduleBindings → cellPlans undefined（旁路保护 deepMining，per-dimension 路径不变）
    const withoutBindings = plan({});
    expect(withoutBindings.cellPlans).toBeUndefined();
    expect(withoutBindings.targetPerDimension).toBe(5);
  });

  it('U1 #2 perCellTarget 优先级：binding.targetRecipes ?? D2[tier]（缺省回退 S5/M3/L2，tier 由 moduleCount）', () => {
    const cell = (moduleCount: number, targetRecipes?: number) =>
      plan({
        moduleCount,
        moduleBindings: [{ moduleId: 'A', dimensionId: 'd', perCellCoverage: 0, targetRecipes }],
      }).cellPlans[0].perCellTarget;

    expect(cell(1)).toBe(5); // S
    expect(cell(8)).toBe(3); // M
    expect(cell(20)).toBe(2); // L
    expect(cell(20, 7)).toBe(7); // 显式 targetRecipes 优先于 D2[tier]
  });

  it('U1 #2 tier resolver + D2 默认值直测', () => {
    expect(resolveModuleTier(3)).toBe('S');
    expect(resolveModuleTier(4)).toBe('M');
    expect(resolveModuleTier(12)).toBe('M');
    expect(resolveModuleTier(13)).toBe('L');
    expect(resolvePerCellTargetDefault('S')).toBe(5);
    expect(resolvePerCellTargetDefault('M')).toBe(3);
    expect(resolvePerCellTargetDefault('L')).toBe(2);
  });

  it('U1 #2 env 覆盖 + guard (ALEMBIC_PER_CELL_TARGET_S)', () => {
    const prev = process.env.ALEMBIC_PER_CELL_TARGET_S;
    try {
      process.env.ALEMBIC_PER_CELL_TARGET_S = '9';
      expect(resolvePerCellTargetDefault('S')).toBe(9); // env 覆盖
      process.env.ALEMBIC_PER_CELL_TARGET_S = '0';
      expect(resolvePerCellTargetDefault('S')).toBe(5); // guard <1 → 回退默认
      process.env.ALEMBIC_PER_CELL_TARGET_S = 'abc';
      expect(resolvePerCellTargetDefault('S')).toBe(5); // 非有限 → 回退
    } finally {
      if (prev === undefined) {
        delete process.env.ALEMBIC_PER_CELL_TARGET_S;
      } else {
        process.env.ALEMBIC_PER_CELL_TARGET_S = prev;
      }
    }
  });

  it('U1 #4 floor 正交：moduleCount 缺省回退去重模块数；per-cell 不写 per-dimension 覆盖账本', () => {
    // moduleCount 缺省 → 用 moduleBindings 去重模块数（A、B = 2 → S=5）
    const p = plan({
      moduleBindings: [
        { moduleId: 'A', dimensionId: 'd1', perCellCoverage: 0 },
        { moduleId: 'B', dimensionId: 'd2', perCellCoverage: 0 },
      ],
    });
    expect(p.cellPlans.every((c: { perCellTarget: number }) => c.perCellTarget === 5)).toBe(true);
    // per-cell gap 不写 per-dimension 覆盖账本（coverageByDimension 不受 moduleBindings 影响）
    expect(p.coverageByDimension).toEqual({});
  });
});

describe('KnowledgeRescanPlanBuilder — U2b gap 消费 Agent 目标 + 账本优先', () => {
  const dimGap = (opts: Record<string, unknown>) =>
    plan({ dimensions: [{ id: 'dimX' }], ...opts }).dimensionPlans.find(
      (d: { dimension: { id: string } }) => d.dimension.id === 'dimX'
    );

  it('U2b #4 perDimensionTargets 真实驱动 gap（非硬编码 5）；缺省回退 TARGET_RECIPES_PER_DIMENSION=5', () => {
    // 空 recipeEntries → coverageByDimension['dimX']=0
    expect(dimGap({}).gap).toBe(5); // 默认 fallback 5
    expect(dimGap({ perDimensionTargets: { dimX: 8 } }).gap).toBe(8); // Agent 目标驱动，非 5
    expect(dimGap({ perDimensionTargets: { dimX: 0 } }).gap).toBe(0); // 目标 0 → gap 0（证非硬 5）
  });

  it('U2b #4 existingCount 优先读账本（ledgerCoverageByDimension），无账本回退现算', () => {
    // 账本提供 existingCount=10 → gap=max(0,5-10)=0（覆盖现算的 0）
    const withLedger = dimGap({ ledgerCoverageByDimension: { dimX: 10 } });
    expect(withLedger.existingCount).toBe(10);
    expect(withLedger.gap).toBe(0);
    // 无账本 → 回退现算 coverageByDimension（空 → 0）
    expect(dimGap({}).existingCount).toBe(0);
    // 账本 + Agent 目标组合：existing=3, target=8 → gap=5
    const combined = dimGap({
      perDimensionTargets: { dimX: 8 },
      ledgerCoverageByDimension: { dimX: 3 },
    });
    expect(combined).toMatchObject({ existingCount: 3, gap: 5 });
  });
});

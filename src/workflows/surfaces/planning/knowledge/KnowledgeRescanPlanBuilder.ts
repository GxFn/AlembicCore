import { recipeBelongsToDimension } from '../../../../domain/dimension/RecipeDimension.js';
import type { DimensionDef } from '../../../../types/ProjectSnapshot.js';
import type {
  KnowledgeRescanExecutionDecision,
  RecipeSnapshotEntry,
  RescanExecutionMode,
  RescanExecutionReason,
} from '../../../../types/planningViews.js';

// W4 批A(T3):Rescan 执行决策纯数据类型本体下收 types/planningViews;re-export 保表面。
export type {
  KnowledgeRescanExecutionDecision,
  RescanExecutionMode,
  RescanExecutionReason,
  RescanExecutionReasonKind,
} from '../../../../types/planningViews.js';

import type { RelevanceAuditResult, RelevanceAuditSummary } from './KnowledgeRescanPlanner.js';

export const TARGET_RECIPES_PER_DIMENSION = 5;

/**
 * U1 / D2 通用默认表（CG-2）：perCellTarget 规模自适应回退默认（per-(模块×维度) cell 目标 recipe 数）。
 * per-cell ≠ legacy per-dimension：单模块项目 per-cell≈per-dim，故 S 取 5 是「不传 moduleBindings 零回归」锚点；
 * 网格细化后降档防总预算爆炸（M=3 / L=2，L 首扫取代表性 2、deepMining 多轮填至覆盖）。
 * 优先级一律 `binding.targetRecipes ?? D2[tier]`（plan 显式值优先，本表只回退，不绕过 plan）。
 */
const D2_PER_CELL_TARGET_DEFAULT = { S: 5, M: 3, L: 2 } as const;

export type ModuleTier = 'S' | 'M' | 'L';

/** tier 主信号 = canonical ProjectMap.modules.length（S ≤3 / M 4-12 / L ≥13）。 */
export function resolveModuleTier(moduleCount: number): ModuleTier {
  if (moduleCount <= 3) {
    return 'S';
  }
  if (moduleCount <= 12) {
    return 'M';
  }
  return 'L';
}

/**
 * perCellTarget 回退默认：默认常量 + env 覆盖 + guard（仿 staging-access-sweep cap 形态）。
 * env `ALEMBIC_PER_CELL_TARGET_{S|M|L}` 覆盖；非有限 / <1 → 回退默认（guard）。
 */
export function resolvePerCellTargetDefault(tier: ModuleTier): number {
  const fallback = D2_PER_CELL_TARGET_DEFAULT[tier];
  const raw = Number(process.env[`ALEMBIC_PER_CELL_TARGET_${tier}`]);
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback;
  }
  return Math.floor(raw);
}

/**
 * U1 #3：moduleMining per-(模块×维度) cell 绑定。caller（U1-Plugin/U2a）提供 perCellCoverage 快照；
 * 本阶段 Core 不在 buildCoverageByDimension 升 per-cell 覆盖统计（=U2a），只把模块轴接进 gap 计算签名。
 */
export interface ModuleCellBinding {
  moduleId?: string;
  moduleName?: string;
  dimensionId: string;
  /** 该 cell 当前已覆盖 recipe 数（caller 提供；缺省 0）。 */
  perCellCoverage?: number;
  /** plan 显式 per-cell 目标。A.U1：运行时不保证非空（normalizePlanSelection 只校验 dimensions）→ 必 `?? D2[tier]`。 */
  targetRecipes?: number;
}

/** U1 #3：per-cell 计划（gap/createBudget per 模块×维度）。 */
export interface ModuleCellPlan {
  moduleId?: string;
  moduleName?: string;
  dimensionId: string;
  perCellTarget: number;
  perCellCoverage: number;
  gap: number;
  createBudget: number;
}

export type AuditVerdict = RelevanceAuditResult['verdict'];

export interface KnowledgeRescanDimensionPlan {
  dimension: DimensionDef;
  existingCount: number;
  gap: number;
  existingRecipes: RecipeSnapshotEntry[];
  decayingRecipes: RecipeSnapshotEntry[];
  executionReasons: RescanExecutionReason[];
  execution: KnowledgeRescanExecutionDecision;
  shouldExecute: boolean;
}

export interface KnowledgeRescanPlan {
  recipeEntries: RecipeSnapshotEntry[];
  auditSummary: RelevanceAuditSummary;
  auditVerdictMap: Map<string, AuditVerdict>;
  targetPerDimension: number;
  requestedDimensionIds?: string[];
  requestedDimensions: DimensionDef[];
  skippedByRequestDimensions: DimensionDef[];
  dimensionPlans: KnowledgeRescanDimensionPlan[];
  executionDecisions: KnowledgeRescanExecutionDecision[];
  executionDimensions: DimensionDef[];
  produceDimensions: DimensionDef[];
  gapDimensions: DimensionDef[];
  skippedDimensions: DimensionDef[];
  coverageByDimension: Record<string, number>;
  executionReasons: Record<string, RescanExecutionReason[]>;
  occupiedTriggers: string[];
  decayingRecipeIds: string[];
  /** U1 #3：moduleBindings 提供时的 per-cell 计划（gap/createBudget per 模块×维度）；未提供为 undefined。 */
  cellPlans?: ModuleCellPlan[];
}

export interface BuildKnowledgeRescanPlanOptions {
  recipeEntries: RecipeSnapshotEntry[];
  auditSummary: RelevanceAuditSummary;
  dimensions: DimensionDef[];
  requestedDimensionIds?: string[];
  targetPerDimension?: number;
  fileDiff?: {
    affectedDimensionIds?: string[];
    changedFiles?: string[];
  } | null;
  /** U1 #3：仅当提供时启用 per-cell gap；未提供 → 逐字段退回 per-dimension（deepMining 零回归）。 */
  moduleBindings?: ModuleCellBinding[];
  /** U1/D2：canonical ProjectMap.modules.length，用于 perCellTarget tier 回退（缺省=本批 moduleBindings 去重模块数）。 */
  moduleCount?: number;
  /** U2b：Agent confirm 的 per-dimension 目标（优先于 targetPerDimension；缺省→回退 targetPerDimension）。 */
  perDimensionTargets?: Record<string, number>;
  /** U2b：覆盖账本提供的 per-dimension existingCount（优先于现算 buildCoverageByDimension；缺省→回退现算）。 */
  ledgerCoverageByDimension?: Record<string, number>;
}

export function buildKnowledgeRescanPlan({
  recipeEntries,
  auditSummary,
  dimensions,
  requestedDimensionIds,
  targetPerDimension = TARGET_RECIPES_PER_DIMENSION,
  fileDiff,
  moduleBindings,
  moduleCount,
  perDimensionTargets,
  ledgerCoverageByDimension,
}: BuildKnowledgeRescanPlanOptions): KnowledgeRescanPlan {
  const requestedIds = requestedDimensionIds?.length ? new Set(requestedDimensionIds) : null;
  const requestedDimensions = requestedIds
    ? dimensions.filter((dimension) => requestedIds.has(dimension.id))
    : [...dimensions];
  const skippedByRequestDimensions = requestedIds
    ? dimensions.filter((dimension) => !requestedIds.has(dimension.id))
    : [];

  const auditVerdictMap = new Map(
    auditSummary.results.map((result) => [result.recipeId, result.verdict])
  );
  const auditResultByRecipeId = new Map(
    auditSummary.results.map((result) => [result.recipeId, result])
  );
  const knownDimensionIds = dimensions.map((dimension) => dimension.id);
  const coverageByDimension = buildCoverageByDimension({
    recipeEntries,
    auditVerdictMap,
    dimensions,
    knownDimensionIds,
  });
  const affectedDimensionIds = new Set(fileDiff?.affectedDimensionIds ?? []);
  const changedFiles = fileDiff?.changedFiles ?? [];
  const dimensionPlans = requestedDimensions.map((dimension) => {
    const existingRecipes = recipeEntries.filter((entry) =>
      recipeBelongsToDimension(entry, dimension, { knownDimensionIds })
    );
    const decayingRecipes = existingRecipes.filter((entry) =>
      isRecipeDecaying(entry, auditResultByRecipeId.get(entry.id), auditVerdictMap.get(entry.id))
    );
    // U2b：existingCount 优先读覆盖账本（ledgerCoverageByDimension），无账本回退现算 buildCoverageByDimension。
    const existingCount =
      ledgerCoverageByDimension?.[dimension.id] ?? (coverageByDimension[dimension.id] || 0);
    // U2b：per-dimension 目标优先 Agent confirm（perDimensionTargets），否则回退 targetPerDimension
    //（TARGET_RECIPES_PER_DIMENSION=5 仅作最终 fallback，deepMining 正常路径不再被硬 5 锁死）。
    const dimensionTarget = perDimensionTargets?.[dimension.id] ?? targetPerDimension;
    const gap = Math.max(0, dimensionTarget - existingCount);
    const executionReasons = buildDimensionExecutionReasons({
      dimension,
      requestedIds,
      affectedDimensionIds,
      changedFiles,
      decayingRecipes,
      existingCount,
      targetPerDimension: dimensionTarget,
      gap,
    });
    const execution = buildKnowledgeRescanExecutionDecision({
      dimension,
      existingCount,
      gap,
      existingRecipes,
      decayingRecipes,
      executionReasons,
    });

    return {
      dimension,
      existingCount,
      gap,
      existingRecipes,
      decayingRecipes,
      executionReasons,
      execution,
      shouldExecute: execution.shouldExecute,
    };
  });

  const executionDecisions = dimensionPlans.map((dimensionPlan) => dimensionPlan.execution);
  const gapDimensions = dimensionPlans
    .filter((dimensionPlan) => dimensionPlan.gap > 0)
    .map((dimensionPlan) => dimensionPlan.dimension);
  const executionDimensions = dimensionPlans
    .filter((dimensionPlan) => dimensionPlan.shouldExecute)
    .map((dimensionPlan) => dimensionPlan.dimension);
  const produceDimensions = dimensionPlans
    .filter((dimensionPlan) => dimensionPlan.execution.mode === 'produce')
    .map((dimensionPlan) => dimensionPlan.dimension);
  const skippedDimensions = dimensionPlans
    .filter((dimensionPlan) => !dimensionPlan.shouldExecute)
    .map((dimensionPlan) => dimensionPlan.dimension);
  const executionReasons = Object.fromEntries(
    dimensionPlans.map((dimensionPlan) => [
      dimensionPlan.dimension.id,
      dimensionPlan.executionReasons,
    ])
  );
  const occupiedTriggers = recipeEntries.map((entry) => entry.trigger).filter(Boolean);
  const decayingRecipeIds = dimensionPlans.flatMap((dimensionPlan) =>
    dimensionPlan.decayingRecipes.map((recipe) => recipe.id)
  );
  // U1 #3：仅当提供 moduleBindings 时产出 per-cell 计划（旁路，不污染上面的 per-dimension 路径）。
  const cellPlans =
    moduleBindings && moduleBindings.length > 0
      ? buildModuleCellPlans(moduleBindings, moduleCount)
      : undefined;

  return {
    recipeEntries,
    auditSummary,
    auditVerdictMap,
    targetPerDimension,
    requestedDimensionIds,
    requestedDimensions,
    skippedByRequestDimensions,
    dimensionPlans,
    executionDecisions,
    executionDimensions,
    produceDimensions,
    gapDimensions,
    skippedDimensions,
    coverageByDimension,
    executionReasons,
    occupiedTriggers,
    decayingRecipeIds,
    cellPlans,
  };
}

/**
 * U1 #3：把 moduleBindings 接进 gap 计算 —— per-cell gap = max(0, perCellTarget − perCellCoverage)，createBudget=gap。
 * perCellTarget 优先级 binding.targetRecipes ?? D2[tier]（tier 主信号 = modules.length，缺省回退本批去重模块数）。
 * 本阶段不读 per-cell 覆盖统计（caller 提供 perCellCoverage；覆盖账本 per-cell 升级=U2a）；与维护游标坐标系（D3）严格分坐标。
 * floor 正交：per-cell gap 不判维度 "covered"（per-维度 floor 由 critic/U2a 判）。
 */
function buildModuleCellPlans(
  moduleBindings: ModuleCellBinding[],
  moduleCount?: number
): ModuleCellPlan[] {
  const resolvedModuleCount =
    moduleCount ??
    new Set(moduleBindings.map((binding) => binding.moduleId ?? binding.moduleName ?? '')).size;
  const tier = resolveModuleTier(resolvedModuleCount);
  const defaultTarget = resolvePerCellTargetDefault(tier);
  return moduleBindings.map((binding) => {
    const perCellTarget = binding.targetRecipes ?? defaultTarget;
    const perCellCoverage = binding.perCellCoverage ?? 0;
    const gap = Math.max(0, perCellTarget - perCellCoverage);
    return {
      moduleId: binding.moduleId,
      moduleName: binding.moduleName,
      dimensionId: binding.dimensionId,
      perCellTarget,
      perCellCoverage,
      gap,
      createBudget: gap,
    };
  });
}

function buildKnowledgeRescanExecutionDecision({
  dimension,
  existingCount,
  gap,
  existingRecipes,
  decayingRecipes,
  executionReasons,
}: {
  dimension: DimensionDef;
  existingCount: number;
  gap: number;
  existingRecipes: RecipeSnapshotEntry[];
  decayingRecipes: RecipeSnapshotEntry[];
  executionReasons: RescanExecutionReason[];
}): KnowledgeRescanExecutionDecision {
  const requiresVerification = executionReasons.some(
    (reason) => reason.kind === 'recipe-decay' || reason.kind === 'file-change'
  );
  const mode: RescanExecutionMode =
    gap > 0 ? 'produce' : requiresVerification ? 'verify-only' : 'skip';
  return {
    dimensionId: dimension.id,
    dimension,
    mode,
    createBudget: mode === 'produce' ? gap : 0,
    existingCount,
    gap,
    existingRecipes,
    decayingRecipes,
    reasons: executionReasons,
    shouldExecute: mode !== 'skip',
  };
}

function buildCoverageByDimension({
  recipeEntries,
  auditVerdictMap,
  dimensions,
  knownDimensionIds,
}: {
  recipeEntries: RecipeSnapshotEntry[];
  auditVerdictMap: Map<string, AuditVerdict>;
  dimensions: DimensionDef[];
  knownDimensionIds: readonly string[];
}): Record<string, number> {
  const coverageByDimension: Record<string, number> = {};
  for (const dimension of dimensions) {
    for (const entry of recipeEntries) {
      if (!recipeBelongsToDimension(entry, dimension, { knownDimensionIds })) {
        continue;
      }
      const isConfirmed = entry.lifecycle === 'active' || entry.lifecycle === 'evolving';
      const verdict = auditVerdictMap.get(entry.id);
      const isHealthyStaging =
        entry.lifecycle === 'staging' && (!verdict || verdict === 'healthy' || verdict === 'watch');

      if (isConfirmed || isHealthyStaging) {
        coverageByDimension[dimension.id] = (coverageByDimension[dimension.id] || 0) + 1;
      }
    }
  }

  return coverageByDimension;
}

function buildDimensionExecutionReasons({
  dimension,
  requestedIds,
  affectedDimensionIds,
  changedFiles,
  decayingRecipes,
  existingCount,
  targetPerDimension,
  gap,
}: {
  dimension: DimensionDef;
  requestedIds: Set<string> | null;
  affectedDimensionIds: Set<string>;
  changedFiles: string[];
  decayingRecipes: RecipeSnapshotEntry[];
  existingCount: number;
  targetPerDimension: number;
  gap: number;
}): RescanExecutionReason[] {
  const reasons: RescanExecutionReason[] = [];
  if (requestedIds?.has(dimension.id)) {
    reasons.push({ kind: 'manual-request', detail: 'Dimension explicitly requested by caller' });
  }
  if (affectedDimensionIds.has(dimension.id)) {
    reasons.push({ kind: 'file-change', changedFiles });
  }
  if (decayingRecipes.length > 0) {
    reasons.push({
      kind: 'recipe-decay',
      recipeIds: decayingRecipes.map((recipe) => recipe.id),
      detail: `${decayingRecipes.length} recipes require verification or evolution`,
    });
  }
  if (gap > 0) {
    reasons.push({
      kind: 'coverage-gap',
      existing: existingCount,
      target: targetPerDimension,
      gap,
    });
  }
  if (reasons.length === 0 || reasons.every((reason) => reason.kind === 'manual-request')) {
    reasons.push({
      kind: 'fully-covered',
      existing: existingCount,
      target: targetPerDimension,
    });
  }
  return reasons;
}

function isRecipeDecaying(
  entry: RecipeSnapshotEntry,
  auditResult: RelevanceAuditResult | undefined,
  verdict: AuditVerdict | undefined
): boolean {
  return (
    entry.lifecycle === 'decaying' ||
    verdict === 'decay' ||
    verdict === 'severe' ||
    auditResult?.verdict === 'decay' ||
    auditResult?.verdict === 'severe'
  );
}

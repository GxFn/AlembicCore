/**
 * CoverageLedgerAdvisor — deepMining 多轮停止/收敛建议（U2d，纯函数读账本）。
 *
 * 只读 coverage_ledger（cells）+ deep_mining_rounds（最近一轮边际产出），输出三类停止判定与价值排序缺口：
 *   ① 收敛       = 无 blank/thin 格 或 全 exhausted-with-reason（Agent 已声明尽力）。
 *   ② 收益递减   = 上一轮 new_recipes_this_round < K。
 *   ③ 轮次上限   = last_round ≥ maxRounds（安全闸，非目标）。
 * 否则 continue，给「还有 N 个高价值空白，建议再扫一轮」。
 *
 * K/maxRounds 优先级 = **plan 显式值 ?? D2[tier]**（仿 resolvePerCellTargetDefault 的 const+env+guard）；
 * tier 由 canonical `ProjectMap.modules.length` 经 resolveModuleTier 解析（D1 唯一规模轴，不另造来源）。
 *
 * **建议非自动调度**：是否再发一轮由用户/宿主决定（沿用 advisory 不阻断、不自动后台扫）。
 */

import { DIMENSION_REGISTRY } from '../../../domain/dimension/DimensionRegistry.js';
import type { UnifiedDimension } from '../../../domain/dimension/UnifiedDimension.js';
import type {
  CoverageGrade,
  CoverageLedgerRecord,
  DeepMiningRoundRecord,
} from '../../../repository/coverage/CoverageLedgerRepository.js';
import {
  type ModuleTier,
  resolveModuleTier,
} from '../planning/knowledge/KnowledgeRescanPlanBuilder.js';

// D2 通用默认表（plan 值 ?? D2[tier]）；env 覆盖 + guard，与 U1 perCellTarget 同形态。
const D2_DEEP_MINING_K_DEFAULT = { S: 1, M: 2, L: 3 } as const;
const D2_DEEP_MINING_MAX_ROUNDS_DEFAULT = { S: 2, M: 3, L: 5 } as const;

/** D2：单轮边际产出地板 K（new_recipes_this_round < K 即收益递减）。 */
export function resolveDeepMiningK(tier: ModuleTier): number {
  const fallback = D2_DEEP_MINING_K_DEFAULT[tier];
  const raw = Number(process.env[`ALEMBIC_DEEP_MINING_K_${tier}`]);
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback;
  }
  return Math.floor(raw);
}

/** D2：deepMining 轮次硬上限 maxRounds（安全闸）。 */
export function resolveDeepMiningMaxRounds(tier: ModuleTier): number {
  const fallback = D2_DEEP_MINING_MAX_ROUNDS_DEFAULT[tier];
  const raw = Number(process.env[`ALEMBIC_DEEP_MINING_MAX_ROUNDS_${tier}`]);
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback;
  }
  return Math.floor(raw);
}

export type DeepMiningStopReason = 'converged' | 'diminishing-returns' | 'round-cap' | 'continue';

export interface CoverageLedgerAdvisorInput {
  /** 当前账本 cells（CoverageLedgerRepository.listByProjectRoot）。 */
  cells: readonly CoverageLedgerRecord[];
  /** 最近一轮（用于收益递减/轮次上限）；缺省/null → 视为尚无完成轮次。 */
  latestRound?: DeepMiningRoundRecord | null;
  /** canonical ProjectMap.modules.length，定 D2 tier。 */
  moduleCount: number;
  /** plan 显式 K（优先于 D2[tier]）。 */
  planK?: number;
  /** plan 显式 maxRounds（优先于 D2[tier]）。 */
  planMaxRounds?: number;
  /** 「高价值」空白阈值（value_score ≥ 此值）；缺省 0.5。 */
  highValueThreshold?: number;
}

export interface CoverageGap {
  moduleId: string;
  dimensionId: string;
  grade: Extract<CoverageGrade, 'empty' | 'thin'>;
  valueScore: number;
}

export interface CoverageLedgerAdvisorResult {
  shouldStop: boolean;
  stopReason: DeepMiningStopReason;
  highValueBlankCount: number;
  /** 价值排序（高→低）的空白/单薄缺口（已排除 exhausted-with-reason 格）。 */
  valueSortedGaps: CoverageGap[];
  /** 「还有 N 个高价值空白，建议再扫一轮」（仅 continue 时非空）。 */
  suggestion: string | null;
  tier: ModuleTier;
  k: number;
  maxRounds: number;
}

export type CoverageLedgerPanoramaHealthStatus = 'strong' | 'adequate' | 'weak' | 'missing';

export type CoverageLedgerPanoramaGapStatus = 'missing' | 'weak';

export type CoverageLedgerPanoramaGapPriority = 'high' | 'medium' | 'low';

export interface CoverageLedgerPanoramaModuleRole {
  moduleId: string;
  roles: readonly string[];
}

export interface CoverageLedgerPanoramaRollupInput {
  /** Current coverage_ledger cells for one project/controlRoot aggregation. */
  cells: readonly CoverageLedgerRecord[];
  /** Defaults to DimensionRegistry; tests and callers may pass an active subset. */
  dimensions?: readonly UnifiedDimension[];
  /**
   * Optional roles already normalized to the coverage-ledger module axis.
   * Callers own any ProjectMap→coverage axis normalization; this function never
   * claims raw ProjectMap.module.id can directly join ledger moduleId.
   */
  moduleRoles?: readonly CoverageLedgerPanoramaModuleRole[];
}

export interface CoverageLedgerPanoramaDimensionCoverage {
  id: string;
  label: string;
  weight: number;
  status: CoverageLedgerPanoramaHealthStatus;
  score: number;
  coverageRatio: number;
  cellCount: number;
  coveredCandidateCount: number;
  totalCandidateCount: number;
  coveredCellCount: number;
  partialCellCount: number;
  weakCellCount: number;
  missingCellCount: number;
}

export interface CoverageLedgerPanoramaHealthRadarDimension {
  id: string;
  label: string;
  weight: number;
  status: CoverageLedgerPanoramaHealthStatus;
  score: number;
}

export interface CoverageLedgerPanoramaHealthRadar {
  basis: 'coverage-ledger-rollup';
  score: number;
  dimensions: CoverageLedgerPanoramaHealthRadarDimension[];
}

export interface CoverageLedgerPanoramaGap {
  dimensionId: string;
  dimensionName: string;
  status: CoverageLedgerPanoramaGapStatus;
  priority: CoverageLedgerPanoramaGapPriority;
  weight: number;
  suggestedTopics: readonly string[];
  relatedRoles: readonly string[];
  affectedRoles: readonly string[];
  affectedModuleIds: readonly string[];
  missingCellCount: number;
  weakCellCount: number;
  valueScore: number;
}

export interface CoverageLedgerPanoramaRollup {
  basis: 'coverage-ledger-rollup';
  directModuleIdAligned: false;
  dimensionCoverage: CoverageLedgerPanoramaDimensionCoverage[];
  healthRadar: CoverageLedgerPanoramaHealthRadar;
  gaps: CoverageLedgerPanoramaGap[];
}

const DEFAULT_HIGH_VALUE_THRESHOLD = 0.5;

export function adviseCoverageLedger(
  input: CoverageLedgerAdvisorInput
): CoverageLedgerAdvisorResult {
  const tier = resolveModuleTier(input.moduleCount);
  const k = input.planK ?? resolveDeepMiningK(tier);
  const maxRounds = input.planMaxRounds ?? resolveDeepMiningMaxRounds(tier);
  const highValueThreshold = input.highValueThreshold ?? DEFAULT_HIGH_VALUE_THRESHOLD;

  // blank/thin 缺口；exhausted-with-reason 的格不计（Agent 已主观声明尽力）。
  const valueSortedGaps: CoverageGap[] = input.cells
    .filter(
      (cell) =>
        (cell.grade === 'empty' || cell.grade === 'thin') &&
        !(cell.exhausted && Boolean(cell.exhaustedReason?.trim()))
    )
    .map((cell) => ({
      moduleId: cell.moduleId,
      dimensionId: cell.dimensionId,
      grade: cell.grade as Extract<CoverageGrade, 'empty' | 'thin'>,
      valueScore: cell.valueScore ?? 0,
    }))
    .sort((a, b) => b.valueScore - a.valueScore);

  const highValueBlankCount = valueSortedGaps.filter(
    (gap) => gap.valueScore >= highValueThreshold
  ).length;

  const lastRound = input.latestRound?.roundIndex ?? 0;
  const newRecipesThisRound = input.latestRound?.newRecipesThisRound ?? null;

  const build = (
    stopReason: DeepMiningStopReason,
    shouldStop: boolean
  ): CoverageLedgerAdvisorResult => ({
    shouldStop,
    stopReason,
    highValueBlankCount,
    valueSortedGaps,
    suggestion: shouldStop ? null : `还有 ${highValueBlankCount} 个高价值空白，建议再扫一轮`,
    tier,
    k,
    maxRounds,
  });

  // ① 收敛：无 blank/thin 缺口（全 covered/partial 或全 exhausted-with-reason）。
  if (valueSortedGaps.length === 0) {
    return build('converged', true);
  }
  // ② 收益递减：已完成 ≥1 轮且上一轮边际产出 < K。
  if (newRecipesThisRound !== null && lastRound >= 1 && newRecipesThisRound < k) {
    return build('diminishing-returns', true);
  }
  // ③ 轮次上限：last_round ≥ maxRounds（安全闸）。
  if (lastRound >= maxRounds) {
    return build('round-cap', true);
  }
  // 否则继续，给价值排序建议（非自动调度）。
  return build('continue', false);
}

export function buildCoverageLedgerPanoramaRollup(
  input: CoverageLedgerPanoramaRollupInput
): CoverageLedgerPanoramaRollup {
  const dimensions = input.dimensions ?? DIMENSION_REGISTRY;
  const dimensionDefinitions = new Map(dimensions.map((dimension) => [dimension.id, dimension]));
  const dimensionIds = orderedDimensionIds(dimensions, input.cells);
  const cellsByDimension = groupCellsByDimension(input.cells);
  const moduleRolesById = new Map(
    (input.moduleRoles ?? []).map((entry) => [entry.moduleId, [...entry.roles]])
  );

  const dimensionCoverage = dimensionIds.map((dimensionId) =>
    buildDimensionCoverage({
      cells: cellsByDimension.get(dimensionId) ?? [],
      definition: dimensionDefinitions.get(dimensionId),
      dimensionId,
    })
  );
  const healthRadarDimensions = dimensionCoverage.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    status: dimension.status,
    score: dimension.score,
  }));
  return {
    basis: 'coverage-ledger-rollup',
    directModuleIdAligned: false,
    dimensionCoverage,
    healthRadar: {
      basis: 'coverage-ledger-rollup',
      score: resolveHealthRadarScore(healthRadarDimensions),
      dimensions: healthRadarDimensions,
    },
    gaps: buildPanoramaGaps({
      cellsByDimension,
      dimensionDefinitions,
      dimensionIds,
      moduleRolesById,
    }),
  };
}

function buildDimensionCoverage(input: {
  cells: readonly CoverageLedgerRecord[];
  definition: UnifiedDimension | undefined;
  dimensionId: string;
}): CoverageLedgerPanoramaDimensionCoverage {
  const coverageRatio = resolveDimensionCoverageRatio(input.cells);
  const missingCellCount = input.cells.filter((cell) => cell.grade === 'empty').length;
  const weakCellCount = input.cells.filter((cell) => cell.grade === 'thin').length;
  const partialCellCount = input.cells.filter((cell) => cell.grade === 'partial').length;
  const coveredCellCount = input.cells.filter((cell) => cell.grade === 'covered').length;
  const totalCandidateCount = sumCoverageCount(input.cells, (cell) => cell.totalCandidateCount);
  const coveredCandidateCount = sumCoverageCount(input.cells, (cell) => cell.coveredCount);
  return {
    id: input.dimensionId,
    label: input.definition?.label ?? input.dimensionId,
    weight: input.definition?.weight ?? 0,
    status: resolveDimensionHealthStatus({
      coverageRatio,
      hasCells: input.cells.length > 0,
      missingCellCount,
      weakCellCount,
    }),
    score: Math.round(coverageRatio * 100),
    coverageRatio,
    cellCount: input.cells.length,
    coveredCandidateCount,
    totalCandidateCount,
    coveredCellCount,
    partialCellCount,
    weakCellCount,
    missingCellCount,
  };
}

function buildPanoramaGaps(input: {
  cellsByDimension: ReadonlyMap<string, readonly CoverageLedgerRecord[]>;
  dimensionDefinitions: ReadonlyMap<string, UnifiedDimension>;
  dimensionIds: readonly string[];
  moduleRolesById: ReadonlyMap<string, readonly string[]>;
}): CoverageLedgerPanoramaGap[] {
  return input.dimensionIds
    .flatMap((dimensionId) => {
      const definition = input.dimensionDefinitions.get(dimensionId);
      const dimensionCells = input.cellsByDimension.get(dimensionId) ?? [];
      const gapCells = dimensionCells.filter(
        (cell) => cell.grade === 'empty' || cell.grade === 'thin'
      );
      if (gapCells.length === 0 && dimensionCells.length > 0) {
        return [];
      }
      const missingCellCount = gapCells.filter((cell) => cell.grade === 'empty').length;
      const weakCellCount = gapCells.filter((cell) => cell.grade === 'thin').length;
      const status: CoverageLedgerPanoramaGapStatus =
        dimensionCells.length === 0 || missingCellCount > 0 ? 'missing' : 'weak';
      const valueScore =
        gapCells.length > 0 ? Math.max(...gapCells.map((cell) => cell.valueScore ?? 0)) : 0;
      const weight = definition?.weight ?? 0;
      return [
        {
          dimensionId,
          dimensionName: definition?.label ?? dimensionId,
          status,
          priority: resolveGapPriority({ status, valueScore, weight }),
          weight,
          suggestedTopics: [...(definition?.suggestedTopics ?? [])],
          relatedRoles: [...(definition?.relatedRoles ?? [])],
          affectedRoles: resolveAffectedRoles({
            gapCells,
            moduleRolesById: input.moduleRolesById,
            relatedRoles: definition?.relatedRoles ?? [],
          }),
          affectedModuleIds: sortUniqueStrings(gapCells.map((cell) => cell.moduleId)),
          missingCellCount,
          weakCellCount,
          valueScore,
        },
      ];
    })
    .sort(comparePanoramaGaps);
}

function orderedDimensionIds(
  dimensions: readonly UnifiedDimension[],
  cells: readonly CoverageLedgerRecord[]
): string[] {
  const ids = dimensions.map((dimension) => dimension.id);
  const seen = new Set(ids);
  const unknownIds = sortUniqueStrings(
    cells.flatMap((cell) => (seen.has(cell.dimensionId) ? [] : [cell.dimensionId]))
  );
  return [...ids, ...unknownIds];
}

function groupCellsByDimension(
  cells: readonly CoverageLedgerRecord[]
): Map<string, CoverageLedgerRecord[]> {
  const groups = new Map<string, CoverageLedgerRecord[]>();
  for (const cell of cells) {
    const group = groups.get(cell.dimensionId) ?? [];
    group.push(cell);
    groups.set(cell.dimensionId, group);
  }
  return groups;
}

function resolveDimensionCoverageRatio(cells: readonly CoverageLedgerRecord[]): number {
  if (cells.length === 0) {
    return 0;
  }
  const score = cells.reduce((sum, cell) => sum + resolveCellCoverageRatio(cell), 0);
  return clampRatio(score / cells.length);
}

function resolveCellCoverageRatio(cell: CoverageLedgerRecord): number {
  if (cell.totalCandidateCount > 0) {
    return clampRatio(cell.coveredCount / cell.totalCandidateCount);
  }
  return gradeCoverageRatio(cell.grade);
}

function gradeCoverageRatio(grade: CoverageGrade): number {
  switch (grade) {
    case 'covered':
      return 1;
    case 'partial':
      return 0.5;
    case 'thin':
      return 0.25;
    case 'empty':
      return 0;
  }
}

function resolveDimensionHealthStatus(input: {
  coverageRatio: number;
  hasCells: boolean;
  missingCellCount: number;
  weakCellCount: number;
}): CoverageLedgerPanoramaHealthStatus {
  if (!input.hasCells || input.missingCellCount > 0 || input.coverageRatio === 0) {
    return 'missing';
  }
  if (input.weakCellCount > 0 || input.coverageRatio < 0.5) {
    return 'weak';
  }
  if (input.coverageRatio < 0.85) {
    return 'adequate';
  }
  return 'strong';
}

function resolveHealthRadarScore(
  dimensions: readonly CoverageLedgerPanoramaHealthRadarDimension[]
): number {
  if (dimensions.length === 0) {
    return 0;
  }
  const weightTotal = dimensions.reduce((sum, dimension) => sum + Math.max(0, dimension.weight), 0);
  if (weightTotal === 0) {
    const totalScore = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
    return Math.round(totalScore / dimensions.length);
  }
  const weightedScore = dimensions.reduce(
    (sum, dimension) => sum + dimension.score * Math.max(0, dimension.weight),
    0
  );
  return Math.round(weightedScore / weightTotal);
}

function resolveGapPriority(input: {
  status: CoverageLedgerPanoramaGapStatus;
  valueScore: number;
  weight: number;
}): CoverageLedgerPanoramaGapPriority {
  if (input.status === 'missing' || input.valueScore >= 0.75 || input.weight >= 0.9) {
    return 'high';
  }
  if (input.valueScore >= 0.5 || input.weight >= 0.7) {
    return 'medium';
  }
  return 'low';
}

function resolveAffectedRoles(input: {
  gapCells: readonly CoverageLedgerRecord[];
  moduleRolesById: ReadonlyMap<string, readonly string[]>;
  relatedRoles: readonly string[];
}): string[] {
  const rolesForGapModules = new Set(
    input.gapCells.flatMap((cell) => input.moduleRolesById.get(cell.moduleId) ?? [])
  );
  return input.relatedRoles.filter((role) => rolesForGapModules.has(role));
}

function comparePanoramaGaps(
  left: CoverageLedgerPanoramaGap,
  right: CoverageLedgerPanoramaGap
): number {
  return (
    gapStatusRank(left.status) - gapStatusRank(right.status) ||
    gapPriorityRank(left.priority) - gapPriorityRank(right.priority) ||
    right.weight - left.weight ||
    right.valueScore - left.valueScore ||
    left.dimensionId.localeCompare(right.dimensionId)
  );
}

function gapStatusRank(status: CoverageLedgerPanoramaGapStatus): number {
  return status === 'missing' ? 0 : 1;
}

function gapPriorityRank(priority: CoverageLedgerPanoramaGapPriority): number {
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
  }
}

function sumCoverageCount(
  cells: readonly CoverageLedgerRecord[],
  selector: (cell: CoverageLedgerRecord) => number
): number {
  return cells.reduce((sum, cell) => sum + Math.max(0, selector(cell)), 0);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function sortUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

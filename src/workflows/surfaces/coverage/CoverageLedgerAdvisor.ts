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

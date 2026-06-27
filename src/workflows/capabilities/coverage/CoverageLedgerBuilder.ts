import { pathsOverlap, sortUnique } from './shared/coveragePathMatching.js';

/* ════════════════════ U2a buildCoverageLedger（聚合层，不改单候选） ════════════════════ */

/** 覆盖账本 grade（与 CoverageLedgerRepository.CoverageGrade 同构，结构兼容 upsert）。 */
export type CompletenessCoverageGrade = 'empty' | 'thin' | 'partial' | 'covered';

/** 跨维候选（buildCoverageLedger 输入）：一个候选可跨多维，带 grounding 源路径与价值。 */
export interface CoverageLedgerCandidate {
  dimensionIds: readonly string[];
  sourceRefPaths: readonly string[];
  /** 0-100 重要度（用于 cell value_score 与高价值缺口排序）。 */
  importance?: number;
}

/** module 轴：caller 从 canonical ProjectMap.modules + ownedFiles 提供路径（Core 不另造来源、不读宿主 fs）。 */
export interface CoverageLedgerModuleAxis {
  moduleId: string;
  moduleName?: string;
  ownedPaths: readonly string[];
}

/** Agent 主观「已尽」声明（落库 exhausted_source='agent-declared'，依赖 noPadding + reason）。 */
export interface CoverageLedgerExhaustedDeclaration {
  moduleId: string;
  dimensionId: string;
  reason: string;
}

export interface BuildCoverageLedgerInput {
  candidates: readonly CoverageLedgerCandidate[];
  /** 已覆盖源路径（已提交 recipe 的 sourceRefs；与候选 sourceRefPaths 做 pathsOverlap 判覆盖）。 */
  coveredPaths: readonly string[];
  modules: readonly CoverageLedgerModuleAxis[];
  dimensionIds: readonly string[];
  /** D2 per-cell 目标 recipe 数（grade 阈值用——advisory，严禁当生产/阻断门）。 */
  perCellTarget: number;
  exhaustedDeclarations?: readonly CoverageLedgerExhaustedDeclaration[];
}

export interface CoverageLedgerCell {
  moduleId: string;
  moduleName?: string;
  dimensionId: string;
  coveredCount: number;
  totalCandidateCount: number;
  grade: CompletenessCoverageGrade;
  coveredSourceRefs: string[];
  uncoveredHints: string[];
  valueScore: number;
  exhausted: boolean;
  exhaustedReason: string | null;
  exhaustedSource: 'agent-declared' | null;
}

/**
 * U2a：聚合跨维候选 + coveredPaths → per-(module×dimension) cell 覆盖账本。
 *
 * **只加聚合层，不改 buildCompletenessCritic 单候选逻辑**；grade 仅是 advisory 覆盖信号，
 * **严禁当生产/阻断门**（buildCompletenessCritic 仍 shouldBlockCompletion:false / targetGate:'advisory'）。
 * module 归属用 caller 提供的 canonical ModuleSummary ownedPaths + pathsOverlap（不读宿主 fs、不硬编码宿主路径，
 * project_root 由调用方在 upsert 时提供）。exhausted 仅由 Agent 显式声明落库（agent-declared）。
 */
export function buildCoverageLedger(input: BuildCoverageLedgerInput): CoverageLedgerCell[] {
  const perCellTarget = Math.max(0, input.perCellTarget);
  const exhaustedByCell = new Map<string, string>();
  for (const decl of input.exhaustedDeclarations ?? []) {
    const reason = decl.reason?.trim();
    if (reason) {
      exhaustedByCell.set(`${decl.moduleId}::${decl.dimensionId}`, reason);
    }
  }

  const isCovered = (candidatePath: string): boolean =>
    input.coveredPaths.some((covered) => pathsOverlap(candidatePath, covered));
  const moduleOwns = (
    moduleAxis: CoverageLedgerModuleAxis,
    candidate: CoverageLedgerCandidate
  ): boolean =>
    candidate.sourceRefPaths.some((candidatePath) =>
      moduleAxis.ownedPaths.some((owned) => pathsOverlap(candidatePath, owned))
    );

  const cells: CoverageLedgerCell[] = [];
  for (const moduleAxis of input.modules) {
    for (const dimensionId of input.dimensionIds) {
      const cellCandidates = input.candidates.filter(
        (candidate) =>
          candidate.dimensionIds.includes(dimensionId) && moduleOwns(moduleAxis, candidate)
      );
      const covered = cellCandidates.filter((candidate) =>
        candidate.sourceRefPaths.some((candidatePath) => isCovered(candidatePath))
      );
      const uncovered = cellCandidates.filter((candidate) => !covered.includes(candidate));

      const reason = exhaustedByCell.get(`${moduleAxis.moduleId}::${dimensionId}`) ?? null;
      cells.push({
        moduleId: moduleAxis.moduleId,
        moduleName: moduleAxis.moduleName,
        dimensionId,
        coveredCount: covered.length,
        totalCandidateCount: cellCandidates.length,
        grade: resolveCoverageGrade(covered.length, cellCandidates.length, perCellTarget),
        coveredSourceRefs: sortUnique(
          covered.flatMap((candidate) => [...candidate.sourceRefPaths])
        ),
        uncoveredHints: sortUnique(uncovered.flatMap((candidate) => [...candidate.sourceRefPaths])),
        // 缺口价值 = 未覆盖候选最高重要度（0-1）；无未覆盖 → 0。
        valueScore:
          uncovered.length > 0
            ? Math.max(...uncovered.map((candidate) => (candidate.importance ?? 0) / 100))
            : 0,
        exhausted: reason !== null,
        exhaustedReason: reason,
        exhaustedSource: reason !== null ? 'agent-declared' : null,
      });
    }
  }
  return cells;
}

/** grade 阈值（advisory 覆盖信号，非生产/阻断门）。 */
function resolveCoverageGrade(
  coveredCount: number,
  totalCandidateCount: number,
  perCellTarget: number
): CompletenessCoverageGrade {
  if (perCellTarget > 0 && coveredCount >= perCellTarget) {
    return 'covered';
  }
  if (coveredCount > 0) {
    return 'partial';
  }
  if (totalCandidateCount > 0) {
    return 'thin';
  }
  return 'empty';
}

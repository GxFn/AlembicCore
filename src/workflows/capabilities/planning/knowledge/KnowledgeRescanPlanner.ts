import path from 'node:path';
import { EvolutionPolicy } from '../../../../domain/evolution/EvolutionPolicy.js';
import type { ProposalRepository } from '../../../../repository/evolution/ProposalRepository.js';
import type KnowledgeRepositoryImpl from '../../../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type {
  RecipeSourceRefEntity,
  RecipeSourceRefRepositoryImpl,
} from '../../../../repository/sourceref/RecipeSourceRefRepository.js';
import { ProposalGateway } from '../../../../service/evolution/ProposalGateway.js';
import type { LifecycleStateMachine } from '../../../../service/evolution/LifecycleStateMachine.js';
import type { EvolutionCandidatePlan } from '../../../../service/evolution/RecipeImpactPlanner.js';
import type { CanonicalSourceIdentity } from '../../../../shared/ProjectScope.js';
import type { DimensionDef } from '../../../../types/ProjectSnapshot.js';
import type { RecipeSnapshotEntry } from '../../RecipeSnapshotTypes.js';
import { buildEvolutionPrescreen, type EvolutionPrescreen } from './EvolutionPrescreen.js';
import {
  type AuditVerdict,
  type BuildKnowledgeRescanPlanOptions,
  buildKnowledgeRescanPlan,
  type KnowledgeRescanDimensionPlan,
  type KnowledgeRescanExecutionDecision,
  type KnowledgeRescanPlan,
  type RescanExecutionMode,
  type RescanExecutionReason,
  type RescanExecutionReasonKind,
  TARGET_RECIPES_PER_DIMENSION,
} from './KnowledgeRescanPlanBuilder.js';
import {
  type HostAgentDimensionGap,
  type HostAgentRescanEvidencePlan,
  type InternalRescanGapPlan,
  projectHostAgentRescanEvidencePlan,
  projectInternalRescanGapPlan,
  projectInternalRescanPromptRecipes,
  projectInternalRescanPromptRecipesFromParts,
} from './RescanEvidenceProjectors.js';

// ── RelevanceAudit 类型定义 ──────────

/** 单个 Recipe 的审计结果 */
export interface RelevanceAuditResult {
  recipeId: string;
  title: string;
  relevanceScore: number;
  verdict: 'healthy' | 'watch' | 'decay' | 'severe' | 'dead';
  evidence: {
    triggerStillMatches: boolean;
    symbolsAlive: number;
    depsIntact: boolean;
    codeFilesExist: number;
  };
  decayReasons: string[];
}

/** 审计汇总 */
export interface RelevanceAuditSummary {
  totalAudited: number;
  healthy: number;
  watch: number;
  decay: number;
  severe: number;
  dead: number;
  results: RelevanceAuditResult[];
  proposalsCreated: number;
  immediateDeprecated: number;
}

export {
  buildKnowledgeRescanPlan,
  projectHostAgentRescanEvidencePlan,
  projectInternalRescanGapPlan,
  projectInternalRescanPromptRecipes,
  TARGET_RECIPES_PER_DIMENSION,
};

export type {
  AuditVerdict,
  HostAgentDimensionGap,
  HostAgentRescanEvidencePlan,
  InternalRescanGapPlan,
  KnowledgeRescanDimensionPlan,
  KnowledgeRescanExecutionDecision,
  KnowledgeRescanPlan,
  RescanExecutionMode,
  RescanExecutionReason,
  RescanExecutionReasonKind,
};

interface RescanLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

interface KnowledgeSyncService {
  sync(db: unknown, opts: { force: boolean }): { synced: number; created: number; updated: number };
}

interface RescanServiceContainer {
  get(name: string): unknown;
  services?: Record<string, unknown>;
}

export interface KnowledgeSyncOptions {
  container: RescanServiceContainer;
  db: unknown;
  logger: RescanLogger;
  logPrefix: string;
}

export interface RecipeAuditOptions {
  container: RescanServiceContainer;
  logger: RescanLogger;
  recipeEntries: RecipeSnapshotEntry[];
  allFiles: Array<{
    name: string;
    path?: string;
    relativePath?: string;
    sourceIdentity?: CanonicalSourceIdentity;
  }>;
  projectRoot?: string;
  /** RecipeImpactPlanner 产出的增量候选（可选，有则增强 verdict 精度） */
  candidatePlan?: EvolutionCandidatePlan | null;
}

export function syncKnowledgeStoreForRescan(opts: KnowledgeSyncOptions): void {
  try {
    if (opts.container.services && !opts.container.services.knowledgeSyncService) {
      return;
    }

    const syncService = opts.container.get('knowledgeSyncService') as KnowledgeSyncService;

    if (!syncService) {
      return;
    }

    const syncReport = syncService.sync(opts.db, { force: true });
    opts.logger.info(`[${opts.logPrefix}] KnowledgeSyncService sync complete`, {
      synced: syncReport.synced,
      created: syncReport.created,
      updated: syncReport.updated,
    });
  } catch (err: unknown) {
    opts.logger.warn(
      `[${opts.logPrefix}] KnowledgeSyncService sync failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** auditRecipesForRescan 消费的最小 Gateway 契约（仅 submit）。 */
type ProposalGatewayLike = Pick<ProposalGateway, 'submit'>;

/**
 * U6：解析可用的 ProposalGateway（dead→deprecate 提案生产者）。
 * 与既有 container.get 防御式取法一致：优先取已注册 proposalGateway，
 * 否则从 proposalRepository + lifecycleStateMachine + knowledgeRepository 组装既有 ProposalGateway（复用既有类，不新建服务）；
 * 都不可用 → 返回 null，dead→deprecate 跳过、proposalsCreated 计 0（降级安全；真机生产由 Plugin 注入这些服务）。
 */
function resolveProposalGateway(
  container: RescanServiceContainer,
  logger: RescanLogger
): ProposalGatewayLike | null {
  const tryGet = (name: string): unknown => {
    try {
      return container.get(name);
    } catch {
      return null;
    }
  };

  const direct = tryGet('proposalGateway');
  if (direct && typeof (direct as { submit?: unknown }).submit === 'function') {
    return direct as ProposalGatewayLike;
  }

  const proposalRepo = tryGet('proposalRepository') as ProposalRepository | null;
  const lifecycle = tryGet('lifecycleStateMachine') as LifecycleStateMachine | null;
  const knowledgeRepo = tryGet('knowledgeRepository') as KnowledgeRepositoryImpl | null;
  if (proposalRepo && lifecycle && knowledgeRepo) {
    return new ProposalGateway(proposalRepo, lifecycle, knowledgeRepo);
  }

  logger.info(
    '[CoverageClassifier] proposalGateway/deps unavailable, dead→deprecate skipped (proposalsCreated=0)'
  );
  return null;
}

/**
 * 对保留的 Recipe 进行覆盖分类，为 gap analysis 和 EvolutionPrescreen 提供数据。
 *
 * 进化触发由 RecipeImpactPlanner + EvolutionAgent 管线负责，
 * 本函数仅负责 coverage classification（全量 recipe → verdict）。
 *
 * 数据来源优先级：
 *   1. RecipeImpactPlanner 候选（candidatePlan）— 精确的 diff-based 影响评估
 *   2. SourceRef 桥接表（recipeSourceRefRepository）— active/stale 文件映射
 *   3. Recipe 生命周期（lifecycle）— 兜底分类
 *
 * 评分由 EvolutionPolicy.classifyRelevance() 统一分级（阈值: 80/60/40/20）。
 */
export async function auditRecipesForRescan(
  opts: RecipeAuditOptions
): Promise<RelevanceAuditSummary> {
  const { recipeEntries, allFiles, projectRoot, candidatePlan, container, logger } = opts;

  if (recipeEntries.length === 0) {
    return emptyAuditSummary();
  }

  const filePathSet = buildComparableFilePathSet(allFiles, projectRoot);

  const impactMap = buildImpactMap(candidatePlan);

  let sourceRefRepo: RecipeSourceRefRepositoryImpl | null = null;
  try {
    sourceRefRepo = container.get('recipeSourceRefRepository') as RecipeSourceRefRepositoryImpl;
  } catch {
    logger.info('[CoverageClassifier] recipeSourceRefRepository not available, using fallback');
  }

  const driftedByRecipe = sourceRefRepo ? buildDriftedSourceRefMap(sourceRefRepo, logger) : null;
  const staleByRecipe = sourceRefRepo ? buildStaleMap(sourceRefRepo, driftedByRecipe) : null;

  const results: RelevanceAuditResult[] = [];
  const counters = { healthy: 0, watch: 0, decay: 0, severe: 0, dead: 0 };

  for (const entry of recipeEntries) {
    const result = classifyRecipe(entry, {
      impactMap,
      staleByRecipe,
      sourceRefRepo,
      driftedByRecipe,
      filePathSet,
    });
    counters[result.verdict]++;
    results.push(result);
  }

  // U6：content drift → update 提案；dead recipe → deprecate 提案
  // （替换硬编码 proposalsCreated:0 / immediateDeprecated:counters.dead 占位）。
  // CG⑥b：source='metabolism' → ProposalGateway 走 observation-window（shouldImmediateExecute 对 metabolism 恒 false），
  // 即「进观察窗口、非立即执行」；proposalsCreated/immediateDeprecated 反映真实 Gateway 结果而非占位数。
  let proposalsCreated = 0;
  let immediateDeprecated = 0;
  const deadResults = results.filter(
    (r) => r.verdict === 'dead' && !driftedByRecipe?.has(r.recipeId)
  );
  const hasDriftedUpdates = Boolean(driftedByRecipe && driftedByRecipe.size > 0);
  const gateway =
    deadResults.length > 0 || hasDriftedUpdates ? resolveProposalGateway(container, logger) : null;
  if (gateway) {
    if (driftedByRecipe && driftedByRecipe.size > 0) {
      proposalsCreated += await submitDriftedUpdates(gateway, driftedByRecipe, logger);
    }
    for (const dead of deadResults) {
      try {
        const outcome = await gateway.submit({
          recipeId: dead.recipeId,
          action: 'deprecate',
          source: 'metabolism',
          confidence: EvolutionPolicy.classifyRelevance(dead.relevanceScore).confidence,
          reason: dead.decayReasons.join('; ') || `relevanceScore=${dead.relevanceScore}, dead`,
          evidence: [
            {
              relevanceScore: dead.relevanceScore,
              verdict: dead.verdict,
              evidence: dead.evidence,
            },
          ],
        });
        if (outcome.outcome === 'proposal-created' || outcome.outcome === 'proposal-upgraded') {
          proposalsCreated++;
        } else if (outcome.outcome === 'immediately-executed') {
          immediateDeprecated++;
        }
      } catch (err: unknown) {
        logger.warn(
          `[CoverageClassifier] dead→deprecate submit failed for ${dead.recipeId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    logger.info(
      `[CoverageClassifier] dead→deprecate: ${proposalsCreated} observing proposal(s), ${immediateDeprecated} immediate of ${deadResults.length} dead`
    );
  }

  return {
    totalAudited: recipeEntries.length,
    ...counters,
    results,
    proposalsCreated,
    immediateDeprecated,
  };
}

function buildComparableFilePathSet(
  allFiles: Array<{
    name: string;
    path?: string;
    relativePath?: string;
    sourceIdentity?: CanonicalSourceIdentity;
  }>,
  projectRoot?: string
): ComparableFilePathIndex {
  const paths = new Set<string>();
  const unqualifiedBuckets = new Map<string, Set<string>>();
  for (const file of allFiles) {
    addComparablePath(paths, file.sourceIdentity?.qualifiedPath);
    addComparablePath(paths, file.relativePath);
    addComparablePath(paths, file.name);
    addComparablePath(paths, file.path);
    if (file.sourceIdentity?.relativePath && file.sourceIdentity.qualifiedPath) {
      const unqualified = normalizeComparablePath(file.sourceIdentity.relativePath);
      const bucket = unqualifiedBuckets.get(unqualified) ?? new Set<string>();
      bucket.add(normalizeComparablePath(file.sourceIdentity.qualifiedPath));
      unqualifiedBuckets.set(unqualified, bucket);
    }
    if (file.path && projectRoot && path.isAbsolute(file.path)) {
      addComparablePath(paths, path.relative(projectRoot, file.path));
    }
  }
  const ambiguousUnqualifiedPaths = new Set(
    [...unqualifiedBuckets.entries()]
      .filter(([, qualifiedPaths]) => qualifiedPaths.size > 1)
      .map(([unqualifiedPath]) => unqualifiedPath)
  );
  for (const ambiguous of ambiguousUnqualifiedPaths) {
    paths.delete(ambiguous);
  }
  return { ambiguousUnqualifiedPaths, paths };
}

interface ComparableFilePathIndex {
  ambiguousUnqualifiedPaths: ReadonlySet<string>;
  paths: ReadonlySet<string>;
}

function addComparablePath(paths: Set<string>, value: string | undefined): void {
  const normalized = normalizeComparablePath(value);
  if (normalized) {
    paths.add(normalized);
  }
}

function normalizeComparablePath(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return path.normalize(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

// ── Impact 候选映射 ──────────────────────────────────────

interface ImpactEntry {
  reason: string;
  impactScore: number;
  affectedFiles: string[];
}

function buildImpactMap(
  candidatePlan: EvolutionCandidatePlan | null | undefined
): Map<string, ImpactEntry> {
  const map = new Map<string, ImpactEntry>();
  if (!candidatePlan) {
    return map;
  }
  for (const c of candidatePlan.candidates) {
    map.set(c.recipeId, {
      reason: c.reason,
      impactScore: c.impactScore,
      affectedFiles: c.affectedFiles,
    });
  }
  return map;
}

// ── SourceRef stale 统计 ─────────────────────────────────

interface RefHealth {
  active: number;
  stale: number;
  total: number;
  drifted: boolean;
}

function buildDriftedSourceRefMap(
  repo: RecipeSourceRefRepositoryImpl,
  logger: RescanLogger
): Map<string, RecipeSourceRefEntity[]> {
  const map = new Map<string, RecipeSourceRefEntity[]>();
  try {
    for (const ref of repo.findDrifted()) {
      const refs = map.get(ref.recipeId) ?? [];
      refs.push(ref);
      map.set(ref.recipeId, refs);
    }
  } catch (err: unknown) {
    logger.warn(
      `[CoverageClassifier] findDrifted failed, drifted→update skipped: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return map;
}

function buildStaleMap(
  repo: RecipeSourceRefRepositoryImpl,
  driftedByRecipe: Map<string, RecipeSourceRefEntity[]> | null
): Map<string, RefHealth> {
  const map = new Map<string, RefHealth>();
  try {
    const staleCounts = repo.getStaleCountsByRecipe();
    for (const row of staleCounts) {
      map.set(row.recipeId, {
        active: row.totalCount - row.staleCount,
        stale: row.staleCount,
        total: row.totalCount,
        drifted: driftedByRecipe?.has(row.recipeId) ?? false,
      });
    }
  } catch {
    // table may not exist yet
  }
  return map;
}

// ── 单条 Recipe 分类 ────────────────────────────────────

function classifyRecipe(
  entry: RecipeSnapshotEntry,
  ctx: {
    impactMap: Map<string, ImpactEntry>;
    staleByRecipe: Map<string, RefHealth> | null;
    sourceRefRepo: RecipeSourceRefRepositoryImpl | null;
    driftedByRecipe: Map<string, RecipeSourceRefEntity[]> | null;
    filePathSet: ComparableFilePathIndex;
  }
): RelevanceAuditResult {
  const decayReasons: string[] = [];

  // ── 层 1: RecipeImpactPlanner 精确候选 ──
  const impact = ctx.impactMap.get(entry.id);
  if (impact) {
    const { score, reasons } = impactToScore(impact);
    decayReasons.push(...reasons);
    return buildResult(entry, score, decayReasons, buildImpactEvidence(impact, ctx.filePathSet));
  }

  // ── 层 2: SourceRef 桥接表健康度 ──
  if (ctx.staleByRecipe) {
    const refHealth = ctx.staleByRecipe.get(entry.id);
    if (refHealth) {
      const { score, reasons } = refHealthToScore(refHealth);
      decayReasons.push(...reasons);
      return buildResult(
        entry,
        score,
        decayReasons,
        buildRefEvidence(refHealth, ctx.filePathSet, entry)
      );
    }
    // recipe 有 SourceRef 记录但全是 active（不在 stale 统计中）
    if (ctx.sourceRefRepo) {
      const refs = ctx.sourceRefRepo.findByRecipeId(entry.id);
      if (refs.length > 0) {
        const activeCount = refs.filter((r) => r.status === 'active').length;
        const ratio = activeCount / refs.length;
        const hasDriftedRefs = ctx.driftedByRecipe?.has(entry.id) ?? false;
        const score = hasDriftedRefs && activeCount === 0 ? 45 : Math.round(ratio * 100);
        if (ratio < 1) {
          decayReasons.push(`SourceRef ${activeCount}/${refs.length} active`);
        }
        return buildResult(entry, score, decayReasons, {
          triggerStillMatches: true,
          symbolsAlive: activeCount,
          depsIntact: ratio >= 0.5,
          codeFilesExist: activeCount,
        });
      }
    }
  }

  // ── 层 3: 生命周期兜底 ──
  const { score, reasons } = lifecycleToScore(entry, ctx.filePathSet);
  decayReasons.push(...reasons);
  return buildResult(entry, score, decayReasons, buildLifecycleEvidence(entry, ctx.filePathSet));
}

// ── Impact → Score 映射 ─────────────────────────────────

function impactToScore(impact: ImpactEntry): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  switch (impact.reason) {
    case 'source-deleted':
      reasons.push(`all source files deleted: ${impact.affectedFiles.join(', ')}`);
      return { score: 10, reasons };
    case 'source-deleted-partial':
      reasons.push(`partial source deleted: ${impact.affectedFiles.join(', ')}`);
      return { score: 30, reasons };
    case 'source-modified-pattern':
      reasons.push(`source pattern modified (impact: ${(impact.impactScore * 100).toFixed(0)}%)`);
      return { score: Math.round(60 - impact.impactScore * 40), reasons };
    case 'source-missing':
      reasons.push(`SourceRef stale: files no longer found`);
      return { score: 50, reasons };
    default:
      return { score: 70, reasons };
  }
}

// ── RefHealth → Score 映射 ──────────────────────────────

function refHealthToScore(health: RefHealth): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (health.total === 0) {
    return { score: 70, reasons };
  }
  const ratio = health.active / health.total;
  if (health.drifted && health.active === 0) {
    reasons.push(`all ${health.total} SourceRefs require content update (drifted)`);
    return { score: 45, reasons };
  }
  if (health.drifted && ratio < 0.5) {
    reasons.push(`SourceRef ${health.active}/${health.total} active; drifted refs require update`);
    return { score: Math.max(40, Math.round(30 + ratio * 40)), reasons };
  }
  if (health.active === 0) {
    reasons.push(`all ${health.total} SourceRefs stale`);
    return { score: 15, reasons };
  }
  if (ratio < 0.5) {
    reasons.push(
      `SourceRef ${health.active}/${health.total} active (${(ratio * 100).toFixed(0)}%)`
    );
    return { score: Math.round(30 + ratio * 40), reasons };
  }
  reasons.push(`SourceRef ${health.active}/${health.total} active`);
  return { score: Math.round(50 + ratio * 30), reasons };
}

async function submitDriftedUpdates(
  gateway: ProposalGatewayLike,
  driftedByRecipe: Map<string, RecipeSourceRefEntity[]>,
  logger: RescanLogger
): Promise<number> {
  let proposalsCreated = 0;
  for (const [recipeId, refs] of driftedByRecipe) {
    try {
      const sourcePaths = refs.map((ref) => ref.sourcePath).join(', ');
      const outcome = await gateway.submit({
        recipeId,
        action: 'update',
        source: 'metabolism',
        confidence: 0.8,
        reason: `SourceRef content drift detected: ${sourcePaths}`,
        evidence: refs.map((ref) => ({
          sourceStatus: 'drifted',
          sourcePath: ref.sourcePath,
          verifiedAt: ref.verifiedAt,
          contentFp: ref.contentFp,
          updateReason: 'source-region-content-drift',
        })),
      });
      if (outcome.outcome === 'proposal-created' || outcome.outcome === 'proposal-upgraded') {
        proposalsCreated++;
      }
    } catch (err: unknown) {
      logger.warn(
        `[CoverageClassifier] drifted→update submit failed for ${recipeId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  logger.info(
    `[CoverageClassifier] drifted→update: ${proposalsCreated} proposal(s) from ${driftedByRecipe.size} drifted recipe(s)`
  );
  return proposalsCreated;
}

// ── Lifecycle 兜底 Score ────────────────────────────────

function lifecycleToScore(
  entry: RecipeSnapshotEntry,
  filePathSet: ComparableFilePathIndex
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const hasSourceFiles = (entry.sourceRefs?.length ?? 0) > 0;
  const existingFiles = hasSourceFiles
    ? (entry.sourceRefs ?? []).filter((ref) => hasComparablePath(filePathSet, ref)).length
    : 0;

  switch (entry.lifecycle) {
    case 'active':
    case 'evolving':
      if (hasSourceFiles && existingFiles === 0) {
        reasons.push('active recipe but all sourceRefs missing from project');
        return { score: 55, reasons };
      }
      return { score: 90, reasons };
    case 'staging':
      if (hasSourceFiles && existingFiles === 0) {
        reasons.push('staging recipe with missing sourceRefs');
        return { score: 45, reasons };
      }
      return { score: 70, reasons };
    case 'decaying':
      reasons.push('lifecycle already marked as decaying');
      return { score: 35, reasons };
    default:
      return { score: 60, reasons };
  }
}

// ── Evidence 构建器 ─────────────────────────────────────

function buildImpactEvidence(
  impact: ImpactEntry,
  _filePathSet: ComparableFilePathIndex
): RelevanceAuditResult['evidence'] {
  const isDeleted =
    impact.reason === 'source-deleted' || impact.reason === 'source-deleted-partial';
  return {
    triggerStillMatches: !isDeleted,
    symbolsAlive: isDeleted ? 0 : 1,
    depsIntact: !isDeleted,
    codeFilesExist: isDeleted ? 0 : impact.affectedFiles.length,
  };
}

function buildRefEvidence(
  health: RefHealth,
  _filePathSet: ComparableFilePathIndex,
  _entry: RecipeSnapshotEntry
): RelevanceAuditResult['evidence'] {
  return {
    triggerStillMatches: health.active > 0,
    symbolsAlive: health.active,
    depsIntact: health.active > 0,
    codeFilesExist: health.active,
  };
}

function buildLifecycleEvidence(
  entry: RecipeSnapshotEntry,
  filePathSet: ComparableFilePathIndex
): RelevanceAuditResult['evidence'] {
  const refs = entry.sourceRefs ?? [];
  const existCount = refs.filter((ref) => hasComparablePath(filePathSet, ref)).length;
  return {
    triggerStillMatches: entry.lifecycle === 'active' || entry.lifecycle === 'evolving',
    symbolsAlive: existCount,
    depsIntact: existCount > 0 || refs.length === 0,
    codeFilesExist: existCount,
  };
}

function hasComparablePath(index: ComparableFilePathIndex, value: string): boolean {
  const normalized = normalizeComparablePath(value);
  return (
    Boolean(normalized) &&
    !index.ambiguousUnqualifiedPaths.has(normalized) &&
    index.paths.has(normalized)
  );
}

// ── 共用工具 ────────────────────────────────────────────

function buildResult(
  entry: RecipeSnapshotEntry,
  rawScore: number,
  decayReasons: string[],
  evidence: RelevanceAuditResult['evidence']
): RelevanceAuditResult {
  const score = Math.max(0, Math.min(100, rawScore));
  const { verdict } = EvolutionPolicy.classifyRelevance(score);
  return {
    recipeId: entry.id,
    title: entry.title,
    relevanceScore: score,
    verdict,
    evidence,
    decayReasons,
  };
}

function emptyAuditSummary(): RelevanceAuditSummary {
  return {
    totalAudited: 0,
    healthy: 0,
    watch: 0,
    decay: 0,
    severe: 0,
    dead: 0,
    results: [],
    proposalsCreated: 0,
    immediateDeprecated: 0,
  };
}

export function buildRescanPrescreen(
  auditSummary: RelevanceAuditSummary,
  recipeEntries: RecipeSnapshotEntry[],
  dimensions: Array<{ id: string }>
): EvolutionPrescreen {
  return buildEvolutionPrescreen(auditSummary, recipeEntries, dimensions);
}

export function planInternalRescanGaps(
  opts: BuildKnowledgeRescanPlanOptions
): InternalRescanGapPlan {
  return projectInternalRescanGapPlan(buildKnowledgeRescanPlan(opts));
}

export function buildExistingRecipesForInternalFill(opts: {
  recipeEntries: RecipeSnapshotEntry[];
  auditSummary: RelevanceAuditSummary;
  auditVerdictMap: Map<string, AuditVerdict>;
}): Array<{
  id: string;
  title: string;
  trigger: string;
  knowledgeType: string;
  status: 'decaying' | 'healthy';
  decayReason?: string;
  auditScore?: number;
  content?: { markdown?: string; rationale?: string; coreCode?: string };
  sourceRefs?: string[];
  auditEvidence?: Record<string, unknown>;
}> {
  return projectInternalRescanPromptRecipesFromParts(opts);
}

export function buildHostAgentRescanEvidencePlan(opts: {
  recipeEntries: RecipeSnapshotEntry[];
  auditSummary: RelevanceAuditSummary;
  dimensions: DimensionDef[];
  targetPerDimension?: number;
}): HostAgentRescanEvidencePlan {
  return projectHostAgentRescanEvidencePlan(buildKnowledgeRescanPlan(opts));
}

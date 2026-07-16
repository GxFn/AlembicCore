/**
 * RecipeProductionGateway — 统一 Recipe 生产入口
 *
 * 所有 Recipe 创建（Agent Tool / MCP / Host Agent / Batch Import）
 * 通过此 Gateway 的统一管道，保证前置校验一致：
 *
 *   1. Schema Validation (UnifiedValidator)
 *   2. Similarity Check — 去重检测（可选跳过）
 *   3. Consolidation Scan — 融合/重组建议（可选）
 *   4. KnowledgeService.create() — 包含 ConfidenceRouter → staging / pending
 *   5. Quality Scoring — 质量评分
 *   6. Supersede Proposal — 创建替代提案
 *   7. Audit — 统一审计
 */

import type { RecipeRetrievalProfile } from '../../domain/knowledge/RecipeRetrievalProfile.js';
import { UnifiedValidator } from '../../domain/knowledge/UnifiedValidator.js';
import { RELATION_BUCKETS } from '../../domain/knowledge/values/Relations.js';
import {
  type CanonicalGatewaySource,
  type GatewaySource,
  getGatewaySourceLabel,
  getGatewaySourceUserId,
  normalizeGatewaySource,
} from '../../shared/sourceContracts.js';
import type { StructuredPatch } from '../../types/evolution.js';
import type { CandidateSummary, GenerateDedup } from '../bootstrap/GenerateDedup.js';
import {
  createRecipeCandidateFingerprintProjectionV1,
  type PreparedRecipePersistenceV1,
  type RecipeCandidateFingerprintProjectionV1,
} from '../production/ProductionPersistenceContracts.js';
import type { RetrievalReadinessReport } from './RecipeRetrieval.js';

/** Lightweight log interface — avoids importing static-only Logger class. */
interface GatewayLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/* ═══════════════════ Types ═══════════════════ */

export type { GatewaySource } from '../../shared/sourceContracts.js';
export {
  getGatewaySourceLabel,
  getGatewaySourceUserId,
  normalizeGatewaySource,
} from '../../shared/sourceContracts.js';

export interface CreateRecipeItem {
  title?: string;
  description?: string;
  content?: { markdown?: string; pattern?: string; rationale?: string; [key: string]: unknown };
  trigger?: string;
  kind?: string;
  topicHint?: string;
  whenClause?: string;
  doClause?: string;
  dontClause?: string;
  coreCode?: string;
  sourceRefs?: string[];
  tags?: string[];
  reasoning?: { whyStandard?: string; sources?: string[]; confidence?: number };
  headers?: string[];
  usageGuide?: string;
  retrievalProfile?: RecipeRetrievalProfile | null;
  scope?: string;
  complexity?: string;
  sourceFile?: string;
  sourceCandidateId?: string;
  dimensionId?: string;
  knowledgeType?: string;
  language?: string;
  category?: string;
  source?: string;
  moduleName?: string;
  headerPaths?: string[];
  includeHeaders?: boolean;
  relations?: unknown;
  agentNotes?: string | null;
  aiInsight?: string | null;
  localRelationKey?: string;
  relationKey?: string;
  stableRelationKey?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateRecipeRequest {
  source: GatewaySource;
  items: CreateRecipeItem[];
  options?: {
    /** 跳过相似度检测（仅 batch-import 可用） */
    skipSimilarityCheck?: boolean;
    /** 跳过 ConsolidationAdvisor 分析 */
    skipConsolidation?: boolean;
    /** 被替代的旧 Recipe ID */
    supersedes?: string;
    /** 相似度阈值，默认 0.7 */
    similarityThreshold?: number;
    /** 已提交标题集（批量去重用） */
    existingTitles?: Set<string>;
    /** 已提交 trigger 集（批量/会话去重用） */
    existingTriggers?: Set<string>;
    /** 已提交指纹集（批量去重用） */
    existingFingerprints?: Set<string>;
    /** UnifiedValidator 跳过系统注入字段列表 */
    systemInjectedFields?: string[];
    /** 跳过唯一性校验 */
    skipUniqueness?: boolean;
    /** 操作用户 ID */
    userId?: string;
    /** Bootstrap 会话级去重缓存（冷启动跨维度去重） */
    bootstrapDedup?: GenerateDedup;
  };
}

export interface CreatedRecipeInfo {
  index: number;
  id: string;
  title: string;
  lifecycle: string;
  /** Raw saved entry from KnowledgeService.create() */
  raw: Record<string, unknown>;
}

export interface RejectedRecipeInfo {
  index: number;
  title: string;
  reason: string;
  errors: string[];
  warnings: string[];
}

export interface MergedRecipeInfo {
  index: number;
  proposalId: string;
  type: string;
  targetRecipeId: string;
  targetTitle: string;
  status: string;
  expiresAt: number;
  message: string;
}

export interface BlockedRecipeInfo {
  index: number;
  title: string;
  consolidation: unknown;
}

export interface SimilarRecipeInfo {
  index: number;
  title: string;
  similarTo: { file: string; title: string; similarity: number }[];
}

export interface CreateRecipeResult {
  created: CreatedRecipeInfo[];
  rejected: RejectedRecipeInfo[];
  merged: MergedRecipeInfo[];
  blocked: BlockedRecipeInfo[];
  duplicates: SimilarRecipeInfo[];
  supersedeProposal: { proposalId: string } | null;
  /** Layer 1.5: 需要语义复核的条目（similarity 0.4-0.65 且字段分析不明确） */
  pendingSemanticReview?: Array<{
    index: number;
    title: string;
    newRecipeId?: string;
    createdRecipe?: { id: string; title: string; lifecycle: string };
    relatedRecipe?: { id: string; title: string; similarity: number };
    reason: string;
  }>;
}

export type RecipeProducerCapability =
  | 'cold-start'
  | 'incremental'
  | 'module-scan'
  | 'knowledge-submit';

export type RecipeProductionSource = Exclude<GatewaySource, 'batch-import'>;

const RECIPE_PRODUCER_CAPABILITIES = new Set<RecipeProducerCapability>([
  'cold-start',
  'incremental',
  'module-scan',
  'knowledge-submit',
]);

const RECIPE_PRODUCTION_SOURCES = new Set<RecipeProductionSource>([
  'agent-tool',
  'mcp-external',
  'host-agent',
  'alembic-agent',
  'ide-agent',
]);

function admitRecipeProducerCapability(value: unknown): RecipeProducerCapability {
  if (value === undefined || value === null || value === '') {
    throw new Error('recipe-production-capability-missing');
  }
  if (!RECIPE_PRODUCER_CAPABILITIES.has(value as RecipeProducerCapability)) {
    throw new Error('recipe-production-capability-invalid');
  }
  return value as RecipeProducerCapability;
}

function admitRecipeProductionSource(value: unknown): RecipeProductionSource {
  if (value === 'batch-import') {
    throw new Error('recipe-production-source-prohibited');
  }
  if (!RECIPE_PRODUCTION_SOURCES.has(value as RecipeProductionSource)) {
    throw new Error('recipe-production-source-invalid');
  }
  return value as RecipeProductionSource;
}

export interface RecipeProductionInput {
  items: CreateRecipeItem[];
  options?: Omit<NonNullable<CreateRecipeRequest['options']>, 'userId'>;
}

export interface ProducerContext {
  source: RecipeProductionSource;
  userId: string;
  capability: RecipeProducerCapability;
}

export interface PublishContext {
  userId: string;
}

export interface RecipeProductionRecord {
  id: string;
  title: string;
  lifecycle: string;
  sourceFile?: string | null;
  retrievalProfile?: RecipeRetrievalProfile | null;
}

export interface RecipeProductionEvidence {
  capability: RecipeProducerCapability;
  source: Exclude<CanonicalGatewaySource, 'batch-import'>;
}

export interface RecipeProductionResult extends CreateRecipeResult {
  production: RecipeProductionEvidence;
}

/** Consumer-facing production boundary shared by every Recipe producer. */
export interface RecipeProductionPort {
  createOrStage(
    input: RecipeProductionInput,
    context: ProducerContext
  ): Promise<RecipeProductionResult>;
  evaluateReadiness(recipeId: string): Promise<RetrievalReadinessReport>;
  publish(recipeId: string, context: PublishContext): Promise<RecipeProductionRecord>;
}

export interface StrictPreparedRecipePersistenceContextV1 {
  readonly source: RecipeProductionSource;
  readonly userId: string;
  readonly journalToken: string;
  /** Exact G1-reviewed authoring projection; the Gateway recomputes it from `item`. */
  readonly reviewedProjection: RecipeCandidateFingerprintProjectionV1;
}

export interface StrictPreparedRecipePersistenceResultV1 {
  readonly status: 'created' | 'recovered';
  readonly recipe: RecipeProductionRecord;
  readonly prepared: PreparedRecipePersistenceV1;
  /** A strict prepared path never invokes the entity's random UUID fallback. */
  readonly strictUuidAllocations: 0;
}

export interface StrictPreparedRecipePersistencePortV1 {
  persistPreparedReviewedCandidate(
    item: CreateRecipeItem,
    prepared: PreparedRecipePersistenceV1,
    context: StrictPreparedRecipePersistenceContextV1
  ): Promise<StrictPreparedRecipePersistenceResultV1>;
}

/* ═══════════════════ Dependencies ═══════════════════ */

interface GatewayKnowledgeService {
  create(
    data: Record<string, unknown>,
    context: { userId: string }
  ): Promise<{
    id: string;
    title: string;
    lifecycle: string;
    kind?: string;
    [key: string]: unknown;
  }>;
  update(
    id: string,
    data: Record<string, unknown>,
    context: { userId: string }
  ): Promise<{
    id: string;
    title: string;
    lifecycle: string;
    kind?: string;
    [key: string]: unknown;
  }>;
  updateQuality(id: string, context: { userId: string }): Promise<unknown>;
  evaluateRetrievalReadiness?(id: string): Promise<RetrievalReadinessReport>;
  publish?(id: string, context: { userId: string }): Promise<RecipeProductionRecord>;
}

interface GatewayConsolidationAdvisor {
  analyzeBatch(
    candidates: Array<{ title: string; category?: string; [key: string]: unknown }>
  ): Promise<{
    items: Array<{
      index: number;
      advice: {
        action: string;
        confidence: number;
        reason: string;
        targetRecipe?: { id: string; title: string; similarity: number };
        reorganizeTargets?: { id: string; title: string; similarity: number }[];
        coveredBy?: { id: string; title: string; similarity: number }[];
        mergeDirection?: { addedDimensions: string[]; summary: string };
        mergePatch?: StructuredPatch;
        pendingSemanticReview?: boolean;
      };
    }>;
    internalOverlaps: Array<{ indexA: number; indexB: number; similarity: number }>;
  }>;
}

interface GatewayProposalRepository {
  create(data: Record<string, unknown>): {
    id: string;
    status: string;
    expiresAt: number;
    [key: string]: unknown;
  } | null;
}

/** ProposalGateway — 统一进化决策提交接口 */
interface GatewayProposalGateway {
  submit(decision: {
    recipeId: string;
    action: 'update' | 'deprecate' | 'valid';
    source: string;
    confidence: number;
    description?: string;
    evidence?: Record<string, unknown>[];
    replacedByRecipeId?: string;
  }): Promise<{
    recipeId: string;
    action: string;
    outcome: string;
    proposalId?: string;
    error?: string;
  }>;
}

type GatewaySimilarityFn = (
  projectRoot: string,
  candidate: { title: string; summary: string; code: string },
  opts: { threshold: number; topK: number }
) => { file: string; title: string; similarity: number }[];

type NormalizedRelationEntry = {
  target: string;
  description: string;
  [key: string]: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATION_BUCKET_SET = new Set<string>(RELATION_BUCKETS);

export interface GatewayDeps {
  knowledgeService: GatewayKnowledgeService;
  projectRoot: string;
  logger?: GatewayLogger;
  /** ConsolidationAdvisor（可选 — MCP 路径使用） */
  consolidationAdvisor?: GatewayConsolidationAdvisor | null;
  /** ProposalRepository（可选 — 仅用于检查已有提案等直接操作） */
  proposalRepository?: GatewayProposalRepository | null;
  /** ProposalGateway（可选 — 优先通过 Gateway 创建进化提案） */
  proposalGateway?: GatewayProposalGateway | null;
  /** 相似度检测函数（可选 — 默认导入 SimilarityService） */
  findSimilarRecipes?: GatewaySimilarityFn | null;
  /** U1 #5：canonical 模块轴 name 校验集（Agent 显式 moduleName 须属此集；U1-Plugin 从 ProjectMap.modules 注入）。 */
  knownModuleNames?: readonly string[];
  /** U1 #5：从 candidate sourceRefs 落点派生 canonical 模块 name（U1-Plugin 从 ProjectContextMap 注入）。 */
  resolveModuleFromSourceRefs?: (sourceRefs: string[]) => string | undefined;
  /** Strict-only journal authority; ordinary create requests never carry this token or an ID. */
  authorizePreparedRecipe?: (
    journalToken: string,
    prepared: PreparedRecipePersistenceV1,
    reviewedProjection: RecipeCandidateFingerprintProjectionV1
  ) => boolean | Promise<boolean>;
  /** Revision-scoped DB/file inspection used for exact crash recovery and readback. */
  inspectPreparedRecipe?: (
    prepared: PreparedRecipePersistenceV1
  ) => Promise<PreparedRecipeInspectionV1 | null>;
}

export interface PreparedRecipeInspectionV1 extends RecipeProductionRecord {
  readonly privateCorpusRevision: string;
  readonly dbHash: string;
  readonly fileHash: string;
}

/* ═══════════════════ Gateway ═══════════════════ */

export class RecipeProductionGateway
  implements RecipeProductionPort, StrictPreparedRecipePersistencePortV1
{
  readonly #knowledgeService: GatewayKnowledgeService;
  readonly #projectRoot: string;
  readonly #logger?: GatewayLogger;
  readonly #consolidationAdvisor: GatewayConsolidationAdvisor | null;
  readonly #proposalRepo: GatewayProposalRepository | null;
  readonly #proposalGateway: GatewayProposalGateway | null;
  readonly #findSimilarRecipes: GatewaySimilarityFn | null;
  readonly #knownModuleNames: Set<string> | null;
  readonly #resolveModuleFromSourceRefs: ((sourceRefs: string[]) => string | undefined) | null;
  readonly #authorizePreparedRecipe: GatewayDeps['authorizePreparedRecipe'];
  readonly #inspectPreparedRecipe: GatewayDeps['inspectPreparedRecipe'];

  constructor(deps: GatewayDeps) {
    this.#knowledgeService = deps.knowledgeService;
    this.#projectRoot = deps.projectRoot;
    this.#logger = deps.logger;
    this.#consolidationAdvisor = deps.consolidationAdvisor ?? null;
    this.#proposalRepo = deps.proposalRepository ?? null;
    this.#proposalGateway = deps.proposalGateway ?? null;
    this.#findSimilarRecipes = deps.findSimilarRecipes ?? null;
    this.#knownModuleNames = deps.knownModuleNames ? new Set(deps.knownModuleNames) : null;
    this.#resolveModuleFromSourceRefs = deps.resolveModuleFromSourceRefs ?? null;
    this.#authorizePreparedRecipe = deps.authorizePreparedRecipe;
    this.#inspectPreparedRecipe = deps.inspectPreparedRecipe;
  }

  async persistPreparedReviewedCandidate(
    item: CreateRecipeItem,
    prepared: PreparedRecipePersistenceV1,
    context: StrictPreparedRecipePersistenceContextV1
  ): Promise<StrictPreparedRecipePersistenceResultV1> {
    const source = admitRecipeProductionSource(context.source);
    if (!this.#authorizePreparedRecipe || !this.#inspectPreparedRecipe) {
      throw new Error('STRICT_PREPARED_PERSISTENCE_AUTHORITY_UNAVAILABLE');
    }
    assertPreparedRecipeAuthoringProjection(item, prepared, context.reviewedProjection);
    if (
      !(await this.#authorizePreparedRecipe(
        context.journalToken,
        prepared,
        context.reviewedProjection
      ))
    ) {
      throw new Error('STRICT_PREPARED_PERSISTENCE_UNAUTHORIZED');
    }
    const existing = await this.#inspectPreparedRecipe(prepared);
    if (existing) {
      assertPreparedRecipeInspection(existing, prepared);
      return {
        status: 'recovered',
        recipe: existing,
        prepared,
        strictUuidAllocations: 0,
      };
    }

    const data = this.#prepareCreateData(item, source, context.userId, prepared.preparedRecipeId);
    const saved = await this.#knowledgeService.create(data, { userId: context.userId });
    if (saved.id !== prepared.preparedRecipeId) {
      throw new Error('STRICT_PREPARED_ID_DIVERGENCE');
    }
    const inspected = await this.#inspectPreparedRecipe(prepared);
    if (!inspected) {
      throw new Error('STRICT_PREPARED_PERSISTENCE_READBACK_MISSING');
    }
    assertPreparedRecipeInspection(inspected, prepared);
    return {
      status: 'created',
      recipe: inspected,
      prepared,
      strictUuidAllocations: 0,
    };
  }

  async createOrStage(
    input: RecipeProductionInput,
    context: ProducerContext
  ): Promise<RecipeProductionResult> {
    const capability = admitRecipeProducerCapability(context.capability);
    const source = admitRecipeProductionSource(context.source);
    const result = await this.create({
      source,
      items: input.items,
      options: { ...input.options, userId: context.userId },
    });
    return {
      ...result,
      production: {
        capability,
        source: normalizeGatewaySource(source) as Exclude<CanonicalGatewaySource, 'batch-import'>,
      },
    };
  }

  async evaluateReadiness(recipeId: string): Promise<RetrievalReadinessReport> {
    if (!this.#knowledgeService.evaluateRetrievalReadiness) {
      throw new Error('recipe-production-readiness-unavailable');
    }
    return this.#knowledgeService.evaluateRetrievalReadiness(recipeId);
  }

  async publish(recipeId: string, context: PublishContext): Promise<RecipeProductionRecord> {
    if (!this.#knowledgeService.publish) {
      throw new Error('recipe-production-publish-unavailable');
    }
    return this.#knowledgeService.publish(recipeId, context);
  }

  /**
   * U1 #5：moduleName canonical 派生 —— Agent 显式给则校验属已知模块轴（越界→留空+诊断）；
   * 未显式则从 candidate sourceRefs 落点的 canonical 模块派生（与覆盖轴同源）；派生不出→留空+诊断（不再恒空兜底）。
   * 未注入模块轴 deps 时退回原行为（显式透传、否则留空）—— 加性、向后兼容。
   */
  #deriveModuleName(item: CreateRecipeItem, metadata: Record<string, unknown>): string {
    const explicit = item.moduleName || this.#readString(metadata.moduleName) || '';
    if (explicit) {
      if (this.#knownModuleNames && !this.#knownModuleNames.has(explicit)) {
        this.#logger?.warn(
          `[Gateway] moduleName "${explicit}" 不属 canonical 模块轴 → 留空（CG ②a required-or-derivable）`
        );
        return '';
      }
      return explicit;
    }
    const derived = this.#resolveModuleFromSourceRefs?.(item.sourceRefs ?? []);
    if (derived) {
      return derived;
    }
    if ((item.sourceRefs ?? []).length > 0) {
      this.#logger?.info(
        '[Gateway] moduleName 无法从 sourceRefs 派生（落点不在 canonical 模块轴）→ 留空+诊断'
      );
    }
    return '';
  }

  /**
   * 统一创建入口
   *
   * Pipeline:
   *   1. Schema Validation (UnifiedValidator)
   *   2. Similarity Check (除非 skipSimilarityCheck)
   *   3. Consolidation Scan (除非 skipConsolidation)
   *   4. KnowledgeService.create() — ConfidenceRouter → staging / pending
   *   5. Quality Scoring
   *   6. Supersede Proposal 创建 (if supersedes)
   */
  async create(request: CreateRecipeRequest): Promise<CreateRecipeResult> {
    const { source, items, options = {} } = request;
    const userId = options.userId || this.#sourceToUserId(source);

    const result: CreateRecipeResult = {
      created: [],
      rejected: [],
      merged: [],
      blocked: [],
      duplicates: [],
      supersedeProposal: null,
    };
    const pendingReviews: NonNullable<CreateRecipeResult['pendingSemanticReview']> = [];

    if (items.length === 0) {
      return result;
    }

    // ── Step 1: Schema Validation ──
    const validator = new UnifiedValidator({
      existingTitles: options.existingTitles,
      existingTriggers: options.existingTriggers,
      existingFingerprints: options.existingFingerprints,
    });

    const validItems: { index: number; item: CreateRecipeItem }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const validation = validator.validate(item as Record<string, unknown>, {
        systemInjectedFields: options.systemInjectedFields,
        skipUniqueness: options.skipUniqueness,
      });

      if (!validation.pass) {
        result.rejected.push({
          index: i,
          title: item.title || '(untitled)',
          reason: 'validation_failed',
          errors: validation.errors,
          warnings: validation.warnings,
        });
        this.#logger?.info(
          `[Gateway] ✗ validation rejected item ${i}: ${validation.errors.join('; ')}`
        );
      } else {
        validItems.push({ index: i, item });
        // 记录已提交标题/指纹以防批量内重复
        validator.recordSubmission(
          item.title,
          (item.content as Record<string, unknown> | undefined)?.pattern as string | undefined,
          item.trigger
        );
      }
    }

    // ── Step 1.5: Bootstrap Session-Level Dedup (fast, in-memory) ──
    let afterDedupItems = validItems;

    if (options.bootstrapDedup && validItems.length > 0) {
      afterDedupItems = [];
      for (const entry of validItems) {
        const { item, index } = entry;
        const summary: CandidateSummary = {
          id: '',
          title: item.title || '',
          category: item.category || ((item as Record<string, unknown>)._category as string) || '',
          coreCode: item.coreCode || '',
          doClause: item.doClause || '',
          dontClause: item.dontClause || '',
          guardPattern: item.content?.pattern,
        };
        const match = options.bootstrapDedup.findDuplicate(summary);
        if (match) {
          result.duplicates.push({
            index,
            title: item.title || '(untitled)',
            similarTo: [{ file: '', title: match.existingTitle, similarity: match.similarity }],
          });
          this.#logger?.info(
            `[Gateway] ✗ bootstrap dedup blocked item ${index}: "${item.title}" ≈ "${match.existingTitle}" (${match.similarity})`
          );
        } else {
          afterDedupItems.push(entry);
        }
      }
    }

    // ── Step 2: Similarity Check ──
    let afterSimilarityItems = afterDedupItems;

    // 普通 agent/mcp/ide 提交通道不允许跳过相似度检测；只有离线 batch-import
    // 可以显式跳过，用于受控迁移或恢复。
    const skipSimilarityCheck = source === 'batch-import' && options.skipSimilarityCheck === true;

    if (!skipSimilarityCheck && this.#findSimilarRecipes) {
      const threshold = options.similarityThreshold ?? 0.7;
      afterSimilarityItems = [];

      for (const entry of afterDedupItems) {
        const { item, index } = entry;
        const contentObj =
          item.content && typeof item.content === 'object' ? item.content : { markdown: '' };
        const cand = {
          title: item.title || '',
          summary: item.description || '',
          code: (contentObj.markdown as string) || (contentObj.pattern as string) || '',
        };

        const similar = this.#findSimilarRecipes(this.#projectRoot, cand, {
          threshold: 0.5,
          topK: 5,
        });
        const hasDuplicate = similar.some((s) => s.similarity >= threshold);

        if (hasDuplicate) {
          result.duplicates.push({
            index,
            title: item.title || '(untitled)',
            similarTo: similar,
          });
          this.#logger?.info(
            `[Gateway] ✗ duplicate blocked item ${index}: similarity ${similar[0]?.similarity}`
          );
        } else {
          afterSimilarityItems.push(entry);
        }
      }
    }

    // ── Step 3: Consolidation Scan ──
    let submittableItems = afterSimilarityItems;

    if (
      !options.skipConsolidation &&
      this.#consolidationAdvisor &&
      afterSimilarityItems.length > 0
    ) {
      submittableItems = [];
      try {
        const candidates = afterSimilarityItems.map((e) => ({
          title: e.item.title || '',
          category:
            e.item.category || ((e.item as Record<string, unknown>)._category as string) || '',
          ...e.item,
        }));

        const batchAdvice = await this.#consolidationAdvisor.analyzeBatch(candidates);

        // ── Step 3.1: 处理批次内部重叠 ──
        const removedByOverlap = new Set<number>();
        if (batchAdvice.internalOverlaps && batchAdvice.internalOverlaps.length > 0) {
          for (const overlap of batchAdvice.internalOverlaps) {
            if (overlap.similarity >= 0.65) {
              // 移除指数较大的一方（后面的候选假定较弱）
              const weaker = overlap.indexB;
              if (!removedByOverlap.has(weaker)) {
                removedByOverlap.add(weaker);
                const weakerEntry = afterSimilarityItems[weaker];
                if (weakerEntry) {
                  const strongerEntry = afterSimilarityItems[overlap.indexA];
                  result.duplicates.push({
                    index: weakerEntry.index,
                    title: weakerEntry.item.title || '(untitled)',
                    similarTo: [
                      {
                        file: '',
                        title: strongerEntry?.item.title || '(unknown)',
                        similarity: overlap.similarity,
                      },
                    ],
                  });
                  this.#logger?.info(
                    `[Gateway] ✗ batch-internal-overlap removed item ${weaker}: "${weakerEntry.item.title}" ≈ item ${overlap.indexA} (${overlap.similarity})`
                  );
                }
              }
            }
          }
        }

        for (let ai = 0; ai < batchAdvice.items.length; ai++) {
          const { advice } = batchAdvice.items[ai];
          const validEntry = afterSimilarityItems[ai];
          if (!validEntry) {
            continue;
          }

          // 跳过被批次内重叠移除的候选
          if (removedByOverlap.has(ai)) {
            continue;
          }

          // Layer 1.5: 收集 pendingSemanticReview
          if (advice.pendingSemanticReview) {
            pendingReviews.push({
              index: validEntry.index,
              title: validEntry.item.title || '(untitled)',
              relatedRecipe: advice.targetRecipe ?? undefined,
              reason: advice.reason,
            });
          }

          if (advice.action === 'create') {
            submittableItems.push(validEntry);
          } else if (this.#proposalGateway || this.#proposalRepo) {
            const proposal = await this.#createProposalFromAdvice(advice, validEntry.item);
            if (proposal) {
              result.merged.push({
                index: validEntry.index,
                proposalId: proposal.proposalId,
                type: proposal.type,
                targetRecipeId: proposal.targetRecipeId,
                targetTitle: proposal.targetTitle,
                status: proposal.status,
                expiresAt: proposal.expiresAt,
                message: proposal.message,
              });
            } else {
              // Proposal 创建失败 → blocked
              result.blocked.push({
                index: validEntry.index,
                title: validEntry.item.title || '(untitled)',
                consolidation: advice,
              });
            }
          } else {
            // 无 ProposalRepository → blocked
            result.blocked.push({
              index: validEntry.index,
              title: validEntry.item.title || '(untitled)',
              consolidation: advice,
            });
          }
        }

        // pendingSemanticReview 会在创建完成后再回填 newRecipeId，避免下游只能猜 title。
      } catch (err: unknown) {
        this.#logger?.warn(
          `[Gateway] ConsolidationAdvisor error, falling back to direct submit: ${err instanceof Error ? err.message : String(err)}`
        );
        submittableItems = afterSimilarityItems;
      }
    }

    // ── Step 4: Create via KnowledgeService ──
    const createdIds: string[] = [];
    const createdByIndex = new Map<number, CreatedRecipeInfo>();
    const createdByLocalRelationKey = new Map<string, CreatedRecipeInfo>();
    const createdWorkItems: Array<{
      item: CreateRecipeItem;
      created: CreatedRecipeInfo;
    }> = [];

    for (const { item, index } of submittableItems) {
      try {
        const data = this.#prepareCreateData(item, source, userId);
        const saved = await this.#knowledgeService.create(data, { userId });

        const created: CreatedRecipeInfo = {
          index,
          id: saved.id,
          title: saved.title,
          lifecycle: saved.lifecycle,
          raw: saved as Record<string, unknown>,
        };
        result.created.push(created);
        createdByIndex.set(index, created);
        createdIds.push(saved.id);
        createdWorkItems.push({ item, created });

        const localRelationKey = this.#getLocalRelationKey(item);
        if (localRelationKey) {
          createdByLocalRelationKey.set(localRelationKey, created);
        }

        // Register to bootstrap session dedup cache
        options.bootstrapDedup?.register({
          id: saved.id,
          title: saved.title,
          category: item.category || ((item as Record<string, unknown>)._category as string) || '',
          coreCode: item.coreCode || '',
          doClause: item.doClause || '',
          dontClause: item.dontClause || '',
          guardPattern: item.content?.pattern,
        });

        // ── Step 5: Quality Scoring (best effort) ──
        try {
          await this.#knowledgeService.updateQuality(saved.id, { userId });
        } catch {
          /* best effort — 不阻塞创建流程 */
        }
      } catch (err: unknown) {
        result.rejected.push({
          index,
          title: item.title || '(untitled)',
          reason: 'create_failed',
          errors: [err instanceof Error ? err.message : String(err)],
          warnings: [],
        });
        this.#logger?.warn(
          `[Gateway] ✗ create failed for "${item.title}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (createdByLocalRelationKey.size > 0) {
      for (const { item, created } of createdWorkItems) {
        const resolved = this.#resolveBatchRelations(item.relations, createdByLocalRelationKey);
        if (!resolved.changed) {
          continue;
        }
        try {
          const updated = await this.#knowledgeService.update(
            created.id,
            { relations: resolved.relations },
            { userId }
          );
          created.raw = updated as Record<string, unknown>;
        } catch (err: unknown) {
          result.rejected.push({
            index: created.index,
            title: created.title,
            reason: 'relation_resolution_failed',
            errors: [err instanceof Error ? err.message : String(err)],
            warnings: resolved.unresolvedTargets.map(
              (target) => `unresolved batch relation target: ${target}`
            ),
          });
          this.#logger?.warn(
            `[Gateway] ✗ relation resolution failed for "${created.title}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    if (pendingReviews.length > 0) {
      result.pendingSemanticReview = pendingReviews.map((review) => {
        const created = createdByIndex.get(review.index);
        if (!created) {
          return review;
        }
        return {
          ...review,
          newRecipeId: created.id,
          createdRecipe: {
            id: created.id,
            title: created.title,
            lifecycle: created.lifecycle,
          },
        };
      });
    }

    // ── Step 6: Supersede Proposal ──
    if (options.supersedes && createdIds.length > 0) {
      try {
        if (this.#proposalGateway) {
          // 优先通过 ProposalGateway 提交 deprecate（supersede 语义）
          const gwResult = await this.#proposalGateway.submit({
            recipeId: options.supersedes,
            action: 'deprecate',
            source: 'consolidation',
            confidence: 0.9,
            description: `Supersede proposal: ${createdIds.length} new recipe(s) replace ${options.supersedes}`,
            evidence: [{ snapshotAt: Date.now(), newRecipeIds: createdIds }],
            replacedByRecipeId: createdIds[0],
          });
          if (gwResult.proposalId || gwResult.outcome === 'immediately-executed') {
            result.supersedeProposal = {
              proposalId: gwResult.proposalId ?? `immediate-${options.supersedes}`,
            };
          }
        } else if (this.#proposalRepo) {
          // 降级：直接 ProposalRepo（无 Gateway 时）
          const proposal = this.#proposalRepo.create({
            type: 'deprecate',
            targetRecipeId: options.supersedes,
            relatedRecipeIds: createdIds,
            confidence: 0.9,
            source: 'consolidation',
            description: `Supersede proposal: ${createdIds.length} new recipe(s) replace ${options.supersedes}`,
            evidence: [{ snapshotAt: Date.now(), newRecipeIds: createdIds }],
          });
          if (proposal) {
            result.supersedeProposal = { proposalId: proposal.id };
          }
        }
      } catch (err: unknown) {
        this.#logger?.warn(
          `[Gateway] Supersede proposal creation failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.#logger?.info(
      `[Gateway] create complete: ${result.created.length} created, ${result.rejected.length} rejected, ${result.merged.length} merged, ${result.duplicates.length} duplicates | source=${source}`
    );

    return result;
  }

  /* ═══════════════════ Private ═══════════════════ */

  #sourceToUserId(source: GatewaySource): string {
    return getGatewaySourceUserId(source);
  }

  #prepareCreateData(
    item: CreateRecipeItem,
    source: GatewaySource,
    _userId: string,
    preparedRecipeId?: string
  ): Record<string, unknown> {
    const metadata = this.#readMetadata(item);
    const contentObj =
      item.content && typeof item.content === 'object'
        ? item.content
        : { markdown: '', pattern: '' };

    const reasoning = item.reasoning || {
      whyStandard: '',
      sources: ['agent'],
      confidence: 0.7,
    };
    if (Array.isArray(reasoning.sources) && reasoning.sources.length === 0) {
      reasoning.sources = ['agent'];
    }

    return {
      ...(preparedRecipeId ? { id: preparedRecipeId } : {}),
      language: item.language || '',
      dimensionId: item.dimensionId || '',
      category: item.category || (item as Record<string, unknown>)._category || 'general',
      knowledgeType: item.knowledgeType || 'code-pattern',
      source: item.source || this.#sourceLabel(source),
      title: item.title || '',
      description: item.description || '',
      tags: item.tags || [],
      trigger: item.trigger || '',
      kind: item.kind || 'pattern',
      topicHint: item.topicHint || '',
      whenClause: item.whenClause || '',
      doClause: item.doClause || '',
      dontClause: item.dontClause || '',
      coreCode: item.coreCode || '',
      sourceRefs: item.sourceRefs || [],
      content: contentObj,
      relations: item.relations ?? metadata.relations ?? {},
      reasoning,
      headers: item.headers || [],
      headerPaths: item.headerPaths || this.#readStringArray(metadata.headerPaths),
      moduleName: this.#deriveModuleName(item, metadata),
      includeHeaders: item.includeHeaders ?? this.#readBoolean(metadata.includeHeaders) ?? false,
      usageGuide: item.usageGuide || '',
      retrievalProfile: item.retrievalProfile ?? null,
      scope: item.scope || '',
      complexity: item.complexity || '',
      sourceFile: item.sourceFile || this.#readString(metadata.sourceFile) || '',
      sourceCandidateId:
        item.sourceCandidateId || this.#readString(metadata.sourceCandidateId) || null,
      agentNotes:
        item.agentNotes ??
        this.#readString(metadata.agentNotes) ??
        this.#stringifyMetadataNotes(metadata),
      aiInsight: item.aiInsight ?? reasoning.whyStandard ?? item.description ?? null,
    };
  }

  #sourceLabel(source: GatewaySource): string {
    return getGatewaySourceLabel(source);
  }

  #readMetadata(item: CreateRecipeItem): Record<string, unknown> {
    return item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata
      : {};
  }

  #readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  #readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  #readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  #stringifyMetadataNotes(metadata: Record<string, unknown>): string | null {
    if (Object.keys(metadata).length === 0) {
      return null;
    }
    return JSON.stringify({ metadata });
  }

  #getLocalRelationKey(item: CreateRecipeItem): string | null {
    const metadata = this.#readMetadata(item);
    return (
      this.#readString(item.localRelationKey) ||
      this.#readString(item.relationKey) ||
      this.#readString(item.stableRelationKey) ||
      this.#readString(metadata.localRelationKey) ||
      this.#readString(metadata.relationKey) ||
      this.#readString(metadata.stableRelationKey)
    );
  }

  #resolveBatchRelations(
    relations: unknown,
    createdByLocalRelationKey: Map<string, CreatedRecipeInfo>
  ): {
    changed: boolean;
    relations: Record<string, NormalizedRelationEntry[]>;
    unresolvedTargets: string[];
  } {
    const buckets = this.#normalizeRelationBuckets(relations);
    const unresolvedTargets: string[] = [];
    let changed = false;

    for (const entries of Object.values(buckets)) {
      for (const entry of entries) {
        const resolved = this.#resolveRelationTarget(entry.target, createdByLocalRelationKey);
        if (resolved.unresolvedLocalTarget) {
          unresolvedTargets.push(entry.target);
        }
        if (resolved.target !== entry.target) {
          entry.target = resolved.target;
          changed = true;
        }
      }
    }

    return { changed, relations: buckets, unresolvedTargets };
  }

  #normalizeRelationBuckets(relations: unknown): Record<string, NormalizedRelationEntry[]> {
    const buckets = Object.fromEntries(
      RELATION_BUCKETS.map((bucket) => [bucket, [] as NormalizedRelationEntry[]])
    );

    if (!relations) {
      return buckets;
    }

    if (Array.isArray(relations)) {
      for (const relation of relations) {
        const record = this.#asRecord(relation);
        const bucket = this.#normalizeRelationBucket(record?.type);
        const entry = this.#normalizeRelationEntry(relation);
        if (bucket && entry) {
          buckets[bucket].push(entry);
        }
      }
      return buckets;
    }

    const record = this.#asRecord(relations);
    if (!record) {
      return buckets;
    }

    for (const [bucket, values] of Object.entries(record)) {
      const normalizedBucket = this.#normalizeRelationBucket(bucket);
      if (!normalizedBucket || !Array.isArray(values)) {
        continue;
      }
      for (const value of values) {
        const entry = this.#normalizeRelationEntry(value);
        if (entry) {
          buckets[normalizedBucket].push(entry);
        }
      }
    }

    return buckets;
  }

  #normalizeRelationBucket(value: unknown): string | null {
    const bucket = typeof value === 'string' && value.trim() ? value.trim() : 'related';
    return RELATION_BUCKET_SET.has(bucket) ? bucket : null;
  }

  #normalizeRelationEntry(value: unknown): NormalizedRelationEntry | null {
    if (typeof value === 'string') {
      const target = value.trim();
      return target ? { target, description: '' } : null;
    }

    const record = this.#asRecord(value);
    if (!record) {
      return null;
    }

    const target = this.#readString(record.target) || this.#readString(record.id);
    if (!target) {
      return null;
    }

    return {
      ...record,
      target,
      description: this.#readString(record.description) || '',
    };
  }

  #resolveRelationTarget(
    target: string,
    createdByLocalRelationKey: Map<string, CreatedRecipeInfo>
  ): { target: string; unresolvedLocalTarget: boolean } {
    const directKnowledgeId = this.#normalizeKnowledgeTargetId(target);
    if (directKnowledgeId) {
      return { target: directKnowledgeId, unresolvedLocalTarget: false };
    }

    const localKey = this.#extractLocalRelationKey(target);
    const created = createdByLocalRelationKey.get(localKey);
    if (created) {
      return { target: created.id, unresolvedLocalTarget: false };
    }

    return { target, unresolvedLocalTarget: localKey !== target };
  }

  #extractLocalRelationKey(target: string): string {
    return target.replace(/^(?:local|relation|relation-key|batch):/i, '').trim();
  }

  #normalizeKnowledgeTargetId(target: string): string | null {
    const trimmed = target.trim();
    if (UUID_RE.test(trimmed)) {
      return trimmed;
    }
    const match = trimmed.match(
      /^knowledge:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );
    return match?.[1] ?? null;
  }

  #asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  async #createProposalFromAdvice(
    advice: {
      action: string;
      confidence: number;
      reason: string;
      targetRecipe?: { id: string; title: string; similarity: number };
      reorganizeTargets?: { id: string; title: string; similarity: number }[];
      coveredBy?: { id: string; title: string; similarity: number }[];
      mergeDirection?: { addedDimensions: string[]; summary: string };
      mergePatch?: StructuredPatch;
    },
    item: CreateRecipeItem
  ): Promise<{
    proposalId: string;
    type: string;
    targetRecipeId: string;
    targetTitle: string;
    status: string;
    expiresAt: number;
    message: string;
  } | null> {
    if (!this.#proposalGateway && !this.#proposalRepo) {
      return null;
    }

    const evidence = [
      {
        snapshotAt: Date.now(),
        candidateTitle: item.title,
        candidateCategory: item.category,
        analysisReason: advice.reason,
        mergeDirection: advice.mergeDirection,
        // U5 #2: 把 mergePatch 升级为 suggestedChanges（JSON），供 ContentPatcher 真实应用、退伪成功。
        suggestedChanges: advice.mergePatch ? JSON.stringify(advice.mergePatch) : undefined,
      },
    ];

    if (advice.action === 'merge' && advice.targetRecipe) {
      if (this.#proposalGateway) {
        const gwResult = await this.#proposalGateway.submit({
          recipeId: advice.targetRecipe.id,
          action: 'update',
          source: 'consolidation',
          confidence: advice.confidence,
          description: advice.reason,
          evidence,
        });
        if (gwResult.error) {
          return null;
        }
        const isImmediate = gwResult.outcome === 'immediately-executed';
        return {
          proposalId: gwResult.proposalId ?? `immediate-${advice.targetRecipe.id}`,
          type: 'update',
          targetRecipeId: advice.targetRecipe.id,
          targetTitle: advice.targetRecipe.title,
          status: isImmediate ? 'executed' : 'observing',
          expiresAt: isImmediate ? 0 : Date.now() + 72 * 3600_000,
          message: `已为「${advice.targetRecipe.title}」创建更新提案，${isImmediate ? '已自动执行' : '观察窗口 72h 后自动执行'}。`,
        };
      }
      const proposal = this.#proposalRepo!.create({
        type: 'update',
        targetRecipeId: advice.targetRecipe.id,
        confidence: advice.confidence,
        source: 'consolidation',
        description: advice.reason,
        evidence,
      });
      if (!proposal) {
        return null;
      }
      return {
        proposalId: proposal.id,
        type: 'update',
        targetRecipeId: advice.targetRecipe.id,
        targetTitle: advice.targetRecipe.title,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        message: `已为「${advice.targetRecipe.title}」创建更新提案，${proposal.status === 'observing' ? '观察窗口 72h 后自动执行' : '等待开发者确认'}。`,
      };
    }

    if (advice.action === 'reorganize' && advice.reorganizeTargets?.length) {
      // reorganize → 为每个目标 Recipe 创建 update 提案
      if (this.#proposalGateway) {
        let firstProposal: {
          proposalId: string;
          type: string;
          targetRecipeId: string;
          targetTitle: string;
          status: string;
          expiresAt: number;
          message: string;
        } | null = null;

        for (const target of advice.reorganizeTargets) {
          try {
            const gwResult = await this.#proposalGateway.submit({
              recipeId: target.id,
              action: 'update',
              source: 'consolidation',
              confidence: Math.min(0.5, advice.confidence),
              description: `Reorganize: 候选与 ${advice.reorganizeTargets.length} 条 Recipe 交叉重叠，建议将相关内容拆分到「${target.title}」`,
              evidence,
            });
            if (!gwResult.error && !firstProposal) {
              const isImmediate = gwResult.outcome === 'immediately-executed';
              firstProposal = {
                proposalId: gwResult.proposalId ?? `immediate-${target.id}`,
                type: 'update',
                targetRecipeId: target.id,
                targetTitle: target.title,
                status: isImmediate ? 'executed' : 'observing',
                expiresAt: isImmediate ? 0 : Date.now() + 72 * 3600_000,
                message: `候选与 ${advice.reorganizeTargets.length} 条 Recipe 交叉重叠，已为「${target.title}」等创建重组提案。`,
              };
            }
          } catch {
            /* best effort — 继续处理其他目标 */
          }
        }
        return firstProposal;
      }
      this.#logger?.info(
        `[Gateway] reorganize advice for ${advice.reorganizeTargets.length} recipes — no ProposalGateway available`
      );
      return null;
    }

    if (advice.action === 'insufficient' && advice.coveredBy?.length) {
      const target = advice.coveredBy[0];
      if (this.#proposalGateway) {
        const gwResult = await this.#proposalGateway.submit({
          recipeId: target.id,
          action: 'update',
          source: 'consolidation',
          confidence: advice.confidence,
          description: advice.reason,
          evidence,
        });
        if (gwResult.error) {
          return null;
        }
        const isImmediate = gwResult.outcome === 'immediately-executed';
        return {
          proposalId: gwResult.proposalId ?? `immediate-${target.id}`,
          type: 'update',
          targetRecipeId: target.id,
          targetTitle: target.title,
          status: isImmediate ? 'executed' : 'observing',
          expiresAt: isImmediate ? 0 : Date.now() + 72 * 3600_000,
          message: `候选独立价值不足，已创建更新提案建议补充到「${target.title}」。`,
        };
      }
      // 降级：直接 ProposalRepo
      const proposal = this.#proposalRepo!.create({
        type: 'update',
        targetRecipeId: target.id,
        confidence: advice.confidence,
        source: 'consolidation',
        description: advice.reason,
        evidence,
      });
      if (!proposal) {
        return null;
      }
      return {
        proposalId: proposal.id,
        type: 'update',
        targetRecipeId: target.id,
        targetTitle: target.title,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        message: `候选独立价值不足，已创建增强提案建议补充到「${target.title}」。`,
      };
    }

    return null;
  }
}

function assertPreparedRecipeInspection(
  inspection: PreparedRecipeInspectionV1,
  prepared: PreparedRecipePersistenceV1
): void {
  if (
    inspection.id !== prepared.preparedRecipeId ||
    inspection.privateCorpusRevision !== prepared.privateCorpusRevision ||
    inspection.dbHash !== prepared.expectedDbHash ||
    inspection.fileHash !== prepared.expectedFileHash
  ) {
    throw new Error('STRICT_PREPARED_PERSISTENCE_DIVERGENCE');
  }
}

function assertPreparedRecipeAuthoringProjection(
  item: CreateRecipeItem,
  prepared: PreparedRecipePersistenceV1,
  reviewed: RecipeCandidateFingerprintProjectionV1
): void {
  const canonicalReviewed = createRecipeCandidateFingerprintProjectionV1({
    title: reviewed.title,
    kind: reviewed.kind,
    doText: reviewed.doText,
    dontText: reviewed.dontText,
    markdown: reviewed.markdown,
    usageGuide: reviewed.usageGuide,
    retrievalProfile: reviewed.retrievalProfile,
    negativeIntents: reviewed.negativeIntents,
    scopeId: reviewed.scopeId,
    moduleId: reviewed.moduleId,
    dimensionId: reviewed.dimensionId,
    evidenceRefs: reviewed.evidenceRefs,
    lineageHashes: reviewed.lineageHashes,
  });
  if (
    reviewed.schemaVersion !== 1 ||
    reviewed.authoredFingerprint !== canonicalReviewed.authoredFingerprint ||
    prepared.authoredFingerprint !== canonicalReviewed.authoredFingerprint ||
    prepared.cellId !== `${canonicalReviewed.moduleId}::${canonicalReviewed.dimensionId}`
  ) {
    throw new Error('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
  }

  const negativeIntents =
    item.retrievalProfile?.exclusions?.map((exclusion) => exclusion.text) ?? [];
  const itemProjection = createRecipeCandidateFingerprintProjectionV1({
    title: item.title ?? '',
    kind: item.kind ?? '',
    doText: item.doClause ?? '',
    dontText: item.dontClause ?? '',
    markdown: item.content?.markdown ?? '',
    usageGuide: item.usageGuide ?? '',
    retrievalProfile: item.retrievalProfile,
    negativeIntents,
    scopeId: item.scope ?? '',
    moduleId: item.moduleName ?? '',
    dimensionId: item.dimensionId ?? '',
    evidenceRefs: item.sourceRefs ?? [],
    lineageHashes: canonicalReviewed.lineageHashes,
  });
  if (itemProjection.authoredFingerprint !== canonicalReviewed.authoredFingerprint) {
    throw new Error('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
  }
}

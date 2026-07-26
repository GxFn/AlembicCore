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
import {
  type CandidateSummary,
  computeCandidateSummarySimilarityV1,
  type GenerateDedup,
} from '../bootstrap/GenerateDedup.js';
import {
  assertStrictAcceptedCorpusInspectionV1,
  assertStrictG1ReceiptV1,
  assertStrictPersistenceAuthorityV1,
  createRecipeCandidateFingerprintProjectionV1,
  createStrictAdmissionReceiptV1,
  type PreparedRecipePersistenceV1,
  type RecipeCandidateFingerprintProjectionV1,
  type StrictAcceptedCorpusEntryV1,
  type StrictAcceptedCorpusInspectionV1,
  type StrictAdmissionReceiptV1,
  type StrictG1ReceiptV1,
  type StrictG2ReceiptV1,
} from '../production/ProductionPersistenceContracts.js';
import { toProjectFactsJson } from '../project-context/foundation/canonical.js';
import type { ProjectFactsJson } from '../project-context/foundation/contracts.js';
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

/**
 * strict 路径唯一允许写入的 Recipe payload。
 *
 * 这里故意不读取 metadata、`_category` 或模块推断器：这些兼容 fallback 只服务 legacy
 * create；若 strict 路径在 G2 后再次解释隐藏字段，写入内容就可能逃逸已封存指纹。
 */
export function createStrictRecipePersistedPayloadV1(
  item: CreateRecipeItem,
  source: RecipeProductionSource
): Record<string, ProjectFactsJson> {
  assertStrictRecipeFallbackFields(item);
  const content = strictObjectOrDefault(item.content, { markdown: '', pattern: '' });
  const reasoning = createStrictRecipeReasoning(item.reasoning);
  return requireStrictRecipePayload(
    toProjectFactsJson({
      language: strictString(item.language),
      dimensionId: strictString(item.dimensionId),
      category: strictString(item.category, 'general'),
      knowledgeType: strictString(item.knowledgeType, 'code-pattern'),
      source: strictString(item.source, getGatewaySourceLabel(source)),
      title: strictString(item.title),
      description: strictString(item.description),
      tags: strictArray(item.tags),
      trigger: strictString(item.trigger),
      kind: strictString(item.kind, 'pattern'),
      topicHint: strictString(item.topicHint),
      whenClause: strictString(item.whenClause),
      doClause: strictString(item.doClause),
      dontClause: strictString(item.dontClause),
      coreCode: strictString(item.coreCode),
      sourceRefs: strictArray(item.sourceRefs),
      content,
      relations: item.relations ?? {},
      reasoning,
      headers: strictArray(item.headers),
      headerPaths: strictArray(item.headerPaths),
      moduleName: strictString(item.moduleName),
      includeHeaders: item.includeHeaders ?? false,
      usageGuide: strictString(item.usageGuide),
      retrievalProfile: item.retrievalProfile ?? null,
      scope: strictString(item.scope),
      complexity: strictString(item.complexity),
      sourceFile: strictString(item.sourceFile),
      sourceCandidateId: item.sourceCandidateId || null,
      agentNotes: item.agentNotes ?? null,
      aiInsight: item.aiInsight ?? reasoning.whyStandard ?? item.description ?? null,
    })
  );
}

function assertStrictRecipeFallbackFields(item: CreateRecipeItem): void {
  if (
    Object.hasOwn(item, '_category') ||
    (item.metadata !== undefined &&
      (!item.metadata ||
        typeof item.metadata !== 'object' ||
        Array.isArray(item.metadata) ||
        Object.keys(item.metadata).length > 0))
  ) {
    throw new Error('STRICT_PREPARED_HIDDEN_FALLBACK_FIELDS_PROHIBITED');
  }
}

function createStrictRecipeReasoning(
  value: CreateRecipeItem['reasoning']
): NonNullable<CreateRecipeItem['reasoning']> {
  return value
    ? {
        ...value,
        sources:
          Array.isArray(value.sources) && value.sources.length > 0 ? [...value.sources] : ['agent'],
      }
    : {
        whyStandard: '',
        sources: ['agent'],
        confidence: 0.7,
      };
}

function strictString(value: string | undefined, fallback = ''): string {
  return value || fallback;
}

function strictArray<T>(value: readonly T[] | undefined): readonly T[] {
  return value || [];
}

function strictObjectOrDefault<T extends object>(value: T | undefined, fallback: T): T {
  return value && typeof value === 'object' ? value : fallback;
}

function requireStrictRecipePayload(canonical: ProjectFactsJson): Record<string, ProjectFactsJson> {
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new Error('STRICT_PREPARED_PAYLOAD_INVALID');
  }
  return canonical;
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
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly g2Receipt: StrictG2ReceiptV1;
}

export interface StrictCandidateAdmissionContextV1 {
  readonly source: RecipeProductionSource;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly revisionRootManifestHash: string;
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly reviewedProjection: RecipeCandidateFingerprintProjectionV1;
}

export interface StrictCandidateAdmissionResultV1 {
  readonly projection: RecipeCandidateFingerprintProjectionV1;
  readonly receipt: StrictAdmissionReceiptV1;
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

interface GatewayConsolidationAdvice {
  action: string;
  confidence: number;
  reason: string;
  targetRecipe?: { id: string; title: string; similarity: number };
  reorganizeTargets?: { id: string; title: string; similarity: number }[];
  coveredBy?: { id: string; title: string; similarity: number }[];
  mergeDirection?: { addedDimensions: string[]; summary: string };
  mergePatch?: StructuredPatch;
  pendingSemanticReview?: boolean;
}

interface GatewayConsolidationAdvisor {
  analyzeAgainstAcceptedCorpus?(
    candidate: { title: string; category?: string; [key: string]: unknown },
    acceptedCorpus: Array<{
      id: string;
      title: string;
      doClause: string | null;
      dontClause: string | null;
      coreCode: string | null;
      category: string | null;
      trigger: string | null;
      whenClause: string | null;
      guardPattern: string | null;
      content: { markdown?: string; pattern?: string } | null;
    }>
  ): GatewayConsolidationAdvice | Promise<GatewayConsolidationAdvice>;
  analyzeBatch(
    candidates: Array<{ title: string; category?: string; [key: string]: unknown }>
  ): Promise<{
    items: Array<{
      index: number;
      advice: GatewayConsolidationAdvice;
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
  /**
   * 严格准入只接受当前物理 revision root 的全量 accepted corpus。
   * 端口返回后 Core 会重算 inspection/corpus hash，并拒绝截断或跨 revision 数据。
   */
  inspectAcceptedRecipeCorpus?: (input: {
    readonly runId: string;
    readonly analysisFixpointHash: string;
    readonly privateCorpusRevision: string;
    readonly revisionRootManifestHash: string;
  }) => Promise<StrictAcceptedCorpusInspectionV1>;
}

export interface PreparedRecipeInspectionV1 extends RecipeProductionRecord {
  readonly privateCorpusRevision: string;
  readonly preparedHash: string;
  readonly admissionId: string;
  readonly g1ReceiptHash: string;
  readonly admissionReceiptHash: string;
  readonly g2ReceiptHash: string;
  readonly authoredFingerprint: string;
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
  readonly #inspectAcceptedRecipeCorpus: GatewayDeps['inspectAcceptedRecipeCorpus'];

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
    this.#inspectAcceptedRecipeCorpus = deps.inspectAcceptedRecipeCorpus;
  }

  async admitCandidate(
    item: CreateRecipeItem,
    context: StrictCandidateAdmissionContextV1
  ): Promise<StrictCandidateAdmissionResultV1> {
    const source = admitRecipeProductionSource(context.source);
    const analyzeAgainstAcceptedCorpus =
      this.#consolidationAdvisor?.analyzeAgainstAcceptedCorpus?.bind(this.#consolidationAdvisor);
    if (!this.#inspectAcceptedRecipeCorpus || !analyzeAgainstAcceptedCorpus) {
      throw new Error('STRICT_ADMISSION_AUTHORITY_UNAVAILABLE');
    }
    assertStrictG1ReceiptV1(context.g1Receipt);
    const projection = assertRecipeItemAuthoringProjection(
      item,
      context.reviewedProjection,
      source
    );
    if (
      context.g1Receipt.verdict !== 'pass' ||
      context.g1Receipt.candidateFingerprint !== projection.authoredFingerprint
    ) {
      throw new Error('STRICT_ADMISSION_G1_MISMATCH');
    }
    return executeStrictCandidateAdmission({
      item,
      context,
      projection,
      inspectAcceptedRecipeCorpus: this.#inspectAcceptedRecipeCorpus,
      analyzeAgainstAcceptedCorpus,
    });
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
    const strictPayload = assertPreparedRecipeAuthoringProjection(
      item,
      prepared,
      context.reviewedProjection,
      source
    );
    assertStrictPersistenceAuthorityV1({
      prepared,
      g1Receipt: context.g1Receipt,
      admissionReceipt: context.admissionReceipt,
      g2Receipt: context.g2Receipt,
      reviewedFingerprint: context.reviewedProjection.authoredFingerprint,
    });
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
      assertPreparedRecipeInspection(existing, prepared, context);
      return {
        status: 'recovered',
        recipe: existing,
        prepared,
        strictUuidAllocations: 0,
      };
    }

    const data = { id: prepared.preparedRecipeId, ...strictPayload };
    const saved = await this.#knowledgeService.create(data, { userId: context.userId });
    if (saved.id !== prepared.preparedRecipeId) {
      throw new Error('STRICT_PREPARED_ID_DIVERGENCE');
    }
    const inspected = await this.#inspectPreparedRecipe(prepared);
    if (!inspected) {
      throw new Error('STRICT_PREPARED_PERSISTENCE_READBACK_MISSING');
    }
    assertPreparedRecipeInspection(inspected, prepared, context);
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

async function executeStrictCandidateAdmission(input: {
  readonly item: CreateRecipeItem;
  readonly context: StrictCandidateAdmissionContextV1;
  readonly projection: RecipeCandidateFingerprintProjectionV1;
  readonly inspectAcceptedRecipeCorpus: NonNullable<GatewayDeps['inspectAcceptedRecipeCorpus']>;
  readonly analyzeAgainstAcceptedCorpus: NonNullable<
    GatewayConsolidationAdvisor['analyzeAgainstAcceptedCorpus']
  >;
}): Promise<StrictCandidateAdmissionResultV1> {
  const corpusInspection = await loadStrictAcceptedCorpus(
    input.context,
    input.inspectAcceptedRecipeCorpus
  );
  const uniquenessValidation = validateStrictAdmissionCandidate(input.item, corpusInspection);
  const exactMatches = findStrictAdmissionExactMatches(
    input.item,
    input.projection,
    corpusInspection
  );
  const semanticMatches = findStrictAdmissionSemanticMatches(
    input.item,
    input.projection,
    corpusInspection
  );
  const advice = await resolveStrictAdmissionAdvice(
    input.item,
    input.projection,
    corpusInspection,
    uniquenessValidation,
    exactMatches,
    input.analyzeAgainstAcceptedCorpus
  );
  const receipt = createStrictAdmissionReceiptFromAdvice(
    input.context,
    input.projection,
    corpusInspection,
    exactMatches,
    semanticMatches,
    advice
  );
  return { projection: input.projection, receipt };
}

async function loadStrictAcceptedCorpus(
  context: StrictCandidateAdmissionContextV1,
  inspect: NonNullable<GatewayDeps['inspectAcceptedRecipeCorpus']>
): Promise<StrictAcceptedCorpusInspectionV1> {
  const corpus = await inspect({
    runId: context.runId,
    analysisFixpointHash: context.analysisFixpointHash,
    privateCorpusRevision: context.privateCorpusRevision,
    revisionRootManifestHash: context.revisionRootManifestHash,
  });
  const invalid = [
    corpus.runId !== context.runId,
    corpus.analysisFixpointHash !== context.analysisFixpointHash,
    corpus.privateCorpusRevision !== context.privateCorpusRevision,
    corpus.revisionRootManifestHash !== context.revisionRootManifestHash,
    corpus.complete !== true,
    corpus.truncated !== false,
    corpus.continuation !== null,
  ];
  if (invalid.some(Boolean)) {
    throw new Error('STRICT_ADMISSION_CORPUS_INCOMPLETE');
  }
  assertStrictAcceptedCorpusInspectionV1(corpus);
  return corpus;
}

function validateStrictAdmissionCandidate(
  item: CreateRecipeItem,
  corpus: StrictAcceptedCorpusInspectionV1
): ReturnType<UnifiedValidator['validate']> {
  const validator = new UnifiedValidator();
  for (const entry of corpus.entries) {
    validator.recordSubmission(
      entry.admissionSummary.title,
      entry.admissionSummary.guardPattern,
      entry.admissionSummary.trigger
    );
  }
  const structural = validator.validate(item as Record<string, unknown>, {
    skipUniqueness: true,
  });
  if (!structural.pass) {
    throw new Error(`STRICT_ADMISSION_VALIDATION_FAILED:${structural.errors.join(';')}`);
  }
  return validator.validate(item as Record<string, unknown>);
}

function findStrictAdmissionExactMatches(
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1,
  corpus: StrictAcceptedCorpusInspectionV1
): StrictAdmissionReceiptV1['exactMatches'] {
  return corpus.entries
    .filter((entry) => strictAdmissionEntryMatches(item, projection, entry))
    .map((entry) => ({
      recipeId: entry.recipeId,
      fingerprint: entry.projection.authoredFingerprint,
    }));
}

function strictAdmissionEntryMatches(
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1,
  entry: StrictAcceptedCorpusEntryV1
): boolean {
  return [
    entry.projection.authoredFingerprint === projection.authoredFingerprint,
    entry.admissionSummary.title.toLowerCase() === projection.title.toLowerCase(),
    Boolean(
      item.trigger && entry.admissionSummary.trigger?.toLowerCase() === item.trigger.toLowerCase()
    ),
    Boolean(item.content?.pattern && entry.admissionSummary.guardPattern === item.content.pattern),
  ].some(Boolean);
}

function findStrictAdmissionSemanticMatches(
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1,
  corpus: StrictAcceptedCorpusInspectionV1
): StrictAdmissionReceiptV1['semanticMatches'] {
  const candidateSummary = candidateSummaryFromItem('', item, projection);
  return corpus.entries
    .map((entry) => ({
      recipeId: entry.recipeId,
      fingerprint: entry.projection.authoredFingerprint,
      similarity: computeCandidateSummarySimilarityV1(
        candidateSummary,
        candidateSummaryFromAcceptedEntry(entry)
      ),
    }))
    .filter((match) => match.similarity >= 0.65)
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.recipeId.localeCompare(right.recipeId)
    );
}

async function resolveStrictAdmissionAdvice(
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1,
  corpus: StrictAcceptedCorpusInspectionV1,
  uniqueness: ReturnType<UnifiedValidator['validate']>,
  exactMatches: StrictAdmissionReceiptV1['exactMatches'],
  analyze: NonNullable<GatewayConsolidationAdvisor['analyzeAgainstAcceptedCorpus']>
): Promise<GatewayConsolidationAdvice> {
  try {
    const advice = await analyze(
      consolidationCandidateFromItem(item, projection),
      corpus.entries.map(strictAcceptedEntryForAdvisor)
    );
    if (advice.pendingSemanticReview) {
      throw new Error('nonterminal consolidation result');
    }
    return uniqueness.pass
      ? advice
      : createStrictExactDuplicateAdvice(uniqueness, exactMatches, corpus);
  } catch (_error: unknown) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_FAILED');
  }
}

function strictAcceptedEntryForAdvisor(entry: StrictAcceptedCorpusEntryV1) {
  return {
    id: entry.recipeId,
    ...entry.admissionSummary,
    content: {
      ...(entry.admissionSummary.markdown ? { markdown: entry.admissionSummary.markdown } : {}),
      ...(entry.admissionSummary.guardPattern
        ? { pattern: entry.admissionSummary.guardPattern }
        : {}),
    },
  };
}

function createStrictExactDuplicateAdvice(
  uniqueness: ReturnType<UnifiedValidator['validate']>,
  exactMatches: StrictAdmissionReceiptV1['exactMatches'],
  corpus: StrictAcceptedCorpusInspectionV1
): GatewayConsolidationAdvice {
  const duplicateTarget = exactMatches[0];
  if (!duplicateTarget) {
    throw new Error('validation uniqueness did not resolve to the inspected corpus');
  }
  const target = corpus.entries.find((entry) => entry.recipeId === duplicateTarget.recipeId);
  return {
    action: 'insufficient',
    confidence: 1,
    reason: `VALIDATION_EXACT_DUPLICATE:${uniqueness.errors.join(';')}`,
    coveredBy: target
      ? [{ id: target.recipeId, title: target.projection.title, similarity: 1 }]
      : [],
  };
}

function createStrictAdmissionReceiptFromAdvice(
  context: StrictCandidateAdmissionContextV1,
  projection: RecipeCandidateFingerprintProjectionV1,
  corpus: StrictAcceptedCorpusInspectionV1,
  exactMatches: StrictAdmissionReceiptV1['exactMatches'],
  semanticMatches: StrictAdmissionReceiptV1['semanticMatches'],
  advice: GatewayConsolidationAdvice
): StrictAdmissionReceiptV1 {
  try {
    const targetId =
      advice.targetRecipe?.id ??
      advice.reorganizeTargets?.[0]?.id ??
      advice.coveredBy?.[0]?.id ??
      null;
    const target = targetId
      ? corpus.entries.find((entry) => entry.recipeId === targetId)
      : undefined;
    const action = normalizeStrictAdmissionAction(advice.action);
    if (
      (action === 'create' && targetId !== null) ||
      (['merge', 'reorganize', 'insufficient'].includes(action) && !target)
    ) {
      throw new Error('consolidation target mismatch');
    }
    return createStrictAdmissionReceiptV1({
      g1Receipt: context.g1Receipt,
      corpusInspection: corpus,
      inputFingerprint: projection.authoredFingerprint,
      finalAdmittedFingerprint: projection.authoredFingerprint,
      exactMatches,
      semanticMatches,
      consolidation: {
        action,
        reasonCode: advice.reason,
        targetRecipeId: target?.recipeId ?? null,
        targetFingerprint: target?.projection.authoredFingerprint ?? null,
      },
      algorithmVersion: 'gateway-admission-v1+generate-dedup-v1+consolidation-advisor-v1',
    });
  } catch (_error: unknown) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_FAILED');
  }
}

function assertPreparedRecipeInspection(
  inspection: PreparedRecipeInspectionV1,
  prepared: PreparedRecipePersistenceV1,
  context: StrictPreparedRecipePersistenceContextV1
): void {
  if (
    inspection.id !== prepared.preparedRecipeId ||
    inspection.privateCorpusRevision !== prepared.privateCorpusRevision ||
    inspection.preparedHash !== prepared.preparedHash ||
    inspection.admissionId !== prepared.admissionId ||
    inspection.g1ReceiptHash !== context.g1Receipt.receiptHash ||
    inspection.admissionReceiptHash !== context.admissionReceipt.receiptHash ||
    inspection.g2ReceiptHash !== context.g2Receipt.receiptHash ||
    inspection.authoredFingerprint !== prepared.authoredFingerprint ||
    inspection.dbHash !== prepared.expectedDbHash ||
    inspection.fileHash !== prepared.expectedFileHash
  ) {
    throw new Error('STRICT_PREPARED_PERSISTENCE_DIVERGENCE');
  }
}

function assertPreparedRecipeAuthoringProjection(
  item: CreateRecipeItem,
  prepared: PreparedRecipePersistenceV1,
  reviewed: RecipeCandidateFingerprintProjectionV1,
  source: RecipeProductionSource
): Record<string, ProjectFactsJson> {
  const canonicalReviewed = canonicalRecipeCandidateProjection(reviewed);
  if (
    prepared.authoredFingerprint !== canonicalReviewed.authoredFingerprint ||
    prepared.cellId !== `${canonicalReviewed.moduleId}::${canonicalReviewed.dimensionId}`
  ) {
    throw new Error('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
  }
  return assertRecipeItemAuthoringProjection(item, canonicalReviewed, source)
    .persistedPayload as Record<string, ProjectFactsJson>;
}

function canonicalRecipeCandidateProjection(
  reviewed: RecipeCandidateFingerprintProjectionV1
): RecipeCandidateFingerprintProjectionV1 {
  const canonical = createRecipeCandidateFingerprintProjectionV1({
    title: reviewed.title,
    kind: reviewed.kind,
    category: reviewed.category,
    trigger: reviewed.trigger,
    whenClause: reviewed.whenClause,
    doText: reviewed.doText,
    dontText: reviewed.dontText,
    coreCode: reviewed.coreCode,
    pattern: reviewed.pattern,
    markdown: reviewed.markdown,
    usageGuide: reviewed.usageGuide,
    retrievalProfile: reviewed.retrievalProfile,
    negativeIntents: reviewed.negativeIntents,
    scopeId: reviewed.scopeId,
    moduleId: reviewed.moduleId,
    dimensionId: reviewed.dimensionId,
    evidenceRefs: reviewed.evidenceRefs,
    lineageHashes: reviewed.lineageHashes,
    persistedPayload: reviewed.persistedPayload,
  });
  if (
    reviewed.schemaVersion !== 1 ||
    reviewed.authoredFingerprint !== canonical.authoredFingerprint
  ) {
    throw new Error('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
  }
  return canonical;
}

function assertRecipeItemAuthoringProjection(
  item: CreateRecipeItem,
  reviewed: RecipeCandidateFingerprintProjectionV1,
  source: RecipeProductionSource
): RecipeCandidateFingerprintProjectionV1 {
  const canonicalReviewed = canonicalRecipeCandidateProjection(reviewed);
  const persistedPayload = createStrictRecipePersistedPayloadV1(item, source);
  const negativeIntents =
    item.retrievalProfile?.exclusions?.map((exclusion) => exclusion.text) ?? [];
  const itemProjection = createRecipeCandidateFingerprintProjectionV1({
    title: item.title ?? '',
    kind: item.kind || 'pattern',
    category: item.category || 'general',
    trigger: item.trigger ?? '',
    whenClause: item.whenClause ?? '',
    doText: item.doClause ?? '',
    dontText: item.dontClause ?? '',
    coreCode: item.coreCode ?? '',
    pattern: item.content?.pattern ?? '',
    markdown: item.content?.markdown ?? '',
    usageGuide: item.usageGuide ?? '',
    retrievalProfile: item.retrievalProfile,
    negativeIntents,
    scopeId: item.scope ?? '',
    moduleId: item.moduleName ?? '',
    dimensionId: item.dimensionId ?? '',
    evidenceRefs: item.sourceRefs ?? [],
    lineageHashes: canonicalReviewed.lineageHashes,
    persistedPayload,
  });
  if (itemProjection.authoredFingerprint !== canonicalReviewed.authoredFingerprint) {
    throw new Error('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
  }
  return itemProjection;
}

function candidateSummaryFromItem(
  id: string,
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1
): CandidateSummary {
  return {
    id,
    title: projection.title,
    category: projection.category || projection.dimensionId,
    coreCode: projection.coreCode || projection.pattern,
    doClause: projection.doText,
    dontClause: projection.dontText,
    guardPattern: projection.pattern || undefined,
  };
}

function candidateSummaryFromAcceptedEntry(entry: StrictAcceptedCorpusEntryV1): CandidateSummary {
  return {
    id: entry.recipeId,
    title: entry.admissionSummary.title,
    category: entry.admissionSummary.category ?? entry.projection.dimensionId,
    coreCode: entry.admissionSummary.coreCode ?? '',
    doClause: entry.admissionSummary.doClause ?? '',
    dontClause: entry.admissionSummary.dontClause ?? '',
    ...(entry.admissionSummary.guardPattern
      ? { guardPattern: entry.admissionSummary.guardPattern }
      : {}),
  };
}

function consolidationCandidateFromItem(
  item: CreateRecipeItem,
  projection: RecipeCandidateFingerprintProjectionV1
): {
  title: string;
  category?: string;
  [key: string]: unknown;
} {
  return {
    title: projection.title,
    category: projection.category || projection.dimensionId,
    trigger: projection.trigger || undefined,
    whenClause: projection.whenClause || undefined,
    doClause: projection.doText,
    dontClause: projection.dontText,
    coreCode: projection.coreCode || projection.pattern,
    kind: projection.kind,
    content: {
      pattern: projection.pattern || undefined,
      markdown: projection.markdown,
    },
  };
}

function normalizeStrictAdmissionAction(
  action: string
): 'create' | 'merge' | 'reorganize' | 'insufficient' | 'reject' {
  if (
    action !== 'create' &&
    action !== 'merge' &&
    action !== 'reorganize' &&
    action !== 'insufficient' &&
    action !== 'reject'
  ) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_FAILED');
  }
  return action;
}

/**
 * SearchTypes — SearchEngine 共享类型定义
 *
 * 从 SearchEngine.ts 提取的所有接口和类型，
 * 供 SearchEngine、FieldWeightedScorer 及测试文件独立消费。
 *
 * @module SearchTypes
 */

import path from 'node:path';

import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import { ProjectRegistry } from '../../shared/ProjectRegistry.js';

/** Internal scorer document representation */
export interface ScorerDocument {
  id: string;
  tokens: string[];
  tokenFreq: Record<string, number>;
  length: number;
  meta: Record<string, unknown>;
}

/** Scorer search result */
export interface ScorerResult {
  id: string;
  score: number;
  meta: Record<string, unknown>;
}

/**
 * Scorer 通用接口 — FieldWeightedScorer（默认）实现
 *
 * SearchEngine 通过此接口与具体评分器解耦，可在运行时切换。
 */
export interface Scorer {
  totalDocs: number;
  avgLength: number;
  docFreq: Record<string, number>;
  documents: ({ id: string } | null)[];
  addDocument(id: string, text: string, meta: Record<string, unknown>): void;
  removeDocument(id: string): boolean;
  updateDocument(id: string, text: string, meta: Record<string, unknown>): void;
  hasDocument(id: string): boolean;
  search(query: string, limit?: number): ScorerResult[];
  clear(): void;
}

/** Meta structure produced by _buildDocMeta */
export interface DocMeta {
  type: string;
  title: string;
  trigger: string;
  status: string | undefined;
  knowledgeType: string | undefined;
  kind: string;
  language: string;
  dimensionId?: string;
  category: string;
  scope?: string;
  updatedAt: string | null;
  createdAt: string | null;
  difficulty: string;
  tags: string[];
  usageCount: number;
  authorityScore: number;
  qualityScore: number;
  [key: string]: unknown;
}

/** Unified search result item flowing through the ranking pipeline */
export interface SearchResultItem {
  id: string;
  title?: string;
  description?: string;
  trigger?: string;
  type?: string;
  kind?: string;
  status?: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  scope?: string;
  score?: number;
  semanticScore?: number;
  vectorScore?: number;
  semanticUsed?: boolean;
  vectorUsed?: boolean;
  fallbackReason?: string;
  matchedFilters?: Record<string, string[]>;
  scoreBreakdown?: Record<string, unknown>;
  content?: string;
  code?: string;
  headers?: string;
  moduleName?: string;
  knowledgeType?: string;
  qualityScore?: number;
  usageCount?: number;
  authorityScore?: number;
  tags?: string[] | string;
  difficulty?: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  whenClause?: string;
  doClause?: string;
  rankerScore?: number;
  coarseScore?: number;
  contextScore?: number;
  recallScore?: number;
  /** 命中知识的源码锚点(recipe_source_refs 桥表;renamed 用 newPath)。 */
  sourceRefs?: string[];
  /** G-C P1:内容指纹已漂移(文件在但被引区间内容变)的锚点子集。 */
  driftedSourceRefs?: string[];
  /** G-C P1:item 级源锚聚合态——任一锚点 drifted 即 'drifted',否则 'active'。
   *  drifted 不排除检索(漂移≠错误,可能只是行号动了),但降权并透出交使用现场判断。 */
  sourceRefStatus?: 'active' | 'drifted';
  [key: string]: unknown;
}

/** Database row from knowledge_entries table */
export interface DbRow {
  id: string;
  title?: string;
  description?: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  knowledgeType?: string;
  kind?: string;
  scope?: string;
  content?: string;
  lifecycle?: string;
  tags?: string;
  trigger?: string;
  difficulty?: string;
  quality?: string;
  stats?: string;
  updatedAt?: string;
  createdAt?: string;
  status?: string;
  headers?: string;
  moduleName?: string;
  whenClause?: string;
  doClause?: string;
  [key: string]: unknown;
}

export type SearchMetadataFilterKey =
  | 'category'
  | 'dimensionId'
  | 'kind'
  | 'knowledgeType'
  | 'language'
  | 'scope'
  | 'tags'
  | 'type';

export type SearchMetadataFilterValue = string | string[] | undefined;

export type SearchMetadataFilters = Partial<
  Record<SearchMetadataFilterKey, SearchMetadataFilterValue>
> & {
  tag?: SearchMetadataFilterValue;
};

export type NormalizedSearchMetadataFilters = Partial<Record<SearchMetadataFilterKey, string[]>>;

/** Search method options */
export interface SearchOptions {
  type?: string;
  limit?: number;
  mode?: string;
  context?: RankingContext;
  rank?: boolean;
  groupByKind?: boolean;
  useAI?: boolean;
  category?: SearchMetadataFilterValue;
  dimensionId?: SearchMetadataFilterValue;
  filters?: SearchMetadataFilters;
  kind?: SearchMetadataFilterValue;
  knowledgeType?: SearchMetadataFilterValue;
  language?: SearchMetadataFilterValue;
  scope?: SearchMetadataFilterValue;
  tag?: SearchMetadataFilterValue;
  tags?: SearchMetadataFilterValue;
  [key: string]: unknown;
}

/** Context for ranking pipeline */
export interface RankingContext {
  sessionHistory?: Array<{ content?: string; rawInput?: string }>;
  language?: string;
  intent?: string;
  [key: string]: unknown;
}

export type SearchRoute =
  | 'core-search-engine'
  | 'resident-service'
  | 'plugin-embedded'
  | 'unknown'
  | (string & {});

export interface SearchWorkspaceIdentity {
  projectId?: string;
  projectRoot?: string;
  dataRoot?: string;
  workspaceMode?: string;
  [key: string]: unknown;
}

export interface ResolveSearchWorkspaceIdentityInput {
  dataRoot?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  workspaceMode?: string | null;
  [key: string]: unknown;
}

export interface SearchTimingMeta {
  totalMs?: number;
  embedMs?: number;
  vectorMs?: number;
  fuseMs?: number;
  [key: string]: number | undefined;
}

export interface ResidentVectorMeta {
  available: boolean;
  reason?: string;
  endpoint?: string;
  serviceVersion?: string;
  [key: string]: unknown;
}

export interface SearchResponseMeta {
  route: SearchRoute;
  requestedMode: string;
  actualMode: string;
  semanticUsed: boolean;
  vectorUsed: boolean;
  resultCount: number;
  durationMs: number;
  fallbackReason?: string;
  /**
   * CO3 R1: true when the engine answered from a degraded index (e.g. the
   * knowledge table was missing at build time). The read path stays usable;
   * consumers must not mistake the response for a complete empty result.
   */
  degraded?: boolean;
  /** Stable degradation reason, e.g. 'knowledge-table-missing'. */
  degradedReason?: string;
  workspace?: SearchWorkspaceIdentity;
  timings?: SearchTimingMeta;
  residentVector?: ResidentVectorMeta;
  appliedFilters?: NormalizedSearchMetadataFilters;
  unsupportedMode?: string;
  [key: string]: unknown;
}

export interface BuildSearchResponseMetaInput {
  route?: SearchRoute;
  requestedMode?: string;
  actualMode?: string;
  semanticUsed?: boolean;
  vectorUsed?: boolean;
  resultCount?: number;
  durationMs?: number;
  fallbackReason?: string;
  degraded?: boolean;
  degradedReason?: string;
  workspace?: SearchWorkspaceIdentity;
  timings?: SearchTimingMeta;
  residentVector?: ResidentVectorMeta;
  appliedFilters?: NormalizedSearchMetadataFilters;
  unsupportedMode?: string;
  [key: string]: unknown;
}

export function inferSearchSemanticUsage(actualMode: string | undefined): boolean {
  const normalized = (actualMode ?? '').toLowerCase();
  return (
    normalized.includes('semantic') || normalized.includes('rrf') || normalized.includes('hybrid')
  );
}

export function inferSearchVectorUsage(actualMode: string | undefined): boolean {
  const normalized = (actualMode ?? '').toLowerCase();
  return (
    normalized.includes('semantic') || normalized.includes('rrf') || normalized.includes('hybrid')
  );
}

export function buildSearchResponseMeta(
  input: BuildSearchResponseMetaInput = {}
): SearchResponseMeta {
  const actualMode = input.actualMode ?? input.requestedMode ?? 'unknown';
  const requestedMode = input.requestedMode ?? actualMode;
  const rawDuration = input.durationMs ?? input.timings?.totalMs ?? 0;
  const durationMs = Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : 0;

  const meta: SearchResponseMeta = {
    route: input.route ?? 'core-search-engine',
    requestedMode,
    actualMode,
    semanticUsed: input.semanticUsed ?? inferSearchSemanticUsage(actualMode),
    vectorUsed: input.vectorUsed ?? inferSearchVectorUsage(actualMode),
    resultCount: input.resultCount ?? 0,
    durationMs,
  };

  // resident service / Plugin bridge 共享观测契约：
  // 只在真实存在时写入，避免旧客户端把 undefined 当成显式状态。
  if (input.fallbackReason) {
    meta.fallbackReason = input.fallbackReason;
  }
  if (input.degraded) {
    meta.degraded = true;
    if (input.degradedReason) {
      meta.degradedReason = input.degradedReason;
    }
  }
  if (input.workspace) {
    meta.workspace = input.workspace;
  }
  if (input.timings) {
    meta.timings = input.timings;
  }
  if (input.residentVector) {
    meta.residentVector = input.residentVector;
  }
  if (input.appliedFilters && Object.keys(input.appliedFilters).length > 0) {
    meta.appliedFilters = input.appliedFilters;
  }
  if (input.unsupportedMode) {
    meta.unsupportedMode = input.unsupportedMode;
  }

  return meta;
}

export function resolveSearchWorkspaceIdentity(
  input: ResolveSearchWorkspaceIdentityInput = {}
): SearchWorkspaceIdentity | undefined {
  const projectRoot = normalizeSearchIdentityString(input.projectRoot);
  const inspection = projectRoot ? inspectSearchProjectRoot(projectRoot) : null;
  const projectId =
    normalizeSearchIdentityString(input.projectId) ??
    inspection?.projectId ??
    inspection?.expectedProjectId;
  const dataRoot = normalizeSearchIdentityString(input.dataRoot) ?? inspection?.dataRoot;
  const workspaceMode =
    normalizeSearchIdentityString(input.workspaceMode) ?? inspection?.mode ?? undefined;

  if (!projectId && !projectRoot && !dataRoot && !workspaceMode) {
    return undefined;
  }

  return {
    ...(projectId ? { projectId } : {}),
    ...(projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}),
    ...(dataRoot ? { dataRoot } : {}),
    ...(workspaceMode ? { workspaceMode } : {}),
  };
}

function inspectSearchProjectRoot(projectRoot: string) {
  try {
    return ProjectRegistry.inspect(projectRoot);
  } catch {
    return null;
  }
}

function normalizeSearchIdentityString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Search response envelope */
export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  query: string;
  mode?: string;
  type?: string;
  ranked?: boolean;
  byKind?: Record<string, SearchResultItem[]>;
  searchMeta?: SearchResponseMeta;
}

/** Duck-typed database connection (better-sqlite3 style) */
export interface SearchDb {
  prepare(sql: string): { all(...args: unknown[]): DbRow[] };
}

/** AI provider with embedding capability */
export interface SearchAiProvider {
  embed(text: string): Promise<number[]>;
}

/** Vector store for semantic search */
export interface SearchVectorStore {
  query(embedding: number[], limit: number): Promise<VectorHit[]>;
  hybridSearch?(
    embedding: number[],
    query: string,
    options: { topK?: number }
  ): Promise<VectorHit[]>;
}

/** Vector search hit */
export interface VectorHit {
  id: string;
  similarity?: number;
  score?: number;
  content?: string;
  metadata?: Record<string, unknown>;
  item?: { id: string; content?: string; metadata?: Record<string, unknown> };
  [key: string]: unknown;
}

/** Hybrid retriever for RRF fusion */
export interface SearchHybridRetriever {
  search(
    query: string,
    queryEmbedding: number[],
    options: {
      topK?: number;
      alpha?: number;
      sparseSearchFn?: () => SearchResultItem[];
    }
  ): Promise<RrfHit[]>;
}

/** Single RRF fusion hit */
export interface RrfHit {
  id: string;
  score: number;
  data?: { item?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SearchCrossEncoder {
  rerank(query: string, candidates: SearchResultItem[]): Promise<SearchResultItem[]>;
}

/** SearchEngine constructor options */
export interface SearchEngineOptions {
  aiProvider?: SearchAiProvider | null;
  vectorStore?: SearchVectorStore | null;
  vectorService?: SearchVectorService | null;
  hybridRetriever?: SearchHybridRetriever | null;
  crossEncoderReranker?: SearchCrossEncoder | null;
  signalBus?: SignalBus | null;
  cacheMaxAge?: number;
  fusionRecallWeight?: number;
  fusionSemanticWeight?: number;
  [key: string]: unknown;
}

// ─── Unified Slim Projection ────────────────────────────────

/**
 * 统一的搜索结果投影类型 — 去除内部排序信号，只保留 Agent/Bridge 可操作字段。
 * 合并自 mcp/search.ts#SlimSearchItem 和 TaskKnowledgeBridge#SlimKnowledgeItem。
 */
export interface SlimSearchResult {
  id: string;
  title: string;
  trigger: string;
  kind: string;
  language: string;
  score: number;
  description: string;
  actionHint?: string;
  /** 知识类型 (code-standard/code-pattern/...) — Bridge 场景需要 */
  knowledgeType?: string;
  /** Recipe / knowledge scope for faceted search. */
  scope?: string;
  /** Domain dimension id for faceted search. */
  dimensionId?: string;
  /** Category for faceted search. */
  category?: string;
  /** Tags preserved for filter evidence. */
  tags?: string[];
  /** 已验证的项目来源文件路径（可信度证据链） */
  sourceRefs?: string[];
  /**
   * D5(2026-07-11,prime 面 drift 对称):G-C P1 的 item 级源锚聚合态此前在瘦身
   * 投影被丢弃——同一 Recipe 走 search 带 drifted 标注,走 prime(经 slim)则以
   * 无标记 trusted 证据交付。透传仅标注,不改变排序/信任门(消费方自判)。
   */
  sourceRefStatus?: 'active' | 'drifted';
  /** drifted 子集(与 sourceRefs 同一 refPath 串,可集合匹配逐条标记)。 */
  driftedSourceRefs?: string[];
}

/**
 * 统一投影函数 — 将 SearchResultItem 投影为 SlimSearchResult。
 *
 * 合并了 mcp/search.ts#_slimSearchItem() 和 TaskKnowledgeBridge#_projectItem() 的逻辑：
 * - 去除内部信号 (recallScore, coarseScore, rankerScore, contextScore, content, code...)
 * - description 截断 120 字符
 * - 生成 actionHint (whenClause → doClause)
 *
 * @param item 搜索结果项（来自 SearchEngine）
 * @returns 瘦身后的结果项
 */
export function slimSearchResult(item: SearchResultItem): SlimSearchResult {
  const doText = (item.doClause as string) || '';
  const whenText = (item.whenClause as string) || '';
  // 2026-07-02(G3)：actionHint 拼入 dontClause——它是 prime/search 一跳投影里唯一的行为指导，
  // 此前禁止性知识(项目禁止什么)生成了却在机器消费链上不可见。形态: when → do ⚠️ dont。
  const dontText = (item.dontClause as string) || '';
  const actionHint =
    doText || whenText || dontText
      ? `${whenText ? `${whenText} → ` : ''}${doText}${dontText ? ` ⚠️ ${dontText}` : ''}`
          .replace(/ → $/, '')
          .trim()
      : undefined;
  const rawRefs = (item as SearchResultItem & { sourceRefs?: unknown }).sourceRefs;
  const sourceRefs =
    Array.isArray(rawRefs) && rawRefs.length > 0
      ? rawRefs.filter((s: unknown) => typeof s === 'string' && (s as string).length > 0)
      : undefined;
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined;
  // D5:drift 标注随 sourceRefs 一起过瘦身投影(此前被丢弃,prime 面漂移盲)。
  const driftedRefs =
    Array.isArray(item.driftedSourceRefs) && item.driftedSourceRefs.length > 0
      ? item.driftedSourceRefs.filter(
          (ref): ref is string => typeof ref === 'string' && ref.length > 0
        )
      : undefined;
  return {
    id: item.id,
    title: (item.title as string) || '',
    trigger: (item.trigger as string) || '',
    kind: (item.kind as string) || 'pattern',
    language: (item.language as string) || '',
    score: Math.round(((item.score as number) || 0) * 1000) / 1000,
    description: ((item.description as string) || '').slice(0, 120),
    actionHint,
    knowledgeType: (item.knowledgeType as string) || undefined,
    scope: (item.scope as string) || undefined,
    dimensionId: (item.dimensionId as string) || undefined,
    category: (item.category as string) || undefined,
    tags,
    sourceRefs,
    ...(item.sourceRefStatus ? { sourceRefStatus: item.sourceRefStatus } : {}),
    ...(driftedRefs ? { driftedSourceRefs: driftedRefs } : {}),
  };
}

/** items → byKind 分组（统一实现） */
export function groupByKind<T extends { kind?: string }>(
  items: T[]
): { rule: T[]; pattern: T[]; fact: T[] } {
  const byKind: { rule: T[]; pattern: T[]; fact: T[] } = { rule: [], pattern: [], fact: [] };
  for (const it of items) {
    const kind = it.kind || 'pattern';
    const bucket = (byKind as unknown as Record<string, T[]>)[kind] || byKind.pattern;
    bucket.push(it);
  }
  return byKind;
}

/** VectorService abstraction for SearchEngine delegation */
export interface SearchVectorService {
  search(
    query: string,
    opts?: { topK?: number; filter?: Record<string, unknown> | null; minScore?: number }
  ): Promise<Array<{ item: Record<string, unknown>; score: number }>>;
  hybridSearch(
    query: string,
    opts?: {
      topK?: number;
      alpha?: number;
      filter?: Record<string, unknown> | null;
      sparseSearchFn?:
        | ((
            q: string,
            limit: number
          ) => Array<{ id: string; score?: number; [key: string]: unknown }>)
        | null;
    }
  ): Promise<
    Array<{
      id: string;
      score: number;
      vectorUsed?: boolean;
      semanticUsed?: boolean;
      fallbackReason?: string;
      [key: string]: unknown;
    }>
  >;
}

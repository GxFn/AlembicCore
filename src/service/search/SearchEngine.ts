/**
 * SearchEngine - 统一搜索引擎
 *
 * 三级搜索策略: keyword → FieldWeighted ranking → semantic(可选)
 * 从 V1 SearchServiceV2 迁移，适配 V2 架构
 */

import type { RecipeRetrievalProfile } from '../../domain/knowledge/RecipeRetrievalProfile.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type {
  SearchDb as CoreSearchDb,
  SearchKnowledgeRepo,
  SearchSourceRefRepo,
} from '../../repository/search/SearchRepoAdapter.js';
import {
  RawDbKnowledgeAdapter,
  RawDbSourceRefAdapter,
  unwrapSearchDb,
} from '../../repository/search/SearchRepoAdapter.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import {
  projectRecipeRetrievalDocumentSet,
  projectRecipeRetrievalSparseProjection,
  serializeRecipeRetrievalDocumentSetForSparse,
} from '../knowledge/RecipeRetrieval.js';
import { parseRecipeIdFromRegionVectorId } from '../vector/RecipeRegionVectorIndex.js';
import { CoarseRanker } from './CoarseRanker.js';
import type { SearchItem } from './contextBoost.js';
import { contextBoost } from './contextBoost.js';
import { FieldWeightedScorer } from './FieldWeightedScorer.js';
import type { KnowledgeRetrievalCandidate, KnowledgeRetrievalPort } from './KnowledgeRetrieval.js';
import { MultiSignalRanker } from './MultiSignalRanker.js';
import type {
  DbRow,
  DocMeta,
  NormalizedSearchMetadataFilters,
  RankingContext,
  Scorer,
  ScorerResult,
  SearchAiProvider,
  SearchCrossEncoder,
  SearchDb,
  SearchEngineOptions,
  SearchHybridRetriever,
  SearchMetadataFilterKey,
  SearchOptions,
  SearchResponse,
  SearchResultItem,
  SearchVectorService,
  SearchVectorStore,
  VectorHit,
} from './SearchTypes.js';
import { buildSearchResponseMeta } from './SearchTypes.js';

export { FieldWeightedScorer } from './FieldWeightedScorer.js';
export type {
  DbRow,
  DocMeta,
  NormalizedSearchMetadataFilters,
  RankingContext,
  ResolveSearchWorkspaceIdentityInput,
  RrfHit,
  Scorer,
  ScorerResult,
  SearchAiProvider,
  SearchCrossEncoder,
  SearchDb,
  SearchEngineOptions,
  SearchHybridRetriever,
  SearchMetadataFilterKey,
  SearchMetadataFilters,
  SearchOptions,
  SearchResponse,
  SearchResponseMeta,
  SearchResultItem,
  SearchVectorService,
  SearchVectorStore,
  SlimSearchResult,
  VectorHit,
} from './SearchTypes.js';
export {
  buildSearchResponseMeta,
  groupByKind,
  inferSearchSemanticUsage,
  inferSearchVectorUsage,
  resolveSearchWorkspaceIdentity,
  slimSearchResult,
} from './SearchTypes.js';
export { tokenize } from './tokenizer.js';

// G-C P1:源锚漂移的检索降权因子(乘性)。0.85=温和降权——漂移不等于错误,
// 只在同分附近让 active 上浮,不把漂移知识挤出结果(降级消费而非排除)。
const DRIFTED_SOURCE_REF_SCORE_FACTOR = 0.85;

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * SearchEngine - 完整搜索服务
 * 整合召回评分 + 关键词 + 可选 AI 增强
 */
export class SearchEngine {
  _cache: Map<string, { data: SearchResponse; time: number }>;
  _cacheMaxAge: number;
  _coarseRanker: CoarseRanker;
  _crossEncoder: SearchCrossEncoder | null;
  _fusionRecallWeight: number;
  _fusionSemanticWeight: number;
  _indexed: boolean;
  /**
   * CO3 R1: set when the index was built without knowledge entries because
   * the table was missing/unreadable. Stable reason string surfaced via
   * searchMeta.degradedReason so results are visibly degraded, never a
   * silently empty list.
   */
  _indexDegradedReason: string | null = null;
  _lastIndexTime: string | null = null;
  _multiSignalRanker: MultiSignalRanker;
  _signalBus: import('../../infrastructure/signal/SignalBus.js').SignalBus | null;
  aiProvider: SearchAiProvider | null;
  db: SearchDb;
  hybridRetriever: SearchHybridRetriever | null;
  knowledgeRetrievalPort: KnowledgeRetrievalPort | null;
  #knowledgeRepo: SearchKnowledgeRepo;
  #sourceRefRepo: SearchSourceRefRepo;
  logger: ReturnType<typeof Logger.getInstance>;
  scorer: Scorer;
  vectorService: SearchVectorService | null;
  vectorStore: SearchVectorStore | null;
  constructor(db: SearchDb & { getDb?: () => SearchDb }, options: SearchEngineOptions = {}) {
    this.db = unwrapSearchDb(
      db as unknown as CoreSearchDb & { getDb?: () => CoreSearchDb }
    ) as unknown as SearchDb;
    const opts = options as Record<string, unknown>;
    this.#knowledgeRepo =
      (opts.knowledgeRepo as SearchKnowledgeRepo | null) ?? new RawDbKnowledgeAdapter(this.db);
    this.#sourceRefRepo =
      (opts.sourceRefRepo as SearchSourceRefRepo | null) ?? new RawDbSourceRefAdapter(this.db);
    this.logger = Logger.getInstance();
    this.aiProvider = options.aiProvider || null;
    this.vectorStore = options.vectorStore || null;
    this.vectorService = options.vectorService || null;
    this.hybridRetriever = options.hybridRetriever || null;
    this.knowledgeRetrievalPort = options.knowledgeRetrievalPort ?? null;
    this.scorer = new FieldWeightedScorer();
    this._coarseRanker = new CoarseRanker(
      options as {
        recallWeight?: number;
        semanticWeight?: number;
        qualityWeight?: number;
        freshnessWeight?: number;
        popularityWeight?: number;
      }
    );
    this._multiSignalRanker = new MultiSignalRanker(
      options as { scenarioWeights?: Record<string, Record<string, number>> }
    );
    this._crossEncoder = options.crossEncoderReranker || null;
    this._indexed = false;
    this._cache = new Map();
    this._cacheMaxAge = options.cacheMaxAge || 300_000; // 5min
    // auto 模式 召回+semantic 融合权重（可配置）
    this._fusionRecallWeight = options.fusionRecallWeight ?? 0.6;
    this._fusionSemanticWeight = options.fusionSemanticWeight ?? 0.4;
    this._signalBus = options.signalBus || null;
  }

  /** 构建搜索索引 - 从数据库加载所有可搜索实体 */
  buildIndex() {
    this.scorer.clear();
    this._cache.clear();

    try {
      let entries: DbRow[] = [];

      try {
        const rawEntries = this.#knowledgeRepo.findNonDeprecatedSync();
        entries = rawEntries.map((e) => ({
          ...e,
          status: (e as Record<string, unknown>).lifecycle,
        })) as unknown as DbRow[];
        this._indexDegradedReason = null;
      } catch (err: unknown) {
        // CO3 R1 (read-tolerant): a missing/unreadable knowledge table used
        // to leave a silently empty index. The read path stays usable, but
        // the degradation is recorded and surfaced on every response.
        const message = err instanceof Error ? err.message : String(err);
        this._indexDegradedReason = /no such table/i.test(message)
          ? 'knowledge-table-missing'
          : 'knowledge-load-failed';
        this.logger.warn('Search index built without knowledge entries — degraded', {
          code: CORE_DIAGNOSTIC_CODES.searchIndexTableMissing,
          reason: this._indexDegradedReason,
          error: message,
        });
      }

      for (const r of entries) {
        const text = this._buildDocText(r);
        const meta = this._buildDocMeta(r);
        meta.status = r.status; // buildIndex uses mapped status from lifecycle
        this.scorer.addDocument(r.id, text, meta);
      }

      this._indexed = true;
      this._lastIndexTime = new Date().toISOString();
      this.logger.info('Search index built', {
        entries: entries.length,
        total: this.scorer.totalDocs,
      });
    } catch (err: unknown) {
      this.logger.error('Failed to build search index', { error: (err as Error).message });
    }
  }

  /** 确保索引已构建（幂等），supply 给需要准确 stats 的调用方 */
  ensureIndex() {
    if (!this._indexed) {
      this.buildIndex();
    }
  }

  /**
   * 统一搜索入口
   * @param query 搜索关键词
   * @param options {type, limit, mode, useAI}
   */
  async search(query: string, options: SearchOptions = {}) {
    const { type = 'all', limit = 20, context } = options;
    const mode = typeof options.mode === 'string' ? options.mode.toLowerCase() : 'keyword';
    const shouldRank = options.rank ?? mode !== 'keyword';
    const metadataFilters = this.#normalizeMetadataFilters(options);
    const hasMetadataFilters = this.#hasMetadataFilters(metadataFilters);
    const tSearchStart = performance.now();

    if (mode === 'bm25') {
      const durationMs = performance.now() - tSearchStart;
      return {
        items: [],
        total: 0,
        query,
        mode: 'unsupported',
        type,
        ranked: false,
        searchMeta: buildSearchResponseMeta({
          route: 'core-search-engine',
          requestedMode: mode,
          actualMode: 'unsupported',
          resultCount: 0,
          durationMs,
          fallbackReason: 'unsupported_mode:bm25',
          unsupportedMode: mode,
          appliedFilters: metadataFilters,
        }),
      };
    }

    if ((!query || !query.trim()) && !hasMetadataFilters) {
      return {
        items: [],
        total: 0,
        query,
        mode,
        type,
        ranked: false,
        searchMeta: buildSearchResponseMeta({
          route: 'core-search-engine',
          requestedMode: mode,
          actualMode: mode,
          resultCount: 0,
          durationMs: performance.now() - tSearchStart,
        }),
      };
    }

    // 带 sessionHistory 的上下文搜索不缓存（个性化结果）
    const hasSessionContext = (context?.sessionHistory?.length ?? 0) > 0;
    const filterCacheKey = this.#metadataFilterCacheKey(metadataFilters);
    const cacheKey = hasSessionContext
      ? null
      : `${query}:${type}:${limit}:${mode}:${shouldRank ? 'r' : ''}:${options.groupByKind ? 'g' : ''}:${filterCacheKey}`;
    if (cacheKey) {
      const cached = this._getCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 确保索引已构建
    this.ensureIndex();

    // 排序阶段需要更多候选，过采样 3x
    const recallLimit = shouldRank ? limit * 3 : limit;
    let results: SearchResultItem[];
    let actualMode = mode;
    let fallbackReason: string | undefined;
    let semanticUsed: boolean | undefined;
    let vectorUsed: boolean | undefined;
    let filteredOrphanVectorCount = 0;
    let canonicalRetrievalUsed = false;

    if ((!query || !query.trim()) && hasMetadataFilters) {
      results = this.#metadataFilterOnlySearch(type, limit, metadataFilters);
      actualMode = 'metadata-filter';
    } else {
      switch (mode) {
        case 'auto': {
          // ── Weighted-First + Confidence Gate ──
          // 先跑 weighted（~40ms），评估是否需要 embed（2-22s）
          const weightedItems = this._scorerSearch(query, type, recallLimit, metadataFilters);
          if (this.knowledgeRetrievalPort) {
            try {
              const canonical = await this.#retrieveCanonical(query, limit, metadataFilters, type);
              results = canonical.items;
              canonicalRetrievalUsed = true;
              actualMode = canonical.vectorUsed
                ? 'auto(canonical-hybrid)'
                : 'auto(canonical-sparse)';
              fallbackReason = canonical.fallbackReason;
              semanticUsed = canonical.vectorUsed;
              vectorUsed = canonical.vectorUsed;
              filteredOrphanVectorCount += canonical.filteredOrphanCount;
              break;
            } catch (error) {
              this.logger.warn('Canonical knowledge retrieval failed, falling back to weighted', {
                error: error instanceof Error ? error.message : String(error),
              });
              results = weightedItems;
              actualMode = 'auto(weighted-fallback)';
              fallbackReason = 'knowledge_retrieval_failed';
              semanticUsed = false;
              vectorUsed = false;
              break;
            }
          }
          const confidence = this.#computeWeightedConfidence(query, weightedItems, limit);

          if (confidence >= 60) {
            // 高 confidence: weighted 已足够，跳过 embed
            results = weightedItems;
            actualMode = `auto(weighted-only,conf=${confidence})`;
            this.logger.info(
              `[QueryRouter] skip-semantic: conf=${confidence} topScore=${weightedItems[0]?.score ?? 0} query="${query}"`
            );
            break;
          }
          if (!this.vectorService) {
            // 没有 VectorService 时不是“向量失败”，而是明确走 Core baseline 搜索。
            results = weightedItems;
            actualMode = `auto(weighted-only,conf=${confidence})`;
            fallbackReason = 'vector_service_unavailable';
            this.logger.info(
              `[QueryRouter] skip-semantic: vector_service_unavailable conf=${confidence} topScore=${weightedItems[0]?.score ?? 0} query="${query}"`
            );
            break;
          }

          // 低 confidence: 投入 embed，RRF 融合
          // 自适应 alpha：confidence 越低 → semantic 权重越高
          // conf=0 → alpha=0.75, conf=30 → alpha=0.575, conf=55 → alpha=0.42
          const adaptiveAlpha =
            this._fusionSemanticWeight +
            (0.75 - this._fusionSemanticWeight) * (1 - confidence / 60);
          this.logger.info(
            `[QueryRouter] invoke-semantic: conf=${confidence} alpha=${adaptiveAlpha.toFixed(2)} topScore=${weightedItems[0]?.score ?? 0} query="${query}"`
          );
          try {
            const rrfResults = await this.vectorService.hybridSearch(query, {
              topK: recallLimit,
              alpha: adaptiveAlpha,
              filter: this.#hasMetadataFilters(metadataFilters) ? metadataFilters : null,
              sparseSearchFn: () => weightedItems,
            });
            if (rrfResults.length > 0) {
              const rrfVectorUsed = rrfResults.some((r) => r.vectorUsed === true);
              semanticUsed = rrfVectorUsed;
              vectorUsed = rrfVectorUsed;
              if (!rrfVectorUsed) {
                fallbackReason =
                  rrfResults.find((r) => typeof r.fallbackReason === 'string')?.fallbackReason ??
                  'vector_service_sparse_only';
              }
              results = rrfResults.map((r) => this.#mapVectorLikeResult(r.id, r.score, r));
              // P-D D1:RRF 路径此前漏去重——region/chunk 命中解析为同一 entryId 后
              // 在此折叠(keep-best),否则多 region 的 Recipe 垄断结果页。
              results = this.#deduplicateByEntryId(results as SearchResultItem[]);
              const projection = this.#projectLiveVectorCandidates(results as SearchResultItem[]);
              if (!projection.ok) {
                results = weightedItems;
                actualMode = `auto(weighted-fallback,conf=${confidence})`;
                fallbackReason = 'knowledge_truth_lookup_failed';
                semanticUsed = false;
                vectorUsed = false;
                break;
              }
              results = projection.items;
              filteredOrphanVectorCount += projection.filteredOrphanVectorCount;
              results = this.#applyMetadataFilters(results, metadataFilters);
              actualMode = rrfVectorUsed
                ? `auto(rrf,conf=${confidence},α=${adaptiveAlpha.toFixed(2)})`
                : `auto(sparse-rrf,conf=${confidence})`;
              break;
            }
          } catch (err: unknown) {
            // VectorService RRF 失败, 降级
            const errorMessage = err instanceof Error ? err.message : String(err);
            fallbackReason = `vector_service_hybrid_failed:${errorMessage}`;
            this.logger.warn(
              '[QueryRouter] vector service hybrid failed, falling back to weighted',
              {
                error: errorMessage,
                query,
                confidence,
              }
            );
          }

          // 降级: embed 失败 → 返回已有的 weighted 结果
          results = weightedItems;
          actualMode = `auto(weighted-fallback,conf=${confidence})`;
          fallbackReason ??= 'vector_service_hybrid_unavailable';
          break;
        }
        case 'weighted':
          results = this._scorerSearch(query, type, recallLimit, metadataFilters);
          break;
        case 'semantic': {
          const semResult = await this._semanticSearch(query, type, recallLimit, metadataFilters);
          results = semResult.items;
          actualMode = semResult.actualMode || 'semantic';
          fallbackReason = semResult.fallbackReason;
          semanticUsed = semResult.semanticUsed;
          vectorUsed = semResult.vectorUsed;
          filteredOrphanVectorCount += semResult.filteredOrphanVectorCount ?? 0;
          canonicalRetrievalUsed = semResult.canonical === true;
          break;
        }
        default:
          results = this._keywordSearch(query, type, limit, metadataFilters);
          break;
      }
    }

    // ── Ranking Pipeline ([CrossEncoder] → CoarseRanker → MultiSignalRanker → ContextBoost) ──
    if (shouldRank && !canonicalRetrievalUsed && results.length > 0) {
      results = await this._applyRanking(results, query, context);
    }
    results = results.slice(0, limit);

    const response: SearchResponse = {
      items: results,
      total: results.length,
      query,
      mode: actualMode,
      type,
      ranked: (shouldRank || canonicalRetrievalUsed) && results.length > 0,
    };

    // ── 搜索计时日志 ──
    const tSearchEnd = performance.now();
    response.searchMeta = buildSearchResponseMeta({
      route: 'core-search-engine',
      requestedMode: mode,
      actualMode,
      semanticUsed,
      vectorUsed,
      resultCount: results.length,
      durationMs: tSearchEnd - tSearchStart,
      fallbackReason,
      degraded: this._indexDegradedReason !== null,
      degradedReason: this._indexDegradedReason ?? undefined,
      appliedFilters: metadataFilters,
      filteredOrphanVectorCount,
    });
    this.logger.info(
      `Search completed: mode=${actualMode} total=${results.length} time=${Math.round(tSearchEnd - tSearchStart)}ms ranked=${response.ranked} query="${query}"`
    );

    if (options.groupByKind) {
      response.byKind = { rule: [], pattern: [], fact: [] };
      for (const r of results) {
        const kind = r.kind || 'pattern';
        const bucket = response.byKind[kind] ?? response.byKind.pattern;
        bucket.push(r);
      }
    }

    if (cacheKey) {
      this._setCache(cacheKey, response);
    }

    // ── Signal emission ──
    if (this._signalBus && response.total > 0) {
      this._signalBus.send('search', 'SearchEngine', Math.min(response.total / limit, 1), {
        metadata: { query, mode: actualMode, total: response.total },
      });
    }

    return response;
  }

  // ── Ranking Pipeline ────────────────────────────────────────────

  /**
   * 统一排序管线:
   *   规范化 → [CrossEncoder 语义重排] → CoarseRanker (E-E-A-T 5维)
   *   → MultiSignalRanker (6信号) → 上下文加成
   *
   * CrossEncoder 仅在构造时传入 crossEncoderReranker 且 AI 可用时生效，
   * 否则自动跳过（零额外开销）。
   */
  async _applyRanking(items: SearchResultItem[], query: string, context: RankingContext = {}) {
    let normalized = this._normalizeForRanking(items);

    // Optional: Cross-Encoder semantic rerank (AI → Jaccard fallback)
    if (this._crossEncoder) {
      normalized = (await this._crossEncoder.rerank(query, normalized)) as SearchResultItem[];
    }

    let ranked: SearchResultItem[] = this._coarseRanker.rank(
      normalized as unknown as Parameters<CoarseRanker['rank']>[0]
    ) as unknown as SearchResultItem[];
    ranked = this._multiSignalRanker.rank(
      ranked as unknown as Parameters<MultiSignalRanker['rank']>[0],
      {
        ...context,
        query,
        scenario: context?.intent || 'search',
      }
    ) as unknown as SearchResultItem[];
    if ((context?.sessionHistory?.length ?? 0) > 0) {
      ranked = contextBoost(ranked as SearchItem[], context) as SearchResultItem[];
    }
    return ranked.map((r: SearchResultItem) => {
      const baseScore = r.contextScore || r.rankerScore || r.coarseScore || r.recallScore || 0;
      // G-C P1:源锚漂移降权(active 优先)。漂移≠错误(可能只是行号动了),故只降级
      // 消费而不排除——乘性小惩罚保持相对序,仅在同分附近让 active 上浮。透出交现场判断。
      const score =
        r.sourceRefStatus === 'drifted' ? baseScore * DRIFTED_SOURCE_REF_SCORE_FACTOR : baseScore;
      return {
        ...r,
        recallScore: r.recallScore || 0,
        score,
      };
    });
  }

  /**
   * 将召回结果转换为 Ranker 所需格式（解析 content JSON、映射信号字段）
   * 保留原始 content 供下游消费者使用
   */
  _normalizeForRanking(items: SearchResultItem[]): SearchResultItem[] {
    return items.map((item: SearchResultItem) => {
      let codeText = '';
      if (item.content) {
        try {
          const parsed = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
          codeText = parsed.pattern || parsed.code || '';
        } catch {
          /* ignore */
        }
      }
      let tags = item.tags || [];
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch {
          tags = [];
        }
      }
      return {
        ...item,
        code: codeText || item.code || '',
        recallScore: item.score || 0,
        qualityScore: item.qualityScore || (item.status === 'active' ? 70 : 40),
        usageCount: item.usageCount || 0,
        authorityScore: item.authorityScore || 0,
        tags,
        difficulty: item.difficulty || 'intermediate',
      };
    });
  }

  /**
   * 关键词搜索 - 直接 SQL LIKE
   * 返回包含 kind 字段的完整结果，使用 ESCAPE 防止通配符注入
   * 当 SQL LIKE 无结果时，降级到 FieldWeighted 搜索以提升自然语言查询的召回率
   */
  _keywordSearch(
    query: string,
    type: string,
    limit: number,
    filters: NormalizedSearchMetadataFilters = {}
  ) {
    const results: SearchResultItem[] = [];
    // 转义 LIKE 通配符 (% → \%, _ → \_)
    const escaped = query.replace(/[%_\\]/g, (ch: string) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    const rowLimit = this.#hasMetadataFilters(filters) ? Math.max(limit * 5, 100) : limit;

    if (
      type === 'all' ||
      type === 'recipe' ||
      type === 'knowledge' ||
      type === 'rule' ||
      type === 'solution'
    ) {
      try {
        let rows: DbRow[] = [];
        try {
          const rawRows = this.#knowledgeRepo.keywordSearchSync(pattern, rowLimit);
          rows = rawRows.map((r) => ({
            ...r,
            status:
              (r as Record<string, unknown>).lifecycle ?? (r as Record<string, unknown>).status,
            type: 'knowledge',
          })) as unknown as DbRow[];
        } catch {
          /* table may not exist */
        }
        // 基础相关性排序：trigger 精确 > 标题匹配 > 描述匹配 > 内容匹配
        const lowerQ = query.toLowerCase();
        results.push(
          ...rows.map((r) => {
            let score = 0.5;
            if (r.trigger?.toLowerCase().includes(lowerQ)) {
              score = 1.2;
            } else if (r.title?.toLowerCase().includes(lowerQ)) {
              score = 1.0;
            } else if (r.description?.toLowerCase().includes(lowerQ)) {
              score = 0.8;
            }
            return {
              ...r,
              trigger: r.trigger || '',
              kind: r.kind || 'pattern',
              score: Math.round(score * 1000) / 1000,
              matchedFilters: this.#matchedFilterEvidence(r, filters),
            };
          })
        );
        const filtered = this.#applyMetadataFilters(results, filters);
        results.length = 0;
        results.push(...filtered);
        results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      } catch {
        /* table may not exist */
      }
    }

    // 补充排序信号字段（whenClause/doClause/tags 等），与 scorer/semantic 路径一致
    this._supplementDetails(results);

    // Canonical sparse documents carry profile-only facts that SQL LIKE does
    // not materialize as columns. Merge them on every keyword request so SQL
    // never becomes an independent, narrower Recipe fact set.
    this.ensureIndex();
    const scorerResults = this._scorerSearch(query, type, rowLimit, filters);
    const byId = new Map(results.map((item) => [item.id, item]));
    for (const scorerResult of scorerResults) {
      const existing = byId.get(scorerResult.id);
      if (!existing) {
        results.push(scorerResult);
        byId.set(scorerResult.id, scorerResult);
      } else if ((scorerResult.score ?? 0) > (existing.score ?? 0)) {
        Object.assign(existing, scorerResult);
      }
    }
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return results.slice(0, limit);
  }

  /**
   * 加权字段搜索（FieldWeightedScorer）
   * 增加 Title/Trigger 精确匹配 bonus — 当 query 出现在标题/触发词中时
   * 给予额外分数加成，确保精确匹配的条目排名靠前
   */
  _scorerSearch(
    query: string,
    type: string,
    limit: number,
    filters: NormalizedSearchMetadataFilters = {}
  ) {
    let results = this.scorer.search(query, limit * 2);

    if (type !== 'all') {
      // All types now map to 'recipe' since everything is unified
      results = results.filter((r: ScorerResult) => {
        if (type === 'rule') {
          return (r.meta as Record<string, unknown>).knowledgeType === 'boundary-constraint';
        }
        return (r.meta as Record<string, unknown>).type === 'recipe';
      });
    }
    results = results.filter((r) =>
      this.#matchesMetadataRecord(r.meta as Record<string, unknown>, filters)
    );

    // ── Title/Trigger exact-match bonus ──
    // 当 query 精确出现在标题或触发词中时，增加分数
    // 这解决了 "BaseRequest" 被 "BD前缀类名命名规范" 排在 "BDBaseRequest 继承请求模式" 前面的问题
    const lowerQuery = query.toLowerCase();
    const maxScore = results.length > 0 ? results[0].score : 1;
    for (const r of results) {
      const meta = r.meta as DocMeta;
      const title = (meta.title || '').toLowerCase();
      const trigger = (meta.trigger || '').toLowerCase();
      let bonus = 0;

      if (title === lowerQuery || trigger === lowerQuery) {
        // 完全匹配: +50% of max score
        bonus = maxScore * 0.5;
      } else if (title.includes(lowerQuery) || trigger.includes(lowerQuery)) {
        // 子串匹配: +30% of max score
        bonus = maxScore * 0.3;
      } else if (lowerQuery.includes(title) && title.length > 3) {
        // 反向包含 (query 包含 title): +15% of max score
        bonus = maxScore * 0.15;
      }
      r.score += bonus;
    }
    // 重新排序
    results.sort((a, b) => b.score - a.score);

    const items: SearchResultItem[] = results.slice(0, limit).map((r: ScorerResult) => {
      const meta = r.meta as DocMeta;
      return {
        id: r.id,
        title: meta.title,
        trigger: meta.trigger || '',
        type: meta.type,
        kind: meta.kind || 'pattern',
        status: meta.status,
        language: meta.language || '',
        category: meta.category || '',
        dimensionId: meta.dimensionId || '',
        knowledgeType: meta.knowledgeType || '',
        scope: meta.scope || '',
        score: Math.round(r.score * 1000) / 1000,
        matchedFilters: this.#matchedFilterEvidence(meta as Record<string, unknown>, filters),
        // 排序信号字段（供 CoarseRanker / MultiSignalRanker 使用）
        updatedAt: meta.updatedAt || null,
        createdAt: meta.createdAt || null,
        difficulty: meta.difficulty || 'intermediate',
        tags: meta.tags || [],
        usageCount: meta.usageCount || 0,
        authorityScore: meta.authorityScore || 0,
        qualityScore: meta.qualityScore || 0,
      };
    });

    // 为每个结果补充 content（预览需要）— 批量 IN 查询替代 N+1
    this._supplementDetails(items);

    return items;
  }

  /**
   * 语义搜索 - 需要 AI Provider 的 embed 功能
   * 不可用时降级到 FieldWeighted 搜索
   * @returns >}
   */
  async _semanticSearch(
    query: string,
    type: string,
    limit: number,
    filters: NormalizedSearchMetadataFilters = {}
  ): Promise<{
    items: SearchResultItem[];
    actualMode: string;
    fallbackReason?: string;
    semanticUsed?: boolean;
    vectorUsed?: boolean;
    filteredOrphanVectorCount?: number;
    canonical?: boolean;
  }> {
    if (this.knowledgeRetrievalPort) {
      try {
        const canonical = await this.#retrieveCanonical(query, limit, filters, type);
        return {
          actualMode: canonical.vectorUsed ? 'semantic' : 'weighted',
          canonical: true,
          fallbackReason: canonical.fallbackReason,
          filteredOrphanVectorCount: canonical.filteredOrphanCount,
          items: canonical.items,
          semanticUsed: canonical.vectorUsed,
          vectorUsed: canonical.vectorUsed,
        };
      } catch (error) {
        this.logger.warn('Canonical knowledge retrieval failed, falling back to weighted', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          actualMode: 'weighted',
          fallbackReason: 'knowledge_retrieval_failed',
          items: this._scorerSearch(query, type, limit, filters),
          semanticUsed: false,
          vectorUsed: false,
        };
      }
    }

    // 优先使用 VectorService (统一向量服务层)
    if (this.vectorService) {
      try {
        const vectorResults = await this.vectorService.search(query, {
          topK: limit * 2,
          filter: this.#hasMetadataFilters(filters) ? filters : null,
        });
        if (vectorResults.length > 0) {
          let results: SearchResultItem[] = vectorResults.map((vr) => {
            const item = vr.item as Record<string, unknown>;
            const metadata = (item.metadata || {}) as Record<string, unknown>;
            const rawId = (item.id as string) || '';
            const entryId = this.#resolveVectorEntryId(rawId, metadata);
            return {
              id: entryId,
              title: (metadata.title as string) || entryId,
              type: 'recipe',
              kind: (metadata.kind as string) || 'pattern',
              status: (metadata.status as string) || 'active',
              score: Math.round(vr.score * 1000) / 1000,
              semanticScore: Math.round(vr.score * 1000) / 1000,
              vectorScore: Math.round(vr.score * 1000) / 1000,
              semanticUsed: true,
              vectorUsed: true,
              description: (metadata.description as string) || undefined,
              content: (item.content as string) || undefined,
              language: (metadata.language as string) || '',
              dimensionId: (metadata.dimensionId as string) || '',
              category: (metadata.category as string) || '',
              knowledgeType: (metadata.knowledgeType as string) || '',
              scope: (metadata.scope as string) || '',
              tags: this.#readStringArray(metadata.tags),
              scoreBreakdown: { semantic: vr.score, vector: vr.score },
            } as SearchResultItem;
          });
          // 按 entryId 去重 — 同一 Recipe 的多个 chunk 只保留最高分
          results = this.#deduplicateByEntryId(results);
          const projection = this.#projectLiveVectorCandidates(results);
          if (!projection.ok) {
            return {
              items: this._scorerSearch(query, type, limit, filters),
              actualMode: 'weighted',
              fallbackReason: 'knowledge_truth_lookup_failed',
              semanticUsed: false,
              vectorUsed: false,
            };
          }
          results = projection.items;
          if (type !== 'all') {
            results = results.filter((r: SearchResultItem) => {
              if (type === 'rule') {
                return r.kind === 'rule';
              }
              return r.type === 'recipe';
            });
          }
          results = this.#applyMetadataFilters(results, filters);
          results = results.slice(0, limit);
          return {
            items: results,
            actualMode: 'semantic',
            semanticUsed: true,
            vectorUsed: true,
            filteredOrphanVectorCount: projection.filteredOrphanVectorCount,
          };
        }
      } catch (err: unknown) {
        this.logger.warn('VectorService search failed, falling back to legacy path', {
          error: (err as Error).message,
        });
      }
    }

    // Legacy fallback: 直接使用 aiProvider embed + vectorStore
    if (!this.aiProvider) {
      this.logger.debug('AI provider not available, falling back to FieldWeighted search');
      return {
        items: this._scorerSearch(query, type, limit, filters),
        actualMode: 'weighted',
        fallbackReason: 'embed_provider_unavailable',
        semanticUsed: false,
        vectorUsed: false,
      };
    }

    try {
      const queryEmbedding = await this.aiProvider.embed(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return {
          items: this._scorerSearch(query, type, limit, filters),
          actualMode: 'weighted',
          fallbackReason: 'empty_query_embedding',
          semanticUsed: false,
          vectorUsed: false,
        };
      }

      if (this.vectorStore) {
        try {
          let vectorResults: VectorHit[];
          if (typeof this.vectorStore.hybridSearch === 'function') {
            const hybrid = await this.vectorStore.hybridSearch(queryEmbedding, query, {
              topK: limit * 2,
            });
            vectorResults = hybrid.map((r: VectorHit) => ({
              id: r.item?.id ?? r.id,
              similarity: r.score,
              score: r.score,
              content: r.item?.content,
              metadata: r.item?.metadata || {},
            }));
          } else {
            vectorResults = await this.vectorStore.query(queryEmbedding, limit * 2);
          }
          if (vectorResults && vectorResults.length > 0) {
            let results: SearchResultItem[] = vectorResults.map((vr: VectorHit) => {
              const rawId = vr.id || '';
              const entryId = this.#resolveVectorEntryId(
                rawId,
                (vr.metadata ?? {}) as Record<string, unknown>
              );
              return {
                id: entryId,
                title: (vr.metadata?.title as string) || entryId,
                type: 'recipe',
                kind: (vr.metadata?.kind as string) || 'pattern',
                status: (vr.metadata?.status as string) || 'active',
                score: Math.round((vr.similarity || vr.score || 0) * 1000) / 1000,
                semanticScore: Math.round((vr.similarity || vr.score || 0) * 1000) / 1000,
                vectorScore: Math.round((vr.similarity || vr.score || 0) * 1000) / 1000,
                semanticUsed: true,
                vectorUsed: true,
                description: (vr.metadata?.description as string) || undefined,
                content: vr.content,
                language: (vr.metadata?.language as string) || '',
                dimensionId: (vr.metadata?.dimensionId as string) || '',
                category: (vr.metadata?.category as string) || '',
                knowledgeType: (vr.metadata?.knowledgeType as string) || '',
                scope: (vr.metadata?.scope as string) || '',
                tags: this.#readStringArray(vr.metadata?.tags),
                scoreBreakdown: { semantic: vr.similarity || vr.score || 0, vector: vr.score ?? 0 },
              } as SearchResultItem;
            });
            // 按 entryId 去重
            results = this.#deduplicateByEntryId(results);
            const projection = this.#projectLiveVectorCandidates(results);
            if (!projection.ok) {
              return {
                items: this._scorerSearch(query, type, limit, filters),
                actualMode: 'weighted',
                fallbackReason: 'knowledge_truth_lookup_failed',
                semanticUsed: false,
                vectorUsed: false,
              };
            }
            results = projection.items;
            if (type !== 'all') {
              results = results.filter((r: SearchResultItem) => {
                if (type === 'rule') {
                  return r.kind === 'rule';
                }
                return r.type === 'recipe';
              });
            }
            results = this.#applyMetadataFilters(results, filters);
            results = results.slice(0, limit);
            return {
              items: results,
              actualMode: 'semantic',
              semanticUsed: true,
              vectorUsed: true,
              filteredOrphanVectorCount: projection.filteredOrphanVectorCount,
            };
          }
        } catch (vecErr: unknown) {
          const errorMessage = vecErr instanceof Error ? vecErr.message : String(vecErr);
          this.logger.warn('Vector store query failed, falling back to FieldWeighted', {
            error: errorMessage,
          });
          return {
            items: this._scorerSearch(query, type, limit, filters),
            actualMode: 'weighted',
            fallbackReason: `vector_store_query_failed:${errorMessage}`,
            semanticUsed: false,
            vectorUsed: false,
          };
        }
      }

      this.logger.debug('Vector search fallback to FieldWeighted');
      return {
        items: this._scorerSearch(query, type, limit, filters),
        actualMode: 'weighted',
        fallbackReason: 'vector_store_unavailable_or_empty',
        semanticUsed: false,
        vectorUsed: false,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn('Semantic search failed, falling back to FieldWeighted', {
        error: errorMessage,
      });
      return {
        items: this._scorerSearch(query, type, limit, filters),
        actualMode: 'weighted',
        fallbackReason: `semantic_search_failed:${errorMessage}`,
        semanticUsed: false,
        vectorUsed: false,
      };
    }
  }

  /**
   * vector id/metadata → DB entryId 单源解析(P-D D1,2026-07-11 BiliDili 真机):
   * region 向量(id 前缀 recipe_region_,metadata 带 recipeId 而非 entryId)此前
   * 三处映射都不解析 → 每个 region 当独立 entryId,top-5 被同一 Recipe 垄断,
   * 且 _supplementDetails 按 region id 查 refs 落空(漂移标注只出现在主命中)。
   * 解析序:metadata.entryId(chunk 向量)→ metadata.recipeId(region 向量)→
   * region id 反解 → 'entry_' 前缀剥离兜底。
   */
  #resolveVectorEntryId(rawId: string, metadata: Record<string, unknown>): string {
    const explicit = (metadata.entryId as string) || (metadata.recipeId as string);
    if (explicit) {
      return explicit.replace(/^entry_/, '');
    }
    const regionBase = parseRecipeIdFromRegionVectorId(rawId);
    if (regionBase) {
      return regionBase;
    }
    return rawId.replace(/^entry_/, '');
  }

  /**
   * 按 entryId 去重 — 同一 Recipe 的多个 chunk 只保留最高分的
   * 解决向量搜索返回同一条目的多个 chunk 浪费结果位的问题
   */
  #deduplicateByEntryId(items: SearchResultItem[]): SearchResultItem[] {
    const seen = new Map<string, SearchResultItem>();
    for (const item of items) {
      const existing = seen.get(item.id);
      if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
        seen.set(item.id, item);
      }
    }
    return [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  /**
   * 评估 weighted 搜索结果的 confidence，决定是否需要语义搜索
   * 返回 0-100 的分数，>= 60 跳过语义
   */
  #computeWeightedConfidence(
    query: string,
    items: SearchResultItem[],
    requestedLimit: number
  ): number {
    let score = 0;

    // ── 结果质量信号 ──
    // FieldWeightedScorer 分数范围约 0-20，归一化后判断
    const topScore = items[0]?.score ?? 0;
    const secondScore = items[1]?.score ?? 0;

    // top1 与 top2 分差大 → 明确命中
    if (items.length >= 2 && topScore > 0) {
      const relativeGap = (topScore - secondScore) / topScore;
      if (relativeGap > 0.3) {
        score += 25;
      } else if (relativeGap > 0.15) {
        score += 15;
      }
    }

    // title/trigger 匹配（子串级别）
    const lq = query.toLowerCase();
    const matchLevel = items.slice(0, 3).reduce((best, it) => {
      const t = (it.title || '').toLowerCase();
      const tr = (it.trigger || '').toLowerCase();
      if (t === lq || tr === lq || tr === `@${lq}`) {
        return Math.max(best, 3); // 完全匹配
      }
      if (t.includes(lq) || tr.includes(lq)) {
        return Math.max(best, 2); // 子串匹配
      }
      if (lq.includes(t) && t.length > 3) {
        return Math.max(best, 1); // 反向包含
      }
      return best;
    }, 0);
    if (matchLevel === 3) {
      score += 50;
    } else if (matchLevel === 2) {
      score += 35;
    } else if (matchLevel === 1) {
      score += 15;
    }

    // 代码术语检测（CamelCase、snake_case、@trigger）
    if (
      /^[A-Z][a-zA-Z0-9]+$/.test(query) ||
      /^[a-z]+(_[a-z]+)+$/.test(query) ||
      query.startsWith('@')
    ) {
      score += 25;
    }

    // 候选充足
    if (items.length >= requestedLimit) {
      score += 10;
    }

    // ── 查询特征信号（降低 confidence → 倾向调用语义）──
    // 中文自然语言疑问句
    if (/[如怎什为何哪]么?|是否|有没有|都有哪些|应该|需要/.test(query)) {
      score -= 40;
    }
    // 英文自然语言问句
    if (/^(how|what|why|when|where|which|can|does|is|should)\b/i.test(query)) {
      score -= 40;
    }
    // 较长查询（可能是描述性语句）
    if (query.length > 20) {
      score -= 20;
    } else if (query.length > 10) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Project vector-derived candidates through the request-scoped knowledge repository.
   * Missing/deprecated rows are stale index entries, never public knowledge results.
   * The query remains read-only and survivor order/scores are preserved.
   */
  #projectLiveVectorCandidates(items: SearchResultItem[]): {
    ok: boolean;
    items: SearchResultItem[];
    filteredOrphanVectorCount: number;
  } {
    if (items.length === 0) {
      return { ok: true, items, filteredOrphanVectorCount: 0 };
    }

    const ids = items.map((item) => item.id);
    let rows: DbRow[];
    try {
      rows = this.#knowledgeRepo.findByIdsDetailSync(ids) as unknown as DbRow[];
    } catch (err: unknown) {
      this.logger.warn('Vector candidate truth lookup failed', {
        candidateCount: ids.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, items: [], filteredOrphanVectorCount: 0 };
    }

    const liveRows = rows.filter(
      (row) => String(row.lifecycle ?? row.status ?? '').toLowerCase() !== 'deprecated'
    );
    const liveIds = new Set(liveRows.map((row) => row.id));
    const liveItems = items.filter((item) => liveIds.has(item.id));
    this._supplementDetails(liveItems, liveRows);

    return {
      ok: true,
      items: liveItems,
      filteredOrphanVectorCount: Math.min(10_000, items.length - liveItems.length),
    };
  }

  async #retrieveCanonical(
    query: string,
    topK: number,
    filters: NormalizedSearchMetadataFilters,
    type: string
  ): Promise<{
    items: SearchResultItem[];
    vectorUsed: boolean;
    fallbackReason?: string;
    filteredOrphanCount: number;
  }> {
    const { type: requestedTypes, ...truthFilters } = filters;
    const requestsRule =
      type === 'rule' || requestedTypes?.some((value) => value.toLowerCase() === 'rule');
    const canonicalFilter = {
      ...truthFilters,
      ...(requestsRule ? { kind: ['rule'] } : {}),
    };
    const result = await this.knowledgeRetrievalPort!.retrieve({
      filter: Object.keys(canonicalFilter).length > 0 ? canonicalFilter : undefined,
      query,
      topK,
    });
    const items = result.candidates.map((candidate) => this.#mapKnowledgeCandidate(candidate));
    this._supplementDetails(
      items,
      result.candidates.map((candidate) => candidate.recipe as DbRow)
    );
    return {
      ...(result.diagnostics.fallbackReason
        ? { fallbackReason: result.diagnostics.fallbackReason }
        : {}),
      filteredOrphanCount: result.diagnostics.filteredOrphanCount,
      items,
      vectorUsed: result.candidates.some((candidate) => candidate.vectorUsed),
    };
  }

  #mapKnowledgeCandidate(candidate: KnowledgeRetrievalCandidate): SearchResultItem {
    const recipe = candidate.recipe;
    return {
      ...recipe,
      denseRank: candidate.denseRank,
      denseSimilarity: candidate.denseSimilarity,
      fallbackReason: candidate.fallbackReason,
      id: candidate.recipeId,
      kind: typeof recipe.kind === 'string' ? recipe.kind : 'pattern',
      score: candidate.score,
      scoreBreakdown: {
        denseRank: candidate.denseRank,
        denseSimilarity: candidate.denseSimilarity,
        rrfContribution: candidate.rrfContribution,
        sparseRank: candidate.sparseRank,
        sparseScore: candidate.sparseScore,
      },
      semanticScore: candidate.denseSimilarity,
      semanticUsed: candidate.semanticUsed,
      sparseRank: candidate.sparseRank,
      sparseScore: candidate.sparseScore,
      title: typeof recipe.title === 'string' ? recipe.title : candidate.recipeId,
      type: 'recipe',
      vectorScore: candidate.denseSimilarity,
      vectorUsed: candidate.vectorUsed,
      rrfContribution: candidate.rrfContribution,
      regionEvidence: candidate.regionEvidence,
      retrievalDiagnostics: candidate.diagnostics,
    };
  }

  /**
   * 补充详细字段（content / description / trigger / delivery 字段）— 批量 IN 查询
   * 用于向量搜索结果与 FieldWeighted 结果的一致性
   */
  _supplementDetails(items: SearchResultItem[], detailRows?: DbRow[]) {
    if (!items || items.length === 0) {
      return;
    }
    try {
      const ids = items.map((it: SearchResultItem) => it.id);
      let rows: DbRow[] = detailRows ?? [];
      if (detailRows === undefined) {
        try {
          rows = this.#knowledgeRepo.findByIdsDetailSync(ids) as unknown as DbRow[];
        } catch {
          /* table may not exist */
        }
      }
      const rowMap = new Map(rows.map((r) => [r.id, r]));
      for (const item of items) {
        const row = rowMap.get(item.id);
        if (row) {
          item.content = item.content || row.content || undefined;
          item.description = item.description || row.description || '';
          item.trigger = item.trigger || row.trigger || '';
          if (row.headers) {
            item.headers = row.headers;
          }
          if (row.moduleName) {
            item.moduleName = row.moduleName;
          }
          // Cursor 交付字段 — 供 Agent 投影生成 actionHint
          if (!item.whenClause && row.whenClause) {
            item.whenClause = row.whenClause;
          }
          if (!item.doClause && row.doClause) {
            item.doClause = row.doClause;
          }
          if (!item.dontClause && row.dontClause) {
            item.dontClause = row.dontClause;
          }
          // 排序信号补充 — 确保 Funnel/Ranker 有真实数据
          if (!item.language && row.language) {
            item.language = row.language;
          }
          if (!item.dimensionId && row.dimensionId) {
            item.dimensionId = row.dimensionId;
          }
          if (!item.category && row.category) {
            item.category = row.category;
          }
          if (!item.knowledgeType && row.knowledgeType) {
            item.knowledgeType = row.knowledgeType;
          }
          if (!item.kind && row.kind) {
            item.kind = row.kind;
          }
          if (!item.scope && row.scope) {
            item.scope = row.scope;
          }
          if (!item.updatedAt && row.updatedAt) {
            item.updatedAt = row.updatedAt;
          }
          if (!item.createdAt && row.createdAt) {
            item.createdAt = row.createdAt;
          }
          if (!item.difficulty && row.difficulty) {
            item.difficulty = row.difficulty;
          }
          // 解析 tags
          if (!item.tags || (Array.isArray(item.tags) && item.tags.length === 0)) {
            try {
              item.tags = JSON.parse(row.tags || '[]');
            } catch {
              /* ignore */
            }
          }
          // 解析 quality JSON → qualityScore
          if (!item.qualityScore) {
            try {
              item.qualityScore = JSON.parse(row.quality || '{}').overall || 0;
            } catch {
              /* ignore */
            }
          }
          // 解析 stats JSON → usageCount + authorityScore
          if (!item.usageCount) {
            try {
              const stats = JSON.parse(row.stats || '{}');
              item.usageCount =
                (stats.adoptions || 0) + (stats.applications || 0) + (stats.searchHits || 0);
              if (!item.authorityScore) {
                item.authorityScore = stats.authority || 0;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* DB may not be available */
    }

    // ── 从 recipe_source_refs 桥接表批量读取已验证的 sourceRefs ──
    try {
      const ids = items.map((it: SearchResultItem) => it.id);
      if (ids.length === 0) {
        return;
      }
      let refsRows: Array<{
        recipeId: string;
        sourcePath: string;
        status: string;
        newPath: string | null;
      }>;
      refsRows = this.#sourceRefRepo.findActiveByRecipeIds(ids);

      this.logger.debug('recipe_source_refs query', {
        idCount: ids.length,
        rowCount: refsRows.length,
      });

      // G-C P1:携带 per-ref 状态,不再把非 stale 锚点塌成无区分的扁平路径。
      // drifted(文件在、被引区间内容变)此前混进 refs 与 active 无从区分——检索因此
      // 对漂移视而不见。现聚合出 driftedSourceRefs 子集 + item 级 sourceRefStatus,
      // 供排序降权与输出透出(status='stale' 已被 findActiveByRecipeIds 在 SQL 层排除)。
      const refsMap = new Map<string, { refs: string[]; drifted: string[] }>();
      for (const row of refsRows) {
        const recipeId =
          ((row as Record<string, unknown>).recipeId as string) ??
          ((row as Record<string, unknown>).recipe_id as string);
        const sourcePath =
          ((row as Record<string, unknown>).sourcePath as string) ??
          ((row as Record<string, unknown>).source_path as string);
        const status = row.status;
        const newPath =
          ((row as Record<string, unknown>).newPath as string | null) ??
          ((row as Record<string, unknown>).new_path as string | null);
        const refPath = status === 'renamed' && newPath ? newPath : sourcePath;
        if (!refsMap.has(recipeId)) {
          refsMap.set(recipeId, { drifted: [], refs: [] });
        }
        const bucket = refsMap.get(recipeId);
        bucket?.refs.push(refPath);
        if (status === 'drifted') {
          bucket?.drifted.push(refPath);
        }
      }

      for (const item of items) {
        const bucket = refsMap.get(item.id);
        if (bucket && bucket.refs.length > 0) {
          item.sourceRefs = bucket.refs;
          if (bucket.drifted.length > 0) {
            item.driftedSourceRefs = bucket.drifted;
            item.sourceRefStatus = 'drifted';
          } else {
            item.sourceRefStatus = 'active';
          }
        }
      }
    } catch {
      /* recipe_source_refs table may not exist */
    }
  }

  /**
   * 刷新索引（增量模式）
   *
   * 策略:
   *  1. 如果尚未构建索引 → 全量 buildIndex()
   *  2. 否则只加载 updatedAt > lastIndexTime 的条目 + 已删除(deprecated)条目
   *     - 新增/更新 → scorer.updateDocument()
   *     - 已删除    → scorer.removeDocument()
   *  3. 清空缓存以确保搜索结果刷新
   *
   * @param [opts] - force=true 强制全量重建
   */
  refreshIndex(opts: { force?: boolean } = {}) {
    if (opts.force || !this._indexed || !this._lastIndexTime) {
      this._indexed = false;
      this.buildIndex();
      return;
    }

    this._cache.clear();

    try {
      // 查找自上次索引后更新的条目
      const changed = this.#knowledgeRepo.findUpdatedSinceSync(
        this._lastIndexTime!
      ) as unknown as DbRow[];

      let added = 0;
      let removed = 0;

      for (const r of changed) {
        if (r.lifecycle === 'deprecated') {
          // 已废弃 → 从索引中移除
          if (this.scorer.removeDocument(r.id)) {
            removed++;
          }
          continue;
        }

        // 解析文档文本（复用 buildIndex 逻辑）
        const text = this._buildDocText(r);
        const meta = this._buildDocMeta(r);
        this.scorer.updateDocument(r.id, text, meta);
        added++;
      }

      this._lastIndexTime = new Date().toISOString();
      if (added > 0 || removed > 0) {
        this.logger.info('Search index refreshed (incremental)', { added, removed });
      }
    } catch (err: unknown) {
      // 增量失败 → 降级全量重建
      this.logger.warn('Incremental refresh failed, falling back to full rebuild', {
        error: (err as Error).message,
      });
      this._indexed = false;
      this.buildIndex();
    }
  }

  /**
   * 从 DB 行构建索引文本
   *
   * 高价值字段（title, trigger）通过重复出现提升 TF 权重
   * — title ×3, trigger ×2, description ×1.5（通过重复 token 实现）
   * 这确保标题匹配的文档获得显著更高的分数
   * 注：FieldWeightedScorer 内部已有字段权重机制，此文本用于兼容通用 scorer 输入。
   */
  _buildDocText(r: DbRow) {
    return serializeRecipeRetrievalDocumentSetForSparse(
      projectRecipeRetrievalDocumentSet({
        ...r,
        content: parseJsonObject(r.content),
        reasoning: parseJsonObject(r.reasoning),
        retrievalProfile: r.retrievalProfile
          ? (parseJsonObject(r.retrievalProfile) as unknown as RecipeRetrievalProfile)
          : null,
        tags: parseJsonArray(r.tags),
      })
    );
  }

  /**
   * 从 DB 行构建文档 meta
   */
  _buildDocMeta(r: DbRow) {
    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(r.tags || '[]');
    } catch {
      /* ignore */
    }
    let usageCount = 0;
    let authorityScore = 0;
    try {
      const stats = JSON.parse(r.stats || '{}');
      usageCount = (stats.adoptions || 0) + (stats.applications || 0) + (stats.searchHits || 0);
      authorityScore = stats.authority || 0;
    } catch {
      /* ignore */
    }
    let qualityOverall = 0;
    try {
      qualityOverall = JSON.parse(r.quality || '{}').overall || 0;
    } catch {
      /* ignore */
    }
    const documentSet = projectRecipeRetrievalDocumentSet({
      ...r,
      content: parseJsonObject(r.content),
      reasoning: parseJsonObject(r.reasoning),
      retrievalProfile: r.retrievalProfile
        ? (parseJsonObject(r.retrievalProfile) as unknown as RecipeRetrievalProfile)
        : null,
      tags: parseJsonArray(r.tags),
    });
    const sparseProjection = projectRecipeRetrievalSparseProjection(documentSet);
    return {
      type: 'knowledge',
      title: r.title,
      trigger: r.trigger || '',
      description: r.description || '',
      contentText: sparseProjection.text,
      retrievalIntentText: sparseProjection.intentText,
      retrievalBoundaryText: sparseProjection.boundaryText,
      retrievalSupportText: sparseProjection.supportText,
      status: r.lifecycle,
      knowledgeType: r.knowledgeType,
      kind: r.kind || 'pattern',
      language: r.language || '',
      dimensionId: r.dimensionId || '',
      category: r.category || '',
      scope: r.scope || '',
      updatedAt: r.updatedAt || null,
      createdAt: r.createdAt || null,
      difficulty: r.difficulty || 'intermediate',
      tags: parsedTags,
      usageCount,
      authorityScore,
      qualityScore: qualityOverall,
    };
  }

  #metadataFilterOnlySearch(
    type: string,
    limit: number,
    filters: NormalizedSearchMetadataFilters
  ): SearchResultItem[] {
    const docs = this.scorer.documents as Array<{
      id?: string;
      meta?: Record<string, unknown>;
    } | null>;
    const items: SearchResultItem[] = [];

    for (const doc of docs) {
      if (!doc?.id || !doc.meta) {
        continue;
      }
      if (!this.#matchesTypeFilter(doc.meta, type)) {
        continue;
      }
      if (!this.#matchesMetadataRecord(doc.meta, filters)) {
        continue;
      }
      items.push(this.#mapMetaToSearchItem(doc.id, doc.meta, 1, filters));
    }

    this._supplementDetails(items);
    return items.slice(0, limit);
  }

  #normalizeMetadataFilters(options: SearchOptions): NormalizedSearchMetadataFilters {
    const rawFilters =
      options.filters && typeof options.filters === 'object'
        ? (options.filters as Record<string, unknown>)
        : {};
    const filters: NormalizedSearchMetadataFilters = {};
    const keys: SearchMetadataFilterKey[] = [
      'category',
      'dimensionId',
      'kind',
      'knowledgeType',
      'language',
      'scope',
      'tags',
      'type',
    ];

    for (const key of keys) {
      let values = this.#normalizeFilterValues(
        rawFilters[key] ?? (options as Record<string, unknown>)[key]
      );
      // 'all' 是范围哨兵（route/调用方的 type 默认值），不是 metadata 过滤值。
      // 2026-07-06 真机定案：type:'all' 被当真实条件传进向量道，而向量 metadata
      // 没有 type 字段 → 全部候选被灭、语义检索恒 0。哨兵进 filter 一律剔除。
      if (key === 'type') {
        values = values.filter((value) => value !== 'all');
      }
      if (values.length > 0) {
        filters[key] = values;
      }
    }

    const tagValues = [
      ...this.#normalizeFilterValues(rawFilters.tag),
      ...this.#normalizeFilterValues((options as Record<string, unknown>).tag),
    ];
    if (tagValues.length > 0) {
      filters.tags = [...new Set([...(filters.tags ?? []), ...tagValues])].sort();
    }

    return filters;
  }

  #normalizeFilterValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return [
        ...new Set(
          value
            .flatMap((item) => this.#normalizeFilterValues(item))
            .filter((item) => item.length > 0)
        ),
      ].sort();
    }
    if (typeof value !== 'string') {
      return [];
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return this.#normalizeFilterValues(parsed);
        }
      } catch {
        /* keep comma splitting fallback */
      }
    }
    return [
      ...new Set(
        trimmed
          .split(',')
          .map((item) => this.#normalizeComparableValue(item))
          .filter((item) => item.length > 0)
      ),
    ].sort();
  }

  #hasMetadataFilters(filters: NormalizedSearchMetadataFilters): boolean {
    return Object.values(filters).some((values) => Array.isArray(values) && values.length > 0);
  }

  #metadataFilterCacheKey(filters: NormalizedSearchMetadataFilters): string {
    if (!this.#hasMetadataFilters(filters)) {
      return 'nofilters';
    }
    return JSON.stringify(
      Object.entries(filters)
        .filter(([, values]) => Array.isArray(values) && values.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }

  #applyMetadataFilters<T extends SearchResultItem>(
    items: T[],
    filters: NormalizedSearchMetadataFilters
  ): T[] {
    if (!this.#hasMetadataFilters(filters)) {
      return items;
    }
    return items
      .filter((item) => this.#matchesMetadataRecord(item as Record<string, unknown>, filters))
      .map(
        (item) =>
          ({
            ...item,
            matchedFilters: this.#matchedFilterEvidence(item as Record<string, unknown>, filters),
          }) as T
      );
  }

  #matchesMetadataRecord(
    record: Record<string, unknown>,
    filters: NormalizedSearchMetadataFilters
  ): boolean {
    if (!this.#hasMetadataFilters(filters)) {
      return true;
    }
    for (const [key, expected] of Object.entries(filters) as Array<
      [SearchMetadataFilterKey, string[]]
    >) {
      if (expected.length === 0) {
        continue;
      }
      const actual = this.#metadataValues(record, key);
      if (actual.length === 0) {
        return false;
      }
      const matched = actual.some((value) => expected.includes(value));
      if (!matched) {
        return false;
      }
    }
    return true;
  }

  #matchedFilterEvidence(
    record: Record<string, unknown>,
    filters: NormalizedSearchMetadataFilters
  ): Record<string, string[]> | undefined {
    if (!this.#hasMetadataFilters(filters)) {
      return undefined;
    }
    const evidence: Record<string, string[]> = {};
    for (const [key, expected] of Object.entries(filters) as Array<
      [SearchMetadataFilterKey, string[]]
    >) {
      const actual = this.#metadataValues(record, key);
      const matched = actual.filter((value) => expected.includes(value));
      if (matched.length > 0) {
        evidence[key] = matched;
      }
    }
    return evidence;
  }

  #metadataValues(record: Record<string, unknown>, key: SearchMetadataFilterKey): string[] {
    if (key === 'tags') {
      return this.#readStringArray(record.tags).map((value) =>
        this.#normalizeComparableValue(value)
      );
    }
    if (key === 'type') {
      return [
        ...this.#readStringArray(record.type),
        ...this.#readStringArray(record.kind),
        ...this.#readStringArray(record.knowledgeType),
      ].map((value) => this.#normalizeComparableValue(value));
    }
    return this.#readStringArray(record[key]).map((value) => this.#normalizeComparableValue(value));
  }

  #readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
    if (typeof value !== 'string') {
      return [];
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is string => typeof item === 'string' && item.length > 0
          );
        }
      } catch {
        /* keep scalar fallback */
      }
    }
    return [trimmed];
  }

  #normalizeComparableValue(value: string): string {
    return value.trim().toLowerCase();
  }

  #matchesTypeFilter(record: Record<string, unknown>, type: string): boolean {
    if (type === 'all') {
      return true;
    }
    if (type === 'rule') {
      return record.knowledgeType === 'boundary-constraint' || record.kind === 'rule';
    }
    return record.type === 'recipe' || record.type === 'knowledge';
  }

  #mapMetaToSearchItem(
    id: string,
    meta: Record<string, unknown>,
    score: number,
    filters: NormalizedSearchMetadataFilters
  ): SearchResultItem {
    return {
      id,
      title: (meta.title as string) || id,
      trigger: (meta.trigger as string) || '',
      type: (meta.type as string) || 'knowledge',
      kind: (meta.kind as string) || 'pattern',
      status: meta.status as string | undefined,
      language: (meta.language as string) || '',
      dimensionId: (meta.dimensionId as string) || '',
      category: (meta.category as string) || '',
      knowledgeType: (meta.knowledgeType as string) || '',
      scope: (meta.scope as string) || '',
      score,
      tags: this.#readStringArray(meta.tags),
      matchedFilters: this.#matchedFilterEvidence(meta, filters),
      scoreBreakdown: { metadataFilter: score },
    };
  }

  #mapVectorLikeResult(
    id: string,
    score: number,
    source: Record<string, unknown>
  ): SearchResultItem {
    const data = (source.data as Record<string, unknown>) || {};
    const base = (data.item as Record<string, unknown>) || data || {};
    const metadata = (base.metadata as Record<string, unknown>) || {};
    const rawId = (base.id as string) || id;
    const entryId = this.#resolveVectorEntryId(rawId, metadata);
    const roundedScore = Math.round(score * 1000) / 1000;
    return {
      id: entryId,
      title: ((base.title as string) || (metadata.title as string) || entryId) as string,
      type: ((base.type as string) || (metadata.type as string) || 'recipe') as string,
      kind: ((base.kind as string) || (metadata.kind as string) || 'pattern') as string,
      status: ((base.status as string) || (metadata.status as string) || 'active') as string,
      score: roundedScore,
      semanticScore: source.semanticUsed === false ? 0 : roundedScore,
      vectorScore: source.vectorUsed === false ? 0 : roundedScore,
      semanticUsed: source.semanticUsed !== false && source.vectorUsed === true,
      vectorUsed: source.vectorUsed === true,
      fallbackReason: source.fallbackReason as string | undefined,
      content: base.content as string | undefined,
      description: ((base.description as string) || (metadata.description as string)) as
        | string
        | undefined,
      language: ((base.language as string) || (metadata.language as string) || '') as string,
      dimensionId: ((base.dimensionId as string) ||
        (metadata.dimensionId as string) ||
        '') as string,
      category: ((base.category as string) || (metadata.category as string) || '') as string,
      knowledgeType: ((base.knowledgeType as string) ||
        (metadata.knowledgeType as string) ||
        '') as string,
      scope: ((base.scope as string) || (metadata.scope as string) || '') as string,
      tags: this.#readStringArray(base.tags ?? metadata.tags),
      scoreBreakdown: {
        semantic: source.semanticUsed === false ? 0 : roundedScore,
        vector: source.vectorUsed === true ? roundedScore : 0,
      },
    };
  }

  /** 获取索引统计（如果尚未构建索引，自动触发构建） */
  getStats() {
    return {
      indexed: this._indexed,
      totalDocuments: this.scorer.totalDocs,
      avgDocLength: Math.round(this.scorer.avgLength * 10) / 10,
      cacheSize: this._cache.size,
      uniqueTokens: Object.keys(this.scorer.docFreq).length,
      hasVectorStore: !!this.vectorStore,
      hasVectorService: !!this.vectorService,
      hasAiProvider: !!this.aiProvider,
    };
  }

  _getCache(key: string) {
    const entry = this._cache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.time > this._cacheMaxAge) {
      this._cache.delete(key);
      return null;
    }
    // LRU: 重新插入以更新 Map 迭代顺序，使热点 key 不被淘汰
    this._cache.delete(key);
    this._cache.set(key, entry);
    return entry.data;
  }

  _setCache(key: string, data: SearchResponse) {
    // LRU：超限时批量淘汰最旧的 20%
    if (this._cache.size > 500) {
      const toDelete = Math.floor(this._cache.size * 0.2);
      const keys = this._cache.keys();
      for (let i = 0; i < toDelete; i++) {
        const k = keys.next().value;
        if (k !== undefined) {
          this._cache.delete(k);
        }
      }
    }
    this._cache.set(key, { data, time: Date.now() });
  }
}

export default SearchEngine;

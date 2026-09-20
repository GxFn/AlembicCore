/**
 * HybridRetriever — 统一混合检索 (RRF 融合)
 *
 * 使用 Reciprocal Rank Fusion (RRF) 融合 Dense + Sparse 搜索:
 *   score = Σ 1/(k + rank_i)
 *
 * RRF 优势:
 * - 不需要分数归一化 (不同检索器分数尺度无关)
 * - 对异常高分 (outlier) 不敏感
 * - 数学性质稳定 (有界, 单调)
 * - 原始相似度作为证据保留，不参与不同通道间的分数量纲比较
 *
 * @module service/search/HybridRetriever
 */

import { WeightedRrfAccumulator } from '../../shared/WeightedRrfAccumulator.js';

interface RetrievalResult {
  id?: string;
  item?: { id?: string };
  score?: number;
  [key: string]: unknown;
}

export class HybridRetriever {
  #vectorStore;
  #rrfK;
  #defaultAlpha;

  /**
   * @param [options.rrfK=60] RRF 常数 (k), 值越大越平滑
   * @param [options.alpha=0.5] Dense 权重 (1-alpha = Sparse 权重)
   */
  constructor(
    options: {
      vectorStore?: {
        searchVector: (
          vector: number[],
          opts: { topK: number; filter?: unknown }
        ) => Promise<RetrievalResult[]>;
      } | null;
      rrfK?: number;
      alpha?: number;
    } = {}
  ) {
    this.#vectorStore = options.vectorStore || null;
    this.#rrfK = options.rrfK || 60;
    this.#defaultAlpha = options.alpha ?? 0.5;
  }

  /**
   * RRF 融合搜索
   *
   * Dense: vectorStore 向量搜索 (HNSW or brute-force)
   * Sparse: keyword / lexical 搜索 (由外部传入结果)
   *
   * @param params.denseResults - 向量搜索结果
   * @param params.sparseResults - 关键词搜索结果
   * @param [params.alpha=0.5] Dense 权重
   * @returns >}
   */
  fuse({
    denseResults = [] as RetrievalResult[],
    sparseResults = [] as RetrievalResult[],
    topK = 10,
    alpha = 0.5,
  }) {
    const fusion = new WeightedRrfAccumulator<RetrievalResult>(this.#rrfK, alpha);
    denseResults.forEach((result, rank) => {
      const id = result.item?.id || result.id;
      if (!id) {
        return;
      }
      fusion.add(id, 'dense', rank, result.score).payload = result;
    });
    sparseResults.forEach((result, rank) => {
      const id = result.id;
      if (!id) {
        return;
      }
      const entry = fusion.add(id, 'sparse', rank, result.score);
      // 保留旧 payload 规则：dense 的 item 或首个带 item 的 sparse 会阻止后续 sparse 覆盖。
      if (!entry.payload?.item) {
        entry.payload = result;
      }
    });

    return fusion.ranked(topK).map((entry) => ({
      id: entry.id,
      denseRank: entry.dense?.rank ?? Infinity,
      sparseRank: entry.sparse?.rank ?? Infinity,
      rrfScore: entry.total,
      data: entry.payload!,
      ...(entry.dense
        ? { denseSimilarity: entry.dense.score, denseContribution: entry.dense.contribution }
        : {}),
      ...(entry.sparse
        ? { sparseScore: entry.sparse.score, sparseContribution: entry.sparse.contribution }
        : {}),
      score: entry.total,
      rrfContribution: {
        dense: entry.dense?.contribution ?? 0,
        sparse: entry.sparse?.contribution ?? 0,
        total: entry.total,
      },
    }));
  }

  /**
   * 完整搜索: 同时执行 Dense + Sparse 并融合
   *
   * @param query 查询文本
   * @param queryVector 查询向量
   * @param [options.sparseSearchFn] 外部 sparse 搜索函数 (query, limit) => results[]
   */
  async search(
    query: string,
    queryVector: number[] | null,
    options: {
      topK?: number;
      alpha?: number;
      filter?: unknown;
      sparseSearchFn?: ((query: string, limit: number) => RetrievalResult[]) | null;
    } = {}
  ) {
    const { topK = 10, alpha = this.#defaultAlpha, filter = null, sparseSearchFn = null } = options;
    const expandedK = topK * 3; // 每路召回更多候选以提高融合质量

    // 并行执行 Dense + Sparse
    const [denseResults, sparseResults] = await Promise.all([
      queryVector?.length && this.#vectorStore
        ? this.#vectorStore.searchVector(queryVector, { topK: expandedK, filter })
        : Promise.resolve([]),
      sparseSearchFn ? Promise.resolve(sparseSearchFn(query, expandedK)) : Promise.resolve([]),
    ]);

    return this.fuse({
      denseResults,
      sparseResults,
      topK,
      alpha,
    });
  }
}

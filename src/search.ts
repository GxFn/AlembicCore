import { SearchEngine } from './service/search/SearchEngine.js';
import type {
  SearchDb as SearchEngineDb,
  SearchEngineOptions,
} from './service/search/SearchTypes.js';

export { BM25Scorer } from './service/search/BM25Scorer.js';
export { CoarseRanker } from './service/search/CoarseRanker.js';
export type { SearchContext, SearchItem } from './service/search/contextBoost.js';
export { contextBoost } from './service/search/contextBoost.js';
export { FieldWeightedScorer } from './service/search/FieldWeightedScorer.js';
export { HybridRetriever } from './service/search/HybridRetriever.js';
export {
  AuthoritySignal,
  ContextMatchSignal,
  DifficultySignal,
  MultiSignalRanker,
  PopularitySignal,
  RecencySignal,
  RelevanceSignal,
  VectorSignal,
} from './service/search/MultiSignalRanker.js';
export { SearchEngine };
export type {
  GuardKnowledgeRepo,
  SearchDb as SearchAdapterDb,
  SearchKnowledgeRepo,
  SearchSourceRefRepo,
} from './repository/search/SearchRepoAdapter.js';
export {
  queryNonDeprecatedEntries,
  RawDbGuardAdapter,
  RawDbKnowledgeAdapter,
  RawDbSourceRefAdapter,
  unwrapRawDb,
  unwrapSearchDb,
} from './repository/search/SearchRepoAdapter.js';
export type {
  BM25DocMeta,
  DbRow,
  DocMeta,
  RankingContext,
  RrfHit,
  Scorer,
  ScorerResult,
  SearchAiProvider,
  SearchCrossEncoder,
  SearchDb,
  SearchEngineOptions,
  SearchHybridRetriever,
  SearchOptions,
  SearchResponse,
  SearchResultItem,
  SearchVectorService,
  SearchVectorStore,
  SlimSearchResult,
  VectorHit,
} from './service/search/SearchTypes.js';
export {
  groupByKind,
  slimSearchResult,
} from './service/search/SearchTypes.js';
export { tokenize } from './service/search/tokenizer.js';
export {
  cosineSimilarity,
  jaccardSimilarity,
  textSimilarity,
  tokenizeForSimilarity,
} from './shared/similarity.js';

/**
 * 创建完整搜索引擎。
 *
 * Core 只稳定本地检索、排序和可注入的语义检索契约；AI reranker/provider
 * 的实现、API key 和调用策略仍由宿主仓库负责。
 */
export function createSearchEngine(
  db: SearchEngineDb & { getDb?: () => SearchEngineDb },
  options: SearchEngineOptions = {}
): SearchEngine {
  return new SearchEngine(db as unknown as ConstructorParameters<typeof SearchEngine>[0], options);
}

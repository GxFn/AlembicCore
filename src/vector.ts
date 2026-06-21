import { HnswVectorAdapter } from './infrastructure/vector/HnswVectorAdapter.js';
import { JsonVectorAdapter } from './infrastructure/vector/JsonVectorAdapter.js';
import type { VectorStore } from './infrastructure/vector/VectorStore.js';
import type { VectorServiceConfig } from './service/vector/VectorService.js';
import { VectorService } from './service/vector/VectorService.js';

export {
  chunkByAST,
  ensureParser,
  isASTChunkerAvailable,
  LANG_ID_MAP,
  TOP_LEVEL_TYPES,
} from './infrastructure/vector/ASTChunker.js';
export { AsyncPersistence, crc32, WAL_OP } from './infrastructure/vector/AsyncPersistence.js';
export { BatchEmbedder } from './infrastructure/vector/BatchEmbedder.js';
export {
  BinaryPersistence,
  FLAG_HAS_HNSW_GRAPH,
  FLAG_HAS_QUANTIZER,
  FLAG_SQ8_VECTORS,
  HEADER_SIZE,
  MAGIC,
  VERSION,
} from './infrastructure/vector/BinaryPersistence.js';
export {
  chunk,
  DEFAULT_MAX_CHUNK_TOKENS,
  DEFAULT_OVERLAP_TOKENS,
  estimateTokens,
} from './infrastructure/vector/Chunker.js';
export { cosineDistance, HnswIndex, MaxHeap, MinHeap } from './infrastructure/vector/HnswIndex.js';
export { HnswVectorAdapter } from './infrastructure/vector/HnswVectorAdapter.js';
export { IndexingPipeline } from './infrastructure/vector/IndexingPipeline.js';
export { JsonVectorAdapter } from './infrastructure/vector/JsonVectorAdapter.js';
export { ScalarQuantizer } from './infrastructure/vector/ScalarQuantizer.js';
export { VectorMigration } from './infrastructure/vector/VectorMigration.js';
export { VectorStore } from './infrastructure/vector/VectorStore.js';
export type {
  VectorChunkData,
  VectorChunkEnricher,
  VectorDocumentInfo,
} from './service/vector/EnrichmentTypes.js';
export type {
  RecipeRegionBuildOptions,
  RecipeRegionGenerationTestOptions,
  RecipeRegionGenerationTestReport,
  RecipeRegionGenerationTestRetrievalSample,
  RecipeRegionGenerationTestSampleQuery,
  RecipeRegionRemovalResult,
  RecipeRegionSourceEntry,
  RecipeRegionSyncOptions,
  RecipeRegionSyncResult,
  RecipeRegionSyncStatus,
  RecipeRegionVectorMetadata,
  RecipeSemanticRegionChunk,
  RecipeSemanticRegionClass,
  RecipeSourceRefsBridge,
  SourceRefsBridgeStatus,
} from './service/vector/RecipeRegionVectorIndex.js';
export {
  buildRecipeSemanticRegionChunks,
  parseRecipeIdFromRegionVectorId,
  RECIPE_REGION_VECTOR_ID_PREFIX,
  RECIPE_REGION_VECTOR_SCHEMA_VERSION,
  RECIPE_SEMANTIC_REGION_CLASSES,
  RECIPE_SEMANTIC_REGION_METADATA_TYPE,
  syncRecipeSemanticRegionVectors,
  testRecipeSemanticRegionGeneration,
} from './service/vector/RecipeRegionVectorIndex.js';
export type { SyncCoordinatorConfig } from './service/vector/SyncCoordinator.js';
export { SyncCoordinator } from './service/vector/SyncCoordinator.js';
export { VectorService };
export type {
  FetchLike,
  FetchRequestInit,
  FetchResponseLike,
  OllamaEmbedProviderConfig,
  OllamaProbeResult,
} from './infrastructure/vector/OllamaEmbedProvider.js';
// GMAP-L1: local Ollama embedding lane (Core).
export { OllamaEmbedProvider } from './infrastructure/vector/OllamaEmbedProvider.js';
export type {
  ApplyEmbedLaneResult,
  EmbedLane,
  EmbedLaneDiagnostic,
  EmbedLaneName,
  EmbedLaneSelection,
} from './service/vector/EmbedProviderSelector.js';
export {
  applyEmbedLane,
  buildLocalFirstEmbedLanes,
  createOllamaEmbedLane,
  embedLaneFromProvider,
  keywordEmbedLane,
  selectAndApplyEmbedLane,
  selectEmbedLane,
} from './service/vector/EmbedProviderSelector.js';
export type {
  BuildResult,
  EmbedProvider,
  ProgressFn,
  ProgressInfo,
  SyncResult,
  VectorAvailability,
  VectorAvailabilityProbeStatus,
  VectorAvailabilityReason,
  VectorAvailabilityStatus,
  VectorHybridSearchHit,
  VectorServiceConfig,
  VectorStats,
} from './service/vector/VectorService.js';

export type LocalVectorStoreKind = 'json' | 'hnsw';
export type JsonVectorStoreOptions = NonNullable<
  ConstructorParameters<typeof JsonVectorAdapter>[1]
>;
export type HnswVectorStoreOptions = NonNullable<
  ConstructorParameters<typeof HnswVectorAdapter>[1]
>;

export interface CreateLocalVectorStoreOptions {
  kind?: LocalVectorStoreKind;
  json?: JsonVectorStoreOptions;
  hnsw?: HnswVectorStoreOptions;
  initialize?: boolean;
}

/**
 * 创建 Core 本地向量存储。
 *
 * 这里稳定的是本地索引和分块能力；embedding provider 只是注入契约，
 * 具体模型、API key、限流和重试策略继续留在宿主仓库。
 */
export async function createLocalVectorStore(
  projectRoot: string,
  options: CreateLocalVectorStoreOptions = {}
): Promise<VectorStore> {
  const store = createLocalVectorStoreSync(projectRoot, options);

  if (options.initialize !== false) {
    await store.init();
  }

  return store;
}

export function createLocalVectorStoreSync(
  projectRoot: string,
  options: CreateLocalVectorStoreOptions = {}
): VectorStore {
  if (options.kind === 'hnsw') {
    return new HnswVectorAdapter(projectRoot, options.hnsw);
  }

  return new JsonVectorAdapter(projectRoot, options.json);
}

export function createVectorService(config: VectorServiceConfig): VectorService {
  return new VectorService(config);
}

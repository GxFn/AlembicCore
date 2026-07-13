import type {
  RecipeContext as RecipeContextContract,
  RecipeContextEnvelope,
  RecipeContextRequest,
  RecipeContextResult,
  RecipeDetailPayload,
  RecipeListPayload,
  RecipePrimePayload,
  RecipeRelationPayload,
  RecipeSearchPayload,
  RecipeSourceRefPayload,
} from './domain/recipe-context/index.js';
import type { KnowledgeRetrievalPort } from './service/search/KnowledgeRetrieval.js';

export type {
  RecipeContext,
  RecipeContextEnvelope,
  RecipeContextQueryError,
  RecipeContextRequest,
  RecipeContextRequestKind,
  RecipeContextResult,
  RecipeDetailPayload,
  RecipeListPayload,
  RecipeMetadataFilter,
  RecipePrimePayload,
  RecipeRelationPayload,
  RecipeSearchPayload,
  RecipeSourceRefPayload,
} from './domain/recipe-context/index.js';
export {
  isRecipeContextRequestKind,
  RECIPE_CONTEXT_CONTRACT_VERSION,
  RECIPE_CONTEXT_REQUEST_KIND_VALUES,
} from './domain/recipe-context/index.js';
export {
  createRecipeContextService,
  RecipeContextService,
} from './service/recipe-context/RecipeContextService.js';

import { createRecipeContextServiceFromCore as createInternalRecipeContextServiceFromCore } from './service/recipe-context/adapters/fromCore.js';
import type { RecipeContextService } from './service/recipe-context/RecipeContextService.js';

export interface RecipeContextKnowledgeEntry {
  toJSON(): Record<string, unknown>;
}

export interface RecipeContextKnowledgeService {
  get(id: string): Promise<RecipeContextKnowledgeEntry>;
  list(
    filters: Record<string, unknown>,
    pagination: { page?: number; pageSize?: number }
  ): Promise<{
    data: RecipeContextKnowledgeEntry[];
    pagination?: { page?: number; pageSize?: number; total?: number };
  }>;
}

export interface RecipeContextSourceRefRecord {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
  verifiedAt?: number;
}

export interface RecipeContextSourceRefService {
  findByRecipeId(recipeId: string): RecipeContextSourceRefRecord[];
  findBySourcePath(sourcePath: string): RecipeContextSourceRefRecord[];
  findByStatus(status: string): RecipeContextSourceRefRecord[];
  findStale(): RecipeContextSourceRefRecord[];
  findRenamed(): RecipeContextSourceRefRecord[];
}

export interface RecipeContextSearchItem {
  id: string;
  title?: string;
  score?: number;
  vectorScore?: number;
  vectorUsed?: boolean;
  semanticUsed?: boolean;
  fallbackReason?: string;
  matchedFilters?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface RecipeContextSearchResponse {
  items: RecipeContextSearchItem[];
  total?: number;
  searchMeta?: {
    vectorUsed?: boolean;
    semanticUsed?: boolean;
    fallbackReason?: string;
    [key: string]: unknown;
  };
}

export interface RecipeContextSearchService {
  search(query: string, options: Record<string, unknown>): Promise<RecipeContextSearchResponse>;
}

export interface RecipeContextVectorHit {
  id: string;
  score: number;
  vectorUsed?: boolean;
  semanticUsed?: boolean;
  fallbackReason?: string;
  recipeId?: string;
  regionClass?: string;
  content?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  item?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RecipeContextVectorService {
  hybridSearch(
    query: string,
    opts: { topK?: number; filter?: Record<string, unknown> | null }
  ): Promise<RecipeContextVectorHit[]>;
}

export interface RecipeContextCoreServices {
  knowledge: RecipeContextKnowledgeService;
  sourceRefRepository: RecipeContextSourceRefService;
  searchEngine?: RecipeContextSearchService | null;
  vectorService?: RecipeContextVectorService | null;
  retrieval?: KnowledgeRetrievalPort | null;
}

export interface RecipeContextCapabilities {
  execute: RecipeContextContract['execute'];
  readDetail(payload: RecipeDetailPayload): Promise<RecipeContextEnvelope<RecipeContextResult>>;
  listRecipes(payload?: RecipeListPayload): Promise<RecipeContextEnvelope<RecipeContextResult>>;
  searchRecipes(payload: RecipeSearchPayload): Promise<RecipeContextEnvelope<RecipeContextResult>>;
  primeRecipes(payload: RecipePrimePayload): Promise<RecipeContextEnvelope<RecipeContextResult>>;
  readSourceRefs(
    payload: RecipeSourceRefPayload
  ): Promise<RecipeContextEnvelope<RecipeContextResult>>;
  readRelations(
    payload: RecipeRelationPayload
  ): Promise<RecipeContextEnvelope<RecipeContextResult>>;
}

export function createRecipeContextCapabilities(
  recipeContext: RecipeContextContract
): RecipeContextCapabilities {
  const capabilities: RecipeContextCapabilities = {
    execute: (input: RecipeContextRequest) => recipeContext.execute(input),
    readDetail: (payload: RecipeDetailPayload) =>
      recipeContext.execute({ kind: 'detail', payload }),
    listRecipes: (payload: RecipeListPayload = {}) =>
      recipeContext.execute({ kind: 'list', payload }),
    searchRecipes: (payload: RecipeSearchPayload) =>
      recipeContext.execute({ kind: 'search', payload }),
    primeRecipes: (payload: RecipePrimePayload) =>
      recipeContext.execute({ kind: 'prime', payload }),
    readSourceRefs: (payload: RecipeSourceRefPayload) =>
      recipeContext.execute({ kind: 'source-refs', payload }),
    readRelations: (payload: RecipeRelationPayload) =>
      recipeContext.execute({ kind: 'relations', payload }),
  };
  return Object.freeze(capabilities);
}

export function createRecipeContextServiceFromCore(
  parts: RecipeContextCoreServices
): RecipeContextService {
  return createInternalRecipeContextServiceFromCore(parts);
}

export function createRecipeContextCapabilitiesFromCore(
  parts: RecipeContextCoreServices
): RecipeContextCapabilities {
  return createRecipeContextCapabilities(createRecipeContextServiceFromCore(parts));
}

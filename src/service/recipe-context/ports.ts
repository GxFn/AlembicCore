// RecipeContext read ports (GMAP-2). These interfaces are the ONLY surface the
// handlers depend on. Every method is a read query — there is no create / update
// / delete / publish, so KnowledgeService lifecycle cannot leak through the
// facade (D3: RecipeContext composes the public read paths, lifecycle stays in
// KnowledgeService). Concrete Core services are bound to these ports by the
// adapters/ layer.

import type { RecipeMetadataFilter, RecipeRecord } from '../../domain/recipe-context/index.js';
import type { KnowledgeRetrievalPort } from '../search/KnowledgeRetrieval.js';

export interface RecipeReadPage {
  items: RecipeRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Backed by KnowledgeService.get / list (public @alembic/core/knowledge read path). */
export interface RecipeReadPort {
  getRecipe(id: string): Promise<RecipeRecord | null>;
  listRecipes(
    filter: RecipeMetadataFilter,
    pagination: { page?: number; pageSize?: number }
  ): Promise<RecipeReadPage>;
}

export interface RecipeSearchPortHit {
  recipeId: string;
  title?: string;
  score: number;
  vectorScore?: number;
  vectorUsed: boolean;
  semanticUsed: boolean;
  matchedFilters?: Record<string, string[]>;
  denseSimilarity?: number;
  denseRank?: number;
  sparseScore?: number;
  sparseRank?: number;
  rrfContribution?: { dense: number; sparse: number; total: number };
}

export interface RecipeSearchPortResult {
  hits: RecipeSearchPortHit[];
  vectorUsed: boolean;
  semanticUsed: boolean;
  fallbackReason?: string;
  total: number;
}

/** Backed by SearchEngine.search (keyword + injected vector lane + ranking). */
export interface RecipeSearchPort {
  search(
    query: string,
    opts: { filter?: RecipeMetadataFilter; limit?: number; mode?: string }
  ): Promise<RecipeSearchPortResult>;
}

export interface RecipeRegionPortHit {
  id: string;
  recipeId: string;
  regionClass: string;
  score: number;
  content?: string;
  denseSimilarity?: number;
}

export interface RecipeRegionPortResult {
  hits: RecipeRegionPortHit[];
  /** false when the embed lane did not run (degraded keyword-only world). */
  vectorUsed: boolean;
  fallbackReason?: string;
}

/** Backed by VectorService.hybridSearch over recipe semantic-region vectors. */
export interface RecipeVectorPort {
  searchRegions(
    query: string,
    opts: { regionClasses?: string[]; limit?: number; filter?: RecipeMetadataFilter }
  ): Promise<RecipeRegionPortResult>;
}

export interface RecipeSourceRefRow {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
  verifiedAt?: number;
}

/** Backed by RecipeSourceRefRepository (recipe_source_refs). */
export interface RecipeSourceRefPort {
  findByRecipeIds(ids: string[]): RecipeSourceRefRow[] | Promise<RecipeSourceRefRow[]>;
  findBySourcePath(sourcePath: string): RecipeSourceRefRow[] | Promise<RecipeSourceRefRow[]>;
  findByStatus(status: string): RecipeSourceRefRow[] | Promise<RecipeSourceRefRow[]>;
  /** All rows regardless of status (active ∪ stale ∪ renamed). */
  listAll(): RecipeSourceRefRow[] | Promise<RecipeSourceRefRow[]>;
}

/**
 * Dependencies for a RecipeContextService. read + sourceRefs are mandatory;
 * search and vector are optional so a consumer that only needs detail /
 * source-refs can omit the search engine and vector store. Absent vector =>
 * prime degrades gracefully.
 */
export interface RecipeContextDeps {
  read: RecipeReadPort;
  sourceRefs: RecipeSourceRefPort;
  /** Canonical Search/Prime candidate truth. Preferred by all new wiring. */
  retrieval?: KnowledgeRetrievalPort | null;
  /** @deprecated Compatibility-only SearchEngine adapter. */
  search?: RecipeSearchPort | null;
  /** @deprecated Compatibility-only VectorService region adapter. */
  vector?: RecipeVectorPort | null;
}

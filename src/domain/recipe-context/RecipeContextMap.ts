// RecipeContext result map (GMAP-2): the read-only data shapes the four
// Agent-facing tools consume. RecipeRecord is the projected read view of a
// recipe (no lifecycle handles); the per-kind context types are returned by the
// matching RecipeContextService handler.

import type {
  RecipeContextJson,
  RecipeContextMetadata,
  RecipeContextRef,
} from './RecipeContextRefs.js';

/** One relation edge flattened from a recipe's relation buckets. */
export interface RecipeRelationEdge {
  type: string;
  target: string;
  description?: string;
}

/**
 * Read-only projection of a recipe (KnowledgeEntry). It deliberately omits
 * every lifecycle/mutation field so that nothing downstream of RecipeContext
 * can drive a state transition — lifecycle stays in KnowledgeService.
 */
export interface RecipeRecord {
  id: string;
  title: string;
  description?: string;
  lifecycle: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  kind?: string;
  knowledgeType?: string;
  scope?: string;
  moduleName?: string;
  sourceFile?: string | null;
  tags: string[];
  trigger?: string;
  topicHint?: string;
  summary?: string;
  content?: string;
  relations: RecipeRelationEdge[];
  sources: string[];
  qualityGrade?: string;
  updatedAt?: number;
  ref: RecipeContextRef;
}

/** Read view of a recipe_source_refs row. */
export interface RecipeSourceRefView {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
  verifiedAt?: number;
  ref: RecipeContextRef;
}

export interface RecipeDetailContext {
  recipe: RecipeRecord;
  sourceRefs: RecipeSourceRefView[];
  contentPreview?: string;
  nextRefs: RecipeContextRef[];
}

export interface RecipeListContext {
  recipes: RecipeRecord[];
  total: number;
  page: number;
  pageSize: number;
  nextRefs: RecipeContextRef[];
}

export interface RecipeSearchHitView {
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
  ref: RecipeContextRef;
}

export interface RecipeSearchContext {
  query: string;
  hits: RecipeSearchHitView[];
  vectorUsed: boolean;
  semanticUsed: boolean;
  fallbackReason?: string;
  nextRefs: RecipeContextRef[];
  candidateRecipeIds?: string[];
}

export interface RecipeSemanticRegionBlock {
  recipeId: string;
  regionClass: string;
  score: number;
  content?: string;
  ref: RecipeContextRef;
  denseSimilarity?: number;
}

export interface RecipePrimeContext {
  query: string;
  blocks: RecipeSemanticRegionBlock[];
  vectorUsed: boolean;
  fallbackReason?: string;
  nextRefs: RecipeContextRef[];
  candidateRecipeIds?: string[];
}

export interface RecipeSourceRefGroup {
  recipeId: string;
  refs: RecipeSourceRefView[];
}

export interface RecipeSourceRefContext {
  refs: RecipeSourceRefView[];
  byRecipe: RecipeSourceRefGroup[];
  query: RecipeContextMetadata;
  nextRefs: RecipeContextRef[];
}

export type RecipeRelationScoreImpact = 'positive' | 'neutral-or-caution';

export interface RecipeRelationStep {
  fromRecipeId: string;
  toRecipeId: string;
  relationType: string;
  scoreImpact: RecipeRelationScoreImpact;
}

export interface RecipeRelationChainView {
  hops: string[];
  steps: RecipeRelationStep[];
}

export interface RecipeRelationContext {
  rootRecipeId: string;
  chains: RecipeRelationChainView[];
  nextRefs: RecipeContextRef[];
}

/** Returned when a request kind is valid but the data cannot be produced. */
export interface RecipeContextUnavailableData {
  kind: string;
  available: false;
  reason: string;
  nextRefs: RecipeContextRef[];
  details?: RecipeContextJson;
}

export type RecipeContextResult =
  | RecipeDetailContext
  | RecipeListContext
  | RecipeSearchContext
  | RecipePrimeContext
  | RecipeSourceRefContext
  | RecipeRelationContext
  | RecipeContextUnavailableData;

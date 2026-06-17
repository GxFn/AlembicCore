// RecipeContext contracts (GMAP-2): the single execute() entrypoint, its request
// kinds, the deterministic query-error taxonomy, the per-kind payload shapes, and
// the shared metadata filter. Mirrors ProjectContextContracts so the two Core
// facades stay structurally aligned.

import type { RecipeContextResult } from './RecipeContextMap.js';
import type { RecipeContextRef } from './RecipeContextRefs.js';

export const RECIPE_CONTEXT_CONTRACT_VERSION = 1 as const;

export const RECIPE_CONTEXT_REQUEST_KIND_VALUES = [
  'detail',
  'list',
  'search',
  'prime',
  'source-refs',
  'relations',
] as const;

export type RecipeContextRequestKind = (typeof RECIPE_CONTEXT_REQUEST_KIND_VALUES)[number];

/**
 * Deterministic outcomes the four tools can rely on. not-found/ambiguous come
 * from id/ref resolution; stale-ref/renamed come from recipe_source_refs status;
 * unresolved means a location query matched no recipe; vector-unavailable is the
 * graceful-degradation marker when the embed lane is absent.
 */
export type RecipeContextQueryErrorCode =
  | 'invalid-request-kind'
  | 'invalid-payload'
  | 'query-unavailable'
  | 'not-found'
  | 'ambiguous'
  | 'stale-ref'
  | 'renamed'
  | 'unresolved'
  | 'vector-unavailable'
  | 'too-large';

export interface RecipeContextQueryError {
  code: RecipeContextQueryErrorCode;
  message: string;
  severity: 'error' | 'warning';
  ref?: RecipeContextRef;
  recipeId?: string;
  path?: string;
  retryable: boolean;
}

export interface RecipeContextRequest<TPayload = unknown> {
  kind: RecipeContextRequestKind;
  payload?: TPayload;
}

export interface RecipeContextEnvelope<T = RecipeContextResult> {
  contractVersion: typeof RECIPE_CONTEXT_CONTRACT_VERSION;
  queryKind: RecipeContextRequestKind;
  data: T;
  refs: RecipeContextRef[];
  errors?: RecipeContextQueryError[];
}

export interface RecipeContext {
  execute(input: RecipeContextRequest): Promise<RecipeContextEnvelope<RecipeContextResult>>;
}

/* ─── Per-kind payloads ─── */

/** Read-only metadata filter shared by search / prime / source-refs. */
export interface RecipeMetadataFilter {
  category?: string;
  dimensionId?: string;
  scope?: string;
  tags?: string[];
  language?: string;
  knowledgeType?: string;
  kind?: string;
  lifecycle?: string;
  moduleName?: string;
}

export interface RecipeDetailPayload {
  ref: string;
  contentCharLimit?: number;
  includeSourceRefs?: boolean;
  includeRelations?: boolean;
}

export interface RecipeListPayload {
  filter?: RecipeMetadataFilter;
  page?: number;
  pageSize?: number;
}

export interface RecipeSearchPayload {
  query: string;
  filter?: RecipeMetadataFilter;
  limit?: number;
  mode?: 'auto' | 'keyword' | 'hybrid';
}

export interface RecipePrimePayload {
  query: string;
  regionClasses?: string[];
  filter?: RecipeMetadataFilter;
  limit?: number;
}

export interface RecipeSourceRefLineRange {
  start?: number;
  end?: number;
}

export interface RecipeSourceRefPayload {
  recipeIds?: string[];
  sourcePath?: string;
  pathPrefix?: string;
  file?: string;
  module?: string;
  status?: string;
  lineRange?: RecipeSourceRefLineRange;
}

export interface RecipeRelationPayload {
  ref: string;
  maxHops?: number;
  fanout?: number;
  relationTypes?: string[];
}

export function isRecipeContextRequestKind(value: unknown): value is RecipeContextRequestKind {
  return (
    typeof value === 'string' &&
    (RECIPE_CONTEXT_REQUEST_KIND_VALUES as readonly string[]).includes(value)
  );
}

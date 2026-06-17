import type {
  RecipeContextQueryError,
  RecipeContextRef,
  RecipeContextRequestKind,
  RecipeContextResult,
} from '../../../domain/recipe-context/index.js';

// Operations the RecipeContext interface layer is allowed to perform while
// shaping a request into an envelope. Kept parallel to the ProjectContext list
// so the layer-contract intent is auditable.
export const RECIPE_CONTEXT_INTERFACE_ALLOWED_OPERATIONS = [
  'request-kind-validation',
  'payload-canonicalization',
  'dispatch',
  'envelope-construction',
  'ref-selection',
  'diagnostic-shaping',
] as const;

export type RecipeContextInterfaceOperation =
  (typeof RECIPE_CONTEXT_INTERFACE_ALLOWED_OPERATIONS)[number];

/** Canonicalized request handed to a handler: kind validated, payload an object. */
export interface CanonicalRecipeContextRequest {
  kind: RecipeContextRequestKind;
  payload: Record<string, unknown>;
}

export interface RecipeContextHandlerResult {
  data: RecipeContextResult;
  refs?: RecipeContextRef[];
  errors?: RecipeContextQueryError[];
}

export type RecipeContextHandler = (
  request: CanonicalRecipeContextRequest
) => Promise<RecipeContextHandlerResult> | RecipeContextHandlerResult;

export type RecipeContextHandlerRegistry = Partial<
  Record<RecipeContextRequestKind, RecipeContextHandler>
>;

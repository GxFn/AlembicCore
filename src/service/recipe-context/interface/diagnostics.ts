// Deterministic RecipeContext diagnostics. Every read path that can fail to
// resolve produces one of these instead of throwing, so the four tools get a
// stable, machine-readable outcome (GMAP-2 completion definition).

import type {
  RecipeContextQueryError,
  RecipeContextRef,
} from '../../../domain/recipe-context/index.js';

export function notFoundDiagnostic(
  recipeId: string,
  ref?: RecipeContextRef
): RecipeContextQueryError {
  return {
    code: 'not-found',
    message: `Recipe ${recipeId} was not found.`,
    recipeId,
    ref,
    retryable: false,
    severity: 'error',
  };
}

export function ambiguousDiagnostic(
  reference: string,
  matchedIds: string[]
): RecipeContextQueryError {
  return {
    code: 'ambiguous',
    message: `Reference "${reference}" matched ${matchedIds.length} recipes: ${matchedIds.join(', ')}.`,
    retryable: false,
    severity: 'error',
  };
}

export function staleRefDiagnostic(
  recipeId: string,
  path: string,
  ref?: RecipeContextRef
): RecipeContextQueryError {
  return {
    code: 'stale-ref',
    message: `Recipe ${recipeId} source ref ${path} is stale (the file no longer exists at that path).`,
    path,
    recipeId,
    ref,
    retryable: false,
    severity: 'warning',
  };
}

export function renamedRefDiagnostic(
  recipeId: string,
  path: string,
  newPath: string | null | undefined,
  ref?: RecipeContextRef
): RecipeContextQueryError {
  return {
    code: 'renamed',
    message: `Recipe ${recipeId} source ref ${path} was renamed${newPath ? ` to ${newPath}` : ''}.`,
    path,
    recipeId,
    ref,
    retryable: false,
    severity: 'warning',
  };
}

export function unresolvedDiagnostic(message: string, path?: string): RecipeContextQueryError {
  return {
    code: 'unresolved',
    message,
    path,
    retryable: false,
    severity: 'warning',
  };
}

export function vectorUnavailableDiagnostic(reason: string): RecipeContextQueryError {
  return {
    code: 'vector-unavailable',
    message: `Semantic vector lane unavailable; degraded result. ${reason}`,
    retryable: true,
    severity: 'warning',
  };
}

export function queryUnavailableDiagnostic(message: string): RecipeContextQueryError {
  return {
    code: 'query-unavailable',
    message,
    retryable: false,
    severity: 'warning',
  };
}

export function invalidPayloadDiagnostic(message: string): RecipeContextQueryError {
  return {
    code: 'invalid-payload',
    message,
    retryable: false,
    severity: 'error',
  };
}

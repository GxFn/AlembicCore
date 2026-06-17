import type { RecipeContextRequestKind } from '../../../domain/recipe-context/index.js';
import type {
  CanonicalRecipeContextRequest,
  RecipeContextHandlerRegistry,
  RecipeContextHandlerResult,
} from './contracts.js';
import { queryUnavailableDiagnostic } from './diagnostics.js';
import { createUnavailableRecipeContextData } from './response.js';

export async function dispatchRecipeContextRequest(
  request: CanonicalRecipeContextRequest,
  handlers: RecipeContextHandlerRegistry
): Promise<RecipeContextHandlerResult> {
  const handler = handlers[request.kind];
  if (!handler) {
    return createUnavailableResult(request.kind);
  }

  return handler(request);
}

export function createUnavailableResult(
  kind: RecipeContextRequestKind
): RecipeContextHandlerResult {
  const message = `RecipeContext ${kind} query has no registered handler in this service instance.`;
  return {
    data: createUnavailableRecipeContextData(kind, message),
    errors: [queryUnavailableDiagnostic(message)],
    refs: [],
  };
}

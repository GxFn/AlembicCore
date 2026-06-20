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

import {
  createRecipeContextServiceFromCore,
  type RecipeContextCoreParts,
} from './service/recipe-context/adapters/fromCore.js';
export { createRecipeContextServiceFromCore };

export interface RecipeContextCoreServices extends RecipeContextCoreParts {}

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

export function createRecipeContextCapabilitiesFromCore(
  parts: RecipeContextCoreServices
): RecipeContextCapabilities {
  return createRecipeContextCapabilities(createRecipeContextServiceFromCore(parts));
}

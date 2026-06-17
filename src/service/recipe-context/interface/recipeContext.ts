// RecipeContext request pipeline: canonicalize -> dispatch -> envelope. A
// RecipeContextRequestError (bad kind / payload) is turned into an unavailable
// envelope carrying the diagnostic, mirroring createProjectContext.

import type {
  RecipeContext as RecipeContextContract,
  RecipeContextRequest,
  RecipeContextResult,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandlerRegistry } from './contracts.js';
import { dispatchRecipeContextRequest } from './dispatch.js';
import { canonicalizeRecipeContextRequest, RecipeContextRequestError } from './request.js';
import { createRecipeContextEnvelope, createUnavailableRecipeContextData } from './response.js';

export function createRecipeContext(
  handlers: RecipeContextHandlerRegistry = {}
): RecipeContextContract {
  return {
    async execute(input: RecipeContextRequest) {
      try {
        const request = canonicalizeRecipeContextRequest(input);
        const result = await dispatchRecipeContextRequest(request, handlers);
        return createRecipeContextEnvelope({
          data: result.data,
          errors: result.errors,
          queryKind: request.kind,
          refs: result.refs,
        });
      } catch (error) {
        if (error instanceof RecipeContextRequestError) {
          return createRecipeContextEnvelope({
            data: createUnavailableRecipeContextData(error.queryKind, error.message),
            errors: [error.queryError],
            queryKind: error.queryKind,
            refs: [],
          });
        }
        throw error;
      }
    },
  };
}

export type RecipeContextExecuteResult = Awaited<
  ReturnType<ReturnType<typeof createRecipeContext>['execute']>
> & {
  data: RecipeContextResult;
};

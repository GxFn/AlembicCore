// prime handler: semantic-region "blocks" for task localization. Reads recipe
// semantic-region vectors through the injected vector port. When the embed lane
// is absent (no EmbedProvider) it degrades gracefully: empty blocks + a
// vector-unavailable warning, never a throw.

import type {
  RecipeContextQueryError,
  RecipeContextRef,
  RecipePrimeContext,
  RecipeSemanticRegionBlock,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import { invalidPayloadDiagnostic, vectorUnavailableDiagnostic } from '../interface/diagnostics.js';
import { semanticRegionRef } from '../interface/refs.js';
import type { RecipeContextDeps } from '../ports.js';
import { readFilter, readNumber, readString, readStringArray } from './payload.js';
import { failureResult } from './shared.js';

export function makePrimeHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const query = readString(request.payload, 'query');
    if (!query) {
      return failureResult('prime', invalidPayloadDiagnostic('prime requires payload.query.'));
    }

    const filter = readFilter(request.payload);
    const limit = readNumber(request.payload, 'limit');
    const regionClasses = readStringArray(request.payload, 'regionClasses');

    if (!deps.vector) {
      const data: RecipePrimeContext = {
        blocks: [],
        fallbackReason: 'embed-provider-unavailable',
        nextRefs: [],
        query,
        vectorUsed: false,
      };
      return {
        data,
        errors: [vectorUnavailableDiagnostic('No vector port is wired (embed provider absent).')],
        refs: [],
      };
    }

    const result = await deps.vector.searchRegions(query, { filter, limit, regionClasses });

    const refs: RecipeContextRef[] = [];
    const blocks: RecipeSemanticRegionBlock[] = result.hits.map((hit) => {
      const ref = semanticRegionRef(hit.recipeId, hit.regionClass, hit.id);
      refs.push(ref);
      return {
        content: hit.content,
        recipeId: hit.recipeId,
        ref,
        regionClass: hit.regionClass,
        score: hit.score,
      };
    });

    const errors: RecipeContextQueryError[] = [];
    if (!result.vectorUsed) {
      errors.push(
        vectorUnavailableDiagnostic(
          result.fallbackReason ?? 'Embed provider unavailable or no vector-backed matches.'
        )
      );
    }

    const data: RecipePrimeContext = {
      blocks,
      fallbackReason: result.fallbackReason,
      nextRefs: [],
      query,
      vectorUsed: result.vectorUsed,
    };

    return { data, errors, refs };
  };
}

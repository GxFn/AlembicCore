// search handler: metadata-filtered keyword + vector/semantic search. Sinks the
// Plugin RecipeCandidateProvider + VectorRerankProvider + SearchProvider read
// logic onto Core SearchEngine. Vector lane degradation is surfaced as a
// vector-unavailable warning while keyword hits still return.

import type {
  RecipeContextQueryError,
  RecipeContextRef,
  RecipeSearchContext,
  RecipeSearchHitView,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import {
  invalidPayloadDiagnostic,
  queryUnavailableDiagnostic,
  vectorUnavailableDiagnostic,
} from '../interface/diagnostics.js';
import { recipeRef } from '../interface/refs.js';
import type { RecipeContextDeps } from '../ports.js';
import { readFilter, readNumber, readString } from './payload.js';
import { failureResult } from './shared.js';

export function makeSearchHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const query = readString(request.payload, 'query');
    if (!query) {
      return failureResult('search', invalidPayloadDiagnostic('search requires payload.query.'));
    }
    if (!deps.retrieval && !deps.search) {
      return failureResult(
        'search',
        queryUnavailableDiagnostic('No search engine is wired for this RecipeContext.')
      );
    }

    const filter = readFilter(request.payload);
    const limit = readNumber(request.payload, 'limit');
    const mode = readString(request.payload, 'mode');

    const canonical = deps.retrieval
      ? await deps.retrieval.retrieve({ filter, mode, query, topK: limit })
      : null;
    const result = canonical
      ? {
          fallbackReason: canonical.diagnostics.fallbackReason,
          hits: canonical.candidates.map((candidate) => ({
            denseRank: candidate.denseRank,
            denseSimilarity: candidate.denseSimilarity,
            matchedFilters: undefined,
            recipeId: candidate.recipeId,
            rrfContribution: candidate.rrfContribution,
            score: candidate.score,
            semanticUsed: candidate.semanticUsed,
            sparseRank: candidate.sparseRank,
            sparseScore: candidate.sparseScore,
            title: typeof candidate.recipe.title === 'string' ? candidate.recipe.title : undefined,
            vectorScore: candidate.denseSimilarity,
            vectorUsed: candidate.vectorUsed,
          })),
          semanticUsed: canonical.candidates.some((candidate) => candidate.semanticUsed),
          total: canonical.candidates.length,
          vectorUsed: canonical.candidates.some((candidate) => candidate.vectorUsed),
        }
      : await deps.search!.search(query, { filter, limit, mode });

    const refs: RecipeContextRef[] = [];
    const hits: RecipeSearchHitView[] = result.hits.map((hit) => {
      const ref = recipeRef(hit.recipeId, { label: hit.title });
      refs.push(ref);
      return {
        denseRank: hit.denseRank,
        denseSimilarity: hit.denseSimilarity,
        matchedFilters: hit.matchedFilters,
        recipeId: hit.recipeId,
        ref,
        score: hit.score,
        semanticUsed: hit.semanticUsed,
        sparseRank: hit.sparseRank,
        sparseScore: hit.sparseScore,
        rrfContribution: hit.rrfContribution,
        title: hit.title,
        vectorScore: hit.vectorScore,
        vectorUsed: hit.vectorUsed,
      };
    });

    const errors: RecipeContextQueryError[] = [];
    if (!result.vectorUsed && result.fallbackReason) {
      errors.push(vectorUnavailableDiagnostic(result.fallbackReason));
    }

    const data: RecipeSearchContext = {
      fallbackReason: result.fallbackReason,
      hits,
      candidateRecipeIds: result.hits.map((hit) => hit.recipeId),
      nextRefs: [],
      query,
      semanticUsed: result.semanticUsed,
      vectorUsed: result.vectorUsed,
    };

    return { data, errors, refs };
  };
}

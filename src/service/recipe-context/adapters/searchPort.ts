// Binds Core SearchEngine.search to RecipeSearchPort. SearchEngine already
// combines keyword scoring, the injected vector lane, and multi-signal ranking,
// and degrades to keyword-only when the vector lane is unavailable — this adapter
// just maps the request filter onto SearchOptions and the response items onto
// the port hit shape, aggregating the vector-usage flags.

import type { RecipeMetadataFilter } from '../../../domain/recipe-context/index.js';
import type { RecipeSearchPort, RecipeSearchPortHit, RecipeSearchPortResult } from '../ports.js';

interface SearchEngineItem {
  id: string;
  title?: string;
  score?: number;
  vectorScore?: number;
  vectorUsed?: boolean;
  semanticUsed?: boolean;
  fallbackReason?: string;
  matchedFilters?: Record<string, string[]>;
  [key: string]: unknown;
}

interface SearchEngineResponse {
  items: SearchEngineItem[];
  total?: number;
  searchMeta?: {
    vectorUsed?: boolean;
    semanticUsed?: boolean;
    fallbackReason?: string;
    [key: string]: unknown;
  };
}

/** The SearchEngine read method this adapter consumes. */
export interface SearchEngineFacade {
  search(query: string, options: Record<string, unknown>): Promise<SearchEngineResponse>;
}

export function searchPortFromEngine(engine: SearchEngineFacade): RecipeSearchPort {
  return {
    async search(
      query: string,
      opts: { filter?: RecipeMetadataFilter; limit?: number; mode?: string }
    ): Promise<RecipeSearchPortResult> {
      const response = await engine.search(query, toSearchOptions(opts));
      const items = response.items ?? [];
      const hits: RecipeSearchPortHit[] = items.map((item) => ({
        matchedFilters: item.matchedFilters,
        recipeId: item.id,
        score: typeof item.score === 'number' ? item.score : 0,
        semanticUsed: item.semanticUsed === true,
        title: item.title,
        vectorScore: item.vectorScore,
        vectorUsed: item.vectorUsed === true,
      }));

      const vectorUsed = response.searchMeta?.vectorUsed ?? hits.some((hit) => hit.vectorUsed);
      const semanticUsed =
        response.searchMeta?.semanticUsed ?? hits.some((hit) => hit.semanticUsed);
      const fallbackReason =
        response.searchMeta?.fallbackReason ??
        items.find((item) => item.fallbackReason)?.fallbackReason;

      return {
        fallbackReason,
        hits,
        semanticUsed,
        total: response.total ?? hits.length,
        vectorUsed,
      };
    },
  };
}

function toSearchOptions(opts: {
  filter?: RecipeMetadataFilter;
  limit?: number;
  mode?: string;
}): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (opts.limit !== undefined) {
    options.limit = opts.limit;
  }
  if (opts.mode) {
    options.mode = opts.mode;
  }
  const filter = opts.filter;
  if (filter) {
    if (filter.category) {
      options.category = filter.category;
    }
    if (filter.dimensionId) {
      options.dimensionId = filter.dimensionId;
    }
    if (filter.kind) {
      options.kind = filter.kind;
    }
    if (filter.knowledgeType) {
      options.knowledgeType = filter.knowledgeType;
    }
    if (filter.language) {
      options.language = filter.language;
    }
    if (filter.scope) {
      options.scope = filter.scope;
    }
    if (filter.tags && filter.tags.length > 0) {
      options.tags = filter.tags;
    }
  }
  return options;
}

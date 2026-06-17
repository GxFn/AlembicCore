// Binds VectorService.hybridSearch over recipe semantic-region vectors to
// RecipeVectorPort. The region filter pins type=recipe-semantic-region so prime
// only sees region chunks. VectorService.hybridSearch returns [] when no
// EmbedProvider is injected, which this adapter reports as vectorUsed=false so
// the prime handler degrades gracefully (GMAP-L injects the Ollama EmbedProvider
// into the same VectorService, driving this lane transparently).

import type { RecipeMetadataFilter } from '../../../domain/recipe-context/index.js';
import { RECIPE_SEMANTIC_REGION_METADATA_TYPE } from '../../vector/RecipeRegionVectorIndex.js';
import type { RecipeRegionPortHit, RecipeRegionPortResult, RecipeVectorPort } from '../ports.js';

interface VectorHit {
  id: string;
  score: number;
  vectorUsed?: boolean;
  semanticUsed?: boolean;
  fallbackReason?: string;
  recipeId?: string;
  regionClass?: string;
  content?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  item?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The VectorService method this adapter consumes. */
export interface VectorServiceFacade {
  hybridSearch(
    query: string,
    opts: { topK?: number; filter?: Record<string, unknown> | null }
  ): Promise<VectorHit[]>;
}

export function vectorPortFromService(vectorService: VectorServiceFacade): RecipeVectorPort {
  return {
    async searchRegions(
      query: string,
      opts: { regionClasses?: string[]; limit?: number; filter?: RecipeMetadataFilter }
    ): Promise<RecipeRegionPortResult> {
      const filter = buildRegionFilter(opts.regionClasses, opts.filter);
      const hits = await vectorService.hybridSearch(query, {
        filter,
        topK: opts.limit ?? 10,
      });

      const mapped: RecipeRegionPortHit[] = hits.map((hit) => ({
        content: readHitString(hit, 'content') ?? readHitString(hit, 'text'),
        id: hit.id,
        recipeId: readHitString(hit, 'recipeId') ?? '',
        regionClass: readHitString(hit, 'regionClass') ?? '',
        score: typeof hit.score === 'number' ? hit.score : 0,
      }));

      const vectorUsed = hits.some((hit) => hit.vectorUsed === true);
      const fallbackReason = hits.find((hit) => hit.fallbackReason)?.fallbackReason;

      return { fallbackReason, hits: mapped, vectorUsed };
    },
  };
}

function buildRegionFilter(
  regionClasses: string[] | undefined,
  filter: RecipeMetadataFilter | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { type: RECIPE_SEMANTIC_REGION_METADATA_TYPE };
  // VectorMetadataFilter matches a scalar key against equality OR array
  // inclusion, so a multi-class request can pass the array straight through.
  if (regionClasses && regionClasses.length > 0) {
    out.regionClass = regionClasses.length === 1 ? regionClasses[0] : regionClasses;
  }
  if (filter) {
    if (filter.category) {
      out.category = filter.category;
    }
    if (filter.dimensionId) {
      out.dimensionId = filter.dimensionId;
    }
    if (filter.language) {
      out.language = filter.language;
    }
    if (filter.knowledgeType) {
      out.knowledgeType = filter.knowledgeType;
    }
    if (filter.kind) {
      out.kind = filter.kind;
    }
    if (filter.moduleName) {
      out.module = filter.moduleName;
    }
    if (filter.tags && filter.tags.length > 0) {
      out.tags = filter.tags;
    }
  }
  return out;
}

function readHitString(hit: VectorHit, key: string): string | undefined {
  const direct = hit[key];
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const fromMetadata = hit.metadata?.[key];
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) {
    return fromMetadata;
  }
  const fromItem = hit.item?.[key];
  if (typeof fromItem === 'string' && fromItem.length > 0) {
    return fromItem;
  }
  return undefined;
}

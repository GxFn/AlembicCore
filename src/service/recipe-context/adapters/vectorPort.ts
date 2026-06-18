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
  // VectorService.hybridSearch nests the region payload differently per path:
  //   - no hybridRetriever   -> hit.item.{content | metadata.recipeId/regionClass}
  //   - HybridRetriever.fuse -> hit.data.item.{content | metadata.recipeId/regionClass}
  //     (fuse stores the SearchVector result under .data; the Plugin always
  //      injects hybridRetriever, so this is the live region-query shape).
  // Earlier probing stopped at hit / hit.metadata / hit.item, so identity sank
  // under the item/metadata nesting and came back empty. Probe each known
  // container in order; the first non-empty string wins (data structure and
  // probe order otherwise unchanged).
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const item = asRecord(hit.item);
  const dataItem = asRecord(asRecord(hit.data)?.item);
  const containers: Array<Record<string, unknown> | undefined> = [
    hit,
    asRecord(hit.metadata),
    item,
    asRecord(item?.metadata),
    dataItem,
    asRecord(dataItem?.metadata),
  ];
  for (const container of containers) {
    const value = container?.[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

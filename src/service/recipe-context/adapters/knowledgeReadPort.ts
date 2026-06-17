// Binds the public @alembic/core/knowledge read path (KnowledgeService.get /
// list) to RecipeReadPort. D3 decision: RecipeContext composes the public read
// facade through this read-only port; it does NOT reach the internal repository
// and does NOT expose any lifecycle/create method. KnowledgeService is referenced
// only structurally (no concrete import), so the binding stays decoupled.

import type {
  RecipeMetadataFilter,
  RecipeRecord,
  RecipeRelationEdge,
} from '../../../domain/recipe-context/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { recipeRef } from '../interface/refs.js';
import type { RecipeReadPage, RecipeReadPort } from '../ports.js';

/** Minimal structural view of a KnowledgeEntry (what toJSON returns). */
export interface KnowledgeEntryLike {
  toJSON(): Record<string, unknown>;
}

/** The KnowledgeService read methods this adapter consumes — read-only. */
export interface KnowledgeReadFacade {
  get(id: string): Promise<KnowledgeEntryLike>;
  list(
    filters: Record<string, unknown>,
    pagination: { page?: number; pageSize?: number }
  ): Promise<{
    data: KnowledgeEntryLike[];
    pagination?: { page?: number; pageSize?: number; total?: number };
  }>;
}

export function knowledgeReadPortFromService(service: KnowledgeReadFacade): RecipeReadPort {
  return {
    async getRecipe(id: string): Promise<RecipeRecord | null> {
      try {
        const entry = await service.get(id);
        return recipeRecordFromWire(entry.toJSON());
      } catch (error) {
        if (error instanceof NotFoundError) {
          return null;
        }
        throw error;
      }
    },

    async listRecipes(
      filter: RecipeMetadataFilter,
      pagination: { page?: number; pageSize?: number }
    ): Promise<RecipeReadPage> {
      const result = await service.list(toListFilters(filter), pagination);
      const items = result.data.map((entry) => recipeRecordFromWire(entry.toJSON()));
      return {
        items,
        page: result.pagination?.page ?? pagination.page ?? 1,
        pageSize: result.pagination?.pageSize ?? pagination.pageSize ?? items.length,
        total: result.pagination?.total ?? items.length,
      };
    },
  };
}

function toListFilters(filter: RecipeMetadataFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filter.category) {
    out.category = filter.category;
  }
  if (filter.dimensionId) {
    out.dimensionId = filter.dimensionId;
  }
  if (filter.scope) {
    out.scope = filter.scope;
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
  if (filter.lifecycle) {
    out.lifecycle = filter.lifecycle;
  }
  if (filter.tags && filter.tags.length > 0) {
    out.tag = filter.tags[0];
  }
  return out;
}

/** Project a KnowledgeEntry wire object into the read-only RecipeRecord view. */
export function recipeRecordFromWire(wire: Record<string, unknown>): RecipeRecord {
  const id = asString(wire.id) ?? '';
  return {
    category: asString(wire.category),
    content: flattenContent(wire.content),
    description: asString(wire.description),
    dimensionId: asString(wire.dimensionId),
    kind: asString(wire.kind),
    knowledgeType: asString(wire.knowledgeType),
    language: asString(wire.language),
    lifecycle: asString(wire.lifecycle) ?? 'unknown',
    moduleName: asString(wire.moduleName),
    qualityGrade: asString(asRecord(wire.quality)?.grade),
    ref: recipeRef(id, { label: asString(wire.title) }),
    relations: flattenRelations(wire.relations),
    scope: asString(wire.scope),
    sourceFile: asString(wire.sourceFile) ?? null,
    sources: flattenSources(wire.reasoning),
    summary: asString(wire.topicHint) ?? asString(wire.description),
    tags: asStringArray(wire.tags),
    title: asString(wire.title) ?? '',
    topicHint: asString(wire.topicHint),
    trigger: asString(wire.trigger),
    updatedAt: typeof wire.updatedAt === 'number' ? wire.updatedAt : undefined,
    id,
  };
}

function flattenContent(content: unknown): string | undefined {
  const record = asRecord(content);
  if (!record) {
    return undefined;
  }
  return asString(record.pattern) ?? asString(record.markdown) ?? undefined;
}

function flattenRelations(relations: unknown): RecipeRelationEdge[] {
  const record = asRecord(relations);
  if (!record) {
    return [];
  }
  const edges: RecipeRelationEdge[] = [];
  for (const [type, bucket] of Object.entries(record)) {
    if (!Array.isArray(bucket)) {
      continue;
    }
    for (const entry of bucket) {
      const edge = asRecord(entry);
      const target = asString(edge?.target);
      if (target) {
        edges.push({ description: asString(edge?.description), target, type });
      }
    }
  }
  return edges;
}

function flattenSources(reasoning: unknown): string[] {
  const record = asRecord(reasoning);
  return asStringArray(record?.sources);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

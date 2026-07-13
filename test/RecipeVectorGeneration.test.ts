import { describe, expect, it } from 'vitest';
import type { RecipeRetrievalProfile } from '../src/domain/knowledge/RecipeRetrievalProfile.js';
import { VectorStore } from '../src/infrastructure/vector/VectorStore.js';
import { computeRecipeSourceContentHash } from '../src/service/knowledge/RecipeRetrieval.js';
import type { EmbeddingPort } from '../src/service/vector/EmbeddingPort.js';
import type { RecipeRegionSourceEntry } from '../src/service/vector/RecipeRegionVectorIndex.js';
import {
  inspectRecipeVectorGeneration,
  RecipeVectorGenerationManager,
  type RecipeVectorGenerationManifest,
  type RecipeVectorGenerationRoute,
  type RecipeVectorGenerationRouter,
  type RecipeVectorGenerationStoreFactory,
  removeRecipeVectorsByTruth,
} from '../src/service/vector/RecipeVectorGeneration.js';

class MemoryVectorStore extends VectorStore {
  readonly items = new Map<string, Record<string, unknown>>();

  override async upsert(item: {
    id: string;
    content: string;
    vector: number[];
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.items.set(item.id, structuredClone(item));
  }

  override async batchUpsert(items: Parameters<VectorStore['batchUpsert']>[0]): Promise<void> {
    for (const item of items) {
      await this.upsert(item);
    }
  }

  override async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  override async getById(id: string): Promise<Record<string, unknown> | null> {
    return this.items.get(id) ?? null;
  }

  override async listIds(): Promise<string[]> {
    return [...this.items.keys()];
  }
}

class MemoryGenerationRuntime
  implements RecipeVectorGenerationStoreFactory, RecipeVectorGenerationRouter
{
  readonly stores = new Map<string, MemoryVectorStore>();
  readonly manifests = new Map<string, RecipeVectorGenerationManifest>();
  active: RecipeVectorGenerationRoute | null = null;

  async createShadow(generationId: string): Promise<MemoryVectorStore> {
    const store = new MemoryVectorStore();
    this.stores.set(generationId, store);
    return store;
  }

  async open(generationId: string): Promise<MemoryVectorStore> {
    const store = this.stores.get(generationId);
    if (!store) {
      throw new Error('generation-not-found');
    }
    return store;
  }

  async writeManifest(
    generationId: string,
    manifest: RecipeVectorGenerationManifest
  ): Promise<void> {
    this.manifests.set(generationId, manifest);
  }

  async removeGeneration(generationId: string): Promise<void> {
    this.stores.delete(generationId);
    this.manifests.delete(generationId);
  }

  async readActive(): Promise<RecipeVectorGenerationRoute | null> {
    return this.active;
  }

  async activate(
    next: RecipeVectorGenerationRoute,
    expectedPreviousGenerationId: string | null
  ): Promise<boolean> {
    if ((this.active?.generationId ?? null) !== expectedPreviousGenerationId) {
      return false;
    }
    this.active = next;
    return true;
  }
}

function entry(): RecipeRegionSourceEntry {
  const source: RecipeRegionSourceEntry = {
    id: 'recipe-generation-1',
    title: 'Build derived retrieval state in a shadow generation',
    description: 'Keep the old vector generation queryable until replacement verification passes.',
    trigger: 'when rebuilding Recipe retrieval vectors',
    lifecycle: 'active',
    language: 'typescript',
    category: 'architecture',
    kind: 'pattern',
    knowledgeType: 'code-pattern',
    whenClause: 'When the vector schema, provider, model, dimension, format, or corpus changes.',
    doClause: 'Build and verify a shadow store before one atomic active-pointer switch.',
    dontClause: 'Do not clear or mutate the active generation in place.',
    content: {
      pattern: 'const shadow = await factory.createShadow(generationId);',
      rationale: 'A failed rebuild must leave the previous generation queryable.',
    },
    reasoning: {
      whyStandard: 'Atomic visibility prevents partial mixed-generation reads.',
      sources: ['src/service/vector/RecipeVectorGeneration.ts:70-155'],
    },
  };
  const profile: RecipeRetrievalProfile = {
    schemaVersion: '1',
    primaryLanguage: 'en',
    summary: {
      primary: 'Build and verify a shadow vector generation before activation.',
      technicalEnglish:
        'Use compare-and-swap activation so failed builds preserve the active index.',
    },
    concepts: [
      {
        term: 'shadow generation',
        language: 'en',
        provenanceRefs: ['field:description'],
      },
    ],
    scenarios: [],
    exclusions: [],
    provenance: {
      evidenceRefs: ['src/service/vector/RecipeVectorGeneration.ts:70-155'],
      sourceFieldRefs: ['field:description'],
      sourceContentHash: computeRecipeSourceContentHash(source),
      generator: 'test',
    },
  };
  return { ...source, retrievalProfile: profile };
}

function provider(fail = false): EmbeddingPort {
  return {
    describeCapabilities: () => ({
      provider: 'test-provider',
      model: 'test-model',
      dimension: 3,
      inputKinds: ['query', 'document'],
      batchSupported: true,
      normalization: 'normalized',
      formatProfile: 'asymmetric',
    }),
    embedQuery: async () => [1, 0, 0],
    embedDocuments: async (texts) => {
      if (fail) {
        throw new Error('provider-build-failed');
      }
      return texts.map(() => [1, 0, 0]);
    },
  };
}

describe('Recipe vector generation lifecycle', () => {
  it('activates only a fully verified shadow generation and can atomically roll back', async () => {
    const runtime = new MemoryGenerationRuntime();
    const oldStore = await runtime.createShadow('old-generation');
    await oldStore.upsert({ id: 'old-sentinel', content: 'old', vector: [1, 0, 0], metadata: {} });
    runtime.active = { generationId: 'old-generation', manifestHash: 'old-manifest' };
    const manager = new RecipeVectorGenerationManager(runtime, runtime);

    const result = await manager.buildAndActivate([entry()], provider());

    expect(result.status).toBe('activated');
    expect(result.inspection?.healthy).toBe(true);
    expect(runtime.active?.generationId).toBe(result.generationId);
    expect(result.manifest).toMatchObject({
      provider: 'test-provider',
      model: 'test-model',
      dimension: 3,
      formatProfile: 'asymmetric',
      recipeCount: 1,
    });
    expect(
      await manager.rollback({ generationId: 'old-generation', manifestHash: 'old-manifest' })
    ).toBe(true);
    expect(runtime.active?.generationId).toBe('old-generation');
    expect(await oldStore.getById('old-sentinel')).not.toBeNull();
  });

  it('leaves the old generation queryable when shadow embedding fails', async () => {
    const runtime = new MemoryGenerationRuntime();
    const oldStore = await runtime.createShadow('old-generation');
    await oldStore.upsert({ id: 'old-sentinel', content: 'old', vector: [1, 0, 0], metadata: {} });
    runtime.active = { generationId: 'old-generation', manifestHash: 'old-manifest' };

    const result = await new RecipeVectorGenerationManager(runtime, runtime).buildAndActivate(
      [entry()],
      provider(true)
    );

    expect(result.status).toBe('failed');
    expect(result.active).toEqual({ generationId: 'old-generation', manifestHash: 'old-manifest' });
    expect(await oldStore.getById('old-sentinel')).not.toBeNull();
  });

  it('reports exact-set corruption and removes deleted Recipe vectors without a provider', async () => {
    const runtime = new MemoryGenerationRuntime();
    const manager = new RecipeVectorGenerationManager(runtime, runtime);
    const built = await manager.buildAndActivate([entry()], provider());
    const store = await runtime.open(built.generationId!);
    const [firstId] = await store.listIds();
    const first = (await store.getById(firstId))!;
    await store.upsert({
      ...(first as never),
      id: firstId,
      content: 'corrupted',
      vector: [1, 0],
      metadata: first.metadata as Record<string, unknown>,
    });
    await store.upsert({
      id: 'recipe_region_orphan_identity_deadbeef',
      content: 'stale',
      vector: [1, 0, 0],
      metadata: {},
    });

    const inspection = await inspectRecipeVectorGeneration(store, [entry()], 3);
    expect(inspection.healthy).toBe(false);
    expect(inspection.hashMismatchIds).toContain(firstId);
    expect(inspection.dimensionMismatchIds).toContain(firstId);
    expect(inspection.orphanIds).toContain('recipe_region_orphan_identity_deadbeef');

    const repaired = await manager.buildAndActivate([entry()], provider());
    expect(repaired.status).toBe('activated');
    expect(repaired.generationId).not.toBe(built.generationId);
    expect(repaired.inspection?.healthy).toBe(true);

    await store.upsert({
      id: 'entry_recipe-generation-1',
      content: 'legacy competitor',
      vector: [1, 0, 0],
      metadata: {},
    });
    const removed = await removeRecipeVectorsByTruth(store, 'recipe-generation-1');
    expect(removed.errors).toEqual([]);
    expect((await store.listIds()).some((id) => id.includes('recipe-generation-1'))).toBe(false);
  });
});

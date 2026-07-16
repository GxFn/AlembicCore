import { describe, expect, it } from 'vitest';
import type { RecipeRetrievalProfile } from '../src/domain/knowledge/RecipeRetrievalProfile.js';
import { VectorStore } from '../src/infrastructure/vector/VectorStore.js';
import { computeRecipeSourceContentHash } from '../src/service/knowledge/RecipeRetrieval.js';
import type { EmbeddingPort } from '../src/service/vector/EmbeddingPort.js';
import {
  buildRecipeSemanticRegionChunks,
  parseRecipeIdFromRegionVectorId,
  type RecipeRegionSourceEntry,
} from '../src/service/vector/RecipeRegionVectorIndex.js';
import {
  buildStrictRecipeVectorGenerationV1,
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
  readonly unreadableIds = new Set<string>();

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
    if (this.unreadableIds.has(id)) {
      return null;
    }
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
  readonly manifestWrites: RecipeVectorGenerationManifest[] = [];
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
    this.manifestWrites.push(structuredClone(manifest));
  }

  async readManifest(generationId: string): Promise<RecipeVectorGenerationManifest | null> {
    return this.manifests.get(generationId) ?? null;
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

function provider(options: { fail?: boolean; model?: string } = {}): EmbeddingPort {
  return {
    describeCapabilities: () => ({
      provider: 'test-provider',
      model: options.model ?? 'test-model',
      dimension: 3,
      inputKinds: ['query', 'document'],
      batchSupported: true,
      normalization: 'normalized',
      formatProfile: 'asymmetric',
    }),
    embedQuery: async () => [1, 0, 0],
    embedDocuments: async (texts) => {
      if (options.fail) {
        throw new Error('provider-build-failed');
      }
      return texts.map(() => [1, 0, 0]);
    },
  };
}

describe('Recipe vector generation lifecycle', () => {
  it('strict assembly accepts only an explicit, ready, inspected generation', async () => {
    const runtime = new MemoryGenerationRuntime();
    const receipt = await buildStrictRecipeVectorGenerationV1(
      new RecipeVectorGenerationManager(runtime, runtime),
      [entry()],
      provider()
    );

    expect(receipt).toMatchObject({
      status: 'ready',
      inspectionHealthy: true,
      expectedRecipeIds: [entry().id],
    });
    expect(runtime.active).toEqual({
      generationId: receipt.generationId,
      manifestHash: receipt.manifestHash,
    });
  });
  it('makes projection schema, canonical role, and content identity explicit in vector IDs', () => {
    const schema1 = buildRecipeSemanticRegionChunks(entry(), { projectionSchemaVersion: '1' });
    const schema2 = buildRecipeSemanticRegionChunks(entry(), { projectionSchemaVersion: '2' });

    expect(schema1[0].id).toContain(
      `_ps1_${schema1[0].metadata.documentRole}_${schema1[0].metadata.contentHash.slice(0, 24)}`
    );
    expect(schema2[0].id).not.toBe(schema1[0].id);
    expect(parseRecipeIdFromRegionVectorId(schema1[0].id)).toBe(entry().id);
    expect(parseRecipeIdFromRegionVectorId('recipe_region_legacy_recipe_identity_deadbeef')).toBe(
      'legacy_recipe'
    );
    expect(
      parseRecipeIdFromRegionVectorId('recipe_region_legacy_ps_recipe_identity_deadbeef')
    ).toBe('legacy_ps_recipe');
  });

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
      manifestVersion: 1,
      generationId: result.generationId,
      status: 'ready',
      createdFrom: 'full-build',
      provider: 'test-provider',
      model: 'test-model',
      dimension: 3,
      formatProfile: 'asymmetric',
      recipeCount: 1,
    });
    expect(result.manifest?.corpusFingerprint).toBeTruthy();
    expect(result.manifest?.expectedIdsByRecipe[entry().id]).toHaveLength(
      result.manifest?.documentCount
    );
    expect(runtime.manifestWrites.map((manifest) => manifest.status)).toEqual([
      'building',
      'ready',
    ]);
    const alreadyActive = await manager.buildAndActivate([entry()], provider(), {
      createdFrom: 'incremental',
    });
    expect(alreadyActive).toMatchObject({
      status: 'already-active',
      generationId: result.generationId,
      manifest: { createdFrom: 'full-build', status: 'ready' },
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
      provider({ fail: true })
    );

    expect(result.status).toBe('failed');
    expect(result.manifest).toMatchObject({ status: 'failed', createdFrom: 'full-build' });
    expect(runtime.stores.has(result.generationId!)).toBe(false);
    expect(runtime.manifests.has(result.generationId!)).toBe(false);
    expect(result.active).toEqual({ generationId: 'old-generation', manifestHash: 'old-manifest' });
    expect(await oldStore.getById('old-sentinel')).not.toBeNull();
  });

  it('rebuilds for same-dimension model and projection-schema changes, then rolls back a real generation', async () => {
    const runtime = new MemoryGenerationRuntime();
    const manager = new RecipeVectorGenerationManager(runtime, runtime);
    const modelA = await manager.buildAndActivate([entry()], provider({ model: 'model-a' }));
    const modelB = await manager.buildAndActivate([entry()], provider({ model: 'model-b' }));
    const schema2 = await manager.buildAndActivate([entry()], provider({ model: 'model-b' }), {
      projectionSchemaVersion: '2',
      createdFrom: 'migration',
    });

    expect(modelB.generationId).not.toBe(modelA.generationId);
    expect(modelB.manifest?.manifestHash).not.toBe(modelA.manifest?.manifestHash);
    expect(schema2.generationId).not.toBe(modelB.generationId);
    expect(schema2.manifest).toMatchObject({
      projectionSchemaVersion: '2',
      createdFrom: 'migration',
    });
    expect(schema2.manifest?.manifestHash).not.toBe(modelB.manifest?.manifestHash);
    expect(await manager.rollback(modelA.active!)).toBe(true);
    expect(runtime.active).toEqual(modelA.active);
    expect((await runtime.open(modelA.generationId!)).items.size).toBeGreaterThan(0);
  });

  it('reports missing, partial, logical duplicate, hash, orphan, stale, and stale-generation state', async () => {
    const runtime = new MemoryGenerationRuntime();
    const manager = new RecipeVectorGenerationManager(runtime, runtime);
    const built = await manager.buildAndActivate([entry()], provider());
    const store = await runtime.open(built.generationId!);
    const ids = await store.listIds();
    expect(ids.length).toBeGreaterThanOrEqual(4);

    await store.remove(ids[0]);
    store.unreadableIds.add(ids[1]);
    const corrupted = store.items.get(ids[2])!;
    await store.upsert({
      ...(corrupted as never),
      id: ids[2],
      content: 'corrupted',
      vector: [1, 0],
      metadata: corrupted.metadata as Record<string, unknown>,
    });
    const duplicateSource = store.items.get(ids[3])!;
    await store.upsert({
      ...(duplicateSource as never),
      id: `${ids[3]}_duplicate`,
      metadata: duplicateSource.metadata as Record<string, unknown>,
    });
    await store.upsert({
      ...(duplicateSource as never),
      id: ids[3],
      metadata: {
        ...(duplicateSource.metadata as Record<string, unknown>),
        generationId: 'retired-generation',
      },
    });
    await store.upsert({
      id: 'recipe_region_recipe-generation-1_identity_deadbeef',
      content: 'stale projection',
      vector: [1, 0, 0],
      metadata: { recipeId: 'recipe-generation-1' },
    });
    await store.upsert({
      id: 'recipe_region_orphan_identity_deadbeef',
      content: 'stale',
      vector: [1, 0, 0],
      metadata: {},
    });

    const inspection = await inspectRecipeVectorGeneration(store, [entry()], {
      dimension: 3,
      generationId: built.generationId!,
      manifestHash: built.manifest!.manifestHash,
      provider: built.manifest!.provider,
      model: built.manifest!.model,
      projectionSchemaVersion: built.manifest!.projectionSchemaVersion,
    });
    expect(inspection.healthy).toBe(false);
    expect(inspection.missingIds).toContain(ids[0]);
    expect(inspection.partialIds).toContain(ids[1]);
    expect(inspection.hashMismatchIds).toContain(ids[2]);
    expect(inspection.dimensionMismatchIds).toContain(ids[2]);
    expect(inspection.duplicateIds).toContain(`${ids[3]}_duplicate`);
    expect(inspection.orphanIds).toContain('recipe_region_orphan_identity_deadbeef');
    expect(inspection.staleIds).toContain('recipe_region_recipe-generation-1_identity_deadbeef');
    expect(inspection.staleGenerationIds).toContain(ids[3]);

    const repaired = await manager.buildAndActivate([entry()], provider());
    expect(repaired.status).toBe('activated');
    expect(repaired.generationId).not.toBe(built.generationId);
    expect(repaired.inspection?.healthy).toBe(true);

    const repairedStore = await runtime.open(repaired.generationId!);
    await repairedStore.upsert({
      id: 'entry_recipe-generation-1',
      content: 'legacy competitor',
      vector: [1, 0, 0],
      metadata: {},
    });
    const removed = await removeRecipeVectorsByTruth(repairedStore, 'recipe-generation-1');
    expect(removed.errors).toEqual([]);
    expect((await repairedStore.listIds()).some((id) => id.includes('recipe-generation-1'))).toBe(
      false
    );
  });
});

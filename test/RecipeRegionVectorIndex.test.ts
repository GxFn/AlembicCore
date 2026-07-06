import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecipeSemanticRegionChunks,
  HnswVectorAdapter,
  JsonVectorAdapter,
  RECIPE_REGION_VECTOR_ID_PREFIX,
  RECIPE_REGION_VECTOR_SCHEMA_VERSION,
  RECIPE_SEMANTIC_REGION_METADATA_TYPE,
  type RecipeRegionSourceEntry,
  syncRecipeSemanticRegionVectors,
  VectorService,
} from '../src/vector.js';

function createRecipe(overrides: Partial<RecipeRegionSourceEntry> = {}): RecipeRegionSourceEntry {
  return {
    id: 'recipe-1',
    title: 'Repository boundary sync pattern',
    description: 'Use this when Core owns reusable deterministic persistence.',
    lifecycle: 'active',
    language: 'typescript',
    dimensionId: 'architecture',
    category: 'Utility',
    knowledgeType: 'code-pattern',
    kind: 'pattern',
    tags: ['architecture', 'testing-quality', 'boundary'],
    trigger: '@repo-boundary-sync',
    topicHint: 'Utility',
    whenClause: 'When a reusable Core service must generate persistent derived state.',
    doClause: 'Generate deterministic derived items during rebuild or knowledge sync.',
    dontClause: 'Do not generate or save derived vector chunks during ordinary query handling.',
    coreCode: 'service.syncRecipeSemanticRegions(activeRecipes)',
    content: {
      pattern: 'Use a dedicated sync method instead of query-time mutation.',
      markdown: '## Pattern\n\nGenerate stable region chunks from existing Recipe rows.',
      rationale: 'Derived region chunks preserve the Recipe source contract.',
      verification: {
        method: 'unit test',
        expected_result: 'region chunks are deterministic and filterable',
      },
    },
    reasoning: {
      whyStandard:
        'Generated index rows keep source Recipes immutable while making retrieval precise.',
      sources: ['AlembicCore/src/service/vector/VectorService.ts'],
    },
    sourceFile: 'AlembicCore/src/service/vector/VectorService.ts',
    moduleName: 'service/vector',
    contentHash: 'source-content-hash',
    updatedAt: 123,
    ...overrides,
  };
}

function createMockVectorStore() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    batchUpsert: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({ count: 0, dimension: 2, indexSize: 0 }),
    searchVector: vi.fn().mockResolvedValue([]),
    searchByFilter: vi.fn().mockResolvedValue([]),
    listIds: vi.fn().mockResolvedValue([]),
  };
}

function createService(
  vectorStore: ReturnType<typeof createMockVectorStore>,
  embedProvider: { embed: ReturnType<typeof vi.fn> } | null = {
    embed: vi.fn().mockImplementation((texts: string | string[]) => {
      if (Array.isArray(texts)) {
        return Promise.resolve(texts.map(() => [1, 0]));
      }
      return Promise.resolve([1, 0]);
    }),
  }
) {
  return new VectorService({
    vectorStore: vectorStore as never,
    indexingPipeline: { run: vi.fn(), setAiProvider: vi.fn() } as never,
    hybridRetriever: null,
    eventBus: null,
    embedProvider: embedProvider as never,
    contextualEnricher: null,
    autoSyncOnCrud: false,
    syncDebounceMs: 100,
  });
}

describe('Recipe semantic-region vector index', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts deterministic region chunks without mutating the Recipe row', () => {
    const recipe = createRecipe();
    const before = JSON.stringify(recipe);

    const chunks = buildRecipeSemanticRegionChunks(recipe, {
      sourceRefsBridge: {
        status: 'active',
        refs: ['AlembicCore/src/service/vector/VectorService.ts'],
      },
    });
    const repeated = buildRecipeSemanticRegionChunks(recipe, {
      sourceRefsBridge: {
        status: 'active',
        refs: ['AlembicCore/src/service/vector/VectorService.ts'],
      },
    });

    expect(JSON.stringify(recipe)).toBe(before);
    expect(chunks.map((chunk) => chunk.id)).toEqual(repeated.map((chunk) => chunk.id));
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
    expect(chunks.map((chunk) => chunk.metadata.regionClass)).toEqual(
      expect.arrayContaining([
        'identity',
        'applicability',
        'patternPurpose',
        'architectureConvention',
        'integrationBoundary',
        'qualityConcern',
        'negativeBoundary',
        'rationale',
        'evidence',
      ])
    );
    expect(
      chunks.every(
        (chunk) =>
          chunk.metadata.title === 'Repository boundary sync pattern' &&
          chunk.metadata.trigger === '@repo-boundary-sync' &&
          chunk.metadata.lifecycle === 'active' &&
          chunk.metadata.schemaVersion === RECIPE_REGION_VECTOR_SCHEMA_VERSION
      )
    ).toBe(true);

    const identity = chunks.find((chunk) => chunk.metadata.regionClass === 'identity');
    expect(identity?.id.startsWith(`${RECIPE_REGION_VECTOR_ID_PREFIX}recipe-1_identity_`)).toBe(
      true
    );
    expect(identity?.metadata).toMatchObject({
      type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
      recipeId: 'recipe-1',
      title: 'Repository boundary sync pattern',
      trigger: '@repo-boundary-sync',
      lifecycle: 'active',
      dimensionId: 'architecture',
      language: 'typescript',
      kind: 'pattern',
      knowledgeType: 'code-pattern',
      schemaVersion: RECIPE_REGION_VECTOR_SCHEMA_VERSION,
      sourceRefsBridge: 'active',
      bridgeRefCount: 1,
      generatedFrom: 'knowledge-entry-row',
      generationScope: 'rebuild-refresh-sync',
    });
    expect(identity?.metadata.weakCategory).toBe('Utility');
    expect(identity?.metadata.weakTopicHint).toBe('Utility');
    expect((identity?.metadata as Record<string, unknown>).category).toBeUndefined();
  });

  it('does not generate title-only chunks for empty non-identity regions', () => {
    const chunks = buildRecipeSemanticRegionChunks({
      id: 'recipe-minimal',
      title: 'Only title',
      trigger: '@only-title',
      lifecycle: 'active',
      language: 'typescript',
      dimensionId: 'architecture',
      kind: 'pattern',
      knowledgeType: 'code-pattern',
    });

    expect(chunks.map((chunk) => chunk.metadata.regionClass)).toEqual(['identity']);
    expect(chunks[0].content).toContain('Title: Only title');
    expect(chunks[0].content).toContain('Trigger: @only-title');
    expect(chunks.some((chunk) => chunk.content === 'Recipe title: Only title')).toBe(false);
    expect(chunks.some((chunk) => chunk.content.includes('Recipe trigger: @only-title'))).toBe(
      false
    );
  });

  it('keeps code-like coreCode out of generated vector content', () => {
    const codeLikeCoreCode = 'await service.syncRecipeSemanticRegions(activeRecipes)';
    const chunks = buildRecipeSemanticRegionChunks(
      createRecipe({
        coreCode: codeLikeCoreCode,
        content: {
          pattern: 'Use a rebuild-only derived index boundary.',
          rationale: 'Query handling must not fabricate Recipe region evidence.',
        },
      })
    );

    expect(chunks.every((chunk) => !chunk.content.includes(codeLikeCoreCode))).toBe(true);
    const architectureConvention = chunks.find(
      (chunk) => chunk.metadata.regionClass === 'architectureConvention'
    );
    expect(architectureConvention?.content).toContain('Use a rebuild-only derived index boundary');
    expect(architectureConvention?.content).not.toContain(codeLikeCoreCode);
  });

  it('changes sourceHash when consumed source fields change without parent contentHash', () => {
    const base = createRecipe({
      contentHash: null,
      updatedAt: null,
    });
    const changed = createRecipe({
      contentHash: null,
      updatedAt: null,
      doClause: 'Generate deterministic region chunks from a changed rebuild-only contract.',
    });

    const [baseChunk] = buildRecipeSemanticRegionChunks(base);
    const [changedChunk] = buildRecipeSemanticRegionChunks(changed);

    expect(base.contentHash).toBe(changed.contentHash);
    expect(base.updatedAt).toBe(changed.updatedAt);
    expect(baseChunk.metadata.sourceHash).not.toBe(changedChunk.metadata.sourceHash);
  });

  it('marks source refs bridge gaps as partial instead of trusted bridge-backed evidence', () => {
    const [evidence] = buildRecipeSemanticRegionChunks(createRecipe(), {
      sourceRefsBridge: { status: 'partial', refs: [] },
    }).filter((chunk) => chunk.metadata.regionClass === 'evidence');

    expect(evidence.metadata.sourceRefsBridge).toBe('partial');
    expect(evidence.metadata.bridgeRefCount).toBe(0);
    expect(evidence.metadata.sourceRefs).toEqual([
      'AlembicCore/src/service/vector/VectorService.ts',
    ]);
  });

  it('syncs region vectors explicitly and removes stale chunks for changed parent Recipes', async () => {
    const recipe = createRecipe();
    const vectorStore = createMockVectorStore();
    const freshId = buildRecipeSemanticRegionChunks(recipe)[0].id;
    vectorStore.listIds.mockResolvedValue([
      freshId,
      'entry_recipe-1',
      'recipe_region_recipe-1_identity_oldhash',
      'recipe_region_other-1_identity_oldhash',
    ]);
    const service = createService(vectorStore);

    const result = await service.syncRecipeSemanticRegions([recipe], {
      sourceRefsBridgeByRecipeId: {
        'recipe-1': {
          status: 'active',
          refs: ['AlembicCore/src/service/vector/VectorService.ts'],
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.scanned).toBe(1);
    expect(result.generated).toBeGreaterThan(0);
    // freshId 已在 listIds（内容未变）→ 已存在跳过（2026-07-06）：upsert 少 1、skippedExisting 计 1
    expect(result.skippedExisting).toBe(1);
    expect(result.upserted).toBe(result.generated - 1);
    expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_recipe-1_identity_oldhash');
    expect(vectorStore.remove).not.toHaveBeenCalledWith('entry_recipe-1');
    expect(vectorStore.remove).not.toHaveBeenCalledWith('recipe_region_other-1_identity_oldhash');
    expect(vectorStore.batchUpsert).toHaveBeenCalledOnce();
    const items = vectorStore.batchUpsert.mock.calls[0]?.[0] as Array<{
      id: string;
      metadata: Record<string, unknown>;
    }>;
    expect(items.every((item) => item.id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX))).toBe(true);
    expect(items[0].metadata.type).toBe(RECIPE_SEMANTIC_REGION_METADATA_TYPE);
  });

  it('removes deleted parent region chunks without touching other Recipes or entry vectors', async () => {
    const vectorStore = createMockVectorStore();
    vectorStore.listIds.mockResolvedValue([
      'entry_recipe-1',
      'entry_recipe-2',
      'recipe_region_recipe-1_identity_oldhash',
      'recipe_region_recipe-1_rationale_oldhash',
      'recipe_region_recipe-2_identity_oldhash',
    ]);
    const service = createService(vectorStore);

    await service.removeEntry('recipe-1');

    expect(vectorStore.remove).toHaveBeenCalledWith('entry_recipe-1');
    expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_recipe-1_identity_oldhash');
    expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_recipe-1_rationale_oldhash');
    expect(vectorStore.remove).not.toHaveBeenCalledWith('entry_recipe-2');
    expect(vectorStore.remove).not.toHaveBeenCalledWith('recipe_region_recipe-2_identity_oldhash');
  });

  it('removes deprecated parent region chunks without upserting new chunks', async () => {
    const vectorStore = createMockVectorStore();
    vectorStore.listIds.mockResolvedValue([
      'recipe_region_recipe-1_identity_oldhash',
      'recipe_region_recipe-2_identity_oldhash',
    ]);
    const service = createService(vectorStore);

    const result = await service.syncRecipeSemanticRegions([
      createRecipe({
        lifecycle: 'deprecated',
      }),
    ]);

    expect(result.status).toBe('completed');
    expect(result.generated).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.removed).toBe(1);
    expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_recipe-1_identity_oldhash');
    expect(vectorStore.remove).not.toHaveBeenCalledWith('recipe_region_recipe-2_identity_oldhash');
    expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
  });

  it('reports degraded generated metadata when embeddings are unavailable', async () => {
    const vectorStore = createMockVectorStore();
    const service = createService(vectorStore, null);

    const result = await service.syncRecipeSemanticRegions([createRecipe()]);

    expect(result.status).toBe('degraded');
    expect(result.degradedReason).toBe('embed-provider-unavailable');
    expect(result.generatedMetadata.length).toBeGreaterThan(0);
    expect(result.skipped).toBe(result.generated);
    expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
  });

  it('produces a bounded generation-test report before full fixture generation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apq3-generation-test-'));
    tmpDirs.push(dir);
    const store = new JsonVectorAdapter(dir, { indexPath: join(dir, 'vector_index.json') });
    await store.init();
    await store.batchUpsert([
      {
        id: 'entry_legacy-only',
        content: 'legacy whole-entry vector',
        vector: [0, 1],
        metadata: { entryId: 'legacy-only', kind: 'recipe' },
      },
      {
        id: 'recipe_region_recipe-1_identity_oldhash',
        content: 'stale identity vector',
        vector: [0, 1],
        metadata: {
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          recipeId: 'recipe-1',
          regionClass: 'identity',
          deprecated: false,
        },
      },
    ]);
    const service = createService(store as never);

    const report = await service.testRecipeSemanticRegionGeneration([createRecipe()], {
      sourceRefsBridgeByRecipeId: {
        'recipe-1': {
          status: 'active',
          refs: ['AlembicCore/src/service/vector/VectorService.ts'],
        },
      },
      sampleQueries: [
        {
          query: 'rebuild-only derived Recipe region index boundary',
          filter: { recipeId: 'recipe-1', regionClass: 'architectureConvention' },
          topK: 3,
        },
      ],
    });

    expect(report.mode).toBe('bounded-generation-test');
    expect(report.status).toBe('completed');
    expect(report.activeRecipeCount).toBe(1);
    expect(report.distinctRecipeIdsCovered).toBe(1);
    expect(report.missingRecipeIds).toEqual([]);
    expect(report.generatedRecipeRegionItemCount).toBeGreaterThan(0);
    expect(report.embedded).toBe(report.generatedRecipeRegionItemCount);
    expect(report.upserted).toBe(report.generatedRecipeRegionItemCount);
    expect(report.removed).toBe(1);
    expect(report.staleRemovedCount).toBe(1);
    expect(report.legacyEntryCount).toBe(1);
    expect(report.legacyEntryOnly).toBe(false);
    expect(report.generatedRegionClassCounts.architectureConvention).toBe(1);
    expect(report.filterProof.filterable).toBe(true);
    expect(report.filterProof.regionClassFilterCounts.architectureConvention).toBe(1);
    expect(report.retrievalSamples[0]).toMatchObject({
      matched: true,
      matchedRecipeIds: ['recipe-1'],
      matchedRegionClasses: ['architectureConvention'],
    });
    expect(report.safeForFullFixtureGeneration).toBe(true);
    expect(report.fullGenerationRoute).toMatchObject({
      method: 'VectorService.syncRecipeSemanticRegions',
      precondition: 'bounded-generation-test-passed',
      allowedAfterBoundedPass: true,
    });
    expect(report.vectorIndex.indexPath).toContain('vector_index.json');

    const ids = await store.listIds();
    expect(ids).toContain('entry_legacy-only');
    expect(ids).not.toContain('recipe_region_recipe-1_identity_oldhash');
    expect(ids.some((id) => id.startsWith('recipe_region_recipe-1_'))).toBe(true);
  });

  it('blocks the full fixture route when the bounded generation test is degraded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apq3-generation-test-degraded-'));
    tmpDirs.push(dir);
    const store = new JsonVectorAdapter(dir, { indexPath: join(dir, 'vector_index.json') });
    await store.init();
    await store.batchUpsert([
      {
        id: 'entry_legacy-only',
        content: 'legacy whole-entry vector',
        vector: [0, 1],
        metadata: { entryId: 'legacy-only', kind: 'recipe' },
      },
    ]);
    const service = createService(store as never, null);

    const report = await service.testRecipeSemanticRegionGeneration([createRecipe()]);

    expect(report.status).toBe('degraded');
    expect(report.degradedCount).toBeGreaterThan(0);
    expect(report.generatedRecipeRegionItemCount).toBe(0);
    expect(report.legacyEntryOnly).toBe(true);
    expect(report.safeForFullFixtureGeneration).toBe(false);
    expect(report.fullGenerationRoute.allowedAfterBoundedPass).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining(['sample-retrieval-proof:embed-provider-unavailable'])
    );
  });

  it('does not generate or upsert region chunks during ordinary semantic search', async () => {
    const vectorStore = createMockVectorStore();
    vectorStore.searchVector.mockResolvedValue([
      { item: { id: 'recipe_region_recipe-1_identity_hash', metadata: {} }, score: 0.9 },
    ]);
    const service = createService(vectorStore);

    const results = await service.search('implementation boundary', {
      filter: { type: RECIPE_SEMANTIC_REGION_METADATA_TYPE, regionClass: 'identity' },
    });

    expect(results).toHaveLength(1);
    expect(vectorStore.searchVector).toHaveBeenCalled();
    expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('filters JSON vector items by APQ3 region metadata selectors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apq3-json-'));
    tmpDirs.push(dir);
    const store = new JsonVectorAdapter(dir, { indexPath: join(dir, 'vector_index.json') });
    await store.init();
    await store.batchUpsert([
      {
        id: 'region-1',
        content: 'architecture rationale',
        vector: [1, 0],
        metadata: {
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          recipeId: 'recipe-1',
          regionClass: 'rationale',
          dimensionId: 'architecture',
          knowledgeType: 'code-pattern',
          tags: ['boundary'],
        },
      },
      {
        id: 'region-2',
        content: 'testing evidence',
        vector: [0, 1],
        metadata: {
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          recipeId: 'recipe-2',
          regionClass: 'evidence',
          dimensionId: 'testing-quality',
          knowledgeType: 'code-pattern',
          tags: ['testing'],
        },
      },
    ]);

    const results = await store.searchByFilter({
      type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
      recipeId: 'recipe-1',
      regionClass: 'rationale',
      dimensionId: ['architecture'],
      knowledgeType: 'code-pattern',
      tags: ['boundary'],
    });

    expect(results.map((item) => item.id)).toEqual(['region-1']);
  });

  it('filters HNSW vector candidates by APQ3 region metadata selectors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apq3-hnsw-'));
    tmpDirs.push(dir);
    const store = new HnswVectorAdapter(dir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: false,
      indexDir: join(dir, 'index'),
    });
    await store.init();
    await store.batchUpsert([
      {
        id: 'region-1',
        content: 'architecture rationale',
        vector: [1, 0],
        metadata: {
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          recipeId: 'recipe-1',
          regionClass: 'rationale',
          dimensionId: 'architecture',
          knowledgeType: 'code-pattern',
        },
      },
      {
        id: 'region-2',
        content: 'architecture identity',
        vector: [0.9, 0.1],
        metadata: {
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          recipeId: 'recipe-1',
          regionClass: 'identity',
          dimensionId: 'architecture',
          knowledgeType: 'code-pattern',
        },
      },
    ]);

    const results = await store.searchVector([1, 0], {
      topK: 10,
      filter: {
        type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
        recipeId: 'recipe-1',
        regionClass: 'rationale',
        dimensionId: ['architecture'],
        knowledgeType: 'code-pattern',
      },
    });

    expect(results.map((result) => result.item.id)).toEqual(['region-1']);
    store.destroy();
  });
});

// ── 已存在跳过（2026-07-06 启动同步加速）──
describe('syncRecipeSemanticRegionVectors existing-id skip', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeStore() {
    const dir = mkdtempSync(join(tmpdir(), 'region-skip-'));
    tmpDirs.push(dir);
    const store = new JsonVectorAdapter(dir, {});
    store.initSync();
    return store;
  }

  function makeEmbed() {
    return {
      embed: vi.fn(async (texts: string | string[]) => {
        const list = Array.isArray(texts) ? texts : [texts];
        return list.map((_, i) => [0.1 + i * 0.01, 0.2]);
      }),
    };
  }

  it('second sync with unchanged entries skips embed entirely (idempotent fast path)', async () => {
    const store = makeStore();
    const embed = makeEmbed();
    const entries = [createRecipe()];

    const first = await syncRecipeSemanticRegionVectors(store, embed as never, entries);
    expect(first.status).toBe('completed');
    expect(first.upserted).toBeGreaterThan(0);
    expect(first.skippedExisting).toBe(0);
    expect(embed.embed).toHaveBeenCalledTimes(1);

    const second = await syncRecipeSemanticRegionVectors(store, embed as never, entries);
    expect(second.status).toBe('completed');
    expect(second.upserted).toBe(0);
    expect(second.skippedExisting).toBe(first.upserted);
    // 内容未变 → id 未变 → 第二轮零 embed 调用
    expect(embed.embed).toHaveBeenCalledTimes(1);
  });

  it('force:true bypasses the skip and re-embeds everything', async () => {
    const store = makeStore();
    const embed = makeEmbed();
    const entries = [createRecipe()];
    await syncRecipeSemanticRegionVectors(store, embed as never, entries);

    const forced = await syncRecipeSemanticRegionVectors(store, embed as never, entries, {
      force: true,
    });
    expect(forced.upserted).toBeGreaterThan(0);
    expect(forced.skippedExisting ?? 0).toBe(0);
    expect(embed.embed).toHaveBeenCalledTimes(2);
  });

  it('content change produces a new id which is generated while stale sibling is removed', async () => {
    const store = makeStore();
    const embed = makeEmbed();
    const base = createRecipe();
    await syncRecipeSemanticRegionVectors(store, embed as never, [base]);

    const changed = createRecipe({ doClause: 'sync region vectors with a brand new do clause' });
    const second = await syncRecipeSemanticRegionVectors(store, embed as never, [changed]);
    // 变更的 region 走生成，未变的 region 走跳过，旧 id 由 removeStale 清理
    expect(second.upserted).toBeGreaterThan(0);
    expect(second.skippedExisting).toBeGreaterThan(0);
    expect(second.removed).toBeGreaterThan(0);
  });
});

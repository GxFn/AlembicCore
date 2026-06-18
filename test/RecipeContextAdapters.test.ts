// GMAP-2 — RecipeContext over REAL Core services. Proves the adapters compose
// the actual public read paths end to end:
//   * knowledgeReadPortFromService over a real KnowledgeService (D3: public
//     @alembic/core/knowledge read facade; NotFound -> null; lifecycle excluded)
//   * sourceRefPortFromRepository over a real RecipeSourceRefRepository on a
//     real migrated SQLite database (stale / renamed diagnostics from real rows)
//   * vectorPortFromService over a real VectorService with no EmbedProvider
//     (graceful degradation — the GMAP-L injection point absent)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { KnowledgeService } from '../src/knowledge.js';
import {
  createRecipeContextServiceFromCore,
  knowledgeReadPortFromService,
  vectorPortFromService,
} from '../src/recipe-context.js';
import { RecipeSourceRefRepositoryImpl } from '../src/repository/sourceref/RecipeSourceRefRepository.js';
import pathGuard from '../src/shared/PathGuard.js';
import { VectorService } from '../src/vector.js';

function makeEntry(id: string, over: Record<string, unknown> = {}): KnowledgeEntry {
  return new KnowledgeEntry({
    category: 'Utility',
    content: { pattern: 'service.sync()', rationale: 'deterministic' },
    description: 'Use when Core owns reusable persistence.',
    id,
    kind: 'pattern',
    knowledgeType: 'code-pattern',
    language: 'typescript',
    lifecycle: 'active',
    moduleName: 'service/vector',
    reasoning: {
      confidence: 0.9,
      sources: ['src/service/vector/VectorService.ts'],
      whyStandard: 'std',
    },
    relations: { depends_on: [{ description: 'base', target: 'r2' }] },
    sourceFile: 'src/service/vector/VectorService.ts',
    tags: ['architecture'],
    title: `Recipe ${id}`,
    ...over,
  });
}

function knowledgeServiceWith(entries: KnowledgeEntry[]): KnowledgeService {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const repo = {
    findById: async (id: string) => byId.get(id) ?? null,
    findWithPagination: async (
      _filters: Record<string, unknown>,
      opts: { page?: number; pageSize?: number } = {}
    ) => ({
      data: [...byId.values()],
      pagination: { page: opts.page ?? 1, pageSize: opts.pageSize ?? 20, total: byId.size },
    }),
  };
  return new KnowledgeService(
    repo as never,
    { log: async () => {} } as never,
    {} as never,
    null,
    {}
  );
}

describe('knowledgeReadPortFromService over a real KnowledgeService', () => {
  it('projects a KnowledgeEntry into a read-only RecipeRecord (D3)', async () => {
    const port = knowledgeReadPortFromService(knowledgeServiceWith([makeEntry('r1')]));

    const record = await port.getRecipe('r1');
    expect(record?.id).toBe('r1');
    expect(record?.title).toBe('Recipe r1');
    expect(record?.content).toBe('service.sync()');
    expect(record?.relations).toEqual([{ description: 'base', target: 'r2', type: 'depends_on' }]);
    expect(record?.sources).toContain('src/service/vector/VectorService.ts');
    expect(record?.moduleName).toBe('service/vector');
  });

  it('maps a missing recipe (KnowledgeService NotFoundError) to null', async () => {
    const port = knowledgeReadPortFromService(knowledgeServiceWith([]));
    expect(await port.getRecipe('ghost')).toBeNull();
  });
});

describe('RecipeContext over a real recipe_source_refs database', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let repo: RecipeSourceRefRepositoryImpl;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmap2-recipe-context-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ knowledgeBaseDir: 'Alembic', projectRoot: tmpDir });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    repo = new RecipeSourceRefRepositoryImpl(connection.getDrizzle());
    // recipe_source_refs.recipe_id is an FK to knowledge_entries(id).
    connection.db
      ?.prepare(
        'INSERT INTO knowledge_entries (id, title, createdAt, updatedAt) VALUES (?, ?, 1, 1)'
      )
      .run('r1', 'Recipe r1');
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('surfaces real stale / renamed diagnostics through a detail read', async () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'old/b.ts', status: 'stale', verifiedAt: 1 });
    repo.upsert({
      newPath: 'new/c.ts',
      recipeId: 'r1',
      sourcePath: 'old/c.ts',
      status: 'renamed',
      verifiedAt: 1,
    });

    const service = createRecipeContextServiceFromCore({
      knowledge: knowledgeServiceWith([makeEntry('r1')]),
      sourceRefRepository: repo,
    });

    const envelope = await service.execute({ kind: 'detail', payload: { ref: 'r1' } });
    const data = envelope.data as { sourceRefs: unknown[] };
    expect(data.sourceRefs).toHaveLength(3);
    const codes = (envelope.errors ?? []).map((error) => error.code);
    expect(codes).toContain('stale-ref');
    expect(codes).toContain('renamed');
  });

  it('runs a real batch source-refs query by path prefix', async () => {
    repo.upsert({ recipeId: 'r1', sourcePath: 'src/a.ts', verifiedAt: 1 });
    repo.upsert({ recipeId: 'r1', sourcePath: 'old/b.ts', status: 'stale', verifiedAt: 1 });
    repo.upsert({
      newPath: 'new/c.ts',
      recipeId: 'r1',
      sourcePath: 'old/c.ts',
      status: 'renamed',
      verifiedAt: 1,
    });

    const service = createRecipeContextServiceFromCore({
      knowledge: knowledgeServiceWith([makeEntry('r1')]),
      sourceRefRepository: repo,
    });

    const envelope = await service.execute({
      kind: 'source-refs',
      payload: { pathPrefix: 'old/' },
    });
    expect((envelope.data as { refs: unknown[] }).refs).toHaveLength(2);
  });
});

describe('vectorPortFromService over a real VectorService without an EmbedProvider', () => {
  function buildVectorService(): VectorService {
    return new VectorService({
      autoSyncOnCrud: false,
      contextualEnricher: null,
      embedProvider: null,
      eventBus: null,
      hybridRetriever: null,
      indexingPipeline: { run() {}, setAiProvider() {} } as never,
      syncDebounceMs: 100,
      vectorStore: {
        batchUpsert: async () => {},
        clear: async () => {},
        getById: async () => null,
        getStats: async () => ({ count: 0, dimension: 2, indexSize: 0 }),
        listIds: async () => [],
        remove: async () => {},
        searchByFilter: async () => [],
        searchVector: async () => [],
        upsert: async () => {},
      } as never,
    });
  }

  it('returns vectorUsed=false when no embed lane is wired', async () => {
    const port = vectorPortFromService(buildVectorService());
    const result = await port.searchRegions('persist', {});
    expect(result.vectorUsed).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it('degrades prime through the service without throwing', async () => {
    const stubRepo = {
      findByRecipeId: () => [],
      findBySourcePath: () => [],
      findByStatus: () => [],
      findRenamed: () => [],
      findStale: () => [],
    };
    const service = createRecipeContextServiceFromCore({
      knowledge: knowledgeServiceWith([]),
      sourceRefRepository: stubRepo,
      vectorService: buildVectorService(),
    });

    const envelope = await service.execute({ kind: 'prime', payload: { query: 'persist' } });
    expect((envelope.data as { vectorUsed: boolean }).vectorUsed).toBe(false);
    expect(envelope.errors?.[0]?.code).toBe('vector-unavailable');
  });
});

describe('vectorPortFromService restores region identity across hybridSearch hit shapes', () => {
  // Populated-hit coverage for the readHitString fix. The prior tests only
  // exercised the embedProvider:null degraded path (hybridSearch -> []), so the
  // nested item/metadata shapes that actually carry recipeId/regionClass were
  // never asserted — exactly how the empty-identity defect slipped through.
  function portOver(hits: Array<Record<string, unknown>>) {
    const facade = { hybridSearch: async () => hits } as unknown as Parameters<
      typeof vectorPortFromService
    >[0];
    return vectorPortFromService(facade);
  }

  it('reads recipeId/regionClass/content from the HybridRetriever fuse shape (hit.data.item.metadata)', async () => {
    const port = portOver([
      {
        data: {
          item: {
            content: 'persist via repository.sync()',
            id: 'chunk-1',
            metadata: {
              recipeId: 'recipe-42',
              regionClass: 'persistence',
              type: 'recipe-semantic-region',
            },
          },
          score: 0.91,
        },
        denseRank: 1,
        id: 'chunk-1',
        rrfScore: 0.91,
        score: 0.91,
        semanticUsed: true,
        sparseRank: 2,
        vectorUsed: true,
      },
    ]);

    const result = await port.searchRegions('persist', { limit: 5 });

    expect(result.vectorUsed).toBe(true);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      content: 'persist via repository.sync()',
      id: 'chunk-1',
      recipeId: 'recipe-42',
      regionClass: 'persistence',
      score: 0.91,
    });
  });

  it('reads region identity from the no-hybridRetriever degraded shape (hit.item.metadata)', async () => {
    const port = portOver([
      {
        id: 'chunk-2',
        item: {
          content: 'guard rule body',
          id: 'chunk-2',
          metadata: { recipeId: 'recipe-7', regionClass: 'guard' },
        },
        score: 0.77,
        semanticUsed: true,
        vectorUsed: true,
      },
    ]);

    const result = await port.searchRegions('guard', {});

    expect(result.hits[0]).toMatchObject({
      content: 'guard rule body',
      recipeId: 'recipe-7',
      regionClass: 'guard',
    });
  });
});

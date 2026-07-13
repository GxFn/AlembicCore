// GMAP-2 — RecipeContextService behavior over fake read ports. Covers every
// read kind (detail / list / search / prime / source-refs / relations), the
// deterministic diagnostics, graceful vector degradation, and lifecycle
// isolation (the ports are read-only by construction).

import { describe, expect, it, vi } from 'vitest';
import {
  createRecipeContextService,
  type RecipeContextDeps,
  type RecipeReadPort,
  type RecipeRecord,
  type RecipeSearchPort,
  type RecipeSourceRefPort,
  type RecipeSourceRefRow,
  type RecipeVectorPort,
} from '../src/service/recipe-context/index.js';

function makeRecord(id: string, over: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id,
    lifecycle: 'active',
    ref: { id: `recipe:${id}`, kind: 'recipe', recipeId: id },
    relations: [],
    sources: [],
    tags: [],
    title: `Recipe ${id}`,
    ...over,
  };
}

function fakeReadPort(records: RecipeRecord[]): RecipeReadPort {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    async getRecipe(id) {
      return byId.get(id) ?? null;
    },
    async listRecipes(filter, pagination) {
      const items = records.filter((record) => {
        if (filter.category && record.category !== filter.category) {
          return false;
        }
        if (filter.language && record.language !== filter.language) {
          return false;
        }
        if (filter.lifecycle && record.lifecycle !== filter.lifecycle) {
          return false;
        }
        return true;
      });
      return {
        items,
        page: pagination.page ?? 1,
        pageSize: pagination.pageSize ?? items.length,
        total: items.length,
      };
    },
  };
}

function fakeSourceRefPort(rows: RecipeSourceRefRow[]): RecipeSourceRefPort {
  return {
    findByRecipeIds: (ids) => rows.filter((row) => ids.includes(row.recipeId)),
    findBySourcePath: (sourcePath) => rows.filter((row) => row.sourcePath === sourcePath),
    findByStatus: (status) => rows.filter((row) => row.status === status),
    listAll: () => rows,
  };
}

function buildService(over: Partial<RecipeContextDeps> = {}) {
  const deps: RecipeContextDeps = {
    read: over.read ?? fakeReadPort([]),
    retrieval: over.retrieval,
    search: over.search,
    sourceRefs: over.sourceRefs ?? fakeSourceRefPort([]),
    vector: over.vector,
  };
  return createRecipeContextService(deps);
}

describe('RecipeContextService — detail', () => {
  it('returns a recipe with its source refs and a content preview', async () => {
    const record = makeRecord('r1', { content: 'abcdefghij', title: 'Boundary sync' });
    const service = buildService({
      read: fakeReadPort([record]),
      sourceRefs: fakeSourceRefPort([
        { recipeId: 'r1', sourcePath: 'src/a.ts', status: 'active', verifiedAt: 1 },
      ]),
    });

    const envelope = await service.execute({
      kind: 'detail',
      payload: { contentCharLimit: 4, ref: 'r1' },
    });

    expect(envelope.contractVersion).toBe(1);
    expect(envelope.queryKind).toBe('detail');
    expect(envelope.errors).toBeUndefined();
    const data = envelope.data as {
      recipe: RecipeRecord;
      sourceRefs: unknown[];
      contentPreview?: string;
    };
    expect(data.recipe.id).toBe('r1');
    expect(data.sourceRefs).toHaveLength(1);
    expect(data.contentPreview).toBe('abcd');
    expect(envelope.refs.map((ref) => ref.id)).toContain('recipe:r1');
    expect(envelope.refs.map((ref) => ref.id)).toContain('source-ref:r1:src/a.ts');
  });

  it('normalizes knowledge: / recipe: prefixes on the ref', async () => {
    const service = buildService({ read: fakeReadPort([makeRecord('r1')]) });
    const envelope = await service.execute({ kind: 'detail', payload: { ref: 'knowledge:r1' } });
    expect((envelope.data as { recipe: RecipeRecord }).recipe.id).toBe('r1');
  });

  it('emits a not-found diagnostic for a missing recipe', async () => {
    const service = buildService({ read: fakeReadPort([]) });
    const envelope = await service.execute({ kind: 'detail', payload: { ref: 'ghost' } });
    expect(envelope.errors?.[0]?.code).toBe('not-found');
    expect(envelope.errors?.[0]?.severity).toBe('error');
    expect((envelope.data as { available?: boolean }).available).toBe(false);
  });

  it('emits stale-ref and renamed diagnostics from source ref status', async () => {
    const service = buildService({
      read: fakeReadPort([makeRecord('r1')]),
      sourceRefs: fakeSourceRefPort([
        { recipeId: 'r1', sourcePath: 'old/a.ts', status: 'stale', verifiedAt: 1 },
        {
          newPath: 'new/b.ts',
          recipeId: 'r1',
          sourcePath: 'old/b.ts',
          status: 'renamed',
          verifiedAt: 1,
        },
      ]),
    });
    const envelope = await service.execute({ kind: 'detail', payload: { ref: 'r1' } });
    const codes = (envelope.errors ?? []).map((error) => error.code);
    expect(codes).toContain('stale-ref');
    expect(codes).toContain('renamed');
  });

  it('rejects a payload with no ref as invalid-payload', async () => {
    const service = buildService();
    const envelope = await service.execute({ kind: 'detail', payload: {} });
    expect(envelope.errors?.[0]?.code).toBe('invalid-payload');
  });
});

describe('RecipeContextService — list', () => {
  it('filters recipes by metadata and returns pagination', async () => {
    const service = buildService({
      read: fakeReadPort([
        makeRecord('r1', { category: 'View', language: 'swift' }),
        makeRecord('r2', { category: 'Model', language: 'swift' }),
      ]),
    });
    const envelope = await service.execute({
      kind: 'list',
      payload: { filter: { category: 'View' }, page: 1, pageSize: 10 },
    });
    const data = envelope.data as { recipes: RecipeRecord[]; total: number };
    expect(data.recipes).toHaveLength(1);
    expect(data.recipes[0]?.id).toBe('r1');
    expect(data.total).toBe(1);
  });
});

describe('RecipeContextService — search', () => {
  it('maps hits and reports vector usage', async () => {
    const search: RecipeSearchPort = {
      async search() {
        return {
          hits: [{ recipeId: 'r1', score: 0.9, semanticUsed: true, title: 'A', vectorUsed: true }],
          semanticUsed: true,
          total: 1,
          vectorUsed: true,
        };
      },
    };
    const service = buildService({ search });
    const envelope = await service.execute({ kind: 'search', payload: { query: 'sync' } });
    const data = envelope.data as { hits: unknown[]; vectorUsed: boolean };
    expect(data.hits).toHaveLength(1);
    expect(data.vectorUsed).toBe(true);
    expect(envelope.errors).toBeUndefined();
  });

  it('degrades to keyword and warns when the vector lane is unavailable', async () => {
    const search: RecipeSearchPort = {
      async search() {
        return {
          fallbackReason: 'embed_circuit_open',
          hits: [{ recipeId: 'r1', score: 0.5, semanticUsed: false, vectorUsed: false }],
          semanticUsed: false,
          total: 1,
          vectorUsed: false,
        };
      },
    };
    const service = buildService({ search });
    const envelope = await service.execute({ kind: 'search', payload: { query: 'sync' } });
    expect((envelope.data as { hits: unknown[] }).hits).toHaveLength(1); // keyword results survive
    expect(envelope.errors?.some((error) => error.code === 'vector-unavailable')).toBe(true);
  });

  it('reports query-unavailable when no search engine is wired', async () => {
    const service = buildService({ search: null });
    const envelope = await service.execute({ kind: 'search', payload: { query: 'sync' } });
    expect(envelope.errors?.[0]?.code).toBe('query-unavailable');
  });
});

describe('RecipeContextService — prime', () => {
  it('uses the same canonical ordered Recipe candidates as search', async () => {
    const retrieve = vi.fn(async () => ({
      candidates: [
        {
          denseLaneUsed: true,
          diagnostics: {
            aggregatedRegionCount: 0,
            candidateBudgetReached: false,
            candidateWindow: 32,
            exhausted: true,
            filteredDeprecatedCount: 0,
            filteredOrphanCount: 0,
            refillRounds: 0,
          },
          recipe: { id: 'r1', lifecycle: 'active', title: 'A' },
          recipeId: 'r1',
          regionEvidence: [{ denseSimilarity: 0.8, id: 'region-r1', regionClass: 'identity' }],
          rrfContribution: { dense: 0.01, sparse: 0.008, total: 0.018 },
          score: 0.018,
          semanticUsed: true,
          sparseLaneUsed: true,
          vectorUsed: true,
        },
        {
          denseLaneUsed: false,
          diagnostics: {
            aggregatedRegionCount: 0,
            candidateBudgetReached: false,
            candidateWindow: 32,
            exhausted: true,
            filteredDeprecatedCount: 0,
            filteredOrphanCount: 0,
            refillRounds: 0,
          },
          recipe: { id: 'r2', lifecycle: 'active', title: 'B' },
          recipeId: 'r2',
          regionEvidence: [],
          rrfContribution: { dense: 0, sparse: 0.007, total: 0.007 },
          score: 0.007,
          semanticUsed: false,
          sparseLaneUsed: true,
          vectorUsed: false,
        },
      ],
      diagnostics: {
        aggregatedRegionCount: 0,
        candidateBudgetReached: false,
        candidateWindow: 32,
        exhausted: true,
        filteredDeprecatedCount: 0,
        filteredOrphanCount: 0,
        refillRounds: 0,
      },
    }));
    const service = buildService({ retrieval: { retrieve } });

    const search = await service.execute({ kind: 'search', payload: { query: 'boundaries' } });
    const prime = await service.execute({
      kind: 'prime',
      payload: { query: 'boundaries', regionClasses: ['identity'] },
    });

    expect((search.data as { candidateRecipeIds?: string[] }).candidateRecipeIds).toEqual([
      'r1',
      'r2',
    ]);
    expect((prime.data as { candidateRecipeIds?: string[] }).candidateRecipeIds).toEqual([
      'r1',
      'r2',
    ]);
    expect((prime.data as { blocks: unknown[] }).blocks).toHaveLength(1);
    expect(retrieve.mock.calls[0]?.[0]?.candidateFilter).toBeUndefined();
    expect(retrieve.mock.calls[1]?.[0]?.candidateFilter).toBeUndefined();
  });

  it('maps semantic-region blocks when the vector lane runs', async () => {
    const vector: RecipeVectorPort = {
      async searchRegions() {
        return {
          hits: [
            {
              content: 'why',
              id: 'rrv:r1:rationale',
              recipeId: 'r1',
              regionClass: 'rationale',
              score: 0.8,
            },
          ],
          vectorUsed: true,
        };
      },
    };
    const service = buildService({ vector });
    const envelope = await service.execute({ kind: 'prime', payload: { query: 'persist' } });
    const data = envelope.data as { blocks: unknown[]; vectorUsed: boolean };
    expect(data.blocks).toHaveLength(1);
    expect(data.vectorUsed).toBe(true);
    expect(envelope.errors).toBeUndefined();
  });

  it('degrades gracefully when no vector port is wired (EmbedProvider absent)', async () => {
    const service = buildService({ vector: null });
    const envelope = await service.execute({ kind: 'prime', payload: { query: 'persist' } });
    const data = envelope.data as {
      blocks: unknown[];
      vectorUsed: boolean;
      fallbackReason?: string;
    };
    expect(data.blocks).toHaveLength(0);
    expect(data.vectorUsed).toBe(false);
    expect(data.fallbackReason).toBe('embed-provider-unavailable');
    expect(envelope.errors?.[0]?.code).toBe('vector-unavailable');
  });

  it('warns when the vector port returns no vector-backed results', async () => {
    const vector: RecipeVectorPort = {
      async searchRegions() {
        return { fallbackReason: 'embed_circuit_open', hits: [], vectorUsed: false };
      },
    };
    const service = buildService({ vector });
    const envelope = await service.execute({ kind: 'prime', payload: { query: 'persist' } });
    expect(envelope.errors?.[0]?.code).toBe('vector-unavailable');
  });
});

describe('RecipeContextService — source-refs', () => {
  const rows: RecipeSourceRefRow[] = [
    { recipeId: 'r1', sourcePath: 'src/service/a.ts', status: 'active', verifiedAt: 1 },
    { recipeId: 'r2', sourcePath: 'src/service/b.ts', status: 'stale', verifiedAt: 1 },
    { recipeId: 'r3', sourcePath: 'src/domain/c.ts', status: 'active', verifiedAt: 1 },
  ];

  it('filters by path prefix and groups by recipe', async () => {
    const service = buildService({ sourceRefs: fakeSourceRefPort(rows) });
    const envelope = await service.execute({
      kind: 'source-refs',
      payload: { pathPrefix: 'src/service/' },
    });
    const data = envelope.data as { refs: unknown[]; byRecipe: unknown[] };
    expect(data.refs).toHaveLength(2);
    expect(data.byRecipe).toHaveLength(2);
    expect(envelope.errors?.some((error) => error.code === 'stale-ref')).toBe(true);
  });

  it('filters by module segment', async () => {
    const service = buildService({ sourceRefs: fakeSourceRefPort(rows) });
    const envelope = await service.execute({
      kind: 'source-refs',
      payload: { module: 'domain' },
    });
    expect((envelope.data as { refs: unknown[] }).refs).toHaveLength(1);
  });

  it('emits unresolved when nothing matches', async () => {
    const service = buildService({ sourceRefs: fakeSourceRefPort(rows) });
    const envelope = await service.execute({
      kind: 'source-refs',
      payload: { pathPrefix: 'no/such/' },
    });
    expect(envelope.errors?.[0]?.code).toBe('unresolved');
  });
});

describe('RecipeContextService — relations', () => {
  it('expands a relation chain and flags caution edges', async () => {
    const root = makeRecord('r1', {
      relations: [
        { target: 'r2', type: 'depends_on' },
        { target: 'knowledge:r3', type: 'conflicts' },
      ],
    });
    const service = buildService({
      read: fakeReadPort([root, makeRecord('r2'), makeRecord('r3')]),
    });
    const envelope = await service.execute({
      kind: 'relations',
      payload: { maxHops: 1, ref: 'r1' },
    });
    const data = envelope.data as {
      rootRecipeId: string;
      chains: { steps: { relationType: string; scoreImpact: string; toRecipeId: string }[] }[];
    };
    expect(data.rootRecipeId).toBe('r1');
    expect(data.chains).toHaveLength(2);
    const conflictStep = data.chains
      .flatMap((chain) => chain.steps)
      .find((step) => step.relationType === 'conflicts');
    expect(conflictStep?.scoreImpact).toBe('neutral-or-caution');
    expect(conflictStep?.toRecipeId).toBe('r3'); // knowledge: prefix normalized
  });

  it('returns not-found for a missing root recipe', async () => {
    const service = buildService({ read: fakeReadPort([]) });
    const envelope = await service.execute({ kind: 'relations', payload: { ref: 'ghost' } });
    expect(envelope.errors?.[0]?.code).toBe('not-found');
  });
});

describe('RecipeContextService — request validation', () => {
  it('rejects an unsupported request kind', async () => {
    const service = buildService();
    const envelope = await service.execute({
      kind: 'bogus' as never,
      payload: {},
    });
    expect(envelope.errors?.[0]?.code).toBe('invalid-request-kind');
  });
});

describe('RecipeContextService — lifecycle isolation', () => {
  it('operates with read-only ports that expose no mutation methods', async () => {
    // The deps object is typed RecipeContextDeps; its ports declare ONLY read
    // methods. This compiles and runs, demonstrating the facade never needs a
    // create/update/delete/publish path — lifecycle stays in KnowledgeService.
    const readPort: RecipeReadPort = fakeReadPort([makeRecord('r1')]);
    const mutationKeys = Object.keys(readPort).filter((key) =>
      ['create', 'update', 'delete', 'publish', 'deprecate', 'submit'].includes(key)
    );
    expect(mutationKeys).toEqual([]);

    const service = buildService({ read: readPort });
    const envelope = await service.execute({ kind: 'detail', payload: { ref: 'r1' } });
    expect((envelope.data as { recipe: RecipeRecord }).recipe.id).toBe('r1');
  });
});

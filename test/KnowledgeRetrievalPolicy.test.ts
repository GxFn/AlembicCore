import { describe, expect, it, vi } from 'vitest';

import {
  HybridCandidateRetriever,
  KnowledgeRetrievalPolicy,
  KnowledgeTruthProjector,
} from '../src/service/search/KnowledgeRetrieval.js';
import { FieldWeightedScorer } from '../src/service/search/SearchEngine.js';

const TARGET = 'eed49092-3cc8-4a2a-9a5d-29ead96e267b';
const FROZEN_QUERIES = [
  'How do we enforce clean architecture boundaries across Swift packages?',
  'What architecture rules should guide modular boundaries in a Swift app?',
  'How should layered dependencies flow across app, feature, service, and core modules?',
  'What are the modularization constraints for independently removable features?',
  'Where are dependencies allowed between UI features and shared core modules?',
  'How should an iOS application structure feature modules to avoid coupling?',
  'How do I keep SwiftPM feature packages independent from each other?',
  'What prevents one feature module from importing another feature directly?',
] as const;

describe('KnowledgeRetrievalPolicy', () => {
  it('refills when missing dense evidence can reorder a full Top-K projection', async () => {
    const denseOnly = ['dense-one', 'dense-two'];
    const dualLane = ['dual-c', 'dual-d', 'dual-e'];
    const sparseOnly = ['sparse-one', 'sparse-two'];
    const denseLeaders = [...denseOnly, ...dualLane];
    const dense = [
      ...denseLeaders.map((recipeId, index) => ({
        id: `recipe_region_${recipeId}_identity_leader`,
        item: {
          id: `recipe_region_${recipeId}_identity_leader`,
          metadata: { recipeId, regionClass: 'identity' },
        },
        score: 1 - index / 100,
      })),
      ...Array.from({ length: 36 }, (_, index) => {
        const recipeId = denseLeaders[index % denseLeaders.length];
        return {
          id: `recipe_region_${recipeId}_guidance_duplicate-${index}`,
          item: {
            id: `recipe_region_${recipeId}_guidance_duplicate-${index}`,
            metadata: { recipeId, regionClass: 'guidance' },
          },
          score: 0.9 - index / 1000,
        };
      }),
      {
        id: `recipe_region_${TARGET}_architectureConvention_late`,
        item: {
          id: `recipe_region_${TARGET}_architectureConvention_late`,
          metadata: { recipeId: TARGET, regionClass: 'architectureConvention' },
        },
        score: 0.8,
      },
    ];
    const sparse = [
      ...sparseOnly.map((id, index) => ({ id, score: 10 - index })),
      { id: TARGET, score: 8 },
      ...dualLane.map((id, index) => ({ id, score: 7 - index })),
    ];
    const liveIds = new Set([...denseLeaders, ...sparseOnly, TARGET]);
    const windows: number[] = [];
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: () => ({
            batchSupported: true,
            formatProfile: 'asymmetric',
            inputKinds: ['query', 'document'],
            normalization: 'provider-defined',
            provider: 'fixture',
          }),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: dense.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (_vector, options) => {
            const window = options?.topK ?? 0;
            windows.push(window);
            return dense.slice(0, window);
          }),
        },
        sparse: async (_query, options) => sparse.slice(0, options.limit),
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) =>
          ids.filter((id) => liveIds.has(id)).map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    const result = await policy.retrieve({
      query: 'What architecture rules should guide modular boundaries in a Swift app?',
      topK: 8,
    });
    const targetRank = result.candidates.findIndex(({ recipeId }) => recipeId === TARGET) + 1;
    const target = result.candidates.find(({ recipeId }) => recipeId === TARGET);

    expect(windows).toEqual([32, 64]);
    expect(targetRank).toBeGreaterThan(0);
    expect(targetRank).toBeLessThanOrEqual(3);
    expect(target).toMatchObject({
      denseLaneUsed: true,
      denseRank: 6,
      sparseLaneUsed: true,
      sparseRank: 3,
    });
    expect(result.diagnostics).toMatchObject({
      candidateBudgetReached: false,
      candidateWindow: 64,
      exhausted: true,
      refillRounds: 1,
    });
    expect(result.diagnostics.aggregatedRegionCount).toBeGreaterThan(0);
  });

  it('stops at the first window when every Top-K prefix is strictly stable', async () => {
    const liveIds = ['stable-a', 'stable-b'];
    const dense = Array.from({ length: 64 }, (_, index) => {
      const recipeId = liveIds[index % liveIds.length];
      return {
        id: `recipe_region_${recipeId}_guidance_${index}`,
        item: {
          id: `recipe_region_${recipeId}_guidance_${index}`,
          metadata: { recipeId, regionClass: 'guidance' },
        },
        score: 1 - index / 100,
      };
    });
    const sparse = Array.from({ length: 64 }, (_, index) => ({
      id: liveIds[index % liveIds.length],
      score: 64 - index,
    }));
    const windows: number[] = [];
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: dense.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (_vector, options) => {
            const window = options?.topK ?? 0;
            windows.push(window);
            return dense.slice(0, window);
          }),
        },
        sparse: async (_query, options) => sparse.slice(0, options.limit),
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) =>
          ids.filter((id) => liveIds.includes(id)).map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    const result = await policy.retrieve({ query: 'stable architecture', topK: 2 });

    expect(windows).toEqual([32]);
    expect(result.candidates.map(({ recipeId }) => recipeId)).toEqual(liveIds);
    expect(result.diagnostics).toMatchObject({
      candidateBudgetReached: false,
      candidateWindow: 32,
      exhausted: false,
      refillRounds: 0,
    });
  });

  it('reports the budget fallback when a full Top-K remains unstable', async () => {
    const dense = Array.from({ length: 64 }, (_, index) => ({
      id: `dense-${index}`,
      item: { id: `dense-${index}` },
      score: 1 - index / 100,
    }));
    const sparse = Array.from({ length: 64 }, (_, index) => ({
      id: `sparse-${index}`,
      score: 64 - index,
    }));
    const windows: number[] = [];
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: dense.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (_vector, options) => {
            const window = options?.topK ?? 0;
            windows.push(window);
            return dense.slice(0, window);
          }),
        },
        sparse: async (_query, options) => sparse.slice(0, options.limit),
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) => ids.map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    const result = await policy.retrieve({
      candidateBudget: 32,
      query: 'bounded architecture',
      topK: 2,
    });

    expect(windows).toEqual([32]);
    expect(result.candidates).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({
      candidateBudgetReached: true,
      candidateWindow: 32,
      exhausted: false,
      fallbackReason: 'candidate-budget-exhausted',
      refillRounds: 0,
    });
  });

  it('uses truth-aware unique live ranks when bounding an unseen lane', async () => {
    const activeIds = ['live-a', 'live-b', 'live-c'];
    const orphanIds = Array.from({ length: 15 }, (_, index) => `orphan-${index}`);
    const deprecatedIds = Array.from({ length: 15 }, (_, index) => `deprecated-${index}`);
    const denseIds = ['live-a', 'live-b', ...orphanIds, ...deprecatedIds, 'live-c'];
    const dense = denseIds.map((id, index) => ({
      id,
      item: { id },
      score: 1 - index / 100,
    }));
    const sparse = ['live-c', 'live-a', 'live-b'].map((id, index) => ({
      id,
      score: 3 - index,
    }));
    const windows: number[] = [];
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: dense.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (_vector, options) => {
            const window = options?.topK ?? 0;
            windows.push(window);
            return dense.slice(0, window);
          }),
        },
        sparse: async (_query, options) => sparse.slice(0, options.limit),
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) => [
          ...ids.filter((id) => activeIds.includes(id)).map((id) => ({ id, lifecycle: 'active' })),
          ...ids
            .filter((id) => deprecatedIds.includes(id))
            .map((id) => ({ id, lifecycle: 'deprecated' })),
        ],
      })
    );

    const result = await policy.retrieve({ query: 'truth-aware architecture', topK: 2 });

    expect(windows).toEqual([32, 64]);
    expect(result.candidates.map(({ recipeId }) => recipeId)).toEqual(['live-a', 'live-c']);
    expect(result.candidates[1]).toMatchObject({ denseRank: 3, sparseRank: 1 });
    expect(result.diagnostics).toMatchObject({
      candidateBudgetReached: false,
      candidateWindow: 64,
      exhausted: true,
      filteredDeprecatedCount: 15,
      filteredOrphanCount: 15,
      refillRounds: 1,
    });
  });

  it('stops when both candidate lanes are exhausted below Top-K', async () => {
    const dense = [{ id: 'dense-only', item: { id: 'dense-only' }, score: 1 }];
    const sparse = [{ id: 'sparse-only', score: 1 }];
    const searchVector = vi.fn(async () => dense);
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: 64, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector,
        },
        sparse: async () => sparse,
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) => ids.map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    const result = await policy.retrieve({ query: 'exhausted architecture', topK: 5 });

    expect(searchVector).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(2);
    expect(result.diagnostics).toMatchObject({
      candidateBudgetReached: false,
      candidateWindow: 32,
      exhausted: true,
      refillRounds: 0,
    });
  });

  it('propagates AbortSignal cancellation during candidate collection', async () => {
    const controller = new AbortController();
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: 64, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async () => {
            controller.abort('stop-refill');
            return Array.from({ length: 32 }, (_, index) => ({
              id: `candidate-${index}`,
              item: { id: `candidate-${index}` },
              score: 1 - index / 100,
            }));
          }),
        },
        sparse: async () =>
          Array.from({ length: 32 }, (_, index) => ({
            id: `sparse-${index}`,
            score: 32 - index,
          })),
      }),
      new KnowledgeTruthProjector({
        findByIds: vi.fn(async () => []),
      })
    );

    await expect(
      policy.retrieve({ query: 'cancel architecture', signal: controller.signal, topK: 2 })
    ).rejects.toBe('stop-refill');
  });

  it('refills beyond an orphan-heavy first window until distinct live truth fills topK', async () => {
    const raw = Array.from({ length: 32 }, (_, index) => ({
      id: `orphan-${index}`,
      item: { id: `orphan-${index}` },
      score: 1 - index / 100,
    })).concat([
      { id: TARGET, item: { id: TARGET }, score: 0.6 },
      { id: 'live-b', item: { id: 'live-b' }, score: 0.5 },
    ]);
    const searchVector = vi.fn(async (_vector: number[], options?: { topK?: number }) =>
      raw.slice(0, options?.topK)
    );
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: () => ({
            batchSupported: true,
            formatProfile: 'symmetric',
            inputKinds: ['query', 'document'],
            normalization: 'provider-defined',
            provider: 'fixture',
          }),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: raw.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector,
        },
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) =>
          ids
            .filter((id) => id === TARGET || id === 'live-b')
            .map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    const result = await policy.retrieve({ query: 'architecture', topK: 2 });

    expect(result.candidates.map((candidate) => candidate.recipeId)).toEqual([TARGET, 'live-b']);
    expect(result.diagnostics.refillRounds).toBe(1);
    expect(result.diagnostics.candidateWindow).toBe(34);
    expect(result.diagnostics.filteredOrphanCount).toBe(32);
    expect(searchVector).toHaveBeenCalledTimes(2);
    expect(searchVector.mock.calls.map((call) => call[1]?.topK)).toEqual([32, 34]);
  });

  it('returns sparse truth when the embedding provider is missing', async () => {
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: null,
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: 0, indexSize: 0 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async () => []),
        },
        sparse: async () => [{ id: TARGET, score: 7 }],
      }),
      new KnowledgeTruthProjector({
        findByIds: async () => [{ id: TARGET, lifecycle: 'active' }],
      })
    );

    const result = await policy.retrieve({ query: 'boundaries', topK: 3 });

    expect(result.candidates[0]).toMatchObject({
      denseLaneUsed: false,
      recipeId: TARGET,
      sparseLaneUsed: true,
      sparseScore: 7,
    });
    expect(result.diagnostics.fallbackReason).toBe('embed-provider-missing');
  });

  it('keeps the frozen eight-query matrix deterministic with the target in Top 3', async () => {
    const recipes = [
      {
        id: TARGET,
        text: 'layered dependencies between project layers feature modules independently removable coupling SwiftPM packages Core import directly',
        title: '分层依赖方向强制约束',
        tags: ['architecture'],
        kind: 'rule',
        knowledgeType: 'boundary-constraint',
      },
      {
        id: 'surface-swift-app',
        text: 'Swift app module lifecycle',
        title: 'Swift app module lifecycle',
        tags: ['swift'],
        kind: 'pattern',
        knowledgeType: 'code-pattern',
      },
      {
        id: 'surface-navigation',
        text: 'SwiftUI navigation architecture rule',
        title: 'NavigationStack architecture rule',
        tags: ['architecture'],
        kind: 'rule',
        knowledgeType: 'boundary-constraint',
      },
      {
        id: 'surface-startup',
        text: 'application startup architecture modules',
        title: 'Application startup architecture',
        tags: ['architecture'],
        kind: 'pattern',
        knowledgeType: 'architecture',
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `surface-${index}`,
        text: `Swift app module integration ${index}`,
        title: `Swift app module integration ${index}`,
        tags: ['swift'],
        kind: 'pattern',
        knowledgeType: 'code-pattern',
      })),
    ];
    const scorer = new FieldWeightedScorer();
    for (const recipe of recipes) {
      scorer.addDocument(recipe.id, recipe.text, {
        contentText: recipe.text,
        kind: recipe.kind,
        knowledgeType: recipe.knowledgeType,
        tags: recipe.tags,
        title: recipe.title,
      });
    }
    const targetRawRanks = [1, 7, 1, 1, 1, 3, 1, 1] as const;
    const denseByQuery = FROZEN_QUERIES.map((_query, queryIndex) => {
      const before = Array.from({ length: targetRawRanks[queryIndex] - 1 }, (_, index) => {
        // Reproduce region-heavy raw ranks: several higher chunks belong to
        // one superficial Recipe and must collapse before Recipe-level fusion.
        const recipeId = 'surface-swift-app';
        return {
          id: `recipe_region_${recipeId}_identity_${queryIndex}-${index}`,
          item: {
            id: `recipe_region_${recipeId}_identity_${queryIndex}-${index}`,
            metadata: { recipeId, regionClass: 'identity' },
          },
          score: 0.9 - index / 100,
        };
      });
      return [
        ...before,
        {
          id: `recipe_region_${TARGET}_architectureConvention_${queryIndex}`,
          item: {
            id: `recipe_region_${TARGET}_architectureConvention_${queryIndex}`,
            metadata: { recipeId: TARGET, regionClass: 'architectureConvention' },
          },
          score: 0.8,
        },
        {
          id: 'surface-startup',
          item: { id: 'surface-startup' },
          score: 0.7,
        },
      ];
    });
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: () => ({
            batchSupported: true,
            formatProfile: 'asymmetric',
            inputKinds: ['query', 'document'],
            normalization: 'provider-defined',
            provider: 'fixture',
          }),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async (query) => [
            FROZEN_QUERIES.indexOf(query as (typeof FROZEN_QUERIES)[number]),
          ]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: 256, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (vector, options) =>
            denseByQuery[vector[0]].slice(0, options?.topK)
          ),
        },
        sparse: async (query, options) => scorer.search(query, options.limit),
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) =>
          recipes
            .filter((recipe) => ids.includes(recipe.id))
            .map((recipe) => ({ ...recipe, lifecycle: 'active' })),
      })
    );

    for (const query of FROZEN_QUERIES) {
      const result = await policy.retrieve({ query, topK: 3 });
      expect(result.candidates.length).toBeGreaterThan(0);
      const candidateIds = result.candidates.map((candidate) => candidate.recipeId);
      expect(candidateIds.includes(TARGET), `${query}: ${candidateIds.join(',')}`).toBe(true);
      expect(candidateIds.indexOf(TARGET)).toBeLessThan(3);
      const target = result.candidates.find((candidate) => candidate.recipeId === TARGET);
      expect(target, query).toBeDefined();
      expect(target?.rrfContribution.sparse, query).toBeGreaterThan(0);
    }
  });

  it('applies authoritative metadata filters before deciding whether to refill', async () => {
    const raw = Array.from({ length: 33 }, (_, index) => ({
      id: index < 32 ? `other-${index}` : TARGET,
      item: { id: index < 32 ? `other-${index}` : TARGET },
      score: 1 - index / 100,
    }));
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: {
          describeCapabilities: () => ({
            batchSupported: true,
            formatProfile: 'symmetric',
            inputKinds: ['query', 'document'],
            normalization: 'provider-defined',
            provider: 'fixture',
          }),
          embedDocuments: vi.fn(),
          embedQuery: vi.fn(async () => [1]),
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: raw.length, indexSize: 1 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async (_vector, options) => raw.slice(0, options?.topK)),
        },
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) =>
          ids.map((id) => ({
            id,
            language: id === TARGET ? 'swift' : 'typescript',
            lifecycle: 'active',
          })),
      })
    );

    const result = await policy.retrieve({
      filter: { language: ['swift'] },
      query: 'boundaries',
      topK: 1,
    });

    expect(result.candidates.map((candidate) => candidate.recipeId)).toEqual([TARGET]);
    expect(result.diagnostics.refillRounds).toBe(1);
    expect(result.diagnostics.filteredMetadataCount).toBe(32);
  });

  it('opens the embedding circuit after repeated failures while preserving sparse truth', async () => {
    const embedQuery = vi.fn(async () => {
      throw new Error('offline');
    });
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        circuitFailureThreshold: 2,
        embedding: {
          describeCapabilities: vi.fn(),
          embedDocuments: vi.fn(),
          embedQuery,
        },
        reader: {
          getById: vi.fn(),
          getStats: vi.fn(async () => ({ count: 0, indexSize: 0 })),
          listIds: vi.fn(),
          searchVector: vi.fn(async () => []),
        },
        sparse: async () => [{ id: TARGET, score: 1 }],
      }),
      new KnowledgeTruthProjector({
        findByIds: async () => [{ id: TARGET, lifecycle: 'active' }],
      })
    );

    await policy.retrieve({ query: 'one' });
    const second = await policy.retrieve({ query: 'two' });
    const third = await policy.retrieve({ query: 'three' });

    expect(embedQuery).toHaveBeenCalledTimes(2);
    expect(second.diagnostics.fallbackReason).toBe('embed-circuit-open');
    expect(third.candidates[0]?.recipeId).toBe(TARGET);
    expect(third.diagnostics.fallbackReason).toBe('embed-circuit-open');
  });
});

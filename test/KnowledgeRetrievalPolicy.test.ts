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

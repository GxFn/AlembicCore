import { describe, expect, it, vi } from 'vitest';

import {
  HybridCandidateRetriever,
  KnowledgeRetrievalPolicy,
  KnowledgeTruthProjector,
} from '../src/service/search/KnowledgeRetrieval.js';

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
    const corpus = [
      {
        id: TARGET,
        text: 'clean architecture rules layered dependencies Swift packages modular boundaries app feature service core independently removable coupling UI shared modules importing feature directly',
      },
      { id: 'testing', text: 'unit testing async network mocks and deterministic fixtures' },
      { id: 'persistence', text: 'database migrations storage schema and transaction boundaries' },
      { id: 'ui', text: 'UI layout animation accessibility and view rendering' },
    ];
    const policy = new KnowledgeRetrievalPolicy(
      new HybridCandidateRetriever({
        embedding: null,
        reader: null,
        sparse: async (query) => {
          const terms = new Set(query.toLowerCase().match(/[a-z]+/g) ?? []);
          return corpus
            .map((item) => ({
              id: item.id,
              score: (item.text.toLowerCase().match(/[a-z]+/g) ?? []).filter((term) =>
                terms.has(term)
              ).length,
            }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
        },
      }),
      new KnowledgeTruthProjector({
        findByIds: async (ids) => ids.map((id) => ({ id, lifecycle: 'active' })),
      })
    );

    for (const query of FROZEN_QUERIES) {
      const result = await policy.retrieve({ query, topK: 3 });
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.map((candidate) => candidate.recipeId).indexOf(TARGET)).toBeLessThan(
        3
      );
      expect(
        result.candidates.find((candidate) => candidate.recipeId === TARGET)?.rrfContribution.sparse
      ).toBeGreaterThan(0);
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

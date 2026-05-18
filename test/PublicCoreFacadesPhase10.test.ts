import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { toRescanImpactDecision } from '../src/evolution.js';
import { createSemanticMemoryRepository } from '../src/memory.js';
import { cosineSimilarity, jaccardSimilarity, tokenizeForSimilarity } from '../src/search.js';

describe('phase 10 public facades', () => {
  it('exposes similarity helpers through the stable search facade', () => {
    const tokensA = tokenizeForSimilarity('semantic memory retrieval');
    const tokensB = tokenizeForSimilarity('memory retrieval');

    expect(jaccardSimilarity(tokensA, tokensB)).toBeGreaterThan(0);
    expect(cosineSimilarity([1, 0, 1], [1, 1, 0])).toBeCloseTo(0.5);
  });

  it('exposes a narrow evolution audit contract without the service facade', () => {
    const decision = toRescanImpactDecision(
      {
        recipeId: 'recipe-1',
        recipeTitle: 'Public evolution contract',
        reason: 'source-modified-pattern',
        affectedFiles: ['src/example.ts'],
        impactScore: 0.4,
        matchedTokens: ['contract'],
        sourceRefs: ['src/example.ts'],
        activeRefCount: 1,
      },
      { now: 42, source: 'rescan-evolution' }
    );

    expect(decision).toMatchObject({
      recipeId: 'recipe-1',
      action: 'update',
      source: 'rescan-evolution',
      confidence: 0.9,
    });
    expect(decision?.evidence[0]).toMatchObject({
      reason: 'source-modified-pattern',
      detectedAt: 42,
    });
  });

  it('creates a semantic memory repository from raw SQLite without exposing Drizzle schema', async () => {
    const db = new Database(':memory:');
    try {
      const repository = createSemanticMemoryRepository(db);

      await repository.create({
        id: 'memory-1',
        type: 'fact',
        content: 'Semantic memory repository contract',
        source: 'phase-10-test',
        importance: 8,
        relatedEntities: ['repository'],
        tags: ['public-api'],
      });

      const fetched = await repository.findById('memory-1');
      const active = await repository.getAllActive({ source: 'phase-10-test' });
      const similar = await repository.findSimilar('memory repository', null, 3);
      const stats = await repository.getStats();

      expect(fetched?.content).toBe('Semantic memory repository contract');
      expect(active).toHaveLength(1);
      expect(similar[0]).toMatchObject({ id: 'memory-1' });
      expect(similar[0].similarity).toBeGreaterThan(0.1);
      expect(stats).toMatchObject({
        total: 1,
        bySource: { 'phase-10-test': 1 },
        byType: { fact: 1 },
      });
    } finally {
      db.close();
    }
  });
});

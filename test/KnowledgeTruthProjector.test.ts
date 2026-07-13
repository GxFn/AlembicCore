import { describe, expect, it } from 'vitest';

import { KnowledgeTruthProjector } from '../src/service/search/KnowledgeRetrieval.js';

describe('KnowledgeTruthProjector', () => {
  it('aggregates duplicate regions before assigning one RRF contribution per Recipe and lane', async () => {
    const projector = new KnowledgeTruthProjector({
      findByIds: async () => [
        { id: 'recipe-a', lifecycle: 'active', title: 'A' },
        { id: 'recipe-b', lifecycle: 'active', title: 'B' },
      ],
    });

    const result = await projector.project({
      alpha: 0.6,
      dense: [
        {
          id: 'recipe_region_recipe-a_identity_1',
          item: {
            id: 'recipe_region_recipe-a_identity_1',
            metadata: { recipeId: 'recipe-a', regionClass: 'identity' },
          },
          score: 0.91,
        },
        {
          id: 'recipe_region_recipe-a_rationale_2',
          item: {
            id: 'recipe_region_recipe-a_rationale_2',
            metadata: { recipeId: 'recipe-a', regionClass: 'rationale' },
          },
          score: 0.89,
        },
        { id: 'recipe-b', item: { id: 'recipe-b' }, score: 0.8 },
      ],
      rrfK: 60,
      sparse: [
        { id: 'recipe-b', score: 12 },
        { id: 'recipe-a', score: 9 },
      ],
    });

    expect(result.candidates.map((candidate) => candidate.recipeId)).toEqual([
      'recipe-a',
      'recipe-b',
    ]);
    const recipeA = result.candidates[0];
    expect(recipeA.denseSimilarity).toBe(0.91);
    expect(recipeA.denseRank).toBe(1);
    expect(recipeA.sparseScore).toBe(9);
    expect(recipeA.sparseRank).toBe(2);
    expect(recipeA.regionEvidence).toHaveLength(2);
    expect(recipeA.rrfContribution).toEqual({
      dense: 0.6 / 61,
      sparse: 0.4 / 62,
      total: 0.6 / 61 + 0.4 / 62,
    });
    expect(recipeA.score).toBe(recipeA.rrfContribution.total);
    const recipeB = result.candidates.find((candidate) => candidate.recipeId === 'recipe-b');
    expect(recipeB?.denseRank).toBe(2);
    expect(recipeB?.rrfContribution.dense).toBe(0.6 / 62);
    expect(result.aggregatedRegionCount).toBe(1);
  });

  it('filters orphan and deprecated truth before final candidates', async () => {
    const projector = new KnowledgeTruthProjector({
      findByIds: async () => [
        { id: 'deprecated', lifecycle: 'deprecated' },
        { id: 'live', lifecycle: 'active' },
      ],
    });
    const result = await projector.project({
      dense: [
        { id: 'orphan', item: { id: 'orphan' }, score: 1 },
        { id: 'deprecated', item: { id: 'deprecated' }, score: 0.9 },
        { id: 'live', item: { id: 'live' }, score: 0.8 },
      ],
      sparse: [],
    });

    expect(result.candidates.map((candidate) => candidate.recipeId)).toEqual(['live']);
    expect(result.filteredOrphanCount).toBe(1);
    expect(result.filteredDeprecatedCount).toBe(1);
  });
});

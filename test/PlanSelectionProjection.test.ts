import { describe, expect, it } from 'vitest';

import { applyPlanSelection, assertPlanSelectionShape, type PlanSelection } from '../src/plans.js';

describe('PlanSelection projection foundation', () => {
  it('accepts a single-dimension selection and rejects empty or malformed selections', () => {
    expect(() => assertPlanSelectionShape(basePlanSelection())).not.toThrow();

    expect(() => assertPlanSelectionShape({ ...basePlanSelection(), dimensions: [] })).toThrow(
      /dimensions must be non-empty/
    );
    expect(() =>
      assertPlanSelectionShape({ ...basePlanSelection(), generationStage: 'unknown' })
    ).toThrow(/generationStage must be/);
    expect(() =>
      assertPlanSelectionShape({
        ...basePlanSelection(),
        scale: { totalRecipeBudget: 0 },
      })
    ).toThrow(/scale\.totalRecipeBudget must be > 0/);
  });

  it('projects execution dimensions, module scope, budgets, and unknown ids without throwing', () => {
    const projection = applyPlanSelection({
      ...basePlanSelection(),
      dimensions: [' architecture ', 'missing-dimension', 'architecture'],
      scale: { totalRecipeBudget: 1 },
      moduleBindings: [
        planModuleBinding('src/service/planIntent', ['architecture']),
        planModuleBinding('src/service/planIntent', ['missing-dimension']),
        planModuleBinding(' src/domain/dimension ', ['architecture']),
      ],
    });

    expect(projection).toEqual({
      executionDimensions: ['architecture', 'missing-dimension'],
      budget: {
        totalRecipeBudget: 2,
        maxFiles: 500,
        contentMaxLines: 120,
      },
      moduleScope: ['src/service/planIntent', 'src/domain/dimension'],
      unknownDimensionIds: ['missing-dimension'],
    });
  });

  it('uses test-mode overrides while preserving dimension-count total lower and upper bounds', () => {
    const projection = applyPlanSelection(
      {
        ...basePlanSelection(),
        dimensions: ['architecture', 'testing-quality', 'missing-dimension'],
        scale: {
          totalRecipeBudget: 30,
          maxFiles: 900,
          contentMaxLines: 300,
        },
        moduleBindings: [
          planModuleBinding('src/service/planIntent', ['architecture']),
          planModuleBinding('src/domain/dimension', ['testing-quality']),
        ],
      },
      {
        testMode: true,
        moduleScope: ['src/service/planIntent', 'src/not-planned'],
        scaleOverride: {
          totalRecipeBudget: 99,
          maxFiles: 8,
          contentMaxLines: 16,
        },
      }
    );

    expect(projection.budget).toEqual({
      totalRecipeBudget: 6,
      maxFiles: 8,
      contentMaxLines: 16,
    });
    expect(projection.moduleScope).toEqual(['src/service/planIntent']);
    expect(projection.unknownDimensionIds).toEqual(['missing-dimension']);
  });

  it('exposes the projection primitives from the plans surface', () => {
    expect(typeof applyPlanSelection).toBe('function');
    expect(typeof assertPlanSelectionShape).toBe('function');
  });
});

function basePlanSelection(): PlanSelection {
  return {
    generationStage: 'deepMining',
    dimensions: ['architecture'],
    scale: {
      totalRecipeBudget: 1,
    },
    moduleBindings: [planModuleBinding('src/service/planIntent', ['architecture'])],
  };
}

function planModuleBinding(
  modulePath: string,
  dimensions: readonly string[]
): PlanSelection['moduleBindings'][number] {
  return {
    modulePath,
    dimensions,
    targetRecipes: 1,
    priority: 1,
  };
}

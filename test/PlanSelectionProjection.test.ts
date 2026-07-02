import { describe, expect, it } from 'vitest';

import {
  applyPlanSelection,
  assertPlanSelectionShape,
  assertPlanSelectionStageRequirements,
  type PlanSelection,
  planSelectionRequiresModuleTargets,
} from '../src/plans.js';

describe('PlanSelection projection foundation', () => {
  it('accepts a single-dimension selection and rejects empty or malformed selections', () => {
    expect(() => assertPlanSelectionShape(basePlanSelection())).not.toThrow();
    // Generic shape intentionally stays stage-agnostic so coldStart/legacy callers can parse first.
    expect(() =>
      assertPlanSelectionShape({ ...basePlanSelection(), moduleBindings: [] })
    ).not.toThrow();

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

  it('enforces module×dimension targets only for deepMining and moduleMining selections', () => {
    expect(planSelectionRequiresModuleTargets('coldStart')).toBe(false);
    expect(planSelectionRequiresModuleTargets('deepMining')).toBe(true);
    expect(planSelectionRequiresModuleTargets('moduleMining')).toBe(true);

    expect(() =>
      assertPlanSelectionStageRequirements({ ...basePlanSelection(), moduleBindings: [] })
    ).toThrow(/deepMining requires moduleBindings with module×dimension targets/);
    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        generationStage: 'moduleMining',
        moduleBindings: [],
      })
    ).toThrow(/moduleMining requires moduleBindings with module×dimension targets/);
    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        generationStage: 'coldStart',
        moduleBindings: [],
      })
    ).not.toThrow();
  });

  it('rejects stage-required bindings that cannot produce valid module×dimension targets', () => {
    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        moduleBindings: [planModuleBinding('', ['architecture'])],
      })
    ).toThrow(/moduleBinding\[0\]\.modulePath is required/);

    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        moduleBindings: [planModuleBinding('src/service/planIntent', [])],
      })
    ).toThrow(/moduleBinding\[0\]\.dimensions must be non-empty/);

    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        moduleBindings: [planModuleBinding('src/service/planIntent', ['unknown-dimension'])],
      })
    ).toThrow(/moduleBinding\[0\] references unknown dimension unknown-dimension/);

    expect(() =>
      assertPlanSelectionStageRequirements({
        ...basePlanSelection(),
        moduleBindings: [
          { ...planModuleBinding('src/service/planIntent', ['architecture']), targetRecipes: 0 },
        ],
      })
    ).toThrow(/moduleBinding\[0\]\.targetRecipes must be > 0/);
  });

  it('accepts valid stage-required module bindings and can assert an expected stage', () => {
    expect(() => assertPlanSelectionStageRequirements(basePlanSelection())).not.toThrow();
    expect(() =>
      assertPlanSelectionStageRequirements(
        { ...basePlanSelection(), generationStage: 'moduleMining' },
        { expectedStage: 'moduleMining' }
      )
    ).not.toThrow();
    expect(() =>
      assertPlanSelectionStageRequirements(basePlanSelection(), { expectedStage: 'moduleMining' })
    ).toThrow(/generationStage must be moduleMining/);
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
        // P-4(2026-07-02)：下限 = dimensionCount×3（每维度至少 3 条可提炼约定；旧下限
        // 每维度 1 条纵容 plan LLM 保守拍数）。本用例 2 维度 → 下限 6。
        totalRecipeBudget: 6,
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
    expect(typeof assertPlanSelectionStageRequirements).toBe('function');
    expect(typeof planSelectionRequiresModuleTargets).toBe('function');
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

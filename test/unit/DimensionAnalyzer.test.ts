/**
 * DimensionAnalyzer — H1 hardening (graceful degradation for
 * classification/active-set mismatch).
 *
 * Pins BOTH sides of the H1 contract:
 *  - consistent inputs (classified dimensions all inside the active set)
 *    produce the same radar as before the hardening, with NO diagnostic;
 *  - the recorded P5 p4 trigger shape (a ts-js-module recipe on a
 *    swift-primary project) degrades gracefully: no TypeError, the
 *    mismatched recipe is skipped from radar counts (still in totalRecipes),
 *    and the registered core.diagnostic.dimension.classification-mismatch
 *    diagnostic is emitted once per analyze() with the breakdown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveActiveDimensions } from '../../src/domain/dimension/index.js';
import { Logger } from '../../src/infrastructure/logging/Logger.js';
import { DimensionAnalyzer } from '../../src/service/panorama/DimensionAnalyzer.js';
import { CORE_DIAGNOSTIC_CODES } from '../../src/shared/DiagnosticCodes.js';

interface RecipeFixture {
  title: string;
  dimensionId: string;
  category: string;
  knowledgeType: string;
  topicHint: string;
  kind: string;
}

function makeRecipe(title: string, dimensionId: string): RecipeFixture {
  return { title, dimensionId, category: '', knowledgeType: '', topicHint: '', kind: 'recipe' };
}

function makeAnalyzer(primaryLang: string, recipes: RecipeFixture[]): DimensionAnalyzer {
  const bootstrapRepo = { getLatestPrimaryLang: vi.fn().mockResolvedValue(primaryLang) };
  const entityRepo = { findDistinctFilePaths: vi.fn().mockResolvedValue([]) };
  const knowledgeRepo = { findRecipeMetadata: vi.fn().mockResolvedValue(recipes) };
  return new DimensionAnalyzer(bootstrapRepo as any, entityRepo as any, knowledgeRepo as any, '/p');
}

describe('DimensionAnalyzer H1 hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('consistent inputs: radar unchanged, no mismatch diagnostic', async () => {
    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const analyzer = makeAnalyzer('typescript', [
      makeRecipe('Barrel exports', 'ts-js-module'),
      makeRecipe('Public API surface', 'ts-js-module'),
    ]);

    const { radar } = await analyzer.analyze([]);

    const tsModuleDim = radar.dimensions.find((dim) => dim.id === 'ts-js-module');
    expect(tsModuleDim).toBeDefined();
    expect(tsModuleDim?.recipeCount).toBe(2);
    expect(tsModuleDim?.topRecipes).toEqual(['Barrel exports', 'Public API surface']);
    expect(tsModuleDim?.score).toBe(40);
    expect(radar.totalRecipes).toBe(2);
    expect(radar.coveredDimensions).toBe(1);
    expect(radar.totalDimensions).toBe(resolveActiveDimensions('typescript').length);
    const mismatchCalls = warnSpy.mock.calls.filter(
      ([, meta]) =>
        (meta as Record<string, unknown>)?.code ===
        CORE_DIAGNOSTIC_CODES.dimensionClassificationMismatch
    );
    expect(mismatchCalls).toHaveLength(0);
  });

  it('p4 trigger shape: ts-js-module recipe on a swift-primary project degrades gracefully', async () => {
    // Sanity: the trigger dimension really is outside the swift active set.
    const swiftDims = resolveActiveDimensions('swift');
    expect(swiftDims.some((dim) => dim.id === 'ts-js-module')).toBe(false);

    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const analyzer = makeAnalyzer('swift', [
      makeRecipe('TS module recipe on swift project', 'ts-js-module'),
      makeRecipe('Another stray', 'ts-js-module'),
    ]);

    // Pre-H1 this line threw: Cannot read properties of undefined (reading 'count').
    const { radar } = await analyzer.analyze([]);

    expect(radar.totalRecipes).toBe(2);
    expect(radar.coveredDimensions).toBe(0);
    expect(radar.dimensions.every((dim) => dim.recipeCount === 0)).toBe(true);
    expect(radar.totalDimensions).toBe(swiftDims.length);

    const mismatchCalls = warnSpy.mock.calls.filter(
      ([, meta]) =>
        (meta as Record<string, unknown>)?.code ===
        CORE_DIAGNOSTIC_CODES.dimensionClassificationMismatch
    );
    expect(mismatchCalls).toHaveLength(1);
    const meta = mismatchCalls[0][1] as {
      inactiveDimensions: Record<string, number>;
      activeDimensionIds: string[];
    };
    expect(meta.inactiveDimensions).toEqual({ 'ts-js-module': 2 });
    expect(meta.activeDimensionIds).toEqual(swiftDims.map((dim) => dim.id));
  });
});

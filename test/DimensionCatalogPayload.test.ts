import { describe, expect, it } from 'vitest';

import {
  ALL_DIMENSION_IDS,
  buildDimensionCatalogPayload,
  resolveDimensionLanguageApplicability,
} from '../src/dimensions.js';
import { getDimension } from '../src/domain/dimension/index.js';

describe('Dimension catalog payload', () => {
  it('returns the full registry with complete SOP and submission payloads', () => {
    const catalog = buildDimensionCatalogPayload({
      frameworks: ['React'],
      languages: ['TypeScript'],
    });

    expect(catalog).toHaveLength(25);
    expect(catalog.map((dimension) => dimension.id)).toEqual([...ALL_DIMENSION_IDS]);

    for (const dimension of catalog) {
      expect(dimension.sop.steps.length).toBeGreaterThan(0);
      expect(dimension.sop.timeEstimate).toBeTruthy();
      expect(dimension.sop.commonMistakes.length).toBeGreaterThan(0);
      expect(dimension.analysisGuide.steps).toEqual(dimension.sop.steps);
      expect(dimension.submissionSpec.preSubmitChecklist.MUST.length).toBeGreaterThan(0);
      expect(Object.hasOwn(dimension, 'active')).toBe(false);
      expect(Object.hasOwn(dimension, 'skipped')).toBe(false);
      expect(Object.hasOwn(dimension, 'rank')).toBe(false);
      expect(Object.hasOwn(dimension, 'score')).toBe(false);
      expect(Object.hasOwn(dimension, 'scale')).toBe(false);
    }
  });

  it('tags universal dimensions as applicable without filtering any dimension', () => {
    const catalog = buildDimensionCatalogPayload();

    const universal = catalog.filter((dimension) => dimension.layer === 'universal');
    const conditional = catalog.filter((dimension) => dimension.layer !== 'universal');

    expect(universal).toHaveLength(13);
    expect(universal.every((dimension) => dimension.languageApplicable)).toBe(true);
    expect(conditional).toHaveLength(12);
    expect(conditional.every((dimension) => !dimension.languageApplicable)).toBe(true);
    expect(catalog).toHaveLength(25);
  });

  it('uses only factual language and framework intersections for conditional tags', () => {
    const catalog = buildDimensionCatalogPayload({
      frameworks: ['next.js', 'React'],
      languages: ['ts'],
    });

    const byId = new Map(catalog.map((dimension) => [dimension.id, dimension]));

    expect(byId.get('ts-js-module')?.languageApplicable).toBe(true);
    expect(byId.get('react-patterns')?.languageApplicable).toBe(true);
    expect(byId.get('python-structure')?.languageApplicable).toBe(false);
    expect(byId.get('django-fastapi')?.languageApplicable).toBe(false);
    expect(byId.get('react-patterns')?.languageApplicability).toMatchObject({
      matchedFrameworks: ['nextjs', 'react'],
      matchedLanguages: ['typescript'],
      reason: 'language-framework-match',
    });
  });

  it('keeps framework dimensions tied to framework facts instead of language-only guesses', () => {
    const react = getDimension('react-patterns');
    if (!react) {
      throw new Error('react-patterns dimension is missing from the registry.');
    }

    expect(
      resolveDimensionLanguageApplicability(react, { languages: ['typescript'] })
    ).toMatchObject({
      applicable: false,
      matchedLanguages: ['typescript'],
      matchedFrameworks: [],
      reason: 'no-factual-match',
    });
    expect(resolveDimensionLanguageApplicability(react, { frameworks: ['react'] })).toMatchObject({
      applicable: true,
      matchedFrameworks: ['react'],
      reason: 'framework-match',
    });
  });
});

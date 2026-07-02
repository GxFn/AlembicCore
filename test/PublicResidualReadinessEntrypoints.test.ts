import { describe, expect, it } from 'vitest';

import { CapabilityProbe } from '../src/capability.js';
import { EvolutionPolicy } from '../src/evolution.js';
import { runFullResetPolicy } from '../src/host-agent-workflows.js';
import { FieldLevel, UnifiedValidator, V3_FIELD_SPEC } from '../src/knowledge.js';
import { MemoryRepositoryImpl } from '../src/memory.js';
import { GenerateDedup } from '../src/service/bootstrap/index.js';
import {
  FeedbackCollector,
  QualityScorer,
} from '../src/service/knowledge/validation/quality/index.js';
import {
  RecipeCandidateValidator,
  RecipeParser,
} from '../src/service/knowledge/validation/recipe/index.js';

describe('CCIC-5 residual public readiness entrypoints', () => {
  it('exposes residual stable domain contracts through stable facades', () => {
    expect(EvolutionPolicy.resolveInitialStatus('update', 0.7)).toBe('observing');
    expect(V3_FIELD_SPEC.some((field) => field.level === FieldLevel.REQUIRED)).toBe(true);
    expect(UnifiedValidator).toBeTypeOf('function');
    expect(MemoryRepositoryImpl).toBeTypeOf('function');
    expect(runFullResetPolicy).toBeTypeOf('function');
  });

  it('keeps residual service facades provisional while capability uses its stable facade', () => {
    expect(CapabilityProbe).toBeTypeOf('function');
    expect(GenerateDedup).toBeTypeOf('function');
    expect(FeedbackCollector).toBeTypeOf('function');
    expect(QualityScorer).toBeTypeOf('function');
    expect(RecipeCandidateValidator).toBeTypeOf('function');
    expect(RecipeParser).toBeTypeOf('function');
  });
});

import { describe, expect, it } from 'vitest';

import { CapabilityProbe } from '../src/capability.js';
import { CapabilityProbe as LegacyCapabilityProbe } from '../src/core/capability/index.js';
import { EvolutionPolicy } from '../src/evolution.js';
import { runFullResetPolicy } from '../src/host-agent-workflows.js';
import {
  checkRecipeReadiness,
  FieldLevel,
  UnifiedValidator,
  V3_FIELD_SPEC,
} from '../src/knowledge.js';
import { MemoryRepositoryImpl } from '../src/memory.js';
import { BootstrapDedup } from '../src/service/bootstrap/index.js';
import { FeedbackCollector, QualityScorer } from '../src/service/quality/index.js';
import { RecipeCandidateValidator, RecipeParser } from '../src/service/recipe/index.js';

describe('CCIC-5 residual public readiness entrypoints', () => {
  it('exposes residual stable domain contracts through stable facades', () => {
    expect(EvolutionPolicy.resolveInitialStatus('update', 0.7)).toBe('observing');
    expect(V3_FIELD_SPEC.some((field) => field.level === FieldLevel.REQUIRED)).toBe(true);
    expect(UnifiedValidator).toBeTypeOf('function');
    expect(checkRecipeReadiness({}).ready).toBe(false);
    expect(MemoryRepositoryImpl).toBeTypeOf('function');
    expect(runFullResetPolicy).toBeTypeOf('function');
  });

  it('keeps residual service and capability facades provisional but importable', () => {
    // CapabilityProbe 的稳定入口已经收敛到 ./capability；旧 core/capability 只保留迁移兼容。
    expect(CapabilityProbe).toBeTypeOf('function');
    expect(LegacyCapabilityProbe).toBe(CapabilityProbe);
    expect(BootstrapDedup).toBeTypeOf('function');
    expect(FeedbackCollector).toBeTypeOf('function');
    expect(QualityScorer).toBeTypeOf('function');
    expect(RecipeCandidateValidator).toBeTypeOf('function');
    expect(RecipeParser).toBeTypeOf('function');
  });
});

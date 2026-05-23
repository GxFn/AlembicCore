import { describe, expect, it } from 'vitest';

import {
  dimensionTags,
  isKnownDimensionId,
  recipeDimensionIdOrUnknown,
  resolveRecipeDimensionId,
} from '../src/dimensions.js';
import {
  CodeEntityGraph,
  ConfidenceRouter,
  checkRecipeReadiness,
  computeKnowledgeHash,
  getAgentAdapterFieldSpec,
  getExternalAgentRequiredFields,
  isValidTransition,
  KnowledgeEntry,
  KnowledgeFileWriter,
  KnowledgeGraphService,
  KnowledgeService,
  KnowledgeSyncService,
  Lifecycle,
  normalizeLifecycle,
  parseKnowledgeMarkdown,
  RecipeExtractor,
  RecipeProductionGateway,
  rewriteRecipePaths,
  SourceRefReconciler,
  UnifiedValidator,
  V3_FIELD_SPEC,
} from '../src/knowledge.js';

describe('stable knowledge and dimension entrypoints', () => {
  it('exposes dimension ownership helpers through the dimensions facade', () => {
    expect(isKnownDimensionId('architecture')).toBe(true);
    expect(resolveRecipeDimensionId({ dimensionId: 'testing-quality' })).toBe('testing-quality');
    expect(recipeDimensionIdOrUnknown({ category: 'architecture' })).toBe('architecture');
    expect(dimensionTags('error-resilience')).toContain('dimension:error-resilience');
  });

  it('exposes knowledge entity and lifecycle contracts through the knowledge facade', () => {
    const entry = new KnowledgeEntry({
      title: '稳定知识入口',
      description: '通过稳定 facade 暴露知识实体',
    });

    expect(entry.title).toBe('稳定知识入口');
    expect(Lifecycle.ACTIVE).toBe('active');
    expect(normalizeLifecycle('unknown-lifecycle')).toBe(Lifecycle.PENDING);
    expect(isValidTransition(Lifecycle.PENDING, Lifecycle.STAGING)).toBe(true);
  });

  it('exposes field spec, readiness, and validator contracts', () => {
    expect(V3_FIELD_SPEC.length).toBeGreaterThan(0);
    expect(getExternalAgentRequiredFields()).toContain('title');
    expect(Object.keys(getAgentAdapterFieldSpec()).length).toBeGreaterThan(0);

    const readiness = checkRecipeReadiness({ title: 'incomplete' });
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.length).toBeGreaterThan(0);

    expect(new UnifiedValidator()).toBeDefined();
  });

  it('exposes production gateway and knowledge service as stable service contracts', () => {
    expect(RecipeProductionGateway).toBeDefined();
    expect(KnowledgeService).toBeDefined();
  });

  it('exposes high-reference knowledge services through the stable knowledge facade', () => {
    expect(CodeEntityGraph).toBeDefined();
    expect(ConfidenceRouter).toBeDefined();
    expect(KnowledgeFileWriter).toBeDefined();
    expect(KnowledgeGraphService).toBeDefined();
    expect(KnowledgeSyncService).toBeDefined();
    expect(RecipeExtractor).toBeDefined();
    expect(SourceRefReconciler).toBeDefined();
    expect(rewriteRecipePaths).toBeDefined();
    expect(computeKnowledgeHash('stable facade')).toMatch(/^[0-9a-f]+$/);
    expect(parseKnowledgeMarkdown('# Stable facade')).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';

import {
  dimensionTags,
  isKnownDimensionId,
  recipeDimensionIdOrUnknown,
  resolveRecipeDimensionId,
} from '../src/dimensions.js';
import {
  buildProducerStyleGuide,
  CodeEntityGraph,
  ConfidenceRouter,
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
  SUBMIT_REQUIREMENTS,
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

    // W1(2026-07-02):RecipeReadinessChecker 兼容壳已删(外层三仓零消费,
    // UnifiedValidator 是其自述的替代);readiness 语义由 UnifiedValidator 承接。
    expect(new UnifiedValidator()).toBeDefined();
  });

  it('exposes producer StyleGuide contracts through the stable knowledge facade', () => {
    const styleGuide = buildProducerStyleGuide();

    expect(styleGuide).toContain('## 插件适配字段（每个 knowledge 提交必须附带）');
    expect(styleGuide).toContain('trigger 以 @ 开头，kebab-case');
    expect(SUBMIT_REQUIREMENTS).toContain('每个独立的知识点单独提交为一个候选');
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

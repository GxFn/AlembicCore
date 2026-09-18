import { describe, expect, it, vi } from 'vitest';

import {
  assessDiffImpact,
  ConsolidationAdvisor,
  ContentPatcher,
  CurrentGitHeadBaselineProvider,
  createCurrentGitHeadBaselineProvider,
  DecayDetector,
  EnhancementSuggester,
  extractRecipeTokens,
  LifecycleStateMachine,
  ProposalExecutor,
  ProposalGateway,
  RecipeImpactPlanner,
  RedundancyAnalyzer,
  StagingManager,
  tokenizeIdentifiers,
} from '../src/evolution.js';
import { KnowledgeEntry } from '../src/knowledge.js';

describe('stable evolution entrypoint', () => {
  it('exposes high-reference evolution services through the stable evolution facade', () => {
    expect(ConsolidationAdvisor).toBeDefined();
    expect(ContentPatcher).toBeDefined();
    expect(CurrentGitHeadBaselineProvider).toBeDefined();
    expect(createCurrentGitHeadBaselineProvider).toBeDefined();
    expect(DecayDetector).toBeDefined();
    expect(EnhancementSuggester).toBeDefined();
    expect(ProposalGateway).toBeDefined();
    expect(LifecycleStateMachine).toBeDefined();
    expect(ProposalExecutor).toBeDefined();
    expect(RecipeImpactPlanner).toBeDefined();
    expect(RedundancyAnalyzer).toBeDefined();
    expect(StagingManager).toBeDefined();
  });

  it('exposes diff impact helpers and token extraction contracts', () => {
    const recipeTokens = extractRecipeTokens({
      coreCode: 'const stableResult = stableFacade.computeValue(inputValue);',
    });
    const impact = assessDiffImpact(new Set(['stableResult', 'stableFacade']), recipeTokens);

    expect(impact.level).toBe('pattern');
    expect(impact.matchedTokens).toContain('stableResult');
    expect(tokenizeIdentifiers('const stableFacade = true;')).toContain('stableFacade');
  });

  it('reports deprecated references from the real KnowledgeEntry Relations value object', async () => {
    const entry = new KnowledgeEntry({
      id: 'current',
      title: 'Current Recipe',
      lifecycle: 'active',
      relations: {
        depends_on: [{ target: 'retired', description: 'Legacy dependency' }],
        related: ['live'],
        deprecated_by: ['replacement'],
      },
    });
    const retired = new KnowledgeEntry({
      id: 'retired',
      title: 'Retired Recipe',
      lifecycle: 'deprecated',
    });
    const live = new KnowledgeEntry({ id: 'live', title: 'Live Recipe', lifecycle: 'active' });
    const repository = {
      findAllByLifecycles: vi.fn(async () => [entry]),
      findById: vi.fn(async (id: string) =>
        id === retired.id ? retired : id === live.id ? live : null
      ),
    };

    const suggestions = await new EnhancementSuggester(repository as never).analyzeAll();

    expect(suggestions).toEqual([
      expect.objectContaining({
        recipeId: entry.id,
        type: 'deprecated_reference',
        priority: 'high',
        evidence: ['referenced: retired', 'referenced_title: Retired Recipe'],
      }),
    ]);
    expect(repository.findById.mock.calls.map(([id]) => id)).toEqual(['retired', 'live']);
  });
});

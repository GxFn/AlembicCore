import { describe, expect, it } from 'vitest';

import {
  assessDiffImpact,
  ConsolidationAdvisor,
  ContentPatcher,
  CurrentGitHeadBaselineProvider,
  createCurrentGitHeadBaselineProvider,
  DecayDetector,
  EnhancementSuggester,
  EvolutionGateway,
  extractRecipeTokens,
  LifecycleStateMachine,
  ProposalExecutor,
  RecipeImpactPlanner,
  RedundancyAnalyzer,
  StagingManager,
  tokenizeIdentifiers,
} from '../src/evolution.js';

describe('stable evolution entrypoint', () => {
  it('exposes high-reference evolution services through the stable evolution facade', () => {
    expect(ConsolidationAdvisor).toBeDefined();
    expect(ContentPatcher).toBeDefined();
    expect(CurrentGitHeadBaselineProvider).toBeDefined();
    expect(createCurrentGitHeadBaselineProvider).toBeDefined();
    expect(DecayDetector).toBeDefined();
    expect(EnhancementSuggester).toBeDefined();
    expect(EvolutionGateway).toBeDefined();
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
});

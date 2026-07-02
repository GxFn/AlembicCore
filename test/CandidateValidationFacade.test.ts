import { describe, expect, it } from 'vitest';

import { UnifiedValidator } from '../src/domain/knowledge/UnifiedValidator.js';
import { aggregateCandidates } from '../src/service/knowledge/validation/candidate/CandidateAggregator.js';
import { validateCandidatesUnified } from '../src/service/knowledge/validation/candidate/CandidateValidationFacade.js';
import { RecipeCandidateValidator } from '../src/service/knowledge/validation/recipe/RecipeCandidateValidator.js';

const weakCandidate = { title: 'incomplete candidate' };
const richCandidate = {
  title: 'Use dependency injection for services',
  trigger: '@di-services',
  kind: 'pattern',
  category: 'service',
  language: 'typescript',
  content: {
    pattern: 'constructor(private readonly dep: Dep) {}',
    markdown: 'Inject dependencies through the constructor.',
    rationale: 'Keeps services testable and decoupled.',
  },
  reasoning: { whyStandard: 'team convention', confidence: 0.9 },
};

describe('CandidateValidationFacade (CO2 B3)', () => {
  it('returns exactly the composed validators’ results — no enforcement change', () => {
    const facade = validateCandidatesUnified([richCandidate, weakCandidate], {
      skipUniqueness: true,
    });

    const recipeValidator = new RecipeCandidateValidator();
    const unifiedValidator = new UnifiedValidator();
    for (const item of facade.items) {
      expect(item.recipe).toStrictEqual(recipeValidator.validate(item.candidate));
      expect(item.unified).toStrictEqual(
        unifiedValidator.validate(item.candidate, { skipUniqueness: true })
      );
      expect(item.valid).toBe(item.unified.pass && item.recipe.valid);
    }
  });

  it('deduplicates the batch identically to aggregateCandidates', () => {
    const near = { ...richCandidate, title: 'Use dependency injection for service' };
    const direct = aggregateCandidates([richCandidate, near] as never);
    const facade = validateCandidatesUnified([richCandidate, near], { skipUniqueness: true });

    expect(facade.items.map((item) => item.candidate)).toStrictEqual(direct.items);
    expect(facade.duplicates).toStrictEqual(direct.duplicates);
  });

  it('fails a weak candidate through every composed validator', () => {
    const facade = validateCandidatesUnified([weakCandidate], { skipUniqueness: true });

    expect(facade.items).toHaveLength(1);
    expect(facade.items[0].valid).toBe(false);
    expect(facade.items[0].recipe.valid).toBe(false);
    expect(facade.items[0].unified.pass).toBe(false);
  });
});

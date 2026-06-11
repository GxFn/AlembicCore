/**
 * CO4 E2 — service/candidate floor suite.
 *
 * Real-behavior tests for aggregateCandidates (title dedup thresholds,
 * ordering, edge inputs) and validateCandidatesUnified (options
 * propagation, stateful cross-batch uniqueness, AND-composition).
 */

import { UnifiedValidator } from '../src/domain/knowledge/UnifiedValidator.js';
import { aggregateCandidates } from '../src/service/candidate/CandidateAggregator.js';
import { validateCandidatesUnified } from '../src/service/candidate/CandidateValidationFacade.js';

function strongCandidate(overrides: Record<string, unknown> = {}) {
  const markdown = [
    'Use the shared transaction helper for multi-step writes so partial failures roll back.',
    '',
    '```ts',
    'db.transaction(() => {',
    '  repo.write(a);',
    '  repo.write(b);',
    '});',
    '```',
    '',
    '(来源: RepositoryBase.ts:42) Multi-step repository writes must be atomic so the',
    'knowledge index never observes a half-applied batch. The helper owns retry and',
    'rollback semantics; call sites only describe the writes.',
  ].join('\n');
  return {
    title: 'Repository transaction wrapper',
    description: '多步仓储写入统一走事务助手，保证半批次失败可回滚。',
    trigger: '@repo-transaction',
    kind: 'pattern',
    category: 'architecture',
    language: 'typescript',
    knowledgeType: 'code-pattern',
    usageGuide: 'Wrap multi-step repository writes in a transaction helper.',
    whenClause: 'When a service performs more than one repository write in a single operation.',
    doClause: 'Wrap every multi-step repository write in the shared transaction helper.',
    dontClause: 'Do not issue sequential bare writes that can fail half-way.',
    coreCode: 'db.transaction(() => {\n  repo.write(a);\n  repo.write(b);\n});',
    headers: [],
    content: {
      pattern: 'db.transaction(() => { repo.write(a); repo.write(b); });',
      markdown,
      rationale: 'Partial writes corrupt the knowledge index.',
    },
    reasoning: {
      whyStandard: 'All repository writes in this codebase go through the helper.',
      sources: ['src/repository/base/RepositoryBase.ts:42'],
      confidence: 0.9,
    },
    ...overrides,
  };
}

describe('aggregateCandidates', () => {
  test('returns empty result for empty or non-array input', () => {
    expect(aggregateCandidates([])).toEqual({ items: [], duplicates: [] });
    expect(aggregateCandidates(null as never)).toEqual({ items: [], duplicates: [] });
  });

  test('near-identical titles dedup to the first occurrence with duplicateOf set', () => {
    const result = aggregateCandidates([
      { title: 'Singleton pattern for services', code: 'a' },
      { title: 'Singleton pattern for services!', code: 'b' },
      { title: 'Completely different networking retry topic', code: 'c' },
    ]);
    expect(result.items.map((item) => item.title)).toEqual([
      'Singleton pattern for services',
      'Completely different networking retry topic',
    ]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].duplicateOf).toBe('Singleton pattern for services');
    expect(result.duplicates[0].item.code).toBe('b');
  });

  test('threshold=1 only removes exact-token matches; low threshold removes near matches', () => {
    const items = [
      { title: 'Cache invalidation strategy', code: 'a' },
      { title: 'Cache invalidation strategies', code: 'b' },
    ];
    const strict = aggregateCandidates(items, { threshold: 1 });
    expect(strict.items).toHaveLength(2);

    const loose = aggregateCandidates(items, { threshold: 0.5 });
    expect(loose.items).toHaveLength(1);
  });

  test('kept items preserve input order and are not mutated', () => {
    const original = { title: 'Alpha topic one', code: 'x', extra: { nested: true } };
    const result = aggregateCandidates([
      original,
      { title: 'Beta topic two', code: 'y' },
      { title: 'Gamma topic three', code: 'z' },
    ]);
    expect(result.items.map((item) => item.title)).toEqual([
      'Alpha topic one',
      'Beta topic two',
      'Gamma topic three',
    ]);
    expect(result.items[0]).toBe(original);
    expect(result.items[0].extra).toEqual({ nested: true });
  });

  test('untitled candidates are never treated as similar (empty token sets)', () => {
    const result = aggregateCandidates([
      { title: '', code: 'first' },
      { title: '', code: 'second' },
    ]);
    // Jaccard over two empty token sets is 0, so both survive dedup.
    expect(result.items).toHaveLength(2);
    expect(result.duplicates).toEqual([]);
  });
});

describe('validateCandidatesUnified', () => {
  test('a strong candidate passes both validators with valid=true', () => {
    const result = validateCandidatesUnified([strongCandidate()], { skipUniqueness: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].unified.pass).toBe(true);
    expect(result.items[0].recipe.valid).toBe(true);
    expect(result.items[0].valid).toBe(true);
  });

  test('valid is the AND of both validators (recipe failure flips it)', () => {
    const missingRationale = strongCandidate({
      content: {
        pattern: 'code',
        markdown: 'Long enough markdown body for the quality layer. '.repeat(6),
        // no rationale → RecipeCandidateValidator error
      },
    });
    const result = validateCandidatesUnified([missingRationale], { skipUniqueness: true });
    expect(result.items[0].recipe.valid).toBe(false);
    expect(result.items[0].valid).toBe(false);
  });

  test('aggregateThreshold option propagates to the dedup stage', () => {
    const candidates = [
      strongCandidate({ title: 'Cache invalidation strategy' }),
      strongCandidate({ title: 'Cache invalidation strategies' }),
    ];
    const strict = validateCandidatesUnified(candidates, {
      aggregateThreshold: 1,
      skipUniqueness: true,
    });
    expect(strict.items).toHaveLength(2);

    const loose = validateCandidatesUnified(candidates, {
      aggregateThreshold: 0.5,
      skipUniqueness: true,
    });
    expect(loose.items).toHaveLength(1);
    expect(loose.duplicates).toHaveLength(1);
  });

  test('a shared UnifiedValidator enforces cross-batch uniqueness statefully', () => {
    const validator = new UnifiedValidator();
    const first = validateCandidatesUnified([strongCandidate()], {
      unifiedValidator: validator,
    });
    expect(first.items[0].unified.pass).toBe(true);
    validator.recordSubmission(
      'Repository transaction wrapper',
      'db.transaction(() => { repo.write(a); repo.write(b); });',
      '@repo-transaction'
    );

    const second = validateCandidatesUnified([strongCandidate()], {
      unifiedValidator: validator,
    });
    expect(second.items[0].unified.pass).toBe(false);
    expect(second.items[0].unified.errors.join('\n')).toMatch(/title|trigger|重复|duplicate/i);
  });

  test('skipUniqueness bypasses the cross-batch layer for the same duplicate', () => {
    const validator = new UnifiedValidator();
    validator.recordSubmission('Repository transaction wrapper', undefined, '@repo-transaction');

    const result = validateCandidatesUnified([strongCandidate()], {
      unifiedValidator: validator,
      skipUniqueness: true,
    });
    expect(result.items[0].unified.pass).toBe(true);
  });

  test('null/empty candidate batches return empty results without throwing', () => {
    expect(validateCandidatesUnified([])).toEqual({ items: [], duplicates: [] });
    expect(validateCandidatesUnified(null as never)).toEqual({ items: [], duplicates: [] });
  });

  test('validator outputs are preserved verbatim (no filtering or re-ordering)', () => {
    const weak = { title: 'x' };
    const result = validateCandidatesUnified([weak], { skipUniqueness: true });
    expect(result.items[0].unified.pass).toBe(false);
    expect(result.items[0].unified.errors.length).toBeGreaterThan(0);
    expect(result.items[0].recipe.errors.length).toBeGreaterThan(0);
    expect(result.items[0].candidate).toBe(weak);
  });
});

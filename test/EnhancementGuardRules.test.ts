// RIC-2a / R1 — resolveEnhancementGuardRules on the @alembic/core/guard facade.
// Verifies it surfaces enhancement-pack Guard rules (so outer repos drop the
// @alembic/core/core/enhancement import), degrades to [] before registry init,
// and matches the registry's own resolve/all output.

import { describe, expect, it } from 'vitest';
import { getEnhancementRegistry, initEnhancementRegistry } from '../src/core/enhancement/index.js';
import { resolveEnhancementGuardRules } from '../src/guard.js';

describe('resolveEnhancementGuardRules (RIC-2a/R1, @alembic/core/guard)', () => {
  it('returns [] before the enhancement registry is initialized', () => {
    // Fresh module singleton in this test file: registry is empty until init.
    expect(resolveEnhancementGuardRules()).toEqual([]);
  });

  it('equals registry.all().flatMap(getGuardRules) after init, with valid shape', async () => {
    await initEnhancementRegistry();
    const registry = getEnhancementRegistry();
    expect(registry.all().length).toBeGreaterThan(0); // packs loaded

    const expected = registry.all().flatMap((pack) => pack.getGuardRules());
    const actual = resolveEnhancementGuardRules();
    expect(actual).toEqual(expected);

    for (const rule of actual) {
      expect(typeof rule.ruleId).toBe('string');
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(typeof rule.message).toBe('string');
    }
  });

  it('filters through the registry resolver by language/frameworks', async () => {
    await initEnhancementRegistry();
    const registry = getEnhancementRegistry();

    const expected = registry
      .resolve('typescript', ['react'])
      .flatMap((pack) => pack.getGuardRules());
    expect(resolveEnhancementGuardRules({ frameworks: ['react'], language: 'typescript' })).toEqual(
      expected
    );

    // An unknown language matches no pack -> no rules.
    expect(resolveEnhancementGuardRules({ language: '__no_such_language__' })).toEqual([]);
  });
});

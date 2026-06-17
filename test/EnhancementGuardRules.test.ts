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
    expect(resolveEnhancementGuardRules({ frameworkAgnostic: true })).toEqual([]);
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

  it('frameworkAgnostic returns generic-only (no-framework-condition) pack rules (RIC-2a-2)', async () => {
    await initEnhancementRegistry();
    const registry = getEnhancementRegistry();

    // Semantic equivalence to the Plugin guard handler's generic-only filter
    // (all().filter((p) => !p.conditions?.frameworks?.length)).
    const agnosticPacks = registry.all().filter((pack) => !pack.conditions?.frameworks?.length);
    const expected = agnosticPacks.flatMap((pack) => pack.getGuardRules());
    expect(resolveEnhancementGuardRules({ frameworkAgnostic: true })).toEqual(expected);

    // Every contributing pack is genuinely framework-agnostic (vacuously true when
    // none qualify — the current pack set is entirely framework-conditioned, so
    // generic-only currently yields [], identical to the Plugin handler today).
    for (const pack of agnosticPacks) {
      expect(pack.conditions?.frameworks?.length ?? 0).toBe(0);
    }

    // The filter is meaningful: there ARE framework-conditioned packs, so
    // generic-only genuinely excludes packs rather than mirroring all().
    const conditioned = registry
      .all()
      .filter((pack) => (pack.conditions?.frameworks?.length ?? 0) > 0);
    expect(conditioned.length).toBeGreaterThan(0);

    // frameworkAgnostic takes precedence over the resolver (ignores language/frameworks).
    expect(
      resolveEnhancementGuardRules({
        frameworkAgnostic: true,
        frameworks: ['react'],
        language: 'typescript',
      })
    ).toEqual(expected);

    // Generic-only rules are a subset of the all-packs rules.
    expect(resolveEnhancementGuardRules({ frameworkAgnostic: true }).length).toBeLessThanOrEqual(
      resolveEnhancementGuardRules().length
    );
  });
});

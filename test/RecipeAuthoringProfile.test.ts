/**
 * P1.4a — RecipeAuthoringSpec context-profile axis (§12.3).
 *
 * cold-start is the DEFAULT and byte-identical to the full gate (proven globally by the existing
 * P1 corpus + stage-3 byte-identical + drift suites, which all call validateAgainst without a
 * profile). Here we prove the axis directly:
 *   - cold-start == omitting profile (zero change),
 *   - opportunistic == cold-start MINUS exactly {INSUFFICIENT_EVIDENCE (3-distinct-files floor),
 *     SESSION_NOT_FOUND (session-scope)} — every content gate + the cheap grounding (sourceRef line
 *     format, snippet match) still fire,
 *   - resolveAuthoringProfile mirrors the live shouldRunRecipeEvidenceGate decision,
 *   - renderGuidance(profile) drops exactly the rules the opportunistic gate skips (guidance==gate).
 */
import { describe, expect, it } from 'vitest';
import type { RecipeSessionScope, RecipeSourceRefResolver } from '../src/knowledge.js';
import { renderGuidance, resolveAuthoringProfile, validateAgainst } from '../src/knowledge.js';

// fs port: resolve any well-formed ref to its (single) sourcePath so the cold-start floor is reachable.
const resolver: RecipeSourceRefResolver = ({ sourcePath, sourceRef }) => ({
  evidence: {
    sourcePath,
    rangeText: 'const x = 1;',
    filePath: `/abs/${sourcePath}`,
    raw: sourceRef,
  },
});
// session port: always reports a missing bootstrap session (cold-start fires it; opportunistic skips).
const failingScope: RecipeSessionScope = ({ itemIndex, title }) => ({
  violation: {
    code: 'SESSION_NOT_FOUND',
    itemIndex,
    title,
    message: 'no bootstrap session',
    nextAction: 'start a bootstrap session',
  },
});

describe('RecipeAuthoringSpec profile axis — cold-start default is unchanged', () => {
  it('cold-start equals omitting the profile (zero change)', () => {
    const items = [
      { kind: 'rule', title: 'Parity', sourceRefs: ['src/a.ts:1-2'], doClause: 'broken clause' },
    ];
    const base = {
      path: 'in-process' as const,
      stage: 'all' as const,
      sourceRefResolver: resolver,
      sessionScope: failingScope,
      projectRoot: '/x',
    };
    const withDefault = validateAgainst(items, base);
    const withColdStart = validateAgainst(items, { ...base, profile: 'cold-start' });
    expect(withColdStart).toEqual(withDefault);
    // cold-start really runs the floor + session-scope
    expect(withDefault.some((v) => v.code === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(withDefault.some((v) => v.code === 'SESSION_NOT_FOUND')).toBe(true);
  });
});

describe('RecipeAuthoringSpec profile axis — opportunistic drops ONLY floor + session-scope', () => {
  const combo = {
    kind: 'rule',
    title: 'Combo',
    doClause: 'broken clause without imperative verb', // content gate → DO_CLAUSE_NON_IMPERATIVE
    // dontClause missing → DONT_CLAUSE_REQUIRED
    content: { markdown: 'no contrast markers' }, // → CONTENT_CONTRAST_MISSING + STAGE3_MARKDOWN_TOO_SHORT
    sourceRefs: ['src/a.ts:1-2'], // resolves to 1 distinct file → rule floor (3) fires (cold-start only)
  };
  const opts = (profile: 'cold-start' | 'opportunistic') => ({
    path: 'in-process' as const,
    stage: 'all' as const,
    sourceRefResolver: resolver,
    sessionScope: failingScope,
    projectRoot: '/x',
    profile,
  });

  it('opportunistic == cold-start minus exactly the two declared drops', () => {
    const cold = validateAgainst([combo], opts('cold-start'));
    const opp = validateAgainst([combo], opts('opportunistic'));
    const DROPPED = new Set(['INSUFFICIENT_EVIDENCE', 'SESSION_NOT_FOUND']);
    expect(opp).toEqual(cold.filter((v) => !DROPPED.has(v.code)));

    // cold-start emits both drops
    expect(cold.some((v) => v.code === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(cold.some((v) => v.code === 'SESSION_NOT_FOUND')).toBe(true);
    // opportunistic drops exactly those two
    expect(opp.some((v) => v.code === 'INSUFFICIENT_EVIDENCE')).toBe(false);
    expect(opp.some((v) => v.code === 'SESSION_NOT_FOUND')).toBe(false);
    // but keeps every content gate + stage-3 field gate
    expect(opp.some((v) => v.code === 'DO_CLAUSE_NON_IMPERATIVE')).toBe(true);
    expect(opp.some((v) => v.code === 'DONT_CLAUSE_REQUIRED')).toBe(true);
    expect(opp.some((v) => v.code === 'CONTENT_CONTRAST_MISSING')).toBe(true);
    expect(opp.some((v) => v.code === 'STAGE3_MARKDOWN_TOO_SHORT')).toBe(true);
  });

  it('opportunistic keeps the cheap grounding (sourceRef line format)', () => {
    const item = { kind: 'fact', title: 'Ground', sourceRefs: ['src/a.ts'] }; // no line → SOURCE_REF_LINE_MISSING
    const cold = validateAgainst([item], { path: 'in-process', stage: 2, profile: 'cold-start' });
    const opp = validateAgainst([item], { path: 'in-process', stage: 2, profile: 'opportunistic' });
    expect(opp.some((v) => v.code === 'SOURCE_REF_LINE_MISSING')).toBe(true);
    // no floor/session injected here, so dropping nothing → identical
    expect(opp).toEqual(cold);
  });
});

describe('RecipeAuthoringSpec profile axis — selector + guidance', () => {
  it('resolveAuthoringProfile mirrors shouldRunRecipeEvidenceGate', () => {
    expect(resolveAuthoringProfile({ session: { id: 's' } })).toBe('cold-start');
    expect(resolveAuthoringProfile({ args: { sessionId: 's' } })).toBe('cold-start');
    expect(resolveAuthoringProfile({ args: { bootstrapSessionRef: 'r' } })).toBe('cold-start');
    expect(resolveAuthoringProfile({ args: { requireProductionSession: true } })).toBe(
      'cold-start'
    );
    expect(resolveAuthoringProfile({ args: { dimensionId: 'architecture' } })).toBe('cold-start');
    expect(resolveAuthoringProfile({ items: [{ dimensionId: 'architecture' }] })).toBe(
      'cold-start'
    );
    // opportunistic when no session/dimension signal
    expect(resolveAuthoringProfile({})).toBe('opportunistic');
    expect(resolveAuthoringProfile({ args: {}, items: [{}] })).toBe('opportunistic');
    expect(resolveAuthoringProfile({ args: { requireProductionSession: false } })).toBe(
      'opportunistic'
    );
  });

  it('renderGuidance(profile) drops exactly the rules the opportunistic gate skips', () => {
    const cold = renderGuidance('host-cold-start');
    const opp = renderGuidance('in-process', undefined, 'opportunistic');
    expect(cold.profile).toBe('cold-start');
    expect(opp.profile).toBe('opportunistic');

    // cold-start renders the full bar
    expect(cold.text).toContain('证据下限');
    expect(cold.rules.some((r) => r.id === 'evidence-floor')).toBe(true);
    expect(cold.rules.some((r) => r.id === 'session-scope')).toBe(true);

    // opportunistic drops floor + session-scope from BOTH rules and text
    expect(opp.text).not.toContain('证据下限');
    expect(opp.rules.some((r) => r.id === 'evidence-floor')).toBe(false);
    expect(opp.rules.some((r) => r.id === 'session-scope')).toBe(false);
    // but keeps content gates + the verb allowlist
    expect(opp.rules.some((r) => r.id === 'clause-imperative')).toBe(true);
    expect(opp.rules.some((r) => r.id === 'content-contrast')).toBe(true);
    expect(opp.text).toContain('共 45 个');
  });
});

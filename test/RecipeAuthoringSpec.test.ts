/**
 * P0.1–P0.6 — RecipeAuthoringSpec module shape + the guidance==gate guarantee.
 *
 * Asserts the A.3 public API is reachable through the stable `@alembic/core/knowledge` facade,
 * that the lifted stage-1 predicates fire byte-identically (same reject codes), and — the load-
 * bearing invariant — that `validateAgainst` (enforcement) and `renderGuidance` (guidance) read the
 * SAME `gateRules()` table, so guidance can never drift from the gate. The verb count is DERIVED
 * from the live allowlist, not hardcoded as 45 in an assertion of the count alone.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPreSubmitChecklist,
  buildSubmissionSpec,
  buildSubmitKnowledgeContract,
  contentContract,
  describeSubmitToolFields,
  example,
  failureModes,
  gateRule,
  gateRules,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
  renderGuidance,
  validateAgainst,
} from '../src/knowledge.js';

describe('RecipeAuthoringSpec — A.3 API reachable through the knowledge facade', () => {
  it('exposes the full A.3 surface as callable functions', () => {
    for (const fn of [
      validateAgainst,
      gateRule,
      gateRules,
      renderGuidance,
      buildSubmissionSpec,
      buildSubmitKnowledgeContract,
      buildPreSubmitChecklist,
      describeSubmitToolFields,
      getImperativeVerbAllowlist,
      getEvidenceFloorPolicy,
      contentContract,
      example,
      failureModes,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('gateRules() is one table, filterable by stage; gateRule(id) resolves a rule', () => {
    const all = gateRules();
    expect(all.length).toBeGreaterThan(0);
    expect(gateRules(1).every((r) => r.stage === 1)).toBe(true);
    expect(gateRules(2).every((r) => r.stage === 2)).toBe(true);
    expect(gateRules(3).every((r) => r.stage === 3)).toBe(true);
    expect(gateRules(1).length + gateRules(2).length + gateRules(3).length).toBe(all.length);
    expect(gateRule('clause-imperative').stage).toBe(1);
    expect(() => gateRule('no-such-rule')).toThrow();
  });
});

describe('RecipeAuthoringSpec — lifted stage-1 predicates fire byte-identically', () => {
  const ITEM_PATH = { path: 'host-cold-start' as const, stage: 1 as const };

  it('rejects a missing / non-English / non-imperative doClause and a missing ✅❌ contrast', () => {
    const missing = validateAgainst([{ dontClause: 'Do not x.' }], ITEM_PATH);
    expect(missing.some((v) => v.code === 'DO_CLAUSE_REQUIRED')).toBe(true);

    const nonEnglish = validateAgainst(
      [{ doClause: '使用仓库软删除', dontClause: 'Do not call delete.' }],
      ITEM_PATH
    );
    expect(nonEnglish.some((v) => v.code === 'DO_CLAUSE_NON_ENGLISH')).toBe(true);

    const nonImperative = validateAgainst(
      [{ doClause: 'The repository handles deletes.', dontClause: 'Do not call delete.' }],
      ITEM_PATH
    );
    expect(nonImperative.some((v) => v.code === 'DO_CLAUSE_NON_IMPERATIVE')).toBe(true);

    const noContrast = validateAgainst(
      [
        {
          doClause: 'Use softDelete().',
          dontClause: 'Do not call delete.',
          content: { markdown: 'some guidance without the markers' },
        },
      ],
      ITEM_PATH
    );
    expect(noContrast.some((v) => v.code === 'CONTENT_CONTRAST_MISSING')).toBe(true);
  });

  it('passes the shipped worked example through the stage-1 gate (gate-passing, not an anti-example)', () => {
    const worked = example('typescript');
    const violations = validateAgainst([worked.candidate], ITEM_PATH);
    expect(violations).toEqual([]);
  });

  it('keeps stage-2 fs-bound checks behind the injected port (pure run skips them)', () => {
    // No sourceRefResolver injected → only the pure SOURCE_REFS_MISSING fires, never fs codes.
    const pure = validateAgainst([{ title: 'x', kind: 'rule' }], {
      path: 'host-cold-start',
      stage: 2,
    });
    expect(pure.some((v) => v.code === 'SOURCE_REFS_MISSING')).toBe(true);
    expect(pure.some((v) => v.code === 'SOURCE_REF_NOT_FOUND')).toBe(false);
    expect(pure.some((v) => v.code === 'SOURCE_REF_INVALID')).toBe(false);
  });
});

describe('RecipeAuthoringSpec — guidance == gate (one shared table)', () => {
  it('derives the imperative verb allowlist from the live Set (45 positive)', () => {
    const allow = getImperativeVerbAllowlist();
    expect(new Set(allow.positive).size).toBe(allow.positive.length); // no dup
    expect(allow.positive.length).toBe(45);
    expect(allow.negative.length).toBe(12);
  });

  it('renderGuidance projects the SAME gateRules() guidance the gate enforces', () => {
    const block = renderGuidance('host-cold-start');
    const ruleText = new Map(gateRules().map((r) => [r.id, r.guidanceText]));
    // every rendered rule row is byte-equal to its gateRules() source (no hand-copied constant)
    for (const row of block.rules) {
      expect(row.guidance).toBe(ruleText.get(row.id));
    }
    // the rendered verb list is the live allowlist, and the text states the derived count
    expect(block.imperativeVerbs.positive.length).toBe(45);
    expect(block.text).toContain('共 45 个');
    // the evidence floor in guidance equals the policy the gate honors
    expect(block.evidenceFloor.ruleFiles).toBe(3);
    expect(block.evidenceFloor.factFiles).toBe(1);
  });

  it('exposes the content contract + the QualityScorer doc targets', () => {
    const contract = contentContract();
    expect(contract.styleGuide).toContain('「项目特写」');
    expect(contract.docScoreTargets.markdownLength.optimalLen).toBe(800);
    expect(contract.docScoreTargets.markdownLength.weight).toBe(0.3);
  });

  it('evidence-floor policy is {ruleFiles:3, factFiles:1, scopeEscape: RegExp}', () => {
    const floor = getEvidenceFloorPolicy();
    expect(floor.ruleFiles).toBe(3);
    expect(floor.factFiles).toBe(1);
    expect(floor.scopeEscape).toBeInstanceOf(RegExp);
    expect(floor.scopeEscape.test('file-local')).toBe(true);
  });

  it('failureModes() maps every gate reject code to avoidance from the same table', () => {
    const modes = failureModes();
    const codes = new Set(modes.map((m) => m.code));
    expect(codes.has('DO_CLAUSE_NON_IMPERATIVE')).toBe(true);
    expect(codes.has('INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(modes.every((m) => m.avoidance.length > 0)).toBe(true);
  });

  it('collapses the parallel submission builders (minCandidates floor = 3) and one checklist', () => {
    const spec = buildSubmissionSpec('architecture');
    expect(spec.minCandidates).toBe(3);
    expect(spec.requiredFields).toContain('title');
    expect(buildPreSubmitChecklist().length).toBe(gateRules().length);

    const contract = buildSubmitKnowledgeContract();
    expect(contract.imperativeVerbs.positive.length).toBe(45);
    expect(typeof describeSubmitToolFields().title).toBe('string');
  });
});

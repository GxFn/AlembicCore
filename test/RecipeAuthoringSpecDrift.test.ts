/**
 * A.6 drift / no-relaxation suite for RecipeAuthoringSpec — guidance == gate, by construction.
 *
 * Read through the stable `@alembic/core/knowledge` facade — the same surface guidance + the gates
 * read. Every assertion reads the ONE gateRules() table (and its derived getters), so guidance and
 * gate stay two projections of a single source. If a parity assertion ever fails, the fix is to the
 * GUIDANCE wording — never the gate (the gates are byte-identical from P1; no gate file is touched
 * by this suite).
 *
 * Coverage:
 *   #1 allowlist parity   — rendered doClause guidance lists EXACTLY the imperative-verb allowlist.
 *   #2 marker parity      — guidance states both-markers + ≥4-char rule; the worked example passes.
 *   #3 evidence-floor      — getEvidenceFloorPolicy {3,1,scope} == the rendered floor + scope-escape.
 *   #4 markdown floor + required-field list are single-sourced.
 *   #6 no-relaxation snapshot of the lifted constants (verbs, thresholds, regex source/flags).
 *   #7 matrix parity      — the module reject codes are all present in the checked-in matrix.
 *   D-A confidence         — the gate exposes NO confidence-floor predicate; guidance claims none.
 *   §12.5 path-parity      — host-cold-start vs in-process produce byte-identical verdicts.
 *
 * The standing siblings: #5 example self-consistency lives in
 * RecipeAuthoringSpecExamplesGatePassing.test.ts; the live gate-file round-trip lives in
 * RecipeGateEnforcementMatrix.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { RecipeSessionScope, RecipeSourceRefResolver } from '../src/knowledge.js';
import {
  gateRules,
  getAllRequiredFieldNames,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
  getStage3FieldPolicy,
  renderGuidance,
  validateAgainst,
} from '../src/knowledge.js';
import matrix from './fixtures/recipe-gate-enforcement-matrix.json' with { type: 'json' };

describe('RecipeAuthoringSpec gate-constants drift snapshot (A.6 #4/#6)', () => {
  it('#4 stage-3 markdown floor + required-field list are the single source', () => {
    expect(getStage3FieldPolicy().markdownFloor).toBe(200);
    // 19 REQUIRED fields (incl. nested), in V3_FIELD_SPEC order — the floor's required-field peers.
    expect(getAllRequiredFieldNames()).toEqual([
      'title',
      'content',
      'content.markdown',
      'content.rationale',
      'description',
      'trigger',
      'kind',
      'doClause',
      'dontClause',
      'whenClause',
      'coreCode',
      'category',
      'headers',
      'reasoning',
      'reasoning.whyStandard',
      'reasoning.sources',
      'knowledgeType',
      'language',
      'usageGuide',
    ]);
  });

  it('#6 stage-3 field-gate constants snapshot (regex source+flags frozen)', () => {
    const p = getStage3FieldPolicy();
    expect({
      markdownFloor: p.markdownFloor,
      codeBlockRe: { source: p.codeBlockRe.source, flags: p.codeBlockRe.flags },
      fileRefRe: { source: p.fileRefRe.source, flags: p.fileRefRe.flags },
      genericTitleRe: { source: p.genericTitleRe.source, flags: p.genericTitleRe.flags },
      incompleteCoreCodeFirstChars: [...p.incompleteCoreCodeFirstChars].sort(),
      codeFingerprintFloor: p.codeFingerprintFloor,
      patternFloor: p.patternFloor,
    }).toEqual({
      markdownFloor: 200,
      codeBlockRe: { source: '```[\\s\\S]*?```', flags: '' },
      fileRefRe: { source: '\\.\\w{1,10}(:\\d+)?', flags: '' },
      genericTitleRe: {
        source: '^(Singleton|Factory|Observer|MVC|MVVM) (pattern|模式)$',
        flags: 'i',
      },
      incompleteCoreCodeFirstChars: [')', ']', '}'],
      codeFingerprintFloor: 20,
      patternFloor: 30,
    });
  });

  it('#6 stage-1 verb allowlist + stage-2 evidence floor snapshot', () => {
    const verbs = getImperativeVerbAllowlist();
    expect(verbs.positive.length).toBe(45);
    expect(verbs.negative.length).toBe(12);
    // anchor a few members so a silent set edit is caught
    expect(verbs.positive).toContain('validate');
    expect(verbs.negative).toContain('avoid');

    const floor = getEvidenceFloorPolicy();
    expect({
      ruleFiles: floor.ruleFiles,
      factFiles: floor.factFiles,
      scopeEscape: floor.scopeEscape.source,
    }).toEqual({
      ruleFiles: 3,
      factFiles: 1,
      scopeEscape: '\\b(single-file|file-local|local-only|narrow)\\b',
    });
  });
});

describe('RecipeAuthoringSpec guidance == gate parity (A.6 #1/#2/#3/#7 + D-A)', () => {
  it('#1 allowlist parity: rendered doClause guidance lists EXACTLY the verb allowlist', () => {
    const verbs = getImperativeVerbAllowlist();
    const block = renderGuidance('host-cold-start');
    // the rendered block carries the same allowlist the stage-1 gate enforces (one source)
    expect(block.imperativeVerbs.positive).toEqual(verbs.positive);
    expect(block.imperativeVerbs.negative).toEqual(verbs.negative);
    // the rendered TEXT lists exactly those verbs (the full join) + the DERIVED count, never "verb-led"
    expect(block.text).toContain(verbs.positive.join(', '));
    expect(block.text).toContain(`共 ${verbs.positive.length} 个`);
    // oracle (evidence/p0-gate-truth-matrix-2026-06-30.md): 45 positive, 12 negative
    expect(verbs.positive.length).toBe(45);
    expect(verbs.negative.length).toBe(12);
  });

  it('#2 marker parity: guidance states both-markers + ≥4 rule; the worked example passes stage 1', () => {
    const contrast = gateRules(1).find((rule) => rule.id === 'content-contrast');
    expect(contrast).toBeDefined();
    // the gate rule's guidance states BOTH markers + the ≥4-non-space-char floor (threshold 4)
    expect(contrast?.guidanceText).toContain('✅');
    expect(contrast?.guidanceText).toContain('❌');
    expect(contrast?.guidanceText).toContain('≥4');
    // the rendered guidance surfaces that exact rule string (guidance == gate)
    const block = renderGuidance('host-cold-start');
    expect(block.text).toContain(contrast?.guidanceText ?? '<missing>');
    // property: the guidance's OWN worked-example markdown passes the stage-1 content gate
    expect(
      validateAgainst([block.example.candidate], { path: 'host-cold-start', stage: 1 })
    ).toEqual([]);
  });

  it('#3 evidence-floor parity: policy {3,1,scope} == the rendered floor + scope-escape', () => {
    const floor = getEvidenceFloorPolicy();
    expect({ ruleFiles: floor.ruleFiles, factFiles: floor.factFiles }).toEqual({
      ruleFiles: 3,
      factFiles: 1,
    });
    const block = renderGuidance('host-cold-start');
    // the rendered guidance states the ≥3 / ≥1 floor AND the scope-escape the gate honors
    expect(block.text).toContain(`≥${floor.ruleFiles}`);
    expect(block.text).toContain(`≥${floor.factFiles}`);
    expect(block.text).toContain(floor.scopeEscape.source);
    expect(floor.scopeEscape.test('file-local')).toBe(true);
    expect(floor.scopeEscape.test('narrow')).toBe(true);
  });

  it('#7 matrix parity: module reject codes are all present in the checked-in matrix', () => {
    const mx = matrix as unknown as {
      stage1: { codes: Record<string, unknown> };
      stage2: { codes: Record<string, unknown> };
      stage3: { rules: Record<string, unknown> };
    };
    const matrixCodes = {
      1: new Set(Object.keys(mx.stage1.codes)),
      2: new Set(Object.keys(mx.stage2.codes)),
      3: new Set(Object.keys(mx.stage3.rules)),
    } as const;
    for (const stage of [1, 2, 3] as const) {
      for (const code of gateRules(stage).flatMap((rule) => rule.rejectCodes)) {
        expect(matrixCodes[stage].has(code), `${code} (stage ${stage}) missing from matrix`).toBe(
          true
        );
      }
    }
    // stage-1 is an EXACT match (the module emits every stage-1 code the matrix lists)
    expect([...new Set(gateRules(1).flatMap((r) => r.rejectCodes))].sort()).toEqual(
      [...matrixCodes[1]].sort()
    );
    // the layered matrix counts stay frozen so the layered-not-duplicated matrix can never reopen
    expect(matrixCodes[1].size).toBe(8);
    expect(matrixCodes[2].size).toBe(19);
    expect(matrixCodes[3].size).toBe(11);
  });

  it('D-A: the gate exposes NO confidence-floor predicate; guidance claims no hard floor', () => {
    // confidence is RECOMMENDED, never enforced — no gate rule emits a confidence reject code
    const allCodes = gateRules().flatMap((rule) => rule.rejectCodes);
    expect(allCodes.some((code) => /confidence/i.test(code))).toBe(false);
    // and the rendered module guidance does not re-inflate a fake hard confidence floor
    expect(/confidence/i.test(renderGuidance('host-cold-start').text)).toBe(false);
  });
});

describe('RecipeAuthoringSpec §12.5 path-parity tripwire (host vs in-process face the same bar)', () => {
  // FIXED ports — every source ref resolves to its single file; the session is always missing.
  const resolver: RecipeSourceRefResolver = ({ sourcePath, sourceRef }) => ({
    evidence: {
      sourcePath,
      rangeText: 'const x = 1;',
      filePath: `/abs/${sourcePath}`,
      raw: sourceRef,
    },
  });
  const sessionScope: RecipeSessionScope = ({ itemIndex, title }) => ({
    violation: {
      code: 'SESSION_NOT_FOUND',
      itemIndex,
      title,
      message: 'no bootstrap session',
      nextAction: 'start a bootstrap session',
    },
  });
  // a small corpus that exercises stage 1 (content), stage 2 (floor/session/grounding), stage 3.
  const corpus: Array<Record<string, unknown>> = [
    { kind: 'rule', title: 'Parity A', sourceRefs: ['a/b.ts:1-2'], doClause: 'broken clause' },
    { kind: 'fact', title: 'Parity B', sourceRefs: ['c/d.ts'] },
    {
      kind: 'rule',
      title: 'Parity C',
      doClause: 'Use the shared client',
      dontClause: 'Do not inline a client',
      content: { markdown: 'no contrast markers here' },
      sourceRefs: ['e/f.ts:9-12'],
    },
  ];

  for (const profile of ['cold-start', 'opportunistic'] as const) {
    it(`path label does not change the verdict under profile=${profile} (byte-identical)`, () => {
      const opts = (path: 'host-cold-start' | 'in-process') => ({
        path,
        stage: 'all' as const,
        profile,
        sourceRefResolver: resolver,
        sessionScope,
        projectRoot: '/x',
      });
      const host = validateAgainst(corpus, opts('host-cold-start'));
      const inProcess = validateAgainst(corpus, opts('in-process'));
      // the two REAL submission paths face the SAME bar at the Core API — the label is metadata
      expect(inProcess).toEqual(host);
      // non-vacuous: the corpus genuinely produces violations to compare
      expect(host.length).toBeGreaterThan(0);
    });
  }
});

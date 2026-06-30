/**
 * P2.1 — the two parallel submissionSpec builders are collapsed onto one module-fed source.
 *
 * `buildDimensionSubmissionSpec` (used by BOTH DimensionCatalogPayload and MissionBriefingBuilder)
 * reads the candidate floor, the imperative-verb allowlist, and the evidence floor from the
 * RecipeAuthoringSpec module, so the rendered guidance states the ACTUAL gate rules (guidance==gate).
 * Decision D-B: the 0-vs-3 contradiction resolves to the module floor (≥3) — the draft no longer
 * says "可以提交 0 条". This is a GUIDANCE change only; the gates are byte-identical from P1.
 */
import { describe, expect, it } from 'vitest';

import {
  buildDimensionCatalogPayload,
  buildDimensionSubmissionSpec,
} from '../src/domain/dimension/DimensionCatalogPayload.js';
import {
  buildSubmissionSpec,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
} from '../src/knowledge.js';

describe('P2.1 submissionSpec collapse — D-B ≥3 floor, guidance==gate', () => {
  it('states the module ≥3 floor (no "0 条")', () => {
    const floor = buildSubmissionSpec('').minCandidates; // module single source
    expect(floor).toBe(3);
    const spec = buildDimensionSubmissionSpec(['rule', 'pattern']);
    expect(spec.targetCandidateCount).toContain(`最少 ${floor} 条`);
    expect(spec.targetCandidateCount).not.toContain('0 条');
  });

  it('lists the real imperative-verb allowlist + the ≥3 distinct-files evidence floor', () => {
    const verbs = getImperativeVerbAllowlist();
    const evidenceFloor = getEvidenceFloorPolicy();
    const spec = buildDimensionSubmissionSpec(['rule']);
    // verb count is DERIVED from the live allowlist (not hardcoded), and a real verb appears
    expect(spec.contentQuality).toContain(`共 ${verbs.positive.length} 个`);
    expect(spec.contentQuality).toContain('validate');
    expect(verbs.positive).toContain('validate');
    // the evidence floor the gate enforces is stated
    expect(spec.contentQuality).toContain(`≥${evidenceFloor.ruleFiles} 个不同来源文件`);
  });

  it('every catalog-payload dimension uses the collapsed builder (no draft "0 条")', () => {
    const payload = buildDimensionCatalogPayload({});
    expect(payload.length).toBeGreaterThan(0);
    for (const dim of payload) {
      expect(dim.submissionSpec.targetCandidateCount).toContain('最少 3 条');
      expect(dim.submissionSpec.targetCandidateCount).not.toContain('0 条');
      // preSubmitChecklist structure preserved (Plugin cold-start compactor reads .MUST)
      expect(dim.submissionSpec.preSubmitChecklist.MUST.length).toBeGreaterThan(0);
    }
  });
});

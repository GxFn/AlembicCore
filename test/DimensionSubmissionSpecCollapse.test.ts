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
  getStage3FieldPolicy,
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

  it('P3/C6: contentStyle 不再被 slice(0,12) 截断——深度要求 + 来源标注格式规则同时到达 host', () => {
    const spec = buildDimensionSubmissionSpec(['rule']);
    // 深度要求(2026-07-02 深挖引导版)出现在 host contentStyle。
    expect(spec.contentStyle).toContain('深度要求');
    expect(spec.contentStyle).toContain('洞察');
    // 旧 slice(0,12) 会把这条来源标注格式规则(第 13 行)截掉；去 slice 后它随全文到达 host。
    expect(spec.contentStyle).toContain('代码来源标注: (来源: FileName.ext:行号)');
  });

  it('P3/C6: contentQuality 的 markdown 下限从门禁同一常量派生(消除手写 floor literal)', () => {
    const stage3 = getStage3FieldPolicy();
    const spec = buildDimensionSubmissionSpec(['rule']);
    // 数值来自 getStage3FieldPolicy().markdownFloor(门禁 MARKDOWN_FLOOR 单源)，非散落的 200 字面量。
    expect(spec.contentQuality).toContain(`≥${stage3.markdownFloor} 字符`);
    expect(stage3.markdownFloor).toBe(200);
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

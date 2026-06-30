/**
 * A.6 drift / no-relaxation snapshot for the RecipeAuthoringSpec lifted gate constants.
 *
 * Read through the stable `@alembic/core/knowledge` facade — the same surface guidance + the gates
 * read. Two guarantees:
 *   - #4 floor + required-field parity: the stage-3 markdown floor (200) and the required-field
 *     list are single-sourced; UnifiedValidator's byte-identical re-point (P1.3) now reads the floor
 *     from getStage3FieldPolicy(), so this snapshot is the drift tripwire for that shared value.
 *   - #6 no-relaxation snapshot: an EXACT snapshot of the lifted constants (verb counts, evidence
 *     floor, every stage-3 threshold + regex source/flags + bracket set). Any future edit to
 *     gate-rules.ts that would relax a gate changes this object and fails loudly.
 */
import { describe, expect, it } from 'vitest';

import {
  getAllRequiredFieldNames,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
  getStage3FieldPolicy,
} from '../src/knowledge.js';

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

/**
 * P1.3 — UnifiedValidator stage-3 re-point is BYTE-IDENTICAL.
 *
 * The baseline fixture (test/fixtures/unified-validator-stage3-baseline.json) was captured from the
 * PRE-re-point validator (dist build at commit a2329ce) across a corpus that hits every stage-3
 * path: missing required field, content/reasoning not object, invalid kind, markdown too short,
 * markdown missing code/file-ref, incomplete coreCode, generic title, and the three uniqueness
 * duplicates — plus a fully valid base that passes all three layers.
 *
 * After the re-point (stage-3 inline literals — markdown floor 200, code-block/file-ref regexes,
 * coreCode bracket predicate, generic-title regex, codeFingerprint, uniqueness floors — now read
 * from the RecipeAuthoringSpec gate-rules table) the validator MUST emit the identical
 * {pass, errors, warnings} for every case. Any byte differs = a value was reinterpreted, not moved
 * → STOP (the re-point is rejected).
 */
import { describe, expect, it } from 'vitest';
import { UnifiedValidator } from '../src/knowledge.js';
import corpus from './fixtures/stage3-corpus.json' with { type: 'json' };
import baseline from './fixtures/unified-validator-stage3-baseline.json' with { type: 'json' };

interface CorpusCase {
  name: string;
  candidate: Record<string, unknown>;
  existingTitles?: string[];
  existingTriggers?: string[];
  existingFingerprints?: string[];
  expectedContains: string | null;
}
interface BaselineCase {
  name: string;
  pass: boolean;
  errors: string[];
  warnings: string[];
}

const CORPUS = corpus as unknown as CorpusCase[];
const BASELINE = baseline as unknown as BaselineCase[];
const baselineByName = new Map(BASELINE.map((b) => [b.name, b]));

describe('UnifiedValidator stage-3 re-point is byte-identical (P1.3)', () => {
  for (const entry of CORPUS) {
    it(`case ${entry.name}: identical {pass, errors, warnings}`, () => {
      const validator = new UnifiedValidator({
        existingTitles: new Set(entry.existingTitles ?? []),
        existingTriggers: new Set(entry.existingTriggers ?? []),
        existingFingerprints: new Set(entry.existingFingerprints ?? []),
      });
      const result = validator.validate(entry.candidate);
      // 新接口与既有公开返回完全同源，历史 fixture 不重生成。
      expect(validator.validateDetailed(entry.candidate).result).toEqual(result);
      const expected = baselineByName.get(entry.name);
      expect(expected, `baseline for ${entry.name}`).toBeDefined();
      // full byte-for-byte comparison of the public validation result
      expect({ pass: result.pass, errors: result.errors, warnings: result.warnings }).toEqual({
        pass: expected?.pass,
        errors: expected?.errors,
        warnings: expected?.warnings,
      });
      // prove the targeted stage-3 path was actually exercised (exact-string membership)
      if (entry.expectedContains) {
        expect(result.errors).toContain(entry.expectedContains);
      }
    });
  }

  it('keeps structural diagnostics separate when the same input also has duplicate fields', () => {
    const candidate = { ...CORPUS.find((entry) => entry.name === 'valid-base')!.candidate };
    candidate.description = '';
    const validator = new UnifiedValidator({
      existingTitles: new Set([String(candidate.title).toLowerCase().trim()]),
    });
    const detailed = validator.validateDetailed(candidate);
    expect(detailed.structural).toEqual(validator.validate(candidate, { skipUniqueness: true }));
    expect(detailed.structural.pass).toBe(false);
    expect(detailed.result.errors).toEqual([
      ...detailed.structural.errors,
      `标题重复: "${candidate.title}"`,
    ]);
    const injected = validator.validateDetailed(candidate, {
      systemInjectedFields: ['description'],
    });
    expect(injected.structural.pass).toBe(true);
    expect(injected.result.errors).toEqual([`标题重复: "${candidate.title}"`]);
    expect(
      validator.validateDetailed(candidate, {
        systemInjectedFields: ['description'],
        skipUniqueness: true,
      }).result.pass
    ).toBe(true);
  });

  it.each([
    { candidate: null },
    { candidate: [] },
    { candidate: 42 },
  ])('returns both diagnostic stages for malformed input $candidate', ({ candidate }) => {
    const result = { pass: false, errors: ['候选为空或类型错误'], warnings: [] };
    expect(new UnifiedValidator().validateDetailed(candidate as never)).toEqual({
      structural: result,
      result,
    });
  });

  it('corpus covers every stage-3 path + a passing base', () => {
    expect(CORPUS.length).toBe(12);
    expect(baselineByName.get('valid-base')?.pass).toBe(true);
    expect(baselineByName.get('valid-base')?.errors).toEqual([]);
  });
});

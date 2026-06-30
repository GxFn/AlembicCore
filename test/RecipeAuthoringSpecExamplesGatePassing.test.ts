/**
 * P3 — the STANDING TRIPWIRE (§C.5): every shipped worked example must PASS the full gate.
 *
 * Each example(lang) candidate is run through validateAgainst({stage:'all'}) and must produce ZERO
 * violations — the structural opposite of the four anti-examples that shipped before (which failed
 * CONTENT_CONTRAST_MISSING, DO/DONT_CLAUSE_NON_IMPERATIVE, and SOURCE_REF_LINE_MISSING). If a future
 * edit reintroduces an anti-example, this test fails loudly. The gate is NEVER relaxed to pass a bad
 * example — the example is fixed.
 */
import { describe, expect, it } from 'vitest';

import {
  EXAMPLE_LANGUAGES,
  EXAMPLE_TEMPLATES,
} from '../src/domain/knowledge/recipe-authoring-spec/examples/index.js';
import { example, validateAgainst } from '../src/knowledge.js';

const PATH = { path: 'in-process' as const, stage: 'all' as const };

describe('RecipeAuthoringSpec worked examples are gate-passing (P3 tripwire)', () => {
  for (const [language, candidate] of Object.entries(EXAMPLE_TEMPLATES)) {
    it(`EXAMPLE_TEMPLATES[${language}] passes validateAgainst({stage:'all'})`, () => {
      const violations = validateAgainst([candidate], PATH);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }

  it('covers the real primary-corpus languages + _default', () => {
    for (const lang of [
      'objectivec',
      'typescript',
      'python',
      'swift',
      'kotlin',
      'java',
      'go',
      'rust',
      'csharp',
      'javascript',
    ]) {
      expect(EXAMPLE_LANGUAGES).toContain(lang);
    }
    expect(EXAMPLE_TEMPLATES._default).toBeDefined();
  });

  it('example(lang) resolves known languages and falls back to _default — both gate-passing', () => {
    // a dedicated language resolves to its own template
    expect(validateAgainst([example('swift').candidate], PATH)).toEqual([]);
    // case-insensitive resolution
    expect(validateAgainst([example('TypeScript').candidate], PATH)).toEqual([]);
    // an unknown language falls back to _default, which is also gate-passing
    const fallback = example('some-unlisted-language');
    expect(fallback.candidate).toBe(EXAMPLE_TEMPLATES._default);
    expect(validateAgainst([fallback.candidate], PATH)).toEqual([]);
  });
});

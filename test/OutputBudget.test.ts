/**
 * MT2 (Train A) — shared output-budget mechanism negative tests.
 */

import {
  applyOutputBudget,
  assertDestructiveResetHasArchive,
  CORE_CONTENT_SLICE_BUDGETS,
  CORE_TOOL_OUTPUT_BUDGETS,
} from '../src/shared/OutputBudget.js';

describe('OutputBudget mechanism', () => {
  test('over-budget payloads are truncated with truncated:true and an overflow route', () => {
    const budget = CORE_TOOL_OUTPUT_BUDGETS.alembic_prime.budgetBytes;
    const payload = 'a'.repeat(budget + 500);

    const result = applyOutputBudget('alembic_prime', payload, {
      artifactRef: '.asd/overflow/prime-full.json',
    });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(budget);
    expect(result.originalBytes).toBe(budget + 500);
    expect(result.overflow).toEqual({
      route: 'artifact-ref',
      omittedBytes: 500,
      artifactRef: '.asd/overflow/prime-full.json',
    });
  });

  test('within-budget payloads pass through untouched with an explicit truncated:false', () => {
    const result = applyOutputBudget('alembic_prime', 'compact response');
    expect(result).toMatchObject({ content: 'compact response', truncated: false });
  });

  test('unknown tools pass through unbudgeted but still report truncated:false', () => {
    const result = applyOutputBudget('alembic_not_a_tool', 'y'.repeat(100_000));
    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(100_000);
  });

  test('truncation never splits a multi-byte code point', () => {
    const budget = CORE_TOOL_OUTPUT_BUDGETS.alembic_graph.budgetBytes;
    const payload = '知'.repeat(budget); // 3 bytes per char — over budget
    const result = applyOutputBudget('alembic_graph', payload);

    expect(result.truncated).toBe(true);
    expect(result.content).not.toContain('�');
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(budget);
    // Round-trip through UTF-8 stays lossless for the shipped slice.
    expect(Buffer.from(result.content, 'utf8').toString('utf8')).toBe(result.content);
  });

  test('budgets carry the MT1 measured values, not estimates', () => {
    expect(CORE_TOOL_OUTPUT_BUDGETS.alembic_job).toMatchObject({
      budgetBytes: 16_384,
      measuredMaxBytes: 767_413,
      class: 'diagnostics-composite',
    });
    expect(CORE_TOOL_OUTPUT_BUDGETS.alembic_bootstrap.measuredMaxBytes).toBe(187_033);
    for (const entry of Object.values(CORE_TOOL_OUTPUT_BUDGETS)) {
      expect(entry.rawRef).toBeTruthy();
    }
  });

  test('content-slice budgets keep the pre-MT2 values (budget semantics preserved)', () => {
    expect(CORE_CONTENT_SLICE_BUDGETS).toEqual({
      rescanEvidenceMarkdownChars: 500,
      rescanEvidenceRationaleChars: 200,
      rescanEvidenceCoreCodeChars: 400,
      rescanEvidenceSourceRefs: 5,
      submissionCoreCodePreviewChars: 200,
    });
  });

  test('NEGATIVE: a retention-claiming destructive reset with no archive throws', () => {
    expect(() =>
      assertDestructiveResetHasArchive({
        target: 'wiki/candidates file projections',
        removedCount: 7,
        archiveRef: null,
        claimsRetention: true,
      })
    ).toThrow(/no archiveRef/);
  });

  test('archived resets and honest non-retention resets pass the contract', () => {
    expect(() =>
      assertDestructiveResetHasArchive({
        target: 'wiki/candidates file projections',
        removedCount: 7,
        archiveRef: '.asd/.trash/20260612-010101/',
        claimsRetention: true,
      })
    ).not.toThrow();
    expect(() =>
      assertDestructiveResetHasArchive({
        target: 'scratch cache',
        removedCount: 3,
        archiveRef: null,
        claimsRetention: false,
      })
    ).not.toThrow();
  });
});

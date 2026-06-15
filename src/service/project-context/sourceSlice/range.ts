import type { SourceRangeSummary } from '../../../domain/project-context/index.js';
import type { SourceSliceQueryFailure } from './contracts.js';

export interface SourceSliceRangeInput {
  range?: unknown;
  startLine?: unknown;
  endLine?: unknown;
}

export type SourceSliceRangeResult =
  | { ok: true; range: SourceRangeSummary }
  | { ok: false; failure: SourceSliceQueryFailure };

export function normalizeSourceSliceRange(
  input: SourceSliceRangeInput,
  lineCount: number
): SourceSliceRangeResult {
  const rawRange = readRangeCandidate(input);
  if (!rawRange) {
    return invalidRange('source-slice payload.range is required.');
  }

  const startLine = readPositiveLine(rawRange.startLine, 'startLine');
  if (typeof startLine === 'string') {
    return invalidRange(startLine);
  }

  const endLine = readPositiveLine(rawRange.endLine, 'endLine');
  if (typeof endLine === 'string') {
    return invalidRange(endLine);
  }

  if (endLine < startLine) {
    return invalidRange('source-slice range.endLine must be greater than or equal to startLine.');
  }
  if (startLine > lineCount || endLine > lineCount) {
    return invalidRange(
      `source-slice range ${startLine}-${endLine} is outside current file line count ${lineCount}.`
    );
  }

  const startColumn = readOptionalColumn(rawRange.startColumn, 'startColumn');
  if (typeof startColumn === 'string') {
    return invalidRange(startColumn);
  }
  const endColumn = readOptionalColumn(rawRange.endColumn, 'endColumn');
  if (typeof endColumn === 'string') {
    return invalidRange(endColumn);
  }
  if (
    startColumn !== undefined &&
    endColumn !== undefined &&
    startLine === endLine &&
    endColumn < startColumn
  ) {
    return invalidRange(
      'source-slice range.endColumn must be greater than or equal to startColumn on one line.'
    );
  }

  return {
    ok: true,
    range: {
      endColumn,
      endLine,
      startColumn,
      startLine,
    },
  };
}

export function readSourceSliceText(lines: readonly string[], range: SourceRangeSummary): string {
  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}

function readRangeCandidate(input: SourceSliceRangeInput): Record<string, unknown> | undefined {
  if (isRecord(input.range)) {
    return input.range;
  }
  if (input.startLine !== undefined || input.endLine !== undefined) {
    return {
      endLine: input.endLine,
      startLine: input.startLine,
    };
  }
  return undefined;
}

function readPositiveLine(value: unknown, label: string): number | string {
  if (!Number.isInteger(value) || Number(value) < 1) {
    return `source-slice range.${label} must be a positive integer.`;
  }
  return Number(value);
}

function readOptionalColumn(value: unknown, label: string): number | string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) < 0) {
    return `source-slice range.${label} must be a non-negative integer when provided.`;
  }
  return Number(value);
}

function invalidRange(message: string): SourceSliceRangeResult {
  return {
    failure: {
      code: 'invalid-scope',
      message,
      retryable: false,
    },
    ok: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

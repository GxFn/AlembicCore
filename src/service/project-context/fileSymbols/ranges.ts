import type { SourceRangeSummary } from '../../../domain/project-context/index.js';

export function createSourceLineRange(input: {
  startLine?: unknown;
  endLine?: unknown;
  bodyLines?: unknown;
  lineCount: number;
}): SourceRangeSummary | undefined {
  const startLine = readPositiveInteger(input.startLine);
  if (!startLine || startLine > input.lineCount) {
    return undefined;
  }

  const explicitEndLine = readPositiveInteger(input.endLine);
  const bodyLines = readPositiveInteger(input.bodyLines);
  const derivedEndLine = bodyLines ? startLine + bodyLines - 1 : startLine;
  const endLine = Math.min(input.lineCount, explicitEndLine ?? derivedEndLine);
  if (endLine < startLine) {
    return undefined;
  }

  return { endLine, startLine };
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : undefined;
}

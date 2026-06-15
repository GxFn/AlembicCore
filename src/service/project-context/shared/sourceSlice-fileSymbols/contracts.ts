import type {
  ProjectContextRef,
  ProjectContextRefScope,
  SourceRangeSummary,
} from '../../../../domain/project-context/index.js';

export interface ProjectContextSourceRangeProjection {
  filePath: string;
  range: SourceRangeSummary;
  ref: ProjectContextRef;
  hash?: string;
  lineCount?: number;
  mtimeMs?: number;
}

export interface ProjectContextSourceSliceRefInput {
  projectRoot: string;
  filePath: string;
  range: SourceRangeSummary;
  repoId?: string;
  sourceFolder?: string;
  hash?: string;
  parentRef?: string;
}

export interface ProjectContextFileRefInput {
  projectRoot: string;
  filePath: string;
  repoId?: string;
  sourceFolder?: string;
  hash?: string;
}

export function createProjectContextFileRef(input: ProjectContextFileRefInput): ProjectContextRef {
  const scope = createProjectContextSourceScope(input);
  return {
    id: createProjectContextFileRefId(input),
    kind: 'file',
    label: input.filePath,
    level: 'source-slice',
    metadata: input.hash ? { hash: input.hash } : undefined,
    scope,
  };
}

export function createProjectContextSourceSliceRef(
  input: ProjectContextSourceSliceRefInput
): ProjectContextRef {
  const scope = createProjectContextSourceScope(input);
  return {
    id: createProjectContextSourceSliceRefId(input),
    kind: 'source-slice',
    label: `${input.filePath}:${formatSourceRangeSummary(input.range)}`,
    level: 'source-slice',
    metadata: input.hash ? { hash: input.hash } : undefined,
    parentRef: input.parentRef,
    scope: {
      ...scope,
      range: input.range,
    },
  };
}

export function createProjectContextSourceRangeProjection(
  input: ProjectContextSourceSliceRefInput & {
    lineCount?: number;
    mtimeMs?: number;
  }
): ProjectContextSourceRangeProjection {
  return {
    filePath: input.filePath,
    hash: input.hash,
    lineCount: input.lineCount,
    mtimeMs: input.mtimeMs,
    range: input.range,
    ref: createProjectContextSourceSliceRef(input),
  };
}

export function createProjectContextFileRefId(input: ProjectContextFileRefInput): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const file = encodeRefPart(input.filePath);
  const hash = input.hash ? `:${encodeRefPart(input.hash)}` : '';
  return `file:${repo}:${file}${hash}`;
}

export function createProjectContextSourceSliceRefId(
  input: ProjectContextSourceSliceRefInput
): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const file = encodeRefPart(input.filePath);
  const range = formatSourceRangeSummary(input.range);
  const hash = input.hash ? `:${encodeRefPart(input.hash)}` : '';
  return `source-slice:${repo}:${file}:${range}${hash}`;
}

export function formatSourceRangeSummary(range: SourceRangeSummary): string {
  const columnSuffix =
    range.startColumn === undefined && range.endColumn === undefined
      ? ''
      : `:${range.startColumn ?? 0}-${range.endColumn ?? 0}`;
  return `L${range.startLine}-L${range.endLine}${columnSuffix}`;
}

function createProjectContextSourceScope(
  input: ProjectContextFileRefInput
): ProjectContextRefScope {
  return {
    filePath: input.filePath,
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

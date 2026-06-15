import type {
  ProjectContextMetadata,
  ProjectContextRef,
  ProjectContextRefScope,
  SourceRangeSummary,
} from '../../../../domain/project-context/index.js';
import { formatSourceRangeSummary } from '../sourceSlice-fileSymbols/contracts.js';

export interface ProjectContextFileFlowRelationRefInput {
  projectRoot: string;
  filePath: string;
  relationKind: string;
  range: SourceRangeSummary;
  repoId?: string;
  sourceFolder?: string;
  hash?: string;
  parentRef?: string;
  direction?: 'inflow' | 'outflow' | 'internal';
  label?: string;
  specifier?: string;
  targetFilePath?: string;
  symbolName?: string;
  qualifiedName?: string;
  unresolved?: boolean;
  reason?: string;
}

export function createProjectContextFileFlowRelationRef(
  input: ProjectContextFileFlowRelationRefInput
): ProjectContextRef {
  const metadata: ProjectContextMetadata = {
    kind: input.relationKind,
  };
  setOptionalMetadata(metadata, 'direction', input.direction);
  setOptionalMetadata(metadata, 'hash', input.hash);
  setOptionalMetadata(metadata, 'specifier', input.specifier);
  setOptionalMetadata(metadata, 'targetFilePath', input.targetFilePath);
  setOptionalMetadata(metadata, 'symbolName', input.symbolName);
  setOptionalMetadata(metadata, 'qualifiedName', input.qualifiedName);
  setOptionalMetadata(metadata, 'reason', input.reason);
  if (input.unresolved !== undefined) {
    metadata.unresolved = input.unresolved;
  }

  return {
    id: createProjectContextFileFlowRelationRefId(input),
    kind: 'relation-site',
    label: input.label ?? `${input.relationKind} ${formatSourceRangeSummary(input.range)}`,
    level: 'file-flow',
    metadata,
    parentRef: input.parentRef,
    scope: {
      ...createProjectContextSourceScope(input),
      range: input.range,
    },
  };
}

export function createProjectContextFileFlowRelationRefId(
  input: ProjectContextFileFlowRelationRefInput
): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const file = encodeRefPart(input.filePath);
  const range = formatSourceRangeSummary(input.range);
  const target = encodeRefPart(
    input.targetFilePath ?? input.specifier ?? input.qualifiedName ?? input.symbolName ?? 'unknown'
  );
  const hash = input.hash ? `:${encodeRefPart(input.hash)}` : '';
  return `relation-site:${repo}:${file}:${input.relationKind}:${target}:${range}${hash}`;
}

function createProjectContextSourceScope(
  input: Pick<
    ProjectContextFileFlowRelationRefInput,
    'filePath' | 'projectRoot' | 'repoId' | 'sourceFolder'
  >
): ProjectContextRefScope {
  return {
    filePath: input.filePath,
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function setOptionalMetadata(
  metadata: ProjectContextMetadata,
  key: string,
  value: string | undefined
): void {
  if (value) {
    metadata[key] = value;
  }
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

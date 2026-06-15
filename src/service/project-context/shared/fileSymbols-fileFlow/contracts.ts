import type {
  ProjectContextMetadata,
  ProjectContextRef,
  ProjectContextRefScope,
  SourceRangeSummary,
} from '../../../../domain/project-context/index.js';
import { formatSourceRangeSummary } from '../sourceSlice-fileSymbols/contracts.js';

export interface ProjectContextFileSymbolRefInput {
  projectRoot: string;
  filePath: string;
  name: string;
  kind: string;
  range: SourceRangeSummary;
  repoId?: string;
  sourceFolder?: string;
  hash?: string;
  parentRef?: string;
  qualifiedName?: string;
  container?: string;
}

export function createProjectContextFileSymbolRef(
  input: ProjectContextFileSymbolRefInput
): ProjectContextRef {
  const metadata: ProjectContextMetadata = {
    kind: input.kind,
    name: input.name,
  };
  if (input.hash) {
    metadata.hash = input.hash;
  }
  if (input.qualifiedName) {
    metadata.qualifiedName = input.qualifiedName;
  }
  if (input.container) {
    metadata.container = input.container;
  }

  return {
    id: createProjectContextFileSymbolRefId(input),
    kind: 'file-symbol',
    label: input.qualifiedName ?? input.name,
    level: 'file-symbols',
    metadata,
    parentRef: input.parentRef,
    scope: {
      ...createProjectContextSourceScope(input),
      range: input.range,
    },
  };
}

export function createProjectContextFileSymbolRefId(
  input: ProjectContextFileSymbolRefInput
): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const file = encodeRefPart(input.filePath);
  const name = encodeRefPart(input.qualifiedName ?? input.name);
  const range = formatSourceRangeSummary(input.range);
  const hash = input.hash ? `:${encodeRefPart(input.hash)}` : '';
  return `file-symbol:${repo}:${file}:${input.kind}:${name}:${range}${hash}`;
}

function createProjectContextSourceScope(
  input: Pick<
    ProjectContextFileSymbolRefInput,
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

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

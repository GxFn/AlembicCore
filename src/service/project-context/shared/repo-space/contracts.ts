import type {
  PathSummary,
  ProjectContextJson,
  ProjectContextMetadata,
  ProjectContextRef,
  ProjectContextRefScope,
  RepoSummary,
  SourceFolderSummary,
} from '../../../../domain/project-context/index.js';

export interface ProjectContextRepoSpaceRepoInput {
  projectRoot: string;
  repoId: string;
  repoName: string;
  sourceFolder?: string;
  metadata?: ProjectContextMetadata;
}

export interface ProjectContextRepoSpaceSourceFolderInput {
  displayName?: string;
  folderId: string;
  missing?: boolean;
  path: string;
  projectRoot: string;
  realpath?: string;
  repositoryId?: string;
  role?: string;
  state?: string;
  repoRef?: ProjectContextRef;
}

export interface ProjectContextRepoSpacePathInput {
  exists?: boolean;
  metadata?: ProjectContextMetadata;
  path: string;
  projectRoot: string;
  repoId?: string;
  role?: string;
  sourceFolder?: string;
}

export function createProjectContextRepoSpaceRepoRef(
  input: ProjectContextRepoSpaceRepoInput
): ProjectContextRef {
  return {
    id: `repo:${encodeRefPart(input.repoId)}:${encodeRefPart(input.sourceFolder ?? '.')}`,
    kind: 'repo',
    label: input.repoName,
    level: 'repo',
    metadata: input.metadata,
    scope: createProjectScope(input),
  };
}

export function createProjectContextRepoSpaceRepoSummary(
  input: ProjectContextRepoSpaceRepoInput
): RepoSummary {
  return {
    id: input.repoId,
    name: input.repoName,
    ref: createProjectContextRepoSpaceRepoRef(input),
    root: input.sourceFolder ?? '.',
  };
}

export function createProjectContextRepoSpaceSourceFolderSummary(
  input: ProjectContextRepoSpaceSourceFolderInput
): SourceFolderSummary {
  return {
    displayName: input.displayName,
    id: input.folderId,
    missing: input.missing === true ? true : undefined,
    path: input.path,
    realpath: input.realpath,
    repoRef: input.repoRef,
    repositoryId: input.repositoryId,
    role: input.role,
    state: input.state,
  };
}

export function createProjectContextRepoSpacePathSummary(
  input: ProjectContextRepoSpacePathInput
): PathSummary {
  const ref = createProjectContextRepoSpacePathRef(input);
  return {
    exists: input.exists,
    path: input.path,
    ref,
    role: input.role,
  };
}

export function createProjectContextRepoSpacePathRef(
  input: ProjectContextRepoSpacePathInput
): ProjectContextRef {
  return {
    id: `path:${encodeRefPart(input.repoId ?? 'root')}:${encodeRefPart(input.path)}`,
    kind: 'path',
    label: input.path,
    level: 'space',
    metadata: input.metadata,
    scope: {
      ...createProjectScope(input),
      filePath: input.path,
    },
  };
}

export function createProjectContextRepoSpaceMetadata(
  input: Record<string, ProjectContextJson | undefined>
): ProjectContextMetadata {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, ProjectContextJson] => entry[1] !== undefined
    )
  );
}

function createProjectScope(input: {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}): ProjectContextRefScope {
  return {
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value.replaceAll('\\', '/'));
}

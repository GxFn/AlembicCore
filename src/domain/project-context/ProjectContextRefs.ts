export type ProjectContextScalar = string | number | boolean | null;

export type ProjectContextJson =
  | ProjectContextScalar
  | ProjectContextJson[]
  | { readonly [key: string]: ProjectContextJson };

export type ProjectContextMetadata = Record<string, ProjectContextJson>;

export interface SourceRangeSummary {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface PathSummary {
  path: string;
  role?: string;
  exists?: boolean;
  ref?: ProjectContextRef;
}

export interface FileSummary {
  filePath: string;
  repoId?: string;
  language?: string;
  lineCount?: number;
  hash?: string;
  mtimeMs?: number;
  ref?: ProjectContextRef;
}

export type ProjectContextRefKind =
  | 'space'
  | 'repo'
  | 'map'
  | 'module'
  | 'module-layer'
  | 'file-flow'
  | 'file-symbol'
  | 'source-slice'
  | 'anchor-range'
  | 'relation-site'
  | 'symbol'
  | 'file'
  | 'path';

export interface ProjectContextRefScope {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  filePath?: string;
  range?: SourceRangeSummary;
}

export interface ProjectContextRef {
  id: string;
  kind: ProjectContextRefKind;
  label?: string;
  level?: string;
  scope: ProjectContextRefScope;
  parentRef?: string;
  metadata?: ProjectContextMetadata;
}

export interface SourceFolderSummary {
  displayName?: string;
  id: string;
  path: string;
  realpath?: string;
  repositoryId?: string;
  role?: string;
  repoRef?: ProjectContextRef;
  missing?: boolean;
  state?: string;
}

export interface ProjectContextProject {
  projectRoot: string;
  projectId?: string;
  displayName?: string;
  activeRepo?: ProjectContextRef;
  sourceFolders?: SourceFolderSummary[];
}

export interface ProjectContextScopeInput {
  projectRoot?: string;
  repoId?: string;
  sourceFolder?: string;
  activeFile?: string;
  includeGenerated?: boolean;
  includeVendor?: boolean;
}

export interface ProjectContextScope {
  projectRoot: string;
  projectId?: string;
  displayName?: string;
  projectIdentitySource?: string;
  repoId?: string;
  sourceFolder?: string;
  activeFile?: string;
  includeGenerated: boolean;
  includeVendor: boolean;
}

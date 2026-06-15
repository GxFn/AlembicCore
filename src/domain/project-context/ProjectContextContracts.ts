import type { ProjectContextResult } from './ProjectContextMap.js';
import type {
  ProjectContextProject,
  ProjectContextRef,
  ProjectContextScopeInput,
} from './ProjectContextRefs.js';

export const PROJECT_CONTEXT_CONTRACT_VERSION = 1 as const;

export const PROJECT_CONTEXT_REQUEST_KIND_VALUES = [
  'anchor-range',
  'space',
  'repo',
  'map',
  'module',
  'module-layers',
  'file-flow',
  'file-symbols',
  'source-slice',
] as const;

export type ProjectContextRequestKind = (typeof PROJECT_CONTEXT_REQUEST_KIND_VALUES)[number];

export type ProjectContextLevel = Exclude<ProjectContextRequestKind, 'anchor-range'>;

export type ProjectContextQueryErrorCode =
  | 'invalid-request-kind'
  | 'invalid-scope'
  | 'outside-scope'
  | 'project-root-conflict'
  | 'query-unavailable'
  | 'not-found'
  | 'ambiguous'
  | 'redacted'
  | 'too-large';

export interface ProjectContextQueryError {
  code: ProjectContextQueryErrorCode;
  message: string;
  severity: 'error' | 'warning';
  ref?: ProjectContextRef;
  path?: string;
  retryable: boolean;
}

export interface ProjectContextRequest<TPayload = unknown> {
  kind: ProjectContextRequestKind;
  project?: ProjectContextProjectIdentityInput;
  scope: ProjectContextScopeInput;
  payload?: TPayload;
}

export interface ProjectContextEnvelope<T = ProjectContextResult> {
  contractVersion: typeof PROJECT_CONTEXT_CONTRACT_VERSION;
  project: ProjectContextProject;
  queryLevel: ProjectContextRequestKind;
  data: T;
  refs: ProjectContextRef[];
  errors?: ProjectContextQueryError[];
}

export interface ProjectContext {
  execute(input: ProjectContextRequest): Promise<ProjectContextEnvelope<ProjectContextResult>>;
}

export interface ProjectContextProjectIdentityInput {
  projectRoot: string;
  projectId?: string;
  displayName?: string;
  source?: string;
}

export function isProjectContextRequestKind(value: unknown): value is ProjectContextRequestKind {
  return (
    typeof value === 'string' &&
    (PROJECT_CONTEXT_REQUEST_KIND_VALUES as readonly string[]).includes(value)
  );
}

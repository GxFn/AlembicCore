import type {
  ProjectContextExecutionContext,
  ProjectContextProjectIdentityInput,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextRequest,
  ProjectContextRequestKind,
  ProjectContextResult,
  ProjectContextScope,
} from '../../../domain/project-context/index.js';

export const PROJECT_CONTEXT_INTERFACE_ALLOWED_OPERATIONS = [
  'request-kind-validation',
  'scope-containment-check',
  'project-path-authority-check',
  'payload-canonicalization',
  'dispatch',
  'envelope-construction',
  'compact-projection',
  'size-limit-pruning',
  'redaction',
  'ref-selection',
  'query-error-shaping',
] as const;

export type ProjectContextInterfaceOperation =
  (typeof PROJECT_CONTEXT_INTERFACE_ALLOWED_OPERATIONS)[number];

export type CanonicalProjectContextProjectIdentity = Required<
  Pick<ProjectContextProjectIdentityInput, 'projectRoot'>
> &
  Pick<ProjectContextProjectIdentityInput, 'projectId' | 'displayName' | 'source'>;

export type CanonicalProjectContextRequest = Omit<ProjectContextRequest, 'scope' | 'project'> & {
  project: CanonicalProjectContextProjectIdentity;
  scope: ProjectContextScope;
};

export interface ProjectContextHandlerResult {
  data: ProjectContextResult;
  refs?: ProjectContextRef[];
  errors?: ProjectContextQueryError[];
}

export type ProjectContextHandler = (
  request: CanonicalProjectContextRequest,
  context?: ProjectContextExecutionContext
) => Promise<ProjectContextHandlerResult> | ProjectContextHandlerResult;

export type ProjectContextHandlerRegistry = Partial<
  Record<ProjectContextRequestKind, ProjectContextHandler>
>;

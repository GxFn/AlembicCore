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
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import type { FileAnalysisSession } from '../analysis/FileAnalysisSession.js';

/** 内部分析依赖由 service 装配，不进入公开请求 JSON、domain DTO 或持久化产物。 */
export interface ProjectContextHandlerExecutionContext extends ProjectContextExecutionContext {
  analysis?: FileAnalysisSession;
  sourceReader?: ProjectSourceReader;
  /** 记录实际消费的原始字节版本，含会话缓存命中；与物理 IO 观察分开。 */
  onSourceFileVersion?: (input: {
    projectRoot: string;
    filePath: string;
    blobSha256: `sha256:${string}`;
  }) => void;
}

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
  context?: ProjectContextHandlerExecutionContext
) => Promise<ProjectContextHandlerResult> | ProjectContextHandlerResult;

export type ProjectContextHandlerRegistry = Partial<
  Record<ProjectContextRequestKind, ProjectContextHandler>
>;

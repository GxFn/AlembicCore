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

/** Non-serialized execution controls. This object never enters request JSON or refs. */
export interface ProjectContextExecutionContext {
  signal?: AbortSignal;
  /**
   * 观察本次分析实际读取的源码字节，用于捕获时校验 ABA 漂移。
   * 这不是完整文件系统快照：目录、导入存在性和构建配置仍由各自能力负责。
   * 聚合查询必须把同一个 context 传给叶子读取，不能只审计最终显示的 refs。
   */
  onSourceFileRead?: (input: {
    projectRoot: string;
    filePath: string;
    content: Uint8Array;
  }) => void;
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
  execute(
    input: ProjectContextRequest,
    context?: ProjectContextExecutionContext
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
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

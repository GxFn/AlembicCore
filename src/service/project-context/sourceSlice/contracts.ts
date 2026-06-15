import type {
  ProjectContextQueryError,
  ProjectContextQueryErrorCode,
  ProjectContextRef,
  ProjectContextScope,
  SourceSliceContext,
} from '../../../domain/project-context/index.js';

export type { SourceSliceContext } from '../../../domain/project-context/index.js';

export interface SourceSliceRequestPayload {
  filePath?: string;
  range?: unknown;
  startLine?: number;
  endLine?: number;
  includeText?: boolean;
  ref?: ProjectContextRef;
}

export interface SourceSliceFileIdentity {
  absolutePath: string;
  filePath: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}

export interface SourceSliceFileFacts extends SourceSliceFileIdentity {
  hash: string;
  language?: string;
  lineCount: number;
  lines: string[];
  mtimeMs: number;
  text: string;
}

export interface SourceSliceQueryFailure {
  code: ProjectContextQueryErrorCode;
  message: string;
  path?: string;
  retryable?: boolean;
}

export interface SourceSliceHandlerSuccess {
  data: SourceSliceContext;
  refs: ProjectContextRef[];
}

export interface SourceSliceHandlerFailure {
  error: ProjectContextQueryError;
}

export interface SourceSliceResolutionInput {
  filePath: string;
  scope: ProjectContextScope;
}

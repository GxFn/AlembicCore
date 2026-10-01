import type {
  ProjectContextQueryErrorCode,
  ProjectContextRef,
} from '../../../domain/project-context/index.js';

export type {
  FileFlowContext,
  RelationEndpointSummary,
  RelationSummary,
} from '../../../domain/project-context/index.js';

export interface FileFlowRequestPayload {
  filePath?: string;
  ref?: ProjectContextRef;
}

export interface FileFlowQueryFailure {
  code: ProjectContextQueryErrorCode;
  message: string;
  path?: string;
  retryable?: boolean;
}

export type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowExport,
  ExtractedFileFlowImport,
  FileFlowExtractionResult,
  FileFlowImportKind,
} from '../../../core/facts/contracts.js';

export interface ResolvedFileFlowImportTarget {
  specifier: string;
  filePath?: string;
  ref?: ProjectContextRef;
  unresolved: boolean;
  reason?: string;
}

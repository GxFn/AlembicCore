import type {
  ProjectContextQueryErrorCode,
  ProjectContextRef,
  SourceRangeSummary,
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

export type FileFlowImportKind = 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';

export interface ExtractedFileFlowImport {
  specifier: string;
  kind: FileFlowImportKind;
  range: SourceRangeSummary;
  statement: string;
  symbols: string[];
  alias?: string;
  typeOnly?: boolean;
}

export interface ExtractedFileFlowExport {
  name: string;
  kind: string;
  range: SourceRangeSummary;
  statement: string;
  exportedName?: string;
  specifier?: string;
}

export interface ExtractedFileFlowCallSite {
  callee: string;
  callerMethod: string;
  callerClass?: string;
  callType: string;
  range: SourceRangeSummary;
  argCount?: number;
  receiver?: string;
  receiverType?: string;
  isAwait?: boolean;
}

export interface FileFlowExtractionResult {
  imports: ExtractedFileFlowImport[];
  exports: ExtractedFileFlowExport[];
  callSites: ExtractedFileFlowCallSite[];
  unavailableReason?: string;
}

export interface ResolvedFileFlowImportTarget {
  specifier: string;
  filePath?: string;
  ref?: ProjectContextRef;
  unresolved: boolean;
  reason?: string;
}

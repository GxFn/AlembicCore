import type {
  ProjectContextQueryErrorCode,
  ProjectContextRef,
  SourceRangeSummary,
} from '../../../domain/project-context/index.js';

export type {
  FileSymbolContext,
  NamingSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';

export interface FileSymbolsRequestPayload {
  filePath?: string;
  ref?: ProjectContextRef;
}

export interface FileSymbolsQueryFailure {
  code: ProjectContextQueryErrorCode;
  message: string;
  path?: string;
  retryable?: boolean;
}

export interface ExtractedFileSymbol {
  name: string;
  kind: string;
  filePath: string;
  range: SourceRangeSummary;
  exported?: boolean;
  qualifiedName?: string;
  signature?: string;
  container?: string;
}

export interface FileSymbolsExtractionResult {
  symbols: ExtractedFileSymbol[];
  unavailableReason?: string;
}

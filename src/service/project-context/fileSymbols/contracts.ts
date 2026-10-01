import type {
  ProjectContextQueryErrorCode,
  ProjectContextRef,
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

export type {
  ExtractedFileSymbol,
  FileSymbolsExtractionResult,
} from '../../../core/facts/contracts.js';

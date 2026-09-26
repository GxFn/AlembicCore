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
  /** 真实AST位置仅用于不同生产方的对应；兼容输出仍使用原range。 */
  matchingRange?: SourceRangeSummary;
  nameIsPlaceholder?: boolean;
  /** 内部兼容证据，由真实AST节点生产，不进入公开SymbolSummary或ref。 */
  compatibilitySource?:
    | 'method-declaration'
    | 'constructor-parameter-property'
    | 'constructor-this-assignment';
}

export interface FileSymbolsExtractionResult {
  symbols: ExtractedFileSymbol[];
  unavailableReason?: string;
  /** 仅用于生产方完整性判定，不直接扩展公开符号DTO。 */
  syntaxValid?: boolean;
  syntaxFeatures?: string[];
}

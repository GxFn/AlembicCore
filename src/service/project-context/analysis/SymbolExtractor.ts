import type { FileAstInput } from '../../../core/facts/fileAst.js';
import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import type { FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';

/**
 * 分析会话的后端扩展点：接收自有文件事实（observed），返回会话实际采用的结果。
 * 后端只消费已经读取的文本与事实，不自行扫描项目、不替换 refs。
 * 当前唯一的实现是严格分析后端（strictAnalysisBackend）。
 */
export interface ProjectContextSymbolExtractor {
  extractSymbols(
    input: FileAstInput,
    legacy: FileSymbolsExtractionResult,
    context?: { signal?: AbortSignal }
  ): Promise<FileSymbolsExtractionResult>;
  /** 一次给出符号与 flow；只实现 extractSymbols 的后端沿用自有的 flow。 */
  analyzeFile?(
    input: FileAstInput,
    legacy: ProjectContextFileAnalysis,
    context?: { signal?: AbortSignal }
  ): Promise<ProjectContextFileAnalysis>;
}

export interface ProjectContextFileAnalysis {
  symbols: FileSymbolsExtractionResult;
  flow?: FileFlowExtractionResult;
}

import type { FileAstInput } from '../../../core/facts/fileAst.js';
import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import type { FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';

/**
 * 单次分析会话固定的异步符号生产方。只消费已经读取的字符串，不自行扫描项目或替换 refs。
 * legacy 来自同一次原生 AST 投影；完整后端以它补足SDK未提供的精确调用语法证据。
 * 宿主 worker 的进程/资源生命周期由创建方拥有，会话只等待结果和传播取消。
 */
export interface ProjectContextSymbolExtractor {
  extractSymbols(
    input: FileAstInput,
    legacy: FileSymbolsExtractionResult,
    context?: { signal?: AbortSignal }
  ): Promise<FileSymbolsExtractionResult>;
  /** 完整后端一次生产符号和flow；旧只符号注入者仍沿用上面的兼容接口。 */
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

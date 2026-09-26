import type { FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';
import type { ProjectContextAstInput } from './astFacts.js';

/**
 * 单次分析会话固定的异步符号生产方。只消费已经读取的字符串，不自行扫描项目或替换 refs。
 * legacy 来自同一次原生 AST 投影，供明确的兼容补充使用；flow 仍复用该 AST 的调用点事实。
 * 宿主 worker 的进程/资源生命周期由创建方拥有，会话只等待结果和传播取消。
 */
export interface ProjectContextSymbolExtractor {
  extractSymbols(
    input: ProjectContextAstInput,
    legacy: FileSymbolsExtractionResult,
    context?: { signal?: AbortSignal }
  ): Promise<FileSymbolsExtractionResult>;
}

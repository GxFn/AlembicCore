import type {
  ExtractedFileFlowExport,
  FileFlowExtractionResult,
  FileSymbolsExtractionResult,
} from './contracts.js';
import { type FileAstInput, readFileAst } from './fileAst.js';
import { extractFileFlowFromSource, getFileFlowUnavailableReason } from './fileFlow.js';
import { extractFileSymbolsFromSource } from './fileSymbols.js';

export interface FileDeclarationEvidence {
  symbols: FileSymbolsExtractionResult;
  /** 保留重数：多个default声明不能因去重变成唯一目标。 */
  defaultExportNames: string[];
  /**
   * 模块导出记录（含 re-export）。链接器沿它跟随 barrel；不依赖调用点提取，
   * 因此只读声明的目标文件也有完整导出表。
   */
  exports: ExtractedFileFlowExport[];
}
export interface FileSyntaxEvidence extends FileDeclarationEvidence {
  flow?: FileFlowExtractionResult;
}

/** 一次AST只留下消费者所需的声明/调用证据，不缓存tree或完整分析摘要。 */
export function readFileSyntaxEvidence(
  input: FileAstInput,
  includeCalls: boolean
): FileSyntaxEvidence {
  const ast = readFileAst(input, includeCalls && !getFileFlowUnavailableReason(input));
  const moduleExports = ast.status === 'ready' ? (ast.moduleSyntax?.exports ?? []) : [];
  return {
    symbols: extractFileSymbolsFromSource(input, ast),
    flow: includeCalls ? extractFileFlowFromSource(input, ast) : undefined,
    defaultExportNames: moduleExports
      .filter(
        (item) => !item.specifier && (item.defaultDeclaration || item.exportedName === 'default')
      )
      .map((item) => item.name),
    exports: moduleExports.map((item) => ({ ...item, range: { ...item.range } })),
  };
}

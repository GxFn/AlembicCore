import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import { extractFileFlowFromSource, getFileFlowUnavailableReason } from '../fileFlow/extract.js';
import type { FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';
import { extractFileSymbolsFromSource } from '../fileSymbols/extract.js';
import { type ProjectContextAstInput, readProjectContextAst } from './astFacts.js';

export interface FileDeclarationEvidence {
  symbols: FileSymbolsExtractionResult;
  /** 保留重数：多个default声明不能因去重变成唯一目标。 */
  defaultExportNames: string[];
}
export interface FileSyntaxEvidence extends FileDeclarationEvidence {
  flow?: FileFlowExtractionResult;
}

/** 一次AST只留下消费者所需的声明/调用证据，不缓存tree或完整分析摘要。 */
export function readFileSyntaxEvidence(
  input: ProjectContextAstInput,
  includeCalls: boolean
): FileSyntaxEvidence {
  const ast = readProjectContextAst(input, includeCalls && !getFileFlowUnavailableReason(input));
  return {
    symbols: extractFileSymbolsFromSource(input, ast),
    flow: includeCalls ? extractFileFlowFromSource(input, ast) : undefined,
    defaultExportNames:
      ast.status === 'ready'
        ? (ast.moduleSyntax?.exports
            .filter(
              (item) =>
                !item.specifier && (item.defaultDeclaration || item.exportedName === 'default')
            )
            .map((item) => item.name) ?? [])
        : [],
  };
}

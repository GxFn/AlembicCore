import '../../../core/ast/index.js';
import { analyzeFile, isAvailable as isAstAvailable } from '../../../core/AstAnalyzer.js';
import { resolveAstParserLanguage } from '../shared/parserLanguage.js';

export interface ProjectContextAstInput {
  text: string;
  filePath: string;
  language?: string;
  lineCount: number;
}

/**
 * 文件级 AST 读取结果。ready 可以包含合法的空符号集；empty 只表示解析器没有返回摘要。
 * 这里只保留读取状态，file-symbols/file-flow 各自投影原有诊断文案和输出字段。
 */
export type ProjectContextAstFacts =
  | {
      status: 'ready';
      parserLanguage: string;
      summary: NonNullable<ReturnType<typeof analyzeFile>>;
    }
  | { status: 'unsupported' }
  | { status: 'runtime-unavailable' | 'empty' | 'failed'; parserLanguage: string };

/**
 * 单一真实 AST producer；会话可复用结果，旧独立调用仍按 false/true 选择是否提取调用点。
 * 不在这里执行 flow 的形态防线，调用方须在需要调用点之前保留原来的输入预算检查。
 */
export function readProjectContextAst(
  input: ProjectContextAstInput,
  extractCallSites: boolean
): ProjectContextAstFacts {
  const parserLanguage = resolveAstParserLanguage(input.filePath, input.language);
  if (!parserLanguage) {
    return { status: 'unsupported' };
  }
  if (!isAstAvailable()) {
    return { status: 'runtime-unavailable', parserLanguage };
  }
  try {
    const summary = analyzeFile(input.text, parserLanguage, { extractCallSites });
    return summary
      ? { status: 'ready', parserLanguage, summary }
      : { status: 'empty', parserLanguage };
  } catch {
    return { status: 'failed', parserLanguage };
  }
}

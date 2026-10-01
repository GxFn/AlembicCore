import '../ast/index.js';
import { analyzeFile } from '../ast/analyzeFile.js';
import type { CallSiteInfo } from '../ast/extract/CallSiteExtractor.js';
import type { SupplementalDeclaration } from '../ast/extract/JsDeclarationCollector.js';
import type { ModuleSyntaxFacts } from '../ast/extract/ModuleSyntaxCollector.js';
import { isAvailable as isAstAvailable } from '../ast/languageRegistry.js';
import { resolveAstParserLanguage } from './parserLanguage.js';

export interface FileAstInput {
  text: string;
  filePath: string;
  language?: string;
  lineCount: number;
}

/**
 * 文件级 AST 读取结果。ready 可以包含合法的空符号集；empty 只表示解析器没有返回摘要。
 * 这里只保留读取状态，file-symbols/file-flow 各自投影原有诊断文案和输出字段。
 */
export type FileAstFacts =
  | {
      status: 'ready';
      parserLanguage: string;
      summary: NonNullable<ReturnType<typeof analyzeFile>>;
      syntaxValid?: boolean;
      syntaxFeatures?: string[];
      moduleSyntax?: ModuleSyntaxFacts;
      /** JS/TS 摘要之外的模块级声明；其他语言没有这一项。 */
      declarations?: SupplementalDeclaration[];
      callSiteEvidence?: CallSiteInfo[];
      callSitesComplete?: boolean;
    }
  | { status: 'unsupported' }
  | { status: 'runtime-unavailable' | 'empty' | 'failed'; parserLanguage: string };

/**
 * 单一真实 AST producer；会话可复用结果，旧独立调用仍按 false/true 选择是否提取调用点。
 * 不在这里执行 flow 的形态防线，调用方须在需要调用点之前保留原来的输入预算检查。
 */
export function readFileAst(input: FileAstInput, extractCallSites: boolean): FileAstFacts {
  const parserLanguage = resolveAstParserLanguage(input.filePath, input.language);
  if (!parserLanguage) {
    return { status: 'unsupported' };
  }
  if (!isAstAvailable()) {
    return { status: 'runtime-unavailable', parserLanguage };
  }
  try {
    let syntaxValid: boolean | undefined;
    let syntaxFeatures: string[] = [];
    let moduleSyntax: ModuleSyntaxFacts | undefined;
    let declarations: SupplementalDeclaration[] | undefined;
    let callSiteEvidence: CallSiteInfo[] | undefined;
    let callSitesComplete: boolean | undefined;
    const summary = analyzeFile(input.text, parserLanguage, {
      extractCallSites,
      onSyntaxValidity: (valid, features) => {
        syntaxValid = valid;
        syntaxFeatures = [...features];
      },
      onModuleSyntax: (facts) => {
        moduleSyntax = facts;
      },
      onDeclarations: (facts) => {
        declarations = facts;
      },
      onCallSiteEvidence: (facts) => {
        callSiteEvidence = facts.callSites;
        callSitesComplete = facts.complete;
      },
    });
    return summary
      ? {
          status: 'ready',
          parserLanguage,
          summary,
          syntaxValid,
          syntaxFeatures,
          moduleSyntax,
          declarations,
          callSiteEvidence,
          callSitesComplete,
        }
      : { status: 'empty', parserLanguage };
  } catch {
    return { status: 'failed', parserLanguage };
  }
}

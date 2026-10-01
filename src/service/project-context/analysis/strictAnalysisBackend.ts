import {
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from '../../../core/facts/parserLanguage.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type {
  ProjectContextFileAnalysis,
  ProjectContextSymbolExtractor,
} from './SymbolExtractor.js';

/**
 * 严格分析后端：声明与调用事实全部来自自有的文件事实，但对"结果不完整"的文件不给部分结果。
 *
 * 普通实时查询对解析不完整的文件仍返回能提取到的部分；经本后端的会话用于认证捕获与图构建，
 * 那里"空结果"会被当成"这个文件确实没有声明"。所以 JS/TS 文件有语法错误，或含有本层不提取
 * 成员的声明形式（namespace、匿名 default 声明）时，明确返回不可用，而不是残缺的符号表。
 * 调用点提取中途失败时符号仍然完整，只有调用关系返回不可用。
 * 其他语言的语法包对合法源码也常报错，不据此判不可用。
 */
export function createStrictAnalysisBackend(): ProjectContextSymbolExtractor {
  const analyzeFile: NonNullable<ProjectContextSymbolExtractor['analyzeFile']> = async (
    input,
    observed
  ) => {
    const unavailable = (reason: string): ProjectContextFileAnalysis => ({
      symbols: { symbols: [], unavailableReason: reason },
      ...(observed.flow
        ? { flow: { ...observed.flow, callSites: [], unavailableReason: reason } }
        : {}),
    });
    const language = resolveAstParserLanguage(input.filePath, input.language);
    if (!language || !JS_FAMILY_LANGUAGES.has(language)) {
      return observed;
    }
    if (observed.symbols.syntaxValid !== true || observed.symbols.unavailableReason) {
      Logger.debug('Strict analysis rejects a file whose syntax could not be verified', {
        filePath: input.filePath,
        syntaxValid: observed.symbols.syntaxValid,
        reason: observed.symbols.unavailableReason,
      });
      return unavailable(`Syntax verification failed or is unavailable for ${input.filePath}.`);
    }
    if (observed.symbols.syntaxFeatures?.length) {
      Logger.debug('Strict analysis rejects a file with declaration forms it does not cover', {
        filePath: input.filePath,
        features: observed.symbols.syntaxFeatures,
      });
      return unavailable(
        `Declaration coverage unavailable for ${input.filePath} (${observed.symbols.syntaxFeatures.join(', ')}).`
      );
    }
    if (
      observed.flow &&
      !observed.flow.unavailableReason &&
      observed.flow.callSitesComplete !== true
    ) {
      // 普通查询保留已经提取到的调用点；这里不能把半份调用列表当成"这个文件只有这些调用"。
      Logger.warn('Strict analysis rejects an incomplete call-site observation', {
        filePath: input.filePath,
        observedCallSites: observed.flow.callSites.length,
      });
      return {
        symbols: observed.symbols,
        flow: {
          ...observed.flow,
          callSites: [],
          unavailableReason: `Call coverage unavailable for ${input.filePath}: call-site extraction did not complete.`,
        },
      };
    }
    return observed;
  };
  return {
    analyzeFile,
    async extractSymbols(input, observed, context) {
      return (await analyzeFile(input, { symbols: observed }, context)).symbols;
    },
  };
}

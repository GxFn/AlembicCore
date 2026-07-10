/**
 * ProjectContext 解析语言单源(2026-07-10 模块能力深审产物)。
 *
 * 背景:fileFlow 与 fileSymbols 各持一份"只认 ts/js 四型"的 resolveParserLanguage 私有副本,
 * 而底层 AstAnalyzer 的语法资产(resources/grammars)与 walker(lang-swift/lang-objc/...)
 * 早已覆盖十余种语言——适配层白名单把底层能力挡在门外,Swift/ObjC/Kotlin 项目的
 * file-flow/file-symbols 自诞生(2026-06-15)起整体 unavailable(BiliDili 实证:
 * 模块关系面恒空)。本模块是唯一权威映射,新增语言只改这里。
 */
import path from 'node:path';

/** 扩展名 → AstAnalyzer 语言标识(与 resources/grammars 的 wasm 资产一一对应)。 */
export const EXTENSION_PARSER_LANGUAGE: Record<string, string> = {
  '.dart': 'dart',
  '.go': 'go',
  '.java': 'java',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  '.py': 'python',
  '.rs': 'rust',
  '.swift': 'swift',
  '.tsx': 'tsx',
};

/** AstAnalyzer 支持的语言全集(analyzeFile 的合法 lang 实参)。 */
export const AST_PARSER_LANGUAGES = new Set([
  'dart',
  'go',
  'java',
  'javascript',
  'kotlin',
  'objectivec',
  'python',
  'rust',
  'swift',
  'tsx',
  'typescript',
]);

/** JS 家族:行级 import/export 正则适用;其余语言走 AST 结构直出。 */
export const JS_FAMILY_LANGUAGES = new Set(['javascript', 'tsx', 'typescript']);

/**
 * 文件路径/语言标识 → 解析语言。扩展名优先(权威、无歧义),语言标识兜底
 * (loadSourceSliceFile 的 LanguageService 检测值,如 'swift'/'typescript')。
 * 返回 undefined = AST 不支持该语言,调用方走既有 unavailable 降级。
 */
export function resolveAstParserLanguage(filePath: string, language?: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const byExtension = EXTENSION_PARSER_LANGUAGE[extension];
  if (byExtension) {
    return byExtension;
  }
  if (language && AST_PARSER_LANGUAGES.has(language)) {
    return language;
  }
  return undefined;
}

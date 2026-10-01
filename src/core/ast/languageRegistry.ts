/**
 * @module ast/languageRegistry
 * @description 语言插件注册表与 Tree-sitter parser 生命周期。
 *
 * 只负责三件事：登记语言插件、按语言持有一个 parser、把源码解析成调用方拥有的 Tree。
 * 不做任何结构提取；提取在 analyzeFile，Guard 的树查询在 guardQueries。
 */

import Logger from '../../infrastructure/logging/Logger.js';
import type { LangPlugin, TreeSitterParser, TreeSitterTree } from './astTypes.js';
import { getParserClass, isParserReady } from './parserInit.js';

// ──────────────────────────────────────────────────────────────────
// 插件注册表
// ──────────────────────────────────────────────────────────────────

const _langPlugins: Map<string, LangPlugin> = new Map();

/**
 * 注册语言 AST 插件
 * @param langId 语言标识 (e.g. 'objectivec', 'swift', 'typescript')
 */
export function registerLanguage(langId: string, plugin: LangPlugin) {
  const previous = _parserCache.get(langId);
  // 先解除缓存所有权，再释放 WASM parser；已经返回的 Tree 仍由各调用者持有和释放。
  _parserCache.delete(langId);
  if (previous) {
    disposeParser(previous, langId, 'language-registration');
  }
  _langPlugins.set(langId, plugin);
}

/** 取已注册的语言插件；未注册返回 undefined，调用方按"无插件"优雅降级。 */
export function getLanguagePlugin(langId: string): LangPlugin | undefined {
  return _langPlugins.get(langId);
}

/** 检查 Tree-sitter 是否可用（至少有一个语言插件注册） */
export function isAvailable() {
  return isParserReady() && _langPlugins.size > 0;
}

/** 获取支持的语言列表 */
export function supportedLanguages() {
  return [..._langPlugins.keys()];
}

// ──────────────────────────────────────────────────────────────────
// Parser 管理
// ──────────────────────────────────────────────────────────────────

// Cache policy (AD4, blessed-singletons 'ast-analyzer-caches'): bounded by
// the registered language set (~a dozen entries), lives for the process,
// rebuilds deterministically from grammars. _langPlugins is the plugin
// REGISTRY (registrations, never evicted); _parserCache holds one parser
// per language and may be cleared between tests.
const _parserCache: Map<string, TreeSitterParser> = new Map();

/** Test-only: release owned parsers (grammars re-instantiate deterministically). */
export function _resetAstParserCacheForTesting(): void {
  const owned = [..._parserCache];
  _parserCache.clear();
  for (const [lang, parser] of owned) {
    disposeParser(parser, lang, 'cache-reset');
  }
}

function disposeParser(parser: TreeSitterParser, lang: string, reason: string): void {
  try {
    parser.delete();
    Logger.getInstance().debug('[AstAnalyzer] parser released', { language: lang, reason });
  } catch (error: unknown) {
    // 资源释放失败不能把已摘除的实例放回缓存，或遮蔽原有的解析失败/null 语义。
    Logger.getInstance().warn('[AstAnalyzer] parser release failed; instance retired', {
      language: lang,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function getLanguageParser(lang: string): TreeSitterParser | null {
  const ParserClass = getParserClass();
  if (!ParserClass) {
    return null;
  }
  if (_parserCache.has(lang)) {
    return _parserCache.get(lang) ?? null;
  }

  const plugin = _langPlugins.get(lang);
  if (!plugin) {
    return null;
  }

  let parser: TreeSitterParser | undefined;
  try {
    const grammar = plugin.getGrammar();
    if (!grammar) {
      return null;
    }
    parser = new ParserClass() as TreeSitterParser;
    parser.setLanguage(grammar);
    _parserCache.set(lang, parser);
    return parser;
  } catch (error: unknown) {
    if (parser) {
      disposeParser(parser, lang, 'grammar-binding-failed');
    }
    Logger.getInstance().warn('[AstAnalyzer] parser initialization failed; returning null', {
      language: lang,
      phase: parser ? 'grammar-binding' : 'grammar-or-parser-construction',
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 解析源代码为 AST 树 (供 ASTChunker 等外部模块使用)
 * @param source 源代码
 * @param lang 语言 ID (如 'javascript', 'typescript', 'python' 等)
 * @returns tree-sitter 的 rootNode 与 Tree 所有权，或 null（不支持/解析失败）。
 *          成功返回后调用方必须让 rootNode 的所有消费者完成，再对 tree 调用一次 delete()。
 */
export function parseToTree(source: string, lang: string) {
  const parser = getLanguageParser(lang);
  if (!parser) {
    return null;
  }
  let tree: TreeSitterTree | undefined;
  try {
    tree = parser.parse(source) ?? undefined;
    if (!tree) {
      return null;
    }
    return { rootNode: tree.rootNode, tree };
  } catch {
    tree?.delete();
    return null;
  }
}

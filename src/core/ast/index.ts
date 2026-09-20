/**
 * @module ast/index
 * @description 语言 AST 插件自动加载器（web-tree-sitter WASM 版）
 *
 * 初始化流程:
 *   1. 调用 initParser() — 初始化 web-tree-sitter WASM 运行时
 *   2. 顺序加载所有 .wasm 语法文件，复用未变化的二进制
 *   3. 将 Language 对象注入每个 lang-*.js 插件
 *   4. 注册到 AstAnalyzer
 *
 * .wasm 文件位于 resources/grammars/，随 npm 包一起发布。
 * 不再依赖原生 tree-sitter 编译，任何平台即装即用。
 *
 * 使用方式:
 *   import '../core/ast/index.js';  // 副作用: 注册所有可用语言插件
 *
 * 或按需:
 *   import { loadPlugins } from '../core/ast/index.js';
 *   await loadPlugins();
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Logger from '../../infrastructure/logging/Logger.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';
import { analyzeFile, registerLanguage } from '../AstAnalyzer.js';
import { ensureGrammars, inferLanguagesFromStats, reloadPlugins } from './ensureGrammars.js';
import { initParser, isParserReady, loadLanguageWasm } from './parserInit.js';

export { getParserClass, isParserReady } from './parserInit.js';

let _loaded = false;
let loading: Promise<void> | null = null;
let reloadRevision = 0;

/**
 * 重置加载标志，允许 loadPlugins() 再次执行
 * 仅由 ensureGrammars.js 在安装新包后调用
 */
export function _resetForReload() {
  _loaded = false;
  reloadRevision += 1;
}

export const CORE_GRAMMAR_RESOURCE_FILES = Object.freeze([
  'tree-sitter-dart.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-kotlin.wasm',
  'tree-sitter-objc.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-swift.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-typescript.wasm',
] as const);

export type CoreGrammarResourceFile = (typeof CORE_GRAMMAR_RESOURCE_FILES)[number];

export interface GrammarResourceEntry {
  file: CoreGrammarResourceFile;
  path: string;
  available: boolean;
}

export interface GrammarResourceLogger {
  info?(message: string): void;
  warn?(message: string): void;
}

export interface EnsureProjectGrammarResourcesOptions {
  logger?: GrammarResourceLogger;
  reload?: boolean;
}

export interface EnsureProjectGrammarResourcesResult {
  languages: string[];
  installed: string[];
  skipped: string[];
  failed: string[];
  alreadyAvailable: string[];
  reloaded: boolean;
}

export function resolveCoreGrammarResourcesDir(): string {
  return join(RESOURCES_DIR, 'grammars');
}

export function listCoreGrammarResources(): GrammarResourceEntry[] {
  const grammarDir = resolveCoreGrammarResourcesDir();
  return CORE_GRAMMAR_RESOURCE_FILES.map((file) => {
    const resourcePath = join(grammarDir, file);
    return {
      file,
      path: resourcePath,
      available: existsSync(resourcePath),
    };
  });
}

export async function ensureProjectGrammarResources(
  detectedLanguagesOrStats: readonly string[] | Record<string, number>,
  options: EnsureProjectGrammarResourcesOptions = {}
): Promise<EnsureProjectGrammarResourcesResult> {
  const languages = Array.isArray(detectedLanguagesOrStats)
    ? [...detectedLanguagesOrStats]
    : (inferLanguagesFromStats(detectedLanguagesOrStats) as string[]);
  const result = await ensureGrammars(languages, { logger: options.logger });
  const shouldReload = options.reload !== false && result.failed.length === 0;

  if (shouldReload) {
    await reloadPlugins();
  }

  return {
    languages,
    installed: result.installed,
    skipped: result.skipped,
    failed: result.failed,
    alreadyAvailable: result.alreadyAvailable,
    reloaded: shouldReload,
  };
}

export function analyzeSourceFile(
  content: string,
  language: string,
  options?: Parameters<typeof analyzeFile>[2]
): Record<string, unknown> | null {
  return analyzeFile(content, language, options) as Record<string, unknown> | null;
}

export { reloadPlugins as reloadProjectAstPlugins };

/**
 * 语言注册表 — langId → { wasmFile, module, setGrammarFn, langId, tsxWasmFile?, setTsxGrammarFn? }
 */
const LANG_REGISTRY = [
  {
    langId: 'objectivec',
    wasmFile: 'tree-sitter-objc.wasm',
    module: './lang-objc.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'swift',
    wasmFile: 'tree-sitter-swift.wasm',
    module: './lang-swift.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'typescript',
    wasmFile: 'tree-sitter-typescript.wasm',
    module: './lang-typescript.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'tsx',
    wasmFile: 'tree-sitter-tsx.wasm',
    module: './lang-typescript.js',
    setFn: 'setTsxGrammar',
    pluginKey: 'tsxPlugin',
  },
  {
    langId: 'javascript',
    wasmFile: 'tree-sitter-javascript.wasm',
    module: './lang-javascript.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'python',
    wasmFile: 'tree-sitter-python.wasm',
    module: './lang-python.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'java',
    wasmFile: 'tree-sitter-java.wasm',
    module: './lang-java.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'kotlin',
    wasmFile: 'tree-sitter-kotlin.wasm',
    module: './lang-kotlin.js',
    setFn: 'setGrammar',
  },
  { langId: 'go', wasmFile: 'tree-sitter-go.wasm', module: './lang-go.js', setFn: 'setGrammar' },
  {
    langId: 'dart',
    wasmFile: 'tree-sitter-dart.wasm',
    module: './lang-dart.js',
    setFn: 'setGrammar',
  },
  {
    langId: 'rust',
    wasmFile: 'tree-sitter-rust.wasm',
    module: './lang-rust.js',
    setFn: 'setGrammar',
  },
];

/**
 * 加载并注册所有可用的语言 AST 插件
 * 幂等 — 多次调用只执行一次
 */
export function loadPlugins(): Promise<void> {
  if (loading) {
    Logger.getInstance().debug('[AstPlugins] awaiting in-flight registration', { reloadRevision });
    return loading;
  }
  if (_loaded) {
    return Promise.resolve();
  }
  loading = loadCurrentPlugins();
  return loading;
}

async function loadCurrentPlugins(): Promise<void> {
  try {
    for (;;) {
      const revision = reloadRevision;
      const complete = await loadPluginPass();
      if (revision === reloadRevision) {
        // 部分失败仍保留可用插件，但不能标成全部就绪；后续调用可重新尝试。
        _loaded = complete;
        Logger.getInstance().debug('[AstPlugins] registration finished', { revision, complete });
        return;
      }
      // 读取 WASM 期间又收到更新：合并为下一轮刷新，避免旧一轮最后覆盖新注册。
      Logger.getInstance().debug('[AstPlugins] reload requested during registration', {
        completedRevision: revision,
        nextRevision: reloadRevision,
      });
    }
  } finally {
    // 在 Promise 完成前解除进行中状态，后来的 reload 不会加入一个已经结束的 pass。
    loading = null;
  }
}

async function loadPluginPass(): Promise<boolean> {
  // 1. 初始化 web-tree-sitter WASM 运行时
  await initParser();
  if (!isParserReady()) {
    Logger.getInstance().warn('[AstPlugins] registration deferred; parser runtime unavailable');
    return false;
  }

  // 2. 按顺序加载所有 .wasm 语法文件（并行加载偶发竞态导致失败）
  const grammars: Array<Awaited<ReturnType<typeof loadLanguageWasm>>> = [];
  for (const entry of LANG_REGISTRY) {
    try {
      grammars.push(await loadLanguageWasm(entry.wasmFile));
    } catch (error: unknown) {
      grammars.push(null);
      Logger.getInstance().warn('[AstPlugins] grammar load rejected; registration skipped', {
        language: entry.langId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 3. 逐个加载插件模块并注入 Grammar
  const moduleCache = new Map();
  let complete = true;

  for (let i = 0; i < LANG_REGISTRY.length; i++) {
    const entry = LANG_REGISTRY[i];
    const language = grammars[i];

    if (!language) {
      complete = false;
      Logger.getInstance().warn(
        '[AstPlugins] grammar unavailable; keeping any prior registration',
        {
          language: entry.langId,
          retryVia: 'loadPlugins/reloadProjectAstPlugins',
        }
      );
      continue;
    }

    try {
      // 模块缓存（TypeScript 模块被 typescript + tsx 共用）
      let mod = moduleCache.get(entry.module);
      if (!mod) {
        mod = await import(entry.module);
        moduleCache.set(entry.module, mod);
      }

      // 注入 Grammar
      mod[entry.setFn](language);

      // 注册到 AstAnalyzer
      const pluginKey = entry.pluginKey || 'plugin';
      const plugin = mod[pluginKey];
      if (plugin) {
        registerLanguage(entry.langId, plugin);
      } else {
        complete = false;
        Logger.getInstance().warn('[AstPlugins] plugin export unavailable; registration skipped', {
          language: entry.langId,
          pluginKey,
        });
      }
    } catch (error: unknown) {
      complete = false;
      Logger.getInstance().warn(
        '[AstPlugins] plugin registration failed; retry remains available',
        {
          language: entry.langId,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
  return complete;
}

// 自动加载（ESM 模块顶层 await）
await loadPlugins();

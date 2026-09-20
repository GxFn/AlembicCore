/**
 * @module ast/parserInit
 * @description web-tree-sitter 初始化器
 *
 * 统一管理 WASM 版 Parser 的生命周期：
 *   1. 调用 Parser.init() 初始化 WASM 运行时（仅一次）
 *   2. 加载 .wasm 语法文件为 Language 对象
 *   3. 提供同步的 Parser 构造与语言设置 API
 *
 * 所有 async 操作（init + wasm 加载）集中在 loadPlugins() 阶段完成，
 * 下游 analyzeFile / findCallExpressions 等保持同步调用。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Language as TreeSitterLanguage } from 'web-tree-sitter';
import Logger from '../../infrastructure/logging/Logger.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';

/** 预编译 .wasm 文件存放目录 */
const GRAMMARS_DIR = path.resolve(RESOURCES_DIR, 'grammars');

let Parser: any = null;
/** web-tree-sitter 模块命名空间 — Language.load 在这里 */
let _namespace: any = null;
let _initialized = false;
let initialization: Promise<void> | null = null;

// Language.load 会向进程级 WASM 内存装载模块，丢弃 JS 引用并不能卸载它。
// 每个 grammar 路径只保留当前内容的加载结果；内容变化仍重载，失败不缓存，安装后可重试。
const grammarLoads = new Map<
  string,
  { fingerprint: string; language: Promise<TreeSitterLanguage> }
>();

/**
 * 初始化 web-tree-sitter WASM 运行时
 * 幂等 — 多次调用只执行一次
 */
export async function initParser() {
  if (_initialized) {
    return;
  }
  initialization ??= initializeParserRuntime();
  const pending = initialization;
  try {
    await pending;
  } finally {
    // 失败后的新重试可能已开始，旧等待者不能清掉它的进行中状态。
    if (initialization === pending) {
      initialization = null;
    }
  }
}

async function initializeParserRuntime(): Promise<void> {
  try {
    // web-tree-sitter ESM: 导出 { Parser, Language, ... } 命名空间
    const mod = await import('web-tree-sitter');
    const namespace = mod.default || mod;
    // v0.25 导出 { Parser, Language, ... }，需要提取 Parser 类
    const parser = typeof namespace === 'function' ? namespace : namespace.Parser;
    await parser.init();
    // 初始化真正完成后才暴露构造函数，避免同步消费者使用尚未就绪的 WASM runtime。
    _namespace = namespace;
    Parser = parser;
    _initialized = true;
  } catch (error: unknown) {
    // web-tree-sitter 不可用时优雅降级
    _namespace = null;
    Parser = null;
    _initialized = false;
    Logger.getInstance().warn(
      '[AstParser] runtime initialization failed; retry remains available',
      {
        reason: error instanceof Error ? error.message : String(error),
        retryVia: 'initParser/loadPlugins',
      }
    );
  }
}

/** 获取 Parser 构造函数 */
export function getParserClass() {
  return Parser;
}

/** 检查 parser 是否已初始化 */
export function isParserReady() {
  return _initialized && Parser !== null;
}

/**
 * 从 resources/grammars/ 加载指定语言的 .wasm 文件
 * @param wasmFileName 如 'tree-sitter-javascript.wasm'
 * @returns Language 对象，失败返回 null
 */
export async function loadLanguageWasm(wasmFileName: string): Promise<TreeSitterLanguage | null> {
  if (!_initialized || !_namespace) {
    Logger.getInstance().debug('[AstParser] grammar skipped; parser runtime is unavailable', {
      grammar: wasmFileName,
      retryVia: 'initParser/loadPlugins',
    });
    return null;
  }

  const wasmPath = path.join(GRAMMARS_DIR, wasmFileName);
  try {
    // 自行读取 wasm 文件为 Uint8Array，绕过 ESM 下 __require("fs/promises") 的兼容问题
    const buffer = await readFile(wasmPath);
    const fingerprint = createHash('sha256').update(buffer).digest('hex');
    const cached = grammarLoads.get(wasmPath);
    if (cached?.fingerprint === fingerprint) {
      Logger.getInstance().debug('[AstParser] reusing unchanged grammar load', {
        grammar: wasmFileName,
        fingerprint,
      });
      // 也复用尚未完成的加载，避免并发重载实例化相同 WASM。
      return await cached.language;
    }
    const Language = _namespace.Language || Parser.Language;
    const language: Promise<TreeSitterLanguage> = Language.load(new Uint8Array(buffer));
    const entry = { fingerprint, language };
    grammarLoads.set(wasmPath, entry);
    try {
      return await entry.language;
    } catch (error: unknown) {
      if (grammarLoads.get(wasmPath) === entry) {
        grammarLoads.delete(wasmPath);
      }
      throw error;
    }
  } catch (error: unknown) {
    Logger.getInstance().warn('[AstParser] grammar load failed; returning null for this resource', {
      grammar: wasmFileName,
      reason: error instanceof Error ? error.message : String(error),
      retryVia: 'loadPlugins after grammar repair',
    });
    return null;
  }
}

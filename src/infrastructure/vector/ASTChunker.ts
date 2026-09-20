/**
 * ASTChunker — 基于 AST 的语法感知代码分块
 *
 * 利用 web-tree-sitter 按函数/类/方法边界分块:
 * - 保持语义完整性 (不在函数/类中间截断)
 * - 超大节点递归拆分
 * - 自动携带结构元数据 (nodeType, name, startLine, endLine)
 *
 * 支持语言: JavaScript, TypeScript, Python, Java, Kotlin, Go, Swift,
 *           Rust, Dart, ObjC (取决于已加载的 tree-sitter grammar)
 *
 * @module infrastructure/vector/ASTChunker
 */

import { estimateTokens } from '../../shared/tokenUtils.js';
import Logger from '../logging/Logger.js';
import { fixedTextRanges, validateSplitBudget } from './TextChunkRanges.js';

/** Minimal AST node shape from tree-sitter */
interface ASTNode {
  type: string;
  text?: string;
  childCount: number;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  child: (index: number) => ASTNode | null;
  childForFieldName?: (name: string) => ASTNode | null;
}

// AST 相关的延迟加载 (避免 import 时强制初始化 parser)
type ParseToTree = (
  content: string,
  langId: string
) => { rootNode: ASTNode; tree: { delete(): void } } | null;

let _astReady = false;
let _parseToTree: ParseToTree | null = null;
let _isAvailable: (() => boolean) | null = null;
let _supportedLanguages: (() => string[]) | null = null;

/**
 * 各语言的顶层可分块 AST 节点类型
 * 这些节点通常代表独立的代码单元 (函数/类/方法/接口等)
 */
const TOP_LEVEL_TYPES = new Set([
  // JavaScript / TypeScript
  'function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'export_statement',
  'lexical_declaration',
  'variable_declaration',
  // Python
  'function_definition',
  'class_definition',
  'decorated_definition',
  // Java
  'method_declaration',
  'constructor_declaration',
  'field_declaration',
  'class_body_declaration',
  // Kotlin
  'function_declaration',
  'object_declaration',
  'property_declaration',
  // Go
  'function_declaration',
  'method_declaration',
  'type_declaration',
  'const_declaration',
  'var_declaration',
  // Swift
  'function_declaration',
  'class_declaration',
  'struct_declaration',
  'protocol_declaration',
  'extension_declaration',
  // Rust
  'function_item',
  'struct_item',
  'enum_item',
  'trait_item',
  'impl_item',
  'type_item',
  'mod_item',
  'const_item',
  'static_item',
  'macro_definition',
  // Dart
  'function_definition',
  'class_definition',
  'mixin_declaration',
  'extension_declaration',
  'top_level_definition',
  // ObjC
  'class_implementation',
  'category_implementation',
  'protocol_declaration',
]);

/**
 * 语言 ID → tree-sitter langId 映射
 * LanguageService.inferLang() 返回的 id 可能不完全匹配 AST 插件注册的 langId
 */
const LANG_ID_MAP = {
  javascript: 'javascript',
  typescript: 'typescript',
  tsx: 'tsx',
  python: 'python',
  java: 'java',
  kotlin: 'kotlin',
  go: 'go',
  swift: 'swift',
  rust: 'rust',
  dart: 'dart',
  objectivec: 'objectivec',
  'objective-c': 'objectivec',
  objc: 'objectivec',
};

/**
 * 初始化 AST 解析器 (幂等, 延迟加载)
 * @returns 是否成功初始化
 */
async function ensureParser() {
  if (_astReady) {
    return true;
  }

  try {
    // 触发 AST 插件的顶层 await loadPlugins()
    await import('../../core/ast/index.js');
    const astAnalyzer = await import('../../core/AstAnalyzer.js');
    _parseToTree = astAnalyzer.parseToTree;
    _isAvailable = astAnalyzer.isAvailable;
    _supportedLanguages = astAnalyzer.supportedLanguages;
    _astReady = _isAvailable?.() ?? false;
    return _astReady;
  } catch {
    Logger.debug('[ASTChunker] Parser initialization failed; text fallback remains available');
    return false;
  }
}

/**
 * 检查 ASTChunker 是否支持指定语言
 * @param language LanguageService.inferLang() 返回的语言 ID
 */
export function isASTChunkerAvailable(language: string) {
  if (!_astReady || !_supportedLanguages) {
    return false;
  }
  const langId = (LANG_ID_MAP as Record<string, string>)[language] || language;
  const supported = _supportedLanguages();
  return supported.includes(langId);
}

/**
 * 按 AST 节点边界分块
 *
 * 策略:
 * 1. 解析源代码为 AST
 * 2. 提取根节点的直接子节点中的顶层声明 (函数/类/方法/接口等)
 * 3. 小于 maxChunkTokens 的节点作为单独 chunk
 * 4. 超大节点递归拆分 (按子节点边界)
 * 5. 非声明代码 (import, 注释等) 合并为一个 chunk
 *
 * @param content 源代码
 * @param language 语言标识 (来自 LanguageService.inferLang)
 * @param metadata 基础 metadata
 * @returns >}
 */
export function chunkByAST(
  content: string,
  language: string,
  metadata: Record<string, unknown> = {},
  options: { maxChunkTokens?: number } = {}
) {
  const { maxChunkTokens = 512 } = options;

  if (!content || content.trim().length === 0) {
    return [];
  }
  validateSplitBudget(maxChunkTokens);

  const langId = (LANG_ID_MAP as Record<string, string>)[language] || language;
  if (!_astReady || !_parseToTree) {
    Logger.debug('[ASTChunker] Parser not initialized; requesting text fallback', { language });
    return null; // 返回 null 表示不支持, 调用方应 fallback
  }

  const parsed = _parseToTree(content, langId);
  if (!parsed) {
    Logger.debug('[ASTChunker] No parse tree; requesting text fallback', { language });
    return null;
  }

  const rootNode = parsed.rootNode;
  try {
    const chunks: Array<{ content: string; metadata: Record<string, unknown> }> = [];
    const preamble: ASTNode[] = []; // 保留原跨度，不能用人为换行重建源代码。

    // 遍历根节点的直接子节点
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) {
        continue;
      }

      const nodeText = content.slice(child.startIndex, child.endIndex);
      const nodeTokens = estimateTokens(nodeText);
      const isTopLevel = TOP_LEVEL_TYPES.has(child.type);

      if (!isTopLevel) {
        // 非顶层声明 → 积累到 preamble
        preamble.push(child);
        continue;
      }

      // 先 flush preamble
      appendNodeSpan(
        chunks,
        preamble,
        content,
        { ...metadata, nodeType: 'preamble' },
        maxChunkTokens
      );
      preamble.length = 0;

      if (nodeTokens <= maxChunkTokens) {
        // 单个 chunk
        appendChunk(
          chunks,
          {
            content: nodeText,
            metadata: {
              ...metadata,
              nodeType: child.type,
              name: extractNodeName(child),
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
            },
          },
          maxChunkTokens
        );
      } else {
        // 超大节点: 递归拆分
        const subChunks = splitLargeNode(child, content, metadata, maxChunkTokens);
        chunks.push(...subChunks);
      }
    }

    // flush 剩余 preamble
    appendNodeSpan(
      chunks,
      preamble,
      content,
      { ...metadata, nodeType: 'epilogue' },
      maxChunkTokens
    );

    // 如果 AST 没有产生任何 chunk (例如空文件), 返回 null 让 fallback 处理
    if (chunks.length === 0) {
      Logger.debug('[ASTChunker] No content nodes; requesting text fallback', { language });
      return null;
    }

    // 设置 chunkIndex 和 totalChunks
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].metadata.chunkIndex = i;
      chunks[i].metadata.totalChunks = chunks.length;
      chunks[i].metadata.chunkStrategy = 'ast';
    }

    return chunks;
  } finally {
    parsed.tree.delete();
  }
}

/**
 * 递归拆分超大 AST 节点
 *
 * 策略: 按子节点边界分组, 直到每组 ≤ maxChunkTokens
 *
 * @param node tree-sitter AST node
 * @param source 完整源代码
 * @returns >}
 */
function splitLargeNode(
  node: ASTNode,
  source: string,
  metadata: Record<string, unknown>,
  maxChunkTokens: number
) {
  const chunks: Array<{ content: string; metadata: Record<string, unknown> }> = [];
  const parentName = extractNodeName(node);

  // 叶子不能再按语法拆开，交给共用文本跨度算法，仍优先对齐行边界。
  if (node.childCount === 0) {
    appendChunk(
      chunks,
      {
        content: source.slice(node.startIndex, node.endIndex),
        metadata: {
          ...metadata,
          nodeType: node.type,
          name: parentName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          splitPart: true,
        },
      },
      maxChunkTokens
    );
    return chunks;
  }

  const group: ASTNode[] = [];
  const flushGroup = () => {
    appendNodeSpan(
      chunks,
      group,
      source,
      {
        ...metadata,
        nodeType: node.type,
        name: parentName,
        splitPart: true,
      },
      maxChunkTokens
    );
    group.length = 0;
  };
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) {
      continue;
    }
    const childTokens = estimateTokens(source.slice(child.startIndex, child.endIndex));
    if (childTokens > maxChunkTokens) {
      flushGroup();
      chunks.push(...splitLargeNode(child, source, metadata, maxChunkTokens));
      continue;
    }
    const first = group[0];
    // 按真实跨度计算组预算，包含原来的空白，而不是按子节点token和猜测行号。
    if (first && estimateTokens(source.slice(first.startIndex, child.endIndex)) > maxChunkTokens) {
      flushGroup();
    }
    group.push(child);
  }
  flushGroup();

  return chunks;
}

/** 用真实 AST 起止位置物化连续分组；元数据行号与内容来自同一段原文。 */
function appendNodeSpan(
  chunks: Array<{ content: string; metadata: Record<string, unknown> }>,
  nodes: ASTNode[],
  source: string,
  metadata: Record<string, unknown>,
  maxChunkTokens: number
) {
  const first = nodes[0];
  if (!first) {
    return;
  }
  const last = nodes[nodes.length - 1];
  appendChunk(
    chunks,
    {
      content: source.slice(first.startIndex, last.endIndex),
      metadata: {
        ...metadata,
        startLine: first.startPosition.row + 1,
        endLine: last.endPosition.row + 1,
      },
    },
    maxChunkTokens
  );
}

/** 单一物化入口：叶子、preamble 和分组都遵守同一个估算预算。 */
function appendChunk(
  chunks: Array<{ content: string; metadata: Record<string, unknown> }>,
  chunk: { content: string; metadata: Record<string, unknown> },
  maxChunkTokens: number
) {
  if (estimateTokens(chunk.content) <= maxChunkTokens) {
    chunks.push(chunk);
    return;
  }
  const ranges = fixedTextRanges(chunk.content, maxChunkTokens, 0);
  Logger.debug('[ASTChunker] Oversized span split within the token budget', {
    nodeType: chunk.metadata.nodeType,
    maxChunkTokens,
    splitCount: ranges.length,
  });
  for (const { start, end } of ranges) {
    const startLine =
      typeof chunk.metadata.startLine === 'number'
        ? chunk.metadata.startLine + chunk.content.slice(0, start).split('\n').length - 1
        : undefined;
    chunks.push({
      content: chunk.content.slice(start, end),
      metadata: {
        ...chunk.metadata,
        splitPart: true,
        ...(startLine === undefined
          ? {}
          : {
              startLine,
              endLine: startLine + chunk.content.slice(start, end).split('\n').length - 1,
            }),
      },
    });
  }
}

/**
 * 从 AST 节点提取名称
 * @param node tree-sitter node
 */
function extractNodeName(node: ASTNode): string | undefined {
  // 常见模式: 节点有 name 子节点
  const nameNode = node.childForFieldName?.('name') || node.childForFieldName?.('declarator');

  if (nameNode) {
    // 可能是 identifier, operator 等
    return nameNode.text?.slice(0, 100); // 限制长度
  }

  // 某些节点类型有特殊命名子节点
  for (let i = 0; i < Math.min(node.childCount, 5); i++) {
    const child = node.child(i);
    if (child?.type === 'identifier' || child?.type === 'type_identifier') {
      return child.text?.slice(0, 100);
    }
  }

  return undefined;
}

export { ensureParser, TOP_LEVEL_TYPES, LANG_ID_MAP };

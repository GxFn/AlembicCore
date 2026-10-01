import path from 'node:path';
import type { ExtractedFileSymbol } from '../../core/facts/contracts.js';
import type { SourceSymbolNode } from '../../domain/source-graph/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

/** 一条提取出的声明与它在索引里的节点。链接结果按声明对象找回节点，不靠名字二次匹配。 */
export interface IndexedDeclaration {
  symbol: ExtractedFileSymbol;
  node: SourceSymbolNode;
}

const VARIABLE_KEYWORDS = new Set(['const', 'let', 'var', 'constant', 'variable']);

/**
 * 文件事实里的声明 → 索引符号节点。
 *
 * 标识规则：普通声明是 `path#限定名`；同一文件里限定名相同的声明（重载、getter/setter、
 * 与保留的 `#module` 撞名）追加 `@种类:位置` 消歧。同名冲突必须先消歧，不能交给 SQLite 的
 * UPSERT 静默覆盖；`#module` 始终属于文件自身。
 */
export function projectSourceGraphSymbols(
  symbols: readonly ExtractedFileSymbol[],
  filePath: string,
  generationId: string,
  extractorVersion: string
): IndexedDeclaration[] {
  const groups = new Map<string, IndexedDeclaration[]>();
  for (const symbol of symbols) {
    const declarationKind = symbol.declarationKind ?? symbol.kind;
    // 函数值的 const 绑定保留为 variable：关键字是真实证据，可调用性由调用边体现。
    const kind = VARIABLE_KEYWORDS.has(declarationKind)
      ? 'variable'
      : symbol.kind === 'constructor'
        ? 'method'
        : symbol.kind;
    const range = symbol.declarationRange ?? symbol.range;
    const qualifiedName = symbol.qualifiedName ?? symbol.name;
    const baseId = `${filePath}#${qualifiedName}`;
    const node: SourceSymbolNode = {
      generationId,
      symbolId: baseId,
      displayName: symbol.name,
      qualifiedName,
      kind,
      filePath,
      range: {
        startLine: range.startLine,
        startColumn: range.startColumn ?? 0,
        endLine: range.endLine,
        endColumn: range.endColumn ?? 0,
      },
      ...(symbol.signature ? { signature: symbol.signature } : {}),
      exported: symbol.exported ?? false,
      imported: false,
      metadata: {
        extractorVersion,
        declarationKind,
        rangePrecision:
          range.startColumn === undefined || range.endColumn === undefined ? 'line' : 'column',
        ...(symbol.compatibilitySource ? { compatibilitySource: symbol.compatibilitySource } : {}),
        // 源码写出的父类型名字。能解析到声明的另有 extends / implements 边；名字本身始终保留。
        ...(symbol.heritage ? { heritage: symbol.heritage } : {}),
      },
      provenance: { extractor: 'source-graph-file-facts' },
    };
    const group = groups.get(baseId) ?? [];
    group.push({ symbol, node });
    groups.set(baseId, group);
  }

  const result: IndexedDeclaration[] = [];
  for (const [baseId, candidates] of groups) {
    // 完全相同的记录共用一个节点；有语义差异的候选不能靠排序选赢家。
    const distinct = new Map<string, SourceSymbolNode>();
    for (const candidate of candidates) {
      const key = JSON.stringify(candidate.node);
      const existing = distinct.get(key);
      if (existing) {
        candidate.node = existing;
      } else {
        distinct.set(key, candidate.node);
      }
    }
    if (distinct.size > 1 || baseId === `${filePath}#module`) {
      for (const node of distinct.values()) {
        const range = node.range;
        node.symbolId = `${baseId}@${node.kind}:${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`;
      }
      if (new Set([...distinct.values()].map((node) => node.symbolId)).size !== distinct.size) {
        throw new Error(`Source graph cannot distinguish conflicting symbols at ${baseId}.`);
      }
      Logger.debug('Source graph disambiguated persistent symbol identities', {
        filePath,
        baseId,
        symbolIds: [...distinct.values()].map((node) => node.symbolId),
        reason: 'ambiguous-or-reserved-symbol-id',
      });
    }
    result.push(...candidates);
  }
  assignContainers(result, filePath);
  return result;
}

/** 成员指向同文件里唯一的容器声明；容器不在本文件（扩展、分类）或不唯一时不填。 */
function assignContainers(declarations: readonly IndexedDeclaration[], filePath: string): void {
  const types = new Map<string, Set<SourceSymbolNode>>();
  for (const { symbol, node } of declarations) {
    if (!symbol.container) {
      const key = symbol.qualifiedName ?? symbol.name;
      types.set(key, (types.get(key) ?? new Set()).add(node));
    }
  }
  for (const { symbol, node } of declarations) {
    const candidates = symbol.container ? types.get(symbol.container) : undefined;
    if (candidates?.size === 1) {
      const [container] = candidates;
      if (container.filePath === filePath && container !== node) {
        node.containerSymbolId = container.symbolId;
      }
    }
  }
}

/** 文件自身的节点：文件级依赖边的端点，也是模块顶层代码的调用方。 */
export function createModuleSymbol(input: {
  generationId: string;
  filePath: string;
  language: string;
  lineCount: number;
  extractorVersion?: string;
}): SourceSymbolNode {
  return {
    generationId: input.generationId,
    symbolId: moduleSymbolId(input.filePath),
    displayName: path.basename(input.filePath),
    qualifiedName: input.filePath,
    kind: 'module',
    filePath: input.filePath,
    range: { startLine: 1, startColumn: 0, endLine: Math.max(1, input.lineCount), endColumn: 0 },
    exported: true,
    imported: false,
    metadata: {
      ...(input.extractorVersion ? { extractorVersion: input.extractorVersion } : {}),
      language: input.language,
    },
    provenance: { extractor: 'source-graph-file-inventory' },
  };
}

export function moduleSymbolId(filePath: string): string {
  return `${filePath}#module`;
}

import type { SourceSymbolNode } from '../../domain/source-graph/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { ExtractedFileSymbol } from '../project-context/fileSymbols/contracts.js';

/**
 * SDK不拥有Alembic的持久ID。普通声明继续使用path#name，新成员使用qualifiedName；
 * 同名冲突必须先消歧，不能交给SQLite UPSERT静默覆盖，#module始终归文件库存所有。
 */
export function projectSourceGraphSymbols(
  symbols: readonly ExtractedFileSymbol[],
  filePath: string,
  generationId: string,
  extractorVersion: string
): SourceSymbolNode[] {
  const groups = new Map<string, SourceSymbolNode[]>();
  for (const symbol of symbols) {
    const declarationKind = symbol.declarationKind ?? symbol.kind;
    const kind = ['const', 'let', 'var', 'constant', 'variable'].includes(declarationKind)
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
      exported: symbol.exported ?? false,
      imported: false,
      metadata: {
        extractorVersion,
        declarationKind,
        rangePrecision:
          range.startColumn === undefined || range.endColumn === undefined ? 'line' : 'column',
        ...(symbol.compatibilitySource ? { compatibilitySource: symbol.compatibilitySource } : {}),
      },
      provenance: {
        extractor: symbol.compatibilitySource
          ? 'source-graph-ast-compatibility'
          : 'source-graph-codegraph-symbols',
      },
    };
    const group = groups.get(baseId) ?? [];
    group.push(node);
    groups.set(baseId, group);
  }
  const result: SourceSymbolNode[] = [];
  for (const [baseId, candidates] of groups) {
    // 同一生产结果中完全相同的记录可合并；有语义差异的候选不能靠排序选赢家。
    const group = [...new Map(candidates.map((node) => [JSON.stringify(node), node])).values()];
    if (group.length > 1 || baseId === `${filePath}#module`) {
      for (const node of group) {
        const range = node.range;
        node.symbolId = `${baseId}@${node.kind}:${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`;
      }
      if (new Set(group.map((node) => node.symbolId)).size !== group.length) {
        throw new Error(`Source graph cannot distinguish conflicting symbols at ${baseId}.`);
      }
      Logger.debug('Source graph disambiguated persistent symbol identities', {
        filePath,
        baseId,
        symbolIds: group.map((node) => node.symbolId),
        reason: 'ambiguous-or-reserved-symbol-id',
      });
    }
    result.push(...group);
  }
  return result;
}

import type { FileAstInput } from '../../../core/facts/fileAst.js';
import type {
  CodeGraphExtraction,
  CodeGraphNode,
} from '../../../infrastructure/analysis/CodeGraphProcess.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { ExtractedFileSymbol, FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';

const kinds: ReadonlyMap<string, string> = new Map([
  ['class', 'class'],
  ['interface', 'interface'],
  ['type_alias', 'type'],
  ['enum', 'enum'],
  ['function', 'function'],
  ['method', 'method'],
  ['property', 'property'],
  ['field', 'property'],
  ['variable', 'variable'],
  ['constant', 'variable'],
  ['component', 'function'],
]);

/**
 * SDK提供符号生产输入，Alembic继续拥有ref/范围/导出契约。不能以SDK id建Map：
 * 1.6.0同行A.run/B.run会碰撞；qualifiedName和位置才用于对应，绝不删除碰撞节点。
 * legacy只补真实AST明确标记的缺口，不能用全量补回掩盖SDK丢失主声明。
 */
export function normalizeCodeGraphSymbols(
  input: FileAstInput,
  extraction: CodeGraphExtraction,
  observed: FileSymbolsExtractionResult
): FileSymbolsExtractionResult {
  // 自有补充声明（顶层变量、接口成员）在 SDK 侧有等价节点，不参与合并与覆盖判定，
  // 这条路线的输出因此与补充声明出现之前一致。
  const legacy = { ...observed, symbols: observed.symbols.filter((symbol) => !symbol.supplement) };
  if (extraction.errors.length > 0) {
    return { symbols: [], unavailableReason: `CodeGraph extraction failed for ${input.filePath}.` };
  }
  const lines = input.text.split(/\r\n|\n|\r/);
  const used = new Set<ExtractedFileSymbol>();
  const mapped: { node: CodeGraphNode; symbol: ExtractedFileSymbol }[] = [];
  let placeholderCorrections = 0;
  for (const node of extraction.nodes) {
    const kind = kinds.get(node.kind);
    if (!kind || !node.name || node.name === '<anonymous>') {
      continue;
    }
    if (!hasValidRange(node, lines, input.lineCount)) {
      return {
        symbols: [],
        unavailableReason: `CodeGraph symbol range is outside ${input.filePath}.`,
      };
    }
    const qualifiedName = node.qualifiedName.replaceAll('::', '.');
    const projectedKind = kind === 'method' && node.name === 'constructor' ? 'constructor' : kind;
    const container = findContainer(node, extraction.nodes);
    const candidates = legacy.symbols.filter(
      (symbol) =>
        !used.has(symbol) &&
        (symbol.nameIsPlaceholder
          ? symbol.container === container && hasMatchingPosition(node, symbol)
          : symbol.name === node.name &&
            (symbol.qualifiedName ?? symbol.name) === qualifiedName &&
            (symbol.matchingRange || symbol.declarationRange
              ? hasMatchingPosition(node, symbol)
              : symbol.range.startLine === node.startLine)) &&
        (symbol.kind === projectedKind ||
          (projectedKind === 'method' && symbol.kind === 'property'))
    );
    const exactKinds = candidates.filter((symbol) => symbol.kind === projectedKind);
    const previous = selectEquivalentLegacy(exactKinds.length > 0 ? exactKinds : candidates);
    let symbol: ExtractedFileSymbol;
    if (previous) {
      used.add(previous);
      // 保留已消费的非碰撞range/ref、箭头字段类别与命名再导出语义。
      symbol = { ...previous, range: { ...previous.range } };
      if (previous.nameIsPlaceholder) {
        // 源AST明确标记的缺名占位才可修正；真正名为unknown的方法不会走此分支。
        symbol.name = node.name;
        symbol.qualifiedName = qualifiedName;
        placeholderCorrections += 1;
      }
    } else {
      symbol = {
        name: node.name,
        kind: projectedKind,
        filePath: input.filePath,
        qualifiedName: container ? `${container}.${node.name}` : qualifiedName || node.name,
        ...(container ? { container } : {}),
        range: { startLine: node.startLine, endLine: node.endLine },
        ...(typeof node.isExported === 'boolean' ? { exported: node.isExported } : {}),
        signature: sourceSignature(lines, node),
      };
    }
    // 公开range保留兼容投影；声明位置供SourceGraph等内部消费者使用真实UTF16坐标。
    // SDK的variable不能证明let/var，保留原kind，不制造不存在的关键字证据。
    symbol.declarationKind = previous?.declarationKind ?? node.kind;
    symbol.declarationRange = previous?.declarationRange
      ? { ...previous.declarationRange }
      : {
          startLine: node.startLine,
          endLine: node.endLine,
          ...(node.startColumn === undefined ? {} : { startColumn: node.startColumn }),
          ...(node.endColumn === undefined ? {} : { endColumn: node.endColumn }),
        };
    mapped.push({ node, symbol });
  }

  const unresolved = legacy.symbols.filter((symbol) => !used.has(symbol));
  const supplement = unresolved.filter((symbol) => isVerifiedSupplement(symbol, extraction.nodes));
  if (supplement.length !== unresolved.length) {
    const missing = unresolved.filter((symbol) => !supplement.includes(symbol));
    Logger.warn(
      'CodeGraph symbol coverage is incomplete; refusing an unverified legacy replacement',
      {
        filePath: input.filePath,
        sdkSymbols: mapped.length,
        missingSymbols: missing.slice(0, 12).map((symbol) => symbol.qualifiedName ?? symbol.name),
        missingCount: missing.length,
      }
    );
    return {
      symbols: [],
      unavailableReason: `CodeGraph symbol coverage is incomplete for ${input.filePath}.`,
    };
  }

  let columnDisambiguations = 0;
  const groups = new Map<string, typeof mapped>();
  for (const item of mapped) {
    const key = JSON.stringify([
      item.symbol.kind,
      item.symbol.qualifiedName ?? item.symbol.name,
      item.symbol.range.startLine,
      item.symbol.range.endLine,
    ]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    // 唯有真正碰撞的一组使用SDK的UTF16列。普通符号不加列，保留既有ref字节。
    if (group.some(({ node }) => node.startColumn === undefined || node.endColumn === undefined)) {
      return {
        symbols: [],
        unavailableReason: `CodeGraph symbol columns are unavailable for a collision in ${input.filePath}.`,
      };
    }
    for (const item of group) {
      item.symbol.range = {
        startLine: item.node.startLine,
        endLine: item.node.endLine,
        startColumn: item.node.startColumn,
        endColumn: item.node.endColumn,
      };
      item.symbol.signature = sourceSignature(lines, item.node);
      columnDisambiguations += 1;
    }
  }
  Logger.debug('CodeGraph symbols normalized with explicit compatibility coverage', {
    filePath: input.filePath,
    sdkSymbols: mapped.length,
    supplementSymbols: supplement.length,
    supplementSources: supplement.map((symbol) => symbol.compatibilitySource),
    duplicateSdkIds:
      extraction.nodes.length - new Set(extraction.nodes.map((node) => node.id)).size,
    columnDisambiguations,
    placeholderCorrections,
    flowProducer: 'alembic-ast',
  });
  return {
    symbols: [
      ...mapped.map(({ symbol }) => symbol),
      ...supplement.map((symbol) => ({ ...symbol, range: { ...symbol.range } })),
    ],
    syntaxValid: legacy.syntaxValid,
  };
}

function hasValidRange(node: CodeGraphNode, lines: string[], lineCount: number): boolean {
  if (
    !Number.isInteger(node.startLine) ||
    !Number.isInteger(node.endLine) ||
    node.startLine < 1 ||
    node.endLine < node.startLine ||
    node.endLine > lineCount ||
    node.endLine > lines.length
  ) {
    return false;
  }
  for (const [column, line] of [
    [node.startColumn, node.startLine],
    [node.endColumn, node.endLine],
  ] as const) {
    if (
      column !== undefined &&
      (!Number.isInteger(column) || column < 0 || column > lines[line - 1].length)
    ) {
      return false;
    }
  }
  return (
    node.startLine !== node.endLine ||
    node.startColumn === undefined ||
    node.endColumn === undefined ||
    node.startColumn <= node.endColumn
  );
}

function selectEquivalentLegacy(
  candidates: ExtractedFileSymbol[]
): ExtractedFileSymbol | undefined {
  const first = candidates[0];
  if (!first) {
    return undefined;
  }
  // 旧投影同行get/set可能完全相同；只交换等价兼容信息，不猜测不同候选的身份。
  const identity = (symbol: ExtractedFileSymbol) =>
    JSON.stringify([
      symbol.kind,
      symbol.qualifiedName,
      symbol.container,
      symbol.range,
      symbol.exported,
      symbol.signature,
      symbol.compatibilitySource,
      symbol.declarationKind,
      symbol.declarationRange,
    ]);
  return candidates.every((symbol) => identity(symbol) === identity(first)) ? first : undefined;
}

function hasMatchingPosition(node: CodeGraphNode, previous: ExtractedFileSymbol): boolean {
  const range = previous.matchingRange ?? previous.declarationRange;
  // 使用真实AST节点/initializer范围，不再从泛型或声明文本猜测同一绑定。
  return (
    !!range &&
    range.startColumn !== undefined &&
    range.endColumn !== undefined &&
    range.startLine === node.startLine &&
    range.endLine === node.endLine &&
    range.startColumn === node.startColumn &&
    range.endColumn === node.endColumn
  );
}

function isVerifiedSupplement(symbol: ExtractedFileSymbol, nodes: CodeGraphNode[]): boolean {
  const source = symbol.compatibilitySource;
  if (!source || !symbol.container) {
    return false;
  }
  const container = nodes.find(
    (node) =>
      ['class', 'interface'].includes(node.kind) &&
      node.qualifiedName.replaceAll('::', '.') === symbol.container &&
      containsLines(node, symbol)
  );
  if (!container) {
    return false;
  }
  if (source === 'method-declaration') {
    return symbol.kind === 'method';
  }
  if (
    (source === 'constructor-parameter-property' || source === 'constructor-this-assignment') &&
    symbol.kind === 'property'
  ) {
    return nodes.some(
      (node) =>
        node.kind === 'method' &&
        node.name === 'constructor' &&
        node.qualifiedName.replaceAll('::', '.') === `${symbol.container}.constructor` &&
        containsLines(node, symbol)
    );
  }
  return false;
}

function containsLines(node: CodeGraphNode, symbol: ExtractedFileSymbol): boolean {
  return node.startLine <= symbol.range.startLine && node.endLine >= symbol.range.endLine;
}

function findContainer(node: CodeGraphNode, nodes: CodeGraphNode[]): string | undefined {
  const prefix = node.qualifiedName.slice(0, -(node.name.length + 2));
  if (!node.qualifiedName.endsWith(`::${node.name}`)) {
    return undefined;
  }
  // 只认声明容器，不把SDK import/module节点或重复id当作父类。
  return nodes.find(
    (candidate) =>
      ['class', 'interface', 'enum'].includes(candidate.kind) && candidate.qualifiedName === prefix
  )?.name;
}

function sourceSignature(lines: string[], node: CodeGraphNode): string {
  const selected = lines.slice(node.startLine - 1, Math.min(node.endLine, node.startLine + 2));
  if (selected.length && node.endLine <= node.startLine + 2 && node.endColumn !== undefined) {
    selected[selected.length - 1] = selected[selected.length - 1].slice(0, node.endColumn);
  }
  if (selected.length && node.startColumn !== undefined) {
    selected[0] = selected[0].slice(node.startColumn);
  }
  const value = selected.join(' ').replace(/\s+/g, ' ').trim();
  const signature = value.split(/\s+\{|\s+=>/)[0]?.trim() ?? value;
  return signature.length > 160 ? `${signature.slice(0, 157)}...` : signature;
}

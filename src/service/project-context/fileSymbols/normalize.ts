import type {
  ProjectContextRef,
  SourceRangeSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import { createProjectContextFileSymbolRef } from '../shared/fileSymbols-fileFlow/index.js';
import { createProjectContextSourceRangeProjection } from '../shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceFileFacts } from '../sourceSlice/contracts.js';
import type { ExtractedFileSymbol } from './contracts.js';

export interface NormalizedFileSymbols {
  symbols: SymbolSummary[];
  symbolRefs: ProjectContextRef[];
  sourceSliceRefs: ProjectContextRef[];
  /**
   * 每个公开符号对应的真实声明范围。公开的 range 为兼容保留行级形态，对不上多行签名；
   * 同文件链接用这里的范围比对。只在进程内使用，不进入公开 DTO 或 ref。
   */
  declarationRanges: WeakMap<SymbolSummary, SourceRangeSummary>;
}

export function normalizeFileSymbols(input: {
  symbols: readonly ExtractedFileSymbol[];
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
}): NormalizedFileSymbols {
  const sorted = [...dedupeSymbols(input.symbols)].sort(compareSymbols);
  const symbolRefs: ProjectContextRef[] = [];
  const sourceSliceRefs: ProjectContextRef[] = [];
  const declarationRanges = new WeakMap<SymbolSummary, SourceRangeSummary>();
  const summaries = sorted.map((symbol) => {
    const sourceSliceRef = createProjectContextSourceRangeProjection({
      filePath: input.facts.filePath,
      hash: input.facts.hash,
      lineCount: input.facts.lineCount,
      mtimeMs: input.facts.mtimeMs,
      parentRef: input.fileRef.id,
      projectRoot: input.facts.projectRoot,
      range: symbol.range,
      repoId: input.facts.repoId,
      sourceFolder: input.facts.sourceFolder,
    }).ref;
    const symbolRef = createProjectContextFileSymbolRef({
      container: symbol.container,
      filePath: input.facts.filePath,
      hash: input.facts.hash,
      kind: symbol.kind,
      name: symbol.name,
      parentRef: sourceSliceRef.id,
      projectRoot: input.facts.projectRoot,
      qualifiedName: symbol.qualifiedName,
      range: symbol.range,
      repoId: input.facts.repoId,
      sourceFolder: input.facts.sourceFolder,
    });
    sourceSliceRefs.push(sourceSliceRef);
    symbolRefs.push(symbolRef);

    const summary = {
      container: symbol.container,
      exported: symbol.exported,
      filePath: input.facts.filePath,
      kind: symbol.kind,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      range: symbol.range,
      ref: symbolRef,
      signature: symbol.signature,
    } satisfies SymbolSummary;
    const declarationRange = symbol.declarationRange ?? symbol.matchingRange;
    if (declarationRange) {
      declarationRanges.set(summary, declarationRange);
    }
    return summary;
  });

  return {
    declarationRanges,
    sourceSliceRefs: dedupeRefs(sourceSliceRefs),
    symbolRefs: dedupeRefs(symbolRefs),
    symbols: summaries,
  };
}

function dedupeSymbols(symbols: readonly ExtractedFileSymbol[]): ExtractedFileSymbol[] {
  const seen = new Set<string>();
  const result: ExtractedFileSymbol[] = [];
  for (const symbol of symbols) {
    const key = [
      symbol.kind,
      symbol.qualifiedName ?? symbol.name,
      symbol.range.startLine,
      symbol.range.endLine,
      // 仅有证据的同行碰撞携带真实列，不能在公开投影前再次合并。
      symbol.range.startColumn ?? '',
      symbol.range.endColumn ?? '',
    ].join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(symbol);
  }
  return result;
}

function dedupeRefs(refs: readonly ProjectContextRef[]): ProjectContextRef[] {
  const seen = new Set<string>();
  const result: ProjectContextRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) {
      continue;
    }
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}

function compareSymbols(left: ExtractedFileSymbol, right: ExtractedFileSymbol): number {
  return (
    compareRanges(left.range, right.range) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind) ||
    (left.container ?? '').localeCompare(right.container ?? '') ||
    (left.range.startColumn ?? 0) - (right.range.startColumn ?? 0) ||
    (left.range.endColumn ?? 0) - (right.range.endColumn ?? 0)
  );
}

function compareRanges(left: SourceRangeSummary, right: SourceRangeSummary): number {
  return left.startLine - right.startLine || left.endLine - right.endLine;
}

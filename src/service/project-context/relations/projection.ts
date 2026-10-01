import type { ExtractedFileSymbol } from '../../../core/facts/contracts.js';
import type {
  FileSummary,
  ProjectContextRef,
  RelationEndpointSummary,
  RelationResolutionSummary,
  RelationSummary,
  SourceRangeSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import type {
  SourceFileNode,
  SourceGraphEdge,
  SourceSymbolNode,
} from '../../../domain/source-graph/index.js';
import { normalizeFileSymbols } from '../fileSymbols/normalize.js';
import { createProjectContextFileFlowRelationRef } from '../shared/fileFlow-moduleLayers/index.js';
import {
  createProjectContextFileRef,
  createProjectContextSourceRangeProjection,
} from '../shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceFileFacts } from '../sourceSlice/contracts.js';

/** 一次查询的导航范围：引用里的项目根、仓库与源码目录来自请求，不来自索引。 */
export interface RelationProjectionScope {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}

/**
 * 索引的节点 → 协议的符号、文件与关系。
 *
 * 身份必须与按文件现算的查询一致：同一个声明，file-symbols 给的引用与这里给的引用是同一个 id。
 * 为此符号走的是同一个归一化函数，输入取索引里记下的公开种类、公开范围与内容短哈希。
 */
export function createRelationProjection(scope: RelationProjectionScope) {
  const fileSummaries = new Map<SourceFileNode, FileSummary>();
  const symbolSummaries = new Map<SourceSymbolNode, SymbolSummary>();

  const factsOf = (file: SourceFileNode): SourceSliceFileFacts =>
    ({
      filePath: file.repoRelativePath,
      // 协议的短哈希是内容哈希的前 16 位；两边哈希的是同一份文本。
      hash: shortHash(file),
      lineCount: file.lineCount ?? 1,
      mtimeMs: file.mtimeMs,
      projectRoot: scope.projectRoot,
      repoId: scope.repoId,
      sourceFolder: scope.sourceFolder,
    }) as SourceSliceFileFacts;

  const fileRef = (file: SourceFileNode): ProjectContextRef =>
    createProjectContextFileRef({
      filePath: file.repoRelativePath,
      hash: shortHash(file),
      projectRoot: scope.projectRoot,
      repoId: scope.repoId,
      sourceFolder: scope.sourceFolder,
    });

  const fileSummary = (file: SourceFileNode): FileSummary => {
    let summary = fileSummaries.get(file);
    if (!summary) {
      summary = {
        filePath: file.repoRelativePath,
        hash: shortHash(file),
        language: file.language,
        lineCount: file.lineCount,
        mtimeMs: file.mtimeMs,
        ref: fileRef(file),
        repoId: scope.repoId,
      };
      fileSummaries.set(file, summary);
    }
    return summary;
  };

  const symbolSummary = (symbol: SourceSymbolNode, file: SourceFileNode): SymbolSummary => {
    let summary = symbolSummaries.get(symbol);
    if (!summary) {
      const outline = readOutline(symbol);
      const extracted: ExtractedFileSymbol = {
        name: symbol.displayName,
        kind: outline.kind,
        filePath: symbol.filePath,
        range: outline.range,
        exported: symbol.exported,
        qualifiedName: symbol.qualifiedName ?? symbol.displayName,
        signature: symbol.signature,
        container: outline.container,
      };
      summary = normalizeFileSymbols({
        symbols: [extracted],
        facts: factsOf(file),
        fileRef: fileRef(file),
      }).symbols[0];
      symbolSummaries.set(symbol, summary);
    }
    return summary;
  };

  /** 关系的一端：声明是符号端点；文件自身（`#module`）是文件端点。 */
  const endpoint = (
    symbol: SourceSymbolNode | undefined,
    file: SourceFileNode | undefined,
    fallbackPath: string | undefined
  ): RelationEndpointSummary | undefined => {
    if (symbol && file && symbol.kind !== 'module') {
      const summary = symbolSummary(symbol, file);
      return {
        filePath: summary.filePath,
        label: summary.qualifiedName ?? summary.name,
        qualifiedName: summary.qualifiedName,
        ref: summary.ref,
        symbol: summary.name,
      };
    }
    if (file) {
      return { filePath: file.repoRelativePath, label: file.repoRelativePath, ref: fileRef(file) };
    }
    return fallbackPath ? { filePath: fallbackPath, label: fallbackPath } : undefined;
  };

  const relationSummary = (input: {
    edge: SourceGraphEdge;
    from?: SourceSymbolNode;
    fromFile?: SourceFileNode;
    to?: SourceSymbolNode;
    toFile?: SourceFileNode;
    /** 关系发生处所在的文件；位置与引用里的哈希都属于它。 */
    siteFile?: SourceFileNode;
  }): RelationSummary => {
    const { edge } = input;
    const from = endpoint(input.from, input.fromFile, edge.fromFilePath);
    const to = endpoint(input.to, input.toFile, edge.toFilePath);
    const site = input.siteFile ?? input.fromFile;
    const range = siteRange(edge);
    const label = `${from?.label ?? '?'} ${edge.kind} ${to?.label ?? '?'}`;
    const facts = site ? factsOf(site) : undefined;
    const sourceRef =
      facts && range
        ? createProjectContextSourceRangeProjection({
            filePath: facts.filePath,
            hash: facts.hash,
            lineCount: facts.lineCount,
            mtimeMs: facts.mtimeMs,
            parentRef: site ? fileRef(site).id : undefined,
            projectRoot: scope.projectRoot,
            range,
            repoId: scope.repoId,
            sourceFolder: scope.sourceFolder,
          }).ref
        : undefined;
    const ref =
      facts && range
        ? createProjectContextFileFlowRelationRef({
            filePath: facts.filePath,
            hash: facts.hash,
            label,
            parentRef: sourceRef?.id,
            projectRoot: scope.projectRoot,
            qualifiedName: to?.qualifiedName,
            range,
            relationKind: edge.kind,
            repoId: scope.repoId,
            sourceFolder: scope.sourceFolder,
            symbolName: to?.symbol,
            targetFilePath: to?.symbol ? undefined : to?.filePath,
            unresolved: false,
          })
        : undefined;
    return {
      kind: edge.kind,
      label,
      from,
      to,
      fromRef: from?.ref,
      toRef: to?.ref,
      targetRef: to?.ref,
      filePath: site?.repoRelativePath ?? edge.siteFilePath ?? edge.fromFilePath,
      ...(range ? { range } : {}),
      ...(ref ? { ref } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      unresolved: false,
      resolution: readResolution(edge),
    };
  };

  return { fileRef, fileSummary, symbolSummary, relationSummary };
}

export type RelationProjection = ReturnType<typeof createRelationProjection>;

function shortHash(file: SourceFileNode): string {
  return file.contentHash.slice(0, 16);
}

/** 协议对外用的种类与范围；旧代际没有记下时退回节点自己的种类与按行的范围。 */
function readOutline(symbol: SourceSymbolNode): {
  kind: string;
  range: SourceRangeSummary;
  container?: string;
} {
  const outline = symbol.metadata.outline;
  if (isRecord(outline) && typeof outline.kind === 'string' && isRange(outline.range)) {
    return {
      kind: outline.kind,
      range: outline.range,
      ...(typeof outline.container === 'string' ? { container: outline.container } : {}),
    };
  }
  return {
    kind: symbol.kind,
    range: { startLine: symbol.range.startLine, endLine: symbol.range.endLine },
  };
}

/** 关系发生的位置；没有精确列的语言只给行。 */
function siteRange(edge: SourceGraphEdge): SourceRangeSummary | undefined {
  const site = edge.site;
  if (!site) {
    return undefined;
  }
  const hasColumns = site.startColumn !== 0 || site.endColumn !== 0;
  return {
    startLine: site.startLine,
    endLine: site.endLine,
    ...(hasColumns ? { startColumn: site.startColumn, endColumn: site.endColumn } : {}),
  };
}

function readResolution(edge: SourceGraphEdge): RelationResolutionSummary {
  const resolution = edge.metadata.resolution;
  const record = isRecord(resolution) ? resolution : {};
  const tier = record.tier;
  return {
    linker: typeof record.linker === 'string' ? record.linker : 'unknown',
    strategy: typeof record.strategy === 'string' ? record.strategy : 'unknown',
    // 没有解析记录的边按来源判断：确定性来源算确定档，其余只算可信档。
    tier:
      tier === 'certain' || tier === 'trusted' || tier === 'candidate'
        ? tier
        : edge.provenance === 'deterministic'
          ? 'certain'
          : 'trusted',
    confidence: edge.confidence,
  };
}

function isRange(value: unknown): value is SourceRangeSummary {
  return isRecord(value) && Number.isInteger(value.startLine) && Number.isInteger(value.endLine);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

import { resolveAstParserLanguage } from '../../../core/facts/parserLanguage.js';
import {
  findCalleeSymbol,
  findCallerSymbol,
  hasImplicitMemberCalls,
} from '../../../core/linking/lexicalLinker.js';
import type { ModuleAliasConfig } from '../../../core/linking/moduleAliases.js';
import { MODULE_SOURCE_EXTENSIONS } from '../../../core/linking/moduleTargets.js';
import type {
  FileSummary,
  ProjectContextRef,
  RelationEndpointSummary,
  RelationSummary,
  SourceRangeSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import { nodeProjectSourceReader } from '../../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { createProjectContextFileFlowRelationRef } from '../shared/fileFlow-moduleLayers/index.js';
import { dedupeProjectContextRefs as dedupeRefs } from '../shared/refs.js';
import {
  createProjectContextFileRef,
  createProjectContextSourceRangeProjection,
} from '../shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceFileFacts } from '../sourceSlice/contracts.js';
import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowExport,
  ExtractedFileFlowImport,
  FileFlowQueryFailure,
  ResolvedFileFlowImportTarget,
} from './contracts.js';
import { findModuleFile } from './moduleFile.js';

export interface NormalizedFileFlow {
  file: FileSummary;
  imports: RelationSummary[];
  exports: SymbolSummary[];
  callers: RelationSummary[];
  callees: RelationSummary[];
  inflow: RelationSummary[];
  outflow: RelationSummary[];
  nextRefs: ProjectContextRef[];
  refs: ProjectContextRef[];
  warnings: FileFlowQueryFailure[];
}

type ModuleTargetResolver = (specifier: string) => Promise<ResolvedFileFlowImportTarget>;

export async function normalizeFileFlow(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  imports: readonly ExtractedFileFlowImport[];
  exports: readonly ExtractedFileFlowExport[];
  callSites: readonly ExtractedFileFlowCallSite[];
  symbols: readonly SymbolSummary[];
  /** 公开符号对应的真实声明范围，见 normalizeFileSymbols。 */
  declarationRanges?: WeakMap<SymbolSummary, SourceRangeSummary>;
  signal?: AbortSignal;
  sourceReader?: ProjectSourceReader;
  /** 本文件适用的模块别名配置；只在遇到非相对说明符时才加载。 */
  aliases?: () => Promise<ModuleAliasConfig | undefined>;
}): Promise<NormalizedFileFlow> {
  throwIfProjectContextAborted(input);
  // 同次文件投影中的import/export-from共用目标观察，避免同一specifier重复读存在性。
  const targets = new Map<string, Promise<ResolvedFileFlowImportTarget>>();
  const resolveTarget: ModuleTargetResolver = (specifier) => {
    throwIfProjectContextAborted(input);
    let pending = targets.get(specifier);
    if (!pending) {
      pending = resolveModuleTarget(
        input.facts,
        specifier,
        input.signal,
        input.sourceReader ?? nodeProjectSourceReader,
        input.aliases
      );
      targets.set(specifier, pending);
    } else {
      Logger.debug('ProjectContext reused its module target observation', {
        filePath: input.facts.filePath,
        specifier,
      });
    }
    return pending;
  };
  const importRelations = await normalizeImports(input, resolveTarget);
  throwIfProjectContextAborted(input);
  const exportSymbols = normalizeExportSymbols(input.symbols, input.exports);
  const exportRelations = await normalizeExportRelations(input, resolveTarget);
  const callRelations = normalizeCallSites(input);

  const inflow = callRelations.filter((relation) => relation.to?.filePath === input.facts.filePath);
  const outflow = [
    ...importRelations.relations,
    ...exportRelations.relations,
    ...callRelations,
  ].sort(compareRelations);
  const allRelations = [
    ...importRelations.relations,
    ...exportRelations.relations,
    ...callRelations,
  ];
  const nextRefs = dedupeRefs([
    ...allRelations.flatMap((relation) => [
      relation.ref,
      relation.sourceRef,
      relation.targetRef,
      relation.from?.ref,
      relation.to?.ref,
    ]),
    ...exportSymbols.map((symbol) => symbol.ref),
  ]);

  return {
    callers: [...callRelations].sort(compareCallerRelations),
    callees: [...callRelations].sort(compareCalleeRelations),
    exports: exportSymbols,
    file: {
      filePath: input.facts.filePath,
      hash: input.facts.hash,
      language: input.facts.language,
      lineCount: input.facts.lineCount,
      mtimeMs: input.facts.mtimeMs,
      ref: input.fileRef,
      repoId: input.facts.repoId,
    },
    imports: importRelations.relations,
    inflow,
    nextRefs,
    outflow,
    refs: dedupeRefs([input.fileRef, ...nextRefs]),
    warnings: [...importRelations.warnings, ...exportRelations.warnings],
  };
}

async function normalizeImports(
  input: {
    facts: SourceSliceFileFacts;
    fileRef: ProjectContextRef;
    imports: readonly ExtractedFileFlowImport[];
    signal?: AbortSignal;
    sourceReader?: ProjectSourceReader;
  },
  resolveTarget: ModuleTargetResolver
): Promise<{ relations: RelationSummary[]; warnings: FileFlowQueryFailure[] }> {
  const relations: RelationSummary[] = [];
  const warnings: FileFlowQueryFailure[] = [];
  for (const importRecord of input.imports) {
    throwIfProjectContextAborted(input);
    const target = await resolveTarget(importRecord.specifier);
    throwIfProjectContextAborted(input);
    if (target.unresolved && target.reason === 'not-found') {
      warnings.push({
        code: 'query-unavailable',
        message: `file-flow import target was not found: ${importRecord.specifier}`,
        path: input.facts.filePath,
        retryable: false,
      });
    }
    relations.push(
      createRelationSummary({
        direction: 'outflow',
        facts: input.facts,
        fileRef: input.fileRef,
        from: {
          filePath: input.facts.filePath,
          label: input.facts.filePath,
          ref: input.fileRef,
        },
        kind: 'imports',
        label: `${input.facts.filePath} imports ${importRecord.specifier}`,
        range: importRecord.range,
        reason: target.reason,
        specifier: importRecord.specifier,
        symbolName: importRecord.symbols.join(',') || undefined,
        target,
        to: createImportTargetEndpoint(target),
        unresolved: target.unresolved,
      })
    );
  }
  return {
    relations: dedupeRelations(relations),
    warnings,
  };
}

function normalizeExportSymbols(
  symbols: readonly SymbolSummary[],
  exports: readonly ExtractedFileFlowExport[]
): SymbolSummary[] {
  const exportedNames = new Set(
    exports
      .filter((item) => item.specifier === undefined)
      .flatMap((item) => [item.name, item.exportedName].filter(Boolean) as string[])
  );
  return symbols
    .filter(
      (symbol) =>
        symbol.exported === true ||
        exportedNames.has(symbol.name) ||
        exportedNames.has(symbol.qualifiedName ?? symbol.name)
    )
    .sort(compareSymbols);
}

async function normalizeExportRelations(
  input: {
    facts: SourceSliceFileFacts;
    fileRef: ProjectContextRef;
    exports: readonly ExtractedFileFlowExport[];
    symbols: readonly SymbolSummary[];
    signal?: AbortSignal;
  },
  resolveTarget: ModuleTargetResolver
): Promise<{ relations: RelationSummary[]; warnings: FileFlowQueryFailure[] }> {
  const relations: RelationSummary[] = [];
  const warnings: FileFlowQueryFailure[] = [];
  for (const exportRecord of input.exports) {
    throwIfProjectContextAborted(input);
    const target =
      exportRecord.specifier === undefined
        ? undefined
        : await resolveTarget(exportRecord.specifier);
    throwIfProjectContextAborted(input);
    // export-from不会创建本地绑定，同名本地函数也不能充当这个导出声明的symbol。
    const symbol = target ? undefined : findSymbolForExport(input.symbols, exportRecord);
    if (target?.reason === 'not-found') {
      warnings.push({
        code: 'query-unavailable',
        message: `file-flow re-export target was not found: ${target.specifier}`,
        path: input.facts.filePath,
        retryable: false,
      });
    }
    relations.push(
      createRelationSummary({
        direction: 'outflow',
        facts: input.facts,
        fileRef: input.fileRef,
        from: target
          ? {
              filePath: input.facts.filePath,
              label: input.facts.filePath,
              ref: input.fileRef,
            }
          : {
              filePath: input.facts.filePath,
              label: symbol?.qualifiedName ?? exportRecord.name,
              qualifiedName: symbol?.qualifiedName,
              ref: symbol?.ref,
              symbol: symbol?.name ?? exportRecord.name,
            },
        kind: 'exports',
        label: `${input.facts.filePath} exports ${exportRecord.exportedName ?? exportRecord.name}`,
        range: exportRecord.range,
        specifier: exportRecord.specifier,
        symbolName: exportRecord.name,
        // export关系继续按原specifier生成ID；目标file ref单独挂在to，不改历史关系身份。
        to: target ? createImportTargetEndpoint(target) : { label: 'public export surface' },
        reason: target?.reason,
        unresolved: target?.unresolved,
      })
    );
  }
  return { relations: dedupeRelations(relations), warnings };
}

function normalizeCallSites(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  callSites: readonly ExtractedFileFlowCallSite[];
  symbols: readonly SymbolSummary[];
  declarationRanges?: WeakMap<SymbolSummary, SourceRangeSummary>;
}): RelationSummary[] {
  // 链接用带真实声明范围的视图，产出仍是原来的公开符号对象。
  const linkable = input.symbols.map((summary) => ({
    name: summary.name,
    qualifiedName: summary.qualifiedName,
    container: summary.container,
    range: summary.range,
    declarationRange: input.declarationRanges?.get(summary),
    summary,
  }));
  const implicitMembers = hasImplicitMemberCalls(
    resolveAstParserLanguage(input.facts.filePath, input.facts.language)
  );
  const entries = input.callSites.map((callSite) => {
    const callerMatch = findCallerSymbol(linkable, callSite);
    const calleeMatch = findCalleeSymbol(linkable, callSite, implicitMembers);
    const caller = { ...callerMatch, symbol: callerMatch.symbol?.summary };
    const originalCallee = { ...calleeMatch, symbol: calleeMatch.symbol?.summary };
    const callee = callSite.resolvedTarget ? { symbol: callSite.resolvedTarget } : originalCallee;
    const reason = [caller.reason, callee.reason].filter(Boolean).join('; ') || undefined;
    const relationInput: Parameters<typeof createRelationSummary>[0] = {
      direction: 'internal',
      facts: input.facts,
      fileRef: input.fileRef,
      from: caller.fileCaller
        ? { filePath: input.facts.filePath, label: input.facts.filePath, ref: input.fileRef }
        : createSymbolEndpoint({
            fallback:
              callSite.callerQualifiedName ??
              (callSite.callerClass
                ? `${callSite.callerClass}.${callSite.callerMethod}`
                : callSite.callerMethod),
            filePath: input.facts.filePath,
            symbol: caller.symbol,
          }),
      kind: 'calls',
      label: `${callSite.callerClass ? `${callSite.callerClass}.` : ''}${callSite.callerMethod} calls ${callSite.callee}`,
      range: callSite.range,
      // 新增跨文件目标不重写既有调用位置ID；语义目标通过原to/targetRef字段给出。
      referenceQualifiedName: { value: originalCallee.symbol?.qualifiedName },
      reason,
      symbolName: callSite.callee,
      to: createSymbolEndpoint({
        fallback: callSite.callee,
        filePath: callSite.resolvedTarget?.filePath ?? input.facts.filePath,
        symbol: callee.symbol,
      }),
      unresolved: reason !== undefined,
    };
    return { callSite, relationInput, relation: createRelationSummary(relationInput) };
  });
  const groups = new Map<string | undefined, typeof entries>();
  for (const entry of entries) {
    const key = entry.relation.ref?.id;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  // 普通行级ref继续逐字兼容。只有同一个ref确实对应不同AST调用位置时才升级为真实列；
  // 缺少列的旧生产方仍按原ref去重，不能拿SDK id或数组序号伪造源码位置。
  const relations: RelationSummary[] = [];
  for (const group of groups.values()) {
    const ranges = group.map(({ callSite }) => callSite.matchingRange);
    const located = ranges.every(hasColumns);
    const distinctLocations = new Set(ranges.map(rangeKey));
    for (const entry of group) {
      relations.push(
        located && distinctLocations.size > 1
          ? createRelationSummary({
              ...entry.relationInput,
              range: entry.callSite.matchingRange ?? entry.callSite.range,
            })
          : entry.relation
      );
    }
  }
  return dedupeRelations(relations);
}

function hasColumns(range: SourceRangeSummary | undefined): range is SourceRangeSummary {
  return (
    range !== undefined && Number.isInteger(range.startColumn) && Number.isInteger(range.endColumn)
  );
}

function rangeKey(range: SourceRangeSummary | undefined): string {
  return range
    ? [range.startLine, range.endLine, range.startColumn ?? '', range.endColumn ?? ''].join(':')
    : '';
}

function createRelationSummary(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  kind: string;
  direction: 'inflow' | 'outflow' | 'internal';
  label: string;
  range: ExtractedFileFlowImport['range'];
  from?: RelationEndpointSummary;
  to?: RelationEndpointSummary;
  target?: ResolvedFileFlowImportTarget;
  specifier?: string;
  symbolName?: string;
  unresolved?: boolean;
  reason?: string;
  referenceQualifiedName?: { value?: string };
}): RelationSummary {
  const sourceProjection = createProjectContextSourceRangeProjection({
    filePath: input.facts.filePath,
    hash: input.facts.hash,
    lineCount: input.facts.lineCount,
    mtimeMs: input.facts.mtimeMs,
    parentRef: input.fileRef.id,
    projectRoot: input.facts.projectRoot,
    range: input.range,
    repoId: input.facts.repoId,
    sourceFolder: input.facts.sourceFolder,
  });
  const relationRef = createProjectContextFileFlowRelationRef({
    direction: input.direction,
    filePath: input.facts.filePath,
    hash: input.facts.hash,
    label: input.label,
    parentRef: sourceProjection.ref.id,
    projectRoot: input.facts.projectRoot,
    qualifiedName: input.referenceQualifiedName
      ? input.referenceQualifiedName.value
      : input.to?.qualifiedName,
    range: input.range,
    reason: input.reason,
    relationKind: input.kind,
    repoId: input.facts.repoId,
    sourceFolder: input.facts.sourceFolder,
    specifier: input.specifier,
    symbolName: input.symbolName,
    targetFilePath: input.target?.filePath,
    unresolved: input.unresolved,
  });

  return {
    direction: input.direction,
    filePath: input.facts.filePath,
    from: input.from,
    fromRef: input.from?.ref,
    kind: input.kind,
    label: input.label,
    range: input.range,
    reason: input.reason,
    ref: relationRef,
    sourceRef: sourceProjection.ref,
    targetRef: input.target?.ref ?? input.to?.ref,
    to: input.to,
    toRef: input.target?.ref ?? input.to?.ref,
    unresolved: input.unresolved,
  };
}

async function resolveModuleTarget(
  facts: SourceSliceFileFacts,
  specifier: string,
  signal: AbortSignal | undefined,
  reader: ProjectSourceReader,
  aliases: (() => Promise<ModuleAliasConfig | undefined>) | undefined
): Promise<ResolvedFileFlowImportTarget> {
  const found = await findModuleFile({
    importerFile: facts.filePath,
    projectRoot: facts.projectRoot,
    specifier,
    // import 关系还要能指到 JSON 模块；调用链接只看可执行源码，用的是链接层的默认列表。
    extensions: [...MODULE_SOURCE_EXTENSIONS, '.json'],
    reader,
    signal,
    aliases,
  });
  if (found.status !== 'found') {
    return {
      reason: found.status === 'not-relative' ? 'external-or-package' : found.status,
      specifier,
      unresolved: true,
    };
  }
  return {
    filePath: found.filePath,
    ref: createProjectContextFileRef({
      filePath: found.filePath,
      projectRoot: facts.projectRoot,
      repoId: facts.repoId,
      sourceFolder: facts.sourceFolder,
    }),
    specifier,
    unresolved: false,
  };
}

function createImportTargetEndpoint(target: ResolvedFileFlowImportTarget): RelationEndpointSummary {
  return {
    filePath: target.filePath,
    label: target.filePath ?? target.specifier,
    ref: target.ref,
  };
}

function createSymbolEndpoint(input: {
  fallback: string;
  filePath: string;
  symbol?: SymbolSummary;
}): RelationEndpointSummary {
  return {
    filePath: input.symbol?.filePath ?? input.filePath,
    label: input.symbol?.qualifiedName ?? input.fallback,
    qualifiedName: input.symbol?.qualifiedName,
    ref: input.symbol?.ref,
    symbol: input.symbol?.name ?? input.fallback,
  };
}

function findSymbolForExport(
  symbols: readonly SymbolSummary[],
  exportRecord: ExtractedFileFlowExport
): SymbolSummary | undefined {
  return symbols.find(
    (symbol) =>
      symbol.name === exportRecord.name ||
      symbol.qualifiedName === exportRecord.name ||
      symbol.name === exportRecord.exportedName
  );
}

function dedupeRelations(relations: readonly RelationSummary[]): RelationSummary[] {
  return dedupeBy(
    relations,
    (relation) => relation.ref?.id ?? relation.label ?? relation.kind
  ).sort(compareRelations);
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareSymbols(left: SymbolSummary, right: SymbolSummary): number {
  return (
    compareRanges(left.range, right.range) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareCallerRelations(left: RelationSummary, right: RelationSummary): number {
  return (
    (left.from?.label ?? '').localeCompare(right.from?.label ?? '') || compareRelations(left, right)
  );
}

function compareCalleeRelations(left: RelationSummary, right: RelationSummary): number {
  return (
    (left.to?.label ?? '').localeCompare(right.to?.label ?? '') || compareRelations(left, right)
  );
}

function compareRelations(left: RelationSummary, right: RelationSummary): number {
  return (
    compareRanges(left.range, right.range) ||
    left.kind.localeCompare(right.kind) ||
    (left.label ?? '').localeCompare(right.label ?? '')
  );
}

function compareRanges(left: RelationSummary['range'], right: RelationSummary['range']): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return (
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    (left.startColumn ?? 0) - (right.startColumn ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

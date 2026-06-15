import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  FileSummary,
  ProjectContextRef,
  RelationEndpointSummary,
  RelationSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import { createProjectContextFileFlowRelationRef } from '../shared/fileFlow-moduleLayers/index.js';
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

export async function normalizeFileFlow(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  imports: readonly ExtractedFileFlowImport[];
  exports: readonly ExtractedFileFlowExport[];
  callSites: readonly ExtractedFileFlowCallSite[];
  symbols: readonly SymbolSummary[];
}): Promise<NormalizedFileFlow> {
  const importRelations = await normalizeImports(input);
  const exportSymbols = normalizeExportSymbols(input.symbols, input.exports);
  const exportRelations = normalizeExportRelations({ ...input, exports: input.exports });
  const callRelations = normalizeCallSites(input);

  const inflow = callRelations.filter((relation) => relation.to?.filePath === input.facts.filePath);
  const outflow = [...importRelations.relations, ...exportRelations, ...callRelations].sort(
    compareRelations
  );
  const allRelations = [...importRelations.relations, ...exportRelations, ...callRelations];
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
    warnings: importRelations.warnings,
  };
}

async function normalizeImports(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  imports: readonly ExtractedFileFlowImport[];
}): Promise<{ relations: RelationSummary[]; warnings: FileFlowQueryFailure[] }> {
  const relations: RelationSummary[] = [];
  const warnings: FileFlowQueryFailure[] = [];
  for (const importRecord of input.imports) {
    const target = await resolveImportTarget(input.facts, importRecord);
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
    exports.flatMap((item) => [item.name, item.exportedName].filter(Boolean) as string[])
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

function normalizeExportRelations(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  exports: readonly ExtractedFileFlowExport[];
  symbols: readonly SymbolSummary[];
}): RelationSummary[] {
  return dedupeRelations(
    input.exports.map((exportRecord) => {
      const symbol = findSymbolForExport(input.symbols, exportRecord);
      return createRelationSummary({
        direction: 'outflow',
        facts: input.facts,
        fileRef: input.fileRef,
        from: {
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
        to: {
          label: exportRecord.specifier ?? 'public export surface',
        },
      });
    })
  );
}

function normalizeCallSites(input: {
  facts: SourceSliceFileFacts;
  fileRef: ProjectContextRef;
  callSites: readonly ExtractedFileFlowCallSite[];
  symbols: readonly SymbolSummary[];
}): RelationSummary[] {
  return dedupeRelations(
    input.callSites.map((callSite) => {
      const caller = findCallerSymbol(input.symbols, callSite);
      const callee = findCalleeSymbol(input.symbols, callSite);
      return createRelationSummary({
        direction: 'internal',
        facts: input.facts,
        fileRef: input.fileRef,
        from: createSymbolEndpoint({
          fallback: callSite.callerClass
            ? `${callSite.callerClass}.${callSite.callerMethod}`
            : callSite.callerMethod,
          filePath: input.facts.filePath,
          symbol: caller,
        }),
        kind: 'calls',
        label: `${callSite.callerClass ? `${callSite.callerClass}.` : ''}${callSite.callerMethod} calls ${callSite.callee}`,
        range: callSite.range,
        reason: callee ? undefined : 'callee-unresolved',
        symbolName: callSite.callee,
        to: createSymbolEndpoint({
          fallback: callSite.callee,
          filePath: callee?.filePath ?? input.facts.filePath,
          symbol: callee,
        }),
        unresolved: callee === undefined,
      });
    })
  );
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
    qualifiedName: input.to?.qualifiedName,
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

async function resolveImportTarget(
  facts: SourceSliceFileFacts,
  importRecord: ExtractedFileFlowImport
): Promise<ResolvedFileFlowImportTarget> {
  if (!isRelativeSpecifier(importRecord.specifier)) {
    return {
      reason: 'external-or-package',
      specifier: importRecord.specifier,
      unresolved: true,
    };
  }

  const candidateBase = path.posix.normalize(
    path.posix.join(path.posix.dirname(facts.filePath), importRecord.specifier)
  );
  if (!isContainedProjectPath(candidateBase)) {
    return {
      reason: 'outside-scope',
      specifier: importRecord.specifier,
      unresolved: true,
    };
  }

  for (const candidate of createImportTargetCandidates(candidateBase)) {
    if (!isContainedProjectPath(candidate)) {
      continue;
    }
    const absolutePath = path.resolve(facts.projectRoot, candidate);
    const relativePath = path.relative(facts.projectRoot, absolutePath);
    if (!isContainedFilesystemPath(relativePath)) {
      continue;
    }
    if (await isFile(absolutePath)) {
      const filePath = toProjectContextPath(relativePath);
      return {
        filePath,
        ref: createProjectContextFileRef({
          filePath,
          projectRoot: facts.projectRoot,
          repoId: facts.repoId,
          sourceFolder: facts.sourceFolder,
        }),
        specifier: importRecord.specifier,
        unresolved: false,
      };
    }
  }

  return {
    reason: 'not-found',
    specifier: importRecord.specifier,
    unresolved: true,
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

function findCallerSymbol(
  symbols: readonly SymbolSummary[],
  callSite: ExtractedFileFlowCallSite
): SymbolSummary | undefined {
  const qualifiedName = callSite.callerClass
    ? `${callSite.callerClass}.${callSite.callerMethod}`
    : callSite.callerMethod;
  return symbols.find(
    (symbol) => symbol.qualifiedName === qualifiedName || symbol.name === callSite.callerMethod
  );
}

function findCalleeSymbol(
  symbols: readonly SymbolSummary[],
  callSite: ExtractedFileFlowCallSite
): SymbolSummary | undefined {
  const calleeName = normalizeCalleeName(callSite.callee);
  if (callSite.receiver === 'this' && callSite.callerClass) {
    const qualifiedName = `${callSite.callerClass}.${calleeName}`;
    const classMember = symbols.find((symbol) => symbol.qualifiedName === qualifiedName);
    if (classMember) {
      return classMember;
    }
  }
  return symbols.find(
    (symbol) =>
      symbol.qualifiedName === calleeName ||
      symbol.name === calleeName ||
      symbol.qualifiedName?.endsWith(`.${calleeName}`)
  );
}

function normalizeCalleeName(value: string): string {
  const withoutThis = value.replace(/^this\./, '');
  const parts = withoutThis.split('.');
  return parts[parts.length - 1] ?? withoutThis;
}

function createImportTargetCandidates(base: string): string[] {
  const extension = path.posix.extname(base);
  if (extension) {
    return createExplicitImportTargetCandidates(base, extension);
  }
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];
  return [
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.posix.join(base, `index${extension}`)),
  ];
}

function createExplicitImportTargetCandidates(base: string, extension: string): string[] {
  const stem = base.slice(0, -extension.length);
  const aliases = nodeNextSourceExtensionAliases(extension);
  return dedupeBy(
    aliases.map((candidateExtension) => `${stem}${candidateExtension}`),
    (candidate) => candidate
  );
}

function nodeNextSourceExtensionAliases(extension: string): readonly string[] {
  switch (extension) {
    case '.cjs':
      return ['.cjs', '.cts'];
    case '.js':
      return ['.js', '.ts', '.tsx'];
    case '.jsx':
      return ['.jsx', '.tsx'];
    case '.mjs':
      return ['.mjs', '.mts'];
    default:
      return [extension];
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isRelativeSpecifier(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../');
}

function isContainedProjectPath(value: string): boolean {
  return (
    value !== '' && !value.startsWith('../') && value !== '..' && !path.posix.isAbsolute(value)
  );
}

function isContainedFilesystemPath(value: string): boolean {
  return value !== '' && !value.startsWith('..') && !path.isAbsolute(value);
}

function toProjectContextPath(value: string): string {
  return value.split(path.sep).join('/');
}

function dedupeRelations(relations: readonly RelationSummary[]): RelationSummary[] {
  return dedupeBy(
    relations,
    (relation) => relation.ref?.id ?? relation.label ?? relation.kind
  ).sort(compareRelations);
}

function dedupeRefs(refs: readonly (ProjectContextRef | undefined)[]): ProjectContextRef[] {
  return dedupeBy(
    refs.filter((ref): ref is ProjectContextRef => ref !== undefined),
    (ref) => ref.id
  ).sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder || left.id.localeCompare(right.id);
  });
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
  return left.startLine - right.startLine || left.endLine - right.endLine;
}

// planFacts/project-info-tree —— 从 host 交付层 plan-tool.ts 下沉的「统一 plan 投影」纯函数簇：
// buildProjectInfoTree(12KB 硬预算金字塔 + fullTreeRef 外置) / buildProjectProfileFromAnalysis /
// collectModuleSnapshots + 全 ProjectInfo tree 类型 + PlanProjectContextAnalysis 契约，双宿主
// (host-agent + 主体 in-process)共用。U1a.3 纯提取，行为字节不变；Core 内部相对路径引依赖。
// 注：budget 从 MCP 入参解析(resolveProjectInfoTreeBudgetBytes)仍在 host 交付层，Core 只收 budgetBytes 纯数。

import {
  buildDimensionCatalogPayload,
  type DimensionCatalogPayloadItem,
  type ProjectLanguageFrameworkFacts,
} from '../../../domain/dimension/index.js';
import type {
  ProjectContextEnvelope,
  ProjectContextPresenterInput,
  ProjectContextRef,
  ProjectContextRequestKind,
  ProjectContextResult,
} from '../../../domain/project-context/index.js';
import type { DimensionDef } from '../../../types/ProjectSnapshot.js';
import type { PlanIntent } from '../intent/contracts.js';
import type { ProjectSourceFileFact } from './projectSourceFacts.js';
import {
  removeTransientTransportIfPresent,
  writeTransientTransport,
} from './transientTransport.js';

/**
 * C-1(2026-07-02 统一重构)：plan facts 精简投影的统一字节预算。
 * 此前主体 PlanSelectionGate 与宿主 plan-tool 各自硬编码 12KB——同一语义双定义，
 * 改一处漏一处。两宿主统一 import 本常量;树的收缩与 fullTreeRef 外置逻辑以它为界。
 */
export const PLAN_FACTS_PROJECTION_BUDGET_BYTES = 12 * 1024;

export interface PlanModuleSeed {
  moduleName: string;
  modulePath?: string;
  ownedFiles?: string[];
  ref?: ProjectContextRef;
  role?: string;
}

export interface PlanProjectContextAnalysis {
  contextStatus: 'complete' | 'partial';
  dimensions: DimensionDef[];
  envelopes: ProjectContextEnvelope<ProjectContextResult>[];
  factSource: 'project-context';
  fileCount: number;
  frameworks: string[];
  moduleCount: number;
  moduleSeeds: PlanModuleSeed[];
  presenterInput: ProjectContextPresenterInput;
  primaryLanguage: string;
  projectType: string;
  requestKinds: ProjectContextRequestKind[];
  secondaryLanguages: string[];
  sourceFileFacts: ProjectSourceFileFact[];
  understandingGaps: Record<string, unknown>[];
}
export type ProjectInfoDeliveredDepth = 'modules' | 'files' | 'symbols';

export interface ProjectInfoTreeMeta {
  budgetBytes: number;
  deliveredDepth: ProjectInfoDeliveredDepth;
  fullTreeRef: ProjectInfoFullTreeRef | null;
  omitted: {
    files?: number;
    modules?: number;
    symbols?: number;
  };
  truncated: boolean;
}

export interface ProjectInfoFullTreeRef {
  bytes: number;
  path: string;
}

export interface ProjectInfoTreeRoot {
  children: ProjectInfoModuleNode[];
  fileCount: number;
  frameworks: string[];
  kind: 'project';
  meta: ProjectInfoTreeMeta;
  moduleCount: number;
  primaryLanguage: string;
  projectType: string;
  secondaryLanguages: string[];
}

export interface ProjectInfoModuleNode {
  children: ProjectInfoFileNode[];
  fileCount: number;
  keyDependencies: string[];
  kind: 'module' | 'package';
  language: string;
  path: string;
  role?: string;
}

export interface ProjectInfoFileNode {
  children: ProjectInfoSymbolNode[];
  kind: 'file';
  language: string;
  lineCount: number;
  path: string;
}

export interface ProjectInfoSymbolNode {
  children: [];
  exported?: boolean;
  filePath: string;
  kind: 'symbol';
  name: string;
  signature?: string;
}

export interface ProjectInfoModuleCandidate extends Omit<ProjectInfoModuleNode, 'children'> {
  files: ProjectInfoFileCandidate[];
}

export interface ProjectInfoFileCandidate extends Omit<ProjectInfoFileNode, 'children'> {
  symbols: ProjectInfoSymbolNode[];
}

export interface ModuleSnapshot {
  files: string[];
  fingerprint: string;
  moduleId: string;
  moduleName: string;
  modulePath?: string;
  role?: string;
}

export function buildProjectInfoTree(
  analysis: PlanProjectContextAnalysis,
  budgetBytes: number
): ProjectInfoTreeRoot {
  const candidates = collectProjectInfoModuleCandidates(analysis);
  const totals = countProjectInfoCandidateTotals(candidates);
  const root: ProjectInfoTreeRoot = {
    children: [],
    fileCount: analysis.fileCount,
    frameworks: analysis.frameworks,
    kind: 'project',
    meta: buildProjectInfoTreeMeta({
      budgetBytes,
      delivered: { modules: 0, files: 0, symbols: 0 },
      totals,
    }),
    moduleCount: analysis.moduleCount,
    primaryLanguage: analysis.primaryLanguage,
    projectType: analysis.projectType,
    secondaryLanguages: analysis.secondaryLanguages,
  };

  const delivered = { modules: 0, files: 0, symbols: 0 };
  for (const candidate of candidates) {
    const moduleNode: ProjectInfoModuleNode = {
      children: [],
      fileCount: candidate.fileCount,
      keyDependencies: candidate.keyDependencies,
      kind: candidate.kind,
      language: candidate.language,
      path: candidate.path,
      ...(candidate.role ? { role: candidate.role } : {}),
    };
    if (!tryAppendProjectInfoNode(root.children, moduleNode, root, budgetBytes)) {
      continue;
    }
    delivered.modules += 1;
  }

  const modulesByPath = new Map(root.children.map((moduleNode) => [moduleNode.path, moduleNode]));
  for (const candidate of candidates) {
    const moduleNode = modulesByPath.get(candidate.path);
    if (!moduleNode) {
      continue;
    }
    for (const fileCandidate of candidate.files) {
      const fileNode: ProjectInfoFileNode = {
        children: [],
        kind: 'file',
        language: fileCandidate.language,
        lineCount: fileCandidate.lineCount,
        path: fileCandidate.path,
      };
      if (tryAppendProjectInfoNode(moduleNode.children, fileNode, root, budgetBytes)) {
        delivered.files += 1;
      }
    }
  }

  const fileNodesByPath = new Map<string, ProjectInfoFileNode>();
  for (const moduleNode of root.children) {
    for (const fileNode of moduleNode.children) {
      fileNodesByPath.set(fileNode.path, fileNode);
    }
  }
  for (const candidate of candidates) {
    for (const fileCandidate of candidate.files) {
      const fileNode = fileNodesByPath.get(fileCandidate.path);
      if (!fileNode) {
        continue;
      }
      for (const symbol of fileCandidate.symbols) {
        if (tryAppendProjectInfoNode(fileNode.children, symbol, root, budgetBytes)) {
          delivered.symbols += 1;
        }
      }
    }
  }

  root.meta = buildProjectInfoTreeMeta({ budgetBytes, delivered, totals });
  pruneProjectInfoTreeToBudget(root, budgetBytes, totals);
  return root;
}

export async function attachFullProjectInfoTreeRefIfNeeded(
  projectInfoTree: ProjectInfoTreeRoot,
  input: {
    analysis: PlanProjectContextAnalysis;
    projectRoot: string;
  }
): Promise<void> {
  if (!hasProjectInfoTreeOmissions(projectInfoTree.meta)) {
    await removeProjectInfoFullTreeIfPresent(input.projectRoot);
    projectInfoTree.meta = {
      ...projectInfoTree.meta,
      fullTreeRef: null,
    };
    return;
  }

  const fullTree = buildCompleteProjectInfoTree(input.analysis);
  const fullTreeRef = await writeProjectInfoFullTree({
    projectRoot: input.projectRoot,
    tree: fullTree,
  });
  projectInfoTree.meta = {
    ...projectInfoTree.meta,
    fullTreeRef,
  };
  pruneProjectInfoTreeToBudget(
    projectInfoTree,
    projectInfoTree.meta.budgetBytes,
    countDeliveredProjectInfoNodes(fullTree)
  );
}

export function buildCompleteProjectInfoTree(
  analysis: PlanProjectContextAnalysis
): ProjectInfoTreeRoot {
  const candidates = collectProjectInfoModuleCandidates(analysis);
  const totals = countProjectInfoCandidateTotals(candidates);
  const root = createProjectInfoTreeRoot(analysis, {
    budgetBytes: 0,
    delivered: totals,
    totals,
  });
  root.children = candidates.map((candidate) => ({
    children: candidate.files.map((file) => ({
      children: file.symbols.map((symbol) => ({ ...symbol, children: [] })),
      kind: file.kind,
      language: file.language,
      lineCount: file.lineCount,
      path: file.path,
    })),
    fileCount: candidate.fileCount,
    keyDependencies: candidate.keyDependencies,
    kind: candidate.kind,
    language: candidate.language,
    path: candidate.path,
    ...(candidate.role ? { role: candidate.role } : {}),
  }));
  root.meta = buildProjectInfoTreeMeta({
    budgetBytes: projectInfoTreeByteLength(root),
    delivered: totals,
    totals,
  });
  return root;
}

export function createProjectInfoTreeRoot(
  analysis: PlanProjectContextAnalysis,
  metaInput: Parameters<typeof buildProjectInfoTreeMeta>[0]
): ProjectInfoTreeRoot {
  return {
    children: [],
    fileCount: analysis.fileCount,
    frameworks: analysis.frameworks,
    kind: 'project',
    meta: buildProjectInfoTreeMeta(metaInput),
    moduleCount: analysis.moduleCount,
    primaryLanguage: analysis.primaryLanguage,
    projectType: analysis.projectType,
    secondaryLanguages: analysis.secondaryLanguages,
  };
}

export function collectProjectInfoModuleCandidates(
  analysis: PlanProjectContextAnalysis
): ProjectInfoModuleCandidate[] {
  const fileFacts = collectProjectInfoFileFacts(analysis);
  const moduleContexts = collectProjectInfoModuleContexts(analysis);
  const fromSnapshots = collectModuleSnapshots(analysis).flatMap((snapshot) => {
    const context =
      moduleContexts.get(snapshot.moduleId) ??
      moduleContexts.get(snapshot.modulePath ?? '') ??
      moduleContexts.get(snapshot.moduleName);
    const filePaths = uniqueStrings([
      ...snapshot.files,
      ...(context?.ownedFiles.map((file) => file.filePath) ?? []),
    ]);
    const modulePath = canonicalProjectInfoModulePath({
      files: filePaths,
      moduleId: snapshot.moduleId,
      moduleName: snapshot.moduleName,
      modulePath: snapshot.modulePath,
      role: snapshot.role ?? context?.module.role,
    });
    if (!modulePath) {
      return [];
    }
    return buildProjectInfoModuleCandidate({
      analysis,
      fileFacts,
      filePaths,
      kind: resolveProjectInfoModuleKind(context?.module.kind),
      key: snapshot.moduleId,
      keyDependencies: collectModuleKeyDependencies(context),
      language: dominantLanguage(filePaths, fileFacts),
      path: modulePath,
      role: snapshot.role ?? context?.module.role,
    });
  });

  if (fromSnapshots.length > 0) {
    const mergedSnapshots = pruneProjectInfoCandidateFileOwnership(
      mergeProjectInfoModuleCandidates(fromSnapshots)
    );
    const assignedFilePaths = new Set(
      mergedSnapshots.flatMap((candidate) => candidate.files.map((file) => file.path))
    );
    const uncoveredFilePaths = [...fileFacts.keys()].filter(
      (filePath) => !assignedFilePaths.has(filePath)
    );
    return pruneProjectInfoCandidateFileOwnership(
      mergeProjectInfoModuleCandidates([
        ...mergedSnapshots,
        ...groupFilesIntoFallbackModules(analysis, fileFacts, uncoveredFilePaths),
      ])
    ).sort((left, right) => left.path.localeCompare(right.path));
  }

  return pruneProjectInfoCandidateFileOwnership(
    groupFilesIntoFallbackModules(analysis, fileFacts, [...fileFacts.keys()])
  );
}

export function collectProjectInfoModuleContexts(
  analysis: PlanProjectContextAnalysis
): Map<string, ProjectContextPresenterInput['modules'][number]> {
  const contexts = new Map<string, ProjectContextPresenterInput['modules'][number]>();
  for (const moduleContext of analysis.presenterInput.modules) {
    for (const key of [
      normalizePath(moduleContext.module.id),
      canonicalProjectInfoModulePath({
        moduleId: moduleContext.module.id,
        moduleName: moduleContext.module.name,
        modulePath: readString(moduleContext.module, 'path'),
        role: moduleContext.module.role,
      }),
      normalizePath(readString(moduleContext.module, 'path')),
      moduleContext.module.name,
    ]) {
      if (key) {
        contexts.set(key, moduleContext);
      }
    }
  }
  return contexts;
}

export function buildProjectInfoModuleCandidate(input: {
  analysis: PlanProjectContextAnalysis;
  fileFacts: Map<string, ProjectInfoFileCandidate>;
  filePaths: readonly string[];
  key: string;
  keyDependencies: readonly string[];
  kind: ProjectInfoModuleNode['kind'];
  language: string;
  path: string;
  role?: string;
}): ProjectInfoModuleCandidate {
  const files = uniqueStrings(input.filePaths)
    .map((filePath) => input.fileFacts.get(filePath))
    .filter(isPresent);
  return {
    files,
    fileCount: files.length,
    keyDependencies: uniqueStrings(input.keyDependencies).slice(0, 8),
    kind: input.kind,
    language: input.language,
    path: input.path,
    ...(input.role ? { role: input.role } : {}),
  };
}

export function mergeProjectInfoModuleCandidates(
  candidates: readonly ProjectInfoModuleCandidate[]
): ProjectInfoModuleCandidate[] {
  const byPath = new Map<string, ProjectInfoModuleCandidate>();
  for (const candidate of candidates) {
    const modulePath = canonicalProjectInfoModulePath({
      files: candidate.files.map((file) => file.path),
      modulePath: candidate.path,
      role: candidate.role,
    });
    if (!modulePath) {
      continue;
    }
    const normalizedCandidate = { ...candidate, path: modulePath };
    const existing = byPath.get(modulePath);
    if (!existing) {
      byPath.set(modulePath, normalizedCandidate);
      continue;
    }
    const files = dedupeBy([...existing.files, ...normalizedCandidate.files], (file) => file.path);
    byPath.set(modulePath, {
      ...existing,
      files,
      fileCount: files.length,
      keyDependencies: uniqueStrings([
        ...existing.keyDependencies,
        ...normalizedCandidate.keyDependencies,
      ]).slice(0, 8),
      kind:
        existing.kind === 'package' || normalizedCandidate.kind === 'package'
          ? 'package'
          : 'module',
      language: dominantLanguageFromProjectInfoFiles(files),
      role: existing.role ?? normalizedCandidate.role,
    });
  }
  return [...byPath.values()];
}

export function pruneProjectInfoCandidateFileOwnership(
  candidates: readonly ProjectInfoModuleCandidate[]
): ProjectInfoModuleCandidate[] {
  const candidatesByFilePath = new Map<string, ProjectInfoModuleCandidate[]>();
  for (const candidate of candidates) {
    for (const file of candidate.files) {
      const existing = candidatesByFilePath.get(file.path) ?? [];
      existing.push(candidate);
      candidatesByFilePath.set(file.path, existing);
    }
  }
  return candidates
    .map((candidate) => {
      const files = candidate.files.filter((file) =>
        isProjectInfoCandidateFileOwner(candidate, file.path, candidatesByFilePath)
      );
      return {
        ...candidate,
        files,
        fileCount: files.length,
        language: dominantLanguageFromProjectInfoFiles(files),
      };
    })
    .filter((candidate) => candidate.fileCount > 0);
}

export function isProjectInfoCandidateFileOwner(
  candidate: ProjectInfoModuleCandidate,
  filePath: string,
  candidatesByFilePath: Map<string, ProjectInfoModuleCandidate[]>
): boolean {
  const candidates = candidatesByFilePath.get(filePath) ?? [];
  const pathOwners = candidates.filter((owner) =>
    projectInfoFileBelongsToPath(filePath, owner.path)
  );
  if (pathOwners.length === 0) {
    return true;
  }
  const longestOwnerPathLength = Math.max(...pathOwners.map((owner) => owner.path.length));
  return pathOwners.some(
    (owner) => owner.path === candidate.path && owner.path.length === longestOwnerPathLength
  );
}

export function projectInfoFileBelongsToPath(filePath: string, candidatePath: string): boolean {
  return filePath === candidatePath || filePath.startsWith(`${candidatePath}/`);
}

export function canonicalProjectInfoModulePath(input: {
  files?: readonly string[];
  moduleId?: string;
  moduleName?: string;
  modulePath?: string;
  role?: string;
}): string | undefined {
  const explicitPath = normalizeProjectInfoModulePath(input.modulePath);
  if (explicitPath && !isGenericProjectInfoModulePath(explicitPath, input.role)) {
    return explicitPath;
  }
  const pathFromId = normalizeProjectInfoModulePath(projectInfoPathFromModuleId(input.moduleId));
  if (pathFromId && !isGenericProjectInfoModulePath(pathFromId, input.role)) {
    return pathFromId;
  }
  const inferred = inferProjectInfoModulePathFromFiles(input.files ?? []);
  if (inferred) {
    return inferred;
  }
  const namePath = normalizeProjectInfoModulePath(input.moduleName);
  if (namePath && !isGenericProjectInfoModulePath(namePath, input.role)) {
    return namePath;
  }
  return undefined;
}

export function projectInfoPathFromModuleId(value: string | undefined): string | undefined {
  const normalized = normalizePath(value);
  if (!normalized) {
    return undefined;
  }
  if (!normalized.startsWith('module:root:')) {
    return normalized;
  }
  const parts = normalized.split(':');
  return parts.length >= 4 ? parts.slice(3).join(':') : undefined;
}

export function normalizeProjectInfoModulePath(value: string | undefined): string | undefined {
  const normalized = normalizePath(value);
  if (!normalized || normalized.startsWith('module:root:')) {
    return undefined;
  }
  return normalized;
}

export function isGenericProjectInfoModulePath(value: string, role: string | undefined): boolean {
  return value === 'module' && !role;
}

export function inferProjectInfoModulePathFromFiles(files: readonly string[]): string | undefined {
  const normalizedFiles = files.map(normalizePath).filter(isPresent);
  if (normalizedFiles.length === 0) {
    return undefined;
  }
  const topLevel = uniqueStrings(normalizedFiles.map((filePath) => filePath.split('/')[0] ?? ''));
  if (topLevel.length !== 1) {
    return undefined;
  }
  const first = normalizedFiles[0];
  if (!first) {
    return undefined;
  }
  const parts = first.split('/');
  if (parts[0] === 'Packages' && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

export function dominantLanguageFromProjectInfoFiles(
  files: readonly ProjectInfoFileCandidate[]
): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      ([leftLanguage, leftCount], [rightLanguage, rightCount]) =>
        rightCount - leftCount || leftLanguage.localeCompare(rightLanguage)
    )[0]?.[0] ?? 'unknown'
  );
}

export function collectProjectInfoFileFacts(
  analysis: PlanProjectContextAnalysis
): Map<string, ProjectInfoFileCandidate> {
  const files = dedupeBy(
    [
      ...analysis.presenterInput.files.map((file) => ({
        kind: 'file' as const,
        language: file.language ?? 'unknown',
        lineCount: file.lineCount ?? 0,
        path: file.filePath,
      })),
      ...analysis.sourceFileFacts.map((file) => ({
        kind: 'file' as const,
        language: file.language,
        lineCount: 0,
        path: file.filePath,
      })),
    ],
    (file) => file.path
  );
  return new Map(
    files
      .map((file) => ({
        ...file,
        symbols: collectProjectInfoSymbolsForFile(analysis, file.path),
      }))
      .map((file) => [file.path, file])
  );
}

export function collectProjectInfoSymbolsForFile(
  analysis: PlanProjectContextAnalysis,
  filePath: string
): ProjectInfoSymbolNode[] {
  const fromModules = analysis.presenterInput.modules.flatMap((moduleContext) =>
    moduleContext.publicSurfaces.filter((symbol) => symbol.filePath === filePath)
  );
  const fromFileSymbols = analysis.presenterInput.fileSymbols.flatMap((context) =>
    context.file.filePath === filePath ? context.symbols : []
  );
  return dedupeBy([...fromModules, ...fromFileSymbols], (symbol) => {
    return `${symbol.filePath}:${symbol.qualifiedName ?? symbol.name}:${symbol.kind}`;
  })
    .map((symbol) => ({
      children: [] as [],
      ...(symbol.exported !== undefined ? { exported: symbol.exported } : {}),
      filePath: symbol.filePath,
      kind: 'symbol' as const,
      name: symbol.qualifiedName ?? symbol.name,
      ...(symbol.signature ? { signature: symbol.signature } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectModuleKeyDependencies(
  moduleContext: ProjectContextPresenterInput['modules'][number] | undefined
): string[] {
  if (!moduleContext) {
    return [];
  }
  return uniqueStrings(
    [...moduleContext.inflow, ...moduleContext.outflow].map((relation) => {
      const endpoint = relation.direction === 'outflow' ? relation.to : relation.from;
      return endpoint?.label ?? relation.label ?? relation.kind;
    })
  );
}

export function groupFilesIntoFallbackModules(
  analysis: PlanProjectContextAnalysis,
  fileFacts: Map<string, ProjectInfoFileCandidate>,
  filePaths: readonly string[]
): ProjectInfoModuleCandidate[] {
  const byTopPath = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const topPath = filePath.split('/')[0] ?? filePath;
    const existing = byTopPath.get(topPath) ?? [];
    existing.push(filePath);
    byTopPath.set(topPath, existing);
  }
  return [...byTopPath.entries()]
    .map(([topPath, filePaths]) =>
      buildProjectInfoModuleCandidate({
        analysis,
        fileFacts,
        filePaths,
        key: topPath,
        keyDependencies: [],
        kind: 'module',
        language: dominantLanguage(filePaths, fileFacts),
        path: topPath,
        role: 'source-root',
      })
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function dominantLanguage(
  filePaths: readonly string[],
  fileFacts: Map<string, ProjectInfoFileCandidate>
): string {
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const language = fileFacts.get(filePath)?.language ?? 'unknown';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      ([leftLanguage, leftCount], [rightLanguage, rightCount]) =>
        rightCount - leftCount || leftLanguage.localeCompare(rightLanguage)
    )[0]?.[0] ?? 'unknown'
  );
}

export function resolveProjectInfoModuleKind(
  value: string | undefined
): ProjectInfoModuleNode['kind'] {
  return value === 'package' ? 'package' : 'module';
}

export function countProjectInfoCandidateTotals(
  candidates: readonly ProjectInfoModuleCandidate[]
): {
  files: number;
  modules: number;
  symbols: number;
} {
  return {
    modules: candidates.length,
    files: candidates.reduce((sum, moduleNode) => sum + moduleNode.files.length, 0),
    symbols: candidates.reduce(
      (sum, moduleNode) =>
        sum + moduleNode.files.reduce((fileSum, file) => fileSum + file.symbols.length, 0),
      0
    ),
  };
}

export function buildProjectInfoTreeMeta(input: {
  budgetBytes: number;
  delivered: { files: number; modules: number; symbols: number };
  fullTreeRef?: ProjectInfoFullTreeRef | null;
  totals: { files: number; modules: number; symbols: number };
}): ProjectInfoTreeMeta {
  const fullTreeRef = input.fullTreeRef ?? null;
  const omitted = {
    ...(input.totals.modules > input.delivered.modules
      ? { modules: input.totals.modules - input.delivered.modules }
      : {}),
    ...(input.totals.files > input.delivered.files
      ? { files: input.totals.files - input.delivered.files }
      : {}),
    ...(input.totals.symbols > input.delivered.symbols
      ? { symbols: input.totals.symbols - input.delivered.symbols }
      : {}),
  };
  return {
    budgetBytes: input.budgetBytes,
    deliveredDepth:
      input.delivered.symbols > 0 ? 'symbols' : input.delivered.files > 0 ? 'files' : 'modules',
    fullTreeRef,
    omitted,
    truncated: fullTreeRef !== null,
  };
}

export function hasProjectInfoTreeOmissions(meta: ProjectInfoTreeMeta): boolean {
  return Object.keys(meta.omitted).length > 0;
}

export function tryAppendProjectInfoNode<T>(
  children: T[],
  node: T,
  root: ProjectInfoTreeRoot,
  budgetBytes: number
): boolean {
  children.push(node);
  if (projectInfoTreeByteLength(root) <= budgetBytes) {
    return true;
  }
  children.pop();
  return false;
}

export function pruneProjectInfoTreeToBudget(
  root: ProjectInfoTreeRoot,
  budgetBytes: number,
  totals: { files: number; modules: number; symbols: number }
): void {
  while (projectInfoTreeByteLength(root) > budgetBytes) {
    if (removeLastProjectInfoSymbol(root) || removeLastProjectInfoFile(root)) {
      root.meta = buildProjectInfoTreeMeta({
        budgetBytes,
        delivered: countDeliveredProjectInfoNodes(root),
        fullTreeRef: root.meta.fullTreeRef,
        totals,
      });
      continue;
    }
    if (root.children.pop()) {
      root.meta = buildProjectInfoTreeMeta({
        budgetBytes,
        delivered: countDeliveredProjectInfoNodes(root),
        fullTreeRef: root.meta.fullTreeRef,
        totals,
      });
      continue;
    }
    break;
  }
}

export function removeLastProjectInfoSymbol(root: ProjectInfoTreeRoot): boolean {
  for (const moduleNode of [...root.children].reverse()) {
    for (const fileNode of [...moduleNode.children].reverse()) {
      if (fileNode.children.pop()) {
        return true;
      }
    }
  }
  return false;
}

export function removeLastProjectInfoFile(root: ProjectInfoTreeRoot): boolean {
  for (const moduleNode of [...root.children].reverse()) {
    if (moduleNode.children.pop()) {
      return true;
    }
  }
  return false;
}

export function countDeliveredProjectInfoNodes(root: ProjectInfoTreeRoot): {
  files: number;
  modules: number;
  symbols: number;
} {
  return {
    modules: root.children.length,
    files: root.children.reduce((sum, moduleNode) => sum + moduleNode.children.length, 0),
    symbols: root.children.reduce(
      (sum, moduleNode) =>
        sum + moduleNode.children.reduce((fileSum, file) => fileSum + file.children.length, 0),
      0
    ),
  };
}

export function projectInfoTreeByteLength(root: ProjectInfoTreeRoot): number {
  return Buffer.byteLength(JSON.stringify(root), 'utf8');
}

export async function writeProjectInfoFullTree(input: {
  projectRoot: string;
  tree: ProjectInfoTreeRoot;
}): Promise<ProjectInfoFullTreeRef> {
  return writeTransientTransport({
    name: 'plan-tree',
    payload: input.tree,
    projectRoot: input.projectRoot,
  });
}

export async function removeProjectInfoFullTreeIfPresent(projectRoot: string): Promise<void> {
  await removeTransientTransportIfPresent({ name: 'plan-tree', projectRoot });
}

export function buildProjectProfileFromAnalysis(
  analysis: PlanProjectContextAnalysis
): PlanIntent['projectProfile'] {
  return {
    fileCount: analysis.fileCount,
    frameworks: analysis.frameworks,
    moduleCount: analysis.moduleCount,
    primaryLanguage: analysis.primaryLanguage,
    projectType: analysis.projectType,
    secondaryLanguages: analysis.secondaryLanguages,
  };
}

export function collectModuleSnapshots(analysis: PlanProjectContextAnalysis): ModuleSnapshot[] {
  const fromPresenter = [
    ...arrayRecords(analysis.presenterInput.map?.modules),
    ...arrayRecords(analysis.presenterInput.modules),
  ].map((module) => {
    const files = uniqueStrings([
      ...arrayStrings(module.files),
      ...arrayRecords(module.ownedFiles)
        .map((file) => readString(file, 'filePath'))
        .filter(isPresent),
    ]);
    const moduleName =
      readString(module, 'name') ??
      readString(module, 'moduleName') ??
      readString(module, 'id') ??
      'module';
    const moduleId =
      readString(module, 'moduleId') ??
      readString(module, 'id') ??
      normalizePath(readString(module, 'path')) ??
      moduleName;
    const role = readString(module, 'role');
    return {
      files,
      fingerprint: `${role ?? ''}:${files.join('|')}`,
      moduleId,
      moduleName,
      modulePath: canonicalProjectInfoModulePath({
        files,
        moduleId,
        moduleName,
        modulePath: readString(module, 'path'),
        role,
      }),
      role,
    };
  });
  const fromSeeds = analysis.moduleSeeds.map((seed) => {
    const files = uniqueStrings(seed.ownedFiles ?? []);
    const moduleId = seed.modulePath ?? seed.moduleName;
    return {
      files,
      fingerprint: `${seed.role ?? ''}:${seed.modulePath ?? ''}:${files.join('|')}`,
      moduleId,
      moduleName: seed.moduleName,
      modulePath: normalizeProjectInfoModulePath(seed.modulePath),
      role: seed.role,
    };
  });
  return dedupeBy(
    [...fromPresenter, ...fromSeeds].filter((module) => module.moduleId),
    (module) => module.moduleId
  );
}

// ===== 私有工具（从 plan-tool 复制，byte 一致；本模块自足，不导出以免污染 barrel）=====
function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: unknown, key: string): string | undefined {
  const value = readRecord(record)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord) : [];
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function normalizePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '.') {
    return undefined;
  }
  return trimmed.replace(/\\/g, '/').replace(/\/$/, '');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function dedupeBy<T>(values: readonly T[], keyFn: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    const key = keyFn(value);
    if (key && !byKey.has(key)) {
      byKey.set(key, value);
    }
  }
  return [...byKey.values()];
}

function isPresent<T>(value: T | null | undefined | ''): value is T {
  return value !== null && value !== undefined && value !== '';
}

// ===== U1b.1：候选维度投影（buildCandidateDimensions；从 host 交付层下沉，双宿主共用）=====
export interface CandidateDimension {
  id: string;
  label: string;
  languageApplicable: boolean;
  layer: DimensionCatalogPayloadItem['layer'];
  miningGuidance: string;
}

export function buildCandidateDimensions(
  analysis: PlanProjectContextAnalysis
): CandidateDimension[] {
  const facts = buildProjectLanguageFrameworkFacts(analysis);
  return buildDimensionCatalogPayload(facts).map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    languageApplicable: dimension.languageApplicable,
    layer: dimension.layer,
    miningGuidance: dimension.extractionGuide,
  }));
}

function buildProjectLanguageFrameworkFacts(
  analysis: PlanProjectContextAnalysis
): ProjectLanguageFrameworkFacts {
  const sourceLanguages = analysis.sourceFileFacts.map((file) => file.language);
  const languages = uniqueStrings([
    analysis.primaryLanguage,
    ...analysis.secondaryLanguages,
    ...sourceLanguages,
  ]);
  return {
    frameworks: analysis.frameworks,
    languages,
    primaryLanguage: analysis.primaryLanguage,
  };
}

// ===== U3：统一 plan facts 投影入口（双宿主共用）=====
// buildPlanFactsProjection —— 把已收集的 PlanProjectContextAnalysis 投影成喂给 plan-selection AI 的
// 「精简三件套」：≤budgetBytes 的 projectInfoTree 金字塔（超预算 fullTreeRef 外置）+ candidateDimensions
// + projectProfile 画像。双宿主（host-agent MCP + 主体 in-process daemon）统一经此入口喂 AI，替代主体
// 此前 JSON.stringify(全量 facts) 的 21M 爆炸路径。完整 facts 仍由各宿主自留给下游生成，不经此入口。
export interface PlanFactsProjection {
  projectInfoTree: ProjectInfoTreeRoot;
  candidateDimensions: CandidateDimension[];
  projectProfile: PlanIntent['projectProfile'];
  /** 2026-07-02(用户决策)：每维度证据密度——plan 按真实结构情报评估规模的量化抓手。 */
  dimensionEvidenceDensity: DimensionEvidenceDensity[];
}

/**
 * 一个维度的证据密度：focusKeywords 对项目真实结构信号(文件路径/模块名/模块角色/框架)的
 * 命中统计。plan LLM 用它逐维评估证据面，替代「按文件数拍规模」的启发式——密度高的维度
 * 预算高、零命中的维度可排除。纯确定性计算，不依赖 AST/索引，冷启动第一步即可用。
 */
export interface DimensionEvidenceDensity {
  id: string;
  label: string;
  /** focusKeywords 命中的源文件路径次数。 */
  matchedFiles: number;
  /** 命中的模块信号次数(模块名/路径/角色)。 */
  matchedModules: number;
  /** 命中的框架信号次数。 */
  matchedFrameworks: number;
  /** 命中样例(≤5 条 关键词→信号，供 plan 引用与人查证)。 */
  sampleHits: string[];
  /** 归一化强度 0-100(相对本项目内各维度的命中规模)。 */
  strength: number;
}

/**
 * 计算每维度证据密度——按维度 layer 分型，避免单一路径关键词口径的系统性失真
 * (真实 workspace 冒烟：architecture 等横切维度的证据在代码内容里而非路径词里，按路径词
 * 会被压到 0；而「agent/module」这类高频词又会把个别维度推到失真的 100)。
 *   - universal(横切型)：证据面=整个代码库。strength = 结构基础分(模块数越多越高，
 *     多模块 monorepo 每模块都贡献约定) + 路径词少量加成(cap 30)。
 *   - language(语言型)：strength = 该维度适用语言的文件占比(conditions.languages 对
 *     sourceFileFacts.language 的真实统计——最准的信号，零该语言文件即 0)。
 *   - framework(框架型)：strength = frameworks 信号命中(命中即高分，未命中按路径词残余)。
 * 全部来自已收集 analysis，零额外 IO，冷启动第一步即可用。
 */
export function buildDimensionEvidenceDensity(
  analysis: PlanProjectContextAnalysis
): DimensionEvidenceDensity[] {
  const filePaths = analysis.sourceFileFacts.map((fact) => fact.filePath.toLowerCase());
  const languageCounts = new Map<string, number>();
  for (const fact of analysis.sourceFileFacts) {
    const lang = (fact.language || '').toLowerCase();
    languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
  }
  const totalFiles = Math.max(1, analysis.sourceFileFacts.length);
  const frameworkSignals = analysis.frameworks.map((framework) => framework.toLowerCase());
  // 结构基础分 cap 70：模块数是横切维度证据面的主尺度(每模块贡献约定)，8+ 模块给满基础分；
  // 留 30 给路径词加成做维度间区分，避免大型项目所有 universal 维度饱和成同一个 100。
  const structuralBase = Math.min(70, Math.round((analysis.moduleCount / 8) * 70));

  return analysis.dimensions.map((dimension) => {
    // matchTopics 是注册表维护的主题词(如 module-boundary/dependency-rule)，比 id 分词准；
    // 连字符 topic 同时保留整词与拆词两种匹配粒度。
    const keywords = uniqueStrings([
      ...(dimension.matchTopics ?? []),
      ...(dimension.matchTopics ?? []).flatMap((topic) => topic.split('-')),
      ...dimension.id.split(/[-_]/),
    ])
      .map((keyword) => keyword.toLowerCase())
      .filter((keyword) => keyword.length >= 4);

    // sampleHits 限 2 条且截尾 40 字符：密度表 25 维度全量输出，样本只做可解释性示意，
    // 不能吃掉 projection 字节预算(树的收缩逻辑不覆盖本表)。
    const sampleHits: string[] = [];
    let matchedFiles = 0;
    for (const keyword of keywords) {
      for (const filePath of filePaths) {
        if (filePath.includes(keyword)) {
          matchedFiles += 1;
          if (sampleHits.length < 2) {
            sampleHits.push(`${keyword}→${filePath.slice(-40)}`);
          }
        }
      }
    }

    const conditionLanguages = (dimension.conditions?.languages ?? []).map((lang) =>
      lang.toLowerCase()
    );
    const conditionFrameworks = (dimension.conditions?.frameworks ?? []).map((framework) =>
      framework.toLowerCase()
    );
    const languageFiles = conditionLanguages.reduce(
      (sum, lang) => sum + (languageCounts.get(lang) ?? 0),
      0
    );
    const matchedFrameworks = conditionFrameworks.filter((framework) =>
      frameworkSignals.some((signal) => signal.includes(framework))
    ).length;

    const layer = dimension.layer ?? 'universal';
    let strength: number;
    if (layer === 'language') {
      // 语言占比是唯一可信信号：零该语言文件 = 0(路径词误命中不再抬分)。
      strength = Math.round((languageFiles / totalFiles) * 100);
      if (conditionLanguages.length === 0) {
        strength = Math.min(30, Math.round((matchedFiles / totalFiles) * 100));
      }
    } else if (layer === 'framework') {
      strength =
        matchedFrameworks > 0 ? 90 : Math.min(20, Math.round((matchedFiles / totalFiles) * 100));
    } else {
      // universal：结构基础分 + 路径词少量加成(cap 30)，横切证据不依赖路径命名。
      strength = Math.min(
        100,
        structuralBase + Math.min(30, Math.round((matchedFiles / totalFiles) * 30))
      );
    }

    return {
      id: dimension.id,
      label: dimension.label ?? dimension.id,
      matchedFiles: layer === 'language' ? languageFiles : matchedFiles,
      matchedModules: layer === 'universal' ? analysis.moduleCount : 0,
      matchedFrameworks,
      // 零强度维度不带样本：排除依据是 strength=0 本身，样本只会浪费预算。
      sampleHits: strength > 0 ? sampleHits : [],
      strength,
    };
  });
}

export async function buildPlanFactsProjection(
  analysis: PlanProjectContextAnalysis,
  options: { budgetBytes: number; scope: { projectRoot: string } }
): Promise<PlanFactsProjection> {
  const projectInfoTree = buildProjectInfoTree(analysis, options.budgetBytes);
  // 超预算时把完整树写到 transient transport，并在 meta.fullTreeRef 挂引用（与 host 交付层同口径）。
  await attachFullProjectInfoTreeRefIfNeeded(projectInfoTree, {
    analysis,
    projectRoot: options.scope.projectRoot,
  });
  return {
    projectInfoTree,
    candidateDimensions: buildCandidateDimensions(analysis),
    projectProfile: buildProjectProfileFromAnalysis(analysis),
    dimensionEvidenceDensity: buildDimensionEvidenceDensity(analysis),
  };
}

// planFacts/collect-project-context —— 从 host 交付层 plan-tool.ts 下沉的「有限-requestKinds
// ProjectContext 收集器」：collectPlanProjectContext(projectRoot, hints) → PlanProjectContextAnalysis，
// honor 原生 ProjectScope、经 ProjectContextCapabilities 静态执行有限 requestKinds，双宿主
// (host-agent + 主体 in-process)共用。U1b.3 纯提取，行为字节不变；Core 内部相对路径引依赖。
// 注：projectRoot 由 host 交付层解析(resolvePlanProjectRoot 读 MCP ctx)后传入，本模块不碰 host DI。
import path, { basename } from 'node:path';
import { baseDimensions } from '../../domain/dimension/BaseDimensions.js';
import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextRequestKind,
  type ProjectContextResult,
  type RepoContext,
} from '../../domain/project-context/index.js';
import {
  loadProjectScopeForFolder,
  type ProjectDescriptor,
  type ProjectFolderDescriptor,
  readProjectScopeRegistryDocument,
} from '../../shared/ProjectScope.js';
import { ProjectContextCapabilities } from '../project-context/capabilities.js';
import type { PlanModuleSeed, PlanProjectContextAnalysis } from './project-info-tree.js';
import {
  attachSourceFilesToProjectContextModuleSeeds,
  collectProjectSourceFileFacts,
} from './project-source-facts.js';

// collectPlanProjectContext 的 hints 输入契约：从 host MCP schema PlanInput['hints'] 解耦为 Core 类型
// （结构与 draft-only planning hints 一致：focusModules/goal/maxBudget，host 传 args.hints 结构兼容）。
export interface PlanCollectHints {
  focusModules?: string[];
  goal?: string;
  maxBudget?: number;
}

interface PlanProjectScopeContext {
  displayName: string;
  projectId?: string;
  repoDisplayName: string;
  repoProjectRoot: string;
  repoSourceFolder?: string;
  scanBase: string;
  sourceFolders?: string[];
}

interface PlanProjectScopeFolderSelection {
  folder: ProjectFolderDescriptor;
  sourceFolder: string;
}

export async function collectPlanProjectContext(
  projectRoot: string,
  hints: PlanCollectHints | undefined
): Promise<PlanProjectContextAnalysis> {
  const scopeContext = resolvePlanProjectScopeContext(projectRoot, hints);
  const envelopes: ProjectContextEnvelope<ProjectContextResult>[] = [];
  const push = async (
    kind: ProjectContextRequestKind,
    payload?: Record<string, unknown>,
    options: {
      displayName: string;
      projectRoot: string;
    } = {
      displayName: scopeContext.displayName,
      projectRoot: scopeContext.scanBase,
    }
  ): Promise<ProjectContextEnvelope<ProjectContextResult>> => {
    const envelope = await ProjectContextCapabilities.execute({
      kind,
      payload,
      project: {
        displayName: options.displayName,
        projectRoot: options.projectRoot,
        source: 'codex-host-plan',
      },
      scope: { projectRoot: options.projectRoot },
    });
    envelopes.push(envelope);
    return envelope;
  };

  await push('space', {
    includeProjectTree: true,
    ...(scopeContext.projectId ? { projectId: scopeContext.projectId } : {}),
    ...(scopeContext.sourceFolders ? { sourceFolders: scopeContext.sourceFolders } : {}),
  });
  const repoEnvelope = await push(
    'repo',
    { includeMapSummary: true },
    {
      displayName: scopeContext.repoDisplayName,
      projectRoot: scopeContext.repoProjectRoot,
    }
  );
  const repo = isRepoContext(repoEnvelope.data) ? repoEnvelope.data : undefined;
  const sourceFileFacts = await collectProjectSourceFileFacts(scopeContext.scanBase, {
    sourceFolders: scopeContext.sourceFolders,
  });
  const moduleSeeds = attachSourceFilesToProjectContextModuleSeeds(
    prefixPlanModuleSeeds(selectPlanModuleSeeds(repo), scopeContext.repoSourceFolder),
    sourceFileFacts
  );
  if (moduleSeeds.length > 0) {
    await push('map', {
      moduleSeeds,
      repoName: readRecord(repo)?.repo ? readString(readRecord(repo)?.repo, 'name') : undefined,
    });
  }
  for (const seed of moduleSeeds) {
    await push('module', {
      ...seed,
      includeDependencies: true,
      includePublicSurfaces: true,
    });
    await push('module-layers', {
      ...seed,
      includeBoundaryCrossings: true,
    });
  }

  const presenterInput = buildProjectContextPresenterInput(envelopes);
  const frameworks = uniqueStrings(collectFrameworkHints(presenterInput));
  const primaryLanguage = inferPrimaryLanguage(presenterInput);
  const secondaryLanguages = inferSecondaryLanguages(presenterInput, primaryLanguage);
  const repoFileCount = countRepoLanguageFiles(repo);
  const moduleCount =
    presenterInput.modules.length || presenterInput.map?.modules.length || moduleSeeds.length;
  const understandingGaps = buildProjectContextUnderstandingGaps({
    moduleCount,
    moduleSeeds,
    presenterInput,
    repoFileCount,
  });
  return {
    contextStatus: understandingGaps.length > 0 ? 'partial' : 'complete',
    dimensions: [...baseDimensions],
    envelopes,
    factSource: 'project-context',
    fileCount: Math.max(presenterInput.files.length, repoFileCount, sourceFileFacts.length),
    frameworks,
    moduleCount,
    moduleSeeds,
    presenterInput,
    primaryLanguage,
    projectType: inferProjectType(presenterInput),
    requestKinds: [...new Set(envelopes.map((envelope) => envelope.queryLevel))],
    secondaryLanguages,
    sourceFileFacts,
    understandingGaps,
  };
}

function resolvePlanProjectScopeContext(
  projectRoot: string,
  hints: PlanCollectHints | undefined
): PlanProjectScopeContext {
  const projectScope = loadPlanProjectScope(projectRoot);
  if (!projectScope) {
    return {
      displayName: basename(projectRoot),
      repoDisplayName: basename(projectRoot),
      repoProjectRoot: projectRoot,
      scanBase: projectRoot,
    };
  }

  const scanBase = projectScope.controlRoot.path;
  const activeFolders = projectScope.folders
    .filter((folder) => folder.state === 'active')
    .map((folder) => ({
      folder,
      sourceFolder: planProjectScopeFolderRelativePath(scanBase, folder),
    }))
    .filter((selection): selection is PlanProjectScopeFolderSelection =>
      Boolean(selection.sourceFolder)
    );
  if (activeFolders.length === 0) {
    return {
      displayName: projectScope.displayName,
      projectId: projectScope.projectId,
      repoDisplayName: projectScope.displayName,
      repoProjectRoot: scanBase,
      scanBase,
    };
  }

  const focusedFolders = selectFocusedProjectScopeFolders(activeFolders, hints?.focusModules);
  const selectedFolders = focusedFolders.length > 0 ? focusedFolders : activeFolders;
  const repoFolder =
    selectedFolders.find((selection) => selection.folder.role === 'primary-source') ??
    selectedFolders[0];

  return {
    displayName: projectScope.displayName,
    projectId: projectScope.projectId,
    repoDisplayName: repoFolder.folder.displayName,
    repoProjectRoot: repoFolder.folder.path,
    repoSourceFolder: repoFolder.sourceFolder,
    scanBase,
    sourceFolders: selectedFolders.map((selection) => selection.sourceFolder),
  };
}

function loadPlanProjectScope(projectRoot: string): ProjectDescriptor | null {
  const folderScope = loadProjectScopeForFolder(projectRoot);
  if (folderScope) {
    return folderScope;
  }
  const normalizedProjectRoot = path.resolve(projectRoot);
  try {
    return (
      Object.values(readProjectScopeRegistryDocument().scopes).find(
        (scope) => path.resolve(scope.controlRoot.path) === normalizedProjectRoot
      ) ?? null
    );
  } catch {
    return null;
  }
}

function planProjectScopeFolderRelativePath(
  scanBase: string,
  folder: ProjectFolderDescriptor
): string | undefined {
  const relativePath = normalizePath(path.relative(scanBase, folder.path));
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
    return undefined;
  }
  return relativePath;
}

function selectFocusedProjectScopeFolders(
  folders: readonly PlanProjectScopeFolderSelection[],
  focusModules: readonly string[] | undefined
): PlanProjectScopeFolderSelection[] {
  const focused = uniqueStrings((focusModules ?? []).map((value) => normalizePath(value) ?? ''));
  if (focused.length === 0) {
    return [];
  }
  return folders.filter((selection) =>
    focused.some((focusModule) => projectScopeFolderMatchesFocus(selection, focusModule))
  );
}

function projectScopeFolderMatchesFocus(
  selection: PlanProjectScopeFolderSelection,
  focusModule: string
): boolean {
  const candidates = [
    selection.sourceFolder,
    selection.folder.displayName,
    selection.folder.id,
    selection.folder.repositoryId ?? undefined,
    normalizePath(path.basename(selection.folder.path)),
  ]
    .map((value) => normalizePath(value))
    .filter(isPresent);
  return candidates.some(
    (candidate) =>
      candidate === focusModule ||
      focusModule.startsWith(`${candidate}/`) ||
      candidate.startsWith(`${focusModule}/`)
  );
}

function prefixPlanModuleSeeds(
  seeds: readonly PlanModuleSeed[],
  sourceFolder: string | undefined
): PlanModuleSeed[] {
  if (!sourceFolder) {
    return [...seeds];
  }
  return seeds.map((seed) => {
    const modulePath = prefixProjectContextPath(sourceFolder, seed.modulePath);
    const ownedFiles = seed.ownedFiles
      ?.map((filePath) => prefixProjectContextPath(sourceFolder, filePath))
      .filter(isPresent);
    return {
      ...seed,
      ...(modulePath ? { modulePath } : {}),
      ...(ownedFiles && ownedFiles.length > 0 ? { ownedFiles } : {}),
    };
  });
}

function prefixProjectContextPath(
  sourceFolder: string,
  pathValue: string | undefined
): string | undefined {
  const normalizedPath = normalizePath(pathValue);
  const normalizedSourceFolder = normalizePath(sourceFolder);
  if (!normalizedPath || !normalizedSourceFolder) {
    return normalizedPath;
  }
  return normalizedPath === normalizedSourceFolder ||
    normalizedPath.startsWith(`${normalizedSourceFolder}/`)
    ? normalizedPath
    : `${normalizedSourceFolder}/${normalizedPath}`;
}

function mergePlanModuleSeeds(seeds: readonly PlanModuleSeed[]): PlanModuleSeed[] {
  return dedupeBy(
    seeds.map((seed) => ({ ...seed, modulePath: normalizePath(seed.modulePath) })),
    (seed) => `${seed.modulePath ?? seed.ownedFiles?.join(',')}:${seed.moduleName}`
  );
}

function countRepoLanguageFiles(repo: RepoContext | undefined): number {
  return arrayRecords(readRecord(repo).languages).reduce(
    (sum, language) => sum + (readNumber(language, 'fileCount') ?? 0),
    0
  );
}

function buildProjectContextUnderstandingGaps(input: {
  moduleCount: number;
  moduleSeeds: readonly PlanModuleSeed[];
  presenterInput: ProjectContextPresenterInput;
  repoFileCount: number;
}): Record<string, unknown>[] {
  const gaps: Record<string, unknown>[] = [];
  if (input.repoFileCount > 0 && input.presenterInput.files.length === 0) {
    gaps.push({
      code: 'project-context-files-omitted',
      severity: 'warning',
      message:
        'ProjectContext repo facts reported language files, but no file summaries were present in the presenter payload.',
      omittedFact: 'fileSummaries',
      repoFileCount: input.repoFileCount,
    });
  }
  if (input.moduleSeeds.length > 0 && input.moduleCount === 0) {
    gaps.push({
      code: 'project-context-modules-partial',
      severity: 'warning',
      message:
        'ProjectContext repo facts exposed module seeds, but map/module presenter details were not available.',
      omittedFact: 'moduleDetails',
      moduleSeedCount: input.moduleSeeds.length,
    });
  }
  return gaps;
}

function selectPlanModuleSeeds(repo: RepoContext | undefined): PlanModuleSeed[] {
  const records = readRecord(repo);
  const candidates: PlanModuleSeed[] = [
    ...arrayRecords(records.localPackages).map((pkg) => ({
      moduleName: readString(pkg, 'name') ?? 'local-package',
      modulePath: normalizePath(readString(pkg, 'path') ?? readScopeFilePath(pkg.ref)),
      role: 'local-package',
    })),
    ...arrayRecords(records.sourceRoots).map((root) => ({
      moduleName: moduleNameFromPath(readString(root, 'path') ?? 'source'),
      modulePath: normalizePath(readString(root, 'path')),
      role: readString(root, 'role') ?? 'source-root',
    })),
    ...arrayRecords(records.topAreas).map((area) => ({
      moduleName: moduleNameFromPath(readString(area, 'path') ?? 'area'),
      modulePath: normalizePath(readString(area, 'path')),
      role: readString(area, 'role') ?? 'top-area',
    })),
    ...arrayRecords(records.entrypoints).flatMap((entrypoint) =>
      arrayRecords(entrypoint.refs).map((ref) => ({
        moduleName:
          readString(entrypoint, 'name') ??
          moduleNameFromPath(readScopeFilePath(ref) ?? 'entrypoint'),
        modulePath: normalizePath(parentPath(readScopeFilePath(ref))),
        ownedFiles: [readScopeFilePath(ref)].filter(isPresent),
        role: readString(entrypoint, 'kind') ?? 'entrypoint',
      }))
    ),
    ...arrayRecords(records.targets).flatMap((target) =>
      arrayRecords(target.refs).map((ref) => ({
        moduleName:
          readString(target, 'name') ?? moduleNameFromPath(readScopeFilePath(ref) ?? 'target'),
        modulePath: normalizePath(readScopeFilePath(ref)),
        ownedFiles: [readScopeFilePath(ref)].filter(isPresent),
        role: readString(target, 'kind') ?? 'target',
      }))
    ),
  ].filter(hasSeedScope);
  return mergePlanModuleSeeds(
    candidates.map((seed) => ({ ...seed, modulePath: normalizePath(seed.modulePath) }))
  );
}

function inferPrimaryLanguage(input: ProjectContextPresenterInput): string {
  const languages = input.repo?.languages ?? [];
  return (
    [...languages].sort((left, right) => (right.fileCount ?? 0) - (left.fileCount ?? 0))[0]
      ?.language ?? 'unknown'
  );
}

function inferSecondaryLanguages(
  input: ProjectContextPresenterInput,
  primaryLanguage: string
): string[] {
  return (input.repo?.languages ?? [])
    .map((language) => language.language)
    .filter((language) => language !== primaryLanguage)
    .sort();
}

function inferProjectType(input: ProjectContextPresenterInput): string {
  return (
    input.repo?.packageSystems[0]?.kind ??
    input.repo?.buildSystems[0]?.kind ??
    input.repo?.repo.name ??
    'project-context'
  );
}

function collectFrameworkHints(input: ProjectContextPresenterInput): string[] {
  const repo = readRecord(input.repo);
  const manifestDependencies = arrayRecords(repo.manifestDependencies).map((dep) =>
    readString(dep, 'name')
  );
  const packageSystems = arrayRecords(repo.packageSystems).map(
    (entry) => readString(entry, 'kind') ?? readString(entry, 'name')
  );
  const buildSystems = arrayRecords(repo.buildSystems).map(
    (entry) => readString(entry, 'kind') ?? readString(entry, 'name')
  );
  const commands = arrayRecords(repo.commands).flatMap((entry) => [
    readString(entry, 'name'),
    readString(entry, 'command'),
  ]);
  return uniqueStrings(
    [...manifestDependencies, ...packageSystems, ...buildSystems, ...commands].filter(isPresent)
  ).slice(0, 30);
}

function hasSeedScope(seed: PlanModuleSeed): boolean {
  return Boolean(seed.modulePath || seed.ownedFiles?.length);
}

function isRepoContext(value: ProjectContextResult): value is RepoContext {
  return !!value && typeof value === 'object' && 'repo' in value && 'sourceRoots' in value;
}

// ===== 私有工具（从 plan-tool 复制，byte 一致；自足，不导出）=====
function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: unknown, key: string): string | undefined {
  const value = readRecord(record)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(record: unknown, key: string): number | undefined {
  const value = readRecord(record)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord) : [];
}

function readScopeFilePath(ref: unknown): string | undefined {
  return readString(readRecord(ref).scope, 'filePath');
}

function parentPath(pathValue: string | undefined): string | undefined {
  if (!pathValue) {
    return undefined;
  }
  const parts = pathValue.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/') || undefined;
}

function moduleNameFromPath(pathValue: string): string {
  return (
    pathValue
      .split(/[\\/]/)
      .filter(Boolean)
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? pathValue
  );
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

// planFacts/collect-project-context —— 三个宿主共用的「有限 requestKinds ProjectContext 采集器」。
// collectPlanProjectContext(projectRoot, hints, options?) → PlanProjectContextAnalysis。
//
// 历史：U1b.3 从 host 交付层 plan-tool.ts 下沉；F6（2026-10-06）把 Alembic 冷启动/重扫与 Plugin
// 冷启动/重扫各自的采集循环并进来，上限、范围与来源标签做成 options。三处只剩这一份请求顺序：
//   space → repo → map → 前 N 个模块的 module / module-layers → 前 M 个明细文件的
//   file-flow / file-symbols / (source-slice) / anchor-range。
// 种子只有一个来源：repo 查询给出的模块划分（RepoContext.modules）。宿主不再从 localPackages /
// sourceRoots / topAreas / entrypoints / targets 自己推一遍，也不再按路径前缀把源码清单挂到种子上——
// 划分的引用原样作为 map / module 的种子，文件由 Core 按同一份划分解析。
// 注：projectRoot 由宿主解析后传入，本模块不碰宿主 DI；整批请求共用一个分析会话（一次解析）。
import path, { basename } from 'node:path';
import { baseDimensions } from '../../../domain/dimension/BaseDimensions.js';
import {
  buildProjectContextPresenterInput,
  type ModuleContext,
  type ProjectContext as ProjectContextContract,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextRequestKind,
  type ProjectContextResult,
  type RepoContext,
  type RepoModuleSummary,
} from '../../../domain/project-context/index.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import { LanguageService } from '../../../shared/LanguageService.js';
import {
  loadProjectScopeForFolder,
  type ProjectDescriptor,
  type ProjectFolderDescriptor,
  readProjectScopeRegistryDocument,
} from '../../../shared/ProjectScope.js';
import { throwIfProjectContextAborted } from '../../project-context/interface/execution.js';
import { withProjectContextSession } from '../../project-context/ProjectContextService.js';
import type {
  PlanCollectionReport,
  PlanCollectLimits,
  PlanCollectOptions,
  PlanCollectScope,
  PlanCollectSourceFolder,
} from './collectContracts.js';
import type { PlanModuleSeed, PlanProjectContextAnalysis } from './projectInfoTree.js';
import {
  collectProjectSourceFileFacts,
  isProjectCodeFile,
  normalizeProjectContextPath,
  type ProjectSourceFileFact,
} from './projectSourceFacts.js';

// collectPlanProjectContext 的 hints 输入契约：从 host MCP schema PlanInput['hints'] 解耦为 Core 类型
// （结构与 draft-only planning hints 一致：focusModules/goal/maxBudget，host 传 args.hints 结构兼容）。
// focusModules 命中 ProjectScope 文件夹时选文件夹；没命中任何文件夹的项按目录过滤模块（等价于
// options.scope.moduleScope）。
export interface PlanCollectHints {
  focusModules?: string[];
  goal?: string;
  maxBudget?: number;
}

const DEFAULT_SOURCE = 'codex-host-plan';
/** 源码清单的默认上限，与 collectProjectSourceFileFacts 一致；用来判断清单有没有被截断。 */
const DEFAULT_SOURCE_SCAN_MAX_FILES = 5000;
interface ResolvedCollectScope {
  displayName: string;
  projectId?: string;
  /** 所有请求的 scope.projectRoot，也是源码清单与路径的基准。 */
  projectRoot: string;
  repoDisplayName: string;
  /** 主仓库相对目录；undefined 表示 projectRoot 自己就是主仓库。 */
  repoRoot?: string;
  /** 给 space 的文件夹；空数组表示不传，由 space 自己解析。 */
  folders: PlanCollectSourceFolder[];
  moduleScope: string[];
  source: PlanCollectionReport['scopeSource'];
}

interface ResolvedCollectLimits {
  maxFiles?: number;
  maxModuleSeeds?: number;
  maxModuleDetails?: number;
  maxFileDetails: number;
  sourceSliceLines: number;
}

export async function collectPlanProjectContext(
  projectRoot: string,
  hints: PlanCollectHints | undefined,
  options: PlanCollectOptions = {}
): Promise<PlanProjectContextAnalysis> {
  // map/module/layers 属于同批事实，复用源码和提取结果；目录与 manifest 扫描仍按原逻辑执行。
  return withProjectContextSession(
    (projectContext) =>
      collectPlanProjectContextInSession(projectContext, projectRoot, hints, options),
    options.signal ? { signal: options.signal } : {}
  );
}

async function collectPlanProjectContextInSession(
  projectContext: ProjectContextContract,
  projectRoot: string,
  hints: PlanCollectHints | undefined,
  options: PlanCollectOptions
): Promise<PlanProjectContextAnalysis> {
  const source = options.source ?? DEFAULT_SOURCE;
  const limits = resolveCollectLimits(options.limits);
  const scope = resolveCollectScope(projectRoot, hints, options.scope);
  Logger.debug('[PlanFacts] ProjectContext collection scope resolved', {
    folders: scope.folders.map((folder) => folder.path),
    limits,
    moduleScope: scope.moduleScope,
    projectRoot: scope.projectRoot,
    repoRoot: scope.repoRoot ?? '.',
    scopeSource: scope.source,
    source,
  });
  const executionContext = options.signal ? { signal: options.signal } : undefined;
  const envelopes: ProjectContextEnvelope<ProjectContextResult>[] = [];
  const push = async (
    kind: ProjectContextRequestKind,
    payload: Record<string, unknown> | undefined,
    displayName: string = scope.displayName
  ): Promise<ProjectContextEnvelope<ProjectContextResult>> => {
    const envelope = await projectContext.execute(
      {
        kind,
        payload,
        project: { displayName, projectRoot: scope.projectRoot, source },
        scope: { projectRoot: scope.projectRoot },
      },
      executionContext
    );
    envelopes.push(envelope);
    return envelope;
  };

  await push('space', {
    includeProjectTree: true,
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.folders.length > 0
      ? { sourceFolders: scope.folders.map((folder) => ({ ...folder })) }
      : {}),
  });
  // includeMapSummary 关掉：map 由下面单独发，带的是划分出来的种子；repo 自己没有种子时只会回一条
  // "map facts unavailable" 的告警。
  const repoEnvelope = await push(
    'repo',
    {
      includeMapSummary: false,
      ...(limits.maxFiles !== undefined ? { maxFiles: limits.maxFiles } : {}),
      ...(scope.repoRoot ? { repoRoot: scope.repoRoot } : {}),
    },
    scope.repoDisplayName
  );
  const repo = isRepoContext(repoEnvelope.data) ? repoEnvelope.data : undefined;
  throwIfProjectContextAborted(executionContext);
  const sourceFileFacts = await collectProjectSourceFileFacts(scope.projectRoot, {
    ...(limits.maxFiles !== undefined ? { maxFiles: limits.maxFiles } : {}),
    sourceFolders: scope.folders.map((folder) => folder.path),
  });
  const sourceScanTruncated =
    sourceFileFacts.length >= (limits.maxFiles ?? DEFAULT_SOURCE_SCAN_MAX_FILES);
  if (sourceScanTruncated) {
    Logger.info('[PlanFacts] source file inventory stopped at its file limit', {
      maxFiles: limits.maxFiles ?? DEFAULT_SOURCE_SCAN_MAX_FILES,
      projectRoot: scope.projectRoot,
    });
  }
  throwIfProjectContextAborted(executionContext);

  const modules = createModuleSeeds(repo, scope, sourceFileFacts);
  const selection = selectModuleSeeds(modules.seeds, scope.moduleScope, limits.maxModuleSeeds);
  const moduleSeeds = selection.seeds;
  const seedSource: PlanCollectionReport['seedSource'] =
    moduleSeeds.length === 0 ? 'none' : modules.partitioned ? 'repo-modules' : 'source-folders';
  const seedLog = {
    dropped: selection.dropped,
    filtered: selection.filtered,
    folderSeeds: modules.folderSeedCount,
    partitionModules: modules.partitionModuleCount,
    projectRoot: scope.projectRoot,
    seedSource,
    seeds: moduleSeeds.length,
  };
  if (selection.dropped.length > 0 || seedSource !== 'repo-modules') {
    Logger.info('[PlanFacts] module seeds selected for the map query', seedLog);
  } else {
    Logger.debug('[PlanFacts] module seeds selected for the map query', seedLog);
  }

  if (moduleSeeds.length > 0) {
    await push('map', {
      moduleSeeds: moduleSeeds.map(createSeedPayload),
      ...(repo?.repo.name ? { repoName: repo.repo.name } : {}),
    });
  }
  // 模块明细按文件数从大到小取前 N 个（与 maxModuleSeeds 的取舍同一条规则）：按路径顺序取会把
  // 明细给仓库根、resources 这类只有一两个文件的模块，而大模块一个都轮不到。
  const detailedSeeds =
    limits.maxModuleDetails === undefined
      ? moduleSeeds
      : sortSeedsByFileCount(moduleSeeds).slice(0, limits.maxModuleDetails);
  for (const seed of detailedSeeds) {
    await push('module', {
      ...createSeedPayload(seed),
      includeDependencies: true,
      includePublicSurfaces: true,
    });
    await push('module-layers', {
      ...createSeedPayload(seed),
      includeBoundaryCrossings: true,
    });
  }

  const detailFiles = selectDetailFiles(envelopes, sourceFileFacts, limits.maxFileDetails);
  if (detailFiles.length > 0) {
    Logger.debug('[PlanFacts] detail files selected', {
      detailFiles,
      sourceSliceLines: limits.sourceSliceLines,
    });
  }
  for (const filePath of detailFiles) {
    const flowEnvelope = await push('file-flow', { filePath });
    await push('file-symbols', { filePath });
    // source-slice 的范围不能超出文件行数（超出是 invalid-scope，不是截断）：行数取自刚收到的
    // file-flow 信封；拿不到时按请求的行数发，让错误照常记进信封。
    const lineCount = readFileLineCount(flowEnvelope.data);
    if (limits.sourceSliceLines > 0) {
      await push('source-slice', {
        endLine: lineCount ? Math.min(limits.sourceSliceLines, lineCount) : limits.sourceSliceLines,
        filePath,
        includeText: true,
        startLine: 1,
      });
    }
    const afterLines = limits.sourceSliceLines > 0 ? Math.min(8, limits.sourceSliceLines) : 2;
    await push('anchor-range', {
      afterLines: lineCount ? Math.min(afterLines, Math.max(0, lineCount - 1)) : afterLines,
      beforeLines: 0,
      filePath,
      includeRelations: false,
      includeSourceSlices: true,
      includeSymbols: true,
      line: 1,
      relationHops: 0,
    });
  }

  const presenterInput = buildProjectContextPresenterInput(envelopes);
  const frameworks = uniqueStrings(collectFrameworkHints(presenterInput));
  const languageStats = buildLanguageStats(sourceFileFacts, repo);
  const primaryLanguage = inferPrimaryLanguage(languageStats, sourceFileFacts, repo);
  const secondaryLanguages = Object.keys(languageStats)
    .filter((language) => language !== primaryLanguage)
    .sort();
  const repoFileCount = countRepoLanguageFiles(repo);
  const moduleCount =
    modules.seeds.length > 0
      ? modules.seeds.length
      : (presenterInput.map?.modules.length ?? presenterInput.modules.length);
  const understandingGaps = buildProjectContextUnderstandingGaps({
    // 只有代码文件却没有任何种子才是缺口；只有文档/配置的仓库本来就没有模块可分析。
    codeFileCount: sourceFileFacts.filter((fact) => isProjectCodeFile(fact.filePath, fact.language))
      .length,
    moduleSeeds,
    presenterInput,
    repoFileCount,
  });
  return {
    collection: {
      detailFiles,
      droppedModuleSeeds: selection.dropped,
      filteredModuleSeeds: selection.filtered,
      limits,
      scopeSource: scope.source,
      seedSource,
      source,
      sourceScanTruncated,
    },
    contextStatus: understandingGaps.length > 0 ? 'partial' : 'complete',
    dimensions: [...baseDimensions],
    envelopes,
    factSource: 'project-context',
    fileCount: Math.max(presenterInput.files.length, repoFileCount, sourceFileFacts.length),
    frameworks,
    isEmpty:
      sourceFileFacts.length === 0 &&
      presenterInput.files.length === 0 &&
      presenterInput.refs.length === 0,
    isMultiLang: secondaryLanguages.length > 0,
    languageStats,
    moduleCount,
    moduleSeeds,
    modules: modules.seeds,
    presenterInput,
    primaryLanguage,
    projectType: inferProjectType(presenterInput),
    requestKinds: [...new Set(envelopes.map((envelope) => envelope.queryLevel))],
    secondaryLanguages,
    sourceFileFacts,
    understandingGaps,
  };
}

// ===== 上限 =====

function resolveCollectLimits(limits: PlanCollectLimits | undefined): ResolvedCollectLimits {
  return {
    maxFiles: readPositiveInteger(limits?.maxFiles),
    maxModuleSeeds: readNonNegativeInteger(limits?.maxModuleSeeds),
    maxModuleDetails: readNonNegativeInteger(limits?.maxModuleDetails),
    maxFileDetails: readNonNegativeInteger(limits?.maxFileDetails) ?? 0,
    sourceSliceLines: readNonNegativeInteger(limits?.sourceSliceLines) ?? 0,
  };
}

// ===== 范围 =====

function resolveCollectScope(
  projectRoot: string,
  hints: PlanCollectHints | undefined,
  explicit: PlanCollectScope | undefined
): ResolvedCollectScope {
  const focus = uniqueStrings(
    (hints?.focusModules ?? []).map((value) => normalizePath(value) ?? '')
  );
  if (explicit) {
    return resolveExplicitScope(projectRoot, focus, explicit);
  }
  const projectScope = loadPlanProjectScope(projectRoot);
  if (!projectScope) {
    return {
      displayName: basename(projectRoot),
      folders: [],
      moduleScope: [...focus],
      projectRoot,
      repoDisplayName: basename(projectRoot),
      source: 'project-root',
    };
  }
  return resolveRegistryScope(projectScope, focus);
}

function resolveExplicitScope(
  projectRoot: string,
  focus: readonly string[],
  explicit: PlanCollectScope
): ResolvedCollectScope {
  const folders = normalizeSourceFolders(projectRoot, explicit.sourceFolders ?? []);
  const repoFolder =
    folders.find((folder) => normalizePath(explicit.repoRoot) === folder.path) ??
    folders.find((folder) => folder.role === 'primary-source') ??
    folders[0];
  const repoRoot = normalizePath(explicit.repoRoot) ?? repoFolder?.path;
  const displayName = explicit.displayName ?? basename(projectRoot);
  return {
    displayName,
    folders,
    moduleScope: uniqueStrings([
      ...(explicit.moduleScope ?? []).map((value) => normalizePath(value) ?? ''),
      ...focus,
    ]),
    projectId: explicit.projectId,
    projectRoot,
    repoDisplayName: repoFolder?.displayName ?? (repoRoot ? basename(repoRoot) : displayName),
    repoRoot,
    source: 'explicit',
  };
}

function resolveRegistryScope(
  projectScope: ProjectDescriptor,
  focus: readonly string[]
): ResolvedCollectScope {
  const projectRoot = projectScope.controlRoot.path;
  const activeFolders = projectScope.folders
    .filter((folder) => folder.state === 'active')
    .flatMap((folder) => {
      const relativePath = relativeFolderPath(projectRoot, folder.path);
      return relativePath ? [{ folder, relativePath }] : [];
    });
  if (activeFolders.length === 0) {
    return {
      displayName: projectScope.displayName,
      folders: [],
      moduleScope: [...focus],
      projectId: projectScope.projectId,
      projectRoot,
      repoDisplayName: projectScope.displayName,
      source: 'project-scope-registry',
    };
  }
  // focusModules 先当文件夹选择用；没选中任何文件夹的项退回按目录过滤模块。
  const focusedFolders = activeFolders.filter(({ folder, relativePath }) =>
    focus.some((focusModule) => folderMatchesFocus(folder, relativePath, focusModule))
  );
  const selectedFolders = focusedFolders.length > 0 ? focusedFolders : activeFolders;
  const moduleScope = focus.filter(
    (focusModule) =>
      !activeFolders.some(({ folder, relativePath }) =>
        folderMatchesFocus(folder, relativePath, focusModule)
      )
  );
  const repoFolder =
    selectedFolders.find(({ folder }) => folder.role === 'primary-source') ?? selectedFolders[0];
  return {
    displayName: projectScope.displayName,
    folders: selectedFolders.map(({ folder, relativePath }) => ({
      displayName: folder.displayName,
      id: folder.id,
      path: relativePath,
      ...(folder.repositoryId ? { repositoryId: folder.repositoryId } : {}),
      role: folder.role,
    })),
    moduleScope,
    projectId: projectScope.projectId,
    projectRoot,
    repoDisplayName: repoFolder.folder.displayName,
    repoRoot: repoFolder.relativePath,
    source: 'project-scope-registry',
  };
}

function normalizeSourceFolders(
  projectRoot: string,
  sourceFolders: ReadonlyArray<string | PlanCollectSourceFolder>
): PlanCollectSourceFolder[] {
  const folders: PlanCollectSourceFolder[] = [];
  const seen = new Set<string>();
  for (const entry of sourceFolders) {
    const folder = typeof entry === 'string' ? { path: entry } : entry;
    const relativePath = path.isAbsolute(folder.path)
      ? relativeFolderPath(projectRoot, folder.path)
      : normalizePath(folder.path);
    if (!relativePath || relativePath.startsWith('../') || seen.has(relativePath)) {
      if (relativePath === undefined || relativePath.startsWith('../')) {
        Logger.warn('[PlanFacts] source folder outside projectRoot was skipped', {
          folder: folder.path,
          projectRoot,
        });
      }
      continue;
    }
    seen.add(relativePath);
    folders.push({
      ...folder,
      path: relativePath,
      ...(folder.role ? {} : { role: folders.length === 0 ? 'primary-source' : 'source' }),
    });
  }
  return folders;
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

function relativeFolderPath(projectRoot: string, folderPath: string): string | undefined {
  const relativePath = normalizePath(path.relative(projectRoot, folderPath));
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
    return undefined;
  }
  return relativePath;
}

function folderMatchesFocus(
  folder: ProjectFolderDescriptor,
  relativePath: string,
  focusModule: string
): boolean {
  const candidates = [
    relativePath,
    folder.displayName,
    folder.id,
    folder.repositoryId ?? undefined,
    normalizePath(path.basename(folder.path)),
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

// ===== 种子 =====

/**
 * 种子来自 repo 查询的模块划分：主仓库的每个模块一个种子（引用原样可作 map / module 的种子），
 * 范围里主仓库之外的文件夹各一个整体种子。ownedFiles 只是源码清单里按划分归到该模块的代码文件，
 * 给宿主展示与覆盖台账用；map / module 对划分种子按引用自己解析文件，不读这份清单。
 */
function createModuleSeeds(
  repo: RepoContext | undefined,
  scope: ResolvedCollectScope,
  sourceFileFacts: readonly ProjectSourceFileFact[]
): {
  seeds: PlanModuleSeed[];
  partitioned: boolean;
  partitionModuleCount: number;
  folderSeedCount: number;
} {
  const codeFiles = sourceFileFacts
    .filter((fact) => isProjectCodeFile(fact.filePath, fact.language))
    .map((fact) => fact.filePath);
  const repoRoot = scope.repoRoot ?? '.';
  const repoFiles = codeFiles.filter((filePath) => isWithin(filePath, repoRoot));
  const partitionModules = repo?.modules ?? [];
  const partitionSeeds = partitionModules.map((module) =>
    createPartitionSeed(module, repoFiles, partitionModules)
  );
  if (partitionModules.length === 0 && repoFiles.length > 0) {
    Logger.warn('[PlanFacts] repo query returned no module partition for the primary repository', {
      projectRoot: scope.projectRoot,
      repoRoot,
      sourceFiles: repoFiles.length,
    });
  }
  const folderSeeds = scope.folders
    .filter((folder) => folder.path !== repoRoot)
    .flatMap((folder) => {
      const ownedFiles = codeFiles.filter((filePath) => isWithin(filePath, folder.path));
      if (ownedFiles.length === 0) {
        return [];
      }
      return [
        {
          fileCount: ownedFiles.length,
          kind: 'project-scope-folder',
          moduleName: folder.displayName ?? basename(folder.path),
          modulePath: folder.path,
          ownedFiles,
          role: 'project-scope-folder',
        } satisfies PlanModuleSeed,
      ];
    });
  return {
    seeds: [...partitionSeeds, ...folderSeeds],
    partitioned: partitionSeeds.length > 0,
    partitionModuleCount: partitionSeeds.length,
    folderSeedCount: folderSeeds.length,
  };
}

function createPartitionSeed(
  module: RepoModuleSummary,
  repoFiles: readonly string[],
  modules: readonly RepoModuleSummary[]
): PlanModuleSeed {
  const modulePath = normalizePath(module.ref.scope.filePath ?? module.path);
  const ownedFiles = repoFiles.filter((filePath) => ownerOfPath(modules, filePath) === module);
  return {
    fileCount: module.fileCount,
    kind: module.kind,
    moduleId: module.ref.id,
    moduleName: module.name,
    ...(modulePath ? { modulePath } : {}),
    ...(ownedFiles.length > 0 ? { ownedFiles } : {}),
    ref: module.ref,
    role: module.kind,
  };
}

/** 文件所属的模块：引用路径前缀最长的那个（仓库根模块的路径是仓库目录本身，兜住其余文件）。 */
function ownerOfPath(
  modules: readonly RepoModuleSummary[],
  filePath: string
): RepoModuleSummary | undefined {
  let owner: RepoModuleSummary | undefined;
  let ownerLength = -1;
  for (const module of modules) {
    const modulePath = normalizePath(module.ref.scope.filePath ?? module.path) ?? '.';
    const root = modulePath === '.';
    const inside = root || isWithin(filePath, modulePath);
    const length = root ? 0 : modulePath.length;
    if (inside && length > ownerLength) {
      owner = module;
      ownerLength = length;
    }
  }
  return owner;
}

function selectModuleSeeds(
  seeds: readonly PlanModuleSeed[],
  moduleScope: readonly string[],
  maxModuleSeeds: number | undefined
): { seeds: PlanModuleSeed[]; dropped: string[]; filtered: string[] } {
  const scoped =
    moduleScope.length > 0
      ? seeds.filter((seed) => seedMatchesScope(seed, moduleScope, seeds))
      : [...seeds];
  const filtered = seeds.filter((seed) => !scoped.includes(seed)).map((seed) => seed.moduleName);
  if (maxModuleSeeds === undefined || scoped.length <= maxModuleSeeds) {
    return { seeds: scoped, dropped: [], filtered };
  }
  // 上限起作用时按文件数留大的；输出仍按原顺序（划分按路径排序），让请求顺序稳定。
  const kept = new Set(sortSeedsByFileCount(scoped).slice(0, maxModuleSeeds));
  return {
    seeds: scoped.filter((seed) => kept.has(seed)),
    dropped: scoped.filter((seed) => !kept.has(seed)).map((seed) => seed.moduleName),
    filtered,
  };
}

/**
 * moduleScope 里的一条目录（或文件）选中两类模块：落在它下面的模块，以及拥有它的那个模块
 * （路径前缀最长的）。划分里一个路径只属于一个模块，所以不再像旧推导那样把所有前缀模块都算上。
 */
/** 文件数从大到小，同数按名字；不改入参。 */
function sortSeedsByFileCount(seeds: readonly PlanModuleSeed[]): PlanModuleSeed[] {
  return [...seeds].sort(
    (left, right) =>
      (right.fileCount ?? right.ownedFiles?.length ?? 0) -
        (left.fileCount ?? left.ownedFiles?.length ?? 0) ||
      left.moduleName.localeCompare(right.moduleName)
  );
}

function seedMatchesScope(
  seed: PlanModuleSeed,
  moduleScope: readonly string[],
  seeds: readonly PlanModuleSeed[]
): boolean {
  const modulePath = normalizePath(seed.modulePath) ?? '.';
  return moduleScope.some((scope) => {
    if (isWithin(modulePath, scope)) {
      return true;
    }
    const owner = seeds
      .filter((candidate) => isWithin(scope, normalizePath(candidate.modulePath) ?? '.'))
      .sort(
        (left, right) =>
          (normalizePath(right.modulePath) ?? '').length -
          (normalizePath(left.modulePath) ?? '').length
      )[0];
    return owner === seed;
  });
}

/** map / module 的种子载荷：划分种子只带引用（文件由 Core 按划分解析），文件夹种子带文件清单。 */
function createSeedPayload(seed: PlanModuleSeed): Record<string, unknown> {
  return {
    moduleName: seed.moduleName,
    ...(seed.modulePath ? { modulePath: seed.modulePath } : {}),
    ...(seed.role ? { role: seed.role } : {}),
    ...(seed.ref ? { ref: seed.ref } : { ownedFiles: seed.ownedFiles ?? [] }),
  };
}

// ===== 明细文件 =====

/** 明细文件从模块明细里的代码文件挑，再补引用里的代码文件；构建清单与文档不算。 */
function selectDetailFiles(
  envelopes: readonly ProjectContextEnvelope<ProjectContextResult>[],
  sourceFileFacts: readonly ProjectSourceFileFact[],
  limit: number
): string[] {
  if (limit <= 0) {
    return [];
  }
  const languageByFile = new Map(sourceFileFacts.map((fact) => [fact.filePath, fact.language]));
  const isDetailCandidate = (filePath: string) =>
    !filePath.endsWith('/') &&
    isProjectCodeFile(
      filePath,
      languageByFile.get(filePath) ?? LanguageService.inferLang(filePath)
    );
  const fromModules = envelopes.flatMap((envelope) =>
    envelope.queryLevel === 'module' && isModuleContext(envelope.data)
      ? envelope.data.ownedFiles.map((file) => file.filePath)
      : []
  );
  const fromRefs = envelopes.flatMap((envelope) =>
    envelope.refs.flatMap((ref) => (ref.scope.filePath ? [ref.scope.filePath] : []))
  );
  return [
    ...uniqueStrings(fromModules.filter(isDetailCandidate)),
    ...uniqueStrings(fromRefs.filter(isDetailCandidate)),
  ]
    .filter((filePath, index, all) => all.indexOf(filePath) === index)
    .slice(0, limit);
}

// ===== 语言与项目类型 =====

function buildLanguageStats(
  sourceFileFacts: readonly ProjectSourceFileFact[],
  repo: RepoContext | undefined
): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const fact of sourceFileFacts) {
    if (isProjectCodeFile(fact.filePath, fact.language)) {
      stats[fact.language] = (stats[fact.language] ?? 0) + 1;
    }
  }
  if (Object.keys(stats).length > 0) {
    return stats;
  }
  for (const language of repo?.languages ?? []) {
    stats[language.language] = language.fileCount ?? 0;
  }
  return stats;
}

/** 主语言：源码清单里代码文件最多的语言；清单为空时退回 repo 的语言统计。 */
function inferPrimaryLanguage(
  languageStats: Record<string, number>,
  sourceFileFacts: readonly ProjectSourceFileFact[],
  repo: RepoContext | undefined
): string {
  const ranked = Object.entries(languageStats).sort(
    ([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right)
  );
  if (ranked[0]) {
    return ranked[0][0];
  }
  const counts = new Map<string, number>();
  for (const fact of sourceFileFacts) {
    if (fact.language !== 'unknown') {
      counts.set(fact.language, (counts.get(fact.language) ?? 0) + 1);
    }
  }
  const anyLanguage = [...counts.entries()].sort(
    ([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right)
  )[0]?.[0];
  if (anyLanguage) {
    return anyLanguage;
  }
  return (
    [...(repo?.languages ?? [])].sort(
      (left, right) => (right.fileCount ?? 0) - (left.fileCount ?? 0)
    )[0]?.language ?? 'unknown'
  );
}

function countRepoLanguageFiles(repo: RepoContext | undefined): number {
  return (repo?.languages ?? []).reduce((sum, language) => sum + (language.fileCount ?? 0), 0);
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

// ===== 理解缺口 =====

function buildProjectContextUnderstandingGaps(input: {
  codeFileCount: number;
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
  if (input.codeFileCount > 0 && input.moduleSeeds.length === 0) {
    gaps.push({
      code: 'project-context-modules-unavailable',
      severity: 'warning',
      message:
        'ProjectContext repo facts gave no module partition, so map/module facts were not collected.',
      omittedFact: 'moduleDetails',
      codeFileCount: input.codeFileCount,
    });
  } else if (
    input.moduleSeeds.length > 0 &&
    !input.presenterInput.map &&
    input.presenterInput.modules.length === 0
  ) {
    gaps.push({
      code: 'project-context-modules-partial',
      severity: 'warning',
      message:
        'ProjectContext repo facts exposed module seeds, but map/module presenter details were not available.',
      omittedFact: 'moduleDetails',
      moduleSeedCount: input.moduleSeeds.length,
    });
  }
  gaps.push(...buildRequiredAstFactGaps(input.presenterInput));
  return gaps;
}

type RequiredAstFactKind = 'file-flow' | 'file-symbols';

function buildRequiredAstFactGaps(
  presenterInput: ProjectContextPresenterInput
): Record<string, unknown>[] {
  const failures = new Map<RequiredAstFactKind, { files: Set<string>; reasons: Set<string> }>();
  for (const warning of presenterInput.warnings) {
    const factKind = requiredAstFactKindFromFailure(warning.message);
    if (!factKind) {
      continue;
    }
    const failure = failures.get(factKind) ?? {
      files: new Set<string>(),
      reasons: new Set<string>(),
    };
    if (warning.path) {
      failure.files.add(warning.path);
    }
    failure.reasons.add(warning.message);
    failures.set(factKind, failure);
  }

  return [...failures.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([factKind, failure]) => {
      const affectedFiles = [...failure.files].sort();
      const reasons = [...failure.reasons].sort();
      const omittedFact = factKind === 'file-flow' ? 'fileFlow' : 'fileSymbols';
      return {
        affectedFileCount: affectedFiles.length,
        affectedFiles: affectedFiles.slice(0, 20),
        code: `project-context-${factKind}-partial`,
        message: `ProjectContext ${factKind} facts were incomplete because AST parsing failed.`,
        omittedFact,
        reasons: reasons.slice(0, 5),
        severity: 'warning',
      };
    });
}

function requiredAstFactKindFromFailure(message: string): RequiredAstFactKind | undefined {
  for (const factKind of ['file-flow', 'file-symbols'] as const) {
    if (
      message.startsWith(`${factKind} parser failed for `) ||
      message === `${factKind} parser runtime is unavailable.` ||
      message.startsWith(`${factKind} parser returned no AST summary for `)
    ) {
      return factKind;
    }
  }
  return undefined;
}

// ===== 私有工具 =====

function isRepoContext(value: ProjectContextResult): value is RepoContext {
  return !!value && typeof value === 'object' && 'repo' in value && 'sourceRoots' in value;
}

function isModuleContext(value: ProjectContextResult): value is ModuleContext {
  return (
    !!value &&
    typeof value === 'object' &&
    'module' in value &&
    'ownedFiles' in value &&
    Array.isArray((value as ModuleContext).ownedFiles)
  );
}

/** file-flow 等文件级结果里的行数（FileSummary.lineCount）；没有或不是数字时返回 undefined。 */
function readFileLineCount(value: ProjectContextResult): number | undefined {
  const file = readRecord(readRecord(value).file);
  const lineCount = file.lineCount;
  return typeof lineCount === 'number' && Number.isFinite(lineCount) && lineCount > 0
    ? Math.floor(lineCount)
    : undefined;
}

function isWithin(filePath: string, directory: string): boolean {
  return directory === '.' || filePath === directory || filePath.startsWith(`${directory}/`);
}

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

function normalizePath(value: string | undefined): string | undefined {
  return normalizeProjectContextPath(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function isPresent<T>(value: T | null | undefined | ''): value is T {
  return value !== null && value !== undefined && value !== '';
}

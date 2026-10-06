/**
 * ProjectContext 事实 → 简报入参。
 *
 * 简报的每一段读哪一份事实，全部写在这个文件里：
 *
 * | 简报段 | 事实来源 |
 * |---|---|
 * | targets | repo.targets；文件数是发现层数出来的、属于该构建目标的源码文件数 |
 * | dependencyGraph | repo.dependencyGraph——清单里声明的依赖；清单没有声明项目内部的依赖时，用 map 观察到的模块间 import |
 * | architectureOverview.externalDeps、technologyStack | 清单声明的项目外依赖，加上代码里实际 import、但不属于本项目的模块 |
 * | mustCoverModules、"本地包占比" | repo.localPackages（主项目自己不算） |
 * | panorama | map 的层、模块的进出度、环 |
 * | languageStats、源码文件总数 | repo.languages |
 *
 * 一份事实缺席时，对应的段就少内容；不拿另一份事实改个形状去顶替。
 * 以前这里把模块当本地包、把层当依赖图节点、把综合分当扇入、把引用个数当文件数，简报因此与项目对不上。
 */

import type {
  ProjectContextPresenterInput,
  RepoDependencyGraphSummary,
  TargetSummary,
} from '../../../../domain/project-context/index.js';
import Logger from '../../../../infrastructure/logging/Logger.js';
import type { DependencyGraph, LocalPackageModule } from '../../../../types/ProjectSnapshot.js';

/** 项目外的一个依赖，以及用到它的模块名。 */
export interface BriefingExternalDependency {
  name: string;
  usedBy: string[];
  /**
   * 清单里有没有声明它。true：声明过的第三方依赖；false：代码里 import 了、清单没有声明
   * （平台或系统自带的模块，或者没有登记的依赖）；缺席：这个项目没有可读的依赖清单，无从判断。
   */
  declared?: boolean;
}

export interface BriefingTarget {
  name: string;
  type?: string;
  inferredRole?: string;
  fileCount?: number;
}

export interface ProjectContextBriefingFacts {
  projectMeta: Record<string, unknown>;
  targets: BriefingTarget[];
  languageStats: Record<string, number>;
  depGraphData: DependencyGraph | null;
  externalDependencies: BriefingExternalDependency[];
  localPackageModules: LocalPackageModule[];
  totalSourceFiles: number | undefined;
  panoramaResult: Record<string, unknown> | null;
}

/** 声明式依赖图里表示"项目外"的节点类型（各发现器的写法）。 */
const EXTERNAL_NODE_TYPES = new Set(['remote', 'external']);
/** "包含"是归属关系（包里有哪些目标），不是依赖。 */
const MEMBERSHIP_EDGE_TYPE = 'contains';

function isExternalNode(type: string | undefined): boolean {
  return type !== undefined && EXTERNAL_NODE_TYPES.has(type);
}

export function buildProjectContextBriefingFacts(
  input: ProjectContextPresenterInput
): ProjectContextBriefingFacts {
  const internalNames = collectInternalNames(input);
  const declared = readDeclaredDependencies(input.repo?.dependencyGraph, internalNames);
  const targets = buildTargets(input);
  const dependencyGraph = buildDependencyGraph(input, declared, targets);
  const externalDependencies = buildExternalDependencies(input, declared, internalNames);
  const localPackageModules = buildLocalPackageModules(input);

  // 这里有两处取舍会改变简报内容：依赖图取声明的还是观察到的、外部依赖里有多少是从 import 里补的。
  Logger.getInstance().debug('[MissionBriefing] ProjectContext facts mapped to briefing inputs', {
    dependencyGraphSource: dependencyGraph.source,
    declaredGraphSource: input.repo?.dependencyGraph?.source ?? null,
    declaredInternalEdges: declared?.internalEdgeCount ?? 0,
    graphNodes: dependencyGraph.graph?.nodes?.length ?? 0,
    graphEdges: dependencyGraph.graph?.edges?.length ?? 0,
    externalDeclared: externalDependencies.filter((dependency) => dependency.declared === true)
      .length,
    externalObservedOnly: externalDependencies.filter((dependency) => dependency.declared !== true)
      .length,
    localPackages: localPackageModules.length,
    targets: targets.length,
    targetsWithoutFileCount: targets.filter((target) => target.fileCount === undefined).length,
  });

  return {
    projectMeta: buildProjectMeta(input),
    targets,
    languageStats: buildLanguageStats(input),
    depGraphData: dependencyGraph.graph,
    externalDependencies,
    localPackageModules,
    totalSourceFiles: countSourceFiles(input),
    panoramaResult: buildPanorama(input),
  };
}

function buildProjectMeta(input: ProjectContextPresenterInput): Record<string, unknown> {
  const repoName = input.repo?.repo.name;
  const projectRoot = input.project.projectRoot;
  return {
    name: input.project.displayName ?? repoName ?? basename(projectRoot) ?? 'project-context',
    primaryLanguage: inferPrimaryLanguage(input),
    // 项目的源码文件数。files 只是读过明细的那一部分，只在没有整体统计时才用它。
    fileCount: countSourceFiles(input) ?? input.files.length,
    projectType:
      input.repo?.packageSystems[0]?.kind ?? input.repo?.buildSystems[0]?.kind ?? 'project-context',
    projectRoot,
  };
}

function buildTargets(input: ProjectContextPresenterInput): BriefingTarget[] {
  const moduleFileCounts = new Map(
    input.modules.map((moduleContext) => [
      moduleContext.module.name,
      moduleContext.ownedFiles.length,
    ])
  );
  const repoTargets = input.repo?.targets.map((target) => ({
    name: target.name,
    type: target.kind ?? 'target',
    // 宿主给了同名模块的明细时，用模块拥有的文件数（宿主按目录给模块划文件，冷启动简报一直是这个口径）；
    // 没有模块明细的目标，用发现层数出来的、属于该目标的源码文件数。
    // 两样都没有就是不知道，不拿引用的个数充数。
    fileCount: moduleFileCounts.get(target.name) || readTargetFileCount(target),
  }));
  if (repoTargets?.length) {
    return repoTargets;
  }
  return input.modules.map((moduleContext) => ({
    name: moduleContext.module.name,
    type: moduleContext.module.kind ?? 'module',
    inferredRole: moduleContext.module.role,
    fileCount: moduleContext.ownedFiles.length,
  }));
}

function readTargetFileCount(target: TargetSummary): number | undefined {
  for (const ref of target.refs) {
    const fileCount = ref.metadata?.fileCount;
    if (typeof fileCount === 'number' && fileCount > 0) {
      return fileCount;
    }
  }
  return undefined;
}

function buildLanguageStats(input: ProjectContextPresenterInput): Record<string, number> {
  const stats = new Map<string, number>();
  for (const file of input.files) {
    if (file.language) {
      stats.set(file.language, (stats.get(file.language) ?? 0) + 1);
    }
  }
  // repo 给的是同一 scope 的总量；files 常为已读子集，只补缺少统计的语言。
  for (const language of input.repo?.languages ?? []) {
    stats.set(language.language, language.fileCount ?? stats.get(language.language) ?? 0);
  }
  return Object.fromEntries(
    [...stats.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

/**
 * 属于本项目的名字：仓库、构建目标、本地包、划分出的模块、map 里的模块，以及声明式依赖图里
 * 不是"项目外"类型的节点。import 里出现这些名字是项目内部的引用，不是外部依赖。
 */
function collectInternalNames(input: ProjectContextPresenterInput): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) {
      names.add(name);
    }
  };
  add(input.repo?.repo.name);
  for (const target of input.repo?.targets ?? []) {
    add(target.name);
  }
  for (const localPackage of input.repo?.localPackages ?? []) {
    add(localPackage.name);
  }
  for (const module of input.repo?.modules ?? []) {
    add(module.name);
    add(module.targetName);
  }
  for (const module of input.map?.modules ?? []) {
    add(module.name);
  }
  for (const node of input.repo?.dependencyGraph?.nodes ?? []) {
    if (!isExternalNode(node.type)) {
      add(node.id);
    }
  }
  return names;
}

interface DeclaredDependencies {
  /** 依赖边（不含归属关系与自指），去重后按清单顺序。 */
  edges: Array<{ from: string; to: string; type: string }>;
  /** 两端都在项目内的依赖边数。 */
  internalEdgeCount: number;
  /** 项目外依赖的名字 → 声明了它的项目内模块。 */
  externalUsers: Map<string, Set<string>>;
}

function readDeclaredDependencies(
  graph: RepoDependencyGraphSummary | undefined,
  internalNames: ReadonlySet<string>
): DeclaredDependencies | null {
  if (!graph) {
    return null;
  }
  const edges: DeclaredDependencies['edges'] = [];
  const seen = new Set<string>();
  const externalUsers = new Map<string, Set<string>>();
  let internalEdgeCount = 0;
  for (const node of graph.nodes) {
    if (isExternalNode(node.type) && !internalNames.has(node.id)) {
      externalUsers.set(node.id, externalUsers.get(node.id) ?? new Set());
    }
  }
  for (const edge of graph.edges) {
    const type = edge.type ?? 'depends_on';
    if (type === MEMBERSHIP_EDGE_TYPE || edge.from === edge.to) {
      continue;
    }
    const key = `${edge.from}\u0000${edge.to}\u0000${type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push({ from: edge.from, to: edge.to, type });
    if (internalNames.has(edge.to)) {
      internalEdgeCount += internalNames.has(edge.from) ? 1 : 0;
      continue;
    }
    const users = externalUsers.get(edge.to) ?? new Set<string>();
    users.add(edge.from);
    externalUsers.set(edge.to, users);
  }
  return { edges, internalEdgeCount, externalUsers };
}

/**
 * 模块依赖图。
 *
 * 清单声明了项目内部的依赖（比如 SPM 的 target 之间）时用声明的图：它不依赖宿主选了哪些模块来分析，
 * 是完整的。清单只声明了"这个包依赖哪些外部包"时（单包的 JS / TS 项目），内部结构只有从 import 里
 * 才看得到，这时用 map 观察到的模块与模块间 import。
 */
function buildDependencyGraph(
  input: ProjectContextPresenterInput,
  declared: DeclaredDependencies | null,
  targets: readonly BriefingTarget[]
): { graph: DependencyGraph | null; source: 'declared' | 'observed' | 'none' } {
  const declaredGraph = input.repo?.dependencyGraph;
  const hasObservedModules = (input.map?.modules.length ?? 0) > 0;
  if (
    declaredGraph &&
    declared &&
    (declared.internalEdgeCount > 0 || (!hasObservedModules && declared.edges.length > 0))
  ) {
    // 节点的文件数与简报 targets 一段用同一个数。
    const targetFileCounts = new Map<string, number>();
    for (const target of targets) {
      if (target.fileCount !== undefined && !targetFileCounts.has(target.name)) {
        targetFileCounts.set(target.name, target.fileCount);
      }
    }
    const nodes = new Map<string, { id: string; label: string; fileCount?: number }>();
    for (const node of declaredGraph.nodes) {
      if (nodes.has(node.id)) {
        continue;
      }
      const fileCount = isExternalNode(node.type) ? undefined : targetFileCounts.get(node.id);
      nodes.set(node.id, {
        id: node.id,
        label: node.label ?? node.id,
        ...(fileCount !== undefined ? { fileCount } : {}),
      });
    }
    return { graph: { nodes: [...nodes.values()], edges: declared.edges }, source: 'declared' };
  }

  // 观察到的图：节点是 map 的模块，边是模块到模块的 import（哪个模块依赖哪个、多少条）。
  // 层不是模块，不进节点；文件之间的引用不是模块依赖，不进边。
  const nodes =
    input.map?.modules.map((module) => ({
      id: module.id,
      label: module.name,
      fileCount: module.ownedFileCount,
    })) ?? [];
  const edges =
    input.map?.majorFlows.flatMap((flow) =>
      flow.from && flow.to
        ? [
            {
              from: flow.from.id,
              to: flow.to.id,
              type: flow.relationKind ?? 'depends_on',
              relationCount: flow.relationCount,
            },
          ]
        : []
    ) ?? [];
  if (!nodes.length && !edges.length) {
    return { graph: null, source: 'none' };
  }
  return { graph: { nodes, edges }, source: 'observed' };
}

/**
 * 项目外的依赖：清单声明的，加上代码里 import 了、清单没有声明的。
 *
 * map 把"种子模块认不出来的 import"都记成外部依赖，其中会混进项目自己的模块（宿主只给了一部分模块
 * 当种子时尤其多），所以属于本项目的名字一律剔掉。带子路径的 import（`pkg/sub`）并到它所属的包名下。
 */
function buildExternalDependencies(
  input: ProjectContextPresenterInput,
  declared: DeclaredDependencies | null,
  internalNames: ReadonlySet<string>
): BriefingExternalDependency[] {
  const entries = new Map<string, { usedBy: Set<string>; declared?: boolean }>();
  for (const [name, users] of declared?.externalUsers ?? []) {
    entries.set(name, { usedBy: new Set(users), declared: true });
  }

  const observed = (input.map?.externalDependencyHotspots ?? []).filter(
    (dependency) =>
      // unmatched 是没找到文件的相对路径 import，不是哪个外部依赖。
      dependency.category !== 'unmatched' &&
      !isProjectAliasSpecifier(dependency.name) &&
      !internalNames.has(dependency.name)
  );
  const knownNames = new Set([...entries.keys(), ...observed.map((dependency) => dependency.name)]);
  for (const dependency of observed) {
    const name = owningDependencyName(dependency.name, knownNames);
    if (internalNames.has(name)) {
      continue;
    }
    const entry = entries.get(name) ?? {
      usedBy: new Set<string>(),
      ...(declared ? { declared: false } : {}),
    };
    if (dependency.usedBy) {
      entry.usedBy.add(dependency.usedBy.name);
    }
    entries.set(name, entry);
  }

  return [...entries.entries()]
    .map(([name, entry]) => ({
      name,
      usedBy: [...entry.usedBy].sort(),
      ...(entry.declared !== undefined ? { declared: entry.declared } : {}),
    }))
    .sort(
      (left, right) =>
        right.usedBy.length - left.usedBy.length || left.name.localeCompare(right.name)
    );
}

/**
 * 项目自己的路径别名：`#shared/x`（package.json 的 imports，按定义只在包内可见）、`@/x`、`~/x`
 * （构建工具配置的源码根别名；它们不是合法的包名）。这些 import 指向项目内部。
 */
function isProjectAliasSpecifier(name: string): boolean {
  return name.startsWith('#') || name.startsWith('@/') || name.startsWith('~/');
}

/** `pkg/sub/path` 这样的 import，归到已知名字里最长的那个前缀（`pkg`）；没有这样的前缀就是它自己。 */
function owningDependencyName(name: string, knownNames: ReadonlySet<string>): string {
  let cut = name.lastIndexOf('/');
  while (cut > 0) {
    const prefix = name.slice(0, cut);
    if (knownNames.has(prefix)) {
      return prefix;
    }
    cut = name.lastIndexOf('/', cut - 1);
  }
  return name;
}

/**
 * 本地包：repo 声明的 localPackages。只有它们才是"必须连同主项目一起覆盖的子包"。
 * 路径是仓库根的那一个就是主项目自己，不算。文件数是落在包目录下的源码文件数。
 */
function buildLocalPackageModules(input: ProjectContextPresenterInput): LocalPackageModule[] {
  const packages = (input.repo?.localPackages ?? []).filter(
    (localPackage) => localPackage.path !== undefined && !isRepositoryRoot(localPackage.path)
  );
  if (!packages.length) {
    return [];
  }
  const knownFiles = collectKnownSourceFiles(input);
  return packages.map((localPackage) => {
    const directory = (localPackage.path as string).replace(/\/+$/, '');
    const isInside = (filePath: string) =>
      filePath === directory || filePath.startsWith(`${directory}/`);
    const files = knownFiles.filter(isInside);
    // repo 的模块划分覆盖全部源码文件，按目录加总就是这个包的文件数；
    // 旧结果不带划分时，只能数宿主读到过的那些文件。
    const partitioned = (input.repo?.modules ?? []).filter((module) => isInside(module.path));
    const fileCount = partitioned.length
      ? partitioned.reduce((sum, module) => sum + module.fileCount, 0)
      : files.length;
    const moduleContext = input.modules.find(
      (candidate) => candidate.module.name === localPackage.name
    );
    const mapModule = input.map?.modules.find((candidate) => candidate.name === localPackage.name);
    return {
      name: localPackage.name,
      packageName: localPackage.name,
      fileCount,
      inferredRole: moduleContext?.module.role ?? mapModule?.role,
      keyFiles: files.slice(0, 6),
    };
  });
}

function isRepositoryRoot(pathValue: string): boolean {
  return pathValue === '' || pathValue === '.' || pathValue === './';
}

/** 宿主读到过的源码文件路径（模块拥有的文件与已读文件，去重排序）。 */
function collectKnownSourceFiles(input: ProjectContextPresenterInput): string[] {
  const files = new Set<string>();
  for (const moduleContext of input.modules) {
    for (const file of moduleContext.ownedFiles) {
      files.add(file.filePath);
    }
  }
  for (const file of input.files) {
    files.add(file.filePath);
  }
  return [...files].sort();
}

/** 源码文件总数：repo 的语言统计是整个范围的总量。没有它就是不知道。 */
function countSourceFiles(input: ProjectContextPresenterInput): number | undefined {
  const total = (input.repo?.languages ?? []).reduce(
    (sum, language) => sum + (language.fileCount ?? 0),
    0
  );
  return total > 0 ? total : undefined;
}

function buildPanorama(input: ProjectContextPresenterInput): Record<string, unknown> | null {
  if (!input.map && !input.moduleLayers.length && !input.unavailable.length) {
    return null;
  }
  return {
    source: 'project-context',
    layers:
      input.map?.layers.map((layer) => ({
        level: layer.order ?? 0,
        name: layer.name,
        modules:
          input.map?.modules
            .filter(
              (module) => module.configLayer === layer.id || module.configLayer === layer.name
            )
            .map((module) => module.name) ?? [],
      })) ?? [],
    // 进出度是 map 数出来的模块间依赖数；与别的模块没有依赖的模块不是耦合热点，不列。
    // 旧的 map 结果只有综合分、没有进出度，沿用原先的写法（综合分记在 fanIn 上）。
    couplingHotspots:
      input.map?.hotspots
        .filter(
          (hotspot) =>
            hotspot.fanIn === undefined ||
            hotspot.fanOut === undefined ||
            hotspot.fanIn + hotspot.fanOut > 0
        )
        .map((hotspot) => ({
          module: hotspot.ref.label ?? hotspot.ref.id,
          fanIn: hotspot.fanIn ?? Math.round(hotspot.score),
          fanOut: hotspot.fanOut ?? 0,
        })) ?? [],
    cyclicDependencies:
      input.map?.cycles.map((cycle) => ({
        cycle: cycle.refs.map((ref) => ref.label ?? ref.id),
        severity: cycle.summary,
      })) ?? [],
    projectContextUnavailable: input.unavailable.map((item) => ({
      queryLevel: item.queryLevel,
      reason: item.reason,
    })),
  };
}

function inferPrimaryLanguage(input: ProjectContextPresenterInput): string {
  const repoLanguage = input.repo?.languages[0]?.language;
  if (repoLanguage) {
    return repoLanguage;
  }
  const stats = buildLanguageStats(input);
  return Object.entries(stats).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'unknown';
}

function basename(pathValue: string): string | undefined {
  return pathValue.split('/').filter(Boolean).pop();
}

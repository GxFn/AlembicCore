import type {
  FileSummary,
  PathSummary,
  ProjectContextJson,
  ProjectContextRef,
  SourceFolderSummary,
  SourceRangeSummary,
} from './ProjectContextRefs.js';

export type ProjectContextAnchorKind =
  | 'file-line'
  | 'source-range'
  | 'symbol-ref'
  | 'relation-site-ref'
  | 'source-slice-ref'
  | 'context-ref';

export interface ProjectContextAnchor {
  kind: ProjectContextAnchorKind;
  filePath?: string;
  line?: number;
  range?: SourceRangeSummary;
  ref?: ProjectContextRef;
}

export interface AnchorRangeRadius {
  beforeLines: number;
  afterLines: number;
  relationHops: number;
}

export interface SymbolSummary {
  name: string;
  kind: string;
  filePath: string;
  range?: SourceRangeSummary;
  ref?: ProjectContextRef;
  exported?: boolean;
  qualifiedName?: string;
  signature?: string;
  container?: string;
}

/** 一条关系是谁、凭什么得出的。 */
export interface RelationResolutionSummary {
  /** lexical、import-binding、module-import、heritage 是自有链接器；codegraph 是外部引擎。 */
  linker: string;
  strategy: string;
  /** certain：有语法与配置为证；trusted：高把握但不是证明；candidate：猜测，默认不出现。 */
  tier: 'certain' | 'trusted' | 'candidate';
  confidence: number;
}

export interface RelationSummary {
  kind: string;
  direction?: 'inflow' | 'outflow' | 'internal';
  label?: string;
  from?: RelationEndpointSummary;
  to?: RelationEndpointSummary;
  fromRef?: ProjectContextRef;
  toRef?: ProjectContextRef;
  filePath?: string;
  range?: SourceRangeSummary;
  ref?: ProjectContextRef;
  sourceRef?: ProjectContextRef;
  targetRef?: ProjectContextRef;
  unresolved?: boolean;
  reason?: string;
  /** 来自源码索引的关系带解析记录；按文件现算的关系（file-flow）都有语法证明，不带这一项。 */
  resolution?: RelationResolutionSummary;
}

export interface RelationEndpointSummary {
  label: string;
  filePath?: string;
  ref?: ProjectContextRef;
  symbol?: string;
  qualifiedName?: string;
}

export interface NamingSummary {
  convention?: string;
  warnings: string[];
}

export interface ProjectSpaceSummary {
  displayName?: string;
  id: string;
  projectScopeId?: string;
  root: string;
  sourceFolders: SourceFolderSummary[];
}

export interface RepoSummary {
  id: string;
  name: string;
  root: string;
  ref?: ProjectContextRef;
}

export interface RepoBoundarySummary {
  repoRef: ProjectContextRef;
  sourceFolders: SourceFolderSummary[];
  notes: string[];
}

export interface ProjectTreeSummary {
  roots: PathSummary[];
  truncated: boolean;
}

export interface LanguageSummary {
  language: string;
  fileCount?: number;
}

export interface BuildSystemSummary {
  kind: string;
  configRefs: ProjectContextRef[];
}

export interface PackageSystemSummary {
  kind: string;
  manifestRefs: ProjectContextRef[];
}

export interface TargetSummary {
  name: string;
  kind?: string;
  refs: ProjectContextRef[];
}

export interface PackageSummary {
  name: string;
  path?: string;
  ref?: ProjectContextRef;
}

export interface EntrypointSummary {
  name: string;
  kind: string;
  refs: ProjectContextRef[];
}

export interface CommandSummary {
  name: string;
  command: string;
  sourceRef?: ProjectContextRef;
}

export interface ConfigFileSummary {
  path: string;
  kind: string;
  ref?: ProjectContextRef;
}

export interface ProjectMapSummary {
  moduleCount: number;
  layerCount: number;
  dependencyEdgeCount: number;
  cycleCount: number;
  hotspotCount: number;
  mapRef?: ProjectContextRef;
  nextRefs: ProjectContextRef[];
}

export interface ModuleSummary {
  id: string;
  name: string;
  kind?: string;
  configLayer?: string;
  ownedFileCount?: number;
  role?: string;
  roleConfidence?: number;
  ref?: ProjectContextRef;
}

export interface LayerSummary {
  id: string;
  name: string;
  fileGroups?: string[];
  order?: number;
  relationCount?: number;
  uncertain?: boolean;
  ref?: ProjectContextRef;
}

export interface DependencySummary {
  edgeCount: number;
  notes: string[];
}

export interface DependencyCycleSummary {
  refs: ProjectContextRef[];
  summary: string;
}

export interface HotspotSummary {
  ref: ProjectContextRef;
  score: number;
  reason: string;
}

export interface FlowSummary {
  refs: ProjectContextRef[];
  summary: string;
}

export interface ExternalDependencySummary {
  name: string;
  category?: string;
  refs: ProjectContextRef[];
}

export interface FileGroupSummary {
  name: string;
  files: FileSummary[];
  ref?: ProjectContextRef;
}

export interface AnchorRangeContext {
  anchor: ProjectContextAnchor;
  radius: AnchorRangeRadius;
  range: SourceRangeSummary;
  file: FileSummary;
  sourceSlices: ProjectContextRef[];
  symbols: SymbolSummary[];
  relationSites: RelationSummary[];
  relatedRefs: ProjectContextRef[];
  containingRefs: ProjectContextRef[];
  nextRefs: ProjectContextRef[];
}

export interface SpaceContext {
  space: ProjectSpaceSummary;
  repos: RepoSummary[];
  sourceFolders: SourceFolderSummary[];
  activeRepo?: ProjectContextRef;
  boundaries: RepoBoundarySummary[];
  projectTree?: ProjectTreeSummary;
  structuralHotspots: HotspotSummary[];
  nextRefs: ProjectContextRef[];
}

/**
 * 声明式模块依赖图节点(2026-07-10 链路验通补齐):来自构建清单的权威声明——
 * SPM target dependencies、easybox boxspec `s.dependency`、Boxfile 层级归属等。
 * 与 import 推导的 ProjectMap 依赖度量互补:这里是"清单说了什么",不是"代码引用了什么"。
 */
export interface RepoDependencyGraphNode {
  id: string;
  label?: string;
  /** host/local/external 等(各 Discoverer 语义)。 */
  type?: string;
  /** easybox 等分层配置系的层级归属。 */
  layer?: string;
  version?: string;
}

export interface RepoDependencyGraphEdge {
  from: string;
  to: string;
  /** depends_on/contains 等(各 Discoverer 语义)。 */
  type?: string;
}

export interface RepoDependencyGraphSummary {
  /** 产出该图的 Discoverer id(spm/customConfig/node/...),消费方据此解释节点语义。 */
  source: string;
  nodes: RepoDependencyGraphNode[];
  edges: RepoDependencyGraphEdge[];
  /** 超出防御性上限被截断时为 true(上限见 repo 装配处)。 */
  truncated?: boolean;
}

/**
 * 仓库划分出的一个模块。划分规则只有一份：发现层给出多个构建目标时每个目标是一个模块；
 * 只有一个目标时按源码根下的一级目录划分；其余文件归到所在的源码根。
 * 一个文件属于路径前缀最长的那个模块。
 */
export interface RepoModuleSummary {
  name: string;
  /** 模块目录，仓库相对路径；仓库根写作 `.`。 */
  path: string;
  kind: 'target' | 'area' | 'root';
  /** kind 为 target 时对应的构建目标。 */
  targetName?: string;
  targetKind?: string;
  fileCount: number;
  /** 可以原样作为 module / module-layers / map 的种子。 */
  ref: ProjectContextRef;
}

export interface RepoContext {
  repo: RepoSummary;
  languages: LanguageSummary[];
  buildSystems: BuildSystemSummary[];
  packageSystems: PackageSystemSummary[];
  targets: TargetSummary[];
  /** 源码文件的模块划分（可缺席：没有收集到任何源码文件时不带）。 */
  modules?: RepoModuleSummary[];
  localPackages: PackageSummary[];
  sourceRoots: PathSummary[];
  entrypoints: EntrypointSummary[];
  commands: CommandSummary[];
  topAreas: PathSummary[];
  configFiles: ConfigFileSummary[];
  /** 声明式模块依赖图(可缺席:Discoverer 未实现/解析失败时降级为 undefined)。 */
  dependencyGraph?: RepoDependencyGraphSummary;
  mapRef?: ProjectContextRef;
  mapSummary?: ProjectMapSummary;
  nextRefs: ProjectContextRef[];
}

export interface ProjectMap {
  repo: RepoSummary;
  modules: ModuleSummary[];
  layers: LayerSummary[];
  dependencySummary: DependencySummary;
  cycles: DependencyCycleSummary[];
  hotspots: HotspotSummary[];
  majorFlows: FlowSummary[];
  externalDependencyHotspots: ExternalDependencySummary[];
  nextRefs: ProjectContextRef[];
}

export interface ModuleContext {
  module: ModuleSummary;
  ownedFiles: FileSummary[];
  publicSurfaces: SymbolSummary[];
  inflow: RelationSummary[];
  outflow: RelationSummary[];
  nextRefs: ProjectContextRef[];
}

export interface ModuleLayerContext {
  module: ModuleSummary;
  layers: LayerSummary[];
  fileGroups: FileGroupSummary[];
  boundaryCrossings: RelationSummary[];
  nextRefs: ProjectContextRef[];
}

export interface FileFlowContext {
  file: FileSummary;
  imports: RelationSummary[];
  exports: SymbolSummary[];
  callers: RelationSummary[];
  callees: RelationSummary[];
  inflow: RelationSummary[];
  outflow: RelationSummary[];
  nextRefs: ProjectContextRef[];
}

export interface FileSymbolContext {
  file: FileSummary;
  symbols: SymbolSummary[];
  naming: NamingSummary;
  nextRefs: ProjectContextRef[];
}

export interface SourceSliceContext {
  file: FileSummary;
  range: SourceRangeSummary;
  text?: string;
  hash?: string;
  nextRefs: ProjectContextRef[];
}

export interface ProjectContextUnavailableData {
  kind: string;
  available: false;
  reason: string;
  nextRefs: ProjectContextRef[];
  details?: ProjectContextJson;
}

export type ProjectContextResult =
  | AnchorRangeContext
  | SpaceContext
  | RepoContext
  | ProjectMap
  | ModuleContext
  | ModuleLayerContext
  | FileFlowContext
  | FileSymbolContext
  | SourceSliceContext
  | ProjectContextUnavailableData;

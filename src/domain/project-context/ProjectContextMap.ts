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

export interface RepoContext {
  repo: RepoSummary;
  languages: LanguageSummary[];
  buildSystems: BuildSystemSummary[];
  packageSystems: PackageSystemSummary[];
  targets: TargetSummary[];
  localPackages: PackageSummary[];
  sourceRoots: PathSummary[];
  entrypoints: EntrypointSummary[];
  commands: CommandSummary[];
  topAreas: PathSummary[];
  configFiles: ConfigFileSummary[];
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

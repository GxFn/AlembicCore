import type { ProjectContextQueryError } from './ProjectContextContracts.js';
import type { ModuleSummary, RelationSummary, SymbolSummary } from './ProjectContextMap.js';
import type {
  FileSummary,
  ProjectContextRef,
  ProjectContextScopeInput,
  SourceRangeSummary,
} from './ProjectContextRefs.js';

/**
 * 关系查询：跨文件、可反向的"谁和谁有什么关系"。
 *
 * 九种 ProjectContext 查询按文件现算，只看得到一个文件自己的出边；这里的回答来自整个项目的
 * 源码索引，所以能回答"谁调用了它""改了它会影响谁"。回答沿用协议的符号、文件与引用，
 * 与 file-symbols、file-flow 给出的是同一套身份。
 */
export const PROJECT_RELATION_KIND_VALUES = [
  /** 一个文件里的全部声明。 */
  'symbols',
  /** 按名字或路径找声明。 */
  'search',
  'callers',
  'callees',
  /** 谁创建了这个类型的实例。 */
  'instantiations',
  'supertypes',
  'subtypes',
  /** 谁导入了这个文件。 */
  'importers',
  /** 这个文件导入了谁。 */
  'imports',
  /** 改了这些文件或这个符号，会波及哪些依赖方。 */
  'impact',
  /** 模块之间谁依赖谁。 */
  'module-dependencies',
  /** 一条引用对应的源码，以及它是否仍与当前内容一致。 */
  'evidence',
] as const;

export type ProjectRelationKind = (typeof PROJECT_RELATION_KIND_VALUES)[number];

/** 沿一种关系的边走的那几种查询。 */
export type ProjectRelationWalkKind = Extract<
  ProjectRelationKind,
  'callers' | 'callees' | 'instantiations' | 'supertypes' | 'subtypes' | 'importers' | 'imports'
>;

/**
 * 查询的起点。给得越具体越好；按这个顺序取用：
 * ref（协议引用或它的 id）→ filePath + symbol（+ line 区分重载）→ symbol（全项目里必须唯一）→ filePath。
 */
export interface ProjectRelationTarget {
  ref?: ProjectContextRef | string;
  filePath?: string;
  /** 名字或限定名，如 `load`、`Cache.load`。 */
  symbol?: string;
  line?: number;
}

export interface ProjectRelationRequest {
  kind: ProjectRelationKind;
  scope: ProjectContextScopeInput;
  target?: ProjectRelationTarget;
  /** search 的查询词。 */
  query?: string;
  /** impact 的起点文件。 */
  changedFiles?: string[];
  /** module-dependencies：只看与这个模块有关的依赖。 */
  module?: string;
  /** 沿同一种关系走几跳。关系查询默认 1，impact 默认 3。 */
  depth?: number;
  /** 返回的符号或关系的上限。 */
  limit?: number;
  /** 起点是类型时把它的成员也算作起点。 */
  includeMembers?: boolean;
  /** 候选档的关系不是事实；只有明确要看时才给，并应向使用者标明。 */
  includeCandidates?: boolean;
  /** evidence 是否带回源码正文。 */
  includeText?: boolean;
}

/** 回答所依据的那一代索引。 */
export interface ProjectIndexState {
  available: boolean;
  generationId?: string;
  /** 索引的新鲜度：fresh、partial（有解析缺口）、stale、uninitialized 等。 */
  freshness: string;
  indexedAt?: number;
  /** 有解析缺口的文件数；关系可能因此不全。 */
  coverageGaps: number;
  /** 外部引擎这一代的状态：linked、unavailable、skipped，或没有启用（absent）。 */
  externalEngine: string;
  reason?: string;
  nextAction?: string;
}

export interface ProjectSymbolListContext {
  kind: 'symbols' | 'search';
  file?: FileSummary;
  symbols: SymbolSummary[];
  truncated: boolean;
  nextRefs: ProjectContextRef[];
}

export interface ProjectRelationWalkContext {
  kind: ProjectRelationWalkKind;
  /** 起点：符号，或文件（文件级关系；没有指定符号时是这个文件里的全部声明）。 */
  anchor: { symbol?: SymbolSummary; file?: FileSummary };
  /** 关系另一端的符号，按离起点的跳数排列。 */
  symbols: SymbolSummary[];
  /** 关系另一端的文件：文件级关系的另一端，以及调用方是文件顶层代码时的那个文件。 */
  files: FileSummary[];
  /** 每条关系带发生位置、两端与解析记录。 */
  relations: RelationSummary[];
  /** 另一端到起点的跳数，键是符号或文件引用的 id。 */
  distances: Record<string, number>;
  truncated: boolean;
  nextRefs: ProjectContextRef[];
}

export interface ProjectImpactContext {
  kind: 'impact';
  changedFiles: FileSummary[];
  /** 依赖起点的文件（直接或隔着几层），不含起点自己依赖的文件。 */
  impactedFiles: FileSummary[];
  impactedSymbols: SymbolSummary[];
  /** 其中被索引归为测试的文件。 */
  tests: FileSummary[];
  relations: RelationSummary[];
  depth: number;
  truncated: boolean;
  nextRefs: ProjectContextRef[];
}

export interface ProjectModuleDependencySummary {
  from: string;
  to: string;
  /** 构成这条模块依赖的关系数，按关系种类分。 */
  counts: Record<string, number>;
  /** 其中只属于可信档（不是确定档）的条数。 */
  trustedOnly: number;
  /** 几条有代表性的关系，供核对。 */
  samples: RelationSummary[];
}

export interface ProjectModuleDependencyContext {
  kind: 'module-dependencies';
  modules: ModuleSummary[];
  dependencies: ProjectModuleDependencySummary[];
  /** 没有归属到任何模块的文件数。 */
  unownedFiles: number;
  truncated: boolean;
  nextRefs: ProjectContextRef[];
}

export interface ProjectEvidenceContext {
  kind: 'evidence';
  file: FileSummary;
  range?: SourceRangeSummary;
  /** 引用里记的内容与当前文件一致；不一致说明引用过期，不能再当证据。 */
  current: boolean;
  /** 当前文件与索引里的版本一致。 */
  indexed: boolean;
  reason?: string;
  text?: string;
  nextRefs: ProjectContextRef[];
}

export interface ProjectRelationUnavailableContext {
  kind: ProjectRelationKind;
  available: false;
  reason: string;
  nextRefs: ProjectContextRef[];
}

export type ProjectRelationResult =
  | ProjectSymbolListContext
  | ProjectRelationWalkContext
  | ProjectImpactContext
  | ProjectModuleDependencyContext
  | ProjectEvidenceContext
  | ProjectRelationUnavailableContext;

export interface ProjectRelationEnvelope<T extends ProjectRelationResult = ProjectRelationResult> {
  contractVersion: 1;
  project: { projectRoot: string; repoId?: string };
  kind: ProjectRelationKind;
  data: T;
  index: ProjectIndexState;
  refs: ProjectContextRef[];
  errors?: ProjectContextQueryError[];
}

export function isProjectRelationKind(value: unknown): value is ProjectRelationKind {
  return (
    typeof value === 'string' && (PROJECT_RELATION_KIND_VALUES as readonly string[]).includes(value)
  );
}

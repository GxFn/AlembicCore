import type {
  FileSummary,
  LayerSummary,
  ModuleContext,
  ModuleLayerContext,
  ModuleSummary,
  ProjectContextMetadata,
  ProjectContextRef,
  ProjectContextRefScope,
  ProjectContextScope,
  RelationSummary,
} from '../../../../domain/project-context/index.js';
import { dedupeProjectContextRefs as dedupeRefs } from '../refs.js';

export interface ProjectContextModuleMapModule {
  module: ModuleSummary;
  ownedFiles: FileSummary[];
  layers: LayerSummary[];
  outflow: RelationSummary[];
  nextRefs: ProjectContextRef[];
}

export interface ProjectContextModuleDependencyRollup {
  id: string;
  from: ModuleSummary;
  to?: ModuleSummary;
  externalName?: string;
  relationKind: string;
  relationCount: number;
  refs: ProjectContextRef[];
  relationRefs: ProjectContextRef[];
  sourceRefs: ProjectContextRef[];
  targetRefs: ProjectContextRef[];
  unresolved?: boolean;
  reason?: string;
  /** 多个合法归属只保留候选，不参与确定依赖的聚合；仅歧义分支出现此字段。 */
  ambiguousTargets?: ModuleSummary[];
}

export function createProjectContextModuleMapModule(input: {
  moduleContext: ModuleContext;
  layerContext?: ModuleLayerContext;
}): ProjectContextModuleMapModule {
  return {
    layers: input.layerContext?.layers ?? [],
    module: input.moduleContext.module,
    nextRefs: dedupeRefs([
      input.moduleContext.module.ref,
      ...input.moduleContext.nextRefs,
      ...(input.layerContext?.nextRefs ?? []),
    ]),
    outflow: input.moduleContext.outflow,
    ownedFiles: input.moduleContext.ownedFiles,
  };
}

export function createProjectContextModuleDependencyRollups(input: {
  modules: readonly ProjectContextModuleMapModule[];
  scope: ProjectContextScope;
}): ProjectContextModuleDependencyRollup[] {
  const fileToModule = new Map<string, Map<string, ModuleSummary>>();
  for (const moduleRecord of input.modules) {
    for (const file of moduleRecord.ownedFiles) {
      indexModuleCandidate(fileToModule, file.filePath, moduleRecord.module);
    }
  }
  // Track1(2026-07-10):模块名索引。Swift `import AOXFoundationKit`/ObjC
  // `#import <NetKit/NetClient.h>` 的 specifier 是模块名而非文件路径,文件级解析
  // 必然落空 → 此前全部被计成 external(BiliDili 实测 internal-edges:0 而
  // external:82,其中大半是本地 AOX* 包)。文件级解析仍然优先(JS 系不受影响),
  // 落空后按 specifier 与模块名 join(精确名,或 `Name/File.h` 的首段)。
  const moduleByName = new Map<string, Map<string, ModuleSummary>>();
  for (const moduleRecord of input.modules) {
    if (moduleRecord.module.name) {
      indexModuleCandidate(moduleByName, moduleRecord.module.name, moduleRecord.module);
    }
  }

  const rollups = new Map<string, MutableDependencyRollup>();
  for (const sourceModule of input.modules) {
    for (const relation of sourceModule.outflow) {
      if (!isModuleMapDependencyRelation(relation)) {
        continue;
      }
      const targetFile = readRelationTargetFilePath(relation);
      const fileCandidates = targetFile ? moduleCandidates(fileToModule.get(targetFile)) : [];
      if (fileCandidates.length > 1) {
        addAmbiguousRelation(rollups, sourceModule.module, relation, fileCandidates, input.scope);
        continue;
      }
      const targetModule = fileCandidates[0];
      if (targetModule && targetModule.id !== sourceModule.module.id) {
        addRelationToRollup(rollups, {
          from: sourceModule.module,
          relation,
          relationKind: relation.kind,
          scope: input.scope,
          to: targetModule,
        });
        continue;
      }

      const specifier = readRelationSpecifier(relation);
      const nameCandidates = resolveModuleByImportName(specifier, moduleByName);
      if (nameCandidates.length > 1) {
        addAmbiguousRelation(rollups, sourceModule.module, relation, nameCandidates, input.scope);
        continue;
      }
      const namedModule = nameCandidates[0];
      if (namedModule && namedModule.id !== sourceModule.module.id) {
        addRelationToRollup(rollups, {
          from: sourceModule.module,
          relation,
          relationKind: relation.kind,
          scope: input.scope,
          to: namedModule,
        });
        continue;
      }

      const externalName = specifier;
      if (externalName) {
        addRelationToRollup(rollups, {
          externalName,
          from: sourceModule.module,
          reason: readRelationReason(relation),
          relation,
          relationKind: relation.kind,
          scope: input.scope,
          unresolved: relation.unresolved,
        });
      }
    }
  }

  return [...rollups.values()].map(finalizeRollup).sort(compareRollups);
}

function indexModuleCandidate(
  index: Map<string, Map<string, ModuleSummary>>,
  key: string,
  module: ModuleSummary
): void {
  const candidates = index.get(key) ?? new Map<string, ModuleSummary>();
  candidates.set(module.id, module);
  index.set(key, candidates);
}

function moduleCandidates(
  candidates: ReadonlyMap<string, ModuleSummary> | undefined
): ModuleSummary[] {
  return [...(candidates?.values() ?? [])].sort((left, right) => left.id.localeCompare(right.id));
}

function addAmbiguousRelation(
  rollups: Map<string, MutableDependencyRollup>,
  from: ModuleSummary,
  relation: RelationSummary,
  ambiguousTargets: ModuleSummary[],
  scope: ProjectContextScope
): void {
  // 文件候选优先且不再按模块名猜选；共享归属也不能被折叠为任意一个确定目标。
  addRelationToRollup(rollups, {
    ambiguousTargets,
    from,
    reason: 'module-dependency-target-ambiguous',
    relation,
    relationKind: relation.kind,
    scope,
    unresolved: true,
  });
}

/**
 * specifier → 本地模块(Track1 模块名 join)。规则刻意保守:
 * ①精确等于模块名(Swift 模块导入);②`Name/...` 首段等于模块名(ObjC 框架头
 * 导入形态)。相对路径(./ ../)与 npm scope(@x/y 首段带 @)天然不命中。
 */
function resolveModuleByImportName(
  specifier: string | undefined,
  moduleByName: ReadonlyMap<string, ReadonlyMap<string, ModuleSummary>>
): ModuleSummary[] {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('@')) {
    return [];
  }
  const exact = moduleByName.get(specifier);
  if (exact) {
    return moduleCandidates(exact);
  }
  const slashIndex = specifier.indexOf('/');
  if (slashIndex > 0) {
    return moduleCandidates(moduleByName.get(specifier.slice(0, slashIndex)));
  }
  return [];
}

export function createProjectContextFileFlowRef(input: {
  projectRoot: string;
  filePath: string;
  repoId?: string;
  sourceFolder?: string;
  parentRef?: string;
}): ProjectContextRef {
  return {
    id: createProjectContextFileFlowRefId(input),
    kind: 'file-flow',
    label: input.filePath,
    level: 'file-flow',
    metadata: {
      source: 'module-map-rollup',
    },
    parentRef: input.parentRef,
    scope: createFileFlowScope(input),
  };
}

interface MutableDependencyRollup {
  from: ModuleSummary;
  to?: ModuleSummary;
  externalName?: string;
  relationKind: string;
  refs: ProjectContextRef[];
  relationRefs: ProjectContextRef[];
  sourceRefs: ProjectContextRef[];
  targetRefs: ProjectContextRef[];
  unresolved?: boolean;
  reason?: string;
  ambiguousTargets?: ModuleSummary[];
}

function addRelationToRollup(
  rollups: Map<string, MutableDependencyRollup>,
  input: {
    from: ModuleSummary;
    relation: RelationSummary;
    relationKind: string;
    scope: ProjectContextScope;
    to?: ModuleSummary;
    externalName?: string;
    unresolved?: boolean;
    reason?: string;
    ambiguousTargets?: ModuleSummary[];
  }
): void {
  const key = createRollupKey(input);
  const current =
    rollups.get(key) ??
    ({
      externalName: input.externalName,
      from: input.from,
      reason: input.reason,
      refs: [],
      relationKind: input.relationKind,
      relationRefs: [],
      sourceRefs: [],
      targetRefs: [],
      to: input.to,
      unresolved: input.unresolved,
      ...(input.ambiguousTargets ? { ambiguousTargets: input.ambiguousTargets } : {}),
    } satisfies MutableDependencyRollup);

  current.refs.push(
    ...dedupeRefs([
      input.from.ref,
      input.to?.ref,
      ...(input.ambiguousTargets ?? []).map((module) => module.ref),
      input.relation.ref,
      input.relation.sourceRef,
      input.relation.targetRef,
      input.relation.from?.ref,
      input.relation.to?.ref,
      createProjectContextFileFlowRef({
        filePath: input.relation.filePath ?? input.relation.sourceRef?.scope.filePath ?? '',
        parentRef: input.relation.ref?.id,
        projectRoot: input.scope.projectRoot,
        repoId: input.scope.repoId,
        sourceFolder: input.scope.sourceFolder,
      }),
    ]).filter((ref) => ref.scope.filePath !== '')
  );
  current.relationRefs.push(...dedupeRefs([input.relation.ref]));
  current.sourceRefs.push(...dedupeRefs([input.relation.sourceRef]));
  current.targetRefs.push(
    ...dedupeRefs([
      input.relation.targetRef,
      input.relation.to?.ref,
      ...(input.ambiguousTargets ?? []).map((module) => module.ref),
    ])
  );
  if (input.unresolved !== undefined) {
    current.unresolved = input.unresolved;
  }
  if (input.reason) {
    current.reason = input.reason;
  }
  rollups.set(key, current);
}

function finalizeRollup(input: MutableDependencyRollup): ProjectContextModuleDependencyRollup {
  const id = createRollupId(input);
  const relationRefs = dedupeRefs(input.relationRefs);
  return {
    externalName: input.externalName,
    from: input.from,
    id,
    reason: input.reason,
    refs: dedupeRefs(input.refs),
    relationCount: relationRefs.length,
    relationKind: input.relationKind,
    relationRefs,
    sourceRefs: dedupeRefs(input.sourceRefs),
    targetRefs: dedupeRefs(input.targetRefs),
    to: input.to,
    unresolved: input.unresolved,
    ...(input.ambiguousTargets ? { ambiguousTargets: input.ambiguousTargets } : {}),
  };
}

function createRollupKey(input: {
  from: ModuleSummary;
  relationKind: string;
  to?: ModuleSummary;
  externalName?: string;
  ambiguousTargets?: ModuleSummary[];
}): string {
  return [
    input.from.id,
    input.ambiguousTargets
      ? `ambiguous:${JSON.stringify(input.ambiguousTargets.map((module) => module.id))}`
      : (input.to?.id ?? `external:${input.externalName ?? 'unknown'}`),
    input.relationKind,
  ].join('::');
}

function createRollupId(input: MutableDependencyRollup): string {
  return createRollupKey(input);
}

function isModuleMapDependencyRelation(relation: RelationSummary): boolean {
  return ['calls', 'data_flow', 'depends_on', 'imports', 'references'].includes(relation.kind);
}

function readRelationTargetFilePath(relation: RelationSummary): string | undefined {
  return (
    relation.to?.filePath ??
    relation.targetRef?.scope.filePath ??
    relation.toRef?.scope.filePath ??
    relation.ref?.metadata?.targetFilePath?.toString()
  );
}

function readRelationSpecifier(relation: RelationSummary): string | undefined {
  const metadata = readMetadata(relation.ref);
  const specifier = readMetadataString(metadata, 'specifier');
  if (specifier && !specifier.startsWith('.') && specifier !== 'unknown') {
    return specifier;
  }
  if (relation.unresolved && relation.to?.label && !relation.to.filePath) {
    return relation.to.label;
  }
  return undefined;
}

function readRelationReason(relation: RelationSummary): string | undefined {
  return relation.reason ?? readMetadataString(readMetadata(relation.ref), 'reason');
}

function readMetadata(ref: ProjectContextRef | undefined): ProjectContextMetadata {
  return ref?.metadata ?? {};
}

function readMetadataString(metadata: ProjectContextMetadata, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function createFileFlowScope(input: {
  projectRoot: string;
  filePath: string;
  repoId?: string;
  sourceFolder?: string;
}): ProjectContextRefScope {
  return {
    filePath: input.filePath,
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function createProjectContextFileFlowRefId(input: { filePath: string; repoId?: string }): string {
  return `file-flow:${encodeRefPart(input.repoId ?? 'root')}:${encodeRefPart(input.filePath)}`;
}

function compareRollups(
  left: ProjectContextModuleDependencyRollup,
  right: ProjectContextModuleDependencyRollup
): number {
  const order =
    left.from.name.localeCompare(right.from.name) ||
    (left.to?.name ?? left.externalName ?? '').localeCompare(
      right.to?.name ?? right.externalName ?? ''
    ) ||
    left.relationKind.localeCompare(right.relationKind);
  // 歧义集合没有单一目标名，补充稳定身份排序；普通分支仍保留既有的同分顺序。
  return (
    order || (left.ambiguousTargets || right.ambiguousTargets ? left.id.localeCompare(right.id) : 0)
  );
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

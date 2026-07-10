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
  const fileToModule = new Map<string, ProjectContextModuleMapModule>();
  for (const moduleRecord of input.modules) {
    for (const file of moduleRecord.ownedFiles) {
      fileToModule.set(file.filePath, moduleRecord);
    }
  }
  // Track1(2026-07-10):模块名索引。Swift `import AOXFoundationKit`/ObjC
  // `#import <NetKit/NetClient.h>` 的 specifier 是模块名而非文件路径,文件级解析
  // 必然落空 → 此前全部被计成 external(BiliDili 实测 internal-edges:0 而
  // external:82,其中大半是本地 AOX* 包)。文件级解析仍然优先(JS 系不受影响),
  // 落空后按 specifier 与模块名 join(精确名,或 `Name/File.h` 的首段)。
  const moduleByName = new Map<string, ProjectContextModuleMapModule>();
  for (const moduleRecord of input.modules) {
    if (moduleRecord.module.name) {
      moduleByName.set(moduleRecord.module.name, moduleRecord);
    }
  }

  const rollups = new Map<string, MutableDependencyRollup>();
  for (const sourceModule of input.modules) {
    for (const relation of sourceModule.outflow) {
      if (!isModuleMapDependencyRelation(relation)) {
        continue;
      }
      const targetFile = readRelationTargetFilePath(relation);
      const targetModule = targetFile ? fileToModule.get(targetFile) : undefined;
      if (targetModule && targetModule.module.id !== sourceModule.module.id) {
        addRelationToRollup(rollups, {
          from: sourceModule.module,
          relation,
          relationKind: relation.kind,
          scope: input.scope,
          to: targetModule.module,
        });
        continue;
      }

      const specifier = readRelationSpecifier(relation);
      const namedModule = resolveModuleByImportName(specifier, moduleByName);
      if (namedModule && namedModule.module.id !== sourceModule.module.id) {
        addRelationToRollup(rollups, {
          from: sourceModule.module,
          relation,
          relationKind: relation.kind,
          scope: input.scope,
          to: namedModule.module,
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

/**
 * specifier → 本地模块(Track1 模块名 join)。规则刻意保守:
 * ①精确等于模块名(Swift 模块导入);②`Name/...` 首段等于模块名(ObjC 框架头
 * 导入形态)。相对路径(./ ../)与 npm scope(@x/y 首段带 @)天然不命中。
 */
function resolveModuleByImportName(
  specifier: string | undefined,
  moduleByName: ReadonlyMap<string, ProjectContextModuleMapModule>
): ProjectContextModuleMapModule | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('@')) {
    return undefined;
  }
  const exact = moduleByName.get(specifier);
  if (exact) {
    return exact;
  }
  const slashIndex = specifier.indexOf('/');
  if (slashIndex > 0) {
    return moduleByName.get(specifier.slice(0, slashIndex));
  }
  return undefined;
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
    } satisfies MutableDependencyRollup);

  current.refs.push(
    ...dedupeRefs([
      input.from.ref,
      input.to?.ref,
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
  current.targetRefs.push(...dedupeRefs([input.relation.targetRef, input.relation.to?.ref]));
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
  };
}

function createRollupKey(input: {
  from: ModuleSummary;
  relationKind: string;
  to?: ModuleSummary;
  externalName?: string;
}): string {
  return [
    input.from.id,
    input.to?.id ?? `external:${input.externalName ?? 'unknown'}`,
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

function compareRollups(
  left: ProjectContextModuleDependencyRollup,
  right: ProjectContextModuleDependencyRollup
): number {
  return (
    left.from.name.localeCompare(right.from.name) ||
    (left.to?.name ?? left.externalName ?? '').localeCompare(
      right.to?.name ?? right.externalName ?? ''
    ) ||
    left.relationKind.localeCompare(right.relationKind)
  );
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

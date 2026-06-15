import path from 'node:path';

import type {
  FileFlowContext,
  FileSummary,
  LayerSummary,
  ModuleLayerContext,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
  RelationSummary,
} from '../../../domain/project-context/index.js';
import { fileFlowProjectContextHandler } from '../fileFlow/index.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import {
  createProjectContextModuleLayerRef,
  resolveProjectContextModuleSeed,
} from '../shared/moduleLayers-module/index.js';
import type { ModuleLayersRequestPayload } from './contracts.js';

interface FileFlowFacts {
  file: FileSummary;
  context: FileFlowContext;
}

interface GroupRecord {
  id: string;
  name: string;
  files: FileSummary[];
  ref: ProjectContextRef;
}

interface InternalRelationRecord {
  fromGroup: string;
  relation: RelationSummary;
  toGroup: string;
}

export const moduleLayersProjectContextHandler: ProjectContextHandler = async (
  request
): Promise<ProjectContextHandlerResult> => {
  const payload = readModuleLayersPayload(request.payload);
  const seedResult = await resolveProjectContextModuleSeed({
    payload: request.payload,
    scope: request.scope,
  });
  if (!seedResult.ok) {
    return createModuleLayersFailure(seedResult.error, seedResult.errors);
  }

  const errors = [...seedResult.errors];
  const fileFlows: FileFlowFacts[] = [];
  for (const file of seedResult.seed.ownedFiles) {
    const result = await fileFlowProjectContextHandler({
      kind: 'file-flow',
      payload: { filePath: file.filePath },
      project: request.project,
      scope: request.scope,
    });
    if (result.errors) {
      errors.push(...result.errors);
    }
    if (isUnavailableData(result.data)) {
      continue;
    }
    fileFlows.push({
      context: result.data as FileFlowContext,
      file,
    });
  }

  const groups = createFileGroups({
    files: seedResult.seed.ownedFiles,
    moduleName: seedResult.seed.name,
    modulePath: seedResult.seed.modulePath,
    moduleRef: seedResult.seed.ref,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    sourceFolder: request.scope.sourceFolder,
  });
  const groupByFile = createGroupByFile(groups);
  const relations = classifyModuleRelations({
    groupByFile,
    includeBoundaryCrossings: payload.includeBoundaryCrossings !== false,
    ownedFiles: new Set(seedResult.seed.ownedFiles.map((file) => file.filePath)),
    flows: fileFlows,
  });
  const layers = createLocalLayers({
    groups,
    internalRelations: relations.internalRelations,
    moduleName: seedResult.seed.name,
    modulePath: seedResult.seed.modulePath,
    moduleRef: seedResult.seed.ref,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    sourceFolder: request.scope.sourceFolder,
  });
  if (relations.cyclic) {
    errors.push({
      code: 'query-unavailable',
      message: 'module-layers local layer direction is cyclic or uncertain.',
      retryable: false,
      severity: 'warning',
    });
  }

  const data: ModuleLayerContext = {
    boundaryCrossings: relations.boundaryCrossings,
    fileGroups: groups.map(({ files, name, ref }) => ({ files, name, ref })),
    layers,
    module: {
      configLayer: seedResult.seed.configLayer,
      id: seedResult.seed.id,
      kind: seedResult.seed.kind,
      name: seedResult.seed.name,
      ownedFileCount: seedResult.seed.ownedFiles.length,
      ref: seedResult.seed.ref,
      role: seedResult.seed.role,
      roleConfidence: seedResult.seed.roleConfidence,
    },
    nextRefs: createNextRefs({
      boundaryCrossings: relations.boundaryCrossings,
      groups,
      internalRelations: relations.internalRelations.map((item) => item.relation),
      layers,
      moduleRef: seedResult.seed.ref,
    }),
  };

  return {
    data,
    errors: errors.length > 0 ? errors : undefined,
    refs: createNextRefs({
      boundaryCrossings: relations.boundaryCrossings,
      groups,
      internalRelations: relations.internalRelations.map((item) => item.relation),
      layers,
      moduleRef: seedResult.seed.ref,
    }),
  };
};

function readModuleLayersPayload(payload: unknown): ModuleLayersRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    includeBoundaryCrossings: readBoolean(payload.includeBoundaryCrossings),
  };
}

function createFileGroups(input: {
  files: readonly FileSummary[];
  moduleName: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  modulePath?: string;
  moduleRef: ProjectContextRef;
}): GroupRecord[] {
  const moduleRoot =
    input.modulePath ?? findCommonDirectory(input.files.map((file) => file.filePath));
  const grouped = new Map<string, FileSummary[]>();
  for (const file of input.files) {
    const groupName = readImmediateModuleDirectory(file.filePath, moduleRoot);
    const current = grouped.get(groupName) ?? [];
    current.push(file);
    grouped.set(groupName, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, files]) => {
      const ref = createProjectContextModuleLayerRef({
        layerKind: 'file-group',
        layerName: name,
        moduleName: input.moduleName,
        modulePath: input.modulePath,
        parentRef: input.moduleRef.id,
        projectRoot: input.projectRoot,
        repoId: input.repoId,
        sourceFolder: input.sourceFolder,
      });
      return {
        files: files.sort(compareFiles),
        id: ref.id,
        name,
        ref,
      };
    });
}

function classifyModuleRelations(input: {
  flows: readonly FileFlowFacts[];
  groupByFile: Map<string, GroupRecord>;
  ownedFiles: Set<string>;
  includeBoundaryCrossings: boolean;
}): {
  boundaryCrossings: RelationSummary[];
  cyclic: boolean;
  internalRelations: InternalRelationRecord[];
} {
  const boundaryCrossings: RelationSummary[] = [];
  const internalRelations: InternalRelationRecord[] = [];
  for (const flow of input.flows) {
    const fromGroup = input.groupByFile.get(flow.file.filePath);
    if (!fromGroup) {
      continue;
    }
    for (const relation of flow.context.outflow) {
      if (!isModuleLayerRelation(relation)) {
        continue;
      }
      const targetFile = relation.to?.filePath ?? relation.targetRef?.scope.filePath;
      if (targetFile && input.ownedFiles.has(targetFile)) {
        const toGroup = input.groupByFile.get(targetFile);
        if (toGroup) {
          internalRelations.push({ fromGroup: fromGroup.id, relation, toGroup: toGroup.id });
        }
        continue;
      }
      if (input.includeBoundaryCrossings) {
        boundaryCrossings.push(relation);
      }
    }
  }

  const dedupedInternal = dedupeInternalRelations(internalRelations);
  return {
    boundaryCrossings: dedupeRelations(boundaryCrossings),
    cyclic: hasCycle(dedupedInternal),
    internalRelations: dedupedInternal,
  };
}

function createLocalLayers(input: {
  groups: readonly GroupRecord[];
  internalRelations: readonly InternalRelationRecord[];
  moduleName: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  modulePath?: string;
  moduleRef: ProjectContextRef;
}): LayerSummary[] {
  const depthByGroup = inferGroupDepths(input.groups, input.internalRelations);
  const groupsByDepth = new Map<number, GroupRecord[]>();
  for (const group of input.groups) {
    const depth = depthByGroup.get(group.id) ?? 0;
    const current = groupsByDepth.get(depth) ?? [];
    current.push(group);
    groupsByDepth.set(depth, current);
  }

  return [...groupsByDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, groups]) => {
      const name = depth === 0 ? 'base' : `layer-${depth}`;
      const fileGroups = groups.map((group) => group.name).sort();
      const ref = createProjectContextModuleLayerRef({
        fileGroups,
        layerKind: 'layer',
        layerName: name,
        moduleName: input.moduleName,
        modulePath: input.modulePath,
        order: depth,
        parentRef: input.moduleRef.id,
        projectRoot: input.projectRoot,
        repoId: input.repoId,
        sourceFolder: input.sourceFolder,
      });
      return {
        fileGroups,
        id: ref.id,
        name,
        order: depth,
        ref,
        relationCount: input.internalRelations.filter((relation) =>
          fileGroups.includes(findGroupName(input.groups, relation.fromGroup))
        ).length,
      };
    });
}

function inferGroupDepths(
  groups: readonly GroupRecord[],
  relations: readonly InternalRelationRecord[]
): Map<string, number> {
  const depths = new Map(groups.map((group) => [group.id, 0]));
  for (let index = 0; index < groups.length; index += 1) {
    let changed = false;
    for (const relation of relations) {
      if (relation.fromGroup === relation.toGroup) {
        continue;
      }
      const currentDepth = depths.get(relation.fromGroup) ?? 0;
      const targetDepth = depths.get(relation.toGroup) ?? 0;
      const nextDepth = Math.max(currentDepth, targetDepth + 1);
      if (nextDepth !== currentDepth) {
        depths.set(relation.fromGroup, nextDepth);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return depths;
}

function createNextRefs(input: {
  moduleRef: ProjectContextRef;
  groups: readonly GroupRecord[];
  layers: readonly LayerSummary[];
  internalRelations: readonly RelationSummary[];
  boundaryCrossings: readonly RelationSummary[];
}): ProjectContextRef[] {
  const relationRefs = [...input.internalRelations, ...input.boundaryCrossings].flatMap(
    (relation) => [
      relation.ref,
      relation.sourceRef,
      relation.targetRef,
      relation.from?.ref,
      relation.to?.ref,
    ]
  );
  return dedupeRefs([
    input.moduleRef,
    ...input.groups.map((group) => group.ref),
    ...input.groups.flatMap((group) => group.files.map((file) => file.ref)),
    ...input.layers.map((layer) => layer.ref),
    ...relationRefs,
  ]);
}

function createModuleLayersFailure(
  error: ProjectContextQueryError,
  errors: readonly ProjectContextQueryError[]
): ProjectContextHandlerResult {
  return {
    data: {
      available: false,
      kind: 'module-layers',
      nextRefs: [],
      reason: error.message,
    },
    errors: [...errors, error],
    refs: [],
  };
}

function isModuleLayerRelation(relation: RelationSummary): boolean {
  return relation.kind === 'imports' || relation.kind === 'calls';
}

function readImmediateModuleDirectory(filePath: string, moduleRoot: string): string {
  const relativePath =
    moduleRoot && filePath.startsWith(`${moduleRoot}/`)
      ? filePath.slice(moduleRoot.length + 1)
      : path.posix.basename(filePath);
  const [firstPart] = relativePath.split('/');
  if (!firstPart || firstPart === path.posix.basename(filePath)) {
    return 'root';
  }
  return firstPart;
}

function findCommonDirectory(filePaths: readonly string[]): string {
  const [first, ...rest] = filePaths.map((filePath) => path.posix.dirname(filePath));
  if (!first) {
    return '';
  }
  const parts = first.split('/');
  let end = parts.length;
  for (const directory of rest) {
    const currentParts = directory.split('/');
    let index = 0;
    while (index < end && parts[index] === currentParts[index]) {
      index += 1;
    }
    end = index;
  }
  return parts.slice(0, end).join('/');
}

function createGroupByFile(groups: readonly GroupRecord[]): Map<string, GroupRecord> {
  const result = new Map<string, GroupRecord>();
  for (const group of groups) {
    for (const file of group.files) {
      result.set(file.filePath, group);
    }
  }
  return result;
}

function findGroupName(groups: readonly GroupRecord[], groupId: string): string {
  return groups.find((group) => group.id === groupId)?.name ?? groupId;
}

function hasCycle(relations: readonly InternalRelationRecord[]): boolean {
  const edges = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.fromGroup === relation.toGroup) {
      continue;
    }
    const current = edges.get(relation.fromGroup) ?? new Set<string>();
    current.add(relation.toGroup);
    edges.set(relation.fromGroup, current);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (group: string): boolean => {
    if (visiting.has(group)) {
      return true;
    }
    if (visited.has(group)) {
      return false;
    }
    visiting.add(group);
    for (const next of edges.get(group) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(group);
    visited.add(group);
    return false;
  };
  return [...edges.keys()].some(visit);
}

function dedupeInternalRelations(
  relations: readonly InternalRelationRecord[]
): InternalRelationRecord[] {
  return dedupeBy(
    relations,
    (relation) =>
      `${relation.fromGroup}:${relation.toGroup}:${relation.relation.ref?.id ?? relation.relation.label}`
  ).sort((left, right) => compareRelations(left.relation, right.relation));
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

function compareFiles(left: FileSummary, right: FileSummary): number {
  return left.filePath.localeCompare(right.filePath);
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

function isUnavailableData(value: unknown): value is ProjectContextUnavailableData {
  return isRecord(value) && value.available === false;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

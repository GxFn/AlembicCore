import path from 'node:path';

import type {
  DependencyCycleSummary,
  DependencySummary,
  ExternalDependencySummary,
  FlowSummary,
  HotspotSummary,
  LayerSummary,
  ModuleContext,
  ModuleLayerContext,
  ModuleSummary,
  ProjectContextJson,
  ProjectContextMetadata,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextRefScope,
  ProjectContextUnavailableData,
  ProjectMap,
  RepoSummary,
} from '../../../domain/project-context/index.js';
import type {
  CanonicalProjectContextRequest,
  ProjectContextHandler,
  ProjectContextHandlerResult,
} from '../interface/contracts.js';
import { moduleProjectContextHandler } from '../module/index.js';
import { moduleLayersProjectContextHandler } from '../moduleLayers/index.js';
import {
  createProjectContextModuleDependencyRollups,
  createProjectContextModuleMapModule,
  type ProjectContextModuleDependencyRollup,
  type ProjectContextModuleMapModule,
} from '../shared/module-map/index.js';
import type { MapRequestPayload } from './contracts.js';

export const mapProjectContextHandler: ProjectContextHandler = async (
  request
): Promise<ProjectContextHandlerResult> => {
  const payload = readMapPayload(request.payload);
  const moduleSeedPayloads = readModuleSeedPayloads(request.payload);
  if (moduleSeedPayloads.length === 0) {
    const error = createQueryError({
      code: 'invalid-scope',
      message: 'map payload.moduleSeeds or payload.modules is required.',
      retryable: false,
    });
    return createMapFailure(error, []);
  }

  const resolution = await resolveProjectMapModules(request, moduleSeedPayloads);
  if (resolution.modules.length === 0) {
    const error = createQueryError({
      code: resolution.errors.some((item) => item.code === 'outside-scope')
        ? 'outside-scope'
        : 'not-found',
      message: 'map module seeds could not resolve any modules inside scope.projectRoot.',
      retryable: false,
    });
    return createMapFailure(error, resolution.errors);
  }

  return createProjectMapResult({ payload, request, resolution });
};

async function resolveProjectMapModules(
  request: CanonicalProjectContextRequest,
  moduleSeedPayloads: readonly Record<string, unknown>[]
): Promise<{ errors: ProjectContextQueryError[]; modules: ProjectContextModuleMapModule[] }> {
  const errors: ProjectContextQueryError[] = [];
  const modules: ProjectContextModuleMapModule[] = [];
  for (const moduleSeedPayload of moduleSeedPayloads) {
    const moduleResult = await moduleProjectContextHandler({
      kind: 'module',
      payload: { ...moduleSeedPayload, includeDependencies: true, includePublicSurfaces: false },
      project: request.project,
      scope: request.scope,
    });
    if (moduleResult.errors) {
      errors.push(...moduleResult.errors);
    }
    if (isUnavailableData(moduleResult.data)) {
      continue;
    }

    const layerResult = await moduleLayersProjectContextHandler({
      kind: 'module-layers',
      payload: { ...moduleSeedPayload, includeBoundaryCrossings: true },
      project: request.project,
      scope: request.scope,
    });
    if (layerResult.errors) {
      errors.push(...layerResult.errors);
    }
    modules.push(
      createProjectContextModuleMapModule({
        layerContext: isUnavailableData(layerResult.data)
          ? undefined
          : (layerResult.data as ModuleLayerContext),
        moduleContext: moduleResult.data as ModuleContext,
      })
    );
  }
  return { errors, modules: dedupeModules(modules) };
}

function createProjectMapResult(input: {
  payload: MapRequestPayload;
  request: CanonicalProjectContextRequest;
  resolution: { errors: ProjectContextQueryError[]; modules: ProjectContextModuleMapModule[] };
}): ProjectContextHandlerResult {
  const { payload, request, resolution } = input;
  const resolvedModules = resolution.modules;
  const dependencyRollups = createProjectContextModuleDependencyRollups({
    modules: resolvedModules,
    scope: request.scope,
  });
  const repo = createRepoSummary({
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    repoName: payload.repoName,
    sourceFolder: request.scope.sourceFolder,
  });
  const mapRef = createProjectContextMapRef({
    dependencyEdgeCount: countInternalDependencyEdges(dependencyRollups),
    moduleCount: resolvedModules.length,
    parentRef: repo.ref?.id,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    repoName: repo.name,
    sourceFolder: request.scope.sourceFolder,
  });
  const cycles =
    payload.includeCycles === false ? [] : createCycleSummaries(resolvedModules, dependencyRollups);
  const layers = createGlobalLayers({
    cycles,
    mapRef,
    modules: resolvedModules,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    rollups: dependencyRollups,
    sourceFolder: request.scope.sourceFolder,
  });
  const hotspots =
    payload.includeHotspots === false ? [] : createHotspots(resolvedModules, dependencyRollups);
  const majorFlows = payload.includeMajorFlows === false ? [] : createMajorFlows(dependencyRollups);
  const externalDependencyHotspots =
    payload.includeExternalDeps === false
      ? []
      : createExternalDependencyHotspots(dependencyRollups);
  const errors = [...resolution.errors];
  if (payload.includeExternalDeps !== false) {
    errors.push(...createExternalDependencyWarnings(externalDependencyHotspots));
  }

  const data: ProjectMap = {
    cycles,
    dependencySummary: createDependencySummary(resolvedModules, dependencyRollups),
    externalDependencyHotspots,
    hotspots,
    layers,
    majorFlows,
    modules: resolvedModules.map((moduleRecord) => moduleRecord.module).sort(compareModules),
    nextRefs: createNextRefs({
      cycles,
      externalDependencyHotspots,
      hotspots,
      layers,
      majorFlows,
      modules: resolvedModules,
      rollups: dependencyRollups,
    }),
    repo,
  };

  return {
    data,
    errors: errors.length > 0 ? dedupeErrors(errors) : undefined,
    refs: dedupeRefs([mapRef, repo.ref, ...data.nextRefs]),
  };
}

function readMapPayload(payload: unknown): MapRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    includeCycles: readBoolean(payload.includeCycles),
    includeExternalDeps: readBoolean(payload.includeExternalDeps),
    includeHotspots: readBoolean(payload.includeHotspots),
    includeMajorFlows: readBoolean(payload.includeMajorFlows),
    repoName: readString(payload.repoName),
    ref: readProjectContextRef(payload.ref),
  };
}

function readModuleSeedPayloads(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    return [];
  }
  const seeds = [...readUnknownArray(payload.moduleSeeds), ...readUnknownArray(payload.modules)]
    .map(normalizeModuleSeedPayload)
    .filter((item): item is Record<string, unknown> => item !== undefined);
  return dedupeBy(seeds, (seed) => JSON.stringify(seed)).sort((left, right) =>
    readModuleSeedSortKey(left).localeCompare(readModuleSeedSortKey(right))
  );
}

function normalizeModuleSeedPayload(value: unknown): Record<string, unknown> | undefined {
  if (isProjectContextRef(value)) {
    return { ref: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }

  if (isRecord(value.module)) {
    const moduleRecord = value.module;
    return {
      configLayer: moduleRecord.configLayer,
      kind: moduleRecord.kind,
      moduleName: readString(moduleRecord.name) ?? readString(moduleRecord.moduleName),
      modulePath: readModulePath(moduleRecord),
      ownedFiles: value.ownedFiles,
      ref: readProjectContextRef(moduleRecord.ref),
      role: moduleRecord.role,
    };
  }

  if (readString(value.moduleName) === undefined && readString(value.name) !== undefined) {
    return {
      ...value,
      moduleName: readString(value.name),
    };
  }
  return value;
}

function readModulePath(moduleRecord: Record<string, unknown>): string | undefined {
  const ref = readProjectContextRef(moduleRecord.ref);
  return readString(moduleRecord.modulePath) ?? ref?.scope.filePath;
}

function readModuleSeedSortKey(seed: Record<string, unknown>): string {
  const ref = readProjectContextRef(seed.ref);
  return (
    readString(seed.moduleName) ??
    readString(seed.name) ??
    ref?.label ??
    ref?.id ??
    JSON.stringify(seed)
  );
}

function createRepoSummary(input: {
  projectRoot: string;
  repoId?: string;
  repoName?: string;
  sourceFolder?: string;
}): RepoSummary {
  const id = input.repoId ?? 'root';
  const name = input.repoName ?? input.repoId ?? path.basename(input.projectRoot) ?? 'project';
  return {
    id,
    name,
    ref: createProjectContextRepoRef({ ...input, repoId: id, repoName: name }),
    root: input.sourceFolder ?? '.',
  };
}

function createProjectContextRepoRef(input: {
  projectRoot: string;
  repoId: string;
  repoName: string;
  sourceFolder?: string;
}): ProjectContextRef {
  return {
    id: `repo:${encodeRefPart(input.repoId)}:${encodeRefPart(input.sourceFolder ?? '.')}`,
    kind: 'repo',
    label: input.repoName,
    level: 'repo',
    metadata: {
      source: 'project-context-map-scope',
    },
    scope: createProjectScope(input),
  };
}

function createProjectContextMapRef(input: {
  projectRoot: string;
  repoId?: string;
  repoName: string;
  sourceFolder?: string;
  parentRef?: string;
  moduleCount: number;
  dependencyEdgeCount: number;
}): ProjectContextRef {
  return {
    id: `map:${encodeRefPart(input.repoId ?? 'root')}:${encodeRefPart(input.sourceFolder ?? '.')}`,
    kind: 'map',
    label: `${input.repoName} map`,
    level: 'map',
    metadata: {
      dependencyEdgeCount: input.dependencyEdgeCount,
      moduleCount: input.moduleCount,
    },
    parentRef: input.parentRef,
    scope: createProjectScope(input),
  };
}

function createProjectContextProjectLayerRef(input: {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  layerName: string;
  order: number;
  modules: readonly ModuleSummary[];
  parentRef?: string;
  uncertain?: boolean;
}): ProjectContextRef {
  const metadata: ProjectContextMetadata = {
    layerKind: 'project-layer',
    layerName: input.layerName,
    modules: input.modules.map((module) => module.name).sort(),
    order: input.order,
  };
  if (input.uncertain) {
    metadata.uncertain = true;
  }
  return {
    id: `module-layer:${encodeRefPart(input.repoId ?? 'root')}:project:${encodeRefPart(
      input.layerName
    )}`,
    kind: 'module-layer',
    label: `project/${input.layerName}`,
    level: 'map',
    metadata,
    parentRef: input.parentRef,
    scope: createProjectScope(input),
  };
}

function createGlobalLayers(input: {
  modules: readonly ProjectContextModuleMapModule[];
  rollups: readonly ProjectContextModuleDependencyRollup[];
  cycles: readonly DependencyCycleSummary[];
  mapRef: ProjectContextRef;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}): LayerSummary[] {
  const declaredLayers = groupModulesByDeclaredLayer(input.modules);
  if (declaredLayers.size > 0) {
    return createLayerSummaries({
      groups: declaredLayers,
      mapRef: input.mapRef,
      projectRoot: input.projectRoot,
      repoId: input.repoId,
      rollups: input.rollups,
      sourceFolder: input.sourceFolder,
      uncertain: false,
    });
  }

  const inferredLayers =
    input.cycles.length > 0
      ? new Map([[0, [...input.modules].sort(compareModuleRecords)]])
      : groupModulesByDependencyDepth(input.modules, input.rollups);
  return createLayerSummaries({
    groups: inferredLayers,
    mapRef: input.mapRef,
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    rollups: input.rollups,
    sourceFolder: input.sourceFolder,
    uncertain: input.cycles.length > 0,
  });
}

function groupModulesByDeclaredLayer(
  modules: readonly ProjectContextModuleMapModule[]
): Map<number, ProjectContextModuleMapModule[]> {
  if (modules.some((moduleRecord) => !moduleRecord.module.configLayer)) {
    return new Map();
  }
  const names = [...new Set(modules.map((moduleRecord) => moduleRecord.module.configLayer ?? ''))]
    .filter(Boolean)
    .sort();
  const orderByName = new Map(names.map((name, index) => [name, index]));
  const groups = new Map<number, ProjectContextModuleMapModule[]>();
  for (const moduleRecord of modules) {
    const order = orderByName.get(moduleRecord.module.configLayer ?? '') ?? 0;
    const current = groups.get(order) ?? [];
    current.push(moduleRecord);
    groups.set(order, current);
  }
  return groups;
}

function groupModulesByDependencyDepth(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): Map<number, ProjectContextModuleMapModule[]> {
  const depthByModule = new Map(modules.map((moduleRecord) => [moduleRecord.module.id, 0]));
  const internalRollups = rollups.filter((rollup) => rollup.to !== undefined);
  for (let index = 0; index < modules.length; index += 1) {
    let changed = false;
    for (const rollup of internalRollups) {
      if (!rollup.to || rollup.from.id === rollup.to.id) {
        continue;
      }
      const currentDepth = depthByModule.get(rollup.from.id) ?? 0;
      const targetDepth = depthByModule.get(rollup.to.id) ?? 0;
      const nextDepth = Math.max(currentDepth, targetDepth + 1);
      if (nextDepth !== currentDepth) {
        depthByModule.set(rollup.from.id, nextDepth);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const groups = new Map<number, ProjectContextModuleMapModule[]>();
  for (const moduleRecord of modules) {
    const depth = depthByModule.get(moduleRecord.module.id) ?? 0;
    const current = groups.get(depth) ?? [];
    current.push(moduleRecord);
    groups.set(depth, current);
  }
  return groups;
}

function createLayerSummaries(input: {
  groups: Map<number, ProjectContextModuleMapModule[]>;
  rollups: readonly ProjectContextModuleDependencyRollup[];
  mapRef: ProjectContextRef;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  uncertain: boolean;
}): LayerSummary[] {
  return [...input.groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([order, moduleRecords]) => {
      const name = order === 0 ? 'base' : `layer-${order}`;
      const modules = moduleRecords.map((moduleRecord) => moduleRecord.module).sort(compareModules);
      const ref = createProjectContextProjectLayerRef({
        layerName: name,
        modules,
        order,
        parentRef: input.mapRef.id,
        projectRoot: input.projectRoot,
        repoId: input.repoId,
        sourceFolder: input.sourceFolder,
        uncertain: input.uncertain,
      });
      const moduleIds = new Set(modules.map((module) => module.id));
      return {
        fileGroups: modules.map((module) => module.name),
        id: ref.id,
        name,
        order,
        ref,
        relationCount: input.rollups
          .filter((rollup) => moduleIds.has(rollup.from.id))
          .reduce((sum, rollup) => sum + rollup.relationCount, 0),
        uncertain: input.uncertain || undefined,
      };
    });
}

function createDependencySummary(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): DependencySummary {
  const internalEdges = countInternalDependencyEdges(rollups);
  const externalEdges = rollups.filter((rollup) => rollup.to === undefined).length;
  const relationKinds = [...new Set(rollups.map((rollup) => rollup.relationKind))].sort();
  return {
    edgeCount: internalEdges,
    notes: [
      `modules:${modules.length}`,
      `internal-edges:${internalEdges}`,
      `external-dependencies:${externalEdges}`,
      relationKinds.length > 0
        ? `relation-kinds:${relationKinds.join(',')}`
        : 'relation-kinds:none',
    ],
  };
}

function createCycleSummaries(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): DependencyCycleSummary[] {
  return detectCycleComponents(modules, rollups).map((cycleModules) => {
    const moduleNames = cycleModules.map((moduleRecord) => moduleRecord.module.name);
    const moduleIds = new Set(cycleModules.map((moduleRecord) => moduleRecord.module.id));
    const relationRefs = rollups
      .filter((rollup) => rollup.to && moduleIds.has(rollup.from.id) && moduleIds.has(rollup.to.id))
      .flatMap((rollup) => rollup.refs);
    return {
      refs: dedupeRefs([
        ...cycleModules.map((moduleRecord) => moduleRecord.module.ref),
        ...relationRefs,
      ]),
      summary: `${moduleNames.join(' -> ')} -> ${moduleNames[0]}`,
    };
  });
}

function detectCycleComponents(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): ProjectContextModuleMapModule[][] {
  const byId = new Map(modules.map((moduleRecord) => [moduleRecord.module.id, moduleRecord]));
  const adjacency = new Map<string, Set<string>>();
  for (const moduleRecord of modules) {
    adjacency.set(moduleRecord.module.id, new Set());
  }
  for (const rollup of rollups) {
    if (rollup.to) {
      adjacency.get(rollup.from.id)?.add(rollup.to.id);
    }
  }

  let index = 0;
  const stack: string[] = [];
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (moduleId: string): void => {
    indices.set(moduleId, index);
    lowlinks.set(moduleId, index);
    index += 1;
    stack.push(moduleId);
    onStack.add(moduleId);

    for (const targetId of adjacency.get(moduleId) ?? []) {
      if (!indices.has(targetId)) {
        visit(targetId);
        lowlinks.set(moduleId, Math.min(lowlinks.get(moduleId) ?? 0, lowlinks.get(targetId) ?? 0));
      } else if (onStack.has(targetId)) {
        lowlinks.set(moduleId, Math.min(lowlinks.get(moduleId) ?? 0, indices.get(targetId) ?? 0));
      }
    }

    if (lowlinks.get(moduleId) === indices.get(moduleId)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (current) {
          onStack.delete(current);
          component.push(current);
        }
      } while (current && current !== moduleId);
      components.push(component);
    }
  };

  for (const moduleRecord of modules) {
    if (!indices.has(moduleRecord.module.id)) {
      visit(moduleRecord.module.id);
    }
  }

  return components
    .filter(
      (component) =>
        component.length > 1 || component.some((moduleId) => adjacency.get(moduleId)?.has(moduleId))
    )
    .map((component) =>
      component
        .map((moduleId) => byId.get(moduleId))
        .filter((moduleRecord): moduleRecord is ProjectContextModuleMapModule =>
          Boolean(moduleRecord)
        )
        .sort(compareModuleRecords)
    )
    .sort((left, right) => left[0].module.name.localeCompare(right[0].module.name));
}

function createHotspots(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): HotspotSummary[] {
  const stats = createDegreeStats(modules, rollups);
  return modules
    .map((moduleRecord) => {
      const stat = stats.get(moduleRecord.module.id) ?? {
        externalFanOut: 0,
        fanIn: 0,
        fanOut: 0,
        relationCount: 0,
      };
      const score = stat.fanIn * 2 + stat.fanOut + stat.relationCount + stat.externalFanOut;
      if (score === 0 || !moduleRecord.module.ref) {
        return undefined;
      }
      return {
        reason: `fan-in:${stat.fanIn} fan-out:${stat.fanOut} relations:${stat.relationCount} external:${stat.externalFanOut}`,
        ref: moduleRecord.module.ref,
        score,
      };
    })
    .filter((hotspot): hotspot is HotspotSummary => hotspot !== undefined)
    .sort((left, right) => right.score - left.score || left.ref.id.localeCompare(right.ref.id));
}

function createDegreeStats(
  modules: readonly ProjectContextModuleMapModule[],
  rollups: readonly ProjectContextModuleDependencyRollup[]
): Map<string, { fanIn: number; fanOut: number; relationCount: number; externalFanOut: number }> {
  const stats = new Map(
    modules.map((moduleRecord) => [
      moduleRecord.module.id,
      { externalFanOut: 0, fanIn: 0, fanOut: 0, relationCount: 0 },
    ])
  );
  for (const rollup of rollups) {
    const source = stats.get(rollup.from.id);
    if (source) {
      source.fanOut += rollup.to ? 1 : 0;
      source.externalFanOut += rollup.to ? 0 : 1;
      source.relationCount += rollup.relationCount;
    }
    if (rollup.to) {
      const target = stats.get(rollup.to.id);
      if (target) {
        target.fanIn += 1;
        target.relationCount += rollup.relationCount;
      }
    }
  }
  return stats;
}

function createMajorFlows(rollups: readonly ProjectContextModuleDependencyRollup[]): FlowSummary[] {
  return rollups
    .filter((rollup) => rollup.to !== undefined)
    .map((rollup) => ({
      refs: rollup.refs,
      summary: `${rollup.from.name} -> ${rollup.to?.name} via ${rollup.relationKind} (${rollup.relationCount} relation${rollup.relationCount === 1 ? '' : 's'})`,
    }))
    .sort(
      (left, right) =>
        right.refs.length - left.refs.length || left.summary.localeCompare(right.summary)
    );
}

function createExternalDependencyHotspots(
  rollups: readonly ProjectContextModuleDependencyRollup[]
): ExternalDependencySummary[] {
  return rollups
    .filter((rollup) => rollup.to === undefined && rollup.externalName)
    .map((rollup) => ({
      category: rollup.reason === 'external-or-package' ? 'package' : 'unmatched',
      name: rollup.externalName ?? 'external',
      refs: rollup.refs,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createExternalDependencyWarnings(
  externalDependencies: readonly ExternalDependencySummary[]
): ProjectContextQueryError[] {
  return externalDependencies.map((dependency) =>
    createQueryError({
      code: 'query-unavailable',
      message: `map external dependency is not owned by module seeds: ${dependency.name}`,
      retryable: false,
    })
  );
}

function createNextRefs(input: {
  modules: readonly ProjectContextModuleMapModule[];
  layers: readonly LayerSummary[];
  rollups: readonly ProjectContextModuleDependencyRollup[];
  cycles: readonly DependencyCycleSummary[];
  hotspots: readonly HotspotSummary[];
  majorFlows: readonly FlowSummary[];
  externalDependencyHotspots: readonly ExternalDependencySummary[];
}): ProjectContextRef[] {
  return dedupeRefs([
    ...input.modules.flatMap((moduleRecord) => [
      moduleRecord.module.ref,
      ...moduleRecord.layers.map((layer) => layer.ref),
      ...moduleRecord.nextRefs,
    ]),
    ...input.layers.map((layer) => layer.ref),
    ...input.rollups.flatMap((rollup) => rollup.refs),
    ...input.cycles.flatMap((cycle) => cycle.refs),
    ...input.hotspots.map((hotspot) => hotspot.ref),
    ...input.majorFlows.flatMap((flow) => flow.refs),
    ...input.externalDependencyHotspots.flatMap((dependency) => dependency.refs),
  ]);
}

function createMapFailure(
  error: ProjectContextQueryError,
  errors: readonly ProjectContextQueryError[]
): ProjectContextHandlerResult {
  return {
    data: {
      available: false,
      kind: 'map',
      nextRefs: [],
      reason: error.message,
    },
    errors: [...errors, error],
    refs: [],
  };
}

function createQueryError(input: {
  code: ProjectContextQueryError['code'];
  message: string;
  path?: string;
  retryable: boolean;
}): ProjectContextQueryError {
  return {
    code: input.code,
    message: input.message,
    path: input.path,
    retryable: input.retryable,
    severity: input.code === 'query-unavailable' ? 'warning' : 'error',
  };
}

function countInternalDependencyEdges(
  rollups: readonly ProjectContextModuleDependencyRollup[]
): number {
  return rollups.filter((rollup) => rollup.to !== undefined).length;
}

function dedupeModules(
  modules: readonly ProjectContextModuleMapModule[]
): ProjectContextModuleMapModule[] {
  return dedupeBy(modules, (moduleRecord) => moduleRecord.module.id).sort(compareModuleRecords);
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

function dedupeErrors(errors: readonly ProjectContextQueryError[]): ProjectContextQueryError[] {
  return dedupeBy(errors, (error) => `${error.code}:${error.path ?? ''}:${error.message}`).sort(
    (left, right) => left.message.localeCompare(right.message)
  );
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

function compareModuleRecords(
  left: ProjectContextModuleMapModule,
  right: ProjectContextModuleMapModule
): number {
  return compareModules(left.module, right.module);
}

function compareModules(left: ModuleSummary, right: ModuleSummary): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function createProjectScope(input: {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}): ProjectContextRefScope {
  return {
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readProjectContextRef(value: unknown): ProjectContextRef | undefined {
  return isProjectContextRef(value) ? value : undefined;
}

function isProjectContextRef(value: unknown): value is ProjectContextRef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.scope)
  );
}

function isUnavailableData(value: unknown): value is ProjectContextUnavailableData {
  return isRecord(value) && value.available === false;
}

function isRecord(value: unknown): value is Record<string, ProjectContextJson | unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

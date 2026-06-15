import type {
  ProjectContextEnvelope,
  ProjectContextQueryError,
  ProjectContextRequestKind,
} from './ProjectContextContracts.js';
import type {
  AnchorRangeContext,
  FileFlowContext,
  FileSymbolContext,
  ModuleContext,
  ModuleLayerContext,
  ProjectContextResult,
  ProjectContextUnavailableData,
  ProjectMap,
  RepoContext,
  SourceSliceContext,
  SpaceContext,
} from './ProjectContextMap.js';
import type {
  FileSummary,
  ProjectContextProject,
  ProjectContextRef,
} from './ProjectContextRefs.js';

export interface ProjectContextPresenterInput {
  project: ProjectContextProject;
  envelopes: ProjectContextEnvelope<ProjectContextResult>[];
  refs: ProjectContextRef[];
  files: FileSummary[];
  warnings: ProjectContextPresenterWarning[];
  unavailable: ProjectContextPresenterUnavailable[];
  space?: SpaceContext;
  repo?: RepoContext;
  map?: ProjectMap;
  modules: ModuleContext[];
  moduleLayers: ModuleLayerContext[];
  fileFlows: FileFlowContext[];
  fileSymbols: FileSymbolContext[];
  sourceSlices: SourceSliceContext[];
  anchorRanges: AnchorRangeContext[];
}

export interface ProjectContextPresenterWarning {
  queryLevel: ProjectContextRequestKind;
  code: ProjectContextQueryError['code'];
  message: string;
  severity: ProjectContextQueryError['severity'];
  retryable: boolean;
  ref?: ProjectContextRef;
  path?: string;
}

export interface ProjectContextPresenterUnavailable {
  queryLevel: ProjectContextRequestKind;
  kind: string;
  reason: string;
  nextRefs: ProjectContextRef[];
}

export function buildProjectContextPresenterInput(
  envelopes: readonly ProjectContextEnvelope<ProjectContextResult>[]
): ProjectContextPresenterInput {
  const project = envelopes[0]?.project ?? { projectRoot: '' };
  const input: ProjectContextPresenterInput = {
    project,
    envelopes: envelopes.map(cloneEnvelope),
    refs: dedupeRefs(envelopes.flatMap((envelope) => envelope.refs)),
    files: [],
    warnings: collectWarnings(envelopes),
    unavailable: [],
    modules: [],
    moduleLayers: [],
    fileFlows: [],
    fileSymbols: [],
    sourceSlices: [],
    anchorRanges: [],
  };

  for (const envelope of envelopes) {
    const data = envelope.data;
    if (isUnavailable(data)) {
      input.unavailable.push({
        queryLevel: envelope.queryLevel,
        kind: data.kind,
        reason: data.reason,
        nextRefs: [...data.nextRefs],
      });
      continue;
    }

    switch (envelope.queryLevel) {
      case 'space':
        if (isSpaceContext(data)) {
          input.space = data;
          input.refs = dedupeRefs([...input.refs, ...data.nextRefs]);
        }
        break;
      case 'repo':
        if (isRepoContext(data)) {
          input.repo = data;
          input.refs = dedupeRefs([...input.refs, ...collectRepoRefs(data)]);
        }
        break;
      case 'map':
        if (isProjectMap(data)) {
          input.map = data;
          input.refs = dedupeRefs([...input.refs, ...collectMapRefs(data)]);
        }
        break;
      case 'module':
        if (isModuleContext(data)) {
          input.modules.push(data);
          input.files = dedupeFiles([...input.files, ...data.ownedFiles]);
          input.refs = dedupeRefs([...input.refs, ...collectModuleRefs(data)]);
        }
        break;
      case 'module-layers':
        if (isModuleLayerContext(data)) {
          input.moduleLayers.push(data);
          input.files = dedupeFiles([
            ...input.files,
            ...data.fileGroups.flatMap((group) => group.files),
          ]);
          input.refs = dedupeRefs([...input.refs, ...collectModuleLayerRefs(data)]);
        }
        break;
      case 'file-flow':
        if (isFileFlowContext(data)) {
          input.fileFlows.push(data);
          input.files = dedupeFiles([...input.files, data.file]);
          input.refs = dedupeRefs([...input.refs, ...collectFileFlowRefs(data)]);
        }
        break;
      case 'file-symbols':
        if (isFileSymbolContext(data)) {
          input.fileSymbols.push(data);
          input.files = dedupeFiles([...input.files, data.file]);
          input.refs = dedupeRefs([...input.refs, ...collectFileSymbolRefs(data)]);
        }
        break;
      case 'source-slice':
        if (isSourceSliceContext(data)) {
          input.sourceSlices.push(data);
          input.files = dedupeFiles([...input.files, data.file]);
          input.refs = dedupeRefs([...input.refs, ...data.nextRefs, data.file.ref]);
        }
        break;
      case 'anchor-range':
        if (isAnchorRangeContext(data)) {
          input.anchorRanges.push(data);
          input.files = dedupeFiles([...input.files, data.file]);
          input.refs = dedupeRefs([...input.refs, ...collectAnchorRangeRefs(data)]);
        }
        break;
    }
  }

  return {
    ...input,
    refs: dedupeRefs(input.refs),
    files: dedupeFiles(input.files),
    unavailable: dedupeUnavailable(input.unavailable),
  };
}

function cloneEnvelope(
  envelope: ProjectContextEnvelope<ProjectContextResult>
): ProjectContextEnvelope<ProjectContextResult> {
  return {
    ...envelope,
    refs: [...envelope.refs],
    ...(envelope.errors ? { errors: [...envelope.errors] } : {}),
  };
}

function collectWarnings(
  envelopes: readonly ProjectContextEnvelope<ProjectContextResult>[]
): ProjectContextPresenterWarning[] {
  return envelopes.flatMap((envelope) =>
    (envelope.errors ?? []).map((error) => ({
      queryLevel: envelope.queryLevel,
      code: error.code,
      message: error.message,
      severity: error.severity,
      retryable: error.retryable,
      ...(error.ref ? { ref: error.ref } : {}),
      ...(error.path ? { path: error.path } : {}),
    }))
  );
}

function collectRepoRefs(repo: RepoContext): ProjectContextRef[] {
  return dedupeRefs([
    repo.repo.ref,
    repo.mapRef,
    ...repo.nextRefs,
    ...repo.buildSystems.flatMap((system) => system.configRefs),
    ...repo.packageSystems.flatMap((system) => system.manifestRefs),
    ...repo.targets.flatMap((target) => target.refs),
    ...repo.entrypoints.flatMap((entrypoint) => entrypoint.refs),
    ...repo.configFiles.flatMap((file) => (file.ref ? [file.ref] : [])),
    ...repo.localPackages.flatMap((pkg) => (pkg.ref ? [pkg.ref] : [])),
    ...repo.sourceRoots.flatMap((path) => (path.ref ? [path.ref] : [])),
    ...repo.topAreas.flatMap((path) => (path.ref ? [path.ref] : [])),
  ]);
}

function collectMapRefs(map: ProjectMap): ProjectContextRef[] {
  return dedupeRefs([
    map.repo.ref,
    ...map.nextRefs,
    ...map.modules.flatMap((module) => (module.ref ? [module.ref] : [])),
    ...map.layers.flatMap((layer) => (layer.ref ? [layer.ref] : [])),
    ...map.cycles.flatMap((cycle) => cycle.refs),
    ...map.hotspots.map((hotspot) => hotspot.ref),
    ...map.majorFlows.flatMap((flow) => flow.refs),
    ...map.externalDependencyHotspots.flatMap((dependency) => dependency.refs),
  ]);
}

function collectModuleRefs(moduleContext: ModuleContext): ProjectContextRef[] {
  return dedupeRefs([
    moduleContext.module.ref,
    ...moduleContext.nextRefs,
    ...moduleContext.ownedFiles.flatMap((file) => (file.ref ? [file.ref] : [])),
    ...moduleContext.publicSurfaces.flatMap((symbol) => (symbol.ref ? [symbol.ref] : [])),
    ...moduleContext.inflow.flatMap(collectRelationRefs),
    ...moduleContext.outflow.flatMap(collectRelationRefs),
  ]);
}

function collectModuleLayerRefs(layerContext: ModuleLayerContext): ProjectContextRef[] {
  return dedupeRefs([
    layerContext.module.ref,
    ...layerContext.nextRefs,
    ...layerContext.layers.flatMap((layer) => (layer.ref ? [layer.ref] : [])),
    ...layerContext.fileGroups.flatMap((group) => [
      ...(group.ref ? [group.ref] : []),
      ...group.files.flatMap((file) => (file.ref ? [file.ref] : [])),
    ]),
    ...layerContext.boundaryCrossings.flatMap(collectRelationRefs),
  ]);
}

function collectFileFlowRefs(flow: FileFlowContext): ProjectContextRef[] {
  return dedupeRefs([
    flow.file.ref,
    ...flow.nextRefs,
    ...flow.imports.flatMap(collectRelationRefs),
    ...flow.exports.flatMap((symbol) => (symbol.ref ? [symbol.ref] : [])),
    ...flow.callers.flatMap(collectRelationRefs),
    ...flow.callees.flatMap(collectRelationRefs),
    ...flow.inflow.flatMap(collectRelationRefs),
    ...flow.outflow.flatMap(collectRelationRefs),
  ]);
}

function collectFileSymbolRefs(symbols: FileSymbolContext): ProjectContextRef[] {
  return dedupeRefs([
    symbols.file.ref,
    ...symbols.nextRefs,
    ...symbols.symbols.flatMap((symbol) => (symbol.ref ? [symbol.ref] : [])),
  ]);
}

function collectAnchorRangeRefs(anchorRange: AnchorRangeContext): ProjectContextRef[] {
  return dedupeRefs([
    anchorRange.file.ref,
    anchorRange.anchor.ref,
    ...anchorRange.sourceSlices,
    ...anchorRange.symbols.flatMap((symbol) => (symbol.ref ? [symbol.ref] : [])),
    ...anchorRange.relationSites.flatMap(collectRelationRefs),
    ...anchorRange.relatedRefs,
    ...anchorRange.containingRefs,
    ...anchorRange.nextRefs,
  ]);
}

function collectRelationRefs(relation: {
  ref?: ProjectContextRef;
  fromRef?: ProjectContextRef;
  toRef?: ProjectContextRef;
  sourceRef?: ProjectContextRef;
  targetRef?: ProjectContextRef;
}): ProjectContextRef[] {
  return [
    relation.ref,
    relation.fromRef,
    relation.toRef,
    relation.sourceRef,
    relation.targetRef,
  ].filter((ref): ref is ProjectContextRef => Boolean(ref));
}

function dedupeRefs(refs: readonly (ProjectContextRef | undefined)[]): ProjectContextRef[] {
  const seen = new Map<string, ProjectContextRef>();
  for (const ref of refs) {
    if (!ref) {
      continue;
    }
    const key = ref.id || `${ref.kind}:${ref.scope.filePath ?? ref.scope.sourceFolder ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, ref);
    }
  }
  return [...seen.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function dedupeFiles(files: readonly (FileSummary | undefined)[]): FileSummary[] {
  const seen = new Map<string, FileSummary>();
  for (const file of files) {
    if (!file) {
      continue;
    }
    const key = `${file.repoId ?? ''}:${file.filePath}`;
    if (!seen.has(key)) {
      seen.set(key, file);
    }
  }
  return [...seen.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function dedupeUnavailable(
  unavailable: readonly ProjectContextPresenterUnavailable[]
): ProjectContextPresenterUnavailable[] {
  const seen = new Map<string, ProjectContextPresenterUnavailable>();
  for (const item of unavailable) {
    const key = `${item.queryLevel}:${item.kind}:${item.reason}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()].sort((left, right) => left.queryLevel.localeCompare(right.queryLevel));
}

function isUnavailable(data: ProjectContextResult): data is ProjectContextUnavailableData {
  return 'available' in data && data.available === false;
}

function isSpaceContext(data: ProjectContextResult): data is SpaceContext {
  return 'space' in data && 'repos' in data;
}

function isRepoContext(data: ProjectContextResult): data is RepoContext {
  return 'repo' in data && 'languages' in data && 'entrypoints' in data;
}

function isProjectMap(data: ProjectContextResult): data is ProjectMap {
  return 'modules' in data && 'dependencySummary' in data && 'majorFlows' in data;
}

function isModuleContext(data: ProjectContextResult): data is ModuleContext {
  return 'module' in data && 'ownedFiles' in data && 'publicSurfaces' in data;
}

function isModuleLayerContext(data: ProjectContextResult): data is ModuleLayerContext {
  return 'module' in data && 'layers' in data && 'fileGroups' in data;
}

function isFileFlowContext(data: ProjectContextResult): data is FileFlowContext {
  return 'file' in data && 'imports' in data && 'callers' in data && 'callees' in data;
}

function isFileSymbolContext(data: ProjectContextResult): data is FileSymbolContext {
  return 'file' in data && 'symbols' in data && 'naming' in data;
}

function isSourceSliceContext(data: ProjectContextResult): data is SourceSliceContext {
  return 'file' in data && 'range' in data && !('anchor' in data);
}

function isAnchorRangeContext(data: ProjectContextResult): data is AnchorRangeContext {
  return 'anchor' in data && 'radius' in data && 'range' in data;
}

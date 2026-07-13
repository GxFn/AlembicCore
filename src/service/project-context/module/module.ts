import type {
  FileFlowContext,
  FileSymbolContext,
  ModuleContext,
  ModuleLayerContext,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
  RelationSummary,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import { fileFlowProjectContextHandler } from '../fileFlow/index.js';
import { fileSymbolsProjectContextHandler } from '../fileSymbols/index.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { moduleLayersProjectContextHandler } from '../moduleLayers/index.js';
import { resolveProjectContextModuleSeed } from '../shared/moduleLayers-module/index.js';
import type { ModuleRequestPayload } from './contracts.js';

export const moduleProjectContextHandler: ProjectContextHandler = async (
  request,
  context
): Promise<ProjectContextHandlerResult> => {
  throwIfProjectContextAborted(context);
  const payload = readModulePayload(request.payload);
  const seedResult = await resolveProjectContextModuleSeed({
    payload: request.payload,
    scope: request.scope,
    signal: context?.signal,
  });
  throwIfProjectContextAborted(context);
  if (!seedResult.ok) {
    return createModuleFailure(seedResult.error, seedResult.errors);
  }

  const errors = [...seedResult.errors];
  const moduleLayersResult = await moduleLayersProjectContextHandler(
    {
      kind: 'module-layers',
      payload: {
        ...copyRecordPayload(request.payload),
        includeBoundaryCrossings: payload.includeDependencies !== false,
      },
      project: request.project,
      scope: request.scope,
    },
    context
  );
  if (moduleLayersResult.errors) {
    errors.push(...moduleLayersResult.errors);
  }
  const layerContext = isUnavailableData(moduleLayersResult.data)
    ? undefined
    : (moduleLayersResult.data as ModuleLayerContext);

  const fileSymbols: FileSymbolContext[] = [];
  const fileFlows: FileFlowContext[] = [];
  for (const file of seedResult.seed.ownedFiles) {
    throwIfProjectContextAborted(context);
    const symbolsResult = await fileSymbolsProjectContextHandler(
      {
        kind: 'file-symbols',
        payload: { filePath: file.filePath },
        project: request.project,
        scope: request.scope,
      },
      context
    );
    if (symbolsResult.errors) {
      errors.push(...symbolsResult.errors);
    }
    if (!isUnavailableData(symbolsResult.data)) {
      fileSymbols.push(symbolsResult.data as FileSymbolContext);
    }

    const flowResult = await fileFlowProjectContextHandler(
      {
        kind: 'file-flow',
        payload: { filePath: file.filePath },
        project: request.project,
        scope: request.scope,
      },
      context
    );
    if (flowResult.errors) {
      errors.push(...flowResult.errors);
    }
    if (!isUnavailableData(flowResult.data)) {
      fileFlows.push(flowResult.data as FileFlowContext);
    }
  }

  const publicSurfaces =
    payload.includePublicSurfaces === false ? [] : createPublicSurfaces({ fileFlows, fileSymbols });
  const outflow =
    payload.includeDependencies === false
      ? []
      : dedupeRelations(layerContext?.boundaryCrossings ?? []);
  const data: ModuleContext = {
    inflow: [],
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
      layerContext,
      moduleRef: seedResult.seed.ref,
      outflow,
      publicSurfaces,
    }),
    outflow,
    ownedFiles: seedResult.seed.ownedFiles,
    publicSurfaces,
  };

  return {
    data,
    errors: errors.length > 0 ? dedupeErrors(errors) : undefined,
    refs: createNextRefs({
      layerContext,
      moduleRef: seedResult.seed.ref,
      outflow,
      publicSurfaces,
    }),
  };
};

function readModulePayload(payload: unknown): ModuleRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    includeDependencies: readBoolean(payload.includeDependencies),
    includeHotspots: readBoolean(payload.includeHotspots),
    includePublicSurfaces: readBoolean(payload.includePublicSurfaces),
  };
}

function createPublicSurfaces(input: {
  fileSymbols: readonly FileSymbolContext[];
  fileFlows: readonly FileFlowContext[];
}): SymbolSummary[] {
  const exportedRefIds = new Set<string>();
  const exportedNamesByFile = new Map<string, Set<string>>();
  for (const flow of input.fileFlows) {
    const exportedNames = exportedNamesByFile.get(flow.file.filePath) ?? new Set<string>();
    for (const relation of flow.outflow.filter((item) => item.kind === 'exports')) {
      if (relation.from?.ref?.id) {
        exportedRefIds.add(relation.from.ref.id);
      }
      for (const name of [
        relation.from?.symbol,
        relation.from?.qualifiedName,
        relation.from?.label,
      ]) {
        if (name) {
          exportedNames.add(name);
        }
      }
    }
    exportedNamesByFile.set(flow.file.filePath, exportedNames);
  }

  const matchedSymbols = input.fileSymbols.flatMap((context) =>
    context.symbols.filter((symbol) => {
      const exportedNames = exportedNamesByFile.get(symbol.filePath);
      return (
        (symbol.ref?.id !== undefined && exportedRefIds.has(symbol.ref.id)) ||
        exportedNames?.has(symbol.name) ||
        exportedNames?.has(symbol.qualifiedName ?? '')
      );
    })
  );
  return dedupeSymbols(matchedSymbols);
}

function createNextRefs(input: {
  moduleRef: ProjectContextRef;
  layerContext?: ModuleLayerContext;
  publicSurfaces: readonly SymbolSummary[];
  outflow: readonly RelationSummary[];
}): ProjectContextRef[] {
  const relationRefs = input.outflow.flatMap((relation) => [
    relation.ref,
    relation.sourceRef,
    relation.targetRef,
    relation.from?.ref,
    relation.to?.ref,
  ]);
  return dedupeRefs([
    input.moduleRef,
    ...(input.layerContext?.nextRefs ?? []),
    ...input.publicSurfaces.flatMap((symbol) => [symbol.ref]),
    ...relationRefs,
  ]);
}

function createModuleFailure(
  error: ProjectContextQueryError,
  errors: readonly ProjectContextQueryError[]
): ProjectContextHandlerResult {
  return {
    data: {
      available: false,
      kind: 'module',
      nextRefs: [],
      reason: error.message,
    },
    errors: [...errors, error],
    refs: [],
  };
}

function copyRecordPayload(payload: unknown): Record<string, unknown> {
  return isRecord(payload) ? { ...payload } : {};
}

function dedupeSymbols(symbols: readonly SymbolSummary[]): SymbolSummary[] {
  return dedupeBy(
    symbols,
    (symbol) => symbol.ref?.id ?? `${symbol.filePath}:${symbol.qualifiedName ?? symbol.name}`
  ).sort(compareSymbols);
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

function compareSymbols(left: SymbolSummary, right: SymbolSummary): number {
  return (
    compareRanges(left.range, right.range) ||
    left.filePath.localeCompare(right.filePath) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
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

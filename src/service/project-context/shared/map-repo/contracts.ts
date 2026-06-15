import type {
  ProjectContextRef,
  ProjectMap,
  ProjectMapSummary,
} from '../../../../domain/project-context/index.js';

export type ProjectContextMapRepoSummary = ProjectMapSummary;

export function createProjectContextMapRepoSummary(input: {
  map: ProjectMap;
  mapRef?: ProjectContextRef;
  refs?: readonly ProjectContextRef[];
}): ProjectContextMapRepoSummary {
  const mapRef = input.mapRef ?? selectProjectContextMapRef(input.refs ?? []);
  return {
    cycleCount: input.map.cycles.length,
    dependencyEdgeCount: input.map.dependencySummary.edgeCount,
    hotspotCount: input.map.hotspots.length,
    layerCount: input.map.layers.length,
    mapRef,
    moduleCount: input.map.modules.length,
    nextRefs: dedupeRefs([mapRef]),
  };
}

export function selectProjectContextMapRef(
  refs: readonly ProjectContextRef[]
): ProjectContextRef | undefined {
  return refs.find((ref) => ref.kind === 'map');
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

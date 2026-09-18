import type {
  ProjectContextRef,
  ProjectMap,
  ProjectMapSummary,
} from '../../../../domain/project-context/index.js';
import { dedupeProjectContextRefs as dedupeRefs } from '../refs.js';

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

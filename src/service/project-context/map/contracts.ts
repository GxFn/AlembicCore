import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export type {
  DependencyCycleSummary,
  DependencySummary,
  ExternalDependencySummary,
  FlowSummary,
  HotspotSummary,
  ProjectMap,
} from '../../../domain/project-context/index.js';

export interface MapRequestPayload {
  modules?: readonly unknown[];
  moduleSeeds?: readonly unknown[];
  repoName?: string;
  ref?: ProjectContextRef;
  includeCycles?: boolean;
  includeHotspots?: boolean;
  includeMajorFlows?: boolean;
  includeExternalDeps?: boolean;
}

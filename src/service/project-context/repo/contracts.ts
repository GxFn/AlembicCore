export type {
  BuildSystemSummary,
  CommandSummary,
  ConfigFileSummary,
  EntrypointSummary,
  LanguageSummary,
  PackageSummary,
  PackageSystemSummary,
  RepoContext,
  RepoDependencyGraphEdge,
  RepoDependencyGraphNode,
  RepoDependencyGraphSummary,
  RepoSummary,
  TargetSummary,
} from '../../../domain/project-context/index.js';

import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export interface RepoRequestPayload {
  ref?: ProjectContextRef;
  repoId?: string;
  repoName?: string;
  repoRoot?: string;
  modules?: readonly unknown[];
  moduleSeeds?: readonly unknown[];
  includeCommands?: boolean;
  includeEntrypoints?: boolean;
  includeTopAreas?: boolean;
  includeMapSummary?: boolean;
  maxFiles?: number;
}

export type { ProjectContextMapRepoSummary } from '../shared/map-repo/index.js';

export type {
  ProjectSpaceSummary,
  ProjectTreeSummary,
  RepoBoundarySummary,
  SourceFolderSummary,
  SpaceContext,
} from '../../../domain/project-context/index.js';

import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export interface SpaceRequestPayload {
  activeFile?: string;
  currentFolderId?: string;
  displayName?: string;
  includeProjectTree?: boolean;
  includeStructuralHotspots?: boolean;
  maxTreeEntries?: number;
  projectId?: string;
  ref?: ProjectContextRef;
  sourceFolders?: readonly unknown[];
  sourceRefs?: readonly string[];
}

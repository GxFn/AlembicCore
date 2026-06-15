import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export type { ModuleContext, ModuleSummary } from '../../../domain/project-context/index.js';

export interface ModuleRequestPayload {
  moduleName?: string;
  modulePath?: string;
  ownedFiles?: readonly (string | ProjectContextRef)[];
  ref?: ProjectContextRef;
  includePublicSurfaces?: boolean;
  includeDependencies?: boolean;
  includeHotspots?: boolean;
}

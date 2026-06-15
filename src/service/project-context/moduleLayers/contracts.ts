import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export type {
  FileGroupSummary,
  LayerSummary,
  ModuleLayerContext,
  ProjectContextQueryErrorCode,
} from '../../../domain/project-context/index.js';

export interface ModuleLayersRequestPayload {
  moduleName?: string;
  modulePath?: string;
  ownedFiles?: readonly (string | ProjectContextRef)[];
  ref?: ProjectContextRef;
  includeBoundaryCrossings?: boolean;
  layerHints?: readonly string[];
}

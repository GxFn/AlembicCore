import type {
  ProjectContext as ProjectContextContract,
  ProjectContextEnvelope,
  ProjectContextExecutionContext,
  ProjectContextRequest,
  ProjectContextResult,
} from '../../domain/project-context/index.js';
import { anchorRangeProjectContextHandler } from './anchorRange/index.js';
import { fileFlowProjectContextHandler } from './fileFlow/index.js';
import { fileSymbolsProjectContextHandler } from './fileSymbols/index.js';
import type { ProjectContextHandlerRegistry } from './interface/contracts.js';
import { createProjectContext } from './interface/projectContext.js';
import { mapProjectContextHandler } from './map/index.js';
import { moduleProjectContextHandler } from './module/index.js';
import { moduleLayersProjectContextHandler } from './moduleLayers/index.js';
import { repoProjectContextHandler } from './repo/index.js';
import { sourceSliceProjectContextHandler } from './sourceSlice/index.js';
import { spaceProjectContextHandler } from './space/index.js';

export const PROJECT_CONTEXT_DEFAULT_HANDLERS: ProjectContextHandlerRegistry = {
  'anchor-range': anchorRangeProjectContextHandler,
  'file-flow': fileFlowProjectContextHandler,
  'file-symbols': fileSymbolsProjectContextHandler,
  map: mapProjectContextHandler,
  module: moduleProjectContextHandler,
  'module-layers': moduleLayersProjectContextHandler,
  repo: repoProjectContextHandler,
  'source-slice': sourceSliceProjectContextHandler,
  space: spaceProjectContextHandler,
};

export class ProjectContextService implements ProjectContextContract {
  private readonly projectContext: ProjectContextContract;

  constructor(handlers: ProjectContextHandlerRegistry = {}) {
    this.projectContext = createProjectContext(handlers);
  }

  execute(
    input: ProjectContextRequest,
    context?: ProjectContextExecutionContext
  ): Promise<ProjectContextEnvelope<ProjectContextResult>> {
    return this.projectContext.execute(input, context);
  }
}

export const ProjectContext: ProjectContextContract = new ProjectContextService(
  PROJECT_CONTEXT_DEFAULT_HANDLERS
);

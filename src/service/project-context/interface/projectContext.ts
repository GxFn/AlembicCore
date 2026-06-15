import type {
  ProjectContext as ProjectContextContract,
  ProjectContextRequest,
  ProjectContextResult,
} from '../../../domain/project-context/index.js';
import type { ProjectContextHandlerRegistry } from './contracts.js';
import { dispatchProjectContextRequest } from './dispatch.js';
import { canonicalizeProjectContextRequest, ProjectContextRequestError } from './request.js';
import { createProjectContextEnvelope, createUnavailableProjectContextData } from './response.js';

export function createProjectContext(
  handlers: ProjectContextHandlerRegistry = {}
): ProjectContextContract {
  return {
    async execute(input: ProjectContextRequest) {
      try {
        const request = canonicalizeProjectContextRequest(input);
        const result = await dispatchProjectContextRequest(request, handlers);
        return createProjectContextEnvelope({
          data: result.data,
          errors: result.errors,
          queryLevel: request.kind,
          refs: result.refs,
          scope: request.scope,
        });
      } catch (error) {
        if (error instanceof ProjectContextRequestError) {
          const scope = error.scope ?? {
            includeGenerated: false,
            includeVendor: false,
            projectRoot: '',
          };
          return createProjectContextEnvelope({
            data: createUnavailableProjectContextData(error.queryLevel, error.message),
            errors: [error.queryError],
            queryLevel: error.queryLevel,
            refs: [],
            scope,
          });
        }
        throw error;
      }
    },
  };
}

export type ProjectContextExecuteResult = Awaited<
  ReturnType<ReturnType<typeof createProjectContext>['execute']>
> & {
  data: ProjectContextResult;
};

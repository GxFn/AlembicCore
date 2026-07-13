import type {
  ProjectContextExecutionContext,
  ProjectContextQueryError,
  ProjectContextRequestKind,
} from '../../../domain/project-context/index.js';
import type {
  CanonicalProjectContextRequest,
  ProjectContextHandlerRegistry,
  ProjectContextHandlerResult,
} from './contracts.js';
import { throwIfProjectContextAborted } from './execution.js';
import { createUnavailableProjectContextData } from './response.js';

export async function dispatchProjectContextRequest(
  request: CanonicalProjectContextRequest,
  handlers: ProjectContextHandlerRegistry,
  context?: ProjectContextExecutionContext
): Promise<ProjectContextHandlerResult> {
  throwIfProjectContextAborted(context);
  const handler = handlers[request.kind];
  if (!handler) {
    return createUnavailableResult(request.kind);
  }

  const result = await handler(request, context);
  throwIfProjectContextAborted(context);
  return result;
}

export function createUnavailableResult(
  kind: ProjectContextRequestKind
): ProjectContextHandlerResult {
  const error: ProjectContextQueryError = {
    code: 'query-unavailable',
    message: `ProjectContext ${kind} query is declared by PCQ-0 but its factual implementation belongs to a later PCQ phase.`,
    retryable: false,
    severity: 'warning',
  };

  return {
    data: createUnavailableProjectContextData(kind, error.message),
    errors: [error],
    refs: [],
  };
}

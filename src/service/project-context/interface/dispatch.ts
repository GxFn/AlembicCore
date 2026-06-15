import type {
  ProjectContextQueryError,
  ProjectContextRequestKind,
} from '../../../domain/project-context/index.js';
import type {
  CanonicalProjectContextRequest,
  ProjectContextHandlerRegistry,
  ProjectContextHandlerResult,
} from './contracts.js';
import { createUnavailableProjectContextData } from './response.js';

export async function dispatchProjectContextRequest(
  request: CanonicalProjectContextRequest,
  handlers: ProjectContextHandlerRegistry
): Promise<ProjectContextHandlerResult> {
  const handler = handlers[request.kind];
  if (!handler) {
    return createUnavailableResult(request.kind);
  }

  return handler(request);
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

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  type ProjectContextEnvelope,
  type ProjectContextProject,
  type ProjectContextQueryError,
  type ProjectContextRef,
  type ProjectContextRequestKind,
  type ProjectContextResult,
  type ProjectContextScope,
  type ProjectContextUnavailableData,
} from '../../../domain/project-context/index.js';
import { projectCompactProjectContextData } from './projection.js';
import { selectProjectContextRefs } from './pruning.js';

export interface ProjectContextEnvelopeInput {
  data: ProjectContextResult;
  errors?: ProjectContextQueryError[];
  queryLevel: ProjectContextRequestKind;
  refs?: ProjectContextRef[];
  scope: ProjectContextScope;
}

export function createProjectContextEnvelope(
  input: ProjectContextEnvelopeInput
): ProjectContextEnvelope<ProjectContextResult> {
  const refs = selectProjectContextRefs(input.refs);
  const errors = sortQueryErrors(input.errors ?? []);
  const envelope: ProjectContextEnvelope<ProjectContextResult> = {
    contractVersion: PROJECT_CONTEXT_CONTRACT_VERSION,
    data: projectCompactProjectContextData(input.data),
    project: createProjectContextProject(input.scope),
    queryLevel: input.queryLevel,
    refs,
  };

  if (errors.length > 0) {
    envelope.errors = errors;
  }

  return envelope;
}

export function createUnavailableProjectContextData(
  kind: string,
  reason: string
): ProjectContextUnavailableData {
  return {
    available: false,
    kind,
    nextRefs: [],
    reason,
  };
}

export function createProjectContextProject(scope: ProjectContextScope): ProjectContextProject {
  const projectId =
    scope.projectId ?? (scope.repoId ? `repo:${scope.repoId}` : `root:${scope.projectRoot}`);

  return {
    displayName: scope.displayName ?? scope.repoId ?? 'project',
    projectId,
    projectRoot: scope.projectRoot,
  };
}

function sortQueryErrors(errors: readonly ProjectContextQueryError[]): ProjectContextQueryError[] {
  return [...errors].sort((left, right) => {
    const codeOrder = left.code.localeCompare(right.code);
    if (codeOrder !== 0) {
      return codeOrder;
    }
    return left.message.localeCompare(right.message);
  });
}

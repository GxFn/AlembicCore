import { isAbsolute, relative, resolve } from 'node:path';
import {
  isProjectContextRequestKind,
  type ProjectContextJson,
  type ProjectContextProjectIdentityInput,
  type ProjectContextQueryError,
  type ProjectContextQueryErrorCode,
  type ProjectContextRequest,
  type ProjectContextRequestKind,
  type ProjectContextScope,
  type ProjectContextScopeInput,
} from '../../../domain/project-context/index.js';
import type { CanonicalProjectContextRequest } from './contracts.js';

export class ProjectContextRequestError extends Error {
  readonly queryError: ProjectContextQueryError;
  readonly queryLevel: ProjectContextRequestKind;
  readonly scope?: ProjectContextScope;

  constructor(
    queryError: ProjectContextQueryError,
    queryLevel: ProjectContextRequestKind = 'space',
    scope?: ProjectContextScope
  ) {
    super(queryError.message);
    this.name = 'ProjectContextRequestError';
    this.queryError = queryError;
    this.queryLevel = queryLevel;
    this.scope = scope;
  }
}

export function canonicalizeProjectContextRequest(
  input: ProjectContextRequest
): CanonicalProjectContextRequest {
  if (!input || typeof input !== 'object') {
    throwRequestError('invalid-request-kind', 'ProjectContext request must be an object.');
  }

  if (!isProjectContextRequestKind(input.kind)) {
    throwRequestError(
      'invalid-request-kind',
      `Unsupported ProjectContext request kind: ${String(input.kind)}.`
    );
  }

  const project = canonicalizeProjectIdentity(input.kind, input.project, input.scope);
  const scope = canonicalizeScope(input.kind, input.scope, project);
  return {
    kind: input.kind,
    payload: canonicalizeJson(input.payload),
    project,
    scope,
  };
}

export function canonicalizeJson(value: unknown): ProjectContextJson | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item) ?? null);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return Object.fromEntries(
      entries.map(([key, item]) => [key, canonicalizeJson(item) ?? null])
    ) as ProjectContextJson;
  }

  return String(value);
}

function canonicalizeScope(
  queryLevel: ProjectContextRequestKind,
  scopeInput: ProjectContextScopeInput,
  projectIdentity: CanonicalProjectContextRequest['project']
): ProjectContextScope {
  if (!scopeInput || typeof scopeInput !== 'object') {
    throwRequestError('invalid-scope', 'ProjectContext scope must be an object.', queryLevel);
  }
  const scopeProjectRoot = normalizeOptionalString(scopeInput.projectRoot);
  const projectRoot = projectIdentity.projectRoot;
  if (scopeProjectRoot) {
    const requestedProjectRoot = resolve(scopeProjectRoot);
    if (requestedProjectRoot !== projectIdentity.projectRoot) {
      throwRequestError(
        'project-root-conflict',
        'ProjectContext scope.projectRoot conflicts with the authoritative project path identity.',
        queryLevel,
        {
          includeGenerated: false,
          includeVendor: false,
          projectRoot: projectIdentity.projectRoot,
        },
        requestedProjectRoot
      );
    }
  }

  const sourceFolder = normalizeContainedPath(
    projectRoot,
    scopeInput.sourceFolder,
    'sourceFolder',
    queryLevel
  );
  const activeFile = normalizeContainedPath(
    projectRoot,
    scopeInput.activeFile,
    'activeFile',
    queryLevel
  );

  return {
    activeFile,
    displayName: projectIdentity.displayName,
    includeGenerated: scopeInput.includeGenerated === true,
    includeVendor: scopeInput.includeVendor === true,
    projectId: projectIdentity.projectId,
    projectIdentitySource: projectIdentity.source,
    projectRoot,
    repoId: normalizeOptionalString(scopeInput.repoId),
    sourceFolder,
  };
}

function canonicalizeProjectIdentity(
  queryLevel: ProjectContextRequestKind,
  input: ProjectContextProjectIdentityInput | undefined,
  scopeInput: ProjectContextScopeInput
): CanonicalProjectContextRequest['project'] {
  if (!scopeInput || typeof scopeInput !== 'object') {
    throwRequestError('invalid-scope', 'ProjectContext scope must be an object.', queryLevel);
  }

  if (input === undefined) {
    const scopeProjectRoot = normalizeOptionalString(scopeInput.projectRoot);
    if (!scopeProjectRoot) {
      throwRequestError(
        'invalid-scope',
        'ProjectContext requires project.projectRoot or scope.projectRoot.',
        queryLevel
      );
    }
    return {
      projectRoot: resolve(scopeProjectRoot),
    };
  }
  if (!input || typeof input !== 'object') {
    throwRequestError(
      'invalid-scope',
      'ProjectContext project identity must be an object.',
      queryLevel
    );
  }
  if (typeof input.projectRoot !== 'string' || input.projectRoot.trim().length === 0) {
    throwRequestError(
      'invalid-scope',
      'ProjectContext project.projectRoot is required when project identity is provided.',
      queryLevel
    );
  }

  return {
    displayName: normalizeOptionalString(input.displayName),
    projectId: normalizeOptionalString(input.projectId),
    projectRoot: resolve(input.projectRoot),
    source: normalizeOptionalString(input.source),
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeContainedPath(
  projectRoot: string,
  value: unknown,
  label: 'activeFile' | 'sourceFolder',
  queryLevel: ProjectContextRequestKind
): string | undefined {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue) {
    return undefined;
  }

  const absolutePath = isAbsolute(normalizedValue)
    ? resolve(normalizedValue)
    : resolve(projectRoot, normalizedValue);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return relativePath === '' ? '.' : relativePath;
  }

  throwRequestError(
    'outside-scope',
    `ProjectContext scope.${label} must stay inside scope.projectRoot.`,
    queryLevel,
    { projectRoot, includeGenerated: false, includeVendor: false },
    absolutePath
  );
}

function throwRequestError(
  code: ProjectContextQueryErrorCode,
  message: string,
  queryLevel: ProjectContextRequestKind = 'space',
  scope?: ProjectContextScope,
  path?: string
): never {
  throw new ProjectContextRequestError(
    {
      code,
      message,
      path,
      retryable: false,
      severity: 'error',
    },
    queryLevel,
    scope
  );
}

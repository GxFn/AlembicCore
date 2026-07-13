import type {
  FileSummary,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
  SourceSliceContext,
} from '../../../domain/project-context/index.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import {
  createProjectContextFileRef,
  createProjectContextSourceRangeProjection,
} from '../shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceQueryFailure, SourceSliceRequestPayload } from './contracts.js';
import { loadSourceSliceFile } from './fileAccess.js';
import { normalizeSourceSliceRange, readSourceSliceText } from './range.js';

export const sourceSliceProjectContextHandler: ProjectContextHandler = async (
  request,
  context
): Promise<ProjectContextHandlerResult> => {
  throwIfProjectContextAborted(context);
  const payload = readSourceSlicePayload(request.payload);
  const ref = readProjectContextRef(payload.ref);
  const filePath = payload.filePath ?? ref?.scope.filePath;
  if (!filePath) {
    return createSourceSliceFailure({
      code: 'invalid-scope',
      message: 'source-slice payload.filePath is required.',
      retryable: false,
    });
  }

  const fileAccess = await loadSourceSliceFile({
    filePath,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    sourceFolder: request.scope.sourceFolder,
    signal: context?.signal,
  });
  throwIfProjectContextAborted(context);
  if (!fileAccess.ok) {
    return createSourceSliceFailure(fileAccess.failure);
  }

  const rangeResult = normalizeSourceSliceRange(
    {
      endLine: payload.endLine,
      range: payload.range ?? ref?.scope.range,
      startLine: payload.startLine,
    },
    fileAccess.facts.lineCount
  );
  if (!rangeResult.ok) {
    return createSourceSliceFailure(rangeResult.failure);
  }

  const fileRef = createProjectContextFileRef({
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    projectRoot: fileAccess.facts.projectRoot,
    repoId: fileAccess.facts.repoId,
    sourceFolder: fileAccess.facts.sourceFolder,
  });
  const sourceProjection = createProjectContextSourceRangeProjection({
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    lineCount: fileAccess.facts.lineCount,
    mtimeMs: fileAccess.facts.mtimeMs,
    parentRef: fileRef.id,
    projectRoot: fileAccess.facts.projectRoot,
    range: rangeResult.range,
    repoId: fileAccess.facts.repoId,
    sourceFolder: fileAccess.facts.sourceFolder,
  });

  const file: FileSummary = {
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    language: fileAccess.facts.language,
    lineCount: fileAccess.facts.lineCount,
    mtimeMs: fileAccess.facts.mtimeMs,
    ref: fileRef,
    repoId: fileAccess.facts.repoId,
  };
  const data: SourceSliceContext = {
    file,
    hash: fileAccess.facts.hash,
    nextRefs: [],
    range: rangeResult.range,
    text:
      payload.includeText === true
        ? readSourceSliceText(fileAccess.facts.lines, rangeResult.range)
        : undefined,
  };

  return {
    data,
    refs: [fileRef, sourceProjection.ref],
  };
};

function readSourceSlicePayload(payload: unknown): SourceSliceRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    endLine: readNumber(payload.endLine),
    filePath: readString(payload.filePath),
    includeText: payload.includeText === true,
    range: readSourceRange(payload.range),
    ref: readProjectContextRef(payload.ref),
    startLine: readNumber(payload.startLine),
  };
}

function createSourceSliceFailure(failure: SourceSliceQueryFailure): ProjectContextHandlerResult {
  const error: ProjectContextQueryError = {
    code: failure.code,
    message: failure.message,
    path: failure.path,
    retryable: failure.retryable ?? false,
    severity: 'error',
  };

  return {
    data: createUnavailableSourceSliceData(failure.message),
    errors: [error],
    refs: [],
  };
}

function createUnavailableSourceSliceData(reason: string): ProjectContextUnavailableData {
  return {
    available: false,
    kind: 'source-slice',
    nextRefs: [],
    reason,
  };
}

function readProjectContextRef(value: unknown): ProjectContextRef | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
    return undefined;
  }
  if (!isRecord(value.scope)) {
    return undefined;
  }
  return value as unknown as ProjectContextRef;
}

function readSourceRange(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    endColumn: readNumber(value.endColumn),
    endLine: readNumber(value.endLine),
    startColumn: readNumber(value.startColumn),
    startLine: readNumber(value.startLine),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

import type {
  FileSummary,
  FileSymbolContext,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
} from '../../../domain/project-context/index.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { createProjectContextFileRef } from '../shared/sourceSlice-fileSymbols/index.js';
import { loadSourceSliceFile } from '../sourceSlice/fileAccess.js';
import type { FileSymbolsQueryFailure, FileSymbolsRequestPayload } from './contracts.js';
import { extractFileSymbolsFromSource } from './extract.js';
import { summarizeFileSymbolNaming } from './naming.js';
import { normalizeFileSymbols } from './normalize.js';

export const fileSymbolsProjectContextHandler: ProjectContextHandler = async (
  request,
  context
): Promise<ProjectContextHandlerResult> => {
  throwIfProjectContextAborted(context);
  const payload = readFileSymbolsPayload(request.payload);
  const ref = readProjectContextRef(payload.ref);
  const filePath = payload.filePath ?? ref?.scope.filePath ?? request.scope.activeFile;
  if (!filePath) {
    return createFileSymbolsFailure({
      code: 'invalid-scope',
      message: 'file-symbols payload.filePath or scope.activeFile is required.',
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
    return createFileSymbolsFailure(fileAccess.failure);
  }

  const fileRef = createProjectContextFileRef({
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    projectRoot: fileAccess.facts.projectRoot,
    repoId: fileAccess.facts.repoId,
    sourceFolder: fileAccess.facts.sourceFolder,
  });
  const extraction = extractFileSymbolsFromSource({
    filePath: fileAccess.facts.filePath,
    language: fileAccess.facts.language,
    lineCount: fileAccess.facts.lineCount,
    text: fileAccess.facts.text,
  });
  const normalized = normalizeFileSymbols({
    facts: fileAccess.facts,
    fileRef,
    symbols: extraction.symbols,
  });
  const naming = summarizeFileSymbolNaming(extraction.symbols);
  if (extraction.unavailableReason) {
    naming.warnings.push(extraction.unavailableReason);
  }

  const file: FileSummary = {
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    language: fileAccess.facts.language,
    lineCount: fileAccess.facts.lineCount,
    mtimeMs: fileAccess.facts.mtimeMs,
    ref: fileRef,
    repoId: fileAccess.facts.repoId,
  };
  const data: FileSymbolContext = {
    file,
    naming,
    nextRefs: normalized.sourceSliceRefs,
    symbols: normalized.symbols,
  };
  const errors = extraction.unavailableReason
    ? [
        createQueryError({
          code: 'query-unavailable',
          message: extraction.unavailableReason,
          path: fileAccess.facts.filePath,
          retryable: false,
        }),
      ]
    : undefined;

  return {
    data,
    errors,
    refs: [fileRef, ...normalized.symbolRefs, ...normalized.sourceSliceRefs],
  };
};

function readFileSymbolsPayload(payload: unknown): FileSymbolsRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    filePath: readString(payload.filePath),
    ref: readProjectContextRef(payload.ref),
  };
}

function createFileSymbolsFailure(failure: FileSymbolsQueryFailure): ProjectContextHandlerResult {
  return {
    data: createUnavailableFileSymbolsData(failure.message),
    errors: [createQueryError(failure)],
    refs: [],
  };
}

function createQueryError(failure: FileSymbolsQueryFailure): ProjectContextQueryError {
  return {
    code: failure.code,
    message: failure.message,
    path: failure.path,
    retryable: failure.retryable ?? false,
    severity: failure.code === 'query-unavailable' ? 'warning' : 'error',
  };
}

function createUnavailableFileSymbolsData(reason: string): ProjectContextUnavailableData {
  return {
    available: false,
    kind: 'file-symbols',
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

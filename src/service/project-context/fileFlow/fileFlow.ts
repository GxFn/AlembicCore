import type {
  FileFlowContext,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
} from '../../../domain/project-context/index.js';
import { extractFileSymbolsFromSource } from '../fileSymbols/extract.js';
import { normalizeFileSymbols } from '../fileSymbols/normalize.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { createProjectContextFileRef } from '../shared/sourceSlice-fileSymbols/index.js';
import { loadSourceSliceFile } from '../sourceSlice/fileAccess.js';
import type { FileFlowQueryFailure, FileFlowRequestPayload } from './contracts.js';
import { extractFileFlowFromSource } from './extract.js';
import { normalizeFileFlow } from './normalize.js';

export const fileFlowProjectContextHandler: ProjectContextHandler = async (
  request,
  context
): Promise<ProjectContextHandlerResult> => {
  throwIfProjectContextAborted(context);
  const payload = readFileFlowPayload(request.payload);
  const ref = readProjectContextRef(payload.ref);
  const filePath = payload.filePath ?? ref?.scope.filePath ?? request.scope.activeFile;
  if (!filePath) {
    return createFileFlowFailure({
      code: 'invalid-scope',
      message: 'file-flow payload.filePath or scope.activeFile is required.',
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
    return createFileFlowFailure(fileAccess.failure);
  }

  const fileRef = createProjectContextFileRef({
    filePath: fileAccess.facts.filePath,
    hash: fileAccess.facts.hash,
    projectRoot: fileAccess.facts.projectRoot,
    repoId: fileAccess.facts.repoId,
    sourceFolder: fileAccess.facts.sourceFolder,
  });
  const symbolExtraction = extractFileSymbolsFromSource({
    filePath: fileAccess.facts.filePath,
    language: fileAccess.facts.language,
    lineCount: fileAccess.facts.lineCount,
    text: fileAccess.facts.text,
  });
  const normalizedSymbols = normalizeFileSymbols({
    facts: fileAccess.facts,
    fileRef,
    symbols: symbolExtraction.symbols,
  });
  const flowExtraction = extractFileFlowFromSource({
    filePath: fileAccess.facts.filePath,
    language: fileAccess.facts.language,
    lineCount: fileAccess.facts.lineCount,
    text: fileAccess.facts.text,
  });
  const normalized = await normalizeFileFlow({
    callSites: flowExtraction.callSites,
    exports: flowExtraction.exports,
    facts: fileAccess.facts,
    fileRef,
    imports: flowExtraction.imports,
    symbols: normalizedSymbols.symbols,
    signal: context?.signal,
  });
  throwIfProjectContextAborted(context);
  const errors = [
    ...createUnavailableWarnings(fileAccess.facts.filePath, [
      flowExtraction.unavailableReason,
      symbolExtraction.unavailableReason,
    ]),
    ...normalized.warnings.map(createQueryError),
  ];

  const data: FileFlowContext = {
    callers: normalized.callers,
    callees: normalized.callees,
    exports: normalized.exports,
    file: normalized.file,
    imports: normalized.imports,
    inflow: normalized.inflow,
    nextRefs: normalized.nextRefs,
    outflow: normalized.outflow,
  };

  return {
    data,
    errors: errors.length > 0 ? errors : undefined,
    refs: dedupeRefs([
      ...normalized.refs,
      ...normalizedSymbols.symbolRefs,
      ...normalizedSymbols.sourceSliceRefs,
    ]),
  };
};

function readFileFlowPayload(payload: unknown): FileFlowRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    filePath: readString(payload.filePath),
    ref: readProjectContextRef(payload.ref),
  };
}

function createFileFlowFailure(failure: FileFlowQueryFailure): ProjectContextHandlerResult {
  return {
    data: createUnavailableFileFlowData(failure.message),
    errors: [createQueryError(failure)],
    refs: [],
  };
}

function createUnavailableWarnings(
  path: string,
  messages: readonly (string | undefined)[]
): ProjectContextQueryError[] {
  return messages
    .filter((message): message is string => Boolean(message))
    .map((message) =>
      createQueryError({
        code: 'query-unavailable',
        message,
        path,
        retryable: false,
      })
    );
}

function createQueryError(failure: FileFlowQueryFailure): ProjectContextQueryError {
  return {
    code: failure.code,
    message: failure.message,
    path: failure.path,
    retryable: failure.retryable ?? false,
    severity: failure.code === 'query-unavailable' ? 'warning' : 'error',
  };
}

function createUnavailableFileFlowData(reason: string): ProjectContextUnavailableData {
  return {
    available: false,
    kind: 'file-flow',
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

function dedupeRefs(refs: readonly ProjectContextRef[]): ProjectContextRef[] {
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()].sort((left, right) =>
    left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind.localeCompare(right.kind)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

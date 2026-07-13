import type {
  AnchorRangeContext,
  FileFlowContext,
  FileSummary,
  FileSymbolContext,
  ProjectContextAnchor,
  ProjectContextAnchorKind,
  ProjectContextExecutionContext,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextUnavailableData,
  RelationSummary,
  SourceRangeSummary,
  SourceSliceContext,
  SymbolSummary,
} from '../../../domain/project-context/index.js';
import { fileFlowProjectContextHandler } from '../fileFlow/index.js';
import { fileSymbolsProjectContextHandler } from '../fileSymbols/index.js';
import type {
  CanonicalProjectContextRequest,
  ProjectContextHandler,
  ProjectContextHandlerResult,
} from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { sourceSliceProjectContextHandler } from '../sourceSlice/index.js';
import type {
  AnchorRangePayloadAnchor,
  AnchorRangeQueryFailure,
  AnchorRangeRequestPayload,
  NormalizedAnchorRangeOptions,
} from './contracts.js';

export const anchorRangeProjectContextHandler: ProjectContextHandler = async (
  request,
  context
): Promise<ProjectContextHandlerResult> => {
  throwIfProjectContextAborted(context);
  const payload = readAnchorRangePayload(request.payload);
  const options = normalizeOptions(payload);
  const anchorCandidate = readAnchorCandidate(payload, request.scope.activeFile);
  if (!anchorCandidate.ok) {
    return createAnchorRangeFailure(anchorCandidate.failure);
  }

  const resolvedAnchor = await resolveAnchorRange(request, anchorCandidate.anchor, context);
  throwIfProjectContextAborted(context);
  if (!resolvedAnchor.ok) {
    return createAnchorRangeFailure(resolvedAnchor.failure);
  }

  const expandedRange = expandSourceRange(
    resolvedAnchor.range,
    resolvedAnchor.file.lineCount ?? resolvedAnchor.range.endLine,
    options
  );
  const expandedSlice = await querySourceSlice(
    request,
    {
      filePath: resolvedAnchor.file.filePath,
      range: expandedRange,
    },
    context
  );
  throwIfProjectContextAborted(context);
  if (!isSourceSliceContext(expandedSlice.data)) {
    return {
      data: createUnavailableAnchorRangeData('anchor-range expanded source-slice is unavailable.'),
      errors: expandedSlice.errors,
      refs: expandedSlice.refs,
    };
  }

  const symbolResult = options.includeSymbols
    ? await queryFileSymbols(request, resolvedAnchor.file.filePath, context)
    : undefined;
  const flowResult = options.includeRelations
    ? await queryFileFlow(request, resolvedAnchor.file.filePath, context)
    : undefined;
  throwIfProjectContextAborted(context);

  const symbols = options.includeSymbols
    ? filterSymbolsInRange(readFileSymbols(symbolResult?.data), expandedRange)
    : [];
  const relationSites = options.includeRelations
    ? filterRelationsInRange(readFileFlowRelations(flowResult?.data), expandedRange)
    : [];
  const sourceSlices = options.includeSourceSlices
    ? dedupeRefs(readSourceSliceRefs(expandedSlice))
    : [];
  const containingRefs = options.includeContainingRefs
    ? dedupeRefs([resolvedAnchor.file.ref, expandedSlice.refs?.find((ref) => ref.kind === 'file')])
    : [];
  const relatedRefs =
    options.includeRelatedRefs && options.radius.relationHops > 0
      ? collectRelatedRefs(relationSites)
      : [];
  const nextRefs = dedupeRefs([
    ...sourceSlices,
    ...symbols.map((symbol) => symbol.ref),
    ...relationSites.flatMap((relation) => [
      relation.ref,
      relation.sourceRef,
      relation.targetRef,
      relation.fromRef,
      relation.toRef,
    ]),
    ...relatedRefs,
    ...containingRefs,
  ]);

  const data: AnchorRangeContext = {
    anchor: {
      ...resolvedAnchor.anchor,
      filePath: resolvedAnchor.file.filePath,
      range: resolvedAnchor.range,
    },
    containingRefs,
    file: resolvedAnchor.file,
    nextRefs,
    radius: options.radius,
    range: expandedRange,
    relatedRefs,
    relationSites,
    sourceSlices,
    symbols,
  };
  const errors = [
    ...(resolvedAnchor.errors ?? []),
    ...(expandedSlice.errors ?? []),
    ...(symbolResult?.errors ?? []),
    ...(flowResult?.errors ?? []),
  ];

  return {
    data,
    errors: errors.length > 0 ? errors : undefined,
    refs: dedupeRefs([
      ...(expandedSlice.refs ?? []),
      ...(symbolResult?.refs ?? []),
      ...(flowResult?.refs ?? []),
      ...nextRefs,
    ]),
  };
};

type AnchorCandidateResult =
  | { ok: true; anchor: ProjectContextAnchor }
  | { ok: false; failure: AnchorRangeQueryFailure };

type ResolvedAnchorResult =
  | {
      ok: true;
      anchor: ProjectContextAnchor;
      file: FileSummary;
      range: SourceRangeSummary;
      errors?: ProjectContextQueryError[];
    }
  | { ok: false; failure: AnchorRangeQueryFailure };

function readAnchorRangePayload(payload: unknown): AnchorRangeRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    afterLines: readNumber(payload.afterLines),
    anchor: readPayloadAnchor(payload.anchor),
    beforeLines: readNumber(payload.beforeLines),
    filePath: readString(payload.filePath),
    includeContainingRefs: payload.includeContainingRefs !== false,
    includeRelatedRefs: payload.includeRelatedRefs !== false,
    includeRelations: payload.includeRelations !== false,
    includeSourceSlices: payload.includeSourceSlices !== false,
    includeSymbols: payload.includeSymbols !== false,
    line: readNumber(payload.line),
    radius: readRadius(payload.radius),
    range: readSourceRange(payload.range),
    ref: readProjectContextRef(payload.ref),
    relationHops: readNumber(payload.relationHops),
  };
}

function readPayloadAnchor(value: unknown): AnchorRangePayloadAnchor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    filePath: readString(value.filePath),
    kind: readAnchorKind(value.kind),
    line: readNumber(value.line),
    range: readSourceRange(value.range),
    ref: readProjectContextRef(value.ref),
  };
}

function normalizeOptions(payload: AnchorRangeRequestPayload): NormalizedAnchorRangeOptions {
  return {
    includeContainingRefs: payload.includeContainingRefs !== false,
    includeRelatedRefs: payload.includeRelatedRefs !== false,
    includeRelations: payload.includeRelations !== false,
    includeSourceSlices: payload.includeSourceSlices !== false,
    includeSymbols: payload.includeSymbols !== false,
    radius: {
      afterLines: normalizeNonNegativeInteger(payload.radius?.afterLines ?? payload.afterLines, 2),
      beforeLines: normalizeNonNegativeInteger(
        payload.radius?.beforeLines ?? payload.beforeLines,
        2
      ),
      relationHops: normalizeNonNegativeInteger(
        payload.radius?.relationHops ?? payload.relationHops,
        1
      ),
    },
  };
}

function readAnchorCandidate(
  payload: AnchorRangeRequestPayload,
  activeFile?: string
): AnchorCandidateResult {
  const anchorInput = payload.anchor ?? {};
  const ref = anchorInput.ref ?? payload.ref;
  const filePath = anchorInput.filePath ?? payload.filePath ?? ref?.scope.filePath ?? activeFile;
  const line = anchorInput.line ?? payload.line;
  const range = anchorInput.range ?? payload.range ?? ref?.scope.range;
  const kind = anchorInput.kind ?? inferAnchorKind({ line, range, ref });

  if (!kind) {
    return {
      failure: {
        code: 'invalid-scope',
        message:
          'anchor-range requires anchor, ref, filePath+line, filePath+range, or scope.activeFile.',
        retryable: false,
      },
      ok: false,
    };
  }
  if (!filePath) {
    return {
      failure: {
        code: 'invalid-scope',
        message: 'anchor-range anchor must resolve to a file path.',
        retryable: false,
      },
      ok: false,
    };
  }

  return {
    anchor: {
      filePath,
      kind,
      line,
      range,
      ref,
    },
    ok: true,
  };
}

async function resolveAnchorRange(
  request: CanonicalProjectContextRequest,
  anchor: ProjectContextAnchor,
  context?: ProjectContextExecutionContext
): Promise<ResolvedAnchorResult> {
  if (anchor.range) {
    const slice = await querySourceSlice(
      request,
      {
        filePath: anchor.filePath,
        range: anchor.range,
      },
      context
    );
    if (!isSourceSliceContext(slice.data)) {
      return failureFromHandlerResult(
        slice,
        'anchor-range source-range anchor could not be resolved.'
      );
    }
    return {
      anchor,
      errors: slice.errors,
      file: slice.data.file,
      ok: true,
      range: slice.data.range,
    };
  }

  if (anchor.line !== undefined) {
    const slice = await querySourceSlice(
      request,
      {
        filePath: anchor.filePath,
        range: { endLine: anchor.line, startLine: anchor.line },
      },
      context
    );
    if (!isSourceSliceContext(slice.data)) {
      return failureFromHandlerResult(
        slice,
        'anchor-range file-line anchor could not be resolved.'
      );
    }
    return {
      anchor,
      errors: slice.errors,
      file: slice.data.file,
      ok: true,
      range: slice.data.range,
    };
  }

  if (anchor.ref?.kind === 'file' && anchor.filePath) {
    const firstLine = await querySourceSlice(
      request,
      {
        filePath: anchor.filePath,
        range: { endLine: 1, startLine: 1 },
      },
      context
    );
    if (!isSourceSliceContext(firstLine.data)) {
      return failureFromHandlerResult(firstLine, 'anchor-range file ref could not be resolved.');
    }
    return {
      anchor,
      errors: firstLine.errors,
      file: firstLine.data.file,
      ok: true,
      range: { endLine: firstLine.data.file.lineCount ?? 1, startLine: 1 },
    };
  }

  return {
    failure: {
      code: 'invalid-scope',
      message: 'anchor-range ref anchors must carry a source range unless they are file refs.',
      path: anchor.filePath,
      retryable: false,
    },
    ok: false,
  };
}

async function querySourceSlice(
  request: CanonicalProjectContextRequest,
  payload: { filePath?: string; range?: SourceRangeSummary; ref?: ProjectContextRef },
  context?: ProjectContextExecutionContext
): Promise<ProjectContextHandlerResult> {
  return sourceSliceProjectContextHandler(
    {
      ...request,
      kind: 'source-slice',
      payload,
    },
    context
  );
}

async function queryFileSymbols(
  request: CanonicalProjectContextRequest,
  filePath: string,
  context?: ProjectContextExecutionContext
): Promise<ProjectContextHandlerResult> {
  return fileSymbolsProjectContextHandler(
    {
      ...request,
      kind: 'file-symbols',
      payload: { filePath },
    },
    context
  );
}

async function queryFileFlow(
  request: CanonicalProjectContextRequest,
  filePath: string,
  context?: ProjectContextExecutionContext
): Promise<ProjectContextHandlerResult> {
  return fileFlowProjectContextHandler(
    {
      ...request,
      kind: 'file-flow',
      payload: { filePath },
    },
    context
  );
}

function failureFromHandlerResult(
  result: ProjectContextHandlerResult,
  fallbackMessage: string
): ResolvedAnchorResult {
  const error = result.errors?.[0];
  return {
    failure: {
      code: error?.code ?? 'query-unavailable',
      message: error?.message ?? fallbackMessage,
      path: error?.path,
      retryable: error?.retryable ?? false,
    },
    ok: false,
  };
}

function expandSourceRange(
  anchorRange: SourceRangeSummary,
  lineCount: number,
  options: NormalizedAnchorRangeOptions
): SourceRangeSummary {
  return {
    endLine: Math.min(lineCount, anchorRange.endLine + options.radius.afterLines),
    startLine: Math.max(1, anchorRange.startLine - options.radius.beforeLines),
  };
}

function filterSymbolsInRange(
  symbols: readonly SymbolSummary[],
  range: SourceRangeSummary
): SymbolSummary[] {
  return symbols.filter((symbol) => symbol.range && rangesOverlap(symbol.range, range));
}

function filterRelationsInRange(
  relations: readonly RelationSummary[],
  range: SourceRangeSummary
): RelationSummary[] {
  return dedupeRelations(
    relations.filter((relation) => relation.range && rangesOverlap(relation.range, range))
  );
}

function readFileSymbols(data: ProjectContextHandlerResult['data'] | undefined): SymbolSummary[] {
  return isFileSymbolContext(data) ? data.symbols : [];
}

function readFileFlowRelations(
  data: ProjectContextHandlerResult['data'] | undefined
): RelationSummary[] {
  if (!isFileFlowContext(data)) {
    return [];
  }
  return dedupeRelations([
    ...data.imports,
    ...data.callers,
    ...data.callees,
    ...data.inflow,
    ...data.outflow,
  ]);
}

function readSourceSliceRefs(result: ProjectContextHandlerResult): ProjectContextRef[] {
  return result.refs?.filter((ref) => ref.kind === 'source-slice') ?? [];
}

function collectRelatedRefs(relations: readonly RelationSummary[]): ProjectContextRef[] {
  return dedupeRefs(
    relations.flatMap((relation) => [
      relation.fromRef,
      relation.toRef,
      relation.targetRef,
      relation.sourceRef,
      relation.from?.ref,
      relation.to?.ref,
    ])
  );
}

function inferAnchorKind(input: {
  ref?: ProjectContextRef;
  line?: number;
  range?: SourceRangeSummary;
}): ProjectContextAnchorKind | undefined {
  if (input.ref?.kind === 'source-slice') {
    return 'source-slice-ref';
  }
  if (input.ref?.kind === 'relation-site') {
    return 'relation-site-ref';
  }
  if (input.ref?.kind === 'file-symbol' || input.ref?.kind === 'symbol') {
    return 'symbol-ref';
  }
  if (input.ref) {
    return 'context-ref';
  }
  if (input.range) {
    return 'source-range';
  }
  if (input.line !== undefined) {
    return 'file-line';
  }
  return undefined;
}

function readAnchorKind(value: unknown): ProjectContextAnchorKind | undefined {
  if (
    value === 'file-line' ||
    value === 'source-range' ||
    value === 'symbol-ref' ||
    value === 'relation-site-ref' ||
    value === 'source-slice-ref' ||
    value === 'context-ref'
  ) {
    return value;
  }
  return undefined;
}

function isSourceSliceContext(value: unknown): value is SourceSliceContext {
  return isRecord(value) && isRecord(value.file) && isRecord(value.range);
}

function isFileSymbolContext(value: unknown): value is FileSymbolContext {
  return isRecord(value) && Array.isArray(value.symbols);
}

function isFileFlowContext(value: unknown): value is FileFlowContext {
  return isRecord(value) && Array.isArray(value.imports) && Array.isArray(value.outflow);
}

function createAnchorRangeFailure(failure: AnchorRangeQueryFailure): ProjectContextHandlerResult {
  return {
    data: createUnavailableAnchorRangeData(failure.message),
    errors: [createQueryError(failure)],
    refs: [],
  };
}

function createUnavailableAnchorRangeData(reason: string): ProjectContextUnavailableData {
  return {
    available: false,
    kind: 'anchor-range',
    nextRefs: [],
    reason,
  };
}

function createQueryError(failure: AnchorRangeQueryFailure): ProjectContextQueryError {
  return {
    code: failure.code,
    message: failure.message,
    path: failure.path,
    retryable: failure.retryable ?? false,
    severity: failure.code === 'query-unavailable' ? 'warning' : 'error',
  };
}

function readRadius(value: unknown): Partial<AnchorRangeRequestPayload['radius']> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    afterLines: readNumber(value.afterLines),
    beforeLines: readNumber(value.beforeLines),
    relationHops: readNumber(value.relationHops),
  };
}

function readSourceRange(value: unknown): SourceRangeSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const startLine = readNumber(value.startLine);
  const endLine = readNumber(value.endLine);
  if (startLine === undefined || endLine === undefined) {
    return undefined;
  }
  return {
    endColumn: readNumber(value.endColumn),
    endLine,
    startColumn: readNumber(value.startColumn),
    startLine,
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

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function rangesOverlap(left: SourceRangeSummary, right: SourceRangeSummary): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function dedupeRelations(relations: readonly RelationSummary[]): RelationSummary[] {
  return dedupeBy(
    relations,
    (relation) => relation.ref?.id ?? relation.label ?? relation.kind
  ).sort(compareRelations);
}

function dedupeRefs(refs: readonly (ProjectContextRef | undefined)[]): ProjectContextRef[] {
  return dedupeBy(
    refs.filter((ref): ref is ProjectContextRef => ref !== undefined),
    (ref) => ref.id
  ).sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder || left.id.localeCompare(right.id);
  });
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareRelations(left: RelationSummary, right: RelationSummary): number {
  return (
    compareRanges(left.range, right.range) ||
    left.kind.localeCompare(right.kind) ||
    (left.label ?? '').localeCompare(right.label ?? '')
  );
}

function compareRanges(
  left: SourceRangeSummary | undefined,
  right: SourceRangeSummary | undefined
): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.startLine - right.startLine || left.endLine - right.endLine;
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

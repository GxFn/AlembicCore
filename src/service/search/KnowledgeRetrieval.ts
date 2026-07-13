import type { EmbeddingPort } from '../vector/EmbeddingPort.js';
import { parseRecipeIdFromRegionVectorId } from '../vector/RecipeRegionVectorIndex.js';
import type { VectorIndexReader } from '../vector/VectorIndexPorts.js';

export interface KnowledgeTruthRecord extends Record<string, unknown> {
  id: string;
  lifecycle?: string;
  status?: string;
  title?: string;
}

export interface KnowledgeTruthReader {
  findByIds(
    ids: readonly string[]
  ): Promise<readonly KnowledgeTruthRecord[]> | readonly KnowledgeTruthRecord[];
  matchesFilter?(record: KnowledgeTruthRecord, filter: unknown): boolean;
}

export interface RawDenseCandidate {
  id: string;
  item: Record<string, unknown>;
  score: number;
}

export interface RawSparseCandidate extends Record<string, unknown> {
  id: string;
  score?: number;
}

export interface KnowledgeRegionEvidence {
  id: string;
  regionClass?: string;
  denseSimilarity?: number;
  content?: string;
}

export interface KnowledgeRetrievalDiagnostics {
  filteredOrphanCount: number;
  filteredDeprecatedCount: number;
  aggregatedRegionCount: number;
  refillRounds: number;
  candidateWindow: number;
  exhausted: boolean;
  candidateBudgetReached: boolean;
  filteredMetadataCount?: number;
  fallbackReason?: string;
}

export interface KnowledgeRetrievalCandidate {
  recipeId: string;
  recipe: KnowledgeTruthRecord;
  score: number;
  denseSimilarity?: number;
  denseRank?: number;
  sparseScore?: number;
  sparseRank?: number;
  denseLaneUsed: boolean;
  sparseLaneUsed: boolean;
  vectorUsed: boolean;
  semanticUsed: boolean;
  fallbackReason?: string;
  rrfContribution: {
    dense: number;
    sparse: number;
    total: number;
  };
  regionEvidence: KnowledgeRegionEvidence[];
  diagnostics: KnowledgeRetrievalDiagnostics;
}

export interface KnowledgeRetrievalRequest {
  query: string;
  topK?: number;
  alpha?: number;
  filter?: unknown;
  /** Raw lane filter (for example semantic region classes), separate from Recipe truth filters. */
  candidateFilter?: unknown;
  mode?: string;
  candidateBudget?: number;
  signal?: AbortSignal;
}

export interface KnowledgeRetrievalResult {
  candidates: KnowledgeRetrievalCandidate[];
  diagnostics: KnowledgeRetrievalDiagnostics;
}

export interface KnowledgeRetrievalPort {
  retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalResult>;
}

export type KnowledgeSparseRetriever = (
  query: string,
  options: { limit: number; filter?: unknown; signal?: AbortSignal }
) => Promise<readonly RawSparseCandidate[]> | readonly RawSparseCandidate[];

export interface HybridCandidateRetrieverOptions {
  embedding?: EmbeddingPort | null;
  reader?: VectorIndexReader | null;
  sparse?: KnowledgeSparseRetriever | null;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
}

export interface HybridCandidateBatch {
  dense: RawDenseCandidate[];
  sparse: RawSparseCandidate[];
  denseExhausted: boolean;
  sparseExhausted: boolean;
  fallbackReason?: string;
}

export interface HybridCandidateSession {
  collect(window: number): Promise<HybridCandidateBatch>;
  knownIndexSize?: number;
}

/** Collects raw lane evidence. It owns embedding purpose and reader-only access. */
export class HybridCandidateRetriever {
  readonly #embedding: EmbeddingPort | null;
  readonly #reader: VectorIndexReader | null;
  readonly #sparse: KnowledgeSparseRetriever | null;
  readonly #circuitFailureThreshold: number;
  readonly #circuitCooldownMs: number;
  #consecutiveFailures = 0;
  #circuitOpenUntil = 0;

  constructor(options: HybridCandidateRetrieverOptions = {}) {
    this.#embedding = options.embedding ?? null;
    this.#reader = options.reader ?? null;
    this.#sparse = options.sparse ?? null;
    this.#circuitFailureThreshold = options.circuitFailureThreshold ?? 3;
    this.#circuitCooldownMs = options.circuitCooldownMs ?? 60_000;
  }

  async prepare(request: KnowledgeRetrievalRequest): Promise<HybridCandidateSession> {
    request.signal?.throwIfAborted();
    let queryVector: number[] | null = null;
    let fallbackReason: string | undefined;
    let knownIndexSize: number | undefined;

    const keywordOnly = request.mode?.toLowerCase() === 'keyword';
    if (keywordOnly) {
      fallbackReason = 'keyword-mode';
    } else if (!this.#embedding) {
      fallbackReason = 'embed-provider-missing';
    } else if (!this.#reader) {
      fallbackReason = 'vector-reader-missing';
    } else if (Date.now() < this.#circuitOpenUntil) {
      fallbackReason = 'embed-circuit-open';
    } else {
      try {
        queryVector = await this.#embedding.embedQuery(request.query, { signal: request.signal });
        request.signal?.throwIfAborted();
        if (queryVector.length === 0) {
          fallbackReason = 'empty-query-embedding';
        }
        this.#consecutiveFailures = 0;
      } catch (error) {
        if (request.signal?.aborted) {
          throw normalizeAbortError(request.signal.reason);
        }
        fallbackReason = `embed-failed:${error instanceof Error ? error.message : String(error)}`;
        this.#consecutiveFailures++;
        if (this.#consecutiveFailures >= this.#circuitFailureThreshold) {
          this.#circuitOpenUntil = Date.now() + this.#circuitCooldownMs;
          fallbackReason = 'embed-circuit-open';
        }
      }
    }

    if (this.#reader && !this.#sparse) {
      try {
        const stats = await this.#reader.getStats();
        if (Number.isFinite(stats.count) && stats.count >= 0) {
          knownIndexSize = stats.count;
        }
      } catch {
        // Inventory is an optional budget hint; retrieval stays usable without it.
      }
    }

    return {
      knownIndexSize,
      collect: async (window) => {
        request.signal?.throwIfAborted();
        const [denseResult, sparseResult] = await Promise.allSettled([
          queryVector && this.#reader
            ? this.#reader.searchVector(queryVector, {
                filter: request.candidateFilter,
                topK: window,
              })
            : Promise.resolve([]),
          this.#sparse
            ? Promise.resolve(
                this.#sparse(request.query, {
                  filter: request.filter,
                  limit: window,
                  signal: request.signal,
                })
              )
            : Promise.resolve([]),
        ]);
        request.signal?.throwIfAborted();
        const dense = denseResult.status === 'fulfilled' ? denseResult.value : [];
        const sparse = sparseResult.status === 'fulfilled' ? sparseResult.value : [];
        const laneFailureReason =
          denseResult.status === 'rejected'
            ? `vector-reader-failed:${readErrorMessage(denseResult.reason)}`
            : sparseResult.status === 'rejected'
              ? `sparse-retriever-failed:${readErrorMessage(sparseResult.reason)}`
              : undefined;
        return {
          dense: dense.map((hit) => ({
            id: readRawCandidateId(hit.item),
            item: hit.item,
            score: hit.score,
          })),
          denseExhausted: !queryVector || dense.length < window,
          fallbackReason: laneFailureReason ?? fallbackReason,
          sparse: [...sparse],
          sparseExhausted: !this.#sparse || sparse.length < window,
        };
      },
    };
  }
}

export interface KnowledgeTruthProjectionInput {
  dense: readonly RawDenseCandidate[];
  sparse: readonly RawSparseCandidate[];
  alpha?: number;
  rrfK?: number;
  maxRegionEvidence?: number;
  filter?: unknown;
}

export interface KnowledgeTruthProjectionResult {
  candidates: KnowledgeRetrievalCandidate[];
  filteredOrphanCount: number;
  filteredDeprecatedCount: number;
  aggregatedRegionCount: number;
  filteredMetadataCount: number;
}

/** Projects raw vector/chunk ids into authoritative live Recipe units before fusion. */
export class KnowledgeTruthProjector {
  readonly #truth: KnowledgeTruthReader;

  constructor(truth: KnowledgeTruthReader) {
    this.#truth = truth;
  }

  async project(input: KnowledgeTruthProjectionInput): Promise<KnowledgeTruthProjectionResult> {
    const alpha = input.alpha ?? 0.5;
    const rrfK = input.rrfK ?? 60;
    // Nine canonical region classes currently exist; sixteen remains bounded
    // while ensuring a presentation-only regionClasses filter cannot erase a class.
    const maxRegionEvidence = input.maxRegionEvidence ?? 16;
    const evidenceByRecipe = new Map<
      string,
      {
        dense?: { rank: number; score: number };
        sparse?: { rank: number; score?: number };
        regions: KnowledgeRegionEvidence[];
        denseCount: number;
        sparseCount: number;
      }
    >();

    input.dense.forEach((candidate, index) => {
      const recipeId = resolveRecipeId(candidate.id, candidate.item);
      if (!recipeId) {
        return;
      }
      const evidence = evidenceByRecipe.get(recipeId) ?? {
        denseCount: 0,
        regions: [],
        sparseCount: 0,
      };
      evidence.denseCount++;
      if (!evidence.dense || index + 1 < evidence.dense.rank) {
        evidence.dense = { rank: index + 1, score: candidate.score };
      }
      if (evidence.regions.length < maxRegionEvidence && candidate.id !== recipeId) {
        const metadata = readMetadata(candidate.item);
        evidence.regions.push({
          ...(typeof candidate.item.content === 'string'
            ? { content: candidate.item.content }
            : {}),
          denseSimilarity: candidate.score,
          id: candidate.id,
          ...(typeof metadata.regionClass === 'string'
            ? { regionClass: metadata.regionClass }
            : {}),
        });
      }
      evidenceByRecipe.set(recipeId, evidence);
    });

    input.sparse.forEach((candidate, index) => {
      const recipeId = resolveRecipeId(candidate.id, candidate);
      if (!recipeId) {
        return;
      }
      const evidence = evidenceByRecipe.get(recipeId) ?? {
        denseCount: 0,
        regions: [],
        sparseCount: 0,
      };
      evidence.sparseCount++;
      if (!evidence.sparse || index + 1 < evidence.sparse.rank) {
        evidence.sparse = { rank: index + 1, score: candidate.score };
      }
      evidenceByRecipe.set(recipeId, evidence);
    });

    const ids = [...evidenceByRecipe.keys()];
    const rows = await this.#truth.findByIds(ids);
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    let filteredOrphanCount = 0;
    let filteredDeprecatedCount = 0;
    let aggregatedRegionCount = 0;
    let filteredMetadataCount = 0;
    const candidates: KnowledgeRetrievalCandidate[] = [];
    const live: Array<{
      id: string;
      recipe: KnowledgeTruthRecord;
      evidence: NonNullable<ReturnType<typeof evidenceByRecipe.get>>;
    }> = [];

    for (const id of ids) {
      const recipe = rowsById.get(id);
      if (!recipe) {
        filteredOrphanCount++;
        continue;
      }
      if (String(recipe.lifecycle ?? recipe.status ?? '').toLowerCase() === 'deprecated') {
        filteredDeprecatedCount++;
        continue;
      }
      if (!this.#matchesFilter(recipe, input.filter)) {
        filteredMetadataCount++;
        continue;
      }
      const evidence = evidenceByRecipe.get(id)!;
      aggregatedRegionCount +=
        Math.max(0, evidence.denseCount - 1) + Math.max(0, evidence.sparseCount - 1);
      live.push({ evidence, id, recipe });
    }

    const denseRanks = assignAuthoritativeRanks(live, 'dense');
    const sparseRanks = assignAuthoritativeRanks(live, 'sparse');
    for (const { evidence, id, recipe } of live) {
      const denseRank = denseRanks.get(id);
      const sparseRank = sparseRanks.get(id);
      const denseContribution = denseRank ? alpha / (rrfK + denseRank) : 0;
      const sparseContribution = sparseRank ? (1 - alpha) / (rrfK + sparseRank) : 0;
      const total = denseContribution + sparseContribution;
      candidates.push({
        ...(evidence.dense ? { denseRank, denseSimilarity: evidence.dense.score } : {}),
        denseLaneUsed: !!evidence.dense,
        diagnostics: emptyDiagnostics(),
        recipe,
        recipeId: id,
        regionEvidence: evidence.regions,
        rrfContribution: {
          dense: denseContribution,
          sparse: sparseContribution,
          total,
        },
        score: total,
        semanticUsed: !!evidence.dense,
        ...(evidence.sparse ? { sparseRank, sparseScore: evidence.sparse.score } : {}),
        sparseLaneUsed: !!evidence.sparse,
        vectorUsed: !!evidence.dense,
      });
    }

    candidates.sort(
      (left, right) =>
        right.rrfContribution.total - left.rrfContribution.total ||
        left.recipeId.localeCompare(right.recipeId)
    );
    return {
      aggregatedRegionCount,
      candidates,
      filteredDeprecatedCount,
      filteredOrphanCount,
      filteredMetadataCount,
    };
  }

  #matchesFilter(recipe: KnowledgeTruthRecord, filter: unknown): boolean {
    if (this.#truth.matchesFilter) {
      return this.#truth.matchesFilter(recipe, filter);
    }
    return matchesKnowledgeFilter(recipe, filter);
  }
}

function assignAuthoritativeRanks(
  live: Array<{
    id: string;
    evidence: {
      dense?: { rank: number };
      sparse?: { rank: number };
    };
  }>,
  lane: 'dense' | 'sparse'
): Map<string, number> {
  return new Map(
    live
      .filter((item) => item.evidence[lane] !== undefined)
      .sort(
        (left, right) =>
          left.evidence[lane]!.rank - right.evidence[lane]!.rank || left.id.localeCompare(right.id)
      )
      .map((item, index) => [item.id, index + 1])
  );
}

export interface KnowledgeRetrievalPolicyOptions {
  initialCandidateWindow?: number;
  maxCandidateBudget?: number;
  rrfK?: number;
}

export class KnowledgeRetrievalPolicy implements KnowledgeRetrievalPort {
  readonly #retriever: HybridCandidateRetriever;
  readonly #projector: KnowledgeTruthProjector;
  readonly #initialWindow: number;
  readonly #maxBudget: number;
  readonly #rrfK: number;

  constructor(
    retriever: HybridCandidateRetriever,
    projector: KnowledgeTruthProjector,
    options: KnowledgeRetrievalPolicyOptions = {}
  ) {
    this.#retriever = retriever;
    this.#projector = projector;
    this.#initialWindow = options.initialCandidateWindow ?? 32;
    this.#maxBudget = options.maxCandidateBudget ?? 256;
    this.#rrfK = options.rrfK ?? 60;
  }

  async retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalResult> {
    const topK = Math.max(0, Math.floor(request.topK ?? 10));
    if (topK === 0 || !request.query.trim()) {
      return { candidates: [], diagnostics: emptyDiagnostics() };
    }
    request.signal?.throwIfAborted();
    const session = await this.#retriever.prepare(request);
    const configuredBudget = Math.max(1, Math.floor(request.candidateBudget ?? this.#maxBudget));
    const knownBudget =
      session.knownIndexSize && session.knownIndexSize > 0
        ? Math.min(configuredBudget, session.knownIndexSize)
        : configuredBudget;
    let window = Math.min(knownBudget, Math.max(this.#initialWindow, topK * 4));
    let refillRounds = 0;
    let finalProjection: KnowledgeTruthProjectionResult = {
      aggregatedRegionCount: 0,
      candidates: [],
      filteredDeprecatedCount: 0,
      filteredOrphanCount: 0,
      filteredMetadataCount: 0,
    };
    let finalBatch: HybridCandidateBatch = {
      dense: [],
      denseExhausted: true,
      sparse: [],
      sparseExhausted: true,
    };

    while (true) {
      request.signal?.throwIfAborted();
      finalBatch = await session.collect(window);
      try {
        finalProjection = await this.#projector.project({
          alpha: request.alpha,
          dense: finalBatch.dense,
          filter: request.filter,
          rrfK: this.#rrfK,
          sparse: finalBatch.sparse,
        });
      } catch (error) {
        finalBatch = {
          ...finalBatch,
          denseExhausted: true,
          fallbackReason: `knowledge-truth-failed:${readErrorMessage(error)}`,
          sparseExhausted: true,
        };
        finalProjection = {
          aggregatedRegionCount: 0,
          candidates: [],
          filteredDeprecatedCount: 0,
          filteredMetadataCount: 0,
          filteredOrphanCount: 0,
        };
      }
      const exhausted =
        (finalBatch.denseExhausted && finalBatch.sparseExhausted) ||
        (session.knownIndexSize !== undefined && window >= session.knownIndexSize);
      if (finalProjection.candidates.length >= topK || exhausted || window >= knownBudget) {
        break;
      }
      const nextWindow = Math.min(knownBudget, window * 2);
      if (nextWindow === window) {
        break;
      }
      window = nextWindow;
      refillRounds++;
    }

    const exhausted =
      (finalBatch.denseExhausted && finalBatch.sparseExhausted) ||
      (session.knownIndexSize !== undefined && window >= session.knownIndexSize);
    const candidateBudgetReached =
      window >= configuredBudget &&
      finalProjection.candidates.length < topK &&
      !(session.knownIndexSize !== undefined && session.knownIndexSize <= configuredBudget) &&
      !(finalBatch.denseExhausted && finalBatch.sparseExhausted);
    const diagnostics: KnowledgeRetrievalDiagnostics = {
      aggregatedRegionCount: finalProjection.aggregatedRegionCount,
      candidateBudgetReached,
      candidateWindow: window,
      exhausted,
      ...(candidateBudgetReached
        ? { fallbackReason: 'candidate-budget-exhausted' }
        : finalBatch.fallbackReason
          ? { fallbackReason: finalBatch.fallbackReason }
          : {}),
      filteredDeprecatedCount: finalProjection.filteredDeprecatedCount,
      filteredMetadataCount: finalProjection.filteredMetadataCount,
      filteredOrphanCount: finalProjection.filteredOrphanCount,
      refillRounds,
    };
    const candidates = finalProjection.candidates.slice(0, topK).map((candidate) => ({
      ...candidate,
      diagnostics,
      ...(diagnostics.fallbackReason ? { fallbackReason: diagnostics.fallbackReason } : {}),
    }));
    return { candidates, diagnostics };
  }
}

function resolveRecipeId(rawId: string, item: Record<string, unknown>): string {
  const metadata = readMetadata(item);
  const direct = [metadata.recipeId, metadata.entryId, item.recipeId, item.entryId].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  if (direct) {
    return direct;
  }
  return parseRecipeIdFromRegionVectorId(rawId) ?? rawId.replace(/^entry_/, '');
}

function readMetadata(item: Record<string, unknown>): Record<string, unknown> {
  return item.metadata && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : item;
}

function readRawCandidateId(item: Record<string, unknown>): string {
  return typeof item.id === 'string' ? item.id : '';
}

function emptyDiagnostics(): KnowledgeRetrievalDiagnostics {
  return {
    aggregatedRegionCount: 0,
    candidateBudgetReached: false,
    candidateWindow: 0,
    exhausted: true,
    filteredDeprecatedCount: 0,
    filteredMetadataCount: 0,
    filteredOrphanCount: 0,
    refillRounds: 0,
  };
}

function matchesKnowledgeFilter(record: KnowledgeTruthRecord, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') {
    return true;
  }
  for (const [rawKey, rawExpected] of Object.entries(filter as Record<string, unknown>)) {
    if (rawExpected === undefined || rawExpected === null) {
      continue;
    }
    const key = rawKey === 'tag' ? 'tags' : rawKey;
    const expected = (Array.isArray(rawExpected) ? rawExpected : [rawExpected])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    if (expected.length === 0) {
      continue;
    }
    const rawActual = record[key];
    const actual = readFilterValues(rawActual).map((value) => value.toLowerCase());
    if (!expected.some((value) => actual.includes(value))) {
      return false;
    }
  }
  return true;
}

function readFilterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string') {
    return [];
  }
  if (value.startsWith('[')) {
    try {
      return readFilterValues(JSON.parse(value));
    } catch {
      return [value];
    }
  }
  return [value];
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  const error = new Error(reason instanceof Error ? reason.message : 'Operation was aborted.');
  error.name = 'AbortError';
  return error;
}

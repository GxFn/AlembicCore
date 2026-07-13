import { createHash } from 'node:crypto';
import type { VectorStore } from '../../infrastructure/vector/VectorStore.js';
import {
  projectRecipeRetrievalDocumentSet,
  type RecipeRetrievalDocumentRole,
} from '../knowledge/RecipeRetrieval.js';
import { asEmbeddingPort } from './EmbeddingPort.js';
import type { EmbedProvider } from './VectorService.js';

export const RECIPE_SEMANTIC_REGION_METADATA_TYPE = 'recipe-semantic-region';
export const RECIPE_REGION_VECTOR_ID_PREFIX = 'recipe_region_';
export const RECIPE_REGION_VECTOR_SCHEMA_VERSION = 1;

export const RECIPE_SEMANTIC_REGION_CLASSES = [
  'identity',
  'applicability',
  'patternPurpose',
  'architectureConvention',
  'integrationBoundary',
  'qualityConcern',
  'negativeBoundary',
  'rationale',
  'evidence',
] as const;

export type RecipeSemanticRegionClass = (typeof RECIPE_SEMANTIC_REGION_CLASSES)[number];
export type SourceRefsBridgeStatus = 'active' | 'partial' | 'missing';
export type RecipeRegionSyncStatus = 'completed' | 'degraded' | 'failed';

export interface RecipeRegionSourceEntry {
  id: string;
  title?: string;
  description?: string;
  lifecycle?: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  knowledgeType?: string;
  kind?: string;
  tags?: string[];
  trigger?: string;
  topicHint?: string;
  whenClause?: string;
  doClause?: string;
  dontClause?: string;
  coreCode?: string;
  usageGuide?: string;
  content?: unknown;
  reasoning?: unknown;
  retrievalProfile?:
    | import('../../domain/knowledge/RecipeRetrievalProfile.js').RecipeRetrievalProfile
    | null;
  quality?: unknown;
  sourceFile?: string | null;
  moduleName?: string;
  contentHash?: string | null;
  updatedAt?: number | string | null;
}

export interface RecipeSourceRefsBridge {
  status?: SourceRefsBridgeStatus;
  refs?: string[];
}

export interface RecipeRegionBuildOptions {
  sourceRefsBridge?: RecipeSourceRefsBridge;
  maxRegionChars?: number;
}

export interface RecipeRegionVectorMetadata {
  type: typeof RECIPE_SEMANTIC_REGION_METADATA_TYPE;
  recipeId: string;
  regionClass: RecipeSemanticRegionClass;
  /** Canonical role. regionClass remains as a reader compatibility alias. */
  documentRole: RecipeRetrievalDocumentRole;
  candidateEligible: boolean;
  documentSetHash: string;
  profileHash: string;
  sourceContentHash: string;
  sourceFields: string[];
  provenanceRefs: string[];
  sourceFile: string;
  quality: Record<string, unknown>;
  regionHash: string;
  contentHash: string;
  sourceHash: string;
  title: string;
  trigger: string;
  lifecycle: string;
  dimensionId: string;
  language: string;
  kind: string;
  knowledgeType: string;
  schemaVersion: typeof RECIPE_REGION_VECTOR_SCHEMA_VERSION;
  tags: string[];
  weakCategory?: string;
  weakTopicHint?: string;
  sourceRefs: string[];
  sourceRefCount: number;
  sourceRefsBridge: SourceRefsBridgeStatus;
  bridgeRefCount: number;
  generatedFrom: 'knowledge-entry-row';
  generationScope: 'rebuild-refresh-sync';
  deprecated: boolean;
}

export interface RecipeSemanticRegionChunk {
  id: string;
  content: string;
  metadata: RecipeRegionVectorMetadata;
}

export interface RecipeRegionSyncOptions {
  sourceRefsBridgeByRecipeId?: Record<string, RecipeSourceRefsBridge>;
  removeStale?: boolean;
  maxRegionChars?: number;
  /**
   * Omitted means a fail-safe subset refresh: only obsolete chunks belonging
   * to entries in this call may be removed. Authoritative maintenance must
   * carry the complete non-deprecated Recipe id set explicitly; callers that
   * batch entries pass the same complete set to every batch.
   */
  maintenanceScope?: {
    kind: 'authoritative-corpus';
    nonDeprecatedRecipeIds: readonly string[];
  };
  /** true = 全量重建（禁用"id 已存在跳过"加速），用于显式 rebuild 场景 */
  force?: boolean;
}

export interface RecipeRegionSyncResult {
  status: RecipeRegionSyncStatus;
  scanned: number;
  generated: number;
  embedded: number;
  upserted: number;
  /** Newly written chunks whose content, hashes, role, and vector were read back successfully. */
  verified: number;
  removed: number;
  skipped: number;
  /** id 已在索引（内容未变）而跳过 embed/upsert 的 chunk 数（2026-07-06 启动加速） */
  skippedExisting?: number;
  errors: string[];
  degradedReason?: string;
  generatedMetadata: RecipeRegionVectorMetadata[];
}

export interface RecipeRegionRemovalResult {
  removed: number;
  errors: string[];
}

export interface RecipeRegionGenerationTestSampleQuery {
  query: string;
  filter?: Record<string, unknown>;
  topK?: number;
  minScore?: number;
}

export interface RecipeRegionGenerationTestOptions extends RecipeRegionSyncOptions {
  sampleQueries?: RecipeRegionGenerationTestSampleQuery[];
}

export interface RecipeRegionGenerationTestRetrievalSample {
  query: string;
  matched: boolean;
  topK: number;
  matchedRegionIds: string[];
  matchedRecipeIds: string[];
  matchedRegionClasses: RecipeSemanticRegionClass[];
  topScore?: number;
  error?: string;
}

export interface RecipeRegionGenerationTestReport {
  mode: 'bounded-generation-test';
  status: RecipeRegionSyncStatus;
  activeRecipeCount: number;
  distinctRecipeIdsCovered: number;
  missingRecipeIds: string[];
  generatedRecipeRegionItemCount: number;
  embedded: number;
  upserted: number;
  skipped: number;
  removed: number;
  degradedCount: number;
  staleRemovedCount: number;
  legacyEntryCount: number;
  legacyEntryOnly: boolean;
  safeForFullFixtureGeneration: boolean;
  errors: string[];
  generatedRegionClassCounts: Record<RecipeSemanticRegionClass, number>;
  filterProof: {
    recipeSemanticRegionFilterCount: number;
    regionClassFilterCounts: Record<RecipeSemanticRegionClass, number>;
    filterable: boolean;
  };
  retrievalSamples: RecipeRegionGenerationTestRetrievalSample[];
  vectorIndex: {
    count?: number;
    indexSize?: number;
    indexPath?: string;
    timestamp: string;
  };
  fullGenerationRoute: {
    method: 'VectorService.syncRecipeSemanticRegions';
    precondition: 'bounded-generation-test-passed';
    allowedAfterBoundedPass: boolean;
  };
}

interface NormalizedReasoning {
  whyStandard: string;
  sources: string[];
}

interface RecipeRegionGenerationFilterProofState {
  filteredRegionItems: Record<string, unknown>[];
  regionClassFilterCounts: Record<RecipeSemanticRegionClass, number>;
}

function stableHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(input);
}

function compactString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return compactStringArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeReasoning(reasoning: unknown): NormalizedReasoning {
  const record = parseRecord(reasoning);
  return {
    whyStandard: compactString(record.whyStandard),
    sources: compactStringArray(record.sources),
  };
}

function normalizeBridge(
  bridge: RecipeSourceRefsBridge | undefined,
  reasoningSources: string[]
): Required<RecipeSourceRefsBridge> {
  const refs = compactStringArray(bridge?.refs);
  if (bridge?.status) {
    return { status: bridge.status, refs };
  }
  if (refs.length > 0) {
    return { status: 'active', refs };
  }
  if (reasoningSources.length > 0) {
    return { status: 'partial', refs: [] };
  }
  return { status: 'missing', refs: [] };
}

function emptyRegionClassCounts(): Record<RecipeSemanticRegionClass, number> {
  return Object.fromEntries(
    RECIPE_SEMANTIC_REGION_CLASSES.map((regionClass) => [regionClass, 0])
  ) as Record<RecipeSemanticRegionClass, number>;
}

function recipeRegionVectorId(
  recipeId: string,
  regionClass: RecipeSemanticRegionClass,
  regionHash: string
): string {
  return `${RECIPE_REGION_VECTOR_ID_PREFIX}${recipeId}_${regionClass}_${regionHash.slice(0, 16)}`;
}

export function buildRecipeSemanticRegionChunks(
  entry: RecipeRegionSourceEntry,
  options: RecipeRegionBuildOptions = {}
): RecipeSemanticRegionChunk[] {
  const reasoning = normalizeReasoning(entry.reasoning);
  const bridge = normalizeBridge(options.sourceRefsBridge, reasoning.sources);
  const sourceRefs = bridge.refs.length > 0 ? bridge.refs : reasoning.sources;
  const tags = compactStringArray(entry.tags);
  const deprecated = compactString(entry.lifecycle).toLowerCase() === 'deprecated';

  if (deprecated) {
    return [];
  }

  const parsedProfile = parseRecord(entry.retrievalProfile);
  const documentSet = projectRecipeRetrievalDocumentSet({
    ...entry,
    content: parseRecord(entry.content),
    reasoning: parseRecord(entry.reasoning),
    retrievalProfile:
      Object.keys(parsedProfile).length > 0
        ? (parsedProfile as unknown as import('../../domain/knowledge/RecipeRetrievalProfile.js').RecipeRetrievalProfile)
        : null,
  });
  return documentSet.documents.map((document) => {
    const regionClass = compatibilityRegionClass(document.role);
    const regionHash = stableHash({
      documentRole: document.role,
      recipeId: entry.id,
      text: document.text,
    });
    const metadata: RecipeRegionVectorMetadata = {
      type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
      recipeId: entry.id,
      regionClass,
      documentRole: document.role,
      candidateEligible: document.candidateEligible,
      documentSetHash: documentSet.documentSetHash,
      profileHash: documentSet.profileHash,
      sourceContentHash: documentSet.sourceContentHash,
      sourceFields: document.sourceFields,
      provenanceRefs: document.provenanceRefs,
      sourceFile: compactString(entry.sourceFile),
      quality: parseRecord(entry.quality),
      regionHash,
      contentHash: document.contentHash,
      sourceHash: documentSet.sourceContentHash,
      title: compactString(entry.title),
      trigger: compactString(entry.trigger),
      lifecycle: compactString(entry.lifecycle),
      dimensionId: compactString(entry.dimensionId),
      language: compactString(entry.language),
      kind: compactString(entry.kind),
      knowledgeType: compactString(entry.knowledgeType),
      schemaVersion: RECIPE_REGION_VECTOR_SCHEMA_VERSION,
      tags,
      sourceRefs,
      sourceRefCount: sourceRefs.length,
      sourceRefsBridge: bridge.status,
      bridgeRefCount: bridge.refs.length,
      generatedFrom: 'knowledge-entry-row',
      generationScope: 'rebuild-refresh-sync',
      deprecated: false,
    };
    const weakCategory = compactString(entry.category);
    if (weakCategory) {
      metadata.weakCategory = weakCategory;
    }
    const weakTopicHint = compactString(entry.topicHint);
    if (weakTopicHint) {
      metadata.weakTopicHint = weakTopicHint;
    }

    return {
      id: recipeRegionVectorId(entry.id, regionClass, regionHash),
      content: document.text,
      metadata,
    };
  });
}

function compatibilityRegionClass(role: RecipeRetrievalDocumentRole): RecipeSemanticRegionClass {
  switch (role) {
    case 'intent':
      return 'identity';
    case 'guidance':
      return 'applicability';
    case 'implementation':
      return 'architectureConvention';
    case 'rationale':
      return 'rationale';
  }
}

export async function syncRecipeSemanticRegionVectors(
  vectorStore: VectorStore,
  embedProvider: EmbedProvider | null,
  entries: RecipeRegionSourceEntry[],
  options: RecipeRegionSyncOptions = {}
): Promise<RecipeRegionSyncResult> {
  const result: RecipeRegionSyncResult = {
    status: 'completed',
    scanned: entries.length,
    generated: 0,
    embedded: 0,
    upserted: 0,
    verified: 0,
    removed: 0,
    skipped: 0,
    errors: [],
    generatedMetadata: [],
  };
  const chunks = entries.flatMap((entry) =>
    buildRecipeSemanticRegionChunks(entry, {
      maxRegionChars: options.maxRegionChars,
      sourceRefsBridge: options.sourceRefsBridgeByRecipeId?.[entry.id],
    })
  );
  const expectedIds = new Set(chunks.map((chunk) => chunk.id));
  const batchRecipeIds = new Set(entries.map((entry) => entry.id));
  const authoritativeRecipeIds = options.maintenanceScope
    ? new Set(options.maintenanceScope.nonDeprecatedRecipeIds)
    : null;

  if (
    authoritativeRecipeIds &&
    [...batchRecipeIds].some((recipeId) => !authoritativeRecipeIds.has(recipeId))
  ) {
    result.status = 'failed';
    result.errors.push('authoritative-corpus-missing-batch-recipe-id');
    return result;
  }

  result.generated = chunks.length;
  result.generatedMetadata = chunks.map((chunk) => chunk.metadata);

  // 已存在跳过（2026-07-06 启动同步加速）：chunk id 内嵌 regionHash（recipeId+
  // regionClass+regionContent 的稳定哈希），id 在索引中即内容未变——重复 embed
  // 纯属浪费（真机 76 条 ≈656 chunk 全量 re-embed ~86s/每次启动）。内容变化 →
  // regionHash 变 → id 不同 → 自然走生成+旧 id 由 removeStale 清理。
  // options.force 显式全量重建时不跳过。
  let existingIds: Set<string> | null = null;
  if (options.force !== true) {
    try {
      existingIds = new Set(await vectorStore.listIds());
    } catch {
      existingIds = null; // listIds 不可用则退回全量（容缺，不影响正确性）
    }
  }

  const pendingChunks = existingIds ? chunks.filter((chunk) => !existingIds.has(chunk.id)) : chunks;
  result.skippedExisting = chunks.length - pendingChunks.length;

  let cleanupVectorIds = existingIds ? [...existingIds] : null;
  const removeRegionVectors = async (
    shouldRemove: (id: string, recipeId: string) => boolean
  ): Promise<void> => {
    if (!cleanupVectorIds) {
      try {
        cleanupVectorIds = await vectorStore.listIds();
      } catch (err: unknown) {
        result.errors.push(`stale-list-failed:${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    for (const id of cleanupVectorIds) {
      if (!id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)) {
        continue;
      }
      const recipeId = parseRecipeIdFromRegionVectorId(id);
      if (!recipeId || !shouldRemove(id, recipeId)) {
        continue;
      }
      try {
        await vectorStore.remove(id);
        result.removed++;
      } catch (err: unknown) {
        if (result.errors.length < 100) {
          result.errors.push(
            `stale-remove-failed:${id}:${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  };

  // Authority proves these Recipe ids no longer exist, so their derived
  // regions can be removed without embedding. Live Recipe chunks are not
  // touched in this phase.
  if (options.removeStale !== false && authoritativeRecipeIds) {
    await removeRegionVectors((_id, recipeId) => !authoritativeRecipeIds.has(recipeId));
  }

  if (pendingChunks.length > 0 && !embedProvider) {
    result.status = 'degraded';
    result.degradedReason = 'embed-provider-unavailable';
    result.skipped = pendingChunks.length;
    return result;
  }

  if (pendingChunks.length > 0) {
    try {
      const vectors = await asEmbeddingPort(embedProvider!).embedDocuments(
        pendingChunks.map((chunk) => chunk.content)
      );
      const items = pendingChunks.map((chunk, index) => ({
        id: chunk.id,
        content: chunk.content,
        vector: vectors[index] ?? [],
        metadata: { ...chunk.metadata },
      }));
      await vectorStore.batchUpsert(items);
      result.embedded = vectors.length;
      result.upserted = items.length;
      for (const item of items) {
        const stored = await vectorStore.getById(item.id);
        const readbackError = recipeRegionReadbackError(stored, item);
        if (readbackError) {
          result.status = 'failed';
          result.errors.push(`replacement-readback-failed:${item.id}:${readbackError}`);
          return result;
        }
        result.verified++;
      }
    } catch (err: unknown) {
      result.status = 'failed';
      result.errors.push(`embed-upsert-failed:${err instanceof Error ? err.message : String(err)}`);
      // Replacement safety: stale live chunks are removed only after their
      // new siblings were embedded and persisted successfully.
      return result;
    }
  }

  if (options.removeStale !== false) {
    // Obsolete chunks for live Recipes are safe to remove only after every
    // required replacement in this batch was embedded and upserted.
    await removeRegionVectors(
      (id, recipeId) => batchRecipeIds.has(recipeId) && !expectedIds.has(id)
    );
  }

  return result;
}

function recipeRegionReadbackError(
  stored: Record<string, unknown> | null,
  expected: {
    content: string;
    vector: number[];
    metadata: RecipeRegionVectorMetadata;
  }
): string | null {
  if (!stored) {
    return 'missing';
  }
  const metadata = parseRecord(stored.metadata);
  if (
    stored.content !== expected.content ||
    metadata.contentHash !== expected.metadata.contentHash ||
    metadata.documentSetHash !== expected.metadata.documentSetHash ||
    metadata.sourceContentHash !== expected.metadata.sourceContentHash ||
    metadata.documentRole !== expected.metadata.documentRole
  ) {
    return 'content-or-metadata-mismatch';
  }
  if (
    !Array.isArray(stored.vector) ||
    stored.vector.length === 0 ||
    stored.vector.length !== expected.vector.length
  ) {
    return 'vector-dimension-mismatch';
  }
  return null;
}

export async function testRecipeSemanticRegionGeneration(
  vectorStore: VectorStore,
  embedProvider: EmbedProvider | null,
  entries: RecipeRegionSourceEntry[],
  options: RecipeRegionGenerationTestOptions = {}
): Promise<RecipeRegionGenerationTestReport> {
  const syncResult = await syncRecipeSemanticRegionVectors(
    vectorStore,
    embedProvider,
    entries,
    options
  );
  const errors = [...syncResult.errors];
  const activeRecipeIds = activeRecipeIdsFor(entries);
  const vectorIds = await listVectorIdsForProof(vectorStore, errors);
  const legacyEntryCount = vectorIds.filter((id) => id.startsWith('entry_')).length;
  const generatedRegionClassCounts = generatedRegionClassCountsFor(syncResult.generatedMetadata);
  const filterProof = await collectGenerationFilterProof(vectorStore, errors);
  const coveredRecipeIds = coveredActiveRecipeIds(filterProof.filteredRegionItems, activeRecipeIds);
  const missingRecipeIds = activeRecipeIds.filter((recipeId) => !coveredRecipeIds.has(recipeId));
  const retrievalSamples = await collectGenerationTestRetrievalSamples(
    vectorStore,
    embedProvider,
    entries,
    options.sampleQueries
  );
  appendRetrievalSampleErrors(retrievalSamples, errors);

  const generatedRecipeRegionItemCount = filterProof.filteredRegionItems.filter((item) =>
    vectorItemId(item).startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)
  ).length;
  const legacyEntryOnly = legacyEntryCount > 0 && generatedRecipeRegionItemCount === 0;
  const stats = await getVectorIndexStats(vectorStore, errors);
  const degradedCount = syncResult.status === 'degraded' ? syncResult.skipped : 0;
  const filterable = generationFilterProofIsUsable(filterProof);
  const safeForFullFixtureGeneration = generationTestAllowsFullFixture({
    activeRecipeIds,
    errors,
    filterable,
    generatedRecipeRegionItemCount,
    legacyEntryOnly,
    missingRecipeIds,
    retrievalSamples,
    syncStatus: syncResult.status,
  });

  return {
    mode: 'bounded-generation-test',
    status: syncResult.status,
    activeRecipeCount: activeRecipeIds.length,
    distinctRecipeIdsCovered: coveredRecipeIds.size,
    missingRecipeIds,
    generatedRecipeRegionItemCount,
    embedded: syncResult.embedded,
    upserted: syncResult.upserted,
    skipped: syncResult.skipped,
    removed: syncResult.removed,
    degradedCount,
    staleRemovedCount: syncResult.removed,
    legacyEntryCount,
    legacyEntryOnly,
    safeForFullFixtureGeneration,
    errors,
    generatedRegionClassCounts,
    filterProof: {
      recipeSemanticRegionFilterCount: filterProof.filteredRegionItems.length,
      regionClassFilterCounts: filterProof.regionClassFilterCounts,
      filterable,
    },
    retrievalSamples,
    vectorIndex: stats,
    fullGenerationRoute: {
      method: 'VectorService.syncRecipeSemanticRegions',
      precondition: 'bounded-generation-test-passed',
      allowedAfterBoundedPass: safeForFullFixtureGeneration,
    },
  };
}

function activeRecipeIdsFor(entries: RecipeRegionSourceEntry[]): string[] {
  return entries
    .filter((entry) => compactString(entry.lifecycle).toLowerCase() === 'active')
    .map((entry) => entry.id);
}

async function listVectorIdsForProof(
  vectorStore: VectorStore,
  errors: string[]
): Promise<string[]> {
  try {
    return await vectorStore.listIds();
  } catch (err: unknown) {
    errors.push(`list-ids-proof-failed:${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function generatedRegionClassCountsFor(
  generatedMetadata: RecipeRegionVectorMetadata[]
): Record<RecipeSemanticRegionClass, number> {
  const counts = emptyRegionClassCounts();
  for (const metadata of generatedMetadata) {
    counts[metadata.regionClass]++;
  }
  return counts;
}

async function collectGenerationFilterProof(
  vectorStore: VectorStore,
  errors: string[]
): Promise<RecipeRegionGenerationFilterProofState> {
  const regionClassFilterCounts = emptyRegionClassCounts();
  try {
    const filteredRegionItems = await vectorStore.searchByFilter({
      type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
      deprecated: false,
    });
    for (const regionClass of RECIPE_SEMANTIC_REGION_CLASSES) {
      const items = await vectorStore.searchByFilter({
        type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
        regionClass,
        deprecated: false,
      });
      regionClassFilterCounts[regionClass] = items.length;
    }
    return { filteredRegionItems, regionClassFilterCounts };
  } catch (err: unknown) {
    errors.push(`filter-proof-failed:${err instanceof Error ? err.message : String(err)}`);
    return { filteredRegionItems: [], regionClassFilterCounts };
  }
}

function coveredActiveRecipeIds(
  filteredRegionItems: Record<string, unknown>[],
  activeRecipeIds: string[]
): Set<string> {
  const activeRecipeIdSet = new Set(activeRecipeIds);
  const coveredRecipeIds = new Set<string>();
  for (const item of filteredRegionItems) {
    const metadata = vectorItemMetadata(item);
    if (metadata.type !== RECIPE_SEMANTIC_REGION_METADATA_TYPE) {
      continue;
    }
    const recipeId = compactString(metadata.recipeId);
    if (recipeId && activeRecipeIdSet.has(recipeId)) {
      coveredRecipeIds.add(recipeId);
    }
  }
  return coveredRecipeIds;
}

function appendRetrievalSampleErrors(
  samples: RecipeRegionGenerationTestRetrievalSample[],
  errors: string[]
): void {
  for (const sample of samples) {
    if (sample.error) {
      errors.push(`sample-retrieval-proof:${sample.error}`);
    }
  }
}

function generationFilterProofIsUsable(proof: RecipeRegionGenerationFilterProofState): boolean {
  return (
    proof.filteredRegionItems.length > 0 &&
    Object.values(proof.regionClassFilterCounts).some((count) => count > 0)
  );
}

function generationTestAllowsFullFixture(input: {
  activeRecipeIds: string[];
  errors: string[];
  filterable: boolean;
  generatedRecipeRegionItemCount: number;
  legacyEntryOnly: boolean;
  missingRecipeIds: string[];
  retrievalSamples: RecipeRegionGenerationTestRetrievalSample[];
  syncStatus: RecipeRegionSyncStatus;
}): boolean {
  return (
    input.syncStatus === 'completed' &&
    input.errors.length === 0 &&
    input.activeRecipeIds.length > 0 &&
    input.missingRecipeIds.length === 0 &&
    input.generatedRecipeRegionItemCount > 0 &&
    input.filterable &&
    input.retrievalSamples.some((sample) => sample.matched) &&
    !input.legacyEntryOnly
  );
}

async function getVectorIndexStats(
  vectorStore: VectorStore,
  errors: string[]
): Promise<RecipeRegionGenerationTestReport['vectorIndex']> {
  try {
    const stats = (await vectorStore.getStats()) as Record<string, unknown>;
    return {
      count: typeof stats.count === 'number' ? stats.count : undefined,
      indexSize: typeof stats.indexSize === 'number' ? stats.indexSize : undefined,
      indexPath: typeof stats.indexPath === 'string' ? stats.indexPath : undefined,
      timestamp: new Date().toISOString(),
    };
  } catch (err: unknown) {
    errors.push(`vector-stats-proof-failed:${err instanceof Error ? err.message : String(err)}`);
    return { timestamp: new Date().toISOString() };
  }
}

async function collectGenerationTestRetrievalSamples(
  vectorStore: VectorStore,
  embedProvider: EmbedProvider | null,
  entries: RecipeRegionSourceEntry[],
  sampleQueries: RecipeRegionGenerationTestSampleQuery[] | undefined
): Promise<RecipeRegionGenerationTestRetrievalSample[]> {
  const queries = sampleQueries?.length
    ? sampleQueries
    : defaultGenerationTestSampleQueries(entries);
  if (queries.length === 0) {
    return [];
  }
  if (!embedProvider) {
    return queries.map((query) => ({
      query: query.query,
      matched: false,
      topK: query.topK ?? 5,
      matchedRegionIds: [],
      matchedRecipeIds: [],
      matchedRegionClasses: [],
      error: 'embed-provider-unavailable',
    }));
  }

  const samples: RecipeRegionGenerationTestRetrievalSample[] = [];
  for (const sampleQuery of queries) {
    const topK = sampleQuery.topK ?? 5;
    try {
      const queryVector = await asEmbeddingPort(embedProvider).embedQuery(sampleQuery.query);
      const results = await vectorStore.searchVector(queryVector, {
        topK,
        minScore: sampleQuery.minScore,
        filter: {
          ...(sampleQuery.filter ?? {}),
          type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
          deprecated: false,
        },
      });
      const regionResults = results.filter(
        (result) => vectorItemMetadata(result.item).type === RECIPE_SEMANTIC_REGION_METADATA_TYPE
      );
      samples.push({
        query: sampleQuery.query,
        matched: regionResults.length > 0,
        topK,
        matchedRegionIds: regionResults.map((result) => vectorItemId(result.item)).filter(Boolean),
        matchedRecipeIds: [
          ...new Set(
            regionResults
              .map((result) => compactString(vectorItemMetadata(result.item).recipeId))
              .filter(Boolean)
          ),
        ],
        matchedRegionClasses: [
          ...new Set(
            regionResults
              .map((result) => vectorItemMetadata(result.item).regionClass)
              .filter(isRecipeSemanticRegionClass)
          ),
        ],
        topScore: regionResults[0]?.score,
      });
    } catch (err: unknown) {
      samples.push({
        query: sampleQuery.query,
        matched: false,
        topK,
        matchedRegionIds: [],
        matchedRecipeIds: [],
        matchedRegionClasses: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return samples;
}

function defaultGenerationTestSampleQueries(
  entries: RecipeRegionSourceEntry[]
): RecipeRegionGenerationTestSampleQuery[] {
  const entry = entries.find(
    (candidate) => compactString(candidate.lifecycle).toLowerCase() === 'active'
  );
  if (!entry) {
    return [];
  }
  return [
    {
      query: [
        compactString(entry.title),
        compactString(entry.trigger),
        compactString(entry.description),
      ]
        .filter(Boolean)
        .join(' '),
      filter: { recipeId: entry.id },
      topK: 5,
    },
  ];
}

function vectorItemMetadata(item: Record<string, unknown>): Record<string, unknown> {
  return parseRecord(item.metadata);
}

function vectorItemId(item: Record<string, unknown>): string {
  return compactString(item.id);
}

function isRecipeSemanticRegionClass(value: unknown): value is RecipeSemanticRegionClass {
  return (
    typeof value === 'string' &&
    (RECIPE_SEMANTIC_REGION_CLASSES as readonly string[]).includes(value)
  );
}

export function parseRecipeIdFromRegionVectorId(id: string): string | null {
  if (!id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(RECIPE_REGION_VECTOR_ID_PREFIX.length);
  for (const regionClass of RECIPE_SEMANTIC_REGION_CLASSES) {
    const marker = `_${regionClass}_`;
    const markerIndex = rest.lastIndexOf(marker);
    if (markerIndex > 0) {
      return rest.slice(0, markerIndex);
    }
  }
  return null;
}

import { createHash } from 'node:crypto';
import type { VectorStore } from '../../infrastructure/vector/VectorStore.js';
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
}

export interface RecipeRegionSyncResult {
  status: RecipeRegionSyncStatus;
  scanned: number;
  generated: number;
  embedded: number;
  upserted: number;
  removed: number;
  skipped: number;
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

interface NormalizedContent {
  pattern: string;
  markdown: string;
  rationale: string;
  verification: string;
}

interface NormalizedReasoning {
  whyStandard: string;
  sources: string[];
}

interface RecipeRegionSourceSnapshot {
  id: string;
  title: string;
  trigger: string;
  description: string;
  lifecycle: string;
  language: string;
  dimensionId: string;
  kind: string;
  knowledgeType: string;
  tags: string[];
  whenClause: string;
  doClause: string;
  dontClause: string;
  moduleName: string;
  sourceFile: string;
  content: Pick<NormalizedContent, 'pattern' | 'rationale' | 'verification'>;
  reasoning: NormalizedReasoning;
  sourceRefs: string[];
  contentHash: string;
  updatedAt: number | string | null;
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

function normalizeContent(content: unknown): NormalizedContent {
  const record = parseRecord(content);
  const verificationRecord = parseRecord(record.verification);
  return {
    pattern: compactString(record.pattern),
    markdown: compactString(record.markdown),
    rationale: compactString(record.rationale),
    verification: [
      compactString(verificationRecord.method),
      compactString(verificationRecord.expected_result),
      compactString(verificationRecord.test_code),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function normalizeReasoning(reasoning: unknown): NormalizedReasoning {
  const record = parseRecord(reasoning);
  return {
    whyStandard: compactString(record.whyStandard),
    sources: compactStringArray(record.sources),
  };
}

function clipRegionText(value: string, maxChars: number): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars).trim();
}

function section(title: string, value: string): string {
  return value ? `${title}: ${value}` : '';
}

function isGenericRegionContent(value: string): boolean {
  const semanticText = value
    .split('\n')
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      return separatorIndex >= 0 ? line.slice(separatorIndex + 1) : line;
    })
    .join(' ')
    .trim()
    .toLowerCase();
  return ['', '-', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'todo', 'tbd'].includes(
    semanticText
  );
}

function regionContentFor(
  entry: RecipeRegionSourceEntry,
  regionClass: RecipeSemanticRegionClass,
  content: NormalizedContent,
  reasoning: NormalizedReasoning,
  sourceRefs: string[]
): string {
  switch (regionClass) {
    case 'identity':
      return [
        section('Title', compactString(entry.title)),
        section('Trigger', compactString(entry.trigger)),
        section('Description', compactString(entry.description)),
        section('Dimension', compactString(entry.dimensionId)),
        section('Kind', compactString(entry.kind)),
        section('Knowledge type', compactString(entry.knowledgeType)),
      ]
        .filter(Boolean)
        .join('\n');
    case 'applicability':
      return [
        section('When', compactString(entry.whenClause)),
        section('Scenario', compactString(entry.description)),
      ]
        .filter(Boolean)
        .join('\n');
    case 'patternPurpose':
      return [
        section('Do', compactString(entry.doClause)),
        section('Purpose', content.rationale || reasoning.whyStandard),
      ]
        .filter(Boolean)
        .join('\n');
    case 'architectureConvention':
      return [
        section('Convention', content.pattern),
        section('Architecture rule', compactString(entry.doClause)),
        section('Boundary', compactString(entry.dontClause)),
      ]
        .filter(Boolean)
        .join('\n');
    case 'integrationBoundary':
      return [
        section('Sources', sourceRefs.join('\n')),
        section('Module', compactString(entry.moduleName)),
        section('Source file', compactString(entry.sourceFile)),
      ]
        .filter(Boolean)
        .join('\n');
    case 'qualityConcern':
      return [
        section('Quality tags', qualityTags(entry.tags).join(', ')),
        section('Verification', content.verification),
      ]
        .filter(Boolean)
        .join('\n');
    case 'negativeBoundary':
      return section('Do not', compactString(entry.dontClause));
    case 'rationale':
      return [
        section('Rationale', content.rationale),
        section('Why standard', reasoning.whyStandard),
      ]
        .filter(Boolean)
        .join('\n');
    case 'evidence':
      return [
        section('Reasoning sources', reasoning.sources.join('\n')),
        section('Bridge refs', sourceRefs.join('\n')),
      ]
        .filter(Boolean)
        .join('\n');
  }
}

function qualityTags(tags: unknown): string[] {
  const qualityWords = [
    'boundary',
    'compatibility',
    'concurrency',
    'error',
    'logging',
    'observability',
    'performance',
    'persistence',
    'quality',
    'retry',
    'safety',
    'security',
    'testing',
    'validation',
  ];
  return compactStringArray(tags).filter((tag) =>
    qualityWords.some((word) => tag.toLowerCase().includes(word))
  );
}

function anchorRegionContent(
  entry: RecipeRegionSourceEntry,
  regionClass: RecipeSemanticRegionClass,
  regionContent: string
): string {
  if (regionClass === 'identity') {
    return regionContent;
  }
  return [
    section('Recipe title', compactString(entry.title)),
    section('Recipe trigger', compactString(entry.trigger)),
    regionContent,
  ]
    .filter(Boolean)
    .join('\n');
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

function recipeRegionSourceSnapshot(
  entry: RecipeRegionSourceEntry,
  content: NormalizedContent,
  reasoning: NormalizedReasoning,
  sourceRefs: string[]
): RecipeRegionSourceSnapshot {
  return {
    id: entry.id,
    title: compactString(entry.title),
    trigger: compactString(entry.trigger),
    description: compactString(entry.description),
    lifecycle: compactString(entry.lifecycle),
    language: compactString(entry.language),
    dimensionId: compactString(entry.dimensionId),
    kind: compactString(entry.kind),
    knowledgeType: compactString(entry.knowledgeType),
    tags: compactStringArray(entry.tags),
    whenClause: compactString(entry.whenClause),
    doClause: compactString(entry.doClause),
    dontClause: compactString(entry.dontClause),
    moduleName: compactString(entry.moduleName),
    sourceFile: compactString(entry.sourceFile),
    content: {
      pattern: content.pattern,
      rationale: content.rationale,
      verification: content.verification,
    },
    reasoning,
    sourceRefs,
    contentHash: compactString(entry.contentHash),
    updatedAt: entry.updatedAt ?? null,
  };
}

function sourceHashFor(sourceSnapshot: RecipeRegionSourceSnapshot): string {
  return stableHash({
    schemaVersion: 1,
    sourceSnapshot,
  });
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
  const maxRegionChars = options.maxRegionChars ?? 1600;
  const content = normalizeContent(entry.content);
  const reasoning = normalizeReasoning(entry.reasoning);
  const bridge = normalizeBridge(options.sourceRefsBridge, reasoning.sources);
  const sourceRefs = bridge.refs.length > 0 ? bridge.refs : reasoning.sources;
  const sourceHash = sourceHashFor(
    recipeRegionSourceSnapshot(entry, content, reasoning, sourceRefs)
  );
  const tags = compactStringArray(entry.tags);
  const deprecated = compactString(entry.lifecycle).toLowerCase() === 'deprecated';
  const chunks: RecipeSemanticRegionChunk[] = [];

  if (deprecated) {
    return chunks;
  }

  for (const regionClass of RECIPE_SEMANTIC_REGION_CLASSES) {
    const rawContent = regionContentFor(entry, regionClass, content, reasoning, sourceRefs);
    const clippedRawContent = clipRegionText(rawContent, maxRegionChars);
    if (!clippedRawContent) {
      continue;
    }
    if (regionClass !== 'identity' && isGenericRegionContent(clippedRawContent)) {
      continue;
    }
    const regionContent =
      regionClass === 'identity'
        ? clippedRawContent
        : clipRegionText(
            anchorRegionContent(entry, regionClass, clippedRawContent),
            maxRegionChars
          );

    const regionHash = stableHash({ recipeId: entry.id, regionClass, regionContent });
    const contentHash = stableHash({ regionContent });
    const metadata: RecipeRegionVectorMetadata = {
      type: RECIPE_SEMANTIC_REGION_METADATA_TYPE,
      recipeId: entry.id,
      regionClass,
      regionHash,
      contentHash,
      sourceHash,
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

    chunks.push({
      id: recipeRegionVectorId(entry.id, regionClass, regionHash),
      content: regionContent,
      metadata,
    });
  }

  return chunks;
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

  result.generated = chunks.length;
  result.generatedMetadata = chunks.map((chunk) => chunk.metadata);

  if (options.removeStale !== false) {
    try {
      const recipeIds = new Set(entries.map((entry) => entry.id));
      const vectorIds = await vectorStore.listIds();
      for (const id of vectorIds) {
        if (!id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)) {
          continue;
        }
        const recipeId = parseRecipeIdFromRegionVectorId(id);
        if (recipeId && recipeIds.has(recipeId) && !expectedIds.has(id)) {
          await vectorStore.remove(id);
          result.removed++;
        }
      }
    } catch (err: unknown) {
      result.errors.push(
        `stale-cleanup-failed:${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (chunks.length === 0) {
    return result;
  }

  if (!embedProvider) {
    result.status = 'degraded';
    result.degradedReason = 'embed-provider-unavailable';
    result.skipped = chunks.length;
    return result;
  }

  try {
    const embedResult = await embedProvider.embed(chunks.map((chunk) => chunk.content));
    const vectors = Array.isArray(embedResult[0])
      ? (embedResult as number[][])
      : [embedResult as number[]];
    const items = chunks.map((chunk, index) => ({
      id: chunk.id,
      content: chunk.content,
      vector: vectors[index] ?? [],
      metadata: { ...chunk.metadata },
    }));
    await vectorStore.batchUpsert(items);
    result.embedded = vectors.length;
    result.upserted = items.length;
  } catch (err: unknown) {
    result.status = 'failed';
    result.errors.push(`embed-upsert-failed:${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
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
      const embedResult = await embedProvider.embed(sampleQuery.query);
      const queryVector = Array.isArray(embedResult[0])
        ? (embedResult[0] as number[])
        : (embedResult as number[]);
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

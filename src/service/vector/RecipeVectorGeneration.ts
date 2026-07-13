import { createHash, randomUUID } from 'node:crypto';
import type { VectorStore } from '../../infrastructure/vector/VectorStore.js';
import { RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION } from '../knowledge/RecipeRetrieval.js';
import { asEmbeddingPort, type EmbeddingCapabilityDescriptor } from './EmbeddingPort.js';
import {
  buildRecipeSemanticRegionChunks,
  parseRecipeIdFromRegionVectorId,
  RECIPE_REGION_VECTOR_ID_PREFIX,
  RECIPE_REGION_VECTOR_SCHEMA_VERSION,
  type RecipeRegionSourceEntry,
  syncRecipeSemanticRegionVectors,
} from './RecipeRegionVectorIndex.js';
import type { EmbedProvider } from './VectorService.js';

export interface RecipeVectorGenerationManifestIdentity {
  projectionSchemaVersion: string;
  vectorSchemaVersion: number;
  provider: string;
  model: string;
  dimension: number;
  formatProfile: EmbeddingCapabilityDescriptor['formatProfile'];
  normalization: EmbeddingCapabilityDescriptor['normalization'];
  corpusHash: string;
}

export interface RecipeVectorGenerationManifest extends RecipeVectorGenerationManifestIdentity {
  manifestHash: string;
  recipeCount: number;
  documentCount: number;
  expectedIds: string[];
}

export interface RecipeVectorGenerationInspection {
  healthy: boolean;
  expectedCount: number;
  presentCount: number;
  missingIds: string[];
  orphanIds: string[];
  staleIds: string[];
  duplicateIds: string[];
  partialIds: string[];
  hashMismatchIds: string[];
  dimensionMismatchIds: string[];
}

export interface RecipeVectorGenerationRoute {
  generationId: string;
  manifestHash: string;
}

export interface RecipeVectorGenerationRouter {
  readActive(): Promise<RecipeVectorGenerationRoute | null>;
  /** Compare-and-swap is the atomic visibility boundary. */
  activate(
    next: RecipeVectorGenerationRoute,
    expectedPreviousGenerationId: string | null
  ): Promise<boolean>;
}

export interface RecipeVectorGenerationStoreFactory {
  createShadow(generationId: string): Promise<VectorStore>;
  open(generationId: string): Promise<VectorStore>;
  writeManifest(generationId: string, manifest: RecipeVectorGenerationManifest): Promise<void>;
  removeGeneration?(generationId: string): Promise<void>;
}

export interface RecipeVectorGenerationBuildResult {
  status: 'activated' | 'already-active' | 'failed';
  generationId: string | null;
  previous: RecipeVectorGenerationRoute | null;
  active: RecipeVectorGenerationRoute | null;
  manifest: RecipeVectorGenerationManifest | null;
  inspection: RecipeVectorGenerationInspection | null;
  errors: string[];
}

export class RecipeVectorGenerationManager {
  readonly #factory: RecipeVectorGenerationStoreFactory;
  readonly #router: RecipeVectorGenerationRouter;

  constructor(factory: RecipeVectorGenerationStoreFactory, router: RecipeVectorGenerationRouter) {
    this.#factory = factory;
    this.#router = router;
  }

  async buildAndActivate(
    entries: RecipeRegionSourceEntry[],
    embedProvider: EmbedProvider
  ): Promise<RecipeVectorGenerationBuildResult> {
    const previous = await this.#router.readActive();
    let manifest: RecipeVectorGenerationManifest | null = null;
    let generationId: string | null = null;
    let inspection: RecipeVectorGenerationInspection | null = null;
    const errors: string[] = [];

    try {
      const descriptor = asEmbeddingPort(embedProvider).describeCapabilities();
      if (!descriptor.dimension || descriptor.dimension <= 0) {
        throw new Error('generation-manifest-dimension-missing');
      }
      if (!descriptor.provider || !descriptor.model) {
        throw new Error('generation-manifest-provider-model-missing');
      }
      manifest = buildRecipeVectorGenerationManifest(entries, descriptor);
      if (previous?.manifestHash === manifest.manifestHash) {
        const activeStore = await this.#factory.open(previous.generationId);
        inspection = await inspectRecipeVectorGeneration(
          activeStore,
          entries,
          descriptor.dimension
        );
        if (inspection.healthy) {
          return {
            status: 'already-active',
            generationId: previous.generationId,
            previous,
            active: previous,
            manifest,
            inspection,
            errors,
          };
        }
      }

      generationId = `${manifest.manifestHash.slice(0, 24)}-${randomUUID()}`;
      const shadow = await this.#factory.createShadow(generationId);
      const sync = await syncRecipeSemanticRegionVectors(shadow, embedProvider, entries, {
        force: true,
        maintenanceScope: {
          kind: 'authoritative-corpus',
          nonDeprecatedRecipeIds: entries.map((entry) => entry.id),
        },
        removeStale: true,
      });
      errors.push(...sync.errors);
      if (sync.status !== 'completed') {
        throw new Error(sync.degradedReason ?? 'shadow-generation-incomplete');
      }

      inspection = await inspectRecipeVectorGeneration(shadow, entries, descriptor.dimension);
      if (!inspection.healthy) {
        throw new Error('shadow-generation-verification-failed');
      }

      await this.#factory.writeManifest(generationId, manifest);
      const next = { generationId, manifestHash: manifest.manifestHash };
      const activated = await this.#router.activate(next, previous?.generationId ?? null);
      if (!activated) {
        throw new Error('active-generation-compare-and-swap-failed');
      }
      return {
        status: 'activated',
        generationId,
        previous,
        active: next,
        manifest,
        inspection,
        errors,
      };
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (generationId && this.#factory.removeGeneration) {
        try {
          await this.#factory.removeGeneration(generationId);
        } catch (cleanupError: unknown) {
          errors.push(
            `shadow-cleanup-failed:${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          );
        }
      }
      return {
        status: 'failed',
        generationId,
        previous,
        active: await this.#router.readActive(),
        manifest,
        inspection,
        errors,
      };
    }
  }

  async rollback(target: RecipeVectorGenerationRoute): Promise<boolean> {
    const current = await this.#router.readActive();
    if (!current || current.generationId === target.generationId) {
      return current?.generationId === target.generationId;
    }
    await this.#factory.open(target.generationId);
    return this.#router.activate(target, current.generationId);
  }
}

export function buildRecipeVectorGenerationManifest(
  entries: RecipeRegionSourceEntry[],
  descriptor: EmbeddingCapabilityDescriptor
): RecipeVectorGenerationManifest {
  if (!descriptor.dimension || descriptor.dimension <= 0) {
    throw new Error('generation-manifest-dimension-missing');
  }
  if (!descriptor.provider || !descriptor.model) {
    throw new Error('generation-manifest-provider-model-missing');
  }
  const sortedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const chunkSets = sortedEntries.map((entry) => buildRecipeSemanticRegionChunks(entry));
  const expectedIds = chunkSets.flatMap((chunks) => chunks.map((chunk) => chunk.id));
  const identity: RecipeVectorGenerationManifestIdentity = {
    projectionSchemaVersion: RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION,
    vectorSchemaVersion: RECIPE_REGION_VECTOR_SCHEMA_VERSION,
    provider: descriptor.provider,
    model: descriptor.model ?? '',
    dimension: descriptor.dimension,
    formatProfile: descriptor.formatProfile,
    normalization: descriptor.normalization,
    corpusHash: stableHash(
      chunkSets.map((chunks, index) => ({
        recipeId: sortedEntries[index].id,
        sourceContentHash: chunks[0]?.metadata.sourceContentHash ?? '',
        profileHash: chunks[0]?.metadata.profileHash ?? '',
        documentSetHash: chunks[0]?.metadata.documentSetHash ?? '',
      }))
    ),
  };
  return {
    ...identity,
    manifestHash: stableHash(identity),
    recipeCount: sortedEntries.length,
    documentCount: expectedIds.length,
    expectedIds: [...expectedIds].sort(),
  };
}

export async function inspectRecipeVectorGeneration(
  store: VectorStore,
  entries: RecipeRegionSourceEntry[],
  expectedDimension: number | null
): Promise<RecipeVectorGenerationInspection> {
  const expectedChunks = entries.flatMap((entry) => buildRecipeSemanticRegionChunks(entry));
  const expectedById = new Map(expectedChunks.map((chunk) => [chunk.id, chunk]));
  const listedIds = (await store.listIds()).filter((id) =>
    id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)
  );
  const frequencies = new Map<string, number>();
  for (const id of listedIds) {
    frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
  }
  const presentIds = new Set(listedIds);
  const duplicateIds = [...frequencies]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const missingIds = [...expectedById.keys()].filter((id) => !presentIds.has(id)).sort();
  const authoritativeRecipeIds = new Set(entries.map((entry) => entry.id));
  const unexpectedIds = [...presentIds].filter((id) => !expectedById.has(id));
  const orphanIds = unexpectedIds
    .filter((id) => {
      const recipeId = parseRecipeIdFromRegionVectorId(id);
      return !recipeId || !authoritativeRecipeIds.has(recipeId);
    })
    .sort();
  const staleIds = unexpectedIds.filter((id) => !orphanIds.includes(id)).sort();
  const partialIds: string[] = [];
  const hashMismatchIds: string[] = [];
  const dimensionMismatchIds: string[] = [];

  for (const [id, expected] of expectedById) {
    if (!presentIds.has(id)) {
      continue;
    }
    const stored = await store.getById(id);
    if (!stored) {
      partialIds.push(id);
      continue;
    }
    const metadata = record(stored.metadata);
    if (
      stored.content !== expected.content ||
      metadata.contentHash !== expected.metadata.contentHash ||
      metadata.documentSetHash !== expected.metadata.documentSetHash ||
      metadata.sourceContentHash !== expected.metadata.sourceContentHash ||
      metadata.documentRole !== expected.metadata.documentRole
    ) {
      hashMismatchIds.push(id);
    }
    if (
      expectedDimension !== null &&
      (!Array.isArray(stored.vector) || stored.vector.length !== expectedDimension)
    ) {
      dimensionMismatchIds.push(id);
    }
  }

  const healthy =
    missingIds.length === 0 &&
    orphanIds.length === 0 &&
    staleIds.length === 0 &&
    duplicateIds.length === 0 &&
    partialIds.length === 0 &&
    hashMismatchIds.length === 0 &&
    dimensionMismatchIds.length === 0;
  return {
    healthy,
    expectedCount: expectedById.size,
    presentCount: presentIds.size,
    missingIds,
    orphanIds,
    staleIds,
    duplicateIds,
    partialIds: partialIds.sort(),
    hashMismatchIds: hashMismatchIds.sort(),
    dimensionMismatchIds: dimensionMismatchIds.sort(),
  };
}

/** Provider-independent exact removal for delete/deprecate flows. */
export async function removeRecipeVectorsByTruth(
  store: Pick<VectorStore, 'listIds' | 'remove'>,
  recipeId: string
): Promise<{ removed: number; errors: string[] }> {
  let removed = 0;
  const errors: string[] = [];
  const ids = await store.listIds();
  for (const id of ids) {
    const isLegacyEntry = id === `entry_${recipeId}`;
    const isCanonical =
      id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX) &&
      parseRecipeIdFromRegionVectorId(id) === recipeId;
    if (!isLegacyEntry && !isCanonical) {
      continue;
    }
    try {
      await store.remove(id);
      removed++;
    } catch (error: unknown) {
      errors.push(`${id}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, errors };
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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

export const RECIPE_VECTOR_GENERATION_MANIFEST_VERSION = 1 as const;

export type RecipeVectorGenerationStatus = 'building' | 'ready' | 'failed' | 'retired';
export type RecipeVectorGenerationSource = 'incremental' | 'full-build' | 'migration';

export interface RecipeVectorGenerationManifestIdentity {
  manifestVersion: typeof RECIPE_VECTOR_GENERATION_MANIFEST_VERSION;
  projectionSchemaVersion: string;
  vectorSchemaVersion: number;
  provider: string;
  model: string;
  dimension: number;
  formatProfile: EmbeddingCapabilityDescriptor['formatProfile'];
  normalization: EmbeddingCapabilityDescriptor['normalization'];
  corpusFingerprint: string;
  /** @deprecated Use corpusFingerprint. Retained for manifest readers from the first generation. */
  corpusHash: string;
}

export interface RecipeVectorGenerationManifest extends RecipeVectorGenerationManifestIdentity {
  generationId: string;
  status: RecipeVectorGenerationStatus;
  createdFrom: RecipeVectorGenerationSource;
  manifestHash: string;
  recipeCount: number;
  documentCount: number;
  expectedIds: string[];
  expectedIdsByRecipe: Record<string, string[]>;
}

export interface RecipeVectorGenerationInspection {
  healthy: boolean;
  expectedCount: number;
  presentCount: number;
  missingIds: string[];
  orphanIds: string[];
  staleIds: string[];
  staleGenerationIds: string[];
  duplicateIds: string[];
  partialIds: string[];
  hashMismatchIds: string[];
  dimensionMismatchIds: string[];
}

export interface RecipeVectorGenerationInspectionOptions {
  dimension: number | null;
  generationId?: string;
  manifestHash?: string;
  provider?: string;
  model?: string;
  projectionSchemaVersion?: string;
}

export interface RecipeVectorGenerationBuildOptions {
  projectionSchemaVersion?: string;
  createdFrom?: RecipeVectorGenerationSource;
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
  readManifest?(generationId: string): Promise<RecipeVectorGenerationManifest | null>;
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
    embedProvider: EmbedProvider,
    options: RecipeVectorGenerationBuildOptions = {}
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
      const projectionSchemaVersion =
        options.projectionSchemaVersion ?? RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION;
      const createdFrom = options.createdFrom ?? 'full-build';
      const draft = buildRecipeVectorGenerationManifest(entries, descriptor, {
        status: 'building',
        createdFrom,
        projectionSchemaVersion,
      });
      if (previous?.manifestHash === draft.manifestHash) {
        const activeStore = await this.#factory.open(previous.generationId);
        inspection = await inspectRecipeVectorGeneration(activeStore, entries, {
          dimension: descriptor.dimension,
          generationId: previous.generationId,
          manifestHash: previous.manifestHash,
          provider: descriptor.provider,
          model: descriptor.model,
          projectionSchemaVersion,
        });
        if (inspection.healthy) {
          const storedManifest = await this.#factory.readManifest?.(previous.generationId);
          manifest =
            storedManifest?.manifestHash === previous.manifestHash &&
            storedManifest.status === 'ready'
              ? storedManifest
              : { ...draft, generationId: previous.generationId, status: 'ready' };
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

      generationId = draft.generationId;
      manifest = draft;
      const shadow = await this.#factory.createShadow(generationId);
      await this.#factory.writeManifest(generationId, manifest);
      const sync = await syncRecipeSemanticRegionVectors(shadow, embedProvider, entries, {
        force: true,
        projectionSchemaVersion,
        generationIdentity: {
          generationId,
          manifestHash: manifest.manifestHash,
          provider: manifest.provider,
          model: manifest.model,
          dimension: manifest.dimension,
          formatProfile: manifest.formatProfile,
          normalization: manifest.normalization,
          corpusFingerprint: manifest.corpusFingerprint,
        },
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

      inspection = await inspectRecipeVectorGeneration(shadow, entries, {
        dimension: descriptor.dimension,
        generationId,
        manifestHash: manifest.manifestHash,
        provider: descriptor.provider,
        model: descriptor.model,
        projectionSchemaVersion,
      });
      if (!inspection.healthy) {
        throw new Error('shadow-generation-verification-failed');
      }

      manifest = { ...manifest, status: 'ready' };
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
      if (manifest && generationId) {
        manifest = { ...manifest, status: 'failed' };
        try {
          await this.#factory.writeManifest(generationId, manifest);
        } catch (manifestError: unknown) {
          errors.push(
            `failed-manifest-write:${manifestError instanceof Error ? manifestError.message : String(manifestError)}`
          );
        }
      }
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
  descriptor: EmbeddingCapabilityDescriptor,
  options: {
    generationId?: string;
    status?: RecipeVectorGenerationStatus;
    createdFrom?: RecipeVectorGenerationSource;
    projectionSchemaVersion?: string;
  } = {}
): RecipeVectorGenerationManifest {
  if (!descriptor.dimension || descriptor.dimension <= 0) {
    throw new Error('generation-manifest-dimension-missing');
  }
  if (!descriptor.provider || !descriptor.model) {
    throw new Error('generation-manifest-provider-model-missing');
  }
  const projectionSchemaVersion =
    options.projectionSchemaVersion ?? RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION;
  const sortedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const chunkSets = sortedEntries.map((entry) =>
    buildRecipeSemanticRegionChunks(entry, { projectionSchemaVersion })
  );
  const expectedIdsByRecipe = Object.fromEntries(
    sortedEntries.map((entry, index) => [
      entry.id,
      chunkSets[index].map((chunk) => chunk.id).sort(),
    ])
  );
  const expectedIds = Object.values(expectedIdsByRecipe).flat().sort();
  const corpusFingerprint = stableHash(
    chunkSets.map((chunks, index) => ({
      recipeId: sortedEntries[index].id,
      sourceContentHash: chunks[0]?.metadata.sourceContentHash ?? '',
      profileHash: chunks[0]?.metadata.profileHash ?? '',
      documentSetHash: chunks[0]?.metadata.documentSetHash ?? '',
    }))
  );
  const identity: RecipeVectorGenerationManifestIdentity = {
    manifestVersion: RECIPE_VECTOR_GENERATION_MANIFEST_VERSION,
    projectionSchemaVersion,
    vectorSchemaVersion: RECIPE_REGION_VECTOR_SCHEMA_VERSION,
    provider: descriptor.provider,
    model: descriptor.model ?? '',
    dimension: descriptor.dimension,
    formatProfile: descriptor.formatProfile,
    normalization: descriptor.normalization,
    corpusFingerprint,
    corpusHash: corpusFingerprint,
  };
  const manifestHash = stableHash(identity);
  return {
    ...identity,
    generationId: options.generationId?.trim() || `${manifestHash.slice(0, 24)}-${randomUUID()}`,
    status: options.status ?? 'ready',
    createdFrom: options.createdFrom ?? 'full-build',
    manifestHash,
    recipeCount: sortedEntries.length,
    documentCount: expectedIds.length,
    expectedIds,
    expectedIdsByRecipe,
  };
}

export async function inspectRecipeVectorGeneration(
  store: VectorStore,
  entries: RecipeRegionSourceEntry[],
  expectation: number | null | RecipeVectorGenerationInspectionOptions
): Promise<RecipeVectorGenerationInspection> {
  const options: RecipeVectorGenerationInspectionOptions =
    typeof expectation === 'object' && expectation !== null
      ? expectation
      : { dimension: expectation };
  const projectionSchemaVersion =
    options.projectionSchemaVersion ?? RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION;
  const expectedChunks = entries.flatMap((entry) =>
    buildRecipeSemanticRegionChunks(entry, { projectionSchemaVersion })
  );
  const expectedById = new Map(expectedChunks.map((chunk) => [chunk.id, chunk]));
  const listedIds = (await store.listIds()).filter((id) =>
    id.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)
  );
  const frequencies = new Map<string, number>();
  for (const id of listedIds) {
    frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
  }
  const presentIds = new Set(listedIds);
  const storedById = new Map<string, Record<string, unknown> | null>();
  for (const id of presentIds) {
    storedById.set(id, await store.getById(id));
  }

  const duplicateIds = new Set([...frequencies].filter(([, count]) => count > 1).map(([id]) => id));
  const logicalGroups = new Map<string, string[]>();
  for (const [id, stored] of storedById) {
    if (!stored) {
      continue;
    }
    const metadata = record(stored.metadata);
    const recipeId = text(metadata.recipeId);
    const role = text(metadata.documentRole);
    const schema = text(metadata.projectionSchemaVersion);
    const contentHash = text(metadata.contentHash);
    if (!recipeId || !role || !schema || !contentHash) {
      continue;
    }
    const key = `${recipeId}\u0000${schema}\u0000${role}\u0000${contentHash}`;
    const ids = logicalGroups.get(key) ?? [];
    ids.push(id);
    logicalGroups.set(key, ids);
  }
  for (const ids of logicalGroups.values()) {
    if (ids.length < 2) {
      continue;
    }
    const canonical = ids.find((id) => expectedById.has(id)) ?? ids[0];
    for (const id of ids) {
      if (id !== canonical) {
        duplicateIds.add(id);
      }
    }
  }

  const missingIds = [...expectedById.keys()].filter((id) => !presentIds.has(id)).sort();
  const authoritativeRecipeIds = new Set(entries.map((entry) => entry.id));
  const unexpectedIds = [...presentIds].filter((id) => !expectedById.has(id));
  const orphanIds = unexpectedIds
    .filter((id) => {
      const recipeId = parseRecipeIdFromRegionVectorId(id);
      return !recipeId || !authoritativeRecipeIds.has(recipeId);
    })
    .sort();
  const orphanSet = new Set(orphanIds);
  const staleIds = unexpectedIds.filter((id) => !orphanSet.has(id)).sort();
  const partialIds: string[] = [];
  const hashMismatchIds: string[] = [];
  const dimensionMismatchIds: string[] = [];

  for (const [id, expected] of expectedById) {
    if (!presentIds.has(id)) {
      continue;
    }
    const stored = storedById.get(id) ?? null;
    if (!stored) {
      partialIds.push(id);
      continue;
    }
    const metadata = record(stored.metadata);
    if (
      typeof stored.content !== 'string' ||
      !Array.isArray(stored.vector) ||
      Object.keys(metadata).length === 0
    ) {
      partialIds.push(id);
    }
    if (
      stored.content !== expected.content ||
      metadata.contentHash !== expected.metadata.contentHash ||
      metadata.documentSetHash !== expected.metadata.documentSetHash ||
      metadata.sourceContentHash !== expected.metadata.sourceContentHash ||
      metadata.documentRole !== expected.metadata.documentRole ||
      metadata.projectionSchemaVersion !== expected.metadata.projectionSchemaVersion
    ) {
      hashMismatchIds.push(id);
    }
    if (
      options.dimension !== null &&
      (!Array.isArray(stored.vector) || stored.vector.length !== options.dimension)
    ) {
      dimensionMismatchIds.push(id);
    }
  }

  const staleGenerationIds: string[] = [];
  const hasGenerationExpectation = Boolean(
    options.generationId || options.manifestHash || options.provider || options.model
  );
  if (hasGenerationExpectation) {
    for (const [id, stored] of storedById) {
      if (!stored) {
        continue;
      }
      const metadata = record(stored.metadata);
      const recipeId = text(metadata.recipeId) || parseRecipeIdFromRegionVectorId(id);
      if (!recipeId || !authoritativeRecipeIds.has(recipeId)) {
        continue;
      }
      if (
        (options.generationId && metadata.generationId !== options.generationId) ||
        (options.manifestHash && metadata.generationManifestHash !== options.manifestHash) ||
        (options.provider && metadata.generationProvider !== options.provider) ||
        (options.model && metadata.generationModel !== options.model) ||
        metadata.projectionSchemaVersion !== projectionSchemaVersion
      ) {
        staleGenerationIds.push(id);
      }
    }
  }

  const sortedDuplicateIds = [...duplicateIds].sort();
  const sortedStaleGenerationIds = [...new Set(staleGenerationIds)].sort();
  const healthy =
    missingIds.length === 0 &&
    orphanIds.length === 0 &&
    staleIds.length === 0 &&
    sortedStaleGenerationIds.length === 0 &&
    sortedDuplicateIds.length === 0 &&
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
    staleGenerationIds: sortedStaleGenerationIds,
    duplicateIds: sortedDuplicateIds,
    partialIds: [...new Set(partialIds)].sort(),
    hashMismatchIds: [...new Set(hashMismatchIds)].sort(),
    dimensionMismatchIds: [...new Set(dimensionMismatchIds)].sort(),
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

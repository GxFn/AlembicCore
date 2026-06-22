/**
 * RecipeFreshnessService — RG7 create/evolve 后的单 Recipe 新鲜度刷新原语。
 *
 * 它把 source_refs 桥接刷新和向量刷新放在一个确定性 Core facade 中，
 * 外层 Plugin 只负责在 create/evolve 成功后传入受影响的 Recipe entry。
 */

import Logger from '../../infrastructure/logging/Logger.js';
import type { RecipeSourceRefRepositoryImpl } from '../../repository/sourceref/RecipeSourceRefRepository.js';
import type {
  RecipeRegionSourceEntry,
  RecipeRegionSyncOptions,
  RecipeRegionSyncResult,
  SourceRefsBridgeStatus,
} from '../vector/RecipeRegionVectorIndex.js';
import type { VectorAvailability } from '../vector/VectorService.js';
import type { ReconcileReport, SourceRefReconciler } from './SourceRefReconciler.js';

export interface RecipeFreshnessEntry extends RecipeRegionSourceEntry {
  id: string;
}

export interface RecipeFreshnessSourceRefSummary extends ReconcileReport {
  status: 'completed' | 'failed' | 'table-inaccessible';
  activeRefs: string[];
  staleRefs: string[];
  allRefs: string[];
  errors: string[];
}

export interface RecipeFreshnessVectorSummary {
  status: 'completed' | 'degraded' | 'failed' | 'skipped' | 'not-configured';
  availability: VectorAvailability | null;
  entrySyncStatus: 'completed' | 'failed' | 'skipped';
  regionSyncStatus: RecipeRegionSyncResult['status'] | 'skipped';
  regionSync?: RecipeRegionSyncResult;
  degradedReason?: string;
  errors: string[];
}

export interface RecipeFreshnessRecipeResult {
  recipeId: string;
  sourceRefs: RecipeFreshnessSourceRefSummary;
  sourceRefsBridge: {
    status: SourceRefsBridgeStatus;
    refs: string[];
  };
  vector: RecipeFreshnessVectorSummary;
  retrievalMayBeStale: boolean;
  errors: string[];
}

export interface RecipeFreshnessRefreshResult {
  status: 'completed' | 'degraded' | 'failed';
  requested: number;
  processed: number;
  recipes: RecipeFreshnessRecipeResult[];
  retrievalMayBeStale: boolean;
  errors: string[];
}

export interface RecipeFreshnessVectorService {
  getAvailability(): Promise<VectorAvailability>;
  syncEntry(entry: { id: string; title: string; content: unknown; kind?: string }): Promise<void>;
  syncRecipeSemanticRegions(
    entries: RecipeRegionSourceEntry[],
    opts?: RecipeRegionSyncOptions
  ): Promise<RecipeRegionSyncResult>;
}

export interface RecipeFreshnessServiceDeps {
  sourceRefReconciler: Pick<SourceRefReconciler, 'reconcileRecipeSourceRefs'>;
  sourceRefRepository: Pick<RecipeSourceRefRepositoryImpl, 'findByRecipeId' | 'isAccessible'>;
  vectorService?: RecipeFreshnessVectorService | null;
}

export interface RefreshRecipeFreshnessOptions {
  forceSourceRefRefresh?: boolean;
  maxRecipes?: number;
  refreshVectors?: boolean;
}

const DEFAULT_MAX_RECIPES = 25;

export class RecipeFreshnessService {
  readonly #sourceRefReconciler: Pick<SourceRefReconciler, 'reconcileRecipeSourceRefs'>;
  readonly #sourceRefRepo: Pick<RecipeSourceRefRepositoryImpl, 'findByRecipeId' | 'isAccessible'>;
  readonly #vectorService: RecipeFreshnessVectorService | null;
  readonly #logger = Logger.getInstance();

  constructor(deps: RecipeFreshnessServiceDeps) {
    this.#sourceRefReconciler = deps.sourceRefReconciler;
    this.#sourceRefRepo = deps.sourceRefRepository;
    this.#vectorService = deps.vectorService ?? null;
  }

  async refreshRecipe(
    entry: RecipeFreshnessEntry,
    opts: Omit<RefreshRecipeFreshnessOptions, 'maxRecipes'> = {}
  ): Promise<RecipeFreshnessRecipeResult> {
    const sourceRefs = await this.#refreshSourceRefs(entry, opts);
    const sourceRefsBridge = buildSourceRefsBridge(sourceRefs);
    const vector = await this.#refreshVector(entry, sourceRefsBridge, opts);
    const errors = [...sourceRefsErrors(sourceRefs), ...vector.errors];
    const retrievalMayBeStale =
      sourceRefs.status !== 'completed' ||
      vector.status !== 'completed' ||
      vector.entrySyncStatus !== 'completed' ||
      vector.regionSyncStatus !== 'completed';

    return {
      errors,
      recipeId: entry.id,
      retrievalMayBeStale,
      sourceRefs,
      sourceRefsBridge,
      vector,
    };
  }

  async refreshRecipes(
    entries: readonly RecipeFreshnessEntry[],
    opts: RefreshRecipeFreshnessOptions = {}
  ): Promise<RecipeFreshnessRefreshResult> {
    const maxRecipes = opts.maxRecipes ?? DEFAULT_MAX_RECIPES;
    if (entries.length > maxRecipes) {
      const message = `Recipe freshness refresh is bounded to ${maxRecipes} recipes per call; received ${entries.length}.`;
      this.#logger.warn('[RecipeFreshnessService] bounded refresh refused', {
        maxRecipes,
        requested: entries.length,
      });
      return {
        errors: [message],
        processed: 0,
        recipes: [],
        requested: entries.length,
        retrievalMayBeStale: true,
        status: 'failed',
      };
    }

    const recipes: RecipeFreshnessRecipeResult[] = [];
    for (const entry of entries) {
      recipes.push(await this.refreshRecipe(entry, opts));
    }

    const errors = recipes.flatMap((result) => result.errors);
    const retrievalMayBeStale = recipes.some((result) => result.retrievalMayBeStale);
    const status = errors.length > 0 ? 'failed' : retrievalMayBeStale ? 'degraded' : 'completed';

    this.#logger.info('[RecipeFreshnessService] refresh complete', {
      processed: recipes.length,
      requested: entries.length,
      retrievalMayBeStale,
      status,
    });

    return {
      errors,
      processed: recipes.length,
      recipes,
      requested: entries.length,
      retrievalMayBeStale,
      status,
    };
  }

  async #refreshSourceRefs(
    entry: RecipeFreshnessEntry,
    opts: Omit<RefreshRecipeFreshnessOptions, 'maxRecipes'>
  ): Promise<RecipeFreshnessSourceRefSummary> {
    if (!this.#sourceRefRepo.isAccessible()) {
      this.#logger.warn('[RecipeFreshnessService] recipe_source_refs table inaccessible', {
        recipeId: entry.id,
      });
      return emptySourceRefSummary('table-inaccessible');
    }

    try {
      const report = await this.#sourceRefReconciler.reconcileRecipeSourceRefs(entry, {
        force: opts.forceSourceRefRefresh ?? true,
      });
      const rows = this.#sourceRefRepo.findByRecipeId(entry.id);
      const errors = report.blockers ?? [];
      return {
        ...report,
        activeRefs: rows.filter((row) => row.status !== 'stale').map((row) => row.sourcePath),
        allRefs: rows.map((row) => row.sourcePath),
        errors,
        staleRefs: rows.filter((row) => row.status === 'stale').map((row) => row.sourcePath),
        status: (report.failed ?? 0) > 0 ? 'failed' : 'completed',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.warn('[RecipeFreshnessService] source_ref refresh failed', {
        error: message,
        recipeId: entry.id,
      });
      return {
        ...emptySourceRefSummary('failed'),
        errors: [message],
      };
    }
  }

  async #refreshVector(
    entry: RecipeFreshnessEntry,
    sourceRefsBridge: RecipeFreshnessRecipeResult['sourceRefsBridge'],
    opts: Omit<RefreshRecipeFreshnessOptions, 'maxRecipes'>
  ): Promise<RecipeFreshnessVectorSummary> {
    if (opts.refreshVectors === false) {
      return {
        availability: null,
        entrySyncStatus: 'skipped',
        errors: [],
        regionSyncStatus: 'skipped',
        status: 'skipped',
      };
    }

    if (!this.#vectorService) {
      return {
        availability: null,
        degradedReason: 'vector-service-not-configured',
        entrySyncStatus: 'skipped',
        errors: [],
        regionSyncStatus: 'skipped',
        status: 'not-configured',
      };
    }

    const availability = await this.#vectorService.getAvailability();
    if (!availability.available) {
      this.#logger.info('[RecipeFreshnessService] vector refresh skipped by availability', {
        reason: availability.reason,
        recipeId: entry.id,
        status: availability.status,
      });
      return {
        availability,
        degradedReason: availability.reason,
        entrySyncStatus: 'skipped',
        errors: [],
        regionSyncStatus: 'skipped',
        status: 'degraded',
      };
    }

    const errors: string[] = [];
    let entrySyncStatus: RecipeFreshnessVectorSummary['entrySyncStatus'] = 'completed';
    let regionSyncStatus: RecipeFreshnessVectorSummary['regionSyncStatus'] = 'skipped';
    let regionSync: RecipeRegionSyncResult | undefined;

    try {
      await this.#vectorService.syncEntry({
        content: entry.content,
        id: entry.id,
        kind: entry.kind,
        title: entry.title ?? '',
      });
    } catch (error) {
      entrySyncStatus = 'failed';
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      regionSync = await this.#vectorService.syncRecipeSemanticRegions([entry], {
        sourceRefsBridgeByRecipeId: { [entry.id]: sourceRefsBridge },
      });
      regionSyncStatus = regionSync.status;
      errors.push(...regionSync.errors);
    } catch (error) {
      regionSyncStatus = 'failed';
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const failed = entrySyncStatus === 'failed' || regionSyncStatus === 'failed';
    const degraded = regionSyncStatus === 'degraded';
    return {
      availability,
      degradedReason: degraded ? regionSync?.degradedReason : undefined,
      entrySyncStatus,
      errors,
      regionSync,
      regionSyncStatus,
      status: failed ? 'failed' : degraded ? 'degraded' : 'completed',
    };
  }
}

function emptySourceRefSummary(
  status: RecipeFreshnessSourceRefSummary['status']
): RecipeFreshnessSourceRefSummary {
  return {
    active: 0,
    activeRefs: [],
    allRefs: [],
    blockers: [],
    errors: [],
    failed: 0,
    inserted: 0,
    recipesProcessed: 0,
    skipped: 0,
    stale: 0,
    staleRefs: [],
    status,
  };
}

function buildSourceRefsBridge(sourceRefs: RecipeFreshnessSourceRefSummary): {
  status: SourceRefsBridgeStatus;
  refs: string[];
} {
  if (sourceRefs.activeRefs.length === 0) {
    return { refs: [], status: 'missing' };
  }
  if (sourceRefs.staleRefs.length > 0) {
    return { refs: sourceRefs.activeRefs, status: 'partial' };
  }
  return { refs: sourceRefs.activeRefs, status: 'active' };
}

function sourceRefsErrors(sourceRefs: RecipeFreshnessSourceRefSummary): string[] {
  if (sourceRefs.status === 'completed') {
    return [];
  }
  return sourceRefs.errors.length > 0 ? sourceRefs.errors : [`source_refs:${sourceRefs.status}`];
}

/**
 * SyncCoordinator — 知识 CRUD → 向量索引事件驱动同步
 *
 * 监听 EventBus 的 `knowledge:changed` 事件，
 * debounce 合并后批量执行 chunk → embed → upsert/remove。
 *
 * 设计:
 *   - 2s debounce 窗口内合并多个 CRUD 事件
 *   - maxBatchSize(20) 达到时立即触发
 *   - 启动时可执行一次 DB↔Vector 对账
 *
 * @module service/vector/SyncCoordinator
 */

import { inArray, ne } from 'drizzle-orm';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import { knowledgeEntries } from '../../infrastructure/database/drizzle/schema.js';
import type { EventBus } from '../../infrastructure/event/EventBus.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { VectorStore } from '../../infrastructure/vector/VectorStore.js';
import { queryNonDeprecatedEntries } from '../../repository/search/SearchRepoAdapter.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import type { VectorChunkEnricher } from './EnrichmentTypes.js';
import {
  parseRecipeIdFromRegionVectorId,
  RECIPE_REGION_VECTOR_ID_PREFIX,
  type RecipeRegionSourceEntry,
  syncRecipeSemanticRegionVectors,
} from './RecipeRegionVectorIndex.js';
import {
  inspectRecipeVectorGeneration,
  type RecipeVectorGenerationInspection,
} from './RecipeVectorGeneration.js';
import type { VectorIndexReader, VectorIndexWriter } from './VectorIndexPorts.js';
import type { EmbedProvider } from './VectorService.js';

// ── Types ──

export interface VectorLifecycleCoordinatorConfig {
  /** @deprecated Compatibility aggregate; new wiring supplies reader + writer separately. */
  vectorStore?: VectorStore;
  reader?: VectorIndexReader;
  writer?: VectorIndexWriter;
  embedProvider: EmbedProvider | null;
  contextualEnricher: VectorChunkEnricher | null;
  debounceMs: number;
  maxBatchSize?: number;
  drizzle?: DrizzleDB;
}

/** @deprecated Use VectorLifecycleCoordinatorConfig. */
export type SyncCoordinatorConfig = VectorLifecycleCoordinatorConfig;

class LifecycleVectorStoreBridge extends VectorStore {
  readonly #reader: VectorIndexReader;
  readonly #writer: VectorIndexWriter;

  constructor(reader: VectorIndexReader, writer: VectorIndexWriter) {
    super();
    this.#reader = reader;
    this.#writer = writer;
  }

  listIds(): Promise<string[]> {
    return this.#reader.listIds();
  }

  getById(id: string): Promise<Record<string, unknown> | null> {
    return this.#reader.getById(id);
  }

  remove(id: string): Promise<void> {
    return this.#writer.remove(id);
  }

  batchUpsert(items: Parameters<VectorIndexWriter['batchUpsert']>[0]): Promise<void> {
    return this.#writer.batchUpsert(items);
  }
}

interface PendingChange {
  type: 'upsert' | 'remove';
  entryId: string;
  title?: string;
  content?: unknown;
  kind?: string;
  entry?: RecipeRegionSourceEntry;
  timestamp: number;
}

export interface SyncCoordinatorReconcileResult {
  orphansRemoved: number;
  recipeRegionOrphansRemoved: number;
  missingSynced: number;
  /** Missing live vectors deliberately deferred because generation is unavailable. */
  missingDeferred?: number;
  degradedReason?: 'embed-provider-unavailable' | 'vector-sync-incomplete';
  errors: string[];
  legacyEntryVectorsRemoved?: number;
  initialInspection?: RecipeVectorGenerationInspection;
  finalInspection?: RecipeVectorGenerationInspection;
}

// ── Coordinator ──

export class VectorLifecycleCoordinator {
  #reader: VectorIndexReader;
  #writer: VectorIndexWriter;
  #recipeRegionStore: VectorStore;
  #embedProvider: EmbedProvider | null;
  #contextualEnricher: VectorChunkEnricher | null;
  #debounceMs: number;
  #maxBatchSize: number;
  #drizzle: DrizzleDB | null;
  #pendingChanges: Map<string, PendingChange> = new Map();
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #processingPromise: Promise<void> | null = null;
  #logger = Logger.getInstance();
  #eventBus: EventBus | null = null;
  #boundHandler: ((data: unknown) => void) | null = null;
  #boundDeletedHandler: ((data: unknown) => void) | null = null;
  #boundLifecycleHandler: ((data: unknown) => void) | null = null;

  constructor(config: VectorLifecycleCoordinatorConfig) {
    const reader = config.reader ?? config.vectorStore;
    const writer = config.writer ?? config.vectorStore;
    if (!reader || !writer) {
      throw new Error('VectorLifecycleCoordinator requires reader and writer ports.');
    }
    this.#reader = reader;
    this.#writer = writer;
    this.#recipeRegionStore = config.vectorStore ?? new LifecycleVectorStoreBridge(reader, writer);
    this.#embedProvider = config.embedProvider;
    this.#contextualEnricher = config.contextualEnricher;
    this.#debounceMs = config.debounceMs;
    this.#maxBatchSize = config.maxBatchSize ?? 20;
    this.#drizzle = config.drizzle ?? null;
  }

  /** Keep event generation aligned when VectorService installs or replaces a provider. */
  setEmbedProvider(embedProvider: EmbedProvider | null): void {
    this.#embedProvider = embedProvider;
  }

  /** 绑定 EventBus，开始监听知识变更事件 */
  bindEventBus(eventBus: EventBus): void {
    this.#eventBus = eventBus;

    this.#boundHandler = (data: unknown) => {
      this.#onKnowledgeChanged(data);
    };

    eventBus.on('knowledge:changed', this.#boundHandler);
    // CO3 C8: keep the handler reference so destroy() can unbind it — the
    // previous anonymous listener leaked past destroy and kept enqueueing.
    this.#boundDeletedHandler = (data: unknown) => {
      const d = data as { id?: string; entryId?: string };
      const entryId = d.entryId || d.id;
      if (entryId) {
        this.#enqueue({
          type: 'remove',
          entryId,
          timestamp: Date.now(),
        });
      }
    };
    eventBus.on('knowledge:deleted', this.#boundDeletedHandler);

    this.#boundLifecycleHandler = (data: unknown) => {
      const d = data as {
        entryId?: string;
        to?: string;
        entry?: RecipeRegionSourceEntry;
      };
      const entryId = d.entryId || d.entry?.id;
      if (!entryId) {
        return;
      }
      if (d.to === 'deprecated') {
        this.#enqueue({ type: 'remove', entryId, timestamp: Date.now() });
        return;
      }
      this.#enqueue({
        type: 'upsert',
        entryId,
        title: d.entry?.title,
        content: d.entry?.content,
        kind: d.entry?.kind,
        entry: d.entry,
        timestamp: Date.now(),
      });
    };
    eventBus.on('lifecycle:transition', this.#boundLifecycleHandler);

    this.#logger.info('[SyncCoordinator] Bound to EventBus');
  }

  /**
   * 手动触发立即刷入（用于测试或 shutdown 前确保数据落盘）
   *
   * Both flush() and destroy() await queued and in-flight mutations.
   */
  async flush(): Promise<void> {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    await this.#processBatch();
  }

  /**
   * 启动对账: 比较 DB knowledge_entries 与向量索引，修复不一致
   *
   * Explicit reconcile contract (CO3 V1):
   * - Orphan = an `entry_*` vector whose id has no non-deprecated DB row.
   *   Each orphan is removed individually; a failed removal is COUNTED in
   *   `errors` and logged with the stable code
   *   core.diagnostic.vector.orphan-remove-failed (it is never silent).
   * - Recipe-region orphan = a `recipe_region_*` vector whose parsed Recipe
   *   id has no non-deprecated DB row. These are removed and counted
   *   separately in `recipeRegionOrphansRemoved`.
   * - Missing = a non-deprecated DB row without a vector. Each is
   *   re-enqueued as an upsert and flushed before reconcile returns
   *   (`missingSynced` counts them).
   * - If the DB cannot be read (missing table / no connection), reconcile
   *   returns zero counts and logs
   *   core.diagnostic.vector.reconcile-db-unavailable — degraded but
   *   usable, per the read-tolerant posture.
   * - Removals stay per-item (no transactional batch): the vector store
   *   contract has no multi-id atomic delete, and batching would change
   *   data structures, which CO3 forbids.
   *
   * @param db - 数据库连接 (better-sqlite3 style)
   * @returns entry/region orphan counts, missing entry count, and errors
   */
  async reconcile(db?: {
    prepare(sql: string): {
      all(
        ...args: unknown[]
      ): Array<{ id: string; title?: string; content?: string; kind?: string }>;
    };
  }): Promise<SyncCoordinatorReconcileResult> {
    const result: SyncCoordinatorReconcileResult = {
      orphansRemoved: 0,
      recipeRegionOrphansRemoved: 0,
      missingSynced: 0,
      errors: [] as string[],
    };

    try {
      // 1. 获取向量索引中所有 ID
      const vectorIds = await this.#reader.listIds();

      // 2. 获取 DB 中所有 active 知识条目 ID
      let dbEntries: RecipeRegionSourceEntry[] = [];
      try {
        if (this.#drizzle) {
          // Drizzle 类型安全查询
          dbEntries = this.#drizzle
            .select()
            .from(knowledgeEntries)
            .where(ne(knowledgeEntries.lifecycle, 'deprecated'))
            .all() as unknown as RecipeRegionSourceEntry[];
        } else if (db) {
          // 向后兼容: 测试时可传入 mock db
          dbEntries = queryNonDeprecatedEntries(db) as RecipeRegionSourceEntry[];
        } else {
          return result;
        }
      } catch (err: unknown) {
        // Missing table / unavailable DB: degraded but usable (CO3 V1).
        this.#logger.warn('[SyncCoordinator] reconcile skipped — DB unavailable', {
          code: CORE_DIAGNOSTIC_CODES.vectorReconcileDbUnavailable,
          error: err instanceof Error ? err.message : String(err),
        });
        return result;
      }

      const authoritativeRecipeIds = new Set(dbEntries.map((entry) => entry.id));
      result.initialInspection = await inspectRecipeVectorGeneration(
        this.#recipeRegionStore,
        dbEntries,
        null
      );

      // Retire every generic Recipe competitor. Removal needs no provider.
      for (const vectorId of vectorIds) {
        if (vectorId.startsWith('entry_')) {
          try {
            await this.#writer.remove(vectorId);
            result.orphansRemoved++;
            result.legacyEntryVectorsRemoved = (result.legacyEntryVectorsRemoved ?? 0) + 1;
          } catch (err: unknown) {
            // CO3 V1: a failed orphan removal used to vanish — it is now
            // counted in the contract result and logged with a stable code.
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`orphan-remove-failed:${vectorId}:${message}`);
            this.#logger.warn('[SyncCoordinator] orphan vector removal failed', {
              code: CORE_DIAGNOSTIC_CODES.vectorOrphanRemoveFailed,
              vectorId,
              error: message,
            });
          }
        }
      }

      // Parent-orphan canonical documents are also provider-independent truth removals.
      for (const vectorId of vectorIds) {
        if (!vectorId.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)) {
          continue;
        }
        const recipeId = parseRecipeIdFromRegionVectorId(vectorId);
        if (!recipeId || authoritativeRecipeIds.has(recipeId)) {
          continue;
        }
        try {
          await this.#writer.remove(vectorId);
          result.recipeRegionOrphansRemoved++;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push(`recipe-region-orphan-remove-failed:${vectorId}:${message}`);
          this.#logger.warn('[SyncCoordinator] recipe region orphan removal failed', {
            vectorId,
            error: message,
          });
        }
      }

      const afterTruthCleanup = await inspectRecipeVectorGeneration(
        this.#recipeRegionStore,
        dbEntries,
        null
      );
      if (!afterTruthCleanup.healthy) {
        const generationAvailable = await this.#isEmbedProviderAvailable();
        if (generationAvailable) {
          const sync = await syncRecipeSemanticRegionVectors(
            this.#recipeRegionStore,
            this.#embedProvider,
            dbEntries,
            {
              force: true,
              maintenanceScope: {
                kind: 'authoritative-corpus',
                nonDeprecatedRecipeIds: dbEntries.map((entry) => entry.id),
              },
              removeStale: true,
            }
          );
          result.errors.push(...sync.errors);
        } else {
          result.degradedReason = 'embed-provider-unavailable';
        }
      }

      result.finalInspection = await inspectRecipeVectorGeneration(
        this.#recipeRegionStore,
        dbEntries,
        null
      );
      result.missingSynced = Math.max(
        0,
        result.initialInspection.missingIds.length - result.finalInspection.missingIds.length
      );
      if (!result.finalInspection.healthy) {
        result.missingDeferred =
          result.finalInspection.missingIds.length +
          result.finalInspection.partialIds.length +
          result.finalInspection.hashMismatchIds.length +
          result.finalInspection.staleIds.length +
          result.finalInspection.duplicateIds.length;
        result.degradedReason ??= 'vector-sync-incomplete';
      }

      this.#logger.info('[SyncCoordinator] Reconciliation complete', {
        orphansRemoved: result.orphansRemoved,
        recipeRegionOrphansRemoved: result.recipeRegionOrphansRemoved,
        missingSynced: result.missingSynced,
        missingDeferred: result.missingDeferred ?? 0,
        exactSetHealthy: result.finalInspection.healthy,
        degradedReason: result.degradedReason,
      });
    } catch (err: unknown) {
      // Contract: unexpected reconcile failures are returned in errors[]
      // and logged — the caller sees them either way (CO3 V1).
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      this.#logger.warn('[SyncCoordinator] reconcile failed', {
        code: CORE_DIAGNOSTIC_CODES.vectorReconcileFailed,
        error: message,
      });
    }

    return result;
  }

  /**
   * 销毁: 清理定时器和事件监听
   *
   * Shutdown contract:
   * - Idempotent; safe to call more than once.
   * - Unbinds changed, deleted, and lifecycle listeners before draining.
   * - Awaits queued and in-flight mutations; callers must await destroy().
   */
  async destroy(): Promise<void> {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    if (this.#eventBus && this.#boundHandler) {
      this.#eventBus.off('knowledge:changed', this.#boundHandler);
      this.#boundHandler = null;
    }
    if (this.#eventBus && this.#boundDeletedHandler) {
      this.#eventBus.off('knowledge:deleted', this.#boundDeletedHandler);
      this.#boundDeletedHandler = null;
    }
    if (this.#eventBus && this.#boundLifecycleHandler) {
      this.#eventBus.off('lifecycle:transition', this.#boundLifecycleHandler);
      this.#boundLifecycleHandler = null;
    }
    this.#eventBus = null;

    // Acknowledged mutations may already be queued. Unbind first to bound the
    // drain, then await all pending/in-flight work instead of dropping it.
    await this.flush();
    this.#logger.info('[SyncCoordinator] Destroyed');
  }

  // ═══ Private ═══

  #onKnowledgeChanged(data: unknown): void {
    const d = data as {
      id?: string;
      entryId?: string;
      action?: string;
      entry?: RecipeRegionSourceEntry;
    };

    const entryId = d.entryId || d.id || d.entry?.id;
    if (!entryId) {
      return;
    }

    if (d.action === 'delete' || d.entry?.lifecycle === 'deprecated') {
      this.#enqueue({ type: 'remove', entryId, timestamp: Date.now() });
    } else {
      this.#enqueue({
        type: 'upsert',
        entryId,
        title: d.entry?.title,
        content: d.entry?.content,
        kind: d.entry?.kind,
        entry: d.entry,
        timestamp: Date.now(),
      });
    }
  }

  #enqueue(change: PendingChange): void {
    // 同一 entryId 的后续操作覆盖前一个（最终一致性）
    this.#pendingChanges.set(change.entryId, change);

    // 达到批量上限时立即触发
    if (this.#pendingChanges.size >= this.#maxBatchSize) {
      if (this.#debounceTimer) {
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = null;
      }
      this.#processBatch().catch((err: unknown) => {
        this.#logger.warn('[SyncCoordinator] processBatch error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    // debounce
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
    }
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#processBatch().catch((err: unknown) => {
        this.#logger.warn('[SyncCoordinator] processBatch error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.#debounceMs);
  }

  async #processBatch(): Promise<void> {
    if (this.#processingPromise) {
      await this.#processingPromise;
      if (this.#pendingChanges.size > 0) {
        await this.#processBatch();
      }
      return;
    }

    if (this.#pendingChanges.size === 0) {
      return;
    }

    const processing = this.#processSingleBatch();
    this.#processingPromise = processing;
    try {
      await processing;
    } finally {
      if (this.#processingPromise === processing) {
        this.#processingPromise = null;
      }
    }
    if (this.#pendingChanges.size > 0) {
      await this.#processBatch();
    }
  }

  async #processSingleBatch(): Promise<void> {
    const batch = new Map(this.#pendingChanges);
    this.#pendingChanges.clear();

    const upserts: PendingChange[] = [];
    const removes: string[] = [];
    let upsertedCount = 0;
    let deferredUpsertCount = 0;
    let failedUpsertCount = 0;

    for (const change of batch.values()) {
      if (change.type === 'remove') {
        removes.push(change.entryId);
      } else {
        upserts.push(change);
      }
    }

    // 处理删除
    for (const entryId of removes) {
      try {
        await this.#writer.remove(`entry_${entryId}`);
      } catch (err: unknown) {
        // Removal failure does not block the batch, but it is no longer
        // silent — reconcile() repairs leftovers (CO3 V1 diagnostics).
        this.#logger.warn('[SyncCoordinator] vector removal failed in batch', {
          code: CORE_DIAGNOSTIC_CODES.vectorBatchRemoveFailed,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await this.#removeRecipeRegions(entryId);
    }

    // Removal stays available without an embed provider. Generation is
    // explicitly deferred and never fabricates vector success.
    const embedProvider = this.#embedProvider;
    if (upserts.length > 0 && !embedProvider) {
      deferredUpsertCount = upserts.length;
      this.#logger.warn('[SyncCoordinator] vector upserts deferred — embed provider unavailable', {
        count: upserts.length,
      });
    }

    // 处理 upsert: 提取文本 → embed → upsert
    if (upserts.length > 0 && embedProvider) {
      const validUpserts = upserts.filter((u) => u.title || u.content);

      if (validUpserts.length > 0) {
        // metadata 契约补齐（2026-07-06 语义零召回孪生缝修复）：入队条目只带
        // entryId/title/content/kind，写出的向量 metadata 缺 type/language/
        // category/dimensionId/knowledgeType——任何按这些键的显式过滤都会把
        // entry 向量全部灭掉（与 type:'all' 哨兵同型缝）。批处理时按 id 从 DB
        // 一次回查补全（单点覆盖 reconcile 与 knowledge:changed 两个入队来源）；
        // drizzle 缺席时容缺降级为原有字段。
        const hydrated = this.#hydrateEntries(validUpserts.map((u) => u.entryId));
        try {
          const regionEntries = validUpserts.map((change) => ({
            ...(hydrated.get(change.entryId) ?? {}),
            ...(change.entry ?? {}),
            id: change.entryId,
            title: change.entry?.title ?? change.title ?? hydrated.get(change.entryId)?.title,
            content:
              change.entry?.content ?? change.content ?? hydrated.get(change.entryId)?.content,
            kind: change.entry?.kind ?? change.kind ?? hydrated.get(change.entryId)?.kind,
          }));
          const regionResult = await syncRecipeSemanticRegionVectors(
            this.#recipeRegionStore,
            embedProvider,
            regionEntries
          );
          upsertedCount = regionResult.upserted;
          if (regionResult.status === 'completed') {
            for (const change of validUpserts) {
              try {
                await this.#writer.remove(`entry_${change.entryId}`);
              } catch (err: unknown) {
                this.#logger.warn('[SyncCoordinator] legacy entry vector retirement failed', {
                  entryId: change.entryId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
          if (regionResult.errors.length > 0) {
            this.#logger.warn('[SyncCoordinator] recipe region refresh had errors', {
              errors: regionResult.errors.slice(0, 20),
            });
          }
        } catch (err: unknown) {
          failedUpsertCount = validUpserts.length;
          this.#logger.warn('[SyncCoordinator] batch embed/upsert failed', {
            count: validUpserts.length,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.#logger.info('[SyncCoordinator] Batch processed', {
      upserted: upsertedCount,
      deferredUpserts: deferredUpsertCount,
      failedUpserts: failedUpsertCount,
      removed: removes.length,
    });
  }

  async #removeRecipeRegions(entryId: string): Promise<void> {
    let vectorIds: string[];
    try {
      vectorIds = await this.#reader.listIds();
    } catch (err: unknown) {
      this.#logger.warn('[SyncCoordinator] recipe region list failed during removal', {
        entryId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const vectorId of vectorIds) {
      if (
        vectorId.startsWith(RECIPE_REGION_VECTOR_ID_PREFIX) &&
        parseRecipeIdFromRegionVectorId(vectorId) === entryId
      ) {
        try {
          await this.#writer.remove(vectorId);
        } catch (err: unknown) {
          this.#logger.warn('[SyncCoordinator] recipe region removal failed in batch', {
            entryId,
            vectorId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  async #isEmbedProviderAvailable(): Promise<boolean> {
    if (!this.#embedProvider) {
      return false;
    }
    if (
      !('isAvailable' in this.#embedProvider) ||
      typeof this.#embedProvider.isAvailable !== 'function'
    ) {
      return true;
    }
    try {
      return await this.#embedProvider.isAvailable();
    } catch (err: unknown) {
      this.#logger.warn('[SyncCoordinator] embed provider availability probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 按 entryId 批量回查 metadata 补齐字段（language/category/dimensionId/
   * knowledgeType/kind）。drizzle 缺席或查询失败时返回空 Map——调用方容缺
   * 降级为入队自带字段，写出仍成功（可观测面留 warn）。
   */
  #hydrateEntries(entryIds: string[]): Map<string, RecipeRegionSourceEntry> {
    const map = new Map<string, RecipeRegionSourceEntry>();
    if (!this.#drizzle || entryIds.length === 0) {
      return map;
    }
    try {
      const rows = this.#drizzle
        .select()
        .from(knowledgeEntries)
        .where(inArray(knowledgeEntries.id, entryIds))
        .all();
      for (const row of rows) {
        map.set(row.id, row as unknown as RecipeRegionSourceEntry);
      }
    } catch (err: unknown) {
      this.#logger.warn('[SyncCoordinator] metadata hydrate failed (degraded to queue fields)', {
        count: entryIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return map;
  }
}

/**
 * Compatibility facade for existing Core/Alembic consumers. New maintenance
 * wiring should name the provider-independent lifecycle responsibility.
 */
export class SyncCoordinator extends VectorLifecycleCoordinator {}

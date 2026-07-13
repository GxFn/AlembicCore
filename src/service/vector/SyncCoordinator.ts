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
import type { VectorStore } from '../../infrastructure/vector/VectorStore.js';
import { queryNonDeprecatedEntries } from '../../repository/search/SearchRepoAdapter.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import type { VectorChunkEnricher } from './EnrichmentTypes.js';
import {
  parseRecipeIdFromRegionVectorId,
  RECIPE_REGION_VECTOR_ID_PREFIX,
  type RecipeRegionSourceEntry,
  syncRecipeSemanticRegionVectors,
} from './RecipeRegionVectorIndex.js';
import type { EmbedProvider } from './VectorService.js';

// ── Types ──

export interface SyncCoordinatorConfig {
  vectorStore: VectorStore;
  embedProvider: EmbedProvider | null;
  contextualEnricher: VectorChunkEnricher | null;
  debounceMs: number;
  maxBatchSize?: number;
  drizzle?: DrizzleDB;
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
  degradedReason?: 'embed-provider-unavailable';
  errors: string[];
}

// ── Coordinator ──

export class SyncCoordinator {
  #vectorStore: VectorStore;
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

  constructor(config: SyncCoordinatorConfig) {
    this.#vectorStore = config.vectorStore;
    this.#embedProvider = config.embedProvider;
    this.#contextualEnricher = config.contextualEnricher;
    this.#debounceMs = config.debounceMs;
    this.#maxBatchSize = config.maxBatchSize ?? 20;
    this.#drizzle = config.drizzle ?? null;
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
      const vectorIds = new Set(await this.#vectorStore.listIds());

      // 2. 获取 DB 中所有 active 知识条目 ID
      let dbEntries: Array<{ id: string; title?: string; content?: string; kind?: string }> = [];
      try {
        if (this.#drizzle) {
          // Drizzle 类型安全查询
          dbEntries = this.#drizzle
            .select({
              id: knowledgeEntries.id,
              title: knowledgeEntries.title,
              content: knowledgeEntries.content,
              kind: knowledgeEntries.kind,
            })
            .from(knowledgeEntries)
            .where(ne(knowledgeEntries.lifecycle, 'deprecated'))
            .all() as Array<{ id: string; title?: string; content?: string; kind?: string }>;
        } else if (db) {
          // 向后兼容: 测试时可传入 mock db
          dbEntries = queryNonDeprecatedEntries(db);
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

      const dbIdSet = new Set(dbEntries.map((e) => `entry_${e.id}`));
      const authoritativeRecipeIds = new Set(dbEntries.map((entry) => entry.id));

      // 3. 找孤儿向量 (在索引中但 DB 无对应的 entry_ 前缀记录)
      for (const vectorId of vectorIds) {
        if ((vectorId as string).startsWith('entry_') && !dbIdSet.has(vectorId as string)) {
          try {
            await this.#vectorStore.remove(vectorId as string);
            result.orphansRemoved++;
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

      // Region vectors are derived from the same non-deprecated DB corpus.
      // Count them separately so repair evidence cannot confuse entry-vector
      // health with semantic-region health.
      for (const vectorId of vectorIds) {
        if (!(vectorId as string).startsWith(RECIPE_REGION_VECTOR_ID_PREFIX)) {
          continue;
        }
        const recipeId = parseRecipeIdFromRegionVectorId(vectorId as string);
        if (!recipeId || authoritativeRecipeIds.has(recipeId)) {
          continue;
        }
        try {
          await this.#vectorStore.remove(vectorId as string);
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

      // 4. 找缺失向量 (在 DB 中但索引无对应)
      const missingEntries = dbEntries.filter((entry) => !vectorIds.has(`entry_${entry.id}`));
      const generationAvailable =
        missingEntries.length === 0 || (await this.#isEmbedProviderAvailable());
      for (const entry of missingEntries) {
        if (!generationAvailable) {
          result.missingDeferred = (result.missingDeferred ?? 0) + 1;
          result.degradedReason = 'embed-provider-unavailable';
        } else {
          this.#enqueue({
            type: 'upsert',
            entryId: entry.id,
            title: entry.title,
            content: entry.content,
            kind: entry.kind,
            timestamp: Date.now(),
          });
          result.missingSynced++;
        }
      }

      // 立即处理缺失的
      if (result.missingSynced > 0) {
        await this.flush();
      }

      this.#logger.info('[SyncCoordinator] Reconciliation complete', {
        orphansRemoved: result.orphansRemoved,
        recipeRegionOrphansRemoved: result.recipeRegionOrphansRemoved,
        missingSynced: result.missingSynced,
        missingDeferred: result.missingDeferred ?? 0,
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
        await this.#vectorStore.remove(`entry_${entryId}`);
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
        const hydrated = this.#hydrateEntryFields(validUpserts.map((u) => u.entryId));
        const texts = validUpserts.map((u) => this.#extractText(u));
        try {
          const embedResult = await embedProvider.embed(texts);
          const vectors = Array.isArray(embedResult[0])
            ? (embedResult as number[][])
            : [embedResult as number[]];

          const items = validUpserts.map((u, i) => {
            const extra = hydrated.get(u.entryId);
            return {
              id: `entry_${u.entryId}`,
              content: texts[i],
              vector: vectors[i] || [],
              metadata: {
                entryId: u.entryId,
                title: u.title || '',
                kind: u.kind || extra?.kind || 'unknown',
                // 'recipe' 对齐查询侧 type 语义（region 向量为 recipe-semantic-region，
                // 两类向量靠 type 值天然互斥，显式 type:'recipe' 过滤命中 entry 域）。
                type: 'recipe',
                language: extra?.language ?? '',
                category: extra?.category ?? '',
                dimensionId: extra?.dimensionId ?? '',
                knowledgeType: extra?.knowledgeType ?? '',
                source: 'event_sync',
                updatedAt: Date.now(),
              },
            };
          });

          await this.#vectorStore.batchUpsert(items);

          const regionEntries = validUpserts.map((change) =>
            change.entry
              ? change.entry
              : {
                  id: change.entryId,
                  title: change.title,
                  content: change.content,
                  kind: change.kind,
                }
          );
          const regionResult = await syncRecipeSemanticRegionVectors(
            this.#vectorStore,
            embedProvider,
            regionEntries
          );
          if (regionResult.errors.length > 0) {
            this.#logger.warn('[SyncCoordinator] recipe region refresh had errors', {
              errors: regionResult.errors.slice(0, 20),
            });
          }
        } catch (err: unknown) {
          this.#logger.warn('[SyncCoordinator] batch embed/upsert failed', {
            count: validUpserts.length,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.#logger.info('[SyncCoordinator] Batch processed', {
      upserted: upserts.length,
      removed: removes.length,
    });
  }

  async #removeRecipeRegions(entryId: string): Promise<void> {
    let vectorIds: string[];
    try {
      vectorIds = await this.#vectorStore.listIds();
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
          await this.#vectorStore.remove(vectorId);
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
    if (typeof this.#embedProvider.isAvailable !== 'function') {
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
  #hydrateEntryFields(entryIds: string[]): Map<
    string,
    {
      kind: string;
      language: string;
      category: string;
      dimensionId: string;
      knowledgeType: string;
    }
  > {
    const map = new Map<
      string,
      {
        kind: string;
        language: string;
        category: string;
        dimensionId: string;
        knowledgeType: string;
      }
    >();
    if (!this.#drizzle || entryIds.length === 0) {
      return map;
    }
    try {
      const rows = this.#drizzle
        .select({
          id: knowledgeEntries.id,
          kind: knowledgeEntries.kind,
          language: knowledgeEntries.language,
          category: knowledgeEntries.category,
          dimensionId: knowledgeEntries.dimensionId,
          knowledgeType: knowledgeEntries.knowledgeType,
        })
        .from(knowledgeEntries)
        .where(inArray(knowledgeEntries.id, entryIds))
        .all() as Array<{
        id: string;
        kind: string | null;
        language: string | null;
        category: string | null;
        dimensionId: string | null;
        knowledgeType: string | null;
      }>;
      for (const row of rows) {
        map.set(row.id, {
          kind: row.kind ?? '',
          language: row.language ?? '',
          category: row.category ?? '',
          dimensionId: row.dimensionId ?? '',
          knowledgeType: row.knowledgeType ?? '',
        });
      }
    } catch (err: unknown) {
      this.#logger.warn('[SyncCoordinator] metadata hydrate failed (degraded to queue fields)', {
        count: entryIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return map;
  }

  #extractText(change: PendingChange): string {
    const parts: string[] = [];
    if (change.title) {
      parts.push(change.title);
    }
    if (typeof change.content === 'string') {
      parts.push(change.content);
    } else if (change.content && typeof change.content === 'object') {
      const c = change.content as Record<string, unknown>;
      if (typeof c.body === 'string') {
        parts.push(c.body);
      }
      if (typeof c.code === 'string') {
        parts.push(c.code);
      }
    }
    return parts.join('\n\n') || change.entryId;
  }
}

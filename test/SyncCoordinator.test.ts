/** SyncCoordinator — CRUD→向量同步 单元测试 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock 工厂 ──

function createMockVectorStore() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    batchUpsert: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    listIds: vi.fn().mockResolvedValue([]),
  };
}

function createMockEmbedProvider() {
  return {
    embed: vi.fn().mockImplementation((texts: string | string[]) => {
      if (Array.isArray(texts)) {
        return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]));
      }
      return Promise.resolve([0.1, 0.2, 0.3]);
    }),
  };
}

function createMockEventBus() {
  const listeners = new Map<string, Array<(data: unknown) => void>>();
  return {
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (data: unknown) => void) => {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx !== -1) {
          arr.splice(idx, 1);
        }
      }
    }),
    emit(event: string, data: unknown) {
      const handlers = listeners.get(event) || [];
      for (const h of handlers) {
        h(data);
      }
      return true;
    },
  };
}

// ── 动态导入 ──

let SyncCoordinator: typeof import('../src/service/vector/SyncCoordinator.js').SyncCoordinator;

beforeAll(async () => {
  const mod = await import('../src/service/vector/SyncCoordinator.js');
  SyncCoordinator = mod.SyncCoordinator;
});

// ── Tests ──

describe('SyncCoordinator', () => {
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let embedProvider: ReturnType<typeof createMockEmbedProvider>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    vectorStore = createMockVectorStore();
    embedProvider = createMockEmbedProvider();
    eventBus = createMockEventBus();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createCoordinator(overrides: Record<string, unknown> = {}) {
    return new SyncCoordinator({
      vectorStore: vectorStore as never,
      embedProvider: ('embedProvider' in overrides
        ? overrides.embedProvider
        : embedProvider) as never,
      contextualEnricher: null,
      debounceMs: (overrides.debounceMs as number) ?? 100,
      maxBatchSize: (overrides.maxBatchSize as number) ?? 20,
    });
  }

  // ── Event Binding ──

  describe('bindEventBus()', () => {
    it('should register listeners for knowledge:changed and knowledge:deleted', () => {
      const coord = createCoordinator();
      coord.bindEventBus(eventBus as never);

      expect(eventBus.on).toHaveBeenCalledWith('knowledge:changed', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('knowledge:deleted', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('lifecycle:transition', expect.any(Function));
    });
  });

  // ── Debounce Batching ──

  describe('debounce batching', () => {
    it('should batch changes within debounce window', async () => {
      const coord = createCoordinator({ debounceMs: 200 });
      coord.bindEventBus(eventBus as never);

      // Emit 3 changes in quick succession
      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'Entry 1', content: 'content1', kind: 'recipe' },
      });
      eventBus.emit('knowledge:changed', {
        action: 'update',
        entryId: '2',
        entry: { id: '2', title: 'Entry 2', content: 'content2', kind: 'concept' },
      });
      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '3',
        entry: { id: '3', title: 'Entry 3', content: 'content3', kind: 'recipe' },
      });

      // Before debounce fires
      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();

      // Advance past debounce window
      await vi.advanceTimersByTimeAsync(250);

      // Should have batched all 3 upserts together
      expect(embedProvider.embed).toHaveBeenCalledTimes(2);
      expect(vectorStore.batchUpsert).toHaveBeenCalledTimes(2);
      const batchArgs = vectorStore.batchUpsert.mock.calls[0]?.[0] as Array<{ id: string }>;
      expect(batchArgs).toHaveLength(3);
    });

    it('should deduplicate same entryId within window (last write wins)', async () => {
      const coord = createCoordinator({ debounceMs: 200 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'First', content: 'old', kind: 'recipe' },
      });
      eventBus.emit('knowledge:changed', {
        action: 'update',
        entryId: '1',
        entry: { id: '1', title: 'Updated', content: 'new', kind: 'recipe' },
      });

      await vi.advanceTimersByTimeAsync(250);

      expect(vectorStore.batchUpsert).toHaveBeenCalledTimes(2);
      const batch = vectorStore.batchUpsert.mock.calls[0]?.[0] as Array<{
        id: string;
        content: string;
      }>;
      expect(batch).toHaveLength(1);
      // Should be the updated version
      expect(batch[0].content).toContain('Updated');
    });
  });

  // ── Delete Events ──

  describe('knowledge:deleted event', () => {
    it('should remove entry from vectorStore', async () => {
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:deleted', { entryId: '42' });

      await vi.advanceTimersByTimeAsync(100);

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_42');
    });

    it('removes entry and every recipe region for the deleted id only', async () => {
      vectorStore.listIds.mockResolvedValue([
        'entry_42',
        'recipe_region_42_identity_0000000000000001',
        'recipe_region_42_rationale_0000000000000002',
        'recipe_region_420_identity_0000000000000003',
      ]);
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:deleted', { entryId: '42' });
      await vi.advanceTimersByTimeAsync(100);

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_42');
      expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_42_identity_0000000000000001');
      expect(vectorStore.remove).toHaveBeenCalledWith(
        'recipe_region_42_rationale_0000000000000002'
      );
      expect(vectorStore.remove).not.toHaveBeenCalledWith(
        'recipe_region_420_identity_0000000000000003'
      );
    });

    it('should handle entryId in id field', async () => {
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:deleted', { id: '99' });

      await vi.advanceTimersByTimeAsync(100);

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_99');
    });
  });

  describe('lifecycle:transition event', () => {
    it('removes both vector families when a recipe becomes deprecated', async () => {
      vectorStore.listIds.mockResolvedValue([
        'entry_42',
        'recipe_region_42_identity_0000000000000001',
      ]);
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('lifecycle:transition', { entryId: '42', to: 'deprecated' });
      await vi.advanceTimersByTimeAsync(100);

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_42');
      expect(vectorStore.remove).toHaveBeenCalledWith('recipe_region_42_identity_0000000000000001');
    });

    it('regenerates entry and region vectors from the current live entry', async () => {
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('lifecycle:transition', {
        entryId: '42',
        from: 'deprecated',
        to: 'active',
        entry: {
          id: '42',
          title: 'Reactivated Recipe',
          lifecycle: 'active',
          trigger: '@reactivated',
          content: { markdown: 'Current DB truth' },
          kind: 'pattern',
        },
      });
      await vi.advanceTimersByTimeAsync(100);

      const batches = vectorStore.batchUpsert.mock.calls.map(
        (call) => call[0] as Array<{ id: string }>
      );
      expect(batches.some((batch) => batch.some((item) => item.id === 'entry_42'))).toBe(true);
      expect(
        batches.some((batch) => batch.some((item) => item.id.startsWith('recipe_region_42_')))
      ).toBe(true);
    });
  });

  // ── Max Batch Size ──

  describe('maxBatchSize', () => {
    it('should trigger immediately when batch size reached', async () => {
      const coord = createCoordinator({ debounceMs: 5000, maxBatchSize: 3 });
      coord.bindEventBus(eventBus as never);

      // Emit exactly maxBatchSize changes
      for (let i = 1; i <= 3; i++) {
        eventBus.emit('knowledge:changed', {
          action: 'create',
          entryId: String(i),
          entry: { id: String(i), title: `E${i}`, content: `c${i}`, kind: 'recipe' },
        });
      }

      // Should trigger immediately without waiting for debounce
      // Give microtasks a chance to run
      await vi.advanceTimersByTimeAsync(10);

      expect(embedProvider.embed).toHaveBeenCalled();
      expect(vectorStore.batchUpsert).toHaveBeenCalled();
    });
  });

  // ── flush ──

  describe('flush()', () => {
    it('should process pending changes immediately', async () => {
      const coord = createCoordinator({ debounceMs: 60000 }); // very long debounce
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'Test', content: 'data', kind: 'recipe' },
      });

      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();

      await coord.flush();

      expect(vectorStore.batchUpsert).toHaveBeenCalledTimes(2);
    });

    it('should be safe to call with no pending changes', async () => {
      const coord = createCoordinator();
      await coord.flush(); // should not throw
    });

    it('drains a removal queued while another removal is in flight', async () => {
      let releaseFirst!: () => void;
      vectorStore.remove.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
      );
      const coord = createCoordinator({ debounceMs: 60_000, embedProvider: null });
      coord.bindEventBus(eventBus as never);
      eventBus.emit('knowledge:deleted', { entryId: 'first' });

      const flush = coord.flush();
      await vi.waitFor(() => expect(vectorStore.remove).toHaveBeenCalledWith('entry_first'));
      eventBus.emit('knowledge:deleted', { entryId: 'second' });
      releaseFirst();
      await flush;

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_second');
    });
  });

  // ── destroy ──

  describe('destroy()', () => {
    it('should clear pending changes and remove event listener', () => {
      const coord = createCoordinator();
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'T', content: 'c' },
      });

      coord.destroy();

      expect(eventBus.off).toHaveBeenCalledWith('knowledge:changed', expect.any(Function));
    });

    it('should be safe to call multiple times', () => {
      const coord = createCoordinator();
      coord.destroy();
      coord.destroy(); // should not throw
    });

    it('awaits a queued removal before destruction completes', async () => {
      const coord = createCoordinator({ debounceMs: 60_000 });
      coord.bindEventBus(eventBus as never);
      eventBus.emit('knowledge:deleted', { entryId: 'queued' });

      await coord.destroy();

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_queued');
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle event with missing entry data gracefully', async () => {
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      // Event with no entryId — should be ignored
      eventBus.emit('knowledge:changed', { action: 'create' });

      await vi.advanceTimersByTimeAsync(100);

      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    });

    it('should handle embed failure without crashing', async () => {
      embedProvider.embed.mockRejectedValue(new Error('API timeout'));
      const coord = createCoordinator({ debounceMs: 50 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'Test', content: 'data' },
      });

      await vi.advanceTimersByTimeAsync(100);

      // Should not throw, just log warning
      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    });

    it('should handle mixed upserts and deletes in same batch', async () => {
      const coord = createCoordinator({ debounceMs: 100 });
      coord.bindEventBus(eventBus as never);

      eventBus.emit('knowledge:changed', {
        action: 'create',
        entryId: '1',
        entry: { id: '1', title: 'New', content: 'data' },
      });
      eventBus.emit('knowledge:deleted', { entryId: '2' });

      await vi.advanceTimersByTimeAsync(150);

      expect(vectorStore.remove).toHaveBeenCalledWith('entry_2');
      expect(vectorStore.batchUpsert).toHaveBeenCalled();
    });
  });

  // ── reconcile ──

  describe('reconcile()', () => {
    function createMockDb(
      entries: Array<{ id: string; title?: string; content?: string; kind?: string }> = []
    ) {
      return {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue(entries),
        }),
      };
    }

    it('should remove orphan vectors not in DB', async () => {
      // vector index has entry_abc (orphan), entry_def (in DB)
      vectorStore.listIds = vi.fn().mockResolvedValue(['entry_abc', 'entry_def', 'chunk_0']);
      const db = createMockDb([{ id: 'def', title: 'Keep', content: 'data' }]);

      const coord = createCoordinator({ debounceMs: 50 });
      const result = await coord.reconcile(db as never);

      expect(result.orphansRemoved).toBe(1);
      expect(vectorStore.remove).toHaveBeenCalledWith('entry_abc');
      // chunk_ prefix should not be touched
      expect(vectorStore.remove).not.toHaveBeenCalledWith('chunk_0');
    });

    it('counts and removes recipe regions absent from authoritative DB truth', async () => {
      vectorStore.listIds = vi
        .fn()
        .mockResolvedValue([
          'entry_live',
          'recipe_region_live_identity_0000000000000001',
          'recipe_region_absent_identity_0000000000000002',
          'recipe_region_absent_rationale_0000000000000003',
        ]);
      const db = createMockDb([{ id: 'live', title: 'Keep', content: 'data', kind: 'recipe' }]);

      const coord = createCoordinator({ debounceMs: 50 });
      const result = await coord.reconcile(db as never);

      expect(result.recipeRegionOrphansRemoved).toBe(2);
      expect(vectorStore.remove).toHaveBeenCalledWith(
        'recipe_region_absent_identity_0000000000000002'
      );
      expect(vectorStore.remove).toHaveBeenCalledWith(
        'recipe_region_absent_rationale_0000000000000003'
      );
      expect(vectorStore.remove).not.toHaveBeenCalledWith(
        'recipe_region_live_identity_0000000000000001'
      );
    });

    it('should queue missing entries for sync', async () => {
      // vector index has entry_abc, but DB has abc and new_one
      vectorStore.listIds = vi
        .fn()
        .mockResolvedValueOnce(['entry_abc'])
        .mockResolvedValue(['entry_abc', 'entry_new_one']);
      const db = createMockDb([
        { id: 'abc', title: 'Existing', content: 'data1' },
        { id: 'new_one', title: 'New Entry', content: 'data2', kind: 'recipe' },
      ]);

      const coord = createCoordinator({ debounceMs: 50 });
      const result = await coord.reconcile(db as never);

      expect(result.missingSynced).toBe(1);
      // flush should have been called, triggering batch processing
      expect(vectorStore.batchUpsert).toHaveBeenCalled();
    });

    it('removes orphans but defers missing live vectors without an embed provider', async () => {
      vectorStore.listIds = vi
        .fn()
        .mockResolvedValue([
          'entry_orphan',
          'recipe_region_orphan_identity_0000000000000001',
          'recipe_region_live_identity_0000000000000002',
        ]);
      const db = createMockDb([
        { id: 'live', title: 'Missing live vector', content: 'data', kind: 'recipe' },
      ]);

      const coord = createCoordinator({ debounceMs: 50, embedProvider: null });
      const result = await coord.reconcile(db as never);

      expect(result).toMatchObject({
        orphansRemoved: 1,
        recipeRegionOrphansRemoved: 1,
        missingSynced: 0,
        missingDeferred: 1,
        degradedReason: 'embed-provider-unavailable',
      });
      expect(vectorStore.remove).toHaveBeenCalledWith('entry_orphan');
      expect(vectorStore.remove).toHaveBeenCalledWith(
        'recipe_region_orphan_identity_0000000000000001'
      );
      expect(vectorStore.remove).not.toHaveBeenCalledWith(
        'recipe_region_live_identity_0000000000000002'
      );
      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    });

    it('defers missing vectors when the configured provider reports unavailable', async () => {
      const unavailableProvider = {
        ...createMockEmbedProvider(),
        isAvailable: vi.fn().mockResolvedValue(false),
      };
      vectorStore.listIds = vi.fn().mockResolvedValue([]);
      const db = createMockDb([
        { id: 'live', title: 'Missing live vector', content: 'data', kind: 'recipe' },
      ]);

      const coord = createCoordinator({
        debounceMs: 50,
        embedProvider: unavailableProvider,
      });
      const result = await coord.reconcile(db as never);

      expect(result).toMatchObject({
        missingSynced: 0,
        missingDeferred: 1,
        degradedReason: 'embed-provider-unavailable',
      });
      expect(unavailableProvider.isAvailable).toHaveBeenCalledOnce();
      expect(unavailableProvider.embed).not.toHaveBeenCalled();
      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    });

    it('does not report a missing vector as synced when embedding fails after availability', async () => {
      const failingProvider = createMockEmbedProvider();
      failingProvider.embed.mockRejectedValue(new Error('model unavailable'));
      vectorStore.listIds = vi.fn().mockResolvedValue([]);
      const db = createMockDb([
        { id: 'live', title: 'Missing live vector', content: 'data', kind: 'recipe' },
      ]);

      const coord = createCoordinator({
        debounceMs: 50,
        embedProvider: failingProvider,
      });
      const result = await coord.reconcile(db as never);

      expect(result).toMatchObject({
        missingSynced: 0,
        missingDeferred: 1,
        degradedReason: 'vector-sync-incomplete',
      });
      expect(failingProvider.embed).toHaveBeenCalled();
      expect(vectorStore.batchUpsert).not.toHaveBeenCalled();
    });

    it('should handle empty DB gracefully', async () => {
      vectorStore.listIds = vi.fn().mockResolvedValue(['entry_abc']);
      const db = createMockDb([]);

      const coord = createCoordinator({ debounceMs: 50 });
      const result = await coord.reconcile(db as never);

      expect(result.orphansRemoved).toBe(1);
      expect(result.missingSynced).toBe(0);
    });

    it('should handle DB table not existing', async () => {
      vectorStore.listIds = vi.fn().mockResolvedValue([]);
      const db = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockImplementation(() => {
            throw new Error('no such table');
          }),
        }),
      };

      const coord = createCoordinator({ debounceMs: 50 });
      const result = await coord.reconcile(db as never);

      expect(result.orphansRemoved).toBe(0);
      expect(result.missingSynced).toBe(0);
    });
  });
});

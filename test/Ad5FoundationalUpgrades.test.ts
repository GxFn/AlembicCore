/**
 * P2 AD5 Core leg — foundational upgrade behavior tests.
 *
 * Covers: prepared-statement LRU (identity + bound + eviction),
 * BatchEmbedder provider-aware concurrency (hint consumed, fallback,
 * option override), and the SignalAggregator ring cap with backpressure
 * diagnostics. Performance evidence lives in the P2 state root
 * (ad5-before-after-bench-2026-06-12.txt); these tests pin behavior.
 */

import {
  _resetStatementCacheForTesting,
  prepareCached,
} from '../src/infrastructure/database/PreparedStatementCache.js';
import Logger from '../src/infrastructure/logging/Logger.js';
import { SignalAggregator } from '../src/infrastructure/signal/SignalAggregator.js';
import { BatchEmbedder } from '../src/infrastructure/vector/BatchEmbedder.js';
import { CORE_DIAGNOSTIC_CODES } from '../src/shared/DiagnosticCodes.js';

describe('PreparedStatementCache (AD5 LRU)', () => {
  function makeDb() {
    return {
      prepares: 0,
      prepare(sql: string) {
        this.prepares++;
        return { sql, all: () => [], get: () => null };
      },
    };
  }

  test('reuses the statement for identical SQL on the same connection', () => {
    const db = makeDb();
    const first = prepareCached(db, 'SELECT 1');
    const again = prepareCached(db, 'SELECT 1');
    expect(again).toBe(first);
    expect(db.prepares).toBe(1);
  });

  test('caches are connection-scoped', () => {
    const dbA = makeDb();
    const dbB = makeDb();
    prepareCached(dbA, 'SELECT 1');
    prepareCached(dbB, 'SELECT 1');
    expect(dbA.prepares).toBe(1);
    expect(dbB.prepares).toBe(1);
  });

  test('LRU bound evicts the least-recently-used statement at 128', () => {
    const db = makeDb();
    const first = prepareCached(db, 'SQL-0');
    for (let i = 1; i <= 127; i++) {
      prepareCached(db, `SQL-${i}`);
    }
    // Touch SQL-0 so SQL-1 becomes the LRU, then overflow by one.
    expect(prepareCached(db, 'SQL-0')).toBe(first);
    prepareCached(db, 'SQL-128');
    expect(db.prepares).toBe(129);
    // SQL-0 survived (was touched); SQL-1 was evicted and re-prepares.
    expect(prepareCached(db, 'SQL-0')).toBe(first);
    prepareCached(db, 'SQL-1');
    expect(db.prepares).toBe(130);
    _resetStatementCacheForTesting(db);
  });
});

describe('BatchEmbedder provider-aware concurrency (AD5)', () => {
  function provider(hint?: number) {
    const base = {
      calls: [] as number[],
      inFlight: 0,
      maxObserved: 0,
      async embed(texts: string | string[]) {
        this.inFlight++;
        this.maxObserved = Math.max(this.maxObserved, this.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        this.inFlight--;
        const list = Array.isArray(texts) ? texts : [texts];
        return list.map(() => [0.1]);
      },
    };
    if (hint !== undefined) {
      return Object.assign(base, {
        getEmbeddingCapacityHint: () => ({
          provider: 'mock',
          maxInFlightEmbeddings: hint,
          source: 'test',
        }),
      });
    }
    return base;
  }

  const items = Array.from({ length: 4 * 32 }, (_, index) => ({
    id: `i${index}`,
    content: `text ${index}`,
  }));

  test('consumes the injected provider hint (Agent 637d094 contract shape)', async () => {
    const hinted = provider(4);
    const embedder = new BatchEmbedder(hinted);
    await embedder.embedAll(items);
    expect(hinted.maxObserved).toBe(4);
  });

  test('falls back to the historical default of 2 when the provider lacks the method', async () => {
    const plain = provider();
    const embedder = new BatchEmbedder(plain);
    await embedder.embedAll(items);
    expect(plain.maxObserved).toBe(2);
  });

  test('an explicit maxConcurrency option overrides the hint', async () => {
    const hinted = provider(4);
    const embedder = new BatchEmbedder(hinted, { maxConcurrency: 1 });
    await embedder.embedAll(items);
    expect(hinted.maxObserved).toBe(1);
  });
});

describe('SignalAggregator ring cap (AD5 backpressure)', () => {
  function makeAggregator() {
    const written: Array<Record<string, unknown>> = [];
    const handlers: Array<(signal: unknown) => void> = [];
    const bus = {
      subscribe: (_pattern: string, handler: (signal: unknown) => void) => {
        handlers.push(handler);
      },
      send: () => {},
    };
    const reportStore = {
      write: async (row: Record<string, unknown>) => {
        written.push(row);
      },
    };
    const aggregator = new SignalAggregator(bus as never, reportStore as never, {
      intervalMs: 60_000,
      windowMs: 300_000,
    });
    return { aggregator, written, emit: (signal: unknown) => handlers[0](signal) };
  }

  test('caps a hot window at 5000 entries, drops oldest, and reports the drop', async () => {
    const { aggregator, written, emit } = makeAggregator();
    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const now = Date.now();
    for (let i = 0; i < 5200; i++) {
      emit({ type: 'search', value: i, timestamp: now });
    }

    await aggregator.flushNow();

    const report = written.find((row) => row.type === 'aggregate_search');
    expect(report).toBeTruthy();
    const data = report!.data as Record<string, number>;
    expect(data.count).toBe(5000);
    expect(data.droppedCount).toBe(200);
    // Oldest dropped: the surviving minimum is the 201st emitted value.
    expect(data.min).toBe(200);
    const overflowWarning = warnSpy.mock.calls.find(
      (call) =>
        (call[1] as Record<string, unknown> | undefined)?.code ===
        CORE_DIAGNOSTIC_CODES.signalWindowOverflow
    );
    expect(overflowWarning).toBeDefined();
    expect((overflowWarning![1] as Record<string, unknown>).dropped).toBe(200);

    // The window persists across flushes (entries age out by windowMs), so
    // one more emit overflows the full ring again — droppedCount is 1, not
    // 201, proving the per-flush counter reset.
    emit({ type: 'search', value: 1, timestamp: now });
    await aggregator.flushNow();
    const second = written.filter((row) => row.type === 'aggregate_search').at(-1);
    expect((second!.data as Record<string, number>).droppedCount).toBe(1);

    vi.restoreAllMocks();
    aggregator.dispose();
  });
});

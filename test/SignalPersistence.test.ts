import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { EventBus } from '../src/infrastructure/event/EventBus.js';
import { ReportStore } from '../src/infrastructure/report/ReportStore.js';
import { SignalAggregator } from '../src/infrastructure/signal/SignalAggregator.js';
import { SignalBridge } from '../src/infrastructure/signal/SignalBridge.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { SignalTraceWriter } from '../src/infrastructure/signal/SignalTraceWriter.js';
import { timerRegistry } from '../src/shared/TimerRegistry.js';

afterEach(() => {
  timerRegistry._resetForTesting();
});

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Signal persistence infrastructure', () => {
  test('SignalTraceWriter records and queries typed JSONL signals', async () => {
    const bus = new SignalBus();
    const traceDir = makeTempDir('alembic-core-signals-');
    const writer = new SignalTraceWriter(bus, traceDir);

    bus.send('guard', 'GuardCheckEngine', 0.75, {
      metadata: { count: 3 },
      target: 'recipe-1',
    });
    bus.send('search', 'SearchEngine', 0.5);

    const guard = await writer.query({ type: ['guard'], target: 'recipe-1' });
    const stats = await writer.stats();

    expect(guard.total).toBe(1);
    expect(guard.signals[0]).toMatchObject({
      type: 'guard',
      source: 'GuardCheckEngine',
      target: 'recipe-1',
      value: 0.75,
      metadata: { count: 3 },
    });
    expect(stats).toMatchObject({
      total: 2,
      byType: { guard: 1, search: 1 },
    });
  });

  test('SignalBridge forwards signal events into EventBus channels', () => {
    const signalBus = new SignalBus();
    const eventBus = new EventBus();
    const signalEvents: unknown[] = [];
    const guardEvents: unknown[] = [];

    eventBus.on('signal:event', (payload) => signalEvents.push(payload));
    eventBus.on('guard:updated', (payload) => guardEvents.push(payload));
    new SignalBridge(signalBus, eventBus);

    signalBus.send('guard', 'test', 1);
    signalBus.send('search', 'test', 0.5);

    expect(signalEvents).toHaveLength(2);
    expect(guardEvents).toHaveLength(1);
  });

  test('SignalAggregator writes metric reports and emits spike anomalies', async () => {
    const bus = new SignalBus();
    const reportsDir = makeTempDir('alembic-core-reports-');
    const reportStore = new ReportStore(reportsDir);
    const anomalies: string[] = [];
    const aggregator = new SignalAggregator(bus, reportStore, { intervalMs: 5, windowMs: 10_000 });

    bus.subscribe('anomaly', (signal) => anomalies.push(signal.source));
    aggregator.start();

    bus.send('guard', 'initial', 0.2);
    await new Promise((resolve) => setTimeout(resolve, 12));

    for (let i = 0; i < 5; i++) {
      bus.send('guard', `spike-${i}`, 0.9);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    aggregator.stop();

    const reports = await reportStore.query({ category: ['metrics'], type: 'aggregate_guard' });

    expect(reports.total).toBeGreaterThanOrEqual(1);
    expect(reports.reports[0].producer).toBe('SignalAggregator');
    expect(anomalies).toContain('Aggregator.guard');
  });
});

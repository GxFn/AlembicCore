/**
 * SignalAggregator — 滑窗统计 + 异常检测
 *
 * 订阅可聚合的事实型信号，周期性写入 Report（统计）并在异常时发射 Signal。
 *
 * @module infrastructure/signal/SignalAggregator
 */

import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import type { Startable } from '../../shared/lifecycle.js';
import { timerRegistry } from '../../shared/TimerRegistry.js';
import Logger from '../logging/Logger.js';
import type { ReportStore } from '../report/ReportStore.js';
import type { Signal, SignalBus } from './SignalBus.js';

interface SlidingWindow {
  entries: Array<{ value: number; ts: number }>;
  baseline: number;
  /** Entries dropped by the ring cap since the last flush (AD5 backpressure). */
  droppedSinceFlush: number;
}

/**
 * Ring cap per signal type (AD5): a hot producer cannot grow a window
 * unbounded between flushes. Drop policy: oldest entries are discarded
 * (ring semantics) — aggregates then cover the most recent CAP entries of
 * the window, and every flush that experienced drops reports a
 * backpressure diagnostic with the drop count (stable code
 * core.diagnostic.signal.window-overflow) plus droppedCount in the
 * written report row. 5000 entries ≈ 80+ signals/second sustained over
 * the default 60s flush interval — far above any observed rate.
 */
const MAX_WINDOW_ENTRIES = 5000;

export class SignalAggregator implements Startable {
  readonly #bus: SignalBus;
  readonly #reportStore: ReportStore;
  readonly #windows: Map<string, SlidingWindow> = new Map();
  readonly #intervalMs: number;
  readonly #windowMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    signalBus: SignalBus,
    reportStore: ReportStore,
    opts: { intervalMs?: number; windowMs?: number } = {}
  ) {
    this.#bus = signalBus;
    this.#reportStore = reportStore;
    this.#intervalMs = opts.intervalMs ?? 60_000;
    this.#windowMs = opts.windowMs ?? 300_000;

    // 订阅可聚合的事实型信号
    signalBus.subscribe('guard|search|usage|lifecycle|forge|decay|quality', (signal) => {
      this.#record(signal);
    });
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    this.#timer = timerRegistry.setInterval(
      () => {
        void this.#flush();
      },
      this.#intervalMs,
      'SignalAggregator/flush'
    );
  }

  stop(): void {
    if (this.#timer) {
      timerRegistry.clear(this.#timer);
      this.#timer = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  /** Flush immediately (shutdown/test seam; same path as the timer flush). */
  async flushNow(): Promise<void> {
    await this.#flush();
  }

  #record(signal: Signal): void {
    const key = signal.type;
    let win = this.#windows.get(key);
    if (!win) {
      win = { entries: [], baseline: 0, droppedSinceFlush: 0 };
      this.#windows.set(key, win);
    }
    win.entries.push({ value: signal.value, ts: signal.timestamp });
    if (win.entries.length > MAX_WINDOW_ENTRIES) {
      const overflow = win.entries.length - MAX_WINDOW_ENTRIES;
      win.entries.splice(0, overflow);
      win.droppedSinceFlush += overflow;
    }
  }

  async #flush(): Promise<void> {
    const now = Date.now();
    for (const [type, win] of this.#windows) {
      // 清理过期条目
      win.entries = win.entries.filter((e) => now - e.ts < this.#windowMs);
      if (win.entries.length === 0) {
        continue;
      }

      const count = win.entries.length;
      const avg = win.entries.reduce((s, e) => s + e.value, 0) / count;
      const max = Math.max(...win.entries.map((e) => e.value));
      const min = Math.min(...win.entries.map((e) => e.value));

      // Backpressure diagnostics (AD5): drops are reported per flush, not
      // per record, so a hot producer cannot flood the log either.
      if (win.droppedSinceFlush > 0) {
        Logger.getInstance().warn('[SignalAggregator] window overflow — oldest entries dropped', {
          code: CORE_DIAGNOSTIC_CODES.signalWindowOverflow,
          type,
          dropped: win.droppedSinceFlush,
          cap: MAX_WINDOW_ENTRIES,
        });
      }

      // 周期统计 → Report
      await this.#reportStore.write({
        category: 'metrics',
        type: `aggregate_${type}`,
        producer: 'SignalAggregator',
        data: {
          window: `${this.#windowMs / 1000}s`,
          count,
          avg,
          max,
          min,
          baseline: win.baseline,
          droppedCount: win.droppedSinceFlush,
        },
        timestamp: now,
      });
      win.droppedSinceFlush = 0;

      // 异常检测 → Signal（信号量突增 3 倍）
      if (win.baseline > 0 && count > win.baseline * 3) {
        this.#bus.send('anomaly', `Aggregator.${type}`, 1, {
          metadata: { reason: 'spike', count, baseline: win.baseline },
        });
      }

      // 更新 baseline（指数移动平均）
      win.baseline = win.baseline === 0 ? count : win.baseline * 0.8 + count * 0.2;
    }
  }
}

/**
 * P2 AD5 — realtime delivery contract conformance (Core's side).
 *
 * Pins the documented semantics in docs/realtime-delivery-contract.md:
 * fire-and-forget at-most-once EventBus dispatch, silent drop without
 * listeners, synchronous error propagation to the emitter, serial
 * emitAsync with first-rejection stop, and no replay for late
 * subscribers. If any of these change, the doc and the Alembic consumer
 * half must change together.
 */

import { EventBus } from '../src/infrastructure/event/EventBus.js';

describe('Realtime delivery contract (EventBus)', () => {
  test('no listener → event drops silently and emit returns false', () => {
    const bus = new EventBus();
    expect(bus.emit('knowledge:changed', { entryId: 'k1' })).toBe(false);
  });

  test('at-most-once, no replay: late subscribers never see earlier events', () => {
    const bus = new EventBus();
    bus.emit('lifecycle:transition', { entryId: 'k1' });
    const seen: unknown[] = [];
    bus.on('lifecycle:transition', (payload) => seen.push(payload));
    expect(seen).toEqual([]);
    bus.emit('lifecycle:transition', { entryId: 'k2' });
    expect(seen).toHaveLength(1);
  });

  test('synchronous listener errors propagate to the emitter (producers beware)', () => {
    const bus = new EventBus();
    bus.on('knowledge:changed', () => {
      throw new Error('subscriber exploded');
    });
    expect(() => bus.emit('knowledge:changed', {})).toThrow('subscriber exploded');
  });

  test('emitAsync runs listeners serially in registration order', async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('e', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('slow-first');
    });
    bus.on('e', async () => {
      order.push('fast-second');
    });
    await bus.emitAsync('e');
    expect(order).toEqual(['slow-first', 'fast-second']);
  });

  test('emitAsync stops at the first rejection; later listeners do not run', async () => {
    const bus = new EventBus();
    let laterRan = false;
    bus.on('e', async () => {
      throw new Error('first failed');
    });
    bus.on('e', async () => {
      laterRan = true;
    });
    await expect(bus.emitAsync('e')).rejects.toThrow('first failed');
    expect(laterRan).toBe(false);
  });

  test('history is an observability ring, not a replay buffer', () => {
    const bus = new EventBus({ historyLimit: 3 });
    for (let i = 0; i < 5; i++) {
      bus.emit(`event-${i}`);
    }
    const history = bus.getHistory(10);
    expect(history).toHaveLength(3);
    expect(history[0].event).toBe('event-2');
  });
});

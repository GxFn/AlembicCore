# Realtime Delivery Contract — Core's Side (AD5)

Core produces realtime-feeding events; it does not own sockets or rooms.
This documents the delivery guarantees Core's event surfaces actually
provide, pinned by `test/RealtimeDeliveryContract.test.ts`. The consumer
half (Socket.io topology, room membership on dropout, SSE reconnection) is
owned by Alembic's `RealtimeService` and documented in its AD5 leg —
everything below feeds it.

## EventBus (`infrastructure/event/EventBus.ts`)

- **Fire-and-forget, at-most-once, in-process.** `emit()` is synchronous
  Node `EventEmitter` dispatch: no persistence, no retry, no replay. A
  listener registered after an emit never sees it.
- **No listener → event is dropped silently** (`emit` returns false). This
  is the contract for `knowledge:changed` / `lifecycle:transition` /
  `knowledge:deleted`: producers (KnowledgeService, UoW) never wait for or
  verify consumers.
- **Synchronous listener errors propagate to the EMITTER** (standard
  EventEmitter): a throwing subscriber can fail a producer's call path.
  Subscribers that must not disturb producers (SyncCoordinator pattern)
  catch internally.
- **`emitAsync` awaits listeners SERIALLY in registration order** and
  propagates the first rejection; later listeners do not run after a
  rejection.
- History (`getHistory`) is an observability ring (default 100), not a
  replay buffer.

## SignalBus / SignalAggregator (`infrastructure/signal/`)

- `send()` is fire-and-forget; aggregation windows are in-memory with a
  5000-entry ring cap per type (oldest dropped; drops surface as
  `core.diagnostic.signal.window-overflow` + `droppedCount` in the flushed
  report row). Restart loses unflushed windows — accepted.

## ConfigWatcher change callbacks (`core/discovery/ConfigWatcher.ts`)

- Callbacks fire at-most-once per debounced change while the watcher is
  live; `dispose()` stops delivery. No catch-up notification on
  re-subscribe — consumers needing current state must re-read it.

## What downstream may NOT assume

- No ordering across event names; ordering holds only per-emitter call
  sequence within one event name.
- No delivery once the process restarts (no queue, no journal).
- Dashboard-visible realtime (rooms, reconnect catch-up) is a Alembic
  RealtimeService concern layered on these primitives.

export { EventBus } from './infrastructure/event/index.js';
export {
  type Signal,
  SignalAggregator,
  SignalBridge,
  SignalBus,
  type SignalHandler,
  SignalTraceWriter,
  type SignalType,
} from './infrastructure/signal/index.js';
export type { Disposable, Startable } from './shared/lifecycle.js';
export { timerRegistry } from './shared/TimerRegistry.js';

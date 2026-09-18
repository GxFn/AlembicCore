/**
 * EventBus — 应用事件总线
 * 支持 emit/emitAsync、事件历史日志、统计
 */

import { EventEmitter } from 'node:events';

export class EventBus extends EventEmitter {
  #history: Array<{ event: string | symbol; timestamp: string; argCount: number }>;
  #historyLimit;

  constructor(options: { maxListeners?: number; historyLimit?: number } = {}) {
    super();
    this.setMaxListeners(options.maxListeners || 20);
    this.#history = [];
    this.#historyLimit = options.historyLimit || 100;
  }

  /** 同步 emit + 记录历史 */
  emit(eventName: string | symbol, ...args: unknown[]) {
    this.#recordEvent(eventName, args);
    return super.emit(eventName, ...args);
  }

  /** 异步 emit — 串行等待所有 listener 完成 */
  async emitAsync(eventName: string | symbol, ...args: unknown[]) {
    this.#recordEvent(eventName, args);
    // rawListeners 保留 once 包装器；listeners 会解包，导致一次性监听器永不移除。
    // 同时保持 EventEmitter 的 this 绑定，异步派发只改变等待方式。
    const listeners = this.rawListeners(eventName);
    for (const listener of listeners) {
      await listener.apply(this, args);
    }
  }

  /** 获取事件历史 */
  getHistory(limit = 10) {
    return this.#history.slice(-limit);
  }

  /** 清空历史 */
  clearHistory() {
    this.#history = [];
  }

  /** 获取统计 */
  getStats() {
    const events: Record<string, number> = {};
    for (const entry of this.#history) {
      const key = String(entry.event);
      events[key] = (events[key] || 0) + 1;
    }
    return {
      totalEvents: this.#history.length,
      uniqueEvents: Object.keys(events).length,
      byEvent: events,
      activeListeners: this.eventNames().reduce((sum, name) => sum + this.listenerCount(name), 0),
    };
  }

  // ─── 私有 ─────────────────────────────────────────────

  #recordEvent(eventName: string | symbol, args: unknown[]) {
    this.#history.push({
      event: eventName,
      timestamp: new Date().toISOString(),
      argCount: args.length,
    });
    if (this.#history.length > this.#historyLimit) {
      this.#history = this.#history.slice(-this.#historyLimit);
    }
  }
}

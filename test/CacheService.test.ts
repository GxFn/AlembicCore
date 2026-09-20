import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('memory cache lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    // 只观察缓存的 interval，排除日志 transport 自身的 immediate 等调度。
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps the shared cache idle until used and releases its sweep when emptied', async () => {
    const { cacheService, initCacheAdapter } = await import('../src/infrastructure/cache/index.js');
    const adapter = await initCacheAdapter();
    expect(adapter.memoryService).toBe(cacheService);
    // 只导入图缓存或初始化兼容 adapter，不应启动空缓存的后台工作。
    expect(vi.getTimerCount()).toBe(0);

    await adapter.set('first', 1, 1);
    await adapter.set('second', 2, 1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(adapter.getStats().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await adapter.set('again', 3);
    expect(vi.getTimerCount()).toBe(1);
    await adapter.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes automatic expiry when an existing instance is reused after shutdown', async () => {
    const { cacheService } = await import('../src/infrastructure/cache/CacheService.js');
    cacheService.set('old', 1);
    cacheService.shutdown();
    expect(cacheService.getStats().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // shutdown 原本仍允许 set；重用时也应恢复无人读取条目的过期回收。
    cacheService.set('new', 2, 1);
    vi.advanceTimersByTime(60_000);
    expect(cacheService.getStats().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves TTL seconds, the exact expiry boundary and falsy cache values', async () => {
    const { cacheService } = await import('../src/infrastructure/cache/CacheService.js');
    cacheService.set('zero', 0, 1);
    cacheService.set('false', false, 3);
    vi.advanceTimersByTime(1_000);
    expect(cacheService.get('zero')).toBe(0);
    expect(cacheService.get('false')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(cacheService.get('zero')).toBeNull();
    expect(cacheService.delete('false')).toBe(true);
    expect(cacheService.delete('false')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    cacheService.set('last', 'value', 1);
    vi.advanceTimersByTime(1_001);
    expect(cacheService.get('last')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

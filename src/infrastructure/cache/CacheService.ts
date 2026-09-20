/**
 * 本地内存缓存服务
 * 进程内 TTL Map；UnifiedCacheAdapter 仅提供同一实例的异步兼容接口。
 * 不包含分布式/Redis 后端，定时回收只在缓存有数据时运行。
 */

import Logger from '../logging/index.js';

/** 本地缓存实现（无 Redis 依赖） */
export class CacheService {
  cache = new Map<string, { value: unknown; expiresAt: number }>();
  cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** 获取缓存 */
  get(key: string) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.#syncCleanup();
      return null;
    }

    return entry.value;
  }

  /**
   * 设置缓存
   * @param ttlSeconds 默认 300 秒
   */
  set(key: string, value: unknown, ttlSeconds = 300) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
    this.#syncCleanup();
  }

  /** 删除缓存 */
  delete(key: string) {
    const removed = this.cache.delete(key);
    this.#syncCleanup();
    return removed;
  }

  /** 清空所有缓存 */
  clear() {
    this.cache.clear();
    this.#syncCleanup();
  }

  /** 清理过期缓存 */
  cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
    this.#syncCleanup();
    Logger.debug(`[Cache] Cleanup completed. Remaining entries: ${this.cache.size}`);
  }

  /** 获取缓存统计信息 */
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /** 释放当前数据与后台任务；保留旧的可重用语义，后续 set 会重新启动过期回收。 */
  shutdown() {
    this.clear();
    Logger.info('[Cache] Service shutdown');
  }

  /** 模块单例可被多个 adapter 借用；timer 跟随数据，不由某个宿主的启动/关闭取得所有权。 */
  #syncCleanup() {
    if (this.cache.size === 0) {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
        Logger.debug('[Cache] Empty cache; expiration sweep stopped');
      }
    } else if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60_000);
      this.cleanupInterval.unref?.();
      Logger.debug('[Cache] Cached data present; expiration sweep started', { intervalMs: 60_000 });
    }
  }
}

/** 缓存键生成器 */
export class CacheKeyBuilder {
  static candidate(id: string) {
    return `candidate:${id}`;
  }

  static candidatesList(page: number, limit: number, status?: string) {
    const baseKey = `candidates:list:${page}:${limit}`;
    return status ? `${baseKey}:${status}` : baseKey;
  }

  static recipe(id: string) {
    return `recipe:${id}`;
  }

  static recipesList(page: number, limit: number, category?: string) {
    const baseKey = `recipes:list:${page}:${limit}`;
    return category ? `${baseKey}:${category}` : baseKey;
  }

  static rule(id: string) {
    return `rule:${id}`;
  }

  static rulesList(page: number, limit: number, status?: string) {
    const baseKey = `rules:list:${page}:${limit}`;
    return status ? `${baseKey}:${status}` : baseKey;
  }

  static health() {
    return 'health:status';
  }

  static stats() {
    return 'system:stats';
  }
}

// 导出单例实例
export const cacheService = new CacheService();

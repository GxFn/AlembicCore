/**
 * PreparedStatementCache — LRU of prepared statements per connection (AD5).
 *
 * Hot repository paths (knowledge list/search/edges) re-prepared their SQL
 * on every call. better-sqlite3's prepare() is the dominant fixed cost on
 * repeated small queries, so hot paths now reuse statements through this
 * cache.
 *
 * Policy (documented per the AD5 ruling):
 *  - keyed by exact SQL string, scoped per database connection via WeakMap
 *    (a reconnect gets a fresh cache; closed connections release theirs
 *    with the handle);
 *  - bounded at 128 distinct SQL strings per connection; eviction is
 *    least-recently-used (re-insertion order idiom). Evicted statements
 *    need no explicit finalize — better-sqlite3 statements are GC-managed;
 *  - behavior-identical: same SQL, same bindings, same results — only the
 *    prepare step is reused. Statements in better-sqlite3 are synchronous
 *    and reusable across calls by design.
 *
 * Blessed-cache class: bounded, deterministic rebuild, connection-scoped
 * (covered by the AD4 doctrine's bounded-cache treatment).
 *
 * @module infrastructure/database/PreparedStatementCache
 */

interface PreparableDb {
  prepare(sql: string): unknown;
}

const MAX_STATEMENTS_PER_CONNECTION = 128;

const cacheByDb = new WeakMap<object, Map<string, unknown>>();

/**
 * Prepare-with-reuse: returns the cached statement for (db, sql) or
 * prepares and caches it. The returned statement is the same object
 * better-sqlite3 would hand back from db.prepare(sql).
 */
export function prepareCached<TStatement = unknown>(db: PreparableDb, sql: string): TStatement {
  let cache = cacheByDb.get(db as object);
  if (!cache) {
    cache = new Map();
    cacheByDb.set(db as object, cache);
  }

  const hit = cache.get(sql);
  if (hit !== undefined) {
    // LRU touch: re-insert to move to the most-recent position.
    cache.delete(sql);
    cache.set(sql, hit);
    return hit as TStatement;
  }

  const statement = db.prepare(sql);
  cache.set(sql, statement);
  if (cache.size > MAX_STATEMENTS_PER_CONNECTION) {
    // Map iteration order = insertion order; the first key is the LRU.
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  return statement as TStatement;
}

/** Test-only: drop a connection's statement cache. */
export function _resetStatementCacheForTesting(db: PreparableDb): void {
  cacheByDb.delete(db as object);
}

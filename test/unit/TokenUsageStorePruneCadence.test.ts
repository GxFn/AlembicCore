/**
 * TokenUsageStore deterministic prune cadence.
 *
 * Pins the headless-Core boundary contract: pruning is triggered by a write
 * counter (every PRUNE_EVERY_N_WRITES-th successful insert), not by
 * probabilistic control flow. Skipped zero-token records and the prune
 * retention limit (MAX_ROWS) are part of the pinned semantics.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../../src/database.js';
import { pathGuard } from '../../src/io.js';
import { TokenUsageStore } from '../../src/repository/token/TokenUsageStore.js';

const PRUNE_CADENCE = 100;
const EXPECTED_MAX_ROWS = 10000;

interface PruneProbe {
  runs: number;
  lastLimit: number | null;
}

/**
 * Wrap db.prepare before the store is constructed so the prune DELETE
 * statement (prepared in the constructor) counts its run() calls.
 */
function probePruneStatement(db: AlembicDatabaseRuntime['sqlite']): PruneProbe {
  const probe: PruneProbe = { runs: 0, lastLimit: null };
  const realPrepare = db.prepare.bind(db);
  (db as { prepare: unknown }).prepare = (sql: string) => {
    const stmt = realPrepare(sql);
    if (sql.includes('DELETE FROM token_usage')) {
      const realRun = stmt.run.bind(stmt);
      (stmt as { run: unknown }).run = (...args: unknown[]) => {
        probe.runs += 1;
        probe.lastLimit = typeof args[0] === 'number' ? args[0] : null;
        return realRun(...args);
      };
    }
    return stmt;
  };
  return probe;
}

describe('TokenUsageStore prune cadence', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-token-prune-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function countRows(): number {
    const row = runtime.sqlite.prepare('SELECT COUNT(*) AS c FROM token_usage').get() as {
      c: number;
    };
    return row.c;
  }

  it('prunes on exactly every 100th successful insert', () => {
    const probe = probePruneStatement(runtime.sqlite);
    const store = new TokenUsageStore(runtime.sqlite, runtime.drizzle);

    for (let i = 0; i < PRUNE_CADENCE - 1; i++) {
      store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    }
    expect(countRows()).toBe(PRUNE_CADENCE - 1);
    expect(probe.runs).toBe(0);

    store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    expect(probe.runs).toBe(1);

    for (let i = 0; i < PRUNE_CADENCE; i++) {
      store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    }
    expect(probe.runs).toBe(2);
    expect(countRows()).toBe(2 * PRUNE_CADENCE);
  });

  it('keeps the MAX_ROWS retention argument unchanged', () => {
    const probe = probePruneStatement(runtime.sqlite);
    const store = new TokenUsageStore(runtime.sqlite, runtime.drizzle);

    for (let i = 0; i < PRUNE_CADENCE; i++) {
      store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    }

    expect(probe.runs).toBe(1);
    expect(probe.lastLimit).toBe(EXPECTED_MAX_ROWS);
  });

  it('does not advance the cadence on skipped zero-token records', () => {
    const probe = probePruneStatement(runtime.sqlite);
    const store = new TokenUsageStore(runtime.sqlite, runtime.drizzle);

    for (let i = 0; i < PRUNE_CADENCE - 1; i++) {
      store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    }
    for (let i = 0; i < 10; i++) {
      store.record({ source: 'cadence-test', inputTokens: 0, outputTokens: 0 });
    }
    expect(countRows()).toBe(PRUNE_CADENCE - 1);
    expect(probe.runs).toBe(0);

    store.record({ source: 'cadence-test', inputTokens: 1, outputTokens: 1 });
    expect(probe.runs).toBe(1);
  });
});

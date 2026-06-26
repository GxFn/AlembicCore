/**
 * CoverageLedgerRepository — U2a 持久层（真 SQLite + 全迁移）。
 *
 * 覆盖验收②：upsert/onConflictDoUpdate（键 module×dimension）/listByProjectRoot/listByModule，
 * 复刻 GitDiffCheckpointRepository 语义；JSON(covered_source_refs/uncovered_hints) + boolean(exhausted/deferred)
 * 往返；deep_mining_rounds 边际产出 upsert/list。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import migrate015CoverageLedger from '../src/infrastructure/database/migrations/015_coverage_ledger.js';
import migrate016DeepMiningRoundsRescanId from '../src/infrastructure/database/migrations/016_deep_mining_rounds_rescan_id.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';

describe('CoverageLedgerRepository (U2a)', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-coverage-ledger-'));
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

  it('upsert by (project_root, module_id, dimension_id) cell；onConflictDoUpdate 不重复、保留 created_at；JSON/boolean 往返', () => {
    const repo = createAlembicRepositories(runtime.connection).coverageLedgerRepository;
    const scope = { projectRoot: '/p', moduleId: 'mod-a', dimensionId: 'arch' };

    const first = repo.upsertCell({
      ...scope,
      coveredCount: 1,
      totalCandidateCount: 5,
      grade: 'thin',
      coveredSourceRefs: ['src/a.ts'],
      uncoveredHints: ['hint-1', 'hint-2'],
      valueScore: 0.7,
      lastRound: 1,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(first.grade).toBe('thin');
    expect(first.coveredSourceRefs).toEqual(['src/a.ts']);
    expect(first.uncoveredHints).toEqual(['hint-1', 'hint-2']);
    expect(first.exhausted).toBe(false);
    expect(first.deferred).toBe(false);

    const updated = repo.upsertCell({
      ...scope,
      coveredCount: 4,
      totalCandidateCount: 5,
      grade: 'covered',
      exhausted: true,
      exhaustedReason: 'agent says done',
      exhaustedSource: 'agent-declared',
      lastRound: 2,
      updatedAt: 2000,
    });
    expect(updated.grade).toBe('covered');
    expect(updated.coveredCount).toBe(4);
    expect(updated.exhausted).toBe(true);
    expect(updated.exhaustedSource).toBe('agent-declared');
    expect(updated.createdAt).toBe(1000); // created_at 保留（不被 update 重写）
    expect(updated.updatedAt).toBe(2000);
    expect(repo.listByProjectRoot('/p')).toHaveLength(1); // 同键不重复
  });

  it('listByProjectRoot / listByModule 隔离 module×dimension cells', () => {
    const repo = createAlembicRepositories(runtime.connection).coverageLedgerRepository;
    repo.upsertCell({
      projectRoot: '/p',
      moduleId: 'mod-a',
      dimensionId: 'arch',
      grade: 'covered',
    });
    repo.upsertCell({ projectRoot: '/p', moduleId: 'mod-a', dimensionId: 'coding', grade: 'thin' });
    repo.upsertCell({ projectRoot: '/p', moduleId: 'mod-b', dimensionId: 'arch', grade: 'empty' });
    repo.upsertCell({
      projectRoot: '/other',
      moduleId: 'mod-a',
      dimensionId: 'arch',
      grade: 'covered',
    });

    expect(repo.listByProjectRoot('/p')).toHaveLength(3);
    expect(repo.listByModule('/p', 'mod-a')).toHaveLength(2);
    expect(repo.listByModule('/p', 'mod-b').map((c) => c.dimensionId)).toEqual(['arch']);
    expect(repo.getCell({ projectRoot: '/p', moduleId: 'mod-b', dimensionId: 'arch' })?.grade).toBe(
      'empty'
    );
    expect(repo.getCell({ projectRoot: '/p', moduleId: 'mod-z', dimensionId: 'arch' })).toBeNull();
  });

  it('deep_mining_rounds upsert + list（round_index 升序）+ 边际产出更新', () => {
    const repo = createAlembicRepositories(runtime.connection).coverageLedgerRepository;
    repo.upsertRound({
      projectRoot: '/p',
      roundIndex: 1,
      newRecipesThisRound: 12,
      triggerActor: 'agent',
      startedAt: 1,
      completedAt: 2,
    });
    repo.upsertRound({ projectRoot: '/p', roundIndex: 2, newRecipesThisRound: 3 });
    repo.upsertRound({ projectRoot: '/p', roundIndex: 2, newRecipesThisRound: 5 }); // 同轮更新

    const rounds = repo.listRoundsByProjectRoot('/p');
    expect(rounds.map((r) => r.roundIndex)).toEqual([1, 2]);
    expect(rounds[0]?.rescanId).toBeNull();
    expect(rounds[1]?.newRecipesThisRound).toBe(5);
    expect(repo.getRound('/p', 1)?.newRecipesThisRound).toBe(12);
    expect(repo.getRound('/p', 9)).toBeNull();
  });

  it('deep_mining_rounds stores rescanId and upserts repeated rescanId without duplicate rows', () => {
    const repo = createAlembicRepositories(runtime.connection).coverageLedgerRepository;

    const first = repo.upsertRound({
      projectRoot: '/p',
      rescanId: 'rescan-123',
      roundIndex: 3,
      newRecipesThisRound: 8,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(first.rescanId).toBe('rescan-123');
    expect(first.roundIndex).toBe(3);

    const repeated = repo.upsertRound({
      projectRoot: '/p',
      rescanId: 'rescan-123',
      roundIndex: 4,
      newRecipesThisRound: 2,
      updatedAt: 2000,
    });

    expect(repeated.roundIndex).toBe(3);
    expect(repeated.newRecipesThisRound).toBe(2);
    expect(repeated.createdAt).toBe(1000);
    expect(repo.getRoundByRescanId('/p', 'rescan-123')?.updatedAt).toBe(2000);
    expect(repo.listRoundsByProjectRoot('/p')).toHaveLength(1);
  });
});

describe('deep_mining_rounds rescan_id migration (RF-3)', () => {
  it('adds nullable rescan_id and a non-null unique index to an existing 015 DB idempotently', () => {
    const db = new Database(':memory:');
    try {
      migrate015CoverageLedger(db);
      db.prepare(
        `INSERT INTO deep_mining_rounds
          (project_root, round_index, new_recipes_this_round, created_at, updated_at)
         VALUES ('/p', 1, 4, 1000, 1000)`
      ).run();

      migrate016DeepMiningRoundsRescanId(db);
      migrate016DeepMiningRoundsRescanId(db);

      const columns = db.prepare("PRAGMA table_info('deep_mining_rounds')").all() as Array<{
        name: string;
      }>;
      expect(columns.map((column) => column.name)).toContain('rescan_id');

      const existing = db
        .prepare('SELECT round_index, rescan_id FROM deep_mining_rounds WHERE project_root = ?')
        .get('/p') as { round_index: number; rescan_id: string | null };
      expect(existing).toEqual({ round_index: 1, rescan_id: null });

      db.prepare(
        `INSERT INTO deep_mining_rounds
          (project_root, rescan_id, round_index, new_recipes_this_round, created_at, updated_at)
         VALUES ('/p', 'rescan-unique', 2, 0, 2000, 2000)`
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO deep_mining_rounds
              (project_root, rescan_id, round_index, new_recipes_this_round, created_at, updated_at)
             VALUES ('/p', 'rescan-unique', 3, 0, 3000, 3000)`
          )
          .run()
      ).toThrow(/UNIQUE/i);

      db.prepare(
        `INSERT INTO deep_mining_rounds
          (project_root, round_index, new_recipes_this_round, created_at, updated_at)
         VALUES ('/p', 4, 0, 4000, 4000)`
      ).run();
      db.prepare(
        `INSERT INTO deep_mining_rounds
          (project_root, round_index, new_recipes_this_round, created_at, updated_at)
         VALUES ('/p', 5, 0, 5000, 5000)`
      ).run();
      const count = db.prepare('SELECT count(*) AS n FROM deep_mining_rounds').get() as {
        n: number;
      };
      expect(count.n).toBe(4);
    } finally {
      db.close();
    }
  });
});

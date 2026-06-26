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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
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
    expect(rounds[1]?.newRecipesThisRound).toBe(5);
    expect(repo.getRound('/p', 1)?.newRecipesThisRound).toBe(12);
    expect(repo.getRound('/p', 9)).toBeNull();
  });
});

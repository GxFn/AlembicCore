/**
 * CoverageLedgerWriteWorkflow — host-agent coverage-ledger write helper public entrypoint.
 *
 * 用真实 SQLite repository 验证下沉到 Core 的写入 helper 不是类型空壳：
 * empty cell 能被真实 source-ref-backed candidate 回写到 partial/covered，
 * 且全格 covered 后 CoverageLedgerAdvisor 的 converged 分支可达。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import {
  adviseCoverageLedger,
  reflowDeepMiningRoundOnCompletion,
  writeCoverageLedgerForCompletion,
} from '../src/host-agent-workflows.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';

describe('CoverageLedgerWriteWorkflow public host-agent helper', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-coverage-ledger-write-'));
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

  it('writes source-ref-backed coverage cells from empty to partial and covered, then advisor converges', () => {
    const repository = createAlembicRepositories(runtime.connection).coverageLedgerRepository;
    const projectRoot = '/project';
    const moduleId = 'auth';
    const dimensionId = 'architecture';
    const modules = [{ moduleId, moduleName: 'Auth', ownedPaths: ['src/auth'] }];
    const candidates = [
      { dimensionIds: [dimensionId], sourceRefPaths: ['src/auth/login.ts'], importance: 80 },
      { dimensionIds: [dimensionId], sourceRefPaths: ['src/auth/token.ts'], importance: 40 },
    ];

    repository.upsertCell({
      projectRoot,
      moduleId,
      dimensionId,
      grade: 'empty',
      coveredCount: 0,
      totalCandidateCount: 0,
      lastRound: 1,
    });

    const partial = writeCoverageLedgerForCompletion({
      repository,
      projectRoot,
      modules,
      dimensionIds: [dimensionId],
      candidates,
      coveredPaths: ['src/auth/login.ts'],
      perCellTarget: 2,
      lastRound: 2,
    });
    const partialCell = repository.getCell({ projectRoot, moduleId, dimensionId });

    expect(partial).toMatchObject({ writtenCells: 1, deferredCells: 0 });
    expect(partial.cells[0]).toMatchObject({
      moduleId,
      dimensionId,
      coveredCount: 1,
      totalCandidateCount: 2,
      grade: 'partial',
    });
    expect(partialCell).toMatchObject({
      grade: 'partial',
      coveredCount: 1,
      totalCandidateCount: 2,
      coveredSourceRefs: ['src/auth/login.ts'],
      uncoveredHints: ['src/auth/token.ts'],
      lastRound: 2,
      deferred: false,
    });

    writeCoverageLedgerForCompletion({
      repository,
      projectRoot,
      modules,
      dimensionIds: [dimensionId],
      candidates,
      coveredPaths: ['src/auth/login.ts', 'src/auth/token.ts'],
      perCellTarget: 2,
      lastRound: 3,
    });
    const coveredCell = repository.getCell({ projectRoot, moduleId, dimensionId });

    expect(coveredCell).toMatchObject({
      grade: 'covered',
      coveredCount: 2,
      coveredSourceRefs: ['src/auth/login.ts', 'src/auth/token.ts'],
      uncoveredHints: [],
      lastRound: 3,
    });

    const advisory = adviseCoverageLedger({
      cells: repository.listByProjectRoot(projectRoot),
      latestRound: repository.getRound(projectRoot, 1),
      moduleCount: 1,
    });

    expect(advisory).toMatchObject({
      shouldStop: true,
      stopReason: 'converged',
      highValueBlankCount: 0,
      valueSortedGaps: [],
      suggestion: null,
    });
  });

  it('reflows only the latest opened deepMining round and preserves existing round fields', () => {
    const repository = createAlembicRepositories(runtime.connection).coverageLedgerRepository;
    const projectRoot = '/project';

    expect(
      reflowDeepMiningRoundOnCompletion({ repository, projectRoot, newRecipeCount: 2 })
    ).toEqual({
      updated: false,
      newRecipesThisRound: 0,
      roundIndex: null,
    });

    repository.upsertRound({
      projectRoot,
      rescanId: 'rescan-1',
      roundIndex: 1,
      startedAt: 100,
      completedAt: 120,
      newRecipesThisRound: 2,
      triggerActor: 'agent',
      createdAt: 90,
      updatedAt: 120,
    });

    const reflowed = reflowDeepMiningRoundOnCompletion({
      repository,
      projectRoot,
      newRecipeCount: 3,
      now: 200,
    });
    const round = repository.getRound(projectRoot, 1);

    expect(reflowed).toEqual({ updated: true, newRecipesThisRound: 5, roundIndex: 1 });
    expect(round).toMatchObject({
      rescanId: 'rescan-1',
      startedAt: 100,
      completedAt: 200,
      newRecipesThisRound: 5,
      triggerActor: 'agent',
    });
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { GitDiffCheckpointService } from '../src/evolution.js';
import { pathGuard } from '../src/io.js';
import type { PlanIntent } from '../src/plans.js';
import { createAlembicRepositories } from '../src/repositories.js';

describe('Git diff checkpoint repository and service', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-git-checkpoint-'));
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

  it('persists upserts and isolates composite project/scope/folder keys', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const repo = repositories.gitDiffCheckpointRepository;

    const initial = repo.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: 'commit-a',
      initialFromPlanCommit: 'commit-a',
      lastRouteStatus: 'initialized',
      createdAt: 100,
      updatedAt: 100,
    });
    expect(initial.checkpointCommit).toBe('commit-a');
    expect(initial.createdAt).toBe(100);

    const updated = repo.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: 'commit-b',
      initialFromPlanCommit: 'commit-a',
      mergeBaseCommit: 'commit-a',
      targetCommit: 'commit-b',
      lastRouteStatus: 'routed',
      lastScannedAt: 200,
      advancedAt: 200,
      updatedAt: 200,
    });
    expect(updated.checkpointCommit).toBe('commit-b');
    expect(updated.createdAt).toBe(100);
    expect(updated.updatedAt).toBe(200);

    repo.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'test',
      checkpointCommit: 'commit-folder-test',
      createdAt: 300,
      updatedAt: 300,
    });

    expect(
      repo.get({ projectRoot: tmpDir, scopeId: 'rescan', folderId: 'src' })?.checkpointCommit
    ).toBe('commit-b');
    expect(
      repo.get({ projectRoot: tmpDir, scopeId: 'rescan', folderId: 'test' })?.checkpointCommit
    ).toBe('commit-folder-test');
    expect(repo.listByProjectRoot(tmpDir)).toHaveLength(2);
  });

  it('initializes from the active confirmed Plan commit instead of guessing a git parent', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const draft = repositories.planRepository.saveDraft({
      planId: 'plan-checkpoint',
      projectRoot: tmpDir,
      projectContextSignature: 'signature-a',
      lastUpdatedFromCommit: 'plan-confirmed-commit',
      createdBy: 'test',
      rationale: ['checkpoint fixture'],
      createdAt: 100,
    });
    repositories.planRepository.confirm({
      planId: draft.planId,
      version: draft.version,
      confirmedBy: 'test',
      confirmedAt: 120,
      rationale: ['confirmed checkpoint fixture'],
      intent: completePlanIntent(),
    });

    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      planRepository: repositories.planRepository,
    });
    const result = service.ensureCheckpoint({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      now: 200,
    });

    expect(result.source).toBe('active-confirmed-plan');
    expect(result.checkpoint.checkpointCommit).toBe('plan-confirmed-commit');
    expect(result.checkpoint.initialFromPlanCommit).toBe('plan-confirmed-commit');
    expect(result.checkpoint.lastRouteStatus).toBe('initialized');
  });

  it('does not advance on skipped, truncated, failed, or non-ancestor route outcomes', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      planRepository: repositories.planRepository,
    });
    repositories.gitDiffCheckpointRepository.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: 'base-commit',
      initialFromPlanCommit: 'base-commit',
      createdAt: 100,
      updatedAt: 100,
    });

    for (const [index, routeStatus] of [
      'skipped',
      'truncated',
      'failed',
      'non-ancestor',
    ].entries()) {
      const result = service.recordRouteOutcome({
        projectRoot: tmpDir,
        scopeId: 'rescan',
        folderId: 'src',
        targetCommit: `target-${index}`,
        mergeBaseCommit: 'merge-base',
        routeStatus,
        scannedAt: 200 + index,
      });

      expect(result.advanced).toBe(false);
      expect(result.checkpoint.checkpointCommit).toBe('base-commit');
      expect(result.unresolvedRange).toEqual({
        fromCommit: 'base-commit',
        toCommit: `target-${index}`,
        mergeBaseCommit: 'merge-base',
      });
    }
  });

  it('advances only after successful routed or catch-up routed outcomes', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      planRepository: repositories.planRepository,
    });
    repositories.gitDiffCheckpointRepository.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: 'base-commit',
      initialFromPlanCommit: 'base-commit',
      createdAt: 100,
      updatedAt: 100,
    });

    const catchUp = service.recordRouteOutcome({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      targetCommit: 'target-catch-up',
      mergeBaseCommit: 'merge-base',
      routeStatus: 'catch-up-routed',
      scannedAt: 200,
    });
    expect(catchUp.advanced).toBe(true);
    expect(catchUp.checkpoint.checkpointCommit).toBe('target-catch-up');
    expect(catchUp.checkpoint.mergeBaseCommit).toBe('merge-base');
    expect(catchUp.unresolvedRange).toBeNull();

    const routed = service.recordRouteOutcome({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      targetCommit: 'target-routed',
      routeStatus: 'routed',
      scannedAt: 300,
    });
    expect(routed.advanced).toBe(true);
    expect(routed.checkpoint.checkpointCommit).toBe('target-routed');
    expect(routed.checkpoint.advancedAt).toBe(300);
  });
});

function completePlanIntent(): PlanIntent {
  return {
    projectProfile: {
      projectType: 'fixture',
      primaryLanguage: 'typescript',
      frameworks: [],
      moduleCount: 1,
      fileCount: 1,
      architectureHints: ['repository'],
    },
    dimensions: [
      {
        dimensionId: 'architecture',
        priority: 1,
        rationale: 'Checkpoint initialization fixture dimension.',
        stage: 'coldStart',
        targetRecipes: 1,
      },
    ],
    scale: {
      totalRecipeBudget: 1,
      perStage: { coldStart: 1, deepMining: 0, module: 0 },
      depthLevels: ['overview'],
    },
    moduleBindings: [
      {
        modulePath: 'src',
        moduleId: 'src',
        dimensions: ['architecture'],
        targetRecipes: 1,
        priority: 1,
      },
    ],
    stages: {
      coldStart: { dimensions: ['architecture'], breadthBudget: 1, depthBudget: 1 },
      deepMining: { dimensions: [] },
      moduleMining: {
        perModule: [
          {
            modulePath: 'src',
            moduleId: 'src',
            dimensions: ['architecture'],
            targetRecipes: 1,
            priority: 1,
          },
        ],
      },
    },
    plannedNextActions: [
      {
        tool: 'knowledge-rescan',
        reason: 'Checkpoint fixture route.',
        order: 1,
        dimensionIds: ['architecture'],
        modulePaths: ['src'],
      },
    ],
    evidenceRefs: [{ kind: 'human', ref: 'test' }],
    draftSource: 'host-agent',
  };
}

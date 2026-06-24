import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import {
  createCurrentGitHeadBaselineProvider,
  GitDiffCheckpointService,
} from '../src/evolution.js';
import { pathGuard } from '../src/io.js';
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

  it('initializes from the current HEAD baseline instead of guessing a git parent', () => {
    const repositories = createAlembicRepositories(runtime.connection);

    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: { getBaselineCommit: () => 'current-head-commit' },
    });
    const result = service.ensureCheckpoint({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      now: 200,
    });

    expect(result.source).toBe('current-head');
    expect(result.checkpoint.checkpointCommit).toBe('current-head-commit');
    expect(result.checkpoint.initialFromPlanCommit).toBe('current-head-commit');
    expect(result.checkpoint.lastRouteStatus).toBe('initialized');
  });

  it('initializes from a real git repository HEAD with the current-head source label', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const headCommit = createGitRepositoryHead(tmpDir);

    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: createCurrentGitHeadBaselineProvider(),
    });
    const result = service.ensureCheckpoint({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      now: 210,
    });

    expect(headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.source).toBe('current-head');
    expect(result.checkpoint.checkpointCommit).toBe(headCommit);
    expect(result.checkpoint.initialFromPlanCommit).toBe(headCommit);
    expect(result.checkpoint.lastRouteStatus).toBe('initialized');
  });

  it('repairs an existing empty checkpoint from the current HEAD baseline', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    repositories.gitDiffCheckpointRepository.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: null,
      initialFromPlanCommit: null,
      targetCommit: 'target-after-empty-row',
      lastRouteStatus: 'skipped',
      lastRouteReason: 'pre-confirm scan produced no dispatchable events',
      lastScannedAt: 150,
      createdAt: 80,
      updatedAt: 150,
    });

    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: { getBaselineCommit: () => 'current-head-commit' },
    });
    const result = service.ensureCheckpoint({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      now: 220,
    });

    expect(result.source).toBe('current-head');
    expect(result.checkpoint.checkpointCommit).toBe('current-head-commit');
    expect(result.checkpoint.initialFromPlanCommit).toBe('current-head-commit');
    expect(result.checkpoint.targetCommit).toBe('target-after-empty-row');
    expect(result.checkpoint.lastRouteStatus).toBe('skipped');
    expect(result.checkpoint.lastRouteReason).toBe(
      'pre-confirm scan produced no dispatchable events'
    );
    expect(result.checkpoint.createdAt).toBe(80);
    expect(result.checkpoint.updatedAt).toBe(220);
  });

  it('preserves an existing non-null checkpoint instead of replacing it from current HEAD', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    repositories.gitDiffCheckpointRepository.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: 'existing-checkpoint-commit',
      initialFromPlanCommit: 'existing-initial-commit',
      createdAt: 100,
      updatedAt: 100,
    });

    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: { getBaselineCommit: () => 'current-head-commit' },
    });
    const result = service.ensureCheckpoint({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      now: 220,
    });

    expect(result.source).toBe('existing-checkpoint');
    expect(result.checkpoint.checkpointCommit).toBe('existing-checkpoint-commit');
    expect(result.checkpoint.initialFromPlanCommit).toBe('existing-initial-commit');
    expect(result.checkpoint.updatedAt).toBe(100);
  });

  it('does not advance a repaired empty checkpoint on skipped route outcomes', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: { getBaselineCommit: () => 'current-head-commit' },
    });
    repositories.gitDiffCheckpointRepository.upsert({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      checkpointCommit: null,
      initialFromPlanCommit: null,
      targetCommit: 'pre-confirm-target',
      lastRouteStatus: 'skipped',
      createdAt: 100,
      updatedAt: 100,
    });

    const result = service.recordRouteOutcome({
      projectRoot: tmpDir,
      scopeId: 'rescan',
      folderId: 'src',
      targetCommit: 'changed-target',
      mergeBaseCommit: 'merge-base',
      routeStatus: 'skipped',
      scannedAt: 240,
    });

    expect(result.advanced).toBe(false);
    expect(result.checkpoint.checkpointCommit).toBe('current-head-commit');
    expect(result.checkpoint.initialFromPlanCommit).toBe('current-head-commit');
    expect(result.checkpoint.targetCommit).toBe('changed-target');
    expect(result.unresolvedRange).toEqual({
      fromCommit: 'current-head-commit',
      toCommit: 'changed-target',
      mergeBaseCommit: 'merge-base',
    });
  });

  it('does not advance on skipped, truncated, failed, or non-ancestor route outcomes', () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const service = new GitDiffCheckpointService({
      checkpointRepository: repositories.gitDiffCheckpointRepository,
      baselineProvider: { getBaselineCommit: () => null },
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
      baselineProvider: { getBaselineCommit: () => null },
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

function createGitRepositoryHead(projectRoot: string): string {
  runGit(projectRoot, ['init']);
  runGit(projectRoot, ['config', 'user.email', 'alembic-core-test@example.invalid']);
  runGit(projectRoot, ['config', 'user.name', 'Alembic Core Test']);
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# test repository\n');
  runGit(projectRoot, ['add', 'README.md']);
  runGit(projectRoot, ['commit', '-m', 'initial commit']);
  return runGit(projectRoot, ['rev-parse', 'HEAD']);
}

function runGit(projectRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

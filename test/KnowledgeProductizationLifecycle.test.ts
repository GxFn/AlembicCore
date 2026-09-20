import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  KnowledgeEntry,
  KnowledgeEntryProps,
} from '../src/domain/knowledge/KnowledgeEntry.js';
import type { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { EventBus } from '../src/infrastructure/event/EventBus.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import type { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import { FileWriteError } from '../src/repository/knowledge/KnowledgeUnitOfWork.js';
import { RecipeSourceRefRepositoryImpl } from '../src/repository/sourceref/RecipeSourceRefRepository.js';
import { ConfidenceRouter } from '../src/service/knowledge/ConfidenceRouter.js';
import type { KnowledgeFileWriter } from '../src/service/knowledge/KnowledgeFileWriter.js';
import { KnowledgeService } from '../src/service/knowledge/KnowledgeService.js';
import { KnowledgeSyncService } from '../src/service/knowledge/KnowledgeSyncService.js';
import { SourceRefReconciler } from '../src/service/knowledge/SourceRefReconciler.js';
import { ContentPatcher } from '../src/service/sustain/ContentPatcher.js';
import { LifecycleStateMachine } from '../src/service/sustain/LifecycleStateMachine.js';
import {
  RecipeImpactPlanner,
  toRescanImpactDecision,
} from '../src/service/sustain/RecipeImpactPlanner.js';
import { StagingManager } from '../src/service/sustain/StagingManager.js';
import { DivergenceError } from '../src/shared/errors/index.js';
import { createKnowledgeRuntime } from './support/knowledge-runtime.js';

describe('Knowledge productization lifecycle', () => {
  let env: Awaited<ReturnType<typeof createKnowledgeRuntime>>;
  let tmpDir: string;
  let connection: DatabaseConnection;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let eventRepo: LifecycleEventRepository;
  let stagingManager: StagingManager;
  let knowledgeService: KnowledgeService;
  let fileStore: KnowledgeFileWriter;
  let lifecycle: LifecycleStateMachine;
  let sourceRefRepo: RecipeSourceRefRepositoryImpl;
  let patcher: ContentPatcher;
  let eventBus: EventBus;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    env = await createKnowledgeRuntime();
    tmpDir = env.root;
    connection = env.runtime.connection;
    knowledgeRepo = env.repo;
    fileStore = env.writer;
    sourceRefRepo = new RecipeSourceRefRepositoryImpl(connection.getDrizzle());
    patcher = new ContentPatcher(knowledgeRepo, sourceRefRepo, { projectRoot: tmpDir, fileStore });
    eventRepo = new LifecycleEventRepository(connection.getDrizzle());
    const proposalRepo = new ProposalRepository(connection.getDrizzle());
    const signalBus = new SignalBus();
    lifecycle = new LifecycleStateMachine(
      knowledgeRepo,
      eventRepo,
      signalBus,
      proposalRepo,
      () => ({
        ready: true,
        schemaVersion: '1',
        profileHash: null,
        documentSetHash: null,
        violations: [],
        warnings: [],
      }),
      { fileStore }
    );
    stagingManager = new StagingManager(knowledgeRepo, { signalBus, lifecycle, fileStore });
    eventBus = new EventBus();
    knowledgeService = new KnowledgeService(knowledgeRepo, { log: async () => {} }, null, null, {
      confidenceRouter: new ConfidenceRouter(),
      fileWriter: fileStore,
      eventBus,
      retrievalReadinessEvaluator: () => ({
        ready: true,
        schemaVersion: '1',
        profileHash: null,
        documentSetHash: null,
        violations: [],
        warnings: [],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
  });

  it('keeps staging deadlines through file sync and promotes due entries through lifecycle events', async () => {
    const created = await knowledgeService.create(
      {
        title: 'BiliDili module lifecycle layering',
        description: 'Source-grounded architecture recipe.',
        language: 'swift',
        category: 'architecture',
        knowledgeType: 'code-pattern',
        source: 'host-agent',
        content: {
          markdown:
            'BiliDili keeps startup module registration, routing, and service protocols separated so future module changes preserve composition boundaries.',
        },
        reasoning: {
          whyStandard:
            'The same architecture rule is grounded in AppDelegate and module source refs.',
          sources: ['BiliDili/AppDelegate.swift:51', 'BiliDili/Modules/RouterModule.swift:31'],
          confidence: 0.92,
        },
      },
      { userId: 'host-agent' }
    );

    const initial = connection
      .getDb()
      .prepare(
        'SELECT lifecycle, autoApprovable, staging_deadline FROM knowledge_entries WHERE id = ?'
      )
      .get(created.id) as {
      lifecycle: string;
      autoApprovable: number;
      staging_deadline: number | null;
    };

    expect(initial.lifecycle).toBe('staging');
    expect(initial.autoApprovable).toBe(1);
    expect(initial.staging_deadline).toBeGreaterThan(Date.now());

    const sync = new KnowledgeSyncService(tmpDir);
    const syncReport = await sync.syncAll(connection.getDb(), {
      force: true,
      skipViolations: true,
    });
    expect(syncReport.synced).toBe(1);

    const afterSync = connection
      .getDb()
      .prepare('SELECT staging_deadline FROM knowledge_entries WHERE id = ?')
      .get(created.id) as { staging_deadline: number | null };
    expect(afterSync.staging_deadline).toBe(initial.staging_deadline);

    const dueDeadline = Date.now() - 1_000;
    connection
      .getDb()
      .prepare('UPDATE knowledge_entries SET staging_deadline = ? WHERE id = ?')
      .run(dueDeadline, created.id);

    const promoted = await stagingManager.checkAndPromote();
    expect(promoted.promoted.map((entry) => entry.id)).toEqual([created.id]);

    const finalRow = connection
      .getDb()
      .prepare(
        'SELECT lifecycle, publishedBy, staging_deadline FROM knowledge_entries WHERE id = ?'
      )
      .get(created.id) as {
      lifecycle: string;
      publishedBy: string;
      staging_deadline: number | null;
    };
    expect(finalRow).toMatchObject({
      lifecycle: 'active',
      publishedBy: 'StagingManager',
      staging_deadline: null,
    });

    const events = connection
      .getDb()
      .prepare(
        'SELECT from_state, to_state, trigger, operator_id FROM lifecycle_transition_events WHERE recipe_id = ?'
      )
      .all(created.id);
    expect(events).toEqual([
      {
        from_state: 'staging',
        to_state: 'active',
        trigger: 'grace-period-expire',
        operator_id: 'StagingManager',
      },
    ]);

    // 真相文件必须包含晋级结果和发布元数据；再次同步不能把 active 回滚为 staging。
    await sync.syncAll(connection.getDb());
    expect(await knowledgeRepo.findById(created.id)).toMatchObject({
      lifecycle: 'active',
      publishedBy: 'StagingManager',
      stagingDeadline: null,
      stats: { activeSince: expect.any(Number) },
    });
  });

  it('persists review failure and rollback through file sync', async () => {
    const entry = await createPersistedEntry({
      lifecycle: 'staging',
      autoApprovable: true,
      stagingDeadline: Date.now() - 1000,
    });
    await stagingManager.recordReview(entry.id, {
      outcome: 'fail',
      notes: 'Source contradicts rule',
    });
    const sync = new KnowledgeSyncService(tmpDir);
    await sync.syncAll(connection.getDb());
    expect(knowledgeRepo.getStagingReviewSync(entry.id)?.outcome).toBe('fail');

    const result = await stagingManager.checkAndPromote();
    expect(result.rolledBack.map((item) => item.id)).toEqual([entry.id]);
    expect(result.promoted).toEqual([]);
    await sync.syncAll(connection.getDb());
    expect(await knowledgeRepo.findById(entry.id)).toMatchObject({
      lifecycle: 'pending',
      stagingDeadline: null,
      stats: { stagingReview: { outcome: 'fail' } },
    });
  });

  it('persists staging entry and evolution clocks through file sync', async () => {
    const entry = await createPersistedEntry({ lifecycle: 'pending' });
    await stagingManager.enterStaging(entry.id, 60_000, 0.9);
    const sync = new KnowledgeSyncService(tmpDir);
    await sync.syncAll(connection.getDb());
    expect(await knowledgeRepo.findById(entry.id)).toMatchObject({
      lifecycle: 'staging',
      stagingDeadline: expect.any(Number),
    });
    await lifecycle.transition({
      recipeId: entry.id,
      targetState: 'active',
      trigger: 'grace-period-expire',
    });
    await lifecycle.transition({
      recipeId: entry.id,
      targetState: 'evolving',
      trigger: 'proposal-attach',
      proposalId: 'proposal-clock',
    });
    await sync.syncAll(connection.getDb());
    expect(await knowledgeRepo.findById(entry.id)).toMatchObject({
      lifecycle: 'evolving',
      stats: {
        lastActiveAt: expect.any(Number),
        evolvingStartedAt: expect.any(Number),
        evolvingProposalId: 'proposal-clock',
      },
    });
  });

  it('persists patched content and authoritative reasoning sources through sync and reconciliation', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'old.ts'), 'export const oldValue = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'new.ts'), 'export const newValue = 2;\n');
    const entry = await createPersistedEntry({
      reasoning: {
        whyStandard: 'Preserve this reasoning',
        sources: ['src/old.ts:1'],
        confidence: 0.9,
      },
    });
    const reconciler = new SourceRefReconciler(tmpDir, sourceRefRepo, knowledgeRepo);
    await reconciler.reconcileRecipeSourceRefs(entry);
    const result = await patcher.applyProposal({
      id: 'source-patch',
      type: 'update',
      targetRecipeId: entry.id,
      evidence: [
        {
          suggestedChanges: JSON.stringify({
            patchVersion: 1,
            changes: [
              {
                field: 'content.markdown',
                action: 'replace',
                newValue: 'Updated evidence-backed content',
              },
              {
                field: 'sourceRefs',
                action: 'replace',
                newValue: JSON.stringify(['src/new.ts:1']),
              },
            ],
          }),
        },
      ],
    });
    expect(result.success).toBe(true);
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
    const refreshed = (await knowledgeRepo.findById(entry.id))!;
    expect(refreshed.content.markdown).toBe('Updated evidence-backed content');
    expect(refreshed.reasoning).toMatchObject({
      whyStandard: 'Preserve this reasoning',
      sources: ['src/new.ts:1'],
      confidence: 0.9,
    });
    await reconciler.reconcileRecipeSourceRefs(refreshed);
    expect(sourceRefRepo.findByRecipeId(entry.id).map((ref) => ref.sourcePath)).toEqual([
      'src/new.ts:1',
    ]);
  });

  it.each([
    true,
    false,
  ])('preserves legacy bridge refs on content-only patches and honors explicit clearing (fileStore=%s)', async (withFileStore) => {
    const entry = await createPersistedEntry({ reasoning: { sources: [] } });
    sourceRefRepo.upsert({
      recipeId: entry.id,
      sourcePath: 'src/legacy.ts:1',
      status: 'drifted',
      verifiedAt: 1234,
      contentFp: 'legacy-fingerprint',
    });
    const before = sourceRefRepo.findByRecipeId(entry.id);
    const currentPatcher = new ContentPatcher(knowledgeRepo, sourceRefRepo, {
      projectRoot: tmpDir,
      ...(withFileStore ? { fileStore } : {}),
    });
    const proposal = (field: string, newValue: string) => ({
      id: 'legacy-refs-patch',
      type: 'update',
      targetRecipeId: entry.id,
      evidence: [
        {
          suggestedChanges: JSON.stringify({
            patchVersion: 1,
            changes: [{ field, action: 'replace', newValue }],
          }),
        },
      ],
    });
    expect(
      (await currentPatcher.applyProposal(proposal('content.markdown', 'Updated legacy content')))
        .success
    ).toBe(true);
    expect(sourceRefRepo.findByRecipeId(entry.id)).toEqual(before);
    expect((await knowledgeRepo.findById(entry.id))?.reasoning.sources).toEqual([]);
    if (withFileStore) {
      await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
      expect((await knowledgeRepo.findById(entry.id))?.reasoning.sources).toEqual([]);
      expect(sourceRefRepo.findByRecipeId(entry.id)).toEqual(before);
    }
    expect((await currentPatcher.applyProposal(proposal('sourceRefs', '[]'))).success).toBe(true);
    expect(sourceRefRepo.findByRecipeId(entry.id)).toEqual([]);
    expect((await knowledgeRepo.findById(entry.id))?.reasoning.sources).toEqual([]);
  });

  it('does not mutate the DB or emit a transition when the real durable write fails', async () => {
    const entry = await createPersistedEntry({ lifecycle: 'active' });
    const before = (await knowledgeRepo.findById(entry.id))!.toJSON();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk rename failed');
    });

    await expect(
      lifecycle.transition({
        recipeId: entry.id,
        targetState: 'decaying',
        trigger: 'decay-detection',
      })
    ).rejects.toBeInstanceOf(FileWriteError);
    expect((await knowledgeRepo.findById(entry.id))!.toJSON()).toEqual(before);
    expect(eventRepo.getHistory(entry.id)).toEqual([]);
  });

  it('reports typed divergence after a durable file write but failed DB update, and sync repairs it', async () => {
    const entry = await createPersistedEntry({ lifecycle: 'pending' });
    const update = vi
      .spyOn(knowledgeRepo, 'update')
      .mockRejectedValueOnce(new Error('database failure'));

    await expect(stagingManager.enterStaging(entry.id, 60_000, 0.9)).rejects.toBeInstanceOf(
      DivergenceError
    );
    expect((await knowledgeRepo.findById(entry.id))?.lifecycle).toBe('pending');
    update.mockRestore();
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
    expect((await knowledgeRepo.findById(entry.id))?.lifecycle).toBe('staging');
  });

  async function createPersistedEntry(
    overrides: KnowledgeEntryProps = {}
  ): Promise<KnowledgeEntry> {
    return env.seed({
      title: 'Durable lifecycle fixture',
      category: 'architecture',
      lifecycle: 'active',
      content: { markdown: 'Original durable content' },
      ...overrides,
    });
  }

  it('reports divergence when a concurrent deletion removes the real update readback', async () => {
    const entry = await createPersistedEntry({ lifecycle: 'pending' });
    const persist = fileStore.persist.bind(fileStore);
    const findById = knowledgeRepo.findById.bind(knowledgeRepo);
    let fileWritten = false;
    let readsAfterWrite = 0;
    const fileSpy = vi.spyOn(fileStore, 'persist').mockImplementation((prospective) => {
      const result = persist(prospective);
      fileWritten = result !== null;
      return result;
    });
    const readSpy = vi.spyOn(knowledgeRepo, 'findById').mockImplementation(async (id) => {
      // update 的第一次读取拿旧行，真实 SQL UPDATE 后、第二次读回前模拟并发删除。
      if (fileWritten && ++readsAfterWrite === 2) {
        connection.getDb().prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
      }
      return findById(id);
    });

    await expect(stagingManager.enterStaging(entry.id, 60_000, 0.9)).rejects.toBeInstanceOf(
      DivergenceError
    );
    fileSpy.mockRestore();
    readSpy.mockRestore();
    expect(await knowledgeRepo.findById(entry.id)).toBeNull();
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
    expect((await knowledgeRepo.findById(entry.id))?.lifecycle).toBe('staging');
  });

  it.each([
    ['content', { markdown: 'Edited Markdown content', rationale: 'Why this changed' }],
    ['reasoning', { whyStandard: 'Edited reasoning', sources: ['src/new.ts:1'], confidence: 0.8 }],
    ['constraints', { boundaries: ['Only during an active transaction'] }],
    ['relations', { related: [{ target: 'other-recipe', description: 'Shared responsibility' }] }],
  ] as const)('updates the %s value object through the real file writer', async (field, value) => {
    const entry = await createPersistedEntry();

    await knowledgeService.update(entry.id, { [field]: value }, { userId: 'editor' });
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());

    expect((await knowledgeService.get(entry.id)).toJSON()).toMatchObject({ [field]: value });
  });

  it('updates usageGuide through its advertised scalar update field', async () => {
    const entry = await createPersistedEntry();
    await knowledgeService.update(
      entry.id,
      { usageGuide: 'Updated usage instructions' },
      { userId: 'editor' }
    );
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
    expect((await knowledgeService.get(entry.id)).usageGuide).toBe('Updated usage instructions');
  });

  it.each([
    [undefined, 'adoptions'],
    ['adoption', 'adoptions'],
    ['application', 'applications'],
    ['view', 'views'],
    ['adoptions', 'adoptions'],
    ['applications', 'applications'],
    ['views', 'views'],
    ['guardHits', 'guardHits'],
    ['searchHits', 'searchHits'],
  ] as const)('persists usage operation %s in counter %s, including file sync', async (operation, counter) => {
    const entry = await createPersistedEntry();
    await knowledgeService.incrementUsage(entry.id, operation);
    expect((await knowledgeService.get(entry.id)).stats[counter]).toBe(1);
    await new KnowledgeSyncService(tmpDir).syncAll(connection.getDb());
    expect((await knowledgeService.get(entry.id)).stats[counter]).toBe(1);
  });

  it('keeps feedback audit-only and rejects unknown usage operations without changing counters', async () => {
    const entry = await createPersistedEntry();
    const log = vi.spyOn(knowledgeService.auditLogger, 'log');
    const before = (await knowledgeService.get(entry.id)).stats.toJSON();
    await knowledgeService.incrementUsage(entry.id, 'feedback', {
      actor: 'reviewer',
      feedback: 'Useful',
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_feedback',
        details: JSON.stringify({ feedback: 'Useful' }),
      })
    );
    await expect(knowledgeService.incrementUsage(entry.id, 'unknown-counter')).rejects.toThrow(
      'Unknown knowledge usage type'
    );
    expect((await knowledgeService.get(entry.id)).stats.toJSON()).toEqual(before);
  });

  it.each([
    'needs_review',
    '100%',
    'path\\segment',
    'quoted"tag',
  ])('matches the literal tag %s through the public list API', async (tag) => {
    const entry = await createPersistedEntry();
    await knowledgeService.update(entry.id, { tags: [tag] }, { userId: 'editor' });
    await knowledgeService.create(
      {
        title: 'Different tags',
        content: { markdown: 'A distinct tag fixture.' },
        tags: ['needsXreview', '100-percent', 'unrelated'],
      },
      { userId: 'editor' }
    );

    const result = await knowledgeService.list({ tag });
    expect(result.data.map((item) => item.id)).toEqual([entry.id]);
  });

  it.each([
    {
      sources: ['src/watched.ts:1'],
      files: ['src/watched.ts'],
      deleted: ['src/watched.ts'],
      reason: 'source-deleted',
      active: 0,
    },
    {
      sources: ['src/watched.ts#L1'],
      files: ['src/watched.ts'],
      deleted: ['src/watched.ts'],
      reason: 'source-deleted',
      active: 0,
    },
    {
      sources: ['src/first.ts:1', 'src/second.ts:1'],
      files: ['src/first.ts', 'src/second.ts'],
      deleted: ['src/first.ts', 'src/second.ts'],
      reason: 'source-deleted',
      active: 0,
    },
    {
      sources: ['src/first.ts:1', 'src/second.ts:1'],
      files: ['src/first.ts', 'src/second.ts'],
      deleted: ['src/first.ts'],
      reason: 'source-deleted-partial',
      active: 1,
    },
  ])('plans $reason for line-bounded source refs $sources', async (scenario) => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    for (const file of scenario.files) {
      fs.writeFileSync(path.join(tmpDir, file), 'export const value = 1;\n');
    }
    const entry = await createPersistedEntry({
      reasoning: {
        whyStandard: 'Track real source files',
        sources: scenario.sources,
        confidence: 0.9,
      },
    });
    await new SourceRefReconciler(tmpDir, sourceRefRepo, knowledgeRepo).reconcileRecipeSourceRefs(
      entry
    );
    for (const file of scenario.deleted) {
      fs.unlinkSync(path.join(tmpDir, file));
    }

    const plan = await new RecipeImpactPlanner(tmpDir, sourceRefRepo, knowledgeRepo).plan({
      added: [],
      modified: [],
      deleted: scenario.deleted,
    });
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      recipeId: entry.id,
      reason: scenario.reason,
      activeRefCount: scenario.active,
      sourceRefs: scenario.sources,
      affectedFiles: scenario.deleted,
    });
  });

  it.each([
    'drifted',
    'renamed',
    'renamed-target-deleted',
  ] as const)('does not classify surviving %s evidence as all source files lost', async (status) => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    for (const file of ['gone.ts', 'retained.ts']) {
      fs.writeFileSync(path.join(tmpDir, 'src', file), 'export const value = 1;\n');
    }
    const entry = await createPersistedEntry({
      reasoning: { sources: ['src/gone.ts:1', 'src/retained.ts:1'], confidence: 0.9 },
    });
    const reconciler = new SourceRefReconciler(tmpDir, sourceRefRepo, knowledgeRepo);
    await reconciler.reconcileRecipeSourceRefs(entry);
    const deleted = ['src/gone.ts'];
    if (status === 'drifted') {
      fs.writeFileSync(path.join(tmpDir, 'src/retained.ts'), 'export const value = 2;\n');
      await reconciler.reconcileRecipeSourceRefs(entry);
      expect(sourceRefRepo.findOne(entry.id, 'src/retained.ts:1')?.status).toBe('drifted');
    } else {
      fs.renameSync(path.join(tmpDir, 'src/retained.ts'), path.join(tmpDir, 'src/renamed.ts'));
      sourceRefRepo.upsert({
        recipeId: entry.id,
        sourcePath: 'src/retained.ts:1',
        status: 'renamed',
        newPath: 'src/renamed.ts:1',
        verifiedAt: Date.now(),
      });
      deleted.push('src/retained.ts');
      if (status === 'renamed-target-deleted') {
        fs.unlinkSync(path.join(tmpDir, 'src/renamed.ts'));
        deleted.push('src/renamed.ts');
      }
    }
    fs.unlinkSync(path.join(tmpDir, 'src/gone.ts'));

    const plan = await new RecipeImpactPlanner(tmpDir, sourceRefRepo, knowledgeRepo).plan({
      added: [],
      modified: [],
      deleted,
    });
    const allLost = status === 'renamed-target-deleted';
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      reason: allLost ? 'source-deleted' : 'source-deleted-partial',
      activeRefCount: 0,
      impactScore: allLost ? 1 : 0.7,
    });
    if (allLost) {
      expect(toRescanImpactDecision(plan.candidates[0])?.action).toBe('deprecate');
    } else {
      expect(toRescanImpactDecision(plan.candidates[0])).toBeNull();
    }
  });

  it('deprecates an orphan for an empty corpus and awaits authoritative vector maintenance', async () => {
    const created = await knowledgeService.create(
      {
        title: 'Recipe whose source is removed',
        description: 'Fixture for direct sync orphan maintenance.',
        language: 'typescript',
        category: 'architecture',
        knowledgeType: 'code-pattern',
        source: 'host-agent',
        content: { markdown: 'A source-backed recipe.' },
        reasoning: { whyStandard: 'Fixture', sources: ['src/example.ts:1'] },
      },
      { userId: 'host-agent' }
    );
    fs.rmSync(path.join(tmpDir, 'Alembic'), { recursive: true, force: true });

    let releaseMaintenance!: () => void;
    const reconcileAuthoritativeCorpus = vi.fn(
      () =>
        new Promise<{ recipeRegionOrphansRemoved: number }>((resolve) => {
          releaseMaintenance = () => resolve({ recipeRegionOrphansRemoved: 2 });
        })
    );
    const sync = new KnowledgeSyncService(tmpDir, {
      vectorMaintenance: { reconcileAuthoritativeCorpus },
    });
    let settled = false;
    const syncPromise = sync.syncAll(connection.getDb()).then((report) => {
      settled = true;
      return report;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    releaseMaintenance();
    const report = await syncPromise;

    expect(report.orphaned).toEqual([created.id]);
    expect(report.vectorMaintenanceStatus).toBe('completed');
    expect(report.vectorMaintenanceReport).toEqual({ recipeRegionOrphansRemoved: 2 });
    expect(reconcileAuthoritativeCorpus).toHaveBeenCalledOnce();
    const row = connection
      .getDb()
      .prepare('SELECT lifecycle FROM knowledge_entries WHERE id = ?')
      .get(created.id) as { lifecycle: string };
    expect(row.lifecycle).toBe('deprecated');
  });

  it('emits current DB truth for publish, deprecate, and reactivate vector maintenance', async () => {
    const transitions: Array<Record<string, unknown>> = [];
    eventBus.on('lifecycle:transition', (payload) => {
      transitions.push(payload as Record<string, unknown>);
    });
    const created = await knowledgeService.create(
      {
        title: 'Lifecycle vector event recipe',
        description: 'Carries current DB truth through lifecycle events.',
        language: 'typescript',
        category: 'architecture',
        knowledgeType: 'code-pattern',
        source: 'host-agent',
        content: { markdown: 'Valid recipe body.' },
        reasoning: { whyStandard: 'Fixture', sources: ['src/lifecycle.ts:1'] },
      },
      { userId: 'host-agent' }
    );

    await knowledgeService.publish(created.id, { userId: 'publisher' });
    await knowledgeService.deprecate(created.id, 'obsolete fixture', { userId: 'publisher' });
    await knowledgeService.reactivate(created.id, { userId: 'publisher' });

    expect(
      transitions.map((transition) => ({
        to: transition.to,
        entryLifecycle: (transition.entry as { lifecycle: string }).lifecycle,
        entryId: (transition.entry as { id: string }).id,
      }))
    ).toEqual([
      { to: 'active', entryLifecycle: 'active', entryId: created.id },
      { to: 'deprecated', entryLifecycle: 'deprecated', entryId: created.id },
      { to: 'pending', entryLifecycle: 'pending', entryId: created.id },
    ]);
  });
});

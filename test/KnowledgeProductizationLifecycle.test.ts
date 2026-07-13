import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { EventBus } from '../src/infrastructure/event/EventBus.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import { ConfidenceRouter } from '../src/service/knowledge/ConfidenceRouter.js';
import { KnowledgeFileWriter } from '../src/service/knowledge/KnowledgeFileWriter.js';
import { KnowledgeService } from '../src/service/knowledge/KnowledgeService.js';
import { KnowledgeSyncService } from '../src/service/knowledge/KnowledgeSyncService.js';
import { LifecycleStateMachine } from '../src/service/sustain/LifecycleStateMachine.js';
import { StagingManager } from '../src/service/sustain/StagingManager.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('Knowledge productization lifecycle', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let eventRepo: LifecycleEventRepository;
  let stagingManager: StagingManager;
  let knowledgeService: KnowledgeService;
  let eventBus: EventBus;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-p6-lifecycle-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });

    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();

    knowledgeRepo = new KnowledgeRepositoryImpl(connection);
    eventRepo = new LifecycleEventRepository(connection.getDrizzle());
    const proposalRepo = new ProposalRepository(connection.getDrizzle());
    const signalBus = new SignalBus();
    const lifecycle = new LifecycleStateMachine(
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
      })
    );
    stagingManager = new StagingManager(knowledgeRepo, { signalBus, lifecycle });
    eventBus = new EventBus();
    knowledgeService = new KnowledgeService(knowledgeRepo, { log: async () => {} }, null, null, {
      confidenceRouter: new ConfidenceRouter(),
      fileWriter: new KnowledgeFileWriter(tmpDir),
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
    connection.close();
    resetDrizzle();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

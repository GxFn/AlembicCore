import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import { LifecycleStateMachine } from '../src/service/evolution/LifecycleStateMachine.js';
import { StagingManager } from '../src/service/evolution/StagingManager.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('StagingManager lifecycle promotion', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let eventRepo: LifecycleEventRepository;
  let stagingManager: StagingManager;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-staging-'));
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
    const lifecycle = new LifecycleStateMachine(knowledgeRepo, eventRepo, signalBus, proposalRepo);
    stagingManager = new StagingManager(knowledgeRepo, { signalBus, lifecycle });
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

  it('promotes only due auto-approvable staging recipes through lifecycle events', async () => {
    const now = Date.now();
    const dueAuto = await createStagingRecipe('due-auto', now - 1_000, true);
    const futureAuto = await createStagingRecipe('future-auto', now + 60_000, true);
    const dueManual = await createStagingRecipe('due-manual', now - 1_000, false);

    const result = await stagingManager.checkAndPromote();

    expect(result.promoted.map((entry) => entry.id)).toEqual([dueAuto.id]);
    expect(result.waiting.map((entry) => entry.id).sort()).toEqual(
      [dueManual.id, futureAuto.id].sort()
    );

    const promoted = await knowledgeRepo.findById(dueAuto.id);
    const notDue = await knowledgeRepo.findById(futureAuto.id);
    const nonAuto = await knowledgeRepo.findById(dueManual.id);

    expect(promoted?.lifecycle).toBe('active');
    expect(promoted?.publishedAt).toBeGreaterThan(0);
    expect(promoted?.publishedBy).toBe('StagingManager');
    expect(promoted?.stagingDeadline).toBeNull();

    expect(notDue?.lifecycle).toBe('staging');
    expect(notDue?.stagingDeadline).toBe(now + 60_000);
    expect(nonAuto?.lifecycle).toBe('staging');
    expect(nonAuto?.stagingDeadline).toBe(now - 1_000);

    const events = eventRepo.getHistory(dueAuto.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      recipeId: dueAuto.id,
      fromState: 'staging',
      toState: 'active',
      trigger: 'grace-period-expire',
      operatorId: 'StagingManager',
      evidence: {
        reason: 'staging deadline expired and recipe is auto-approvable',
      },
    });
    expect(eventRepo.getHistory(futureAuto.id)).toHaveLength(0);
    expect(eventRepo.getHistory(dueManual.id)).toHaveLength(0);
  });

  async function createStagingRecipe(
    title: string,
    stagingDeadline: number,
    autoApprovable: boolean
  ): Promise<KnowledgeEntry> {
    const entry = new KnowledgeEntry({
      title,
      description: `${title} recipe`,
      lifecycle: 'staging',
      autoApprovable,
      stagingDeadline,
      language: 'typescript',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      content: {
        pattern: `Pattern for ${title}`,
        rationale: 'Exercise staging lifecycle promotion.',
      },
      reasoning: {
        whyStandard: 'Test recipe with grade-A quality.',
        sources: ['test/StagingManager.test.ts'],
        confidence: 0.95,
      },
      quality: {
        overall: 0.95,
        correctness: 0.95,
        completeness: 0.95,
        clarity: 0.95,
      },
    });

    const created = await knowledgeRepo.create(entry);
    expect(created).not.toBeNull();
    return created ?? entry;
  }
});

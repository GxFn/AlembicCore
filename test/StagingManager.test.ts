import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import { LifecycleStateMachine } from '../src/service/sustain/LifecycleStateMachine.js';
import { StagingManager } from '../src/service/sustain/StagingManager.js';
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

  // ───────────── staging 复核期（2026-07-06 observe-first）三态用例 ─────────────

  it('review outcome fail rolls a due auto-approvable entry back to pending instead of promoting', async () => {
    const now = Date.now();
    const failing = await createStagingRecipe('review-fail', now - 1_000, true);
    const passing = await createStagingRecipe('review-pass', now - 1_000, true);
    const unreviewed = await createStagingRecipe('review-missing', now - 1_000, true);

    expect(
      await stagingManager.recordReview(failing.id, { outcome: 'fail', notes: '断言与源码不符' })
    ).toBe(true);
    expect(
      await stagingManager.recordReview(passing.id, { outcome: 'pass', reviewer: 'host-agent' })
    ).toBe(true);

    const result = await stagingManager.checkAndPromote();

    expect(result.rolledBack.map((entry) => entry.id)).toEqual([failing.id]);
    expect(result.promoted.map((entry) => entry.id).sort()).toEqual(
      [passing.id, unreviewed.id].sort()
    );

    const rolled = await knowledgeRepo.findById(failing.id);
    expect(rolled?.lifecycle).toBe('pending');
    expect(rolled?.stagingDeadline).toBeNull();
    const promotedPass = await knowledgeRepo.findById(passing.id);
    expect(promotedPass?.lifecycle).toBe('active');
    const promotedMissing = await knowledgeRepo.findById(unreviewed.id);
    // missing 向后兼容：无复核结论不阻断既有 grace 晋级
    expect(promotedMissing?.lifecycle).toBe('active');
  });

  it('listReviewQueue returns staging entries awaiting review with assertion content + sources, excluding reviewed', async () => {
    const now = Date.now();
    const pending = await createStagingRecipe('queue-pending', now + 60_000, true);
    const reviewed = await createStagingRecipe('queue-reviewed', now + 60_000, true);
    await stagingManager.recordReview(reviewed.id, { outcome: 'pass', reviewer: 'host-agent' });

    const queue = await stagingManager.listReviewQueue();
    const ids = queue.map((item) => item.id);
    expect(ids).toContain(pending.id);
    // 已有 pass/fail 结论的条目不在待复核队列（与 checkAndPromote 三态门口径一致）
    expect(ids).not.toContain(reviewed.id);

    const item = queue.find((q) => q.id === pending.id);
    expect(item?.title).toBe('queue-pending');
    // reasoning.sources 作为「断言 vs 源码」的引用位置交付宿主
    expect(item?.sources).toEqual(['test/StagingManager.test.ts']);
    // 断言四要素字段恒在场（本 fixture 未设则返回空串而非 undefined，宿主可稳定解析）
    expect(item).toMatchObject({
      whenClause: expect.any(String),
      doClause: expect.any(String),
      dontClause: expect.any(String),
      coreCode: expect.any(String),
    });
  });

  it('recordReview rejects entries that are not in staging', async () => {
    const now = Date.now();
    const entry = await createStagingRecipe('active-entry', now - 1_000, true);
    await stagingManager.checkAndPromote(); // 先晋级到 active
    expect(await stagingManager.recordReview(entry.id, { outcome: 'fail' })).toBe(false);
    const stillActive = await knowledgeRepo.findById(entry.id);
    expect(stillActive?.lifecycle).toBe('active');
  });

  // ───────────────── P1 tick 有界化（cap/limit）补充用例 ─────────────────

  it('(a) checkAndPromote(N) 在 >N 条到期 staging 下只晋级 ≤N（取最旧 N）', async () => {
    const past = Date.now() - 1_000;
    // 4 条均到期 + autoApprovable；createdAt 升序 = 晋级优先级
    await createStagingRecipe('cap-a-1', past, true, 100);
    await createStagingRecipe('cap-a-2', past, true, 200);
    await createStagingRecipe('cap-a-3', past, true, 300);
    await createStagingRecipe('cap-a-4', past, true, 400);

    const result = await stagingManager.checkAndPromote(2);

    expect(result.promoted).toHaveLength(2);
    expect(result.promoted.map((e) => e.title)).toEqual(['cap-a-1', 'cap-a-2']);
    // 仍有 2 条留在 staging（证明只晋级了 cap 条，未全表晋级）
    const remaining = await knowledgeRepo.findAllByLifecycles(['staging']);
    expect(remaining.map((e) => e.title).sort()).toEqual(['cap-a-3', 'cap-a-4']);
  });

  it('(b) 重复 checkAndPromote(N) 按最旧优先跨 tick 排空积压', async () => {
    const past = Date.now() - 1_000;
    // 乱序插入；createdAt 决定排空顺序
    await createStagingRecipe('drain-300', past, true, 300);
    await createStagingRecipe('drain-100', past, true, 100);
    await createStagingRecipe('drain-500', past, true, 500);
    await createStagingRecipe('drain-200', past, true, 200);
    await createStagingRecipe('drain-400', past, true, 400);

    const first = await stagingManager.checkAndPromote(2);
    expect(first.promoted.map((e) => e.title)).toEqual(['drain-100', 'drain-200']);

    const second = await stagingManager.checkAndPromote(2);
    expect(second.promoted.map((e) => e.title)).toEqual(['drain-300', 'drain-400']);

    const third = await stagingManager.checkAndPromote(2);
    expect(third.promoted.map((e) => e.title)).toEqual(['drain-500']);

    const remaining = await knowledgeRepo.findAllByLifecycles(['staging']);
    expect(remaining).toHaveLength(0);
  });

  it('(c) checkAndPromote() 不传 cap 时仍无界（晋级全部到期项，保留现行行为）', async () => {
    const past = Date.now() - 1_000;
    await createStagingRecipe('unbounded-1', past, true, 100);
    await createStagingRecipe('unbounded-2', past, true, 200);
    await createStagingRecipe('unbounded-3', past, true, 300);
    await createStagingRecipe('unbounded-4', past, true, 400);

    const result = await stagingManager.checkAndPromote();

    expect(result.promoted).toHaveLength(4);
    const remaining = await knowledgeRepo.findAllByLifecycles(['staging']);
    expect(remaining).toHaveLength(0);
  });

  it('(d-seam) checkAndPromote 把 cap 作为 limit 透传给仓储查询（capped 路径不做全表读取）', async () => {
    const spy = vi.spyOn(knowledgeRepo, 'findAllByLifecycles');

    await stagingManager.checkAndPromote(3);
    expect(spy).toHaveBeenLastCalledWith(['staging'], 3);

    await stagingManager.checkAndPromote();
    expect(spy).toHaveBeenLastCalledWith(['staging'], undefined);

    spy.mockRestore();
  });

  it('(d-sql) findAllByLifecycles(limit) 用 SQL ORDER BY createdAt + LIMIT 取最旧 N（非 JS 全表切片）', async () => {
    const future = Date.now() + 60_000;
    // 乱序插入 createdAt；若实现为 .all() 后 JS slice(0,N)，将得到插入顺序前 N 条而非最旧 N 条
    await createStagingRecipe('bound-500', future, false, 500);
    await createStagingRecipe('bound-100', future, false, 100);
    await createStagingRecipe('bound-400', future, false, 400);
    await createStagingRecipe('bound-200', future, false, 200);
    await createStagingRecipe('bound-300', future, false, 300);

    const limited = await knowledgeRepo.findAllByLifecycles(['staging'], 2);
    expect(limited.map((e) => e.createdAt)).toEqual([100, 200]);
    expect(limited.map((e) => e.title)).toEqual(['bound-100', 'bound-200']);

    // 不传 limit → 无界，返回全部 5 条
    const all = await knowledgeRepo.findAllByLifecycles(['staging']);
    expect(all).toHaveLength(5);
  });

  async function createStagingRecipe(
    title: string,
    stagingDeadline: number,
    autoApprovable: boolean,
    createdAt?: number
  ): Promise<KnowledgeEntry> {
    const entry = new KnowledgeEntry({
      title,
      description: `${title} recipe`,
      lifecycle: 'staging',
      autoApprovable,
      stagingDeadline,
      // P1 有界化测试：显式 createdAt 用于验证「最旧优先」排序；未传则由实体回退到当前秒级时间
      createdAt,
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

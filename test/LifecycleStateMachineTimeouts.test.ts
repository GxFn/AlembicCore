/**
 * LifecycleStateMachine.checkTimeouts(cap?) 单元测试 — P2 有界化
 *
 * 覆盖：
 *  - 无 cap：evolving>7d→active、pending/decaying>30d→deprecated、staging 不被触碰、迁移记 transition 事件。
 *  - cap：单 tick 扫描+迁移 ≤cap（无全表 .all()）、多 tick 按最旧优先排空、预算跨 timeout 状态共享。
 *  - spy seam：cap 模式把剩余预算作为 limit 透传给查询，无 cap 透传 undefined，staging 从不被查询。
 *  - 无 cap 仍无界。
 *
 * 说明：当前 checkTimeouts 的「卡死时长」实际走 #getRecipeAge = now(ms) - updatedAt（Stats 值对象
 * 固定 schema、不保留 evolvingStartedAt 等临时 meta 键，故 enteredAt 恒为 undefined）。本测试以回填
 * ms 级 updatedAt 确定性构造卡死时长；这是现状行为，P2 仅加 cap 有界、不改「何时迁移」语义。
 */
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
import { LifecycleStateMachine } from '../src/service/evolution/LifecycleStateMachine.js';
import pathGuard from '../src/shared/PathGuard.js';

const DAY = 24 * 60 * 60 * 1000;

describe('LifecycleStateMachine.checkTimeouts cap bounding (P2)', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let eventRepo: LifecycleEventRepository;
  let lifecycle: LifecycleStateMachine;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-timeouts-'));
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
    lifecycle = new LifecycleStateMachine(knowledgeRepo, eventRepo, signalBus, proposalRepo);
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

  it('无 cap：evolving>7d→active、pending/decaying>30d→deprecated、staging 不被触碰、记 transition 事件', async () => {
    const evolving = await createEntry('ev-stuck', 'evolving', 8); // 8d > 7d
    const pending = await createEntry('pd-stuck', 'pending', 31); // 31d > 30d
    const decaying = await createEntry('dc-stuck', 'decaying', 31); // 31d > 30d
    const staging = await createEntry('st-stuck', 'staging', 8); // staging 不在 TIMEOUT_TARGET

    const result = await lifecycle.checkTimeouts();

    expect((await knowledgeRepo.findById(evolving.id))?.lifecycle).toBe('active');
    expect((await knowledgeRepo.findById(pending.id))?.lifecycle).toBe('deprecated');
    expect((await knowledgeRepo.findById(decaying.id))?.lifecycle).toBe('deprecated');
    // 硬不变量：checkTimeouts 绝不触碰 staging
    expect((await knowledgeRepo.findById(staging.id))?.lifecycle).toBe('staging');

    // 迁移经 transition() 记 lifecycle_transition_events（trigger=timeout-recovery）
    expect(
      eventRepo
        .getHistory(evolving.id)
        .some((e) => e.toState === 'active' && e.trigger === 'timeout-recovery')
    ).toBe(true);
    expect(eventRepo.getHistory(pending.id).some((e) => e.toState === 'deprecated')).toBe(true);
    expect(eventRepo.getHistory(decaying.id).some((e) => e.toState === 'deprecated')).toBe(true);
    expect(eventRepo.getHistory(staging.id)).toHaveLength(0);

    expect(result.timedOut.map((t) => t.recipeId).sort()).toEqual(
      [evolving.id, pending.id, decaying.id].sort()
    );
    // checked 仅统计被处理的 TIMEOUT_TARGET 状态(evolving/decaying/pending)，不含 staging
    expect(result.checked).toBe(3);
  });

  it('cap：单 tick 扫描+迁移 ≤cap，多 tick 按最旧优先(createdAt 升序)排空', async () => {
    // 5 条卡死 pending，createdAt 乱序插入；最旧优先 = createdAt 升序
    const p300 = await createEntry('p-300', 'pending', 31, 300);
    const p100 = await createEntry('p-100', 'pending', 31, 100);
    const p500 = await createEntry('p-500', 'pending', 31, 500);
    const p200 = await createEntry('p-200', 'pending', 31, 200);
    const p400 = await createEntry('p-400', 'pending', 31, 400);

    const t1 = await lifecycle.checkTimeouts(2);
    expect(t1.checked).toBe(2); // 无全表 .all()：单 tick 扫描 ≤cap
    expect(t1.timedOut.map((t) => t.recipeId)).toEqual([p100.id, p200.id]);

    const t2 = await lifecycle.checkTimeouts(2);
    expect(t2.checked).toBe(2);
    expect(t2.timedOut.map((t) => t.recipeId)).toEqual([p300.id, p400.id]);

    const t3 = await lifecycle.checkTimeouts(2);
    expect(t3.timedOut.map((t) => t.recipeId)).toEqual([p500.id]);

    // 全部排空：pending 已清零
    expect(await knowledgeRepo.findAllByLifecycles(['pending'])).toHaveLength(0);
  });

  it('cap：预算跨 timeout 状态共享，总扫描+迁移 ≤cap（evolving 先、pending 后）', async () => {
    const e1 = await createEntry('e-1', 'evolving', 8, 10);
    const e2 = await createEntry('e-2', 'evolving', 8, 20);
    const p1 = await createEntry('p-1', 'pending', 31, 30);
    const p2 = await createEntry('p-2', 'pending', 31, 40);

    // 顺序：evolving 先取 ≤3（2 条全取，remaining 3-2=1）→ pending 取最旧 1 条 → remaining 0
    const t = await lifecycle.checkTimeouts(3);

    expect(t.checked).toBe(3);
    expect(t.timedOut).toHaveLength(3);
    expect((await knowledgeRepo.findById(e1.id))?.lifecycle).toBe('active');
    expect((await knowledgeRepo.findById(e2.id))?.lifecycle).toBe('active');
    // pending 仅最旧 1 条(p1, createdAt 30 < 40)迁移，另一条因预算耗尽留存
    expect((await knowledgeRepo.findById(p1.id))?.lifecycle).toBe('deprecated');
    expect((await knowledgeRepo.findById(p2.id))?.lifecycle).toBe('pending');
  });

  it('spy seam：cap 模式把剩余预算作为 limit 透传，无 cap 透传 undefined，staging 从不被查询', async () => {
    const spy = vi.spyOn(knowledgeRepo, 'findAllByLifecycles');

    await lifecycle.checkTimeouts(3);
    // TIMEOUT_MS 顺序首个 TIMEOUT_TARGET 状态是 evolving；capped 模式传数值预算
    expect(spy).toHaveBeenCalledWith(['evolving'], 3);
    // staging 不在 TIMEOUT_TARGET → 从不发起查询（与 checkAndPromote 不相交）
    expect(spy.mock.calls.some((c) => Array.isArray(c[0]) && c[0][0] === 'staging')).toBe(false);

    spy.mockClear();

    await lifecycle.checkTimeouts();
    // 无 cap：透传 undefined = 无界全表（向后兼容契约）
    expect(spy).toHaveBeenCalledWith(['evolving'], undefined);
    expect(spy.mock.calls.some((c) => Array.isArray(c[0]) && c[0][0] === 'staging')).toBe(false);

    spy.mockRestore();
  });

  it('无 cap 仍无界：一次处理全部到期项', async () => {
    for (let i = 0; i < 5; i++) {
      await createEntry(`pd-${i}`, 'pending', 31, (i + 1) * 100);
    }

    const result = await lifecycle.checkTimeouts();

    expect(result.timedOut).toHaveLength(5);
    expect(result.checked).toBe(5);
  });

  /**
   * 构造指定 lifecycle 的条目；以回填 ms 级 updatedAt 确定性构造「卡死」时长（now - ageDays*DAY），
   * 可选 createdAt 用于断言最旧优先(P1 createdAt 升序)排序。
   */
  async function createEntry(
    title: string,
    lifecycleState: string,
    ageDays: number,
    createdAt?: number
  ): Promise<KnowledgeEntry> {
    const entry = new KnowledgeEntry({
      title,
      description: `${title} recipe`,
      lifecycle: lifecycleState,
      updatedAt: Date.now() - ageDays * DAY,
      createdAt,
      language: 'typescript',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      content: {
        pattern: `Pattern for ${title}`,
        rationale: 'Exercise checkTimeouts bounding.',
      },
      reasoning: {
        whyStandard: 'Test recipe with grade-A quality.',
        sources: ['test/LifecycleStateMachineTimeouts.test.ts'],
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

/**
 * ProposalExecutor.checkAndExecute(cap?) 单元测试 — P3 有界化
 *
 * 覆盖：
 *  - cap：单 tick 处理 ≤cap 条 observing proposal（最旧优先 proposedAt 升序），多 tick 排空。
 *  - spy seam：cap 模式对 observing 查询透传 {limit, oldestFirst:true}；无 cap 不传（默认 desc 无界）。
 *  - 判定门禁不被绕过：cap 模式下无 usage 的 update proposal 仍被 reject、未流转。
 *  - 正常流转不被破坏：合格 update（有 usage）经 transition 真实执行（evolving→staging/active）。
 *  - 无 cap 仍无界。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import type { DrizzleDB } from '../src/infrastructure/database/drizzle/index.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { evolutionProposals } from '../src/infrastructure/database/drizzle/schema.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import { KnowledgeEdgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeEdgeRepository.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import { RecipeSourceRefRepositoryImpl } from '../src/repository/sourceref/RecipeSourceRefRepository.js';
import { ContentPatcher } from '../src/service/evolution/ContentPatcher.js';
import { LifecycleStateMachine } from '../src/service/evolution/LifecycleStateMachine.js';
import { ProposalExecutor } from '../src/service/evolution/ProposalExecutor.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('ProposalExecutor.checkAndExecute cap bounding (P3)', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let drizzle: DrizzleDB;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let proposalRepo: ProposalRepository;
  let executor: ProposalExecutor;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-p3-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });

    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    drizzle = connection.getDrizzle();

    knowledgeRepo = new KnowledgeRepositoryImpl(connection);
    proposalRepo = new ProposalRepository(drizzle);
    const eventRepo = new LifecycleEventRepository(drizzle);
    const signalBus = new SignalBus();
    const lifecycle = new LifecycleStateMachine(knowledgeRepo, eventRepo, signalBus, proposalRepo);
    const sourceRefRepo = new RecipeSourceRefRepositoryImpl(drizzle);
    const contentPatcher = new ContentPatcher(knowledgeRepo, sourceRefRepo);
    const edgeRepo = new KnowledgeEdgeRepositoryImpl(drizzle);
    executor = new ProposalExecutor(
      knowledgeRepo,
      proposalRepo,
      lifecycle,
      contentPatcher,
      edgeRepo
    );
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

  it('cap：单 tick 处理 ≤cap 条（最旧优先 proposedAt 升序），多 tick 排空', async () => {
    // 共用 0-usage 目标 recipe（FK 要求 target 存在）→ 每条评估 reject（no usage）→ 离开 observing；proposedAt 乱序
    const sink = await createRecipe('r-sink-a', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-300', 300, { targetRecipeId: sink.id });
    seedObserving('ep-100', 100, { targetRecipeId: sink.id });
    seedObserving('ep-500', 500, { targetRecipeId: sink.id });
    seedObserving('ep-200', 200, { targetRecipeId: sink.id });
    seedObserving('ep-400', 400, { targetRecipeId: sink.id });

    const t1 = await executor.checkAndExecute(2);
    expect(t1.rejected.map((r) => r.id)).toEqual(['ep-100', 'ep-200']);

    const t2 = await executor.checkAndExecute(2);
    expect(t2.rejected.map((r) => r.id)).toEqual(['ep-300', 'ep-400']);

    const t3 = await executor.checkAndExecute(2);
    expect(t3.rejected.map((r) => r.id)).toEqual(['ep-500']);

    expect(proposalRepo.find({ status: 'observing' })).toHaveLength(0);
  });

  it('spy seam：cap 模式对 observing 查询透传 {limit, oldestFirst:true}；无 cap 不传（默认 desc 无界）', async () => {
    const spy = vi.spyOn(proposalRepo, 'find');

    await executor.checkAndExecute(3);
    expect(spy).toHaveBeenCalledWith({ status: 'observing', limit: 3, oldestFirst: true });

    spy.mockClear();

    await executor.checkAndExecute();
    expect(spy).toHaveBeenCalledWith({ status: 'observing' });

    spy.mockRestore();
  });

  it('cap 模式不绕过判定门禁：无 usage 的 update proposal 仍被 reject、未流转', async () => {
    const recipe = await createRecipe('r-nousage', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-nousage', 100, { targetRecipeId: recipe.id });

    const result = await executor.checkAndExecute(5);

    expect(result.rejected.map((r) => r.id)).toContain('ep-nousage');
    expect(result.executed).toHaveLength(0);
    // 门禁拦截：recipe 未进 evolving，仍为 active
    expect((await knowledgeRepo.findById(recipe.id))?.lifecycle).toBe('active');
    expect(proposalRepo.findById('ep-nousage')?.status).toBe('rejected');
  });

  it('cap 模式不破坏正常流转：合格 update（有 usage）经 transition 执行', async () => {
    const recipe = await createRecipe('r-usage', 'active', {
      guardHits: 5,
      searchHits: 3,
      ruleFalsePositiveRate: 0,
    });
    seedObserving('ep-usage', 100, { targetRecipeId: recipe.id });

    const result = await executor.checkAndExecute(5);

    expect(result.executed.map((e) => e.id)).toContain('ep-usage');
    // 经 transition 真实流转：patch 成功→staging，否则回 active
    const after = (await knowledgeRepo.findById(recipe.id))?.lifecycle;
    expect(['active', 'staging']).toContain(after);
    expect(proposalRepo.findById('ep-usage')?.status).toBe('executed');
  });

  it('checkAndExecute() 无 cap 仍无界：一次处理全部 observing', async () => {
    const sink = await createRecipe('r-sink-e', 'active', { guardHits: 0, searchHits: 0 });
    for (let i = 0; i < 5; i++) {
      seedObserving(`ep-unb-${i}`, (i + 1) * 100, { targetRecipeId: sink.id });
    }

    const result = await executor.checkAndExecute();

    expect(result.rejected).toHaveLength(5);
    expect(proposalRepo.find({ status: 'observing' })).toHaveLength(0);
  });

  // ───────────────── P3-Core-2: #expireOldPending 有界化（Option A 共享预算）─────────────────

  it('P3-Core-2 cap：pending GC 单 tick 仅 markExpired ≤budget（最旧优先），多 tick 排空', async () => {
    const sink = await createRecipe('r-sink-pend', 'active', { guardHits: 0, searchHits: 0 });
    // 5 条到期 pending（proposedAt 极小 → 远超过期阈值），乱序插入
    seedPending('pp-300', 300, sink.id);
    seedPending('pp-100', 100, sink.id);
    seedPending('pp-500', 500, sink.id);
    seedPending('pp-200', 200, sink.id);
    seedPending('pp-400', 400, sink.id);

    // 无 observing → 整 cap 预算给 pending GC
    const t1 = await executor.checkAndExecute(2);
    expect(t1.expired.map((e) => e.id)).toEqual(['pp-100', 'pp-200']);

    const t2 = await executor.checkAndExecute(2);
    expect(t2.expired.map((e) => e.id)).toEqual(['pp-300', 'pp-400']);

    const t3 = await executor.checkAndExecute(2);
    expect(t3.expired.map((e) => e.id)).toEqual(['pp-500']);

    expect(proposalRepo.find({ status: 'pending' })).toHaveLength(0);
  });

  it('P3-Core-2 cap：observing + pending 共享单一 remaining 预算，整 tick 总处理 ≤cap', async () => {
    const sink = await createRecipe('r-sink-shared', 'active', { guardHits: 0, searchHits: 0 });
    // 2 条 observing（no-usage → reject）+ 3 条到期 pending；cap=3
    seedObserving('so-1', 10, { targetRecipeId: sink.id });
    seedObserving('so-2', 20, { targetRecipeId: sink.id });
    seedPending('sp-1', 30, sink.id);
    seedPending('sp-2', 40, sink.id);
    seedPending('sp-3', 50, sink.id);

    const t = await executor.checkAndExecute(3);

    // observing 先吃 2（remaining 3-2=1）→ pending GC 仅最旧 1 条（sp-1）
    expect(t.rejected).toHaveLength(2);
    expect(t.expired.map((e) => e.id)).toEqual(['sp-1']);
    // 整 tick 总处理 = 2 reject + 1 expire = 3 = cap
    expect(t.rejected.length + t.expired.length).toBe(3);
    // 预算耗尽：剩 2 条 pending 未扫
    expect(proposalRepo.find({ status: 'pending' })).toHaveLength(2);
  });

  it('P3-Core-2 spy seam：cap 模式 pending GC 透传 {limit:remaining, oldestFirst}；无 cap 不传', async () => {
    const spy = vi.spyOn(proposalRepo, 'find');

    // 空 DB：observing 返回 0 → remaining 3-0=3 → pending GC 收 limit 3
    await executor.checkAndExecute(3);
    expect(spy).toHaveBeenCalledWith({ status: 'observing', limit: 3, oldestFirst: true });
    expect(spy).toHaveBeenCalledWith({ status: 'pending', limit: 3, oldestFirst: true });

    spy.mockClear();

    await executor.checkAndExecute();
    expect(spy).toHaveBeenCalledWith({ status: 'observing' });
    expect(spy).toHaveBeenCalledWith({ status: 'pending' });

    spy.mockRestore();
  });

  it('P3-Core-2 无 cap 时 pending GC 仍无界（字节一致）', async () => {
    const sink = await createRecipe('r-sink-unb-p', 'active', { guardHits: 0, searchHits: 0 });
    for (let i = 0; i < 5; i++) {
      seedPending(`up-${i}`, (i + 1) * 100, sink.id);
    }

    const result = await executor.checkAndExecute();

    expect(result.expired).toHaveLength(5);
    expect(proposalRepo.find({ status: 'pending' })).toHaveLength(0);
  });

  it('P3-Core-2 cap 不绕过过期判定：未到期 pending 不被 markExpired', async () => {
    const sink = await createRecipe('r-sink-fresh', 'active', { guardHits: 0, searchHits: 0 });
    seedPending('pp-expired', 100, sink.id); // proposedAt 极小 → 到期
    seedPending('pp-fresh', Date.now(), sink.id); // 刚创建 → 未到期

    const result = await executor.checkAndExecute(5);

    // 仅到期者被 markExpired；shouldExpirePending 门禁未被绕过
    expect(result.expired.map((e) => e.id)).toEqual(['pp-expired']);
    expect(proposalRepo.findById('pp-fresh')?.status).toBe('pending');
  });

  /** 直接插入一条 pending proposal，控制 proposedAt（极小=到期；now=未到期） */
  function seedPending(id: string, proposedAt: number, targetRecipeId: string): void {
    drizzle
      .insert(evolutionProposals)
      .values({
        id,
        type: 'update',
        targetRecipeId,
        relatedRecipeIds: JSON.stringify([]),
        confidence: 0.8,
        source: 'host-agent',
        description: `pending ${id}`,
        evidence: JSON.stringify([]),
        status: 'pending',
        proposedAt,
        expiresAt: proposedAt + 1_000_000_000,
      })
      .run();
  }

  /** 直接插入一条 observing proposal，控制 proposedAt 以验证最旧优先排序 */
  function seedObserving(
    id: string,
    proposedAt: number,
    opts: { type?: 'update' | 'deprecate'; targetRecipeId?: string } = {}
  ): void {
    drizzle
      .insert(evolutionProposals)
      .values({
        id,
        type: opts.type ?? 'update',
        targetRecipeId: opts.targetRecipeId ?? `missing-${id}`,
        relatedRecipeIds: JSON.stringify([]),
        confidence: 0.8,
        source: 'host-agent',
        description: `proposal ${id}`,
        evidence: JSON.stringify([]),
        status: 'observing',
        proposedAt,
        expiresAt: proposedAt + 1_000_000_000,
      })
      .run();
  }

  /** 创建目标 recipe（控制 stats 决定 evaluateUpdate 是否通过） */
  async function createRecipe(
    title: string,
    lifecycleState: string,
    stats: Record<string, number>
  ): Promise<KnowledgeEntry> {
    const entry = new KnowledgeEntry({
      title,
      description: `${title} recipe`,
      lifecycle: lifecycleState,
      stats,
      language: 'typescript',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      content: { pattern: `Pattern for ${title}`, rationale: 'Exercise checkAndExecute.' },
      reasoning: {
        whyStandard: 'Test recipe with grade-A quality.',
        sources: ['test/ProposalExecutorBounding.test.ts'],
        confidence: 0.95,
      },
      quality: { overall: 0.95, correctness: 0.95, completeness: 0.95, clarity: 0.95 },
    });
    const created = await knowledgeRepo.create(entry);
    expect(created).not.toBeNull();
    return created ?? entry;
  }
});

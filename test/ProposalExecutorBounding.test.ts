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
import { ContentPatcher } from '../src/service/sustain/ContentPatcher.js';
import { LifecycleStateMachine } from '../src/service/sustain/LifecycleStateMachine.js';
import { ProposalExecutor } from '../src/service/sustain/ProposalExecutor.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('ProposalExecutor.checkAndExecute cap bounding (P3)', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let drizzle: DrizzleDB;
  let knowledgeRepo: KnowledgeRepositoryImpl;
  let proposalRepo: ProposalRepository;
  let executor: ProposalExecutor;
  let signalBus: SignalBus;
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
    signalBus = new SignalBus();
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

  it('决策①双豁免-b:drifted 修复型提案(evidence 带 sourceStatus:drifted)免 hasUsage 闸', async () => {
    // 0-usage 目标:普通 update 会被 hasUsage 拒,drifted 修复型必须放行执行。
    const sink = await createRecipe('r-drift-target', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-drift', 100, {
      targetRecipeId: sink.id,
      source: 'metabolism',
      evidence: [
        {
          sourceStatus: 'drifted',
          sourcePath: 'Sources/A.swift:10-20',
          updateReason: 'source-region-content-drift',
        },
      ],
    });

    const result = await executor.checkAndExecute();
    expect(result.rejected.map((r) => r.id)).not.toContain('ep-drift');
    // 无 StructuredPatch 时执行层按既有语义处理(退伪成功/跳过),但绝不因 no-usage 拒。
    const rejectedReasons = result.rejected.map((r) => r.reason).join('|');
    expect(rejectedReasons).not.toContain('no usage during observation');
  });

  it('决策①双豁免-a:人工 executeOne 免 hasUsage(0-usage 目标不再被机器否决)', async () => {
    const sink = await createRecipe('r-manual-target', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-manual', 100, { targetRecipeId: sink.id });

    const result = await executor.executeOne('ep-manual');
    const rejectedReasons = result.rejected.map((r) => r.reason).join('|');
    expect(rejectedReasons).not.toContain('no usage during observation');
  });

  it('P-E 观察窗口闸：窗口未满的 observing 提案 skipped 且留在 observing(BiliDili 32 秒处决回归)', async () => {
    // 真实事故:rescan 起始 sweep 把出生 32 秒的 30 个 drifted→update 提案送进
    // hasUsage 闸全灭。新鲜提案(confidence 0.8→risk low→24h 窗)必须活过 sweep。
    const sink = await createRecipe('r-sink-fresh', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-fresh', Date.now() - 30_000, { targetRecipeId: sink.id });

    const result = await executor.checkAndExecute();
    expect(result.rejected).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toContain('observation window not elapsed');
    expect(proposalRepo.find({ status: 'observing' })).toHaveLength(1);
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

  // ───────────────── P3-Core-Fix: dual-track re-entrancy 守卫（F-A）─────────────────

  it('F-A：dual-track 下合格 UPDATE 不被自身 lifecycle 信号 re-entrancy 误标 rejected', async () => {
    // 启用信号驱动轨道（与 sweep 形成双轨）；lifecycle transition 经同一 signalBus 发信号
    executor.subscribeToSignals(signalBus);
    const rejectSpy = vi.spyOn(proposalRepo, 'markRejected');

    const recipe = await createRecipe('r-reentry', 'active', {
      guardHits: 5,
      searchHits: 3,
      ruleFalsePositiveRate: 0,
    });
    seedObserving('ep-reentry', 100, { targetRecipeId: recipe.id });

    // sweep 触发执行：执行中的 active→evolving transition 会发 lifecycle 信号；修复前会被 init 订阅者
    // re-enter、对 still-observing 的同一 proposal 再执行 → 'evolving→evolving' invalid → 误标 rejected
    await executor.checkAndExecute(5);
    await flushAsync();

    // 修复后：proposal 终态 executed（非 rejected），且从未对其调用 markRejected
    expect(proposalRepo.findById('ep-reentry')?.status).toBe('executed');
    expect(rejectSpy).not.toHaveBeenCalledWith('ep-reentry', expect.anything());
    // entry 完成一次流转：active→evolving→active/staging
    expect(['active', 'staging']).toContain((await knowledgeRepo.findById(recipe.id))?.lifecycle);

    rejectSpy.mockRestore();
    executor.unsubscribe();
  });

  it('F-A：守卫不误伤——合法 usage 信号仍能驱动 not-in-flight 的合格 UPDATE 执行', async () => {
    executor.subscribeToSignals(signalBus);

    const recipe = await createRecipe('r-signal-drive', 'active', {
      guardHits: 4,
      searchHits: 2,
      ruleFalsePositiveRate: 0,
    });
    seedObserving('ep-signal', 100, { targetRecipeId: recipe.id });

    // 直接发一个 usage 信号（针对非执行中的 proposal）→ 信号驱动评估并执行
    signalBus.send('usage', 'test', 0.9, { target: recipe.id });
    await flushAsync();

    expect(proposalRepo.findById('ep-signal')?.status).toBe('executed');

    executor.unsubscribe();
  });

  /** 排空信号订阅者（void #onSignal）产生的挂起异步链（一个宏任务跑在所有微任务之后） */
  function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

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

  it('U5 #3 退伪成功：consolidation 提案空 suggestedChanges → rejected（非 executed+reverted）', async () => {
    // merge(consolidation) 走 evaluateMerge（不要求 usage、FP 护栏）→ 进 patch；evidence 无 suggestedChanges
    // → ContentPatcher skip（success=false、非抛错）→ #4 退伪成功：markRejected，非 markExecuted+'reverted to active'。
    const recipe = await createRecipe('r-merge-empty', 'active', { guardHits: 0, searchHits: 0 });
    seedObserving('ep-merge-empty', 100, {
      targetRecipeId: recipe.id,
      source: 'consolidation',
      evidence: [{ snapshotAt: 1 }],
    });

    const result = await executor.checkAndExecute(5);

    expect(result.executed.map((e) => e.id)).not.toContain('ep-merge-empty');
    expect(result.rejected.map((r) => r.id)).toContain('ep-merge-empty');
    expect(proposalRepo.findById('ep-merge-empty')?.status).toBe('rejected');
    // recipe 回落 active（内容未变更）
    expect((await knowledgeRepo.findById(recipe.id))?.lifecycle).toBe('active');
  });

  /** 直接插入一条 observing proposal，控制 proposedAt 以验证最旧优先排序 */
  function seedObserving(
    id: string,
    proposedAt: number,
    opts: {
      type?: 'update' | 'deprecate';
      targetRecipeId?: string;
      source?: string;
      evidence?: unknown[];
    } = {}
  ): void {
    drizzle
      .insert(evolutionProposals)
      .values({
        id,
        type: opts.type ?? 'update',
        targetRecipeId: opts.targetRecipeId ?? `missing-${id}`,
        relatedRecipeIds: JSON.stringify([]),
        confidence: 0.8,
        source: opts.source ?? 'host-agent',
        description: `proposal ${id}`,
        evidence: JSON.stringify(opts.evidence ?? []),
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

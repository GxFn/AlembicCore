/**
 * ProposalExecutor — 信号驱动的提案执行引擎
 *
 * 核心职责：
 *   1. 订阅 SignalBus（guard / search / decay / quality），当关联 Recipe 有活跃 Proposal 时触发评估
 *   2. 评估 → 通过 EvolutionPolicy 判定（纯函数）
 *   3. 通过 → 编排执行（update → ContentPatcher / deprecate → LifecycleStateMachine）
 *   4. 不通过 → 继续等待下一个信号
 *
 * 设计原则：
 *   - 从时间驱动转为信号驱动：不再依赖 expiresAt + 定时轮询，而是每个相关信号到达即评估
 *   - 决策逻辑全部委托给 EvolutionPolicy（纯函数）
 *   - 状态转移全部通过 LifecycleStateMachine（唯一权威）
 *   - lifecycle signal 由 StateMachine 内部自动发射
 *   - 所有依赖必需（non-nullable），消除降级路径
 *
 * @module service/evolution/ProposalExecutor
 */

import { EvolutionPolicy, type UpdateVerdict } from '../../domain/evolution/EvolutionPolicy.js';
import {
  type EmbeddingSimProvider,
  type RecipeLike,
  RecipeSimilarity,
} from '../../domain/evolution/RecipeSimilarity.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { Signal, SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type {
  ProposalRecord,
  ProposalRepository,
  ProposalType,
} from '../../repository/evolution/ProposalRepository.js';
import type { KnowledgeEdgeRepositoryImpl } from '../../repository/knowledge/KnowledgeEdgeRepository.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type { ContentPatcher } from './ContentPatcher.js';
import type { LifecycleStateMachine } from './LifecycleStateMachine.js';

/* ────────────────────── Types ────────────────────── */

export interface ProposalExecutionResult {
  executed: { id: string; type: ProposalType; targetRecipeId: string }[];
  rejected: { id: string; type: ProposalType; reason: string }[];
  expired: { id: string; type: ProposalType }[];
  skipped: { id: string; type: ProposalType; reason: string }[];
}

interface RecipeMetrics {
  guardHits: number;
  searchHits: number;
  hitsLast30d: number;
  decayScore: number;
  ruleFalsePositiveRate: number;
  quality: number;
}

/** 触发评估的信号类型 */
const TRIGGER_SIGNAL_TYPES = new Set(['guard', 'search', 'decay', 'quality', 'usage', 'lifecycle']);

/* ────────────────────── Class ────────────────────── */

export class ProposalExecutor {
  readonly #knowledgeRepo: KnowledgeRepositoryImpl;
  readonly #repo: ProposalRepository;
  readonly #lifecycle: LifecycleStateMachine;
  readonly #contentPatcher: ContentPatcher;
  readonly #edgeRepo: KnowledgeEdgeRepositoryImpl;
  // U5 #6 conduit：可选 embedding 相似度注入器（supersede 站点；缺省→纯 Jaccard，字节级向后兼容）。
  readonly #embeddingSimProvider?: EmbeddingSimProvider;
  readonly #logger = Logger.getInstance();
  #unsubscribe: (() => void) | null = null;
  /**
   * P3-Core-Fix（F-A re-entrancy）：正在执行中的 proposalId 集合。
   * 某 proposal 执行时其 transition 会发 lifecycle 信号；订阅者据此跳过对「同一进行中 proposal」的二次执行，
   * 避免 active→evolving 后再次 active→evolving 触发 'evolving→evolving' invalid 而把已执行的 proposal 误标 rejected。
   */
  readonly #inFlight = new Set<string>();

  constructor(
    knowledgeRepo: KnowledgeRepositoryImpl,
    repo: ProposalRepository,
    lifecycle: LifecycleStateMachine,
    contentPatcher: ContentPatcher,
    edgeRepo: KnowledgeEdgeRepositoryImpl,
    embeddingSimProvider?: EmbeddingSimProvider
  ) {
    this.#knowledgeRepo = knowledgeRepo;
    this.#repo = repo;
    this.#lifecycle = lifecycle;
    this.#contentPatcher = contentPatcher;
    this.#edgeRepo = edgeRepo;
    this.#embeddingSimProvider = embeddingSimProvider;
  }

  /* ═══════════════════ Signal Subscription ═══════════════════ */

  /**
   * 订阅 SignalBus，当信号到达时自动评估关联 Proposal。
   * 调用方负责在关闭时调用 unsubscribe()。
   */
  subscribeToSignals(signalBus: SignalBus): void {
    if (this.#unsubscribe) {
      return; // 幂等
    }

    this.#unsubscribe = signalBus.subscribe(
      'guard|search|decay|quality|usage|lifecycle',
      (signal: Signal) => {
        if (!signal.target) {
          return;
        }
        void this.#onSignal(signal);
      }
    );

    this.#logger.info(
      '[ProposalExecutor] Subscribed to SignalBus for signal-driven proposal evaluation'
    );
  }

  /**
   * 取消信号订阅
   */
  unsubscribe(): void {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }

  /**
   * 信号到达时：查找该 Recipe 的活跃 Proposal → 评估是否满足执行条件
   */
  async #onSignal(signal: Signal): Promise<void> {
    if (!TRIGGER_SIGNAL_TYPES.has(signal.type)) {
      return;
    }

    const recipeId = signal.target;
    if (!recipeId) {
      return;
    }

    try {
      // 查找该 Recipe 的 observing Proposals
      const proposals = this.#repo.findByTarget(recipeId);
      // P3-Core-Fix（F-A re-entrancy）：跳过正在执行中的同一 proposal，避免其执行触发的 lifecycle 信号二次进入
      const activeProposals = proposals.filter(
        (p) => p.status === 'observing' && !this.#inFlight.has(p.id)
      );

      if (activeProposals.length === 0) {
        return;
      }

      for (const proposal of activeProposals) {
        await this.#evaluateOnSignal(proposal, signal);
      }
    } catch (err: unknown) {
      this.#logger.warn(
        `[ProposalExecutor] onSignal error for ${recipeId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 信号触发的单个 Proposal 评估
   *
   * §9.1 增强：source_modified + direct/pattern 信号对 deprecate 提案视为恢复证据。
   */
  async #evaluateOnSignal(proposal: ProposalRecord, signal: Signal): Promise<void> {
    const metrics = await this.#collectRecipeMetrics(proposal.targetRecipeId);

    // §9.1: source_modified + direct/pattern → 源文件仍在被积极编辑/其核心模式被修改
    const isActivelyModified =
      signal.metadata?.reason === 'source_modified' &&
      (signal.metadata?.impactLevel === 'direct' || signal.metadata?.impactLevel === 'pattern');

    switch (proposal.type) {
      case 'update': {
        // U5 #8：信号入口与 checkAndExecute 兜底入口共用同一门禁分流（#gateUpdate）。
        const verdict = this.#gateUpdate(proposal, metrics);
        if (verdict.pass) {
          const result = this.#emptyResult();
          await this.#runWithReentrancyGuard(proposal.id, () =>
            this.#executeUpdate(proposal, metrics, result)
          );
          if (result.executed.length > 0) {
            this.#logger.info(
              `[ProposalExecutor] Signal-driven update executed: ${proposal.id} (signal=${signal.type})`
            );
          }
        }
        // 不满足条件 → 静默等待下一个信号
        break;
      }
      case 'deprecate': {
        // §9.1: 源文件被直接修改或核心模式被编辑 → Recipe 仍在被使用，拒绝废弃
        if (isActivelyModified) {
          this.#repo.markRejected(
            proposal.id,
            `Source file actively modified (impact=${signal.metadata?.impactLevel}, path=${signal.metadata?.modifiedPath ?? 'unknown'}), recipe likely still relevant`
          );
          this.#logger.info(
            `[ProposalExecutor] Deprecate rejected — source actively modified: ${proposal.id} (impact=${signal.metadata?.impactLevel}, path=${signal.metadata?.modifiedPath})`
          );
          break;
        }

        const snapshot = this.#extractSnapshot(proposal);
        const verdict = EvolutionPolicy.evaluateDeprecate(
          metrics.decayScore,
          snapshot?.decayScore ?? metrics.decayScore
        );
        if (verdict.action !== 'reject') {
          const result = this.#emptyResult();
          await this.#runWithReentrancyGuard(proposal.id, () =>
            this.#executeDeprecate(proposal, metrics, snapshot, result)
          );
          if (result.executed.length > 0) {
            this.#logger.info(
              `[ProposalExecutor] Signal-driven deprecate executed: ${proposal.id} (signal=${signal.type})`
            );
          }
        }
        // reject (recovered) → 立即拒绝
        else if (verdict.reason.includes('recovered')) {
          this.#repo.markRejected(proposal.id, verdict.reason);
          this.#logger.info(
            `[ProposalExecutor] Signal-driven deprecate rejected (recovered): ${proposal.id}`
          );
        }
        break;
      }
    }
  }

  /**
   * 手动执行单个 Proposal（Dashboard 按钮触发）
   */
  async executeOne(id: string): Promise<ProposalExecutionResult> {
    const result: ProposalExecutionResult = {
      executed: [],
      rejected: [],
      expired: [],
      skipped: [],
    };

    const proposal = this.#repo.findById(id);
    if (!proposal) {
      result.skipped.push({ id, type: 'update', reason: 'not found' });
      return result;
    }

    if (proposal.status !== 'pending' && proposal.status !== 'observing') {
      result.skipped.push({
        id,
        type: proposal.type,
        reason: `invalid status: ${proposal.status}`,
      });
      return result;
    }

    if (proposal.status === 'pending') {
      const ok = this.#repo.startObserving(id);
      if (!ok) {
        result.skipped.push({ id, type: proposal.type, reason: 'failed to start observing' });
        return result;
      }
    }

    await this.#processExpiredProposal(proposal, result);

    if (result.executed.length > 0 || result.rejected.length > 0) {
      this.#logger.info(
        `[ProposalExecutor] executeOne(${id}): ` +
          `executed=${result.executed.length}, rejected=${result.rejected.length}`
      );
    }

    return result;
  }

  /**
   * 启动时一次性清理 — 清理过期 Pending、对长期 Observing 做兜底评估
   *
   * 不再被定时调用，仅在 Dashboard 启动时 / CLI evolve-check 时调用。
   * 主要流程已由 subscribeToSignals() 接管。
   */
  async checkAndExecute(cap?: number): Promise<ProposalExecutionResult> {
    const result: ProposalExecutionResult = {
      executed: [],
      rejected: [],
      expired: [],
      skipped: [],
    };

    // 兜底：对长期处于 observing 但信号始终未满足的 Proposal 做一次评估
    // P3 有界化（2026-06-26，daemon-less 自动化补全）：cap 给定时对 observing proposal 有界处理。
    // 关键：ProposalRepository.find 默认 desc(proposedAt)（最新优先），capped 取最新 N 会饿死「最久未处理」的
    // observing proposal；故 capped 走 oldestFirst（proposedAt 升序）+ LIMIT，单 tick 处理 ≤cap、跨多次 tick
    // 最旧优先排空不饿死。cap===undefined → 现行无界 + 默认 desc 排序（字节一致契约）。
    // cap 只限「处理多少条」，绝不改判定门禁：evaluateUpdate/evaluateDeprecate/§9.1/transition Guard 全保留。
    // P3-Core-2（2026-06-26，用户裁断 Option A）：cap 模式下跨 observing + pending GC 共享单一 remaining 预算
    // （与 P2-Core checkTimeouts 的 total-budget 一致），使整个 capped checkAndExecute 单 tick 扫描+写 ≤cap、
    // 跨 tick 排空不饿死。observing 按实际扫描行数递减 remaining，剩余预算透传给 #expireOldPending。
    let remaining = cap;
    const observing =
      remaining === undefined
        ? this.#repo.find({ status: 'observing' })
        : this.#repo.find({ status: 'observing', limit: remaining, oldestFirst: true });
    for (const proposal of observing) {
      // P3-Core-Fix（F-A re-entrancy）：跳过正在执行中的同一 proposal（与 status 过滤并列）
      if (this.#inFlight.has(proposal.id)) {
        continue;
      }
      await this.#processExpiredProposal(proposal, result);
    }
    // 共享预算按 observing 实际扫描（返回）行数递减；cap===undefined 时保持 undefined（无界）
    if (remaining !== undefined) {
      remaining -= observing.length;
    }

    this.#expireOldPending(result, remaining);

    if (result.executed.length > 0 || result.rejected.length > 0 || result.expired.length > 0) {
      this.#logger.info(
        `[ProposalExecutor] checkAndExecute complete: ` +
          `executed=${result.executed.length}, rejected=${result.rejected.length}, expired=${result.expired.length}`
      );
    }

    return result;
  }

  /* ═══════════════════ Internal ═══════════════════ */

  /**
   * P3-Core-Fix（F-A re-entrancy）：以 in-flight 守卫执行单条 proposal。
   * 进入即标记 proposalId，finally 移除；执行期间该 proposal 触发的 lifecycle 信号
   * 会被 #onSignal / checkAndExecute 的 #inFlight 跳过，从而不会 re-enter 二次执行。
   * 仅做并发再入保护，不改判定门禁 / transition Guard / proposal 状态语义。
   */
  async #runWithReentrancyGuard(proposalId: string, run: () => Promise<void>): Promise<void> {
    this.#inFlight.add(proposalId);
    try {
      await run();
    } finally {
      this.#inFlight.delete(proposalId);
    }
  }

  async #processExpiredProposal(
    proposal: ProposalRecord,
    result: ProposalExecutionResult
  ): Promise<void> {
    const metrics = await this.#collectRecipeMetrics(proposal.targetRecipeId);
    const snapshot = this.#extractSnapshot(proposal);

    switch (proposal.type) {
      case 'update':
        await this.#runWithReentrancyGuard(proposal.id, () =>
          this.#executeUpdate(proposal, metrics, result)
        );
        break;
      case 'deprecate':
        await this.#runWithReentrancyGuard(proposal.id, () =>
          this.#executeDeprecate(proposal, metrics, snapshot, result)
        );
        break;
      default:
        result.skipped.push({
          id: proposal.id,
          type: proposal.type,
          reason: `unhandled type: ${proposal.type}`,
        });
    }
  }

  /* ── update ── */

  /**
   * U5 #8：update 臂单一门禁分流（#executeUpdate 与 #evaluateOnSignal 两入口共用，避免门禁分叉）。
   * source==='consolidation'（merge = action:update + source:consolidation）→ evaluateMerge（不要求 hasUsage、保留 FP 护栏）；
   * 其余（aging / 常规 update）→ evaluateUpdate（仍要求 hasUsage）。空 mergePatch 由执行层 #4 退伪成功兜底。
   */
  #gateUpdate(proposal: ProposalRecord, metrics: RecipeMetrics): UpdateVerdict {
    if (proposal.source === 'consolidation') {
      return EvolutionPolicy.evaluateMerge({
        ruleFalsePositiveRate: metrics.ruleFalsePositiveRate,
      });
    }
    return EvolutionPolicy.evaluateUpdate(metrics);
  }

  async #executeUpdate(
    proposal: ProposalRecord,
    metrics: RecipeMetrics,
    result: ProposalExecutionResult
  ): Promise<void> {
    const verdict = this.#gateUpdate(proposal, metrics);

    if (!verdict.pass) {
      this.#repo.markRejected(proposal.id, verdict.reason);
      result.rejected.push({
        id: proposal.id,
        type: proposal.type,
        reason: verdict.reason,
      });
      return;
    }

    // evolving → patch → staging/active
    const evolveResult = await this.#lifecycle.transition({
      recipeId: proposal.targetRecipeId,
      targetState: 'evolving',
      trigger: 'proposal-attach',
      proposalId: proposal.id,
      operatorId: 'system',
    });

    if (!evolveResult.success) {
      this.#repo.markRejected(proposal.id, `transition failed: ${evolveResult.error}`);
      result.rejected.push({
        id: proposal.id,
        type: proposal.type,
        reason: evolveResult.error ?? 'transition to evolving failed',
      });
      return;
    }

    try {
      const patchResult = await this.#tryApplyPatch(
        proposal,
        proposal.source === 'consolidation' ? 'merge' : 'agent-suggestion'
      );
      const nextState = patchResult?.success ? 'staging' : 'active';

      const nextResult = await this.#lifecycle.transition({
        recipeId: proposal.targetRecipeId,
        targetState: nextState,
        trigger: 'content-patch-complete',
        proposalId: proposal.id,
        operatorId: 'system',
      });

      if (!nextResult.success) {
        this.#repo.markRejected(
          proposal.id,
          `transition to ${nextState} failed: ${nextResult.error}`
        );
        result.rejected.push({
          id: proposal.id,
          type: proposal.type,
          reason: nextResult.error ?? `transition to ${nextState} failed`,
        });
        return;
      }

      if (patchResult?.success) {
        // 真实补丁已应用 → 正常 executed
        this.#repo.markExecuted(proposal.id, `patched=[${patchResult.fieldsPatched.join(',')}]`);
        result.executed.push({
          id: proposal.id,
          type: proposal.type,
          targetRecipeId: proposal.targetRecipeId,
        });
      } else if (proposal.source === 'consolidation') {
        // U5 #4 退伪成功：merge(consolidation) 应有可应用补丁却空转（patchResult.success=false、非抛错）。
        // recipe 已在上面 evolving→active 回落（内容未变更）；此处改 markRejected，不再静默 markExecuted+'reverted to active'。
        this.#repo.markRejected(
          proposal.id,
          'no applicable merge patch (empty/unstructured suggestedChanges)'
        );
        result.rejected.push({
          id: proposal.id,
          type: proposal.type,
          reason: 'no applicable merge patch',
        });
        this.#logger.info(
          `[ProposalExecutor] merge proposal ${proposal.id} produced no content change → rejected (reverted to active, content unchanged)`
        );
      } else {
        // 非 merge update：保留现行 no-op valid 语义（aging 提案的状态机周期即执行，内容可不变）。
        this.#repo.markExecuted(proposal.id, 'patch skipped, reverted to active');
        result.executed.push({
          id: proposal.id,
          type: proposal.type,
          targetRecipeId: proposal.targetRecipeId,
        });
      }
    } catch (err: unknown) {
      this.#logger.warn(
        `[ProposalExecutor] #executeUpdate failed for ${proposal.targetRecipeId}: ${err instanceof Error ? err.message : String(err)}`
      );
      // Try to revert to active if stuck in evolving
      await this.#lifecycle.transition({
        recipeId: proposal.targetRecipeId,
        targetState: 'active',
        trigger: 'timeout-recovery',
        operatorId: 'system',
      });
      this.#repo.markRejected(
        proposal.id,
        `execution error: ${err instanceof Error ? err.message : String(err)}`
      );
      result.rejected.push({
        id: proposal.id,
        type: proposal.type,
        reason: `execution error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /* ── deprecate ── */

  async #executeDeprecate(
    proposal: ProposalRecord,
    metrics: RecipeMetrics,
    snapshot: RecipeMetrics | null,
    result: ProposalExecutionResult
  ): Promise<void> {
    const verdict = EvolutionPolicy.evaluateDeprecate(
      metrics.decayScore,
      snapshot?.decayScore ?? metrics.decayScore
    );

    if (verdict.action === 'reject') {
      this.#repo.markRejected(proposal.id, verdict.reason);
      result.rejected.push({
        id: proposal.id,
        type: proposal.type,
        reason: verdict.reason,
      });
      return;
    }

    const transResult = await this.#lifecycle.transition({
      recipeId: proposal.targetRecipeId,
      targetState: verdict.action, // 'deprecated' | 'decaying'
      trigger: 'proposal-execution',
      proposalId: proposal.id,
      operatorId: 'system',
    });

    if (!transResult.success) {
      this.#repo.markRejected(proposal.id, `transition failed: ${transResult.error}`);
      result.rejected.push({
        id: proposal.id,
        type: proposal.type,
        reason: transResult.error ?? 'transition failed',
      });
      return;
    }

    this.#repo.markExecuted(proposal.id, verdict.reason);
    result.executed.push({
      id: proposal.id,
      type: proposal.type,
      targetRecipeId: proposal.targetRecipeId,
    });

    // supersede edge — U5 #7：选与被替代 Recipe 相似度最高的新建项（非首个）作为 deprecated_by 目标
    const replacedBy = await this.#selectMostSimilarReplacement(
      proposal.targetRecipeId,
      proposal.relatedRecipeIds
    );
    if (replacedBy) {
      await this.#createDeprecatedByEdge(replacedBy, proposal.targetRecipeId);
    }
  }

  /**
   * U5 #7：supersede 时从 relatedRecipeIds 中选与被替代 Recipe 相似度最高者（复用 RecipeSimilarity 加权 5 维）。
   * <2 候选 / 加载失败 → 回退首个（与旧 relatedRecipeIds[0] 行为兼容）。
   */
  async #selectMostSimilarReplacement(
    supersededId: string,
    relatedRecipeIds: string[]
  ): Promise<string | undefined> {
    if (relatedRecipeIds.length <= 1) {
      return relatedRecipeIds[0];
    }
    try {
      const superseded = await this.#knowledgeRepo.findById(supersededId);
      if (!superseded) {
        return relatedRecipeIds[0];
      }
      const supersededLike = ProposalExecutor.#toRecipeLike(superseded);
      let bestId = relatedRecipeIds[0];
      let bestSim = -1;
      for (const id of relatedRecipeIds) {
        const cand = await this.#knowledgeRepo.findById(id);
        if (!cand) {
          continue;
        }
        const candLike = ProposalExecutor.#toRecipeLike(cand);
        // U5 #6 conduit：注入预计算 embedding 相似度（缺省→第 3 参 undefined→compute 走纯 Jaccard）。
        const sim = RecipeSimilarity.compute(
          supersededLike,
          candLike,
          this.#embeddingSimProvider?.(supersededLike, candLike)
        );
        if (sim > bestSim) {
          bestSim = sim;
          bestId = id;
        }
      }
      return bestId;
    } catch {
      return relatedRecipeIds[0];
    }
  }

  static #toRecipeLike(e: {
    id?: string;
    title: string;
    doClause?: string;
    dontClause?: string;
    coreCode?: string;
    trigger?: string;
    content?: unknown;
  }): RecipeLike {
    return {
      // U5 #7：保留 recipe id 流通到 embeddingSimProvider（supersede 两侧均为 findById 实体、运行时带 id）。
      id: e.id,
      title: e.title,
      doClause: e.doClause ?? null,
      dontClause: e.dontClause ?? null,
      coreCode: e.coreCode ?? null,
      trigger: e.trigger ?? null,
      content: (e.content as RecipeLike['content']) ?? null,
    };
  }

  /* ── expired pending cleanup ── */

  #expireOldPending(result: ProposalExecutionResult, limit?: number): void {
    const now = Date.now();
    // P3-Core-2：cap 模式下接收跨 observing+pending 的剩余 remaining 预算作 limit（最旧优先 proposedAt 升序），
    // 使整个 capped checkAndExecute tick 严格有界、跨 tick 排空；limit===undefined（无 cap）→ 现行无界全扫（字节一致）。
    // shouldExpirePending 判定/markExpired 写法不动：limit 只限「扫描多少条」，不改「是否过期」。
    const oldPending =
      limit === undefined
        ? this.#repo.find({ status: 'pending' })
        : this.#repo.find({ status: 'pending', limit, oldestFirst: true });

    for (const proposal of oldPending) {
      if (EvolutionPolicy.shouldExpirePending(proposal.proposedAt, now)) {
        this.#repo.markExpired(proposal.id);
        result.expired.push({
          id: proposal.id,
          type: proposal.type,
        });
      }
    }
  }

  /* ═══════════════════ DB Helpers ═══════════════════ */

  #emptyResult(): ProposalExecutionResult {
    return { executed: [], rejected: [], expired: [], skipped: [] };
  }

  async #collectRecipeMetrics(recipeId: string): Promise<RecipeMetrics> {
    const entry = await this.#knowledgeRepo.findById(recipeId);

    if (!entry) {
      return {
        guardHits: 0,
        searchHits: 0,
        hitsLast30d: 0,
        decayScore: 0,
        ruleFalsePositiveRate: 0,
        quality: 0,
      };
    }

    const stats = (entry.stats ?? {}) as unknown as Record<string, unknown>;
    const quality = (entry.quality ?? {}) as unknown as Record<string, unknown>;

    return {
      guardHits: (stats.guardHits as number) ?? 0,
      searchHits: (stats.searchHits as number) ?? 0,
      hitsLast30d: (stats.hitsLast30d as number) ?? 0,
      decayScore: (stats.decayScore as number) ?? 50,
      ruleFalsePositiveRate: (stats.ruleFalsePositiveRate as number) ?? 0,
      quality: (quality.overall as number) ?? 0,
    };
  }

  #extractSnapshot(proposal: ProposalRecord): RecipeMetrics | null {
    for (const ev of proposal.evidence) {
      if (ev.snapshotAt && ev.metrics) {
        const m = ev.metrics as unknown as Record<string, unknown>;
        return {
          guardHits: (m.guardHits as number) ?? 0,
          searchHits: (m.searchHits as number) ?? 0,
          hitsLast30d: (m.hitsLast30d as number) ?? 0,
          decayScore: (m.decayScore as number) ?? 50,
          ruleFalsePositiveRate: (m.ruleFalsePositiveRate as number) ?? 0,
          quality: ((m.quality as unknown as Record<string, unknown>)?.overall as number) ?? 0,
        };
      }
    }
    return null;
  }

  async #tryApplyPatch(
    proposal: ProposalRecord,
    patchSource: 'agent-suggestion' | 'correction' | 'merge'
  ): Promise<import('../../types/evolution.js').ContentPatchResult | null> {
    try {
      return await this.#contentPatcher.applyProposal(proposal, patchSource);
    } catch (err: unknown) {
      this.#logger.warn(
        `[ProposalExecutor] ContentPatcher failed for proposal ${proposal.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  async #createDeprecatedByEdge(newRecipeId: string, oldRecipeId: string): Promise<void> {
    try {
      await this.#edgeRepo.upsertEdge({
        fromId: newRecipeId,
        fromType: 'recipe',
        toId: oldRecipeId,
        toType: 'recipe',
        relation: 'deprecated_by',
        weight: 1.0,
      });
    } catch {
      // knowledge_edges 表可能不存在（降级容忍）
    }
  }
}

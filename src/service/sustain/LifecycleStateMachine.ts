/**
 * LifecycleStateMachine — 自动演化链路的生命周期入口
 *
 * 演化触发方通过 transition() 统一检查状态、持久化并记录事件。
 * 人工 KnowledgeService 操作仍共享同一实体转换表和文件优先边界。
 *
 * 核心职责:
 *   1. Guard 前置检查（合法状态转移验证）
 *   2. 合并离开/进入状态的元数据
 *   3. Markdown 真相写入后更新 DB（旧独立调用方可显式观察 DB-only 兼容诊断）
 *   4. 记录 TransitionEvent（不可变审计日志）
 *   5. 发射 lifecycle Signal（集中信号源）
 *
 * 设计原则:
 *   - 正式宿主注入 fileStore；无 fileStore 的旧构造方式保持兼容并发出诊断
 *   - Guard 拒绝 = 操作失败，调用者不应 fallback 到 updateLifecycle()
 *   - lifecycle signal 仅从此处发射，服务层不直接操作 SignalBus
 *
 * @module service/sustain/LifecycleStateMachine
 */

import { randomUUID } from 'node:crypto';
import { isValidTransition } from '../../domain/knowledge/Lifecycle.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type { LifecycleEventRepository } from '../../repository/evolution/LifecycleEventRepository.js';
import type { ProposalRepository } from '../../repository/evolution/ProposalRepository.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type {
  LifecycleHealthSummary,
  TimeoutCheckResult,
  TransitionEvent,
  TransitionEvidence,
  TransitionRequest,
  TransitionResult,
} from '../../types/evolution.js';
import { persistKnowledgeUpdate } from '../knowledge/persistKnowledgeUpdate.js';
import {
  evaluateRecipeRetrievalReadiness,
  type RetrievalReadinessReport,
} from '../knowledge/RecipeRetrieval.js';

/* ────────────────────── Constants ────────────────────── */

/** 中间态超时配置（毫秒） */
const TIMEOUT_MS = {
  evolving: 7 * 24 * 60 * 60 * 1000, // 7 天
  decaying: 30 * 24 * 60 * 60 * 1000, // 30 天
  staging: 7 * 24 * 60 * 60 * 1000, // 7 天
  pending: 30 * 24 * 60 * 60 * 1000, // 30 天
} as const;

/** 超时后的目标状态 */
const TIMEOUT_TARGET = {
  evolving: 'active',
  decaying: 'deprecated',
  pending: 'deprecated',
} as const;

/** 卡死告警阈值（毫秒） */
const STUCK_THRESHOLD_MS = {
  evolving: 3 * 24 * 60 * 60 * 1000,
  decaying: 15 * 24 * 60 * 60 * 1000,
  staging: 3 * 24 * 60 * 60 * 1000,
  pending: 7 * 24 * 60 * 60 * 1000,
} as const;

/** 进入状态时写入 stats 的元数据键 */
const ENTRY_META_KEYS: Record<string, string> = {
  staging: 'stagingEnteredAt',
  evolving: 'evolvingStartedAt',
  decaying: 'decayStartedAt',
  active: 'activeSince',
};

/* ────────────────────── Class ────────────────────── */

export class LifecycleStateMachine {
  readonly #knowledgeRepo: KnowledgeRepositoryImpl;
  readonly #eventRepo: LifecycleEventRepository;
  readonly #signalBus: SignalBus;
  readonly #proposalRepo: ProposalRepository;
  readonly #fileStore: KnowledgeFileStore | null;
  readonly #logger = Logger.getInstance();
  readonly #retrievalReadinessEvaluator: (
    entry: NonNullable<Awaited<ReturnType<KnowledgeRepositoryImpl['findById']>>>
  ) => RetrievalReadinessReport;

  constructor(
    knowledgeRepo: KnowledgeRepositoryImpl,
    eventRepo: LifecycleEventRepository,
    signalBus: SignalBus,
    proposalRepo: ProposalRepository,
    retrievalReadinessEvaluator: (
      entry: NonNullable<Awaited<ReturnType<KnowledgeRepositoryImpl['findById']>>>
    ) => RetrievalReadinessReport = evaluateRecipeRetrievalReadiness,
    options: { fileStore?: KnowledgeFileStore } = {}
  ) {
    this.#knowledgeRepo = knowledgeRepo;
    this.#eventRepo = eventRepo;
    this.#signalBus = signalBus;
    this.#proposalRepo = proposalRepo;
    this.#retrievalReadinessEvaluator = retrievalReadinessEvaluator;
    this.#fileStore = options.fileStore ?? null;
  }

  /* ═══════════════════ Core Transition ═══════════════════ */

  /**
   * 执行状态转移 — THE ONLY WAY
   *
   * 流程:
   *   1. 读取当前 lifecycle
   *   2. Guard: isValidTransition(from, to)
   *   3. 合并退出/进入状态元数据
   *   4. 文件优先写入 lifecycle 与元数据
   *   5. 记录 TransitionEvent
   *   6. 发射 lifecycle signal
   *
   * Guard 拒绝 → 返回 { success: false }
   * 调用者不应 fallback 到 updateLifecycle()
   */
  async transition(request: TransitionRequest): Promise<TransitionResult> {
    const { recipeId, targetState, trigger, evidence, proposalId, operatorId } = request;
    const opId = operatorId ?? 'system';

    // 1. 获取当前状态
    const current = await this.#knowledgeRepo.findById(recipeId);
    if (!current) {
      return {
        success: false,
        fromState: 'unknown',
        toState: targetState,
        error: 'Recipe not found',
      };
    }

    const fromState = current.lifecycle;

    // 2. Guard 检查
    if (!isValidTransition(fromState, targetState)) {
      this.#logger.warn(
        `[LifecycleStateMachine] Invalid transition: ${recipeId} ${fromState} → ${targetState} (trigger: ${trigger})`
      );
      return {
        success: false,
        fromState,
        toState: targetState,
        error: `Invalid transition: ${fromState} → ${targetState}`,
      };
    }

    if (
      targetState === 'active' &&
      current.knowledgeType !== 'boundary-constraint' &&
      current.category !== 'guard'
    ) {
      const readiness = this.#retrievalReadinessEvaluator(current);
      if (!readiness.ready) {
        return {
          success: false,
          fromState,
          toState: targetState,
          error: 'Recipe retrieval readiness blocks active transition',
          details: { readiness },
        };
      }
    }

    // 离开/进入状态的元数据与 lifecycle 一起写入，文件失败前不留下局部 DB 更新。
    const now = Date.now();
    // 旧 DB-only adapter 返回普通 JSON，正式仓储返回 Stats；两种读取面都保留。
    const hasStatsSerializer = typeof current.stats?.toJSON === 'function';
    const stats: Record<string, unknown> = {
      ...(hasStatsSerializer ? current.stats.toJSON() : (current.stats ?? {})),
    };
    if (!hasStatsSerializer) {
      this.#logger.debug('LifecycleStateMachine: using legacy plain stats', {
        recipeId,
        fromState,
      });
    }
    if (fromState === 'active') {
      stats.lastActiveAt = now;
    }
    const metaKey = ENTRY_META_KEYS[targetState];
    if (metaKey) {
      stats[metaKey] = now;
    }
    if (targetState === 'evolving' && proposalId) {
      stats.evolvingProposalId = proposalId;
    }
    if (targetState === 'active') {
      delete stats.evolvingStartedAt;
      delete stats.evolvingProposalId;
      delete stats.decayStartedAt;
    }
    if (targetState === 'deprecated') {
      stats.deprecatedAt = now;
    }
    await persistKnowledgeUpdate(
      this.#knowledgeRepo,
      this.#fileStore,
      recipeId,
      { lifecycle: targetState, stats },
      'lifecycle-transition'
    );

    // 6. 记录 TransitionEvent
    const event = this.#recordEvent({
      recipeId,
      fromState,
      toState: targetState,
      trigger,
      evidence: evidence ?? null,
      proposalId: proposalId ?? null,
      operatorId: opId,
      createdAt: now,
    });

    // 7. 发射 lifecycle signal
    this.#emitSignal(recipeId, fromState, targetState, trigger);

    this.#logger.info(
      `[LifecycleStateMachine] ${recipeId}: ${fromState} → ${targetState} (trigger: ${trigger})`
    );

    return { success: true, fromState, toState: targetState, event };
  }

  /* ═══════════════════ Timeout Check ═══════════════════ */

  async checkTimeouts(cap?: number): Promise<TimeoutCheckResult> {
    const result: TimeoutCheckResult = { timedOut: [], checked: 0 };
    const now = Date.now();

    // P2 有界化（2026-06-26，daemon-less 自动化补全）：可选 cap 用「跨 timeout 状态共享 remaining 预算」。
    // - cap===undefined：remaining 保持 undefined → 每 state 透传 undefined limit = 现行无界全表（字节一致契约）。
    // - cap 为数值：remaining=cap，按 TIMEOUT_MS 顺序每个 state 以 findAllByLifecycles([state], remaining)
    //   最旧优先(P1 createdAt 升序)+LIMIT 查询，处理后按"本 state 实际扫描(返回)行数"递减 remaining，
    //   remaining<=0 即停后续 state → 单 tick 扫描行数 + 迁移数 ≤ cap、最旧/最积压优先、跨多次 tick 排空。
    // staging 仍因不在 TIMEOUT_TARGET 而被跳过（与 checkAndPromote 不相交，务必保持）；迁移仍全部经 transition()。
    let remaining = cap;

    for (const [state, timeoutMs] of Object.entries(TIMEOUT_MS)) {
      if (!(state in TIMEOUT_TARGET)) {
        continue; // staging 等无目标态的中间态：天然不被 checkTimeouts 触碰
      }

      // cap 模式下预算耗尽：停止后续 state，不再发起查询（避免无谓扫描）
      if (remaining !== undefined && remaining <= 0) {
        break;
      }

      const targetState = TIMEOUT_TARGET[state as keyof typeof TIMEOUT_TARGET];
      // cap 模式把剩余预算作为 limit 透传（P1 最旧优先 + LIMIT）；无 cap 透传 undefined = 无界全表
      const entries = await this.#knowledgeRepo.findAllByLifecycles([state], remaining);

      result.checked += entries.length;
      // 共享预算按本 state 实际扫描行数递减，保证跨状态扫描总行数 ≤ cap
      if (remaining !== undefined) {
        remaining -= entries.length;
      }

      for (const entry of entries) {
        const stats = (entry.stats ?? {}) as unknown as Record<string, unknown>;
        const entryKey = ENTRY_META_KEYS[state];
        const enteredAt = (entryKey ? stats[entryKey] : null) as number | null;

        const stateAge = enteredAt ? now - enteredAt : this.#getRecipeAge(entry, now);
        if (stateAge > timeoutMs) {
          const transitionResult = await this.transition({
            recipeId: entry.id,
            targetState,
            trigger: 'timeout-recovery',
            evidence: {
              reason: `${state} timeout after ${Math.round(stateAge / (24 * 60 * 60 * 1000))}d`,
            },
          });

          if (transitionResult.success) {
            result.timedOut.push({
              recipeId: entry.id,
              fromState: state,
              toState: targetState,
              age: stateAge,
            });
          }
        }
      }
    }

    if (result.timedOut.length > 0) {
      this.#logger.info(
        `[LifecycleStateMachine] Timeout check: ${result.timedOut.length} recipes timed out (checked: ${result.checked})`
      );
    }

    return result;
  }

  /* ═══════════════════ Query ═══════════════════ */

  getHistory(recipeId: string, limit = 50): TransitionEvent[] {
    return this.#eventRepo.getHistory(recipeId, limit);
  }

  async getHealth(): Promise<LifecycleHealthSummary> {
    const now = Date.now();

    const stateDistribution = await this.#getStateDistribution();

    const intermediateStates = {
      stuckEvolving: await this.#getStuckInfo('evolving', STUCK_THRESHOLD_MS.evolving, now),
      stuckDecaying: await this.#getStuckInfo('decaying', STUCK_THRESHOLD_MS.decaying, now),
      stuckStaging: await this.#getStuckInfo('staging', STUCK_THRESHOLD_MS.staging, now),
      stuckPending: await this.#getStuckInfo('pending', STUCK_THRESHOLD_MS.pending, now),
    };

    const recentTransitions = this.#getRecentTransitionStats(now);
    const proposalMetrics = this.#getProposalMetrics();

    return { stateDistribution, intermediateStates, recentTransitions, proposalMetrics };
  }

  /* ═══════════════════ Event Recording ═══════════════════ */

  #recordEvent(params: {
    recipeId: string;
    fromState: string;
    toState: string;
    trigger: string;
    evidence: TransitionEvidence | null;
    proposalId: string | null;
    operatorId: string;
    createdAt: number;
  }): TransitionEvent {
    const id = randomUUID();
    const event: TransitionEvent = {
      id,
      recipeId: params.recipeId,
      fromState: params.fromState,
      toState: params.toState,
      trigger: params.trigger as TransitionEvent['trigger'],
      evidence: params.evidence,
      proposalId: params.proposalId,
      operatorId: params.operatorId,
      createdAt: params.createdAt,
    };

    try {
      this.#eventRepo.record({
        id,
        recipeId: params.recipeId,
        fromState: params.fromState,
        toState: params.toState,
        trigger: params.trigger,
        operatorId: params.operatorId,
        evidence: params.evidence,
        proposalId: params.proposalId,
        createdAt: params.createdAt,
      });
    } catch {
      this.#logger.warn(
        `[LifecycleStateMachine] Failed to record transition event (table may not exist)`
      );
    }

    return event;
  }

  /* ═══════════════════ Health Queries ═══════════════════ */

  async #getStateDistribution(): Promise<Record<string, number>> {
    const dist: Record<string, number> = {
      pending: 0,
      staging: 0,
      active: 0,
      evolving: 0,
      decaying: 0,
      deprecated: 0,
    };

    try {
      const grouped = await this.#knowledgeRepo.countGroupByLifecycle();
      for (const [lifecycle, cnt] of Object.entries(grouped)) {
        dist[lifecycle] = cnt;
      }
    } catch {
      // fallback
    }

    return dist;
  }

  async #getStuckInfo(
    state: string,
    thresholdMs: number,
    now: number
  ): Promise<{ count: number; oldestAge: number }> {
    try {
      const entries = await this.#knowledgeRepo.findAllByLifecycles([state]);

      let stuckCount = 0;
      let oldestAge = 0;

      for (const entry of entries) {
        const stats = (entry.stats ?? {}) as unknown as Record<string, unknown>;
        const metaKey = ENTRY_META_KEYS[state];
        const enteredAt = (metaKey ? stats[metaKey] : null) as number | null;
        const age = enteredAt ? now - enteredAt : this.#getRecipeAge(entry, now);

        if (age > thresholdMs) {
          stuckCount++;
          if (age > oldestAge) {
            oldestAge = age;
          }
        }
      }

      return { count: stuckCount, oldestAge };
    } catch {
      return { count: 0, oldestAge: 0 };
    }
  }

  #getRecentTransitionStats(now: number): {
    last24h: number;
    last7d: number;
    topTriggers: { trigger: string; count: number }[];
  } {
    try {
      const last24hCount = this.#eventRepo.countSince(now - 24 * 60 * 60 * 1000);
      const last7dCount = this.#eventRepo.countSince(now - 7 * 24 * 60 * 60 * 1000);
      const topTriggers = this.#eventRepo.topTriggersSince(now - 7 * 24 * 60 * 60 * 1000, 5);

      return { last24h: last24hCount, last7d: last7dCount, topTriggers };
    } catch {
      return { last24h: 0, last7d: 0, topTriggers: [] };
    }
  }

  #getProposalMetrics(): LifecycleHealthSummary['proposalMetrics'] {
    try {
      const statusMap = this.#proposalRepo.stats();

      const pending = statusMap.pending ?? 0;
      const observing = statusMap.observing ?? 0;
      const executed = statusMap.executed ?? 0;
      const rejected = statusMap.rejected ?? 0;
      const expired = statusMap.expired ?? 0;
      const total = executed + rejected + expired;

      let contentPatchRate = 0;
      try {
        const patchCount = this.#eventRepo.countByTrigger('content-patch-complete');
        const execCount = this.#eventRepo.countByTriggers([
          'proposal-execution',
          'proposal-attach',
        ]);
        contentPatchRate = execCount > 0 ? patchCount / execCount : 0;
      } catch {
        // table may not exist yet
      }

      return {
        pendingCount: pending,
        observingCount: observing,
        executionRate: total > 0 ? executed / total : 0,
        avgObservationDays: 0,
        contentPatchRate,
      };
    } catch {
      return {
        pendingCount: 0,
        observingCount: 0,
        executionRate: 0,
        avgObservationDays: 0,
        contentPatchRate: 0,
      };
    }
  }

  #getRecipeAge(entry: { id: string; updatedAt: number }, now: number): number {
    if (!entry.updatedAt) {
      return 0;
    }
    // KnowledgeEntry / repository 的持久化时间是 Unix 秒；旧导入数据也可能是毫秒。
    // 只在读取观察时长时统一量纲，保留历史存储值，避免新条目被当成存活了数十年。
    const updatedAt = entry.updatedAt;
    const updatedAtMs = updatedAt < 1e12 ? updatedAt * 1000 : updatedAt;
    if (updatedAt >= 1e12) {
      this.#logger.debug('LifecycleStateMachine: using legacy millisecond updatedAt', {
        recipeId: entry.id,
        updatedAt,
        ageMs: now - updatedAtMs,
      });
    }
    return now - updatedAtMs;
  }

  /* ═══════════════════ Signal ═══════════════════ */

  #emitSignal(recipeId: string, fromState: string, toState: string, trigger: string): void {
    this.#signalBus.send('lifecycle', 'LifecycleStateMachine', 0.5, {
      target: recipeId,
      metadata: {
        fromState,
        toState,
        trigger,
      },
    });
  }
}

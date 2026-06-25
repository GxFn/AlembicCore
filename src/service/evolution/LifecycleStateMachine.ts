/**
 * LifecycleStateMachine — 唯一生命周期权威
 *
 * 所有 Recipe lifecycle 变更必须且只能通过本类的 transition() 方法执行。
 * 替代旧的 RecipeLifecycleSupervisor（可选增强层 → 必需权威）。
 *
 * 核心职责:
 *   1. Guard 前置检查（合法状态转移验证）
 *   2. Exit Action（离开旧状态的副作用）
 *   3. DB 更新（lifecycle 字段）
 *   4. Entry Action（进入新状态的副作用）
 *   5. 记录 TransitionEvent（不可变审计日志）
 *   6. 发射 lifecycle Signal（集中信号源）
 *
 * 设计原则:
 *   - 所有依赖必需（non-nullable），消除 `?? null` 分支
 *   - Guard 拒绝 = 操作失败，调用者不应 fallback 到 updateLifecycle()
 *   - lifecycle signal 仅从此处发射，服务层不直接操作 SignalBus
 *
 * @module service/evolution/LifecycleStateMachine
 */

import { randomUUID } from 'node:crypto';
import { isValidTransition } from '../../domain/knowledge/Lifecycle.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type { LifecycleEventRepository } from '../../repository/evolution/LifecycleEventRepository.js';
import type { ProposalRepository } from '../../repository/evolution/ProposalRepository.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type {
  LifecycleHealthSummary,
  TimeoutCheckResult,
  TransitionEvent,
  TransitionEvidence,
  TransitionRequest,
  TransitionResult,
} from '../../types/evolution.js';

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
  readonly #logger = Logger.getInstance();

  constructor(
    knowledgeRepo: KnowledgeRepositoryImpl,
    eventRepo: LifecycleEventRepository,
    signalBus: SignalBus,
    proposalRepo: ProposalRepository
  ) {
    this.#knowledgeRepo = knowledgeRepo;
    this.#eventRepo = eventRepo;
    this.#signalBus = signalBus;
    this.#proposalRepo = proposalRepo;
  }

  /* ═══════════════════ Core Transition ═══════════════════ */

  /**
   * 执行状态转移 — THE ONLY WAY
   *
   * 流程:
   *   1. 读取当前 lifecycle
   *   2. Guard: isValidTransition(from, to)
   *   3. Exit Action
   *   4. DB 更新
   *   5. Entry Action
   *   6. 记录 TransitionEvent
   *   7. 发射 lifecycle signal
   *
   * Guard 拒绝 → 返回 { success: false }
   * 调用者不应 fallback 到 updateLifecycle()
   */
  async transition(request: TransitionRequest): Promise<TransitionResult> {
    const { recipeId, targetState, trigger, evidence, proposalId, operatorId } = request;
    const opId = operatorId ?? 'system';

    // 1. 获取当前状态
    const current = await this.#getRecipeState(recipeId);
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

    // 3. Exit Action
    await this.#executeExitAction(recipeId, fromState);

    // 4. 更新 lifecycle
    const now = Date.now();
    await this.#knowledgeRepo.updateLifecycle(recipeId, targetState);

    // 5. Entry Action
    await this.#executeEntryAction(recipeId, targetState, now, proposalId);

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

        const stateAge = enteredAt ? now - enteredAt : await this.#getRecipeAge(entry.id, now);
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

  /* ═══════════════════ Entry/Exit Actions ═══════════════════ */

  async #executeEntryAction(
    recipeId: string,
    state: string,
    now: number,
    proposalId?: string | null
  ): Promise<void> {
    const metaKey = ENTRY_META_KEYS[state];
    if (!metaKey) {
      return;
    }

    const entry = await this.#knowledgeRepo.findById(recipeId);
    const stats = (entry?.stats ?? {}) as unknown as Record<string, unknown>;
    stats[metaKey] = now;

    if (state === 'evolving' && proposalId) {
      stats.evolvingProposalId = proposalId;
    }
    if (state === 'active') {
      delete stats.evolvingStartedAt;
      delete stats.evolvingProposalId;
      delete stats.decayStartedAt;
    }
    if (state === 'deprecated') {
      stats.deprecatedAt = now;
    }

    await this.#knowledgeRepo.update(recipeId, { stats } as unknown as Record<string, unknown>);
  }

  async #executeExitAction(recipeId: string, state: string): Promise<void> {
    if (state === 'active') {
      const entry = await this.#knowledgeRepo.findById(recipeId);
      const stats = (entry?.stats ?? {}) as unknown as Record<string, unknown>;
      stats.lastActiveAt = Date.now();
      await this.#knowledgeRepo.update(recipeId, { stats } as unknown as Record<string, unknown>);
    }
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
        const age = enteredAt ? now - enteredAt : now - (entry.updatedAt || now);

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

  /* ═══════════════════ DB Helpers ═══════════════════ */

  async #getRecipeState(recipeId: string): Promise<{ lifecycle: string } | null> {
    const entry = await this.#knowledgeRepo.findById(recipeId);
    return entry ? { lifecycle: entry.lifecycle } : null;
  }

  async #getRecipeAge(recipeId: string, now: number): Promise<number> {
    const entry = await this.#knowledgeRepo.findById(recipeId);
    return entry ? now - (entry.updatedAt || now) : 0;
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

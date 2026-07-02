/**
 * StagingManager — staging Grace Period 管理 + 自动发布
 *
 * 核心职责：
 *   1. 条目进入 staging 后记录 deadline
 *   2. 定时检查：deadline 到期 + 无异议 → 自动转 active
 *   3. 异常回滚：Guard 检测到冲突 → 回滚到 pending
 *   4. 发射信号通知 Dashboard
 *
 * 分级 Grace Period（由 ConfidenceRouter 决定）：
 *   ≥ 0.90 → 24h
 *   0.85-0.89 → 72h
 */

import Logger from '../../infrastructure/logging/Logger.js';
import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import { unixNow } from '../../shared/utils/common.js';
import type { TransitionRequest, TransitionResult } from '../../types/evolution.js';

/* ────────────────────── Types ────────────────────── */

export interface StagingEntry {
  id: string;
  title: string;
  stagingDeadline: number;
  confidence: number;
  autoApprovable?: boolean;
}

export interface StagingCheckResult {
  promoted: StagingEntry[];
  rolledBack: StagingEntry[];
  waiting: StagingEntry[];
}

export interface LifecycleTransitionExecutor {
  transition(request: TransitionRequest): Promise<TransitionResult>;
}

export interface StagingManagerOptions {
  signalBus?: SignalBus;
  lifecycle?: LifecycleTransitionExecutor;
}

/* ────────────────────── Class ────────────────────── */

export class StagingManager {
  #knowledgeRepo: KnowledgeRepositoryImpl;
  #signalBus: SignalBus | null;
  #lifecycle: LifecycleTransitionExecutor | null;
  #logger = Logger.getInstance();

  constructor(knowledgeRepo: KnowledgeRepositoryImpl, options: StagingManagerOptions = {}) {
    this.#knowledgeRepo = knowledgeRepo;
    this.#signalBus = options.signalBus ?? null;
    this.#lifecycle = options.lifecycle ?? null;
  }

  /**
   * 将条目推入 staging 状态并记录 deadline
   */
  async enterStaging(entryId: string, gracePeriodMs: number, confidence: number): Promise<boolean> {
    const now = Date.now();
    const deadline = now + gracePeriodMs;

    const entry = await this.#knowledgeRepo.findById(entryId);

    if (!entry) {
      this.#logger.warn(`StagingManager: entry not found: ${entryId}`);
      return false;
    }

    if (entry.lifecycle !== 'pending') {
      this.#logger.warn(`StagingManager: entry ${entryId} is "${entry.lifecycle}", not pending`);
      return false;
    }

    await this.#knowledgeRepo.update(entryId, {
      lifecycle: 'staging',
      stagingDeadline: deadline,
    } as unknown as Record<string, unknown>);

    if (this.#signalBus) {
      this.#signalBus.send('lifecycle', 'StagingManager.enter', confidence, {
        target: entryId,
        metadata: {
          action: 'enter_staging',
          deadline,
          gracePeriodMs,
          title: entry.title,
        },
      });
    }

    this.#logger.info(
      `StagingManager: ${entry.title} → staging (deadline: ${new Date(deadline).toISOString()})`
    );
    return true;
  }

  /**
   * 检查所有 staging 条目，执行自动发布或回滚
   *
   * P1 有界化（2026-06-26，daemon-less 自动化补全）：新增可选 per-call `cap`。
   * - `cap===undefined`：无界（透传 undefined，查询保持今日全表读取，行为字节不变）。
   * - `cap` 为数值：把 cap 作为 limit 透传给查询，按 createdAt「最旧优先」取 ≤cap 条 staging，
   *   故晋级数 ≤cap；跨多次 tick(sweep) 排空积压且不饿死。
   * cap 默认值不在 Core 设——由 Plugin sweep(P1-Plugin) 决定；Core 仅在 cap 给定时执行有界读取。
   */
  async checkAndPromote(cap?: number): Promise<StagingCheckResult> {
    const now = Date.now();
    const result: StagingCheckResult = { promoted: [], rolledBack: [], waiting: [] };

    // 透传 cap 给仓储查询：undefined → 无界；数值 → 最旧优先 + LIMIT，capped 路径不做全表 .all()。
    const entries = await this.#knowledgeRepo.findAllByLifecycles(['staging'], cap);

    for (const e of entries) {
      const deadline = e.stagingDeadline || 0;

      const entry: StagingEntry = {
        id: e.id,
        title: e.title,
        stagingDeadline: deadline,
        confidence: 0,
        autoApprovable: e.autoApprovable,
      };

      if (deadline === 0) {
        result.waiting.push(entry);
        continue;
      }

      if (now < deadline) {
        result.waiting.push(entry);
        continue;
      }

      if (!entry.autoApprovable) {
        result.waiting.push(entry);
        continue;
      }

      const promoted = await this.#promote(entry);
      if (promoted) {
        result.promoted.push(entry);
      } else {
        result.waiting.push(entry);
      }
    }

    if (result.promoted.length > 0) {
      this.#logger.info(`StagingManager: promoted ${result.promoted.length} entries to active`);
    }

    return result;
  }

  /**
   * 回滚 staging 条目到 pending（Guard 检测到冲突时调用）
   */
  async rollback(entryId: string, reason: string): Promise<boolean> {
    const entry = await this.#knowledgeRepo.findById(entryId);

    if (!entry || entry.lifecycle !== 'staging') {
      return false;
    }

    await this.#knowledgeRepo.update(entryId, {
      lifecycle: 'pending',
      stagingDeadline: null,
    } as unknown as Record<string, unknown>);

    if (this.#signalBus) {
      this.#signalBus.send('lifecycle', 'StagingManager.rollback', 0.8, {
        target: entryId,
        metadata: {
          action: 'staging_rollback',
          reason,
          title: entry.title,
        },
      });
    }

    this.#logger.info(`StagingManager: ${entry.title} rolled back to pending — ${reason}`);
    return true;
  }

  /**
   * 获取所有 staging 条目及其状态
   */
  async listStaging(): Promise<StagingEntry[]> {
    const entries = await this.#knowledgeRepo.findAllByLifecycles(['staging']);

    return entries.map((e) => ({
      id: e.id,
      title: e.title,
      stagingDeadline: e.stagingDeadline || 0,
      confidence: 0,
      autoApprovable: e.autoApprovable,
    }));
  }

  /* ── Private ── */

  async #promote(entry: StagingEntry): Promise<boolean> {
    if (!this.#lifecycle) {
      this.#logger.warn(
        `StagingManager: cannot promote ${entry.id}; lifecycle state machine is not configured`
      );
      return false;
    }

    const transition = await this.#lifecycle.transition({
      recipeId: entry.id,
      targetState: 'active',
      trigger: 'grace-period-expire',
      evidence: {
        reason: 'staging deadline expired and recipe is auto-approvable',
      },
      operatorId: 'StagingManager',
    });

    if (!transition.success) {
      this.#logger.warn(
        `StagingManager: failed to promote ${entry.id} — ${transition.error ?? 'unknown error'}`
      );
      return false;
    }

    const nowS = unixNow();
    await this.#knowledgeRepo.update(entry.id, {
      publishedAt: nowS,
      publishedBy: 'StagingManager',
      stagingDeadline: null,
    } as unknown as Record<string, unknown>);

    return true;
  }
}

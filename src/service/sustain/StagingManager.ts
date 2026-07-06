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
  /** 复核期观测面：stats.stagingReview.outcome（pass/fail），缺失=待复核。 */
  reviewOutcome?: 'pass' | 'fail' | null;
}

export interface StagingCheckResult {
  promoted: StagingEntry[];
  rolledBack: StagingEntry[];
  waiting: StagingEntry[];
}

/**
 * 复核队列项——宿主 LLM 做「断言 vs 源码」复核所需的最小内容包。
 * 断言四要素（whenClause/doClause/dontClause/coreCode）+ reasoning.sources（提交时声明的
 * 引用位置，repo 相对 file:line）。宿主据 sources 读源码、对比断言，再经 recordReview 写回。
 */
export interface StagingReviewQueueItem {
  id: string;
  title: string;
  whenClause: string;
  doClause: string;
  dontClause: string;
  coreCode: string;
  sources: string[];
  stagingDeadline: number;
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

      const reviewOutcomeRaw = this.#knowledgeRepo.getStagingReviewSync(e.id)?.outcome;
      const entry: StagingEntry = {
        id: e.id,
        title: e.title,
        stagingDeadline: deadline,
        confidence: 0,
        autoApprovable: e.autoApprovable,
        reviewOutcome:
          reviewOutcomeRaw === 'pass' || reviewOutcomeRaw === 'fail' ? reviewOutcomeRaw : null,
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

      // 复核期晋级门（2026-07-06）：复核结论 fail 的到期条目回滚 pending 而非晋级；
      // pass/缺失走现状（向后兼容——复核缺席不阻断既有 grace 晋级语义）。
      if (entry.reviewOutcome === 'fail') {
        const review = this.#knowledgeRepo.getStagingReviewSync(e.id);
        const rolled = await this.rollback(
          e.id,
          `staging review failed${review?.notes ? `: ${review.notes}` : ''}`
        );
        if (rolled) {
          result.rolledBack.push(entry);
          continue;
        }
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
   * staging 复核结论登记（2026-07-06 复核期落地，observe-first）：grace 窗口从
   * "等待期"升级为"复核期"——AI/人工把"断言 vs 源码"复核结论写回，checkAndPromote
   * 按三态消费：fail=到期回滚 pending（不晋级）；pass/缺失=现状晋级（向后兼容，
   * 复核是增强不是阻断）。结论落 stats.stagingReview（json_set 原子）。
   */
  async recordReview(
    entryId: string,
    review: { outcome: 'pass' | 'fail'; reviewer?: string; notes?: string }
  ): Promise<boolean> {
    const entry = await this.#knowledgeRepo.findById(entryId);
    if (!entry || entry.lifecycle !== 'staging') {
      this.#logger.warn(
        `StagingManager: recordReview skipped — entry ${entryId} is not in staging`
      );
      return false;
    }
    this.#knowledgeRepo.setStagingReviewSync(entryId, {
      outcome: review.outcome,
      ...(review.reviewer ? { reviewer: review.reviewer } : {}),
      ...(review.notes ? { notes: review.notes.slice(0, 500) } : {}),
      reviewedAt: Date.now(),
    });
    if (this.#signalBus) {
      this.#signalBus.send('lifecycle', 'StagingManager.recordReview', 0.8, {
        target: entryId,
        metadata: { action: 'staging_review', outcome: review.outcome, title: entry.title },
      });
    }
    this.#logger.info(
      `StagingManager: staging review recorded for ${entry.title} — ${review.outcome}`
    );
    return true;
  }

  /**
   * 复核队列（Option A：宿主 LLM 按需复核的只读读面，observe-first）。
   *
   * 返回 staging 中「尚无 pass/fail 复核结论」的条目及其「断言 vs 源码」复核所需内容。宿主 LLM
   * （本就在读该仓库）在 pendingReviewCount>0 时顺手拉取本队列，按 sources 读引用源码、对比 doClause/
   * dontClause/coreCode 断言是否与真实源码一致，再经 recordReview（manage 'review' / HTTP）写回结论。
   * 系统只做「确定性标记」（列队列 + 记录结论），「概率性消解」（判断断言真伪）交给宿主 LLM。
   *
   * @param limit 可选上界；透传 findAllByLifecycles（最旧优先），不传=无界。
   */
  async listReviewQueue(limit?: number): Promise<StagingReviewQueueItem[]> {
    const entries = await this.#knowledgeRepo.findAllByLifecycles(['staging'], limit);
    const queue: StagingReviewQueueItem[] = [];
    for (const e of entries) {
      // 已有 pass/fail 结论的不再列入待复核队列（与 checkAndPromote 三态门口径一致）。
      const outcome = this.#knowledgeRepo.getStagingReviewSync(e.id)?.outcome;
      if (outcome === 'pass' || outcome === 'fail') {
        continue;
      }
      const sources = Array.isArray(e.reasoning?.sources)
        ? e.reasoning.sources.filter((s): s is string => typeof s === 'string')
        : [];
      queue.push({
        id: e.id,
        title: e.title,
        whenClause: e.whenClause ?? '',
        doClause: e.doClause ?? '',
        dontClause: e.dontClause ?? '',
        coreCode: e.coreCode ?? '',
        sources,
        stagingDeadline: e.stagingDeadline || 0,
      });
    }
    return queue;
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

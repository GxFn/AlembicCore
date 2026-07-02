/**
 * DecayDetector — 知识衰退检测 + 评分
 *
 * 6 种衰退检测策略（任一满足即触发 decaying 转换）：
 *   1. daysSinceLastHit > 90 — 90 天无使用
 *   2. ruleFalsePositiveRate > 0.4 && triggers > 10 — 规则已不准
 *   3. SourceRefReconciler: 来源文件路径失效（recipe_source_refs.status = stale）
 *   4. 同域新 Recipe 发布且 deprecated_by 关系指向它
 *   5. 矛盾检测: Agent 在 evolve 流程中语义判断
 *
 * 衰退评分 (decayScore 0-100):
 *   freshness(0.3) + usage(0.3) + quality(0.2) + authority(0.2)
 *
 *   80-100: 健康 → 不转换
 *   60-79:  关注 → Dashboard 警告
 *   40-59:  衰退 → active → decaying
 *   20-39:  严重 → Grace Period 缩短到 15d
 *   0-19:   死亡 → 跳过确认直接 deprecated
 */

import Logger from '../../infrastructure/logging/Logger.js';
import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type { KnowledgeEdgeRepositoryImpl } from '../../repository/knowledge/KnowledgeEdgeRepository.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type { RecipeSourceRefRepositoryImpl } from '../../repository/sourceref/RecipeSourceRefRepository.js';
import type { LifecycleStateMachine } from './LifecycleStateMachine.js';

export interface DecaySignal {
  recipeId: string;
  strategy: DecayStrategy;
  detail: string;
}

export type DecayStrategy =
  | 'no_recent_usage'
  | 'high_false_positive'
  | 'source_ref_stale'
  | 'superseded'
  | 'contradiction';

export interface DecayScoreResult {
  recipeId: string;
  title: string;
  decayScore: number;
  level: 'healthy' | 'watch' | 'decaying' | 'severe' | 'dead';
  signals: DecaySignal[];
  dimensions: {
    freshness: number;
    usage: number;
    quality: number;
    authority: number;
  };
  /** 建议的 Grace Period (ms)。severe=15d，dead=0 */
  suggestedGracePeriod: number;
}

interface RecipeForDecay {
  id: string;
  title: string;
  lifecycle: string;
  stats: string | null;
  quality_grade: string | null;
  quality_score: number | null;
  created_at: number | null;
}

/* ────────────────────── Helpers ────────────────────── */

/**
 * Normalize a timestamp to **milliseconds**.
 * If the value looks like Unix seconds (< 1e12 ≈ year 2001 in ms), multiply by 1000.
 * Otherwise assume it's already in ms and return as-is.
 */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/* ────────────────────── Constants ────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_STANDARD = 30 * DAY_MS;
const GRACE_PERIOD_SEVERE = 15 * DAY_MS;

const DECAY_THRESHOLDS = {
  /** 无使用天数上限 */
  NO_USAGE_DAYS: 90,
  /** FP 率上限 */
  FALSE_POSITIVE_RATE: 0.4,
  /** FP 率可靠性所需最少触发次数 */
  MIN_FP_TRIGGERS: 10,
};

const SCORE_WEIGHTS = {
  freshness: 0.3,
  usage: 0.3,
  quality: 0.2,
  authority: 0.2,
};

/* ────────────────────── Class ────────────────────── */

export class DecayDetector {
  #knowledgeRepo: KnowledgeRepositoryImpl;
  #edgeRepo: KnowledgeEdgeRepositoryImpl | null;
  #sourceRefRepo: RecipeSourceRefRepositoryImpl | null;
  #signalBus: SignalBus | null;
  /** U4：可选生命周期状态机；注入后 scanAll 直接驱动 active→decaying 迁移（B1：不依赖信号订阅）。 */
  #lifecycleStateMachine: LifecycleStateMachine | null;
  #logger = Logger.getInstance();

  constructor(
    knowledgeRepo: KnowledgeRepositoryImpl,
    options: {
      signalBus?: SignalBus;
      knowledgeEdgeRepo?: KnowledgeEdgeRepositoryImpl;
      sourceRefRepo?: RecipeSourceRefRepositoryImpl;
      /** U4：可选生命周期状态机，注入后 scanAll 驱动衰减迁移；不传则仅评估 + 发信号（向后兼容）。 */
      lifecycleStateMachine?: LifecycleStateMachine;
      /** 旧调用方可继续传入；DecayDetector 不再读取 audit log。 */
      drizzle?: unknown;
    } = {}
  ) {
    this.#knowledgeRepo = knowledgeRepo;
    this.#edgeRepo = options.knowledgeEdgeRepo ?? null;
    this.#sourceRefRepo = options.sourceRefRepo ?? null;
    this.#signalBus = options.signalBus ?? null;
    this.#lifecycleStateMachine = options.lifecycleStateMachine ?? null;
  }

  /**
   * 扫描所有 active 条目的衰退状态
   */
  async scanAll(cap?: number): Promise<DecayScoreResult[]> {
    const recipes = await this.#loadActiveRecipes(cap);
    const results: DecayScoreResult[] = [];

    for (const recipe of recipes) {
      const result = await this.evaluate(recipe);
      results.push(result);
    }

    // U4 衰减触发器恢复：对 level∈{decaying,severe,dead} 的 active recipe 直接驱动 active→decaying 迁移。
    // B1：不依赖 ProposalExecutor 信号订阅（#onSignal 需预存 observing proposal，decay 无预建 → 落空），
    // 故 tick 直走注入的 lifecycleStateMachine.transition；isValidTransition guard 保证 decaying→decaying 幂等 no-op。
    // decaying→deprecated 仍由现役 checkTimeouts 30d 接管（不在本任务）。下方 signalBus.send('decay') 保留作可观测。
    if (this.#lifecycleStateMachine) {
      for (const r of results) {
        if (r.level === 'decaying' || r.level === 'severe' || r.level === 'dead') {
          await this.#lifecycleStateMachine.transition({
            recipeId: r.recipeId,
            targetState: 'decaying',
            trigger: 'decay-detection',
            evidence: {
              reason: `decay level=${r.level} score=${r.decayScore}`,
              decayScore: r.decayScore,
            },
          });
        }
      }
    }

    // 发射衰退信号（可观测，保留）
    if (this.#signalBus) {
      for (const r of results) {
        if (r.level !== 'healthy') {
          this.#signalBus.send('decay', 'DecayDetector', 1 - r.decayScore / 100, {
            target: r.recipeId,
            metadata: {
              level: r.level,
              decayScore: r.decayScore,
              signals: r.signals.map((s) => s.strategy),
            },
          });
        }
      }
    }

    this.#logger.debug(
      `DecayDetector: scanned ${results.length} recipes, ${results.filter((r) => r.level !== 'healthy').length} need attention`
    );
    return results;
  }

  /**
   * 评估单条 Recipe 的衰退状态
   */
  async evaluate(recipe: RecipeForDecay): Promise<DecayScoreResult> {
    const stats = DecayDetector.#parseStats(recipe.stats);
    const signals: DecaySignal[] = [];
    const now = Date.now();

    // 策略 1: 90 天无使用
    const lastHitAt = stats.lastHitAt ?? null;
    if (lastHitAt) {
      const daysSince = (now - toMs(lastHitAt as number)) / DAY_MS;
      if (daysSince > DECAY_THRESHOLDS.NO_USAGE_DAYS) {
        signals.push({
          recipeId: recipe.id,
          strategy: 'no_recent_usage',
          detail: `No usage in ${Math.round(daysSince)} days (threshold: ${DECAY_THRESHOLDS.NO_USAGE_DAYS}d)`,
        });
      }
    } else {
      // 无 lastHitAt，检查创建时间（DB 可能存为秒或毫秒）
      const createdAt = toMs(recipe.created_at ?? now);
      const daysSinceCreation = (now - createdAt) / DAY_MS;
      if (daysSinceCreation > DECAY_THRESHOLDS.NO_USAGE_DAYS) {
        signals.push({
          recipeId: recipe.id,
          strategy: 'no_recent_usage',
          detail: `Never used, created ${Math.round(daysSinceCreation)} days ago`,
        });
      }
    }

    // 策略 2: 高 FP 率
    const fpRate = stats.ruleFalsePositiveRate ?? 0;
    const triggers = stats.guardHits ?? 0;
    if (
      fpRate > DECAY_THRESHOLDS.FALSE_POSITIVE_RATE &&
      triggers >= DECAY_THRESHOLDS.MIN_FP_TRIGGERS
    ) {
      signals.push({
        recipeId: recipe.id,
        strategy: 'high_false_positive',
        detail: `FP rate ${(fpRate * 100).toFixed(0)}% with ${triggers} triggers (threshold: ${DECAY_THRESHOLDS.FALSE_POSITIVE_RATE * 100}%)`,
      });
    }

    // 策略 3: 来源引用失效（由 SourceRefReconciler 填充 recipe_source_refs）
    const staleRefCount = await this.#getStaleSourceRefCount(recipe.id);
    if (staleRefCount > 0) {
      signals.push({
        recipeId: recipe.id,
        strategy: 'source_ref_stale',
        detail: `${staleRefCount} source reference(s) no longer exist on disk`,
      });
    }

    // 策略 4: 被取代（有 deprecated_by 关系指向更新版本）
    if (await this.#isSuperseded(recipe.id)) {
      signals.push({
        recipeId: recipe.id,
        strategy: 'superseded',
        detail: 'Newer version exists via deprecated_by relation',
      });
    }

    // 计算 decayScore（staleRatio 影响 quality 维度）
    const staleRatio = await this.#getSourceRefStaleRatio(recipe.id);
    const dimensions = this.#computeScoreDimensions(stats, recipe, { staleRatio });
    const decayScore = Math.round(
      dimensions.freshness * SCORE_WEIGHTS.freshness * 100 +
        dimensions.usage * SCORE_WEIGHTS.usage * 100 +
        dimensions.quality * SCORE_WEIGHTS.quality * 100 +
        dimensions.authority * SCORE_WEIGHTS.authority * 100
    );

    const level = DecayDetector.#scoreToLevel(decayScore);
    const suggestedGracePeriod =
      level === 'dead' ? 0 : level === 'severe' ? GRACE_PERIOD_SEVERE : GRACE_PERIOD_STANDARD;

    return {
      recipeId: recipe.id,
      title: recipe.title,
      decayScore,
      level,
      signals,
      dimensions,
      suggestedGracePeriod,
    };
  }

  /* ── Internal ── */

  async #loadActiveRecipes(cap?: number): Promise<RecipeForDecay[]> {
    try {
      // U4 有界化：cap 给定时透传给 findAllByLifecycles（已支持 limit + 最旧优先 createdAt 升序）；
      // undefined 保持无界全表（字节兼容，无 cap 调用方不变）。Core 不设默认（由 Plugin sweep 定）。
      const entries = await this.#knowledgeRepo.findAllByLifecycles(['active'], cap);
      return entries.map((e) => {
        const qualityObj =
          typeof e.quality === 'object'
            ? {
                grade: (e.quality as { grade?: string }).grade ?? null,
                score: (e.quality as { overall?: number }).overall ?? null,
              }
            : DecayDetector.#parseQuality(null);
        return {
          id: e.id,
          title: e.title,
          lifecycle: e.lifecycle,
          stats: typeof e.stats === 'object' ? JSON.stringify(e.stats) : null,
          quality_grade: qualityObj.grade,
          quality_score: qualityObj.score,
          created_at: e.createdAt ?? null,
        };
      });
    } catch {
      return [];
    }
  }

  static #parseStats(statsJson: string | null): Record<string, number | null> {
    if (!statsJson) {
      return {};
    }
    try {
      return JSON.parse(statsJson) as Record<string, number | null>;
    } catch {
      return {};
    }
  }

  static #parseQuality(qualityJson: string | null): { grade: string | null; score: number | null } {
    if (!qualityJson) {
      return { grade: null, score: null };
    }
    try {
      const obj = JSON.parse(qualityJson) as Record<string, unknown>;
      return {
        grade: typeof obj.grade === 'string' ? obj.grade : null,
        score: typeof obj.overall === 'number' ? obj.overall : null,
      };
    } catch {
      return { grade: null, score: null };
    }
  }

  #computeScoreDimensions(
    stats: Record<string, number | null>,
    recipe: RecipeForDecay,
    context: { staleRatio?: number } = {}
  ): { freshness: number; usage: number; quality: number; authority: number } {
    const now = Date.now();

    // freshness: days since last hit → 0-1（0 = 365+ 天，1 = 今天）
    // cold-start grace（U4，CG-4）：缺 lastHitAt 时回落 createdAt 作新鲜度锚点（镜像策略1 :177-188 的 created_at 路径），
    // 使健康新 recipe（lastHitAt=null/createdAt=now）首 tick freshness≈1、不被误判 severe/dead；createdAt 亦缺则回落 now。
    // 仅给「新创建」豁免：createdAt 早于 365 天的从未使用条目仍随龄衰减——未放松衰减门禁，仅补冷启动 grace。
    const lastHit = (stats.lastHitAt as number) ?? 0;
    const freshnessAnchorMs = lastHit > 0 ? toMs(lastHit) : toMs(recipe.created_at ?? now);
    const daysSinceHit = (now - freshnessAnchorMs) / DAY_MS;
    const freshness = Math.max(0, 1 - daysSinceHit / 365);

    // usage: hitsLast90d 归一化 (0 = 0 hits, 1 = 50+ hits)
    const hitsLast90d = (stats.hitsLast90d as number) ?? 0;
    const usage = Math.min(1, hitsLast90d / 50);

    // quality: qualityScore × sourceRef 健康度
    // staleRatio 对 quality 打折，最多压低 30%（全部 stale → ×0.7）
    const baseQuality = recipe.quality_score ?? 0.5;
    const staleRatio = context.staleRatio ?? 0;
    const quality = baseQuality * (1 - staleRatio * 0.3);

    // authority: from stats.authority 归一化（0-5 域 → 0-1）。
    // 量纲来源：KnowledgeService.ts:768 写入 authority = Math.round(qualityScore * 5)，故 authority ∈ [0,5]。
    // 旧实现误用 /100（当 0-100 域）→ 高 authority(如 4) 被压成 ~0.04、掩盖衰减；缺 key 时旧默认 50(0-100 中性)同样掩盖。
    // 修正：/5 归一 + Math.max(0,...) 兜底；缺 stats.authority 时取 0-5 域中性默认 2.5（→0.5）。
    const authorityRaw = (stats.authority as number) ?? 2.5;
    const authority = Math.min(1, Math.max(0, authorityRaw / 5));

    return { freshness, usage, quality, authority };
  }

  async #getStaleSourceRefCount(recipeId: string): Promise<number> {
    try {
      if (!this.#sourceRefRepo) {
        return 0;
      }
      const refs = this.#sourceRefRepo.findByRecipeId(recipeId);
      return refs.filter((r) => r.status === 'stale').length;
    } catch {
      return 0;
    }
  }

  async #getSourceRefStaleRatio(recipeId: string): Promise<number> {
    try {
      if (!this.#sourceRefRepo) {
        return 0;
      }
      const refs = this.#sourceRefRepo.findByRecipeId(recipeId);
      if (refs.length === 0) {
        return 0;
      }
      const stale = refs.filter((r) => r.status === 'stale').length;
      return stale / refs.length;
    } catch {
      return 0;
    }
  }

  async #isSuperseded(recipeId: string): Promise<boolean> {
    try {
      if (!this.#edgeRepo) {
        return false;
      }
      const edges = await this.#edgeRepo.findByRelation(recipeId, 'recipe', 'deprecated_by');
      return edges.length > 0;
    } catch {
      return false;
    }
  }

  static #scoreToLevel(score: number): 'healthy' | 'watch' | 'decaying' | 'severe' | 'dead' {
    if (score >= 80) {
      return 'healthy';
    }
    if (score >= 60) {
      return 'watch';
    }
    if (score >= 40) {
      return 'decaying';
    }
    if (score >= 20) {
      return 'severe';
    }
    return 'dead';
  }
}

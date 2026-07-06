/**
 * DecayDetector 单元测试
 *
 * U4：authority 改用真实 0-5 域（KnowledgeService.ts:768 写入 Math.round(score*5)）；
 * 测试值从旧 0-100 域（80/100=掩盖 authority bug 的元凶）改为 0-5 域（healthy 4-5、severe/dead 0-1）。
 * 新增：authority 归一断言、cold-start 不误判、scanAll(cap) 有界、注入 lifecycle 驱动迁移。
 */
import { describe, expect, it } from 'vitest';
import { DecayDetector } from '../../src/service/sustain/DecayDetector.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeMockRepo(entries: Record<string, unknown>[] = []) {
  return {
    findAllByLifecycles: async (_lifecycles?: unknown, _limit?: unknown) => entries,
    findById: async (id: string) => entries.find((e) => e.id === id) || null,
    updateLifecycle: async () => {},
  };
}

function makeMockEdgeRepo(hasEdge: boolean) {
  return {
    findByRelation: async () => (hasEdge ? [{ id: 'edge-1' }] : []),
  };
}

function makeMockSourceRefRepo(staleCount: number, totalCount?: number) {
  const total = totalCount ?? staleCount;
  const refs: { status: string }[] = [];
  for (let i = 0; i < total; i++) {
    refs.push({ status: i < staleCount ? 'stale' : 'valid' });
  }
  return {
    findByRecipeId: () => refs,
  };
}

function makeRecipe(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    title: 'Test Recipe',
    lifecycle: 'active',
    stats: null as string | null,
    quality_grade: null as string | null,
    quality_score: null as number | null,
    created_at: null as number | null,
    ...overrides,
  };
}

describe('DecayDetector', () => {
  it('should score a healthy recipe with recent usage', async () => {
    const now = Date.now();
    const stats = JSON.stringify({
      lastHitAt: now - 2 * DAY_MS, // 2 days ago
      hitsLast90d: 30,
      authority: 5, // 0-5 域：满 authority
    });
    const recipe = makeRecipe({ stats, quality_score: 0.9 });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    expect(result.level).toBe('healthy');
    expect(result.decayScore).toBeGreaterThanOrEqual(80);
    expect(result.signals).toHaveLength(0);
    expect(result.suggestedGracePeriod).toBe(30 * DAY_MS);
  });

  it('should detect no_recent_usage when lastHitAt > 90d', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 120 * DAY_MS, // 120 days ago
      hitsLast90d: 0,
      authority: 2.5, // 0-5 域中性
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'no_recent_usage')).toBe(true);
    expect(result.level).not.toBe('healthy');
  });

  it('should detect no_recent_usage for never-used old recipes', async () => {
    const created = Date.now() - 120 * DAY_MS;
    const recipe = makeRecipe({ stats: null, quality_score: 0.5, created_at: created });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'no_recent_usage')).toBe(true);
  });

  it('should detect high_false_positive when rate > 0.4 and triggers >= 10', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 10 * DAY_MS,
      hitsLast90d: 15,
      ruleFalsePositiveRate: 0.6,
      guardHits: 20,
      authority: 2.5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'high_false_positive')).toBe(true);
  });

  it('should NOT flag high_false_positive with insufficient triggers', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 10 * DAY_MS,
      hitsLast90d: 5,
      ruleFalsePositiveRate: 0.8,
      guardHits: 5, // < 10
      authority: 2.5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'high_false_positive')).toBe(false);
  });

  it('should detect superseded from deprecated_by edge', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 10 * DAY_MS,
      hitsLast90d: 10,
      authority: 2.5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any, {
      knowledgeEdgeRepo: makeMockEdgeRepo(true) as any,
    });

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'superseded')).toBe(true);
  });

  it('should classify score levels correctly', async () => {
    const detector = new DecayDetector(makeMockRepo() as any);

    // healthy: high freshness, usage, quality, authority（0-5 域满 authority=5）
    const healthy = await detector.evaluate(
      makeRecipe({
        stats: JSON.stringify({
          lastHitAt: Date.now() - 1 * DAY_MS,
          hitsLast90d: 50,
          authority: 5,
        }),
        quality_score: 1.0,
      })
    );
    expect(healthy.level).toBe('healthy');

    // dead: no usage for over a year, low everything（authority=0）
    const dead = await detector.evaluate(
      makeRecipe({
        stats: JSON.stringify({
          lastHitAt: Date.now() - 400 * DAY_MS,
          hitsLast90d: 0,
          authority: 0,
        }),
        quality_score: 0,
      })
    );
    expect(dead.level).toBe('dead');
    expect(dead.suggestedGracePeriod).toBe(0);
  });

  it('should set grace period to 15d for severe', async () => {
    // severe means decayScore 20-39（0-5 域：低 freshness/usage/quality/authority）
    const detector = new DecayDetector(makeMockRepo() as any);
    const result = await detector.evaluate(
      makeRecipe({
        stats: JSON.stringify({
          lastHitAt: Date.now() - 200 * DAY_MS,
          hitsLast90d: 0,
          authority: 1, // 0-5 域低 authority
        }),
        quality_score: 0.2,
      })
    );

    expect(result.level).toBe('severe');
    expect(result.suggestedGracePeriod).toBe(15 * DAY_MS);
    expect(result.decayScore).toBeLessThan(80);
  });

  it('should detect source_ref_stale from recipe_source_refs', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 10 * DAY_MS,
      hitsLast90d: 10,
      authority: 2.5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any, {
      sourceRefRepo: makeMockSourceRefRepo(2) as any,
    });

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'source_ref_stale')).toBe(true);
    expect(result.signals.find((s) => s.strategy === 'source_ref_stale')?.detail).toContain(
      '2 source reference(s)'
    );
  });

  it('should NOT flag source_ref_stale when no stale refs', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 10 * DAY_MS,
      hitsLast90d: 10,
      authority: 2.5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.5 });
    const detector = new DecayDetector(makeMockRepo() as any, {
      sourceRefRepo: makeMockSourceRefRepo(0, 2) as any,
    });

    const result = await detector.evaluate(recipe);
    expect(result.signals.some((s) => s.strategy === 'source_ref_stale')).toBe(false);
  });

  it('should penalize quality dimension based on staleRatio', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 2 * DAY_MS,
      hitsLast90d: 30,
      authority: 5,
    });
    // All refs stale: staleRatio = 3/3 = 1.0 → quality × 0.7
    const recipe = makeRecipe({ stats, quality_score: 0.9 });
    const detector = new DecayDetector(makeMockRepo() as any, {
      sourceRefRepo: makeMockSourceRefRepo(3, 3) as any,
    });

    const result = await detector.evaluate(recipe);
    // quality = 0.9 × 0.7 = 0.63
    expect(result.dimensions.quality).toBeCloseTo(0.63, 1);
  });

  it('should recover quality when stale ratio drops to zero (self-repair)', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 2 * DAY_MS,
      hitsLast90d: 30,
      authority: 5,
    });
    const recipe = makeRecipe({ stats, quality_score: 0.9 });

    // After repair: 0 stale, 3 total → staleRatio = 0
    const detector = new DecayDetector(makeMockRepo() as any, {
      sourceRefRepo: makeMockSourceRefRepo(0, 3) as any,
    });

    const result = await detector.evaluate(recipe);
    // quality should be unpenalized
    expect(result.dimensions.quality).toBeCloseTo(0.9, 1);
  });

  it('should apply partial penalty for partial staleness', async () => {
    const stats = JSON.stringify({
      lastHitAt: Date.now() - 2 * DAY_MS,
      hitsLast90d: 30,
      authority: 5,
    });
    // 1 of 2 stale: staleRatio = 0.5 → quality × 0.85
    const recipe = makeRecipe({ stats, quality_score: 0.8 });
    const detector = new DecayDetector(makeMockRepo() as any, {
      sourceRefRepo: makeMockSourceRefRepo(1, 2) as any,
    });

    const result = await detector.evaluate(recipe);
    // quality = 0.8 × (1 - 0.5 × 0.3) = 0.8 × 0.85 = 0.68
    expect(result.dimensions.quality).toBeCloseTo(0.68, 1);
  });

  it('scanAll emits decay signals for non-healthy recipes', async () => {
    const repoEntries = [
      {
        id: 'r1',
        title: 'Decaying recipe',
        lifecycle: 'active',
        stats: {
          lastHitAt: Date.now() - 200 * DAY_MS,
          hitsLast90d: 0,
          authority: 1, // 0-5 域
        },
        quality: { grade: null, overall: 0.2 },
        createdAt: null,
      },
    ];

    const signals: unknown[] = [];
    const signalBus = { send: (...args: unknown[]) => signals.push(args) };
    const detector = new DecayDetector(makeMockRepo(repoEntries) as any, {
      signalBus: signalBus as never,
    });

    const results = await detector.scanAll();
    expect(results.length).toBe(1);
    expect(results[0].level).not.toBe('healthy');
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  /* ─────────────── U4 新增：authority 0-5 域 + cold-start + cap + transition ─────────────── */

  it('U4 authority 归一在 0-5 域 (4→0.8, 0→0, 5→1, 缺 key→0.5)', async () => {
    const detector = new DecayDetector(makeMockRepo() as any);
    const base = { lastHitAt: Date.now() - 1 * DAY_MS, hitsLast90d: 10 };

    const a4 = await detector.evaluate(
      makeRecipe({ stats: JSON.stringify({ ...base, authority: 4 }), quality_score: 0.8 })
    );
    expect(a4.dimensions.authority).toBeCloseTo(0.8, 5);

    const a0 = await detector.evaluate(
      makeRecipe({ stats: JSON.stringify({ ...base, authority: 0 }), quality_score: 0.8 })
    );
    expect(a0.dimensions.authority).toBe(0);

    const a5 = await detector.evaluate(
      makeRecipe({ stats: JSON.stringify({ ...base, authority: 5 }), quality_score: 0.8 })
    );
    expect(a5.dimensions.authority).toBe(1);

    // 缺 stats.authority → 0-5 域中性默认 2.5 → 0.5（旧默认 50/100=0.5 巧合相同，但量纲已修正）
    const aMissing = await detector.evaluate(
      makeRecipe({ stats: JSON.stringify({ ...base }), quality_score: 0.8 })
    );
    expect(aMissing.dimensions.authority).toBe(0.5);
  });

  it('U4 cold-start：健康新 recipe (lastHitAt=null, createdAt=now, authority=4) 直接走新条目豁免', async () => {
    const now = Date.now();
    // BiliDili 同形：从未命中、刚创建、quality=0.85、authority=4(0-5 域)
    const recipe = makeRecipe({
      stats: JSON.stringify({ authority: 4, hitsLast90d: 0 }),
      quality_score: 0.85,
      created_at: now,
    });
    const detector = new DecayDetector(makeMockRepo() as any);

    const result = await detector.evaluate(recipe);
    // 2026-07-06 真机定案：createdAt 14 天内的条目不进衰减评分，避免刚晋级 active 即被打回 decaying。
    expect(result.level).toBe('healthy');
    expect(result.decayScore).toBe(100);
    expect(result.signals).toHaveLength(0);
    expect(result.suggestedGracePeriod).toBe(0);
  });

  it('U4 scanAll(cap) 把 limit 透传给 findAllByLifecycles；undefined 保持无界', async () => {
    const calls: Array<[unknown, unknown]> = [];
    const repo = {
      findAllByLifecycles: async (lifecycles: unknown, limit: unknown) => {
        calls.push([lifecycles, limit]);
        return [];
      },
    };
    const detector = new DecayDetector(repo as any);

    await detector.scanAll(3);
    expect(calls[0]).toEqual([['active'], 3]);

    await detector.scanAll();
    expect(calls[1]).toEqual([['active'], undefined]);
  });

  it('U4 scanAll 经注入 lifecycle 直接驱动 active→decaying（仅 non-healthy；不依赖信号订阅）', async () => {
    const now = Date.now();
    const entries = [
      {
        id: 'sev',
        title: 'severe',
        lifecycle: 'active',
        stats: { lastHitAt: now - 200 * DAY_MS, hitsLast90d: 0, authority: 1 },
        quality: { overall: 0.2 },
        createdAt: null,
      },
      {
        id: 'fresh',
        title: 'healthy new',
        lifecycle: 'active',
        stats: { authority: 4, hitsLast90d: 0 },
        quality: { overall: 0.85 },
        createdAt: now,
      },
    ];

    const transitions: Array<Record<string, unknown>> = [];
    const lifecycle = {
      transition: async (req: Record<string, unknown>) => {
        transitions.push(req);
        return { success: true };
      },
    };
    const detector = new DecayDetector(makeMockRepo(entries) as any, {
      lifecycleStateMachine: lifecycle as any,
    });

    await detector.scanAll();

    // 仅对 non-healthy(severe) 驱动 transition；cold-start 健康新条目(fresh→watch) 不驱动
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      recipeId: 'sev',
      targetState: 'decaying',
      trigger: 'decay-detection',
    });
  });
});

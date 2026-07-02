/**
 * U5-Core-2 — embeddingSimProvider 注入 conduit（U5 #6 收口）。
 *
 * 覆盖①provider 接通：注入 0.9 → content 维度走 max(Jaccard, 0.9)=0.9（高于纯 Jaccard 0.71），similarity 抬升；
 * ②缺省回退：不注入 → content = 纯 Jaccard（与 computeDimensions 无第3参逐值同、同入同出确定），既有 evolution 单测零回归。
 *
 * 经 RedundancyAnalyzer.analyzePair（public，options-ctor）验证 conduit；ConsolidationAdvisor/ProposalExecutor
 * 同签名 provider 由 build:check + 既有单测保证。content 维度 token 取自 coreCode + 代码块，故构造
 * 仅 1 个标识符不同的 coreCode/代码块 → 纯 Jaccard 落在 (0,0.9)，注入 0.9 必胜。
 */
import { describe, expect, it } from 'vitest';
import { RecipeSimilarity } from '../../src/domain/evolution/RecipeSimilarity.js';
import { RedundancyAnalyzer } from '../../src/service/sustain/RedundancyAnalyzer.js';

type RecipePair = Parameters<RedundancyAnalyzer['analyzePair']>[0];

const SHARED = {
  title: 'shared title token',
  doClause: 'shared do clause',
  dontClause: 'shared dont clause',
  guardPattern: 'shared-guard',
} as const;

const A = {
  ...SHARED,
  id: 'a',
  coreCode: 'function handler(){ return alpha(beta, gamma, kilo); }',
  content: { markdown: '```ts\nhandler(alpha, beta, gamma, kilo)\n```', pattern: 'shared-pat' },
} as unknown as RecipePair;

const B = {
  ...SHARED,
  id: 'b',
  coreCode: 'function handler(){ return alpha(beta, gamma, lima); }',
  content: { markdown: '```ts\nhandler(alpha, beta, gamma, lima)\n```', pattern: 'shared-pat' },
} as unknown as RecipePair;

describe('U5-Core-2 embeddingSimProvider conduit', () => {
  it('① provider 接通：注入 0.9 → content=max(Jaccard,0.9)=0.9，similarity 抬升', () => {
    const withProvider = new RedundancyAnalyzer({} as never, { embeddingSimProvider: () => 0.9 });
    const withoutProvider = new RedundancyAnalyzer({} as never);

    const withRes = withProvider.analyzePair(A, B);
    const withoutRes = withoutProvider.analyzePair(A, B);

    expect(withRes).not.toBeNull();
    expect(withoutRes).not.toBeNull();
    // 注入的 0.9 赢过 content 纯 Jaccard（≈0.71）
    expect(withRes?.dimensions.content).toBe(0.9);
    expect(withoutRes?.dimensions.content).toBeLessThan(0.9);
    expect(withRes?.dimensions.content).toBeGreaterThan(withoutRes?.dimensions.content ?? 0);
    // content 权重 0.3 → 整体 similarity 抬升
    expect(withRes?.similarity ?? 0).toBeGreaterThan(withoutRes?.similarity ?? 0);
  });

  it('② 缺省回退：不注入 → content = 纯 Jaccard（与 computeDimensions 无 embeddingSim 同值、确定）', () => {
    const analyzer = new RedundancyAnalyzer({} as never);
    const res1 = analyzer.analyzePair(A, B);
    const res2 = analyzer.analyzePair(A, B);

    expect(res1).not.toBeNull();
    // 同入同出确定
    expect(res1?.similarity).toBe(res2?.similarity);
    // 与「compute 不传第3参」的纯 Jaccard content 逐值一致（字节级回退）
    const pure = RecipeSimilarity.computeDimensions(A as never, B as never);
    expect(res1?.dimensions.content).toBe(Math.round(pure.content * 100) / 100);
  });
});

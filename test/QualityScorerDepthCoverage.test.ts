/**
 * P5/C8 — QualityScorer 内容深度评分对齐（防刷分 + 零回归）。
 *
 * 锁死用户红线「分数涨了但 recipe 没更有价值 = 失败」：接地 port 就位后，冲高 contentDepth 的唯一路径是
 * 真接地覆盖更多深度维度；靠长度 / 塞维度关键词都拿不到 depthCoverage 分。同时证明接地 port 未就位时评分
 * 走 legacy 公式、与历史一致（零回归、不雪崩）。
 */
import { describe, expect, it } from 'vitest';

import { QualityScorer } from '../src/service/knowledge/validation/quality/QualityScorer.js';

const scorer = new QualityScorer();
const depthOf = (r: Record<string, unknown>): number => scorer.score(r).dimensions.contentDepth;

// 一段够长、结构齐全、但没有任何真实 file:line 的 markdown（长度/关键词刷分样本）。
const STUFFED_MD = `${'## 设计意图\n这是很好的设计意图，充分考虑了边界、失败模式与权衡，反复论述其价值。\n'.repeat(
  12
)}`;

// 一段挂真实 file:line、跨两文件、覆盖多个深度维度的 markdown（真接地深度样本）。
const GROUNDED_MD = [
  '## 设计意图',
  '选择单例而非每次 new，见 lib/a.ts:5，并放弃了约定式扫描的替代方案。',
  '## 边界与前置条件',
  '仅在已初始化容器内有效，见 lib/a.ts:12。',
  '## 失败模式',
  '未初始化会抛错，见 lib/b.ts:9。',
  '## 设计权衡',
  '牺牲零样板换启动期确定性，见 lib/b.ts:20。',
].join('\n');

describe('QualityScorer #scoreContentDepth (C8) — 接地 port 未就位 → legacy 零回归', () => {
  it('groundingAvailable 缺省 → 长 markdown 仍靠长度拿高分(历史行为不变)', () => {
    const legacy = depthOf({ contentMarkdown: STUFFED_MD });
    // legacy 公式长度权重 0.3 + 结构标记，长文本 contentDepth 明显高于接地公式下的同样本。
    expect(legacy).toBeGreaterThan(0.3);
    expect(legacy).toBeGreaterThan(
      depthOf({ contentMarkdown: STUFFED_MD, groundingAvailable: true, groundedSourcePaths: [] })
    );
  });
});

describe('QualityScorer #scoreContentDepth (C8) — 接地 port 就位 → 只认接地深度', () => {
  it('防刷分：长 + 塞满维度关键词但无真实 file:line → depthCoverage=0，contentDepth 被长度及格线封顶', () => {
    const stuffed = depthOf({
      contentMarkdown: STUFFED_MD,
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    // 长度降为及格线(0.12) + 结构标记(≤0.13)，无接地维度 → 远低于 legacy 同样本。
    expect(stuffed).toBeLessThan(0.4);
    // 关键：接地就位后同一长样本反而更低(长度不再是满分杠杆)。
    expect(stuffed).toBeLessThan(depthOf({ contentMarkdown: STUFFED_MD }));
  });

  it('真接地深度：挂真实 file:line 覆盖多个维度 → contentDepth 显著高于刷分样本', () => {
    const grounded = depthOf({
      contentMarkdown: GROUNDED_MD,
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    const stuffed = depthOf({
      contentMarkdown: STUFFED_MD,
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    // 涨分唯一来自真接地覆盖(depthCoverage)，此时涨分即价值。接地样本比刷分样本高出的部分即 depthCoverage。
    expect(grounded).toBeGreaterThan(stuffed);
    expect(grounded - stuffed).toBeGreaterThan(0.3);
    expect(grounded).toBeGreaterThan(0.5);
  });

  it('防编造：深度分节挂的 file:line 指向未接地文件 → 不计 depthCoverage', () => {
    const fabricated = depthOf({
      contentMarkdown: GROUNDED_MD, // 引用 lib/a.ts / lib/b.ts
      groundingAvailable: true,
      groundedSourcePaths: [], // 但没有任何文件被解析成功
    });
    const grounded = depthOf({
      contentMarkdown: GROUNDED_MD,
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    expect(fabricated).toBeLessThan(grounded);
  });

  it('结构化字段接地也计分(boundaries[] 挂真实 ref)', () => {
    const withStructured = depthOf({
      contentMarkdown: '## 无关标题\n正文',
      constraintsBoundaries: ['仅事务内有效 lib/a.ts:12'],
      constraintsSideEffects: ['越界抛错 lib/b.ts:9'],
      reasoningAlternatives: ['每次 new — lib/b.ts:20'],
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    const none = depthOf({
      contentMarkdown: '## 无关标题\n正文',
      groundingAvailable: true,
      groundedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
    });
    expect(withStructured).toBeGreaterThan(none);
  });
});

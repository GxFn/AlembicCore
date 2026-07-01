/**
 * P1/C1+C2 — 深度契约进入「指引单源」。
 *
 * 断言 renderGuidance 从同一 DEPTH_DIMENSIONS 单源渲染出深度契约段(两宿主唯一共享指引文本载体，一处改
 * 双宿主同得)，且：是 additive(旧 guidance==gate 不变)、明说「价值要求非门槛/只认接地深度不认长度」、
 * 结构化 depthContract/valueRubric 字段随 block 返回(活过 host 压缩阶梯)、不重新注入 confidence 硬门槛。
 */
import { describe, expect, it } from 'vitest';

import { contentContract } from '../src/domain/knowledge/recipe-authoring-spec/contentContract.js';
import { DEPTH_DIMENSIONS } from '../src/domain/knowledge/recipe-authoring-spec/depthContract.js';
import { renderGuidance } from '../src/domain/knowledge/recipe-authoring-spec/guidanceGenerator.js';

describe('renderGuidance 深度契约段 (C2) — 从 DEPTH_DIMENSIONS 单源渲染', () => {
  const block = renderGuidance('host-cold-start');

  it('text 含深度契约标题 + 每个深度维度 label(单源对齐)', () => {
    expect(block.text).toContain('## 深度契约（超越门禁的价值要求）');
    for (const dim of DEPTH_DIMENSIONS) {
      expect(block.text).toContain(dim.label);
    }
  });

  it('明说这是价值要求非门槛、评分只认接地深度不认长度', () => {
    expect(block.text).toContain('价值要求不是新门槛');
    expect(block.text).toContain('只认接地深度');
    expect(block.text).toContain('不认长度');
  });

  it('结构化 depthContract/valueRubric 字段随 block 返回(活过 host 压缩阶梯)', () => {
    expect(block.depthContract).toContain('## 深度契约（超越门禁的价值要求）');
    expect(block.depthContract).toContain('落笔后自评');
    expect(block.valueRubric).toBe(contentContract().valueRubric);
    // 价值标准明说「多来源需跨 ≥2 处不同文件」(把 count 门升级为 synthesis)。
    expect(block.valueRubric).toContain('≥2 处不同文件');
  });

  it('深度契约段不重新注入 confidence 硬门槛(与 D-A 负向不变量一致)', () => {
    expect(/confidence/i.test(block.depthContract)).toBe(false);
  });

  it('styleGuide 深度四问落在 slice(0,12) 预算内(host contentStyle 不截断深度)', () => {
    // 复刻 DimensionCatalogPayload.ts:198 的 slice 口径，证明四问全部命中前 12 行。
    const sliced = contentContract()
      .styleGuide.split('\n')
      .filter((line) => !line.startsWith('#') || line.startsWith('##'))
      .filter((line) => line.trim())
      .slice(0, 12)
      .join('\n');
    expect(sliced).toContain('深度四问');
    expect(sliced).toContain('设计意图');
    expect(sliced).toContain('权衡');
  });
});

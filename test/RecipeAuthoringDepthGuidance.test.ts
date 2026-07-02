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
import { reviewRecipeDepth } from '../src/domain/knowledge/recipe-authoring-spec/depthReview.js';
import { example } from '../src/domain/knowledge/recipe-authoring-spec/examples/index.js';
import { renderGuidance } from '../src/domain/knowledge/recipe-authoring-spec/guidanceGenerator.js';

describe('renderGuidance 深度契约段 (C2) — 从 DEPTH_DIMENSIONS 单源渲染', () => {
  const block = renderGuidance('host-cold-start');

  it('text 含深度契约标题 + 深挖自问引导(2026-07-02：自选角度真挖，非逐维填表)', () => {
    expect(block.text).toContain('## 深度契约（超越门禁的价值要求）');
    // 新引导的关键语义：自选真有证据的角度、洞察融入叙述、无证据不写。
    expect(block.text).toContain('真的读到代码证据');
    expect(block.text).toContain('反直觉');
    expect(block.text).toContain('例外');
    expect(block.text).toContain('宁可不写');
    // DEPTH_DIMENSIONS 仍是裁判分类轴(单源存续)，但不再作为逐问模板渲染进 scaffold。
    expect(DEPTH_DIMENSIONS.map((d) => d.key)).toContain('designIntent');
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

  it('styleGuide 深度要求落在 slice(0,12) 预算内(host contentStyle 不截断深度)', () => {
    // 复刻 DimensionCatalogPayload.ts:198 的 slice 口径，证明深度要求命中前 12 行。
    const sliced = contentContract()
      .styleGuide.split('\n')
      .filter((line) => !line.startsWith('#') || line.startsWith('##'))
      .filter((line) => line.trim())
      .slice(0, 12)
      .join('\n');
    expect(sliced).toContain('深度要求');
    expect(sliced).toContain('洞察');
  });
});

describe('注入的 typescript worked-example (C5) — 是真接地深度范本，非仅 gate-clean', () => {
  // 范例正文用真实 file:line 跨两文件推理；解析这两文件后，五个深度维度应全部接地。
  const validSourcePaths = ['src/services/UserService.ts', 'src/services/AuthService.ts'];
  const candidate = example('typescript').candidate as {
    content: { markdown: string };
  };

  it('depthReview 判定五维全接地 + 多来源跨 ≥2 文件(synthesis)', () => {
    const result = reviewRecipeDepth(
      { markdown: candidate.content.markdown },
      { validSourcePaths }
    );
    expect(result.grounded).toEqual(
      expect.arrayContaining([
        'designIntent',
        'boundaries',
        'failureModes',
        'tradeoffs',
        'multiSourceCorroboration',
      ])
    );
    expect(result.missing).toHaveLength(0);
    expect(result.groundedFileCount).toBe(2);
  });

  it('若两文件都解析不到 → 五维退化为未接地(证明接地不是靠关键词，是靠真 file:line)', () => {
    const result = reviewRecipeDepth(
      { markdown: candidate.content.markdown },
      { validSourcePaths: [] }
    );
    expect(result.grounded).not.toContain('designIntent');
    expect(result.grounded).not.toContain('multiSourceCorroboration');
  });
});

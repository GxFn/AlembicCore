/**
 * P0/C3+C4 — 深度契约 + 确定性深度接地裁判。
 *
 * 核心断言：depthReview 只认在 validSourcePaths(真实解析成功的文件)上的 file:line —— 塞维度关键词
 * 或引用未解析文件一律不算 grounded(anti-gaming / anti-fabrication)；多来源需跨 ≥2 处不同文件。
 */
import { describe, expect, it } from 'vitest';

import {
  buildDepthScaffold,
  buildDepthSelfReviewChecklist,
  DEPTH_DIMENSIONS,
} from '../src/domain/knowledge/recipe-authoring-spec/depthContract.js';
import { reviewRecipeDepth } from '../src/domain/knowledge/recipe-authoring-spec/depthReview.js';

describe('depthContract (C3)', () => {
  it('暴露 5 个稳定深度维度(含 multiSourceCorroboration)', () => {
    expect(DEPTH_DIMENSIONS.map((d) => d.key)).toEqual([
      'designIntent',
      'boundaries',
      'failureModes',
      'tradeoffs',
      'multiSourceCorroboration',
    ]);
  });

  it('scaffold 渲染每个维度、self-review 覆盖多来源与接地自检', () => {
    const scaffold = buildDepthScaffold();
    for (const dim of DEPTH_DIMENSIONS) {
      expect(scaffold).toContain(dim.label);
    }
    const checklist = buildDepthSelfReviewChecklist();
    expect(checklist).toContain('多来源');
    expect(checklist).toContain('file:line');
  });
});

describe('reviewRecipeDepth (C4) — 只认接地深度', () => {
  const validSourcePaths = ['lib/foo.ts', 'lib/bar.ts'];

  it('接地：深度分节挂命中 validSourcePaths 的 file:line → grounded + 多来源', () => {
    const markdown = [
      '## 设计意图',
      '选择单例而非每次 new，见 lib/foo.ts:10-18。',
      '## 边界与前置条件',
      '仅在已初始化容器内有效，见 lib/foo.ts:30。',
      '## 失败模式',
      '未初始化会抛错，见 lib/bar.ts:5-9。',
      '## 权衡',
      '牺牲灵活性换确定性，见 lib/bar.ts:20。',
    ].join('\n');
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths });
    expect(result.grounded).toEqual(
      expect.arrayContaining(['designIntent', 'boundaries', 'failureModes', 'tradeoffs'])
    );
    expect(result.grounded).toContain('multiSourceCorroboration');
    expect(result.groundedFileCount).toBe(2);
    expect(result.missing).toHaveLength(0);
  });

  it('防刷分：塞维度关键词但无 file:line → 不算 grounded', () => {
    const markdown = ['## 设计意图', '这是很好的设计意图，考虑了边界、失败模式与权衡。'].join('\n');
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths });
    expect(result.grounded).not.toContain('designIntent');
    expect(result.missing).toContain('designIntent');
    expect(result.ungroundedClaims.length).toBeGreaterThan(0);
  });

  it('防编造：file:line 指向未解析文件 → 不算 grounded', () => {
    const markdown = ['## 设计意图', '见 lib/nonexistent.ts:99。'].join('\n');
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths });
    expect(result.grounded).not.toContain('designIntent');
    expect(result.ungroundedClaims.some((c) => c.includes('设计意图'))).toBe(true);
  });

  it('多来源：仅 1 个文件 → multiSourceCorroboration missing', () => {
    const markdown = ['## 设计意图', '见 lib/foo.ts:10。'].join('\n');
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths: ['lib/foo.ts'] });
    expect(result.grounded).toContain('designIntent');
    expect(result.missing).toContain('multiSourceCorroboration');
    expect(result.groundedFileCount).toBe(1);
  });

  it('结构化字段：boundaries[] 挂真实 ref 也算该维度接地', () => {
    const result = reviewRecipeDepth(
      { markdown: '## 无关标题\n正文', boundaries: ['仅在事务内有效 lib/foo.ts:12'] },
      { validSourcePaths }
    );
    expect(result.grounded).toContain('boundaries');
  });
});

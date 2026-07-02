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

  it('scaffold 是深挖自问引导(自选角度非逐维填表)、self-review 覆盖接地断言与跨文件自检', () => {
    // 2026-07-02 重设计：scaffold 不再逐维列 label(那是填表模板)；给洞察角度让作者自选真有
    // 证据的角度深挖，叙述融入正文。DEPTH_DIMENSIONS 仍是裁判分类轴(见 depthReview 双轨)。
    const scaffold = buildDepthScaffold();
    expect(scaffold).toContain('真的读到代码证据');
    expect(scaffold).toContain('反直觉');
    expect(scaffold).toContain('例外');
    expect(scaffold).toContain('(来源: file:行)');
    const checklist = buildDepthSelfReviewChecklist();
    expect(checklist).toContain('深度断言');
    expect(checklist).toContain('≥2 处不同文件');
    expect(checklist).toContain('真解析到');
  });
});

describe('叙述信号双轨(2026-07-02) — 自由叙述与小节组织同等获得深度认可', () => {
  const validSourcePaths = ['lib/foo.ts', 'lib/bar.ts'];

  it('无 ## 小节的自由叙述：含信号词且同段挂已解析 ref 的段落计入 groundedSignalCount', () => {
    const markdown = [
      '项目选择显式注册而非约定式扫描，因为约定式会把纯数据模型误纳入装配、放大启动成本 (来源: lib/foo.ts:12)。',
      '',
      '一旦绕过注册直接实例化，容器解析在启动期直接抛出，问题不会潜伏到运行时 (来源: lib/bar.ts:33)。',
      '',
      '这是一段没有引用的普通描述，不应计入。',
      '',
      '这段有信号词「代价」但引用未解析 (来源: lib/missing.ts:1)，同样不计。',
    ].join('\n');
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths });
    expect(result.groundedSignalCount).toBe(2);
    // 小节路径判定为空(无 ## 标题)——双轨的意义正在于此。
    expect(result.grounded.filter((k) => k !== 'multiSourceCorroboration')).toHaveLength(0);
    expect(result.groundedFileCount).toBe(2);
  });

  it('纯信号词无接地 ref 不计(anti-gaming 口径不变)', () => {
    const markdown = '因为权衡与代价，我们放弃了替代方案，否则会导致失败。没有任何引用。';
    const result = reviewRecipeDepth({ markdown }, { validSourcePaths });
    expect(result.groundedSignalCount).toBe(0);
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

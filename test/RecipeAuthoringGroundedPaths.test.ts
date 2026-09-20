/**
 * P0/C7 — 接地断路闭合。
 *
 * 两层断言：
 *  1) `resolveGroundedSourcePaths`(gate 侧只读投影)只回【resolver 真解析成功】的 file:line，resolver 拒绝
 *     的 ref 一律不进接地集(anti-fabrication)；无 resolver → 空集(纯函数、fs-free)。
 *  2) `KnowledgeService.updateQuality` 注入 grounding port 后，scorer **真能拿到** groundedSourcePaths +
 *     深度字段——即门禁在 submit 期丢弃 validSourcePaths 造成的「深度评分拿不到接地」断路已闭合。
 */
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { resolveGroundedSourcePaths } from '../src/domain/knowledge/recipe-authoring-spec/gateRules.js';
import { KnowledgeService } from '../src/service/knowledge/KnowledgeService.js';
import type { RecipeSourceRefResolver } from '../src/types/recipeAuthoringSpec.js';

// 一个只认白名单路径的假 resolver：命中→evidence，不命中→violation(模拟文件不存在/行越界)。
function fakeResolver(validPaths: ReadonlySet<string>): RecipeSourceRefResolver {
  return ({ sourcePath, startLine, endLine, sourceRef, itemIndex, title }) => {
    if (validPaths.has(sourcePath)) {
      return {
        evidence: { sourcePath, rangeText: `// ${sourcePath}:${startLine}-${endLine}` },
      };
    }
    return {
      violation: {
        code: 'SOURCE_REF_UNRESOLVED',
        itemIndex,
        title,
        sourceRef,
        message: 'unresolved',
        nextAction: 'fix',
      },
    };
  };
}

describe('resolveGroundedSourcePaths (C7) — 只回真解析成功的接地', () => {
  const item = {
    title: 'demo',
    reasoning: { sources: ['lib/foo.ts:10-18', 'lib/ghost.ts:5', 'lib/bar.ts:20'] },
  };

  it('只保留 resolver 命中的 ref，拒绝的被剔除(anti-fabrication)', () => {
    const { validSourcePaths } = resolveGroundedSourcePaths(item, {
      sourceRefResolver: fakeResolver(new Set(['lib/foo.ts', 'lib/bar.ts'])),
      projectRoot: '/proj',
    });
    expect(validSourcePaths.sort()).toEqual(['lib/bar.ts', 'lib/foo.ts']);
    expect(validSourcePaths).not.toContain('lib/ghost.ts');
  });

  it('缺行号的 ref 不进接地集', () => {
    const { validSourcePaths } = resolveGroundedSourcePaths(
      { reasoning: { sources: ['lib/foo.ts'] } },
      { sourceRefResolver: fakeResolver(new Set(['lib/foo.ts'])), projectRoot: '/proj' }
    );
    expect(validSourcePaths).toHaveLength(0);
  });

  it('无 resolver / 无 projectRoot → 空集(保持纯函数、不触 fs)', () => {
    expect(resolveGroundedSourcePaths(item, {}).validSourcePaths).toHaveLength(0);
    expect(
      resolveGroundedSourcePaths(item, { sourceRefResolver: fakeResolver(new Set(['lib/foo.ts'])) })
        .validSourcePaths
    ).toHaveLength(0);
  });
});

describe('KnowledgeService.updateQuality (C7) — port→scorer 断路闭合', () => {
  function buildEntry(): KnowledgeEntry {
    return KnowledgeEntry.fromJSON({
      id: 'k1',
      title: 'grounded recipe',
      description: 'x',
      language: 'ts',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      source: 'host-agent',
      content: {
        markdown: '## 设计意图\n见 lib/foo.ts:10-18。',
        steps: [{ title: 's', description: 'd' }],
        verification: { method: 'test', expected_result: 'ok' },
      },
      constraints: {
        boundaries: ['仅事务内有效 lib/foo.ts:12'],
        preconditions: ['已初始化 lib/bar.ts:3'],
        sideEffects: [],
      },
      reasoning: {
        whyStandard: 'w',
        sources: ['lib/foo.ts:10-18', 'lib/bar.ts:3', 'lib/ghost.ts:9'],
        confidence: 0.8,
        alternatives: ['每次 new — lib/bar.ts:20'],
      },
    });
  }

  it.each([
    { label: '已解析', paths: ['lib/foo.ts', 'lib/bar.ts'] },
    { label: 'port 就位但零接地', paths: [] },
    { label: '未注入 port', paths: null },
  ])('$label：传递接地状态与完整深度字段', async ({ paths }) => {
    const entry = buildEntry();
    const fakeRepo = {
      findById: async () => entry,
      update: async () => entry,
    } as unknown as ConstructorParameters<typeof KnowledgeService>[0];
    const score = vi.fn((_input: Record<string, unknown>) => ({
      score: 0.5,
      dimensions: { completeness: 0.5, deliveryReady: 0.5, contentDepth: 0.5 },
      grade: 'B',
    }));
    // 使用真正的接地投影；只有文件解析边界由白名单 resolver 替代。
    const port =
      paths === null
        ? undefined
        : (item: Record<string, unknown>) =>
            resolveGroundedSourcePaths(item, {
              sourceRefResolver: fakeResolver(new Set(paths)),
              projectRoot: '/proj',
            });
    const svc = new KnowledgeService(fakeRepo, { log: async () => {} }, null, null, {
      qualityScorer: { score },
      groundedSourcePaths: port,
    });

    await svc.updateQuality('k1');

    expect(score).toHaveBeenCalledOnce();
    const input = score.mock.calls[0][0];
    expect(input).toMatchObject({
      groundingAvailable: paths !== null,
      groundedSourcePaths: paths ?? [],
      groundedRanges: paths?.length ? ['// lib/foo.ts:10-18', '// lib/bar.ts:3-3'] : [],
      constraintsBoundaries: ['仅事务内有效 lib/foo.ts:12'],
      constraintsPreconditions: ['已初始化 lib/bar.ts:3'],
      constraintsSideEffects: [],
      reasoningAlternatives: ['每次 new — lib/bar.ts:20'],
      contentSteps: [{ title: 's', description: 'd' }],
      contentVerification: { method: 'test', expected_result: 'ok' },
    });
    expect(input.groundedSourcePaths).not.toContain('lib/ghost.ts');
  });
});

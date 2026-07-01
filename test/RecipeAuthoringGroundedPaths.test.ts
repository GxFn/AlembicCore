/**
 * P0/C7 — 接地断路闭合。
 *
 * 两层断言：
 *  1) `resolveGroundedSourcePaths`(gate 侧只读投影)只回【resolver 真解析成功】的 file:line，resolver 拒绝
 *     的 ref 一律不进接地集(anti-fabrication)；无 resolver → 空集(纯函数、fs-free)。
 *  2) `KnowledgeService.updateQuality` 注入 grounding port 后，scorer **真能拿到** groundedSourcePaths +
 *     深度字段——即门禁在 submit 期丢弃 validSourcePaths 造成的「深度评分拿不到接地」断路已闭合。
 */
import { describe, expect, it } from 'vitest';

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

  it('注入 grounding port → scorer 收到 groundedSourcePaths + 深度字段', async () => {
    const entry = buildEntry();
    let captured: Record<string, unknown> | null = null;

    const fakeRepo = {
      findById: async () => entry,
      update: async () => {},
    } as unknown as ConstructorParameters<typeof KnowledgeService>[0];

    const scorer = {
      score: (input: Record<string, unknown>) => {
        captured = input;
        return {
          score: 0.5,
          dimensions: { completeness: 0.5, deliveryReady: 0.5, contentDepth: 0.5 },
          grade: 'B',
        };
      },
    };

    // port 内部用真的 resolveGroundedSourcePaths(与门禁字节同源) + 假 resolver。
    const port = (it2: Record<string, unknown>) =>
      resolveGroundedSourcePaths(it2, {
        sourceRefResolver: fakeResolver(new Set(['lib/foo.ts', 'lib/bar.ts'])),
        projectRoot: '/proj',
      });

    const svc = new KnowledgeService(fakeRepo, { log: async () => {} }, null, null, {
      qualityScorer: scorer,
      groundedSourcePaths: port,
    });

    await svc.updateQuality('k1');

    expect(captured).not.toBeNull();
    const input = captured as unknown as Record<string, unknown>;
    // 接地集只含真解析成功的两处，ghost 被剔除(断路闭合的核心证据)。
    expect((input.groundedSourcePaths as string[]).sort()).toEqual(['lib/bar.ts', 'lib/foo.ts']);
    expect(input.groundedSourcePaths).not.toContain('lib/ghost.ts');
    // 深度字段被 additive 透传给 scorer(供 C8 depthCoverage)。
    expect(input.constraintsBoundaries).toEqual(['仅事务内有效 lib/foo.ts:12']);
    expect(input.reasoningAlternatives).toEqual(['每次 new — lib/bar.ts:20']);
    expect(Array.isArray(input.contentSteps)).toBe(true);
  });

  it('不注入 port → 退化为空接地集(旧评分路径不变、不崩)', async () => {
    const entry = buildEntry();
    let captured: Record<string, unknown> | null = null;
    const fakeRepo = {
      findById: async () => entry,
      update: async () => {},
    } as unknown as ConstructorParameters<typeof KnowledgeService>[0];
    const scorer = {
      score: (input: Record<string, unknown>) => {
        captured = input;
        return {
          score: 0.4,
          dimensions: { completeness: 0.4, deliveryReady: 0.4, contentDepth: 0.4 },
          grade: 'C',
        };
      },
    };
    const svc = new KnowledgeService(fakeRepo, { log: async () => {} }, null, null, {
      qualityScorer: scorer,
    });
    await svc.updateQuality('k1');
    expect((captured as unknown as Record<string, unknown>).groundedSourcePaths).toEqual([]);
  });
});

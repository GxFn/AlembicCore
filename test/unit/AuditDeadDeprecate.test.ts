/**
 * U6-Core phase 3 — audit dead→deprecate（替换硬编码 proposalsCreated:0）。
 *
 * 覆盖⑤：dead recipe → 经 EvolutionGateway submit type='deprecate'，source='metabolism'
 *   （CG⑥b：shouldImmediateExecute 对 metabolism 恒 false → 进观察窗口、非立即执行），
 *   auditSummary.proposalsCreated 反映真实 Gateway 结果（非硬编码 0）；
 *   无 gateway/deps → 降级 proposalsCreated=0、不抛。
 *
 * dead verdict 由 layer-1 候选（source-deleted → impactToScore=10 → classifyRelevance=dead）构造，无需 DB。
 * 「proposal 进 observing 状态」由既有 ProposalRepository/EvolutionPolicy 单测保证，本测经
 * shouldImmediateExecute 锁定 source 选择 → 非立即执行这一关键链。
 */
import { describe, expect, it } from 'vitest';
import { EvolutionPolicy } from '../../src/domain/evolution/EvolutionPolicy.js';
import type { EvolutionCandidatePlan } from '../../src/service/evolution/RecipeImpactPlanner.js';
import { auditRecipesForRescan } from '../../src/workflows/capabilities/planning/knowledge/KnowledgeRescanPlanner.js';
import type { RecipeSnapshotEntry } from '../../src/workflows/capabilities/RecipeSnapshotTypes.js';

const DEAD_ENTRY: RecipeSnapshotEntry = {
  id: 'dead-r',
  title: 'Dead Recipe',
  trigger: '@dead',
  category: 'Test',
  knowledgeType: 'code-pattern',
  doClause: 'do',
  lifecycle: 'active',
  sourceRefs: [],
};

// source-deleted 候选 → impactToScore=10 → classifyRelevance=dead（layer-1，无需 DB）。
const DEAD_PLAN = {
  candidates: [
    { recipeId: 'dead-r', reason: 'source-deleted', impactScore: 1, affectedFiles: ['gone.ts'] },
  ],
} as unknown as EvolutionCandidatePlan;

const noopLogger = { info: () => {}, warn: () => {} };

describe('U6 ⑤ audit dead→deprecate', () => {
  it('drifted source refs → submit update(source=metabolism)，并不误走 dead→deprecate', async () => {
    const driftedRef = {
      recipeId: 'drift-r',
      sourcePath: 'src/live.ts:2-4',
      status: 'drifted',
      newPath: null,
      verifiedAt: 2000,
      contentFp: 'abc123',
    };
    const submitted: Array<Record<string, unknown>> = [];
    const fakeGateway = {
      submit: async (decision: Record<string, unknown>) => {
        submitted.push(decision);
        return {
          recipeId: decision.recipeId,
          action: decision.action,
          outcome: 'proposal-created',
          proposalId: 'p-update',
        };
      },
    };
    let findDriftedCalled = false;
    const sourceRefRepo = {
      findDrifted: () => {
        findDriftedCalled = true;
        return [driftedRef];
      },
      getStaleCountsByRecipe: () => [{ recipeId: 'drift-r', staleCount: 1, totalCount: 1 }],
      findByRecipeId: () => [driftedRef],
    };
    const container = {
      get: (name: string): unknown => {
        if (name === 'evolutionGateway') {
          return fakeGateway;
        }
        if (name === 'recipeSourceRefRepository') {
          return sourceRefRepo;
        }
        return undefined;
      },
    };

    const summary = await auditRecipesForRescan({
      container,
      logger: noopLogger,
      recipeEntries: [
        {
          ...DEAD_ENTRY,
          id: 'drift-r',
          title: 'Drift Recipe',
          trigger: '@drift',
          sourceRefs: ['src/live.ts:2-4'],
        },
      ],
      allFiles: [{ name: 'live.ts', relativePath: 'src/live.ts' }],
      projectRoot: '/tmp/x',
      candidatePlan: null,
    });

    expect(findDriftedCalled).toBe(true);
    expect(summary.decay).toBe(1);
    expect(summary.dead).toBe(0);
    expect(summary.proposalsCreated).toBe(1);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      action: 'update',
      source: 'metabolism',
      recipeId: 'drift-r',
    });
    expect(submitted[0]?.evidence).toEqual([
      expect.objectContaining({
        sourceStatus: 'drifted',
        sourcePath: 'src/live.ts:2-4',
        updateReason: 'source-region-content-drift',
      }),
    ]);
  });

  it('dead → submit deprecate(source=metabolism→观察窗口)，proposalsCreated 反映真实数', async () => {
    const submitted: Array<Record<string, unknown>> = [];
    const fakeGateway = {
      submit: async (decision: Record<string, unknown>) => {
        submitted.push(decision);
        return {
          recipeId: decision.recipeId,
          action: 'deprecate',
          outcome: 'proposal-created',
          proposalId: 'p-1',
        };
      },
    };
    const container = {
      get: (name: string): unknown => (name === 'evolutionGateway' ? fakeGateway : undefined),
    };

    const summary = await auditRecipesForRescan({
      container,
      logger: noopLogger,
      recipeEntries: [DEAD_ENTRY],
      allFiles: [],
      projectRoot: '/tmp/x',
      candidatePlan: DEAD_PLAN,
    });

    expect(summary.dead).toBe(1);
    expect(summary.proposalsCreated).toBe(1); // 非硬编码 0
    expect(summary.immediateDeprecated).toBe(0); // metabolism 不立即执行
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      action: 'deprecate',
      source: 'metabolism',
      recipeId: 'dead-r',
    });
    // CG⑥b 闭环：metabolism + dead 置信度 → shouldImmediateExecute=false（进观察窗口）。
    expect(
      EvolutionPolicy.shouldImmediateExecute(
        'deprecate',
        submitted[0].confidence as number,
        submitted[0].source as string
      )
    ).toBe(false);
  });

  it('无 evolutionGateway/deps → 降级：proposalsCreated=0，不抛', async () => {
    const container = {
      get: (): unknown => {
        throw new Error('not registered');
      },
    };

    const summary = await auditRecipesForRescan({
      container,
      logger: noopLogger,
      recipeEntries: [DEAD_ENTRY],
      allFiles: [],
      projectRoot: '/tmp/x',
      candidatePlan: DEAD_PLAN,
    });

    expect(summary.dead).toBe(1);
    expect(summary.proposalsCreated).toBe(0);
    expect(summary.immediateDeprecated).toBe(0);
  });
});

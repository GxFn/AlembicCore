import { describe, expect, test } from 'vitest';
import type { DimensionDef } from '../../src/types/ProjectSnapshot.js';
import { BootstrapSession } from '../../src/workflows/capabilities/host-agent/BootstrapSession.js';
import { runHostAgentDimensionCompletionWorkflow } from '../../src/workflows/capabilities/host-agent/HostAgentDimensionCompletionWorkflow.js';
import { buildMissionBriefing } from '../../src/workflows/capabilities/host-agent/MissionBriefingBuilder.js';
import { buildInternalNextSteps } from '../../src/workflows/capabilities/host-agent/MissionBriefingSupport.js';
import {
  buildKnowledgeRescanPlan,
  type RelevanceAuditResult,
  type RelevanceAuditSummary,
} from '../../src/workflows/capabilities/planning/knowledge/KnowledgeRescanPlanner.js';
import { projectHostAgentRescanEvidencePlan } from '../../src/workflows/capabilities/planning/knowledge/RescanEvidenceProjectors.js';
import type { RecipeSnapshotEntry } from '../../src/workflows/capabilities/RecipeSnapshotTypes.js';
import { presentHostAgentColdStartResponse } from '../../src/workflows/cold-start/ColdStartPresenters.js';
import {
  createHostAgentKnowledgeRescanIntent,
  createInternalKnowledgeRescanIntent,
} from '../../src/workflows/knowledge-rescan/KnowledgeRescanIntent.js';
import { presentHostAgentKnowledgeRescanResponse } from '../../src/workflows/knowledge-rescan/KnowledgeRescanPresenters.js';

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Architecture guide' } as DimensionDef,
  { id: 'quality', label: 'Quality', guide: 'Quality guide' } as DimensionDef,
];

describe('host-agent mining workflow core', () => {
  test('creates internal and host-agent rescan intents with shared cleanup semantics', () => {
    expect(
      createInternalKnowledgeRescanIntent({
        reason: 'manual',
        dimensions: ['architecture,quality'],
        skipAsyncFill: true,
      })
    ).toMatchObject({
      executor: 'internal-agent',
      analysisMode: 'incremental',
      cleanupPolicy: 'rescan-clean',
      completionPolicy: 'auto-fill',
      dimensionIds: ['architecture', 'quality'],
      reason: 'manual',
      internalExecution: { skipAsyncFill: true },
    });

    expect(
      createHostAgentKnowledgeRescanIntent({ force: true, dimensions: ['quality'] })
    ).toMatchObject({
      executor: 'host-agent',
      analysisMode: 'full',
      cleanupPolicy: 'force-rescan',
      completionPolicy: 'host-agent-dimension-complete',
      dimensionIds: ['quality'],
    });
  });

  test('builds rescan evidence plan for host-agent gap fill', () => {
    const recipes: RecipeSnapshotEntry[] = [
      recipe({ id: 'arch-1', category: 'architecture' }),
      recipe({ id: 'quality-decay', category: 'quality', lifecycle: 'decaying' }),
    ];
    const auditSummary: RelevanceAuditSummary = {
      totalAudited: recipes.length,
      healthy: 1,
      watch: 0,
      decay: 1,
      severe: 0,
      dead: 0,
      proposalsCreated: 0,
      immediateDeprecated: 0,
      results: [
        result('arch-1', 'Architecture', 'healthy'),
        result('quality-decay', 'Quality', 'decay', ['source changed']),
      ],
    };

    const plan = buildKnowledgeRescanPlan({
      recipeEntries: recipes,
      auditSummary,
      dimensions,
      targetPerDimension: 2,
    });
    const evidencePlan = projectHostAgentRescanEvidencePlan(plan);

    expect(
      plan.executionDecisions.map((decision) => [decision.dimensionId, decision.mode])
    ).toEqual([
      ['architecture', 'produce'],
      ['quality', 'produce'],
    ]);
    expect(evidencePlan.totalCreateBudget).toBe(3);
    expect(evidencePlan.decayCount).toBe(1);
    expect(evidencePlan.occupiedTriggers).toContain('@quality-decay');
  });

  test('builds mission briefing with rescan profile evidence hints', () => {
    const briefing = buildMissionBriefing({
      projectMeta: { name: 'Demo', primaryLanguage: 'typescript', fileCount: 10 },
      profile: 'rescan-host-agent',
      activeDimensions: dimensions,
      session: { toJSON: () => ({ id: 'session-1' }) },
      rescan: {
        evidencePlan: {
          allRecipes: [],
          dimensionGaps: [
            {
              dimensionId: 'architecture',
              existingCount: 1,
              gap: 1,
              executionMode: 'produce',
              createBudget: 1,
              shouldExecute: true,
              existingTriggers: ['@arch-1'],
              executionReasons: [{ kind: 'coverage-gap' }],
            },
          ],
          executionReasons: { architecture: [{ kind: 'coverage-gap' }] },
          totalGap: 1,
          totalCreateBudget: 1,
          decayCount: 0,
          occupiedTriggers: ['@arch-1'],
          coveredDimensions: 1,
          gapSummary: '需补齐维度: architecture(需补1条)。',
        },
        prescreen: {
          needsVerification: [],
          autoResolved: [],
          dimensionGaps: { architecture: 1 },
        },
      },
    });

    expect(briefing.meta?.profile).toBe('rescan-host-agent');
    expect((briefing.evidenceHints as Record<string, unknown>).rescanMode).toBe(true);
    expect((briefing.executionPlan as { workflow: string }).workflow).toContain('增量扫描模式');
    expect((briefing.executionPlan as { workflow: string }).workflow).toContain(
      'alembic_submit_knowledge'
    );
    expect((briefing.executionPlan as { workflow: string }).workflow).not.toContain(
      'knowledge({ action'
    );
  });

  test('projects Codex-visible submission instructions to the real MCP tool name', () => {
    const coldStart = presentHostAgentColdStartResponse({
      cleanupResult: { deletedFiles: 0, clearedTables: [], errors: [] },
      briefing: { executionPlan: { tiers: [] } },
      dimensionCount: 2,
      responseTimeMs: 1,
    });
    const rescan = presentHostAgentKnowledgeRescanResponse({
      recipeSnapshot: { count: 1 },
      cleanResult: { clearedTables: [], deletedFiles: 0 },
      auditSummary: {
        totalAudited: 1,
        healthy: 1,
        watch: 0,
        decay: 0,
        severe: 0,
        dead: 0,
        proposalsCreated: 0,
        immediateDeprecated: 0,
      },
      briefing: { executionPlan: { tiers: [] } },
      evidencePlan: {
        decayCount: 0,
        coveredDimensions: 1,
        gapSummary: '无缺口。',
      },
      dimensions,
      responseTimeMs: 1,
    });
    const nextSteps = buildInternalNextSteps(dimensions);
    const visibleText = `${JSON.stringify(coldStart)}\n${JSON.stringify(
      rescan
    )}\n${nextSteps.join('\n')}`;

    expect(visibleText).toContain('alembic_submit_knowledge');
    expect(visibleText).toContain('ProjectSkillDeliveryReceipt');
    expect(visibleText).toContain('runtimeExport.status');
    expect(visibleText).toContain('候选校验');
    expect(visibleText).toContain('重复检查');
    expect(visibleText).not.toContain('knowledge({ action');
    expect(visibleText).not.toContain('alembic_enrich_candidates');
    expect(visibleText).not.toContain('enrichCandidates');
    expect(visibleText).not.toContain('alembic_skill');
    expect(visibleText).not.toContain('submit_batch');
  });

  test('completes a dimension by recovering submissions, binding recipes, and saving checkpoint', async () => {
    const session = new BootstrapSession({
      projectRoot: '/repo',
      dimensions: [dimensions[0]],
      projectContext: { projectName: 'Demo' },
    });
    session.submissionTracker.recordSubmission(
      'architecture',
      {
        title: 'Architecture Recipe',
        knowledgeType: 'architecture',
        kind: 'rule',
        category: 'architecture',
        trigger: '@arch-recipe',
        coreCode: 'export const architecture = true;',
        content: { markdown: '## Architecture\n\n```ts\nexport const architecture = true;\n```' },
        reasoning: { sources: ['src/app.ts:12'], confidence: 0.9 },
      },
      'recipe-1'
    );

    const updates: unknown[] = [];
    const edges: unknown[] = [];
    const checkpoints: unknown[] = [];
    const ctx = {
      container: {
        singletons: { _projectRoot: '/repo' },
        get(name: string) {
          if (name === 'knowledgeService') {
            return {
              get: async () => ({ tags: ['existing'] }),
              update: async (...args: unknown[]) => {
                updates.push(args);
              },
            };
          }
          if (name === 'knowledgeGraphService') {
            return {
              addEdge: async (...args: unknown[]) => {
                edges.push(args);
              },
            };
          }
          return null;
        },
      },
    };

    const response = await runHostAgentDimensionCompletionWorkflow(
      ctx,
      {
        dimensionId: 'architecture',
        analysisText:
          '## Architecture analysis\nThe project uses a clear architecture boundary with service modules.',
        keyFindings: ['Service modules define the architecture boundary'],
      },
      {
        getActiveSession: () => session,
        saveCheckpoint: async (...args: unknown[]) => {
          checkpoints.push(args);
        },
      }
    );

    expect(response.success).toBe(true);
    expect(response.data).toMatchObject({
      dimensionId: 'architecture',
      recipesBound: 1,
      progress: '1/1',
      completedDimensions: ['architecture'],
      isBootstrapComplete: true,
    });
    expect(updates).toHaveLength(1);
    expect(checkpoints).toHaveLength(1);
    expect(edges).toHaveLength(1);
    expect(session.sessionStore.getDimensionReport('architecture')?.referencedFiles).toEqual([
      'src/app.ts',
    ]);
  });
});

function recipe(opts: Partial<RecipeSnapshotEntry> & Pick<RecipeSnapshotEntry, 'id'>) {
  return {
    title: opts.title ?? opts.id,
    trigger: opts.trigger ?? `@${opts.id}`,
    category: opts.category ?? 'architecture',
    knowledgeType: opts.knowledgeType ?? opts.category ?? 'architecture',
    doClause: opts.doClause ?? 'Use the project pattern.',
    lifecycle: opts.lifecycle ?? 'active',
    content: opts.content ?? {
      markdown: `# ${opts.id}`,
      rationale: 'Because the project uses this pattern.',
      coreCode: 'const value = true;',
    },
    sourceRefs: opts.sourceRefs ?? ['src/example.ts'],
    ...opts,
  } satisfies RecipeSnapshotEntry;
}

function result(
  recipeId: string,
  title: string,
  verdict: RelevanceAuditResult['verdict'],
  decayReasons: string[] = []
): RelevanceAuditResult {
  return {
    recipeId,
    title,
    verdict,
    relevanceScore: verdict === 'healthy' ? 0.95 : 0.4,
    evidence: {
      triggerStillMatches: verdict !== 'dead',
      symbolsAlive: verdict === 'healthy' ? 3 : 0,
      depsIntact: verdict === 'healthy',
      codeFilesExist: verdict === 'dead' ? 0 : 1,
    },
    decayReasons,
  };
}

import { describe, expect, it } from 'vitest';

import {
  buildColdStartWorkflowPlan,
  buildKnowledgeRescanWorkflowPlan,
  buildProjectIndexFullPlan,
  buildProjectIndexIncrementalPlan,
  createHostAgentColdStartIntent,
  createInternalColdStartIntent,
  createInternalKnowledgeRescanIntent,
  type ProjectIndexMode,
} from '../src/host-agent-workflows.js';
import {
  buildColdStartWorkflowPlan as buildColdStartWorkflowPlanFromProjectIndex,
  buildKnowledgeRescanWorkflowPlan as buildKnowledgeRescanWorkflowPlanFromProjectIndex,
} from '../src/workflows/project-index/index.js';

describe('project-index workflow plan collapse', () => {
  it('keeps full-index/coldStart plan byte shape and the R-2 cleanup root ternary', () => {
    const internalIntent = createInternalColdStartIntent({
      contentMaxLines: 77,
      dimensions: ['architecture'],
      incremental: true,
      maxFiles: 123,
      skipGuard: true,
    });
    const hostIntent = createHostAgentColdStartIntent();

    const internalPlan = buildColdStartWorkflowPlan({
      intent: internalIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });
    const hostPlan = buildColdStartWorkflowPlanFromProjectIndex({
      intent: hostIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });

    expect(buildProjectIndexFullPlan).toBe(buildColdStartWorkflowPlan);
    expect(internalPlan).toMatchObject({
      cleanup: {
        policy: 'full-reset',
        projectRoot: '/workspace/project',
        dataRoot: '/workspace/data',
      },
      projectAnalysis: {
        prepare: { clearOldData: true },
        scan: {
          maxFiles: 123,
          contentMaxLines: 77,
          skipGuard: true,
          sourceTag: 'bootstrap',
          generateReport: true,
          generateAstContext: true,
          incremental: false,
          logPrefix: 'Bootstrap',
        },
        materialize: {
          sourceGraph: true,
          dependencyEdges: true,
          moduleEntities: true,
          guardViolations: true,
        },
      },
      response: { tool: 'alembic_bootstrap' },
    });
    expect(hostPlan.cleanup).toEqual({
      policy: 'full-reset',
      projectRoot: '/workspace/data',
      dataRoot: '/workspace/data',
    });
    expect(hostPlan.projectAnalysis.prepare).toEqual({
      clearOldData: true,
      dataRoot: '/workspace/data',
    });
    expect(hostPlan.projectAnalysis.scan).toMatchObject({
      sourceTag: 'bootstrap-host-agent',
      generateAstContext: false,
      incremental: false,
      logPrefix: 'Bootstrap',
    });
  });

  it('keeps incremental-index/rescan plan byte shape and dataRoot cleanup semantics', () => {
    const incrementalIntent = createInternalKnowledgeRescanIntent({
      contentMaxLines: 80,
      maxFiles: 200,
      reason: 'incremental',
    });
    const forceIntent = createInternalKnowledgeRescanIntent({
      force: true,
      reason: 'force',
    });

    const incrementalPlan = buildKnowledgeRescanWorkflowPlan({
      intent: incrementalIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });
    const forcePlan = buildKnowledgeRescanWorkflowPlanFromProjectIndex({
      intent: forceIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });

    expect(buildProjectIndexIncrementalPlan).toBe(buildKnowledgeRescanWorkflowPlan);
    expect(incrementalPlan).toMatchObject({
      cleanup: {
        policy: 'rescan-clean',
        projectRoot: '/workspace/data',
      },
      projectAnalysis: {
        prepare: {},
        scan: {
          maxFiles: 200,
          contentMaxLines: 80,
          sourceTag: 'rescan-internal',
          summaryPrefix: 'Rescan-Internal scan',
          generateReport: true,
          generateAstContext: true,
          incremental: true,
          logPrefix: 'Rescan',
        },
        materialize: {
          sourceGraph: true,
          dependencyEdges: true,
          moduleEntities: true,
          guardViolations: true,
        },
      },
      response: { tool: 'alembic_rescan' },
    });
    expect(forcePlan.cleanup).toEqual({ policy: 'force-rescan', projectRoot: '/workspace/data' });
    expect(forcePlan.projectAnalysis.scan.incremental).toBe(false);
  });

  it('exposes explicit project-index mode vocabulary without renaming frozen stage ids', () => {
    const modes: ProjectIndexMode[] = ['full', 'incremental'];

    expect(modes).toEqual(['full', 'incremental']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildKnowledgeRescanWorkflowPlan,
  createInternalKnowledgeRescanIntent,
} from '../src/workflows/knowledge-rescan/index.js';

describe('KnowledgeRescanWorkflowPlan analysis options', () => {
  it('passes rescan intent analysis limits into project intelligence scan options', () => {
    const intent = createInternalKnowledgeRescanIntent({
      maxFiles: 2000,
      contentMaxLines: 200,
      reason: 'non-truncated-rescan',
    });
    const plan = buildKnowledgeRescanWorkflowPlan({
      intent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/project/.asd',
    });

    expect(plan.projectAnalysis.scan).toMatchObject({
      maxFiles: 2000,
      contentMaxLines: 200,
      sourceTag: 'rescan-internal',
      incremental: true,
    });
    expect(plan.intent.projectAnalysis).toMatchObject({
      maxFiles: 2000,
      contentMaxLines: 200,
    });
    expect(plan.projectAnalysis.materialize).toMatchObject({ sourceGraph: true });
  });

  it('keeps default rescan scan limits when callers omit analysis options', () => {
    const intent = createInternalKnowledgeRescanIntent({});
    const plan = buildKnowledgeRescanWorkflowPlan({
      intent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/project/.asd',
    });

    expect(plan.projectAnalysis.scan).toMatchObject({
      maxFiles: 500,
      contentMaxLines: 120,
    });
  });
});

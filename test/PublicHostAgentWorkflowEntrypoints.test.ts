import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BootstrapSession,
  buildColdStartWorkflowPlan,
  buildExternalMissionBriefing,
  clearDimensionCheckpoints,
  createExternalColdStartIntent,
  createExternalKnowledgeRescanIntent,
  type DimensionDef,
  ExternalSubmissionTracker,
  loadDimensionCheckpoints,
  runExternalDimensionCompletionWorkflow,
  saveDimensionCheckpoint,
} from '../src/host-agent-workflows.js';

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Map architecture decisions' },
  { id: 'quality', label: 'Quality', guide: 'Find quality standards' },
];

describe('stable host-agent workflow entrypoint', () => {
  it('exposes external cold-start and rescan intent contracts without host runtime details', () => {
    const coldStart = createExternalColdStartIntent();
    const rescan = createExternalKnowledgeRescanIntent({
      force: true,
      dimensions: ['quality'],
      reason: 'manual',
    });
    const coldStartPlan = buildColdStartWorkflowPlan({
      intent: coldStart,
      projectRoot: '/project',
      dataRoot: '/project/.alembic',
    });

    expect(coldStart).toMatchObject({
      kind: 'cold-start',
      executor: 'external-agent',
      completionPolicy: 'external-dimension-complete',
      projectAnalysis: {
        sourceTag: 'bootstrap-external',
        generateAstContext: false,
      },
    });
    expect(rescan).toMatchObject({
      kind: 'knowledge-rescan',
      executor: 'external-agent',
      cleanupPolicy: 'force-rescan',
      completionPolicy: 'external-dimension-complete',
      dimensionIds: ['quality'],
    });
    expect(coldStartPlan.response.tool).toBe('alembic_bootstrap');
    expect(coldStartPlan.projectAnalysis.scan.generateAstContext).toBe(false);
  });

  it('builds host-agent mission briefing with session and submission contracts', () => {
    const session = new BootstrapSession({
      projectRoot: '/project',
      dimensions,
      projectContext: { projectName: 'Demo', primaryLang: 'typescript' },
    });
    const tracker = new ExternalSubmissionTracker();
    tracker.recordSubmission(
      'architecture',
      {
        title: 'Architecture Boundary',
        knowledgeType: 'architecture',
        kind: 'rule',
        category: 'Service',
        trigger: '@architecture-boundary',
        content: { markdown: '## Boundary\n\n```ts\nexport class Service {}\n```' },
        reasoning: { sources: ['src/service.ts:1'], confidence: 0.9 },
      },
      'recipe-1'
    );

    const briefing = buildExternalMissionBriefing({
      projectRoot: '/project',
      primaryLang: 'typescript',
      fileCount: 12,
      projectType: 'node',
      briefing: {
        activeDimensions: dimensions,
        session,
      },
    });

    expect(briefing.projectMeta).toMatchObject({
      name: 'project',
      primaryLanguage: 'typescript',
    });
    expect(briefing.session).toMatchObject({ id: session.id });
    expect(tracker.getSubmissions('architecture')).toHaveLength(1);
    expect(
      tracker.buildQualityReport('architecture', '## Analysis\n\nDetailed analysis', [
        'src/service.ts',
      ]).totalScore
    ).toBeGreaterThan(0);
  });

  it('validates dimension completion and degrades when no host-agent session exists', async () => {
    const response = await runExternalDimensionCompletionWorkflow(
      {
        container: {
          get: () => null,
        },
      },
      {
        dimensionId: 'architecture',
        analysisText: '## Architecture\n\nEnough analysis text for validation.',
      },
      {
        getActiveSession: () => null,
      }
    );

    expect(response).toMatchObject({
      success: false,
      errorCode: 'SESSION_NOT_FOUND',
    });
  });

  it('exposes checkpoint persistence for host-agent resume and cleanup', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-host-agent-'));
    try {
      await saveDimensionCheckpoint(dataRoot, 'session-1', 'architecture', {
        candidateCount: 2,
        analysisText: 'Architecture analysis',
      });

      const checkpoints = await loadDimensionCheckpoints(dataRoot);

      expect(checkpoints.get('architecture')).toMatchObject({
        dimId: 'architecture',
        sessionId: 'session-1',
        candidateCount: 2,
      });

      await clearDimensionCheckpoints(dataRoot);
      expect(await loadDimensionCheckpoints(dataRoot)).toEqual(new Map());
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

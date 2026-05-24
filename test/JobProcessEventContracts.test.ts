import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_JOB_PROCESS_EVENTS_PATH,
  createJobProcessDeveloperView,
  createJobProcessEvent,
  createJobProcessEventEndpointCapability,
  isJobProcessEventDeveloperVisible,
  JOB_PROCESS_EVENT_CONTRACT_VERSION,
  JOB_PROCESS_EVENT_DISPLAY_POLICIES,
  JOB_PROCESS_EVENT_KINDS,
  JOB_PROCESS_EVENT_RETENTION_POLICIES,
  JOB_PROCESS_EVENT_SOURCE_CLASSES,
  normalizeJobProcessEvent,
  normalizeJobProcessEventKind,
} from '../src/daemon/index.js';

describe('job process event contracts', () => {
  it('keeps developer-facing LLM input fully visible by default', () => {
    const event = createJobProcessEvent({
      content: {
        role: 'user',
        text: 'Analyze all repository entrypoints and produce findings.',
      },
      createdAt: '2026-05-24T00:50:00.000Z',
      dimensionId: 'architecture',
      id: 'evt_1',
      jobId: 'bootstrap_1',
      kind: 'llm.input',
      metadata: { tokenBudget: 4096 },
      phase: 'dimension:architecture',
      sequence: 1,
      targetName: 'Core',
      title: 'LLM prompt input',
    });
    const view = createJobProcessDeveloperView(event);

    expect(event.contractVersion).toBe(JOB_PROCESS_EVENT_CONTRACT_VERSION);
    expect(event.sourceClass).toBe('developer-facing');
    expect(event.displayPolicy).toBe('full');
    expect(event.retention).toBe('job-retained');
    expect(isJobProcessEventDeveloperVisible(event)).toBe(true);
    expect(view).toMatchObject({
      content: {
        text: 'Analyze all repository entrypoints and produce findings.',
      },
      dimensionId: 'architecture',
      displayPolicy: 'full',
      kind: 'llm.input',
      metadata: { tokenBudget: 4096 },
      targetName: 'Core',
    });
  });

  it('projects typed parent event and artifact refs for dashboard timelines', () => {
    const event = createJobProcessEvent({
      artifactRefs: [
        {
          kind: 'candidate-report',
          label: 'Architecture candidates',
          mimeType: 'application/json',
          ref: 'bootstrap-reports/session-1.json',
        },
      ],
      content: { text: 'Created candidate report' },
      createdAt: '2026-05-24T00:52:00.000Z',
      dimensionId: 'architecture',
      id: 'evt_2',
      jobId: 'bootstrap_1',
      kind: 'artifact',
      parentEventId: 'evt_1',
      retention: 'artifact-retained',
      sequence: 2,
      severity: 'success',
      targetName: 'Core',
      title: 'Artifact created',
    });
    const view = createJobProcessDeveloperView(event);

    expect(event).toMatchObject({
      artifactRefs: [
        {
          kind: 'candidate-report',
          label: 'Architecture candidates',
          mimeType: 'application/json',
          ref: 'bootstrap-reports/session-1.json',
        },
      ],
      dimensionId: 'architecture',
      parentEventId: 'evt_1',
      targetName: 'Core',
    });
    expect(view).toMatchObject({
      artifactRefs: [{ kind: 'candidate-report', ref: 'bootstrap-reports/session-1.json' }],
      dimensionId: 'architecture',
      parentEventId: 'evt_1',
      targetName: 'Core',
    });
  });

  it('keeps machine-only, raw-provider, secret and hidden reasoning out of developer views', () => {
    for (const sourceClass of [
      'machine-only',
      'raw-provider',
      'secret',
      'hidden-reasoning',
    ] as const) {
      const event = createJobProcessEvent({
        content: { text: 'internal payload' },
        createdAt: '2026-05-24T00:51:00.000Z',
        id: `evt_${sourceClass}`,
        jobId: 'bootstrap_1',
        kind: 'workflow',
        sequence: 2,
        sourceClass,
        title: 'Internal event',
      });

      expect(event.displayPolicy).toBe('hidden');
      expect(event.retention).toBe(sourceClass === 'machine-only' ? 'job-retained' : 'transient');
      expect(isJobProcessEventDeveloperVisible(event)).toBe(false);
      expect(createJobProcessDeveloperView(event)).toBeNull();
    }
  });

  it('normalizes process events and rejects unknown event kinds', () => {
    const event = normalizeJobProcessEvent({
      content: { text: 'Created candidate report' },
      createdAt: '2026-05-24T00:52:00.000Z',
      artifactRefs: [{ kind: 'terminal-transcript', ref: 'transcripts/bootstrap.log' }],
      dimensionId: 'architecture',
      id: 'evt_3',
      jobId: 'bootstrap_1',
      kind: 'artifact',
      parentId: 'evt_legacy_parent',
      retention: 'artifact-retained',
      sequence: 3,
      severity: 'success',
      targetName: 'Core',
      title: 'Artifact created',
    });

    expect(event).toMatchObject({
      artifactRefs: [{ kind: 'terminal-transcript', ref: 'transcripts/bootstrap.log' }],
      dimensionId: 'architecture',
      kind: 'artifact',
      parentEventId: 'evt_legacy_parent',
      retention: 'artifact-retained',
      severity: 'success',
      targetName: 'Core',
    });
    expect(normalizeJobProcessEventKind('llm.output')).toBe('llm.output');
    expect(normalizeJobProcessEventKind('provider.raw')).toBeNull();
    expect(
      normalizeJobProcessEvent({ id: 'evt_bad', jobId: 'job_1', kind: 'provider.raw' })
    ).toBeNull();
  });

  it('declares the runtime job events endpoint capability for Alembic producers', () => {
    const capability = createJobProcessEventEndpointCapability({
      available: true,
      supportedKinds: ['workflow', 'llm.input', 'llm.output', 'artifact'],
    });

    expect(capability).toEqual({
      available: true,
      contractVersion: JOB_PROCESS_EVENT_CONTRACT_VERSION,
      defaultRetention: 'job-retained',
      developerFacingDefaultDisplayPolicy: 'full',
      endpoint: ALEMBIC_JOB_PROCESS_EVENTS_PATH,
      supportedDisplayPolicies: JOB_PROCESS_EVENT_DISPLAY_POLICIES,
      supportedKinds: ['workflow', 'llm.input', 'llm.output', 'artifact'],
      supportedRetentionPolicies: JOB_PROCESS_EVENT_RETENTION_POLICIES,
      supportedSourceClasses: JOB_PROCESS_EVENT_SOURCE_CLASSES,
    });
    expect(JOB_PROCESS_EVENT_KINDS).toContain('llm.reflection');
    expect(JOB_PROCESS_EVENT_KINDS).toContain('summary');
  });
});

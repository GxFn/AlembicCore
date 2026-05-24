import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_JOB_PROCESS_EVENTS_PATH,
  createJobProcessDeveloperView,
  createJobProcessEvent,
  createJobProcessEventEndpointCapability,
  isJobProcessEventDeveloperVisible,
  JOB_PROCESS_EVENT_CONTRACT_VERSION,
  JOB_PROCESS_EVENT_KINDS,
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
      id: 'evt_1',
      jobId: 'bootstrap_1',
      kind: 'llm.input',
      phase: 'dimension:architecture',
      sequence: 1,
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
      displayPolicy: 'full',
      kind: 'llm.input',
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
      id: 'evt_3',
      jobId: 'bootstrap_1',
      kind: 'artifact',
      retention: 'artifact-retained',
      sequence: 3,
      severity: 'success',
      title: 'Artifact created',
    });

    expect(event).toMatchObject({
      kind: 'artifact',
      retention: 'artifact-retained',
      severity: 'success',
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
      supportedKinds: ['workflow', 'llm.input', 'llm.output', 'artifact'],
    });
    expect(JOB_PROCESS_EVENT_KINDS).toContain('llm.reflection');
    expect(JOB_PROCESS_EVENT_KINDS).toContain('summary');
  });
});

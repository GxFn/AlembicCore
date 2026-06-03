import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_JOB_DISPLAY_SNAPSHOT_PATH,
  collectJobDisplaySnapshotLlmIoEntries,
  computeJobDisplaySnapshotChecksum,
  createJobDisplaySnapshot,
  createJobDisplaySnapshotArtifactRef,
  createJobDisplaySnapshotEvidenceIncomplete,
  createJobProcessEvent,
  isJobDisplaySnapshotEvidenceIncompleteReason,
  JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION,
  JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS,
  type JobDisplaySnapshot,
  normalizeJobDisplaySnapshotEvidenceIncompleteReason,
  validateJobDisplaySnapshot,
} from '../src/daemon/index.js';

describe('JobDisplaySnapshot shared contract', () => {
  it('creates a restart-safe serializable snapshot with deterministic checksum', () => {
    const event = createJobProcessEvent({
      artifactRefs: [
        {
          kind: 'llm-input-full-redacted',
          label: 'Full redacted prompt',
          mimeType: 'text/plain',
          ref: '/api/v1/jobs/bootstrap_1/artifacts/llm-input-1',
        },
      ],
      content: {
        role: 'user',
        text: 'Summarize the project architecture.',
      },
      createdAt: '2026-06-04T00:00:01.000Z',
      id: 'evt_llm_input_1',
      jobId: 'bootstrap_1',
      kind: 'llm.input',
      metadata: {
        redactionState: 'redacted',
        truncationOriginalChars: 1200,
        truncationRetainedChars: 400,
        truncationTruncated: true,
      },
      phase: 'dimension:architecture',
      retention: 'artifact-retained',
      sequence: 1,
      title: 'LLM input',
    });
    const artifact = createJobDisplaySnapshotArtifactRef({
      checksum: 'artifact-sha',
      kind: 'llm-input-full-redacted',
      label: 'Full redacted prompt',
      mimeType: 'text/plain',
      originalChars: 1200,
      redactionState: 'redacted',
      ref: '/api/v1/jobs/bootstrap_1/artifacts/llm-input-1',
      retainedChars: 400,
      storageKind: 'job-artifact',
      truncated: true,
    });

    const snapshot = createSnapshot({
      artifacts: [artifact],
      events: [event],
      llmIo: {
        entries: collectJobDisplaySnapshotLlmIoEntries([event]),
      },
      phaseTimeline: [
        {
          completedAt: null,
          eventIds: [event.id],
          phase: 'dimension:architecture',
          startedAt: '2026-06-04T00:00:01.000Z',
          status: 'running',
          summary: 'Architecture analysis in progress.',
          title: 'Architecture',
        },
      ],
    });

    expect(ALEMBIC_JOB_DISPLAY_SNAPSHOT_PATH).toBe('/api/v1/jobs/:jobId/display-snapshot');
    expect(snapshot.contractVersion).toBe(JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION);
    expect(snapshot.snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(computeJobDisplaySnapshotChecksum(snapshot)).toBe(snapshot.snapshot.checksum);
    expect(snapshot.manifest).toMatchObject({
      artifactCount: 1,
      eventCount: 1,
      llmIoEntryCount: 1,
      retainedArtifactCount: 1,
    });
    expect(snapshot.llmIo.entries[0]).toMatchObject({
      artifactRefs: [{ ref: '/api/v1/jobs/bootstrap_1/artifacts/llm-input-1' }],
      kind: 'llm.input',
      truncation: {
        originalChars: 1200,
        retainedChars: 400,
        truncated: true,
      },
    });
    expect(validateJobDisplaySnapshot(snapshot).valid).toBe(true);
  });

  it('keeps evidenceIncomplete warnings as first-class snapshot contract data', () => {
    const evidenceIncomplete = createJobDisplaySnapshotEvidenceIncomplete({
      createdAt: '2026-06-04T00:00:03.000Z',
      message: 'Process events were not available after daemon restart.',
      reason: 'events_missing_after_restart',
      section: 'events',
    });
    const snapshot = createSnapshot({
      evidenceIncomplete: [evidenceIncomplete],
      warnings: [
        {
          code: 'events_missing_after_restart',
          evidenceIncompleteReason: 'events_missing_after_restart',
          message: evidenceIncomplete.message,
          section: 'events',
          severity: 'warning',
        },
      ],
    });
    const validation = validateJobDisplaySnapshot(snapshot);

    expect(JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS).toContain(
      'events_missing_after_restart'
    );
    expect(isJobDisplaySnapshotEvidenceIncompleteReason('artifact_missing')).toBe(true);
    expect(normalizeJobDisplaySnapshotEvidenceIncompleteReason('unknown')).toBeNull();
    expect(validation.valid).toBe(true);
    expect(validation.evidenceIncomplete).toEqual([evidenceIncomplete]);
    expect(snapshot.warnings[0]?.evidenceIncompleteReason).toBe('events_missing_after_restart');
  });

  it('detects checksum mismatch for same-snapshot readback verification', () => {
    const snapshot = createSnapshot();
    const corrupted: JobDisplaySnapshot = {
      ...snapshot,
      snapshot: {
        ...snapshot.snapshot,
        checksum: 'not-the-same-payload',
      },
    };

    expect(validateJobDisplaySnapshot(corrupted)).toMatchObject({
      issues: [
        {
          code: 'checksum_mismatch',
          path: 'snapshot.checksum',
        },
      ],
      valid: false,
    });
  });
});

function createSnapshot(
  overrides: Partial<Parameters<typeof createJobDisplaySnapshot>[0]> = {}
): JobDisplaySnapshot {
  return createJobDisplaySnapshot({
    artifacts: [],
    candidates: [],
    developerViews: [],
    events: [],
    evidenceIncomplete: [],
    findings: [],
    job: {
      bootstrapSessionId: 'session_1',
      completedAt: null,
      createdAt: '2026-06-04T00:00:00.000Z',
      dataRoot: '/data',
      id: 'bootstrap_1',
      kind: 'bootstrap',
      projectId: 'project-a',
      projectRoot: '/workspace/app',
      startedAt: '2026-06-04T00:00:00.500Z',
      status: 'running',
      updatedAt: '2026-06-04T00:00:02.000Z',
    },
    llmIo: {
      entries: [],
      evidenceIncomplete: [],
    },
    phaseTimeline: [],
    producer: {
      modules: ['DaemonJobRunner', 'JobProcessEventRecorder'],
      name: 'alembic',
      producedAt: '2026-06-04T00:00:02.000Z',
      version: '0.2.0-test',
    },
    snapshot: {
      createdAt: '2026-06-04T00:00:02.000Z',
      jobId: 'bootstrap_1',
      ref: '/api/v1/jobs/bootstrap_1/display-snapshot',
      snapshotId: 'snapshot_bootstrap_1',
      snapshotVersion: 1,
      sourceJobUpdatedAt: '2026-06-04T00:00:02.000Z',
      updatedAt: '2026-06-04T00:00:02.000Z',
    },
    sourceRefs: [],
    summary: {
      message: 'Bootstrap is running.',
      phase: 'dimension:architecture',
      progress: 0.5,
      statusText: 'Running',
      title: 'Bootstrap job display snapshot',
    },
    warnings: [],
    ...overrides,
  });
}

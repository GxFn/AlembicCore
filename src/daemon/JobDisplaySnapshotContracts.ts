import { createHash } from 'node:crypto';
import {
  createJobProcessDeveloperView,
  type JobProcessDeveloperView,
  type JobProcessEvent,
  type JobProcessEventArtifactRef,
  type JobProcessEventContent,
} from './JobProcessEventContracts.js';
import type { DaemonJobKind, DaemonJobStatus } from './JobStore.js';

export const JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION = 1;

export const ALEMBIC_JOB_DISPLAY_SNAPSHOT_PATH = '/api/v1/jobs/:jobId/display-snapshot';

export const JOB_DISPLAY_SNAPSHOT_CHECKSUM_ALGORITHMS = ['sha256'] as const;

export const JOB_DISPLAY_SNAPSHOT_SECTIONS = [
  'summary',
  'timeline',
  'events',
  'artifacts',
  'llm-io',
  'findings',
  'candidates',
  'source-refs',
  'warnings',
] as const;

export const JOB_DISPLAY_SNAPSHOT_ARTIFACT_STORAGE_KINDS = [
  'job-artifact',
  'snapshot-file',
  'bootstrap-report',
  'external-ref',
] as const;

export const JOB_DISPLAY_SNAPSHOT_TEXT_REDACTION_STATES = [
  'not-redacted',
  'redacted',
  'partially-redacted',
  'unknown',
] as const;

export const JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS = [
  'events_missing_after_restart',
  'artifact_missing',
  'artifact_unreadable',
  'snapshot_truncated',
  'snapshot_redacted',
  'report_missing',
  'final_session_missing',
  'llm_io_missing',
  'llm_io_truncated',
  'checksum_mismatch',
  'producer_error',
] as const;

export type JobDisplaySnapshotChecksumAlgorithm =
  (typeof JOB_DISPLAY_SNAPSHOT_CHECKSUM_ALGORITHMS)[number];
export type JobDisplaySnapshotSection = (typeof JOB_DISPLAY_SNAPSHOT_SECTIONS)[number];
export type JobDisplaySnapshotArtifactStorageKind =
  (typeof JOB_DISPLAY_SNAPSHOT_ARTIFACT_STORAGE_KINDS)[number];
export type JobDisplaySnapshotTextRedactionState =
  (typeof JOB_DISPLAY_SNAPSHOT_TEXT_REDACTION_STATES)[number];
export type JobDisplaySnapshotEvidenceIncompleteReason =
  (typeof JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS)[number];
export type JobDisplaySnapshotSeverity = 'info' | 'success' | 'warning' | 'error';
export type JobDisplaySnapshotPhaseStatus = DaemonJobStatus | 'pending' | 'unknown';
export type JobDisplaySnapshotLlmIoKind = 'llm.input' | 'llm.reflection' | 'llm.output';

export interface JobDisplaySnapshotRef {
  checksum: string | null;
  checksumAlgorithm: JobDisplaySnapshotChecksumAlgorithm;
  jobId: string;
  ref: string;
  snapshotId: string;
  snapshotVersion: number;
}

export interface JobDisplaySnapshotMetadata extends JobDisplaySnapshotRef {
  createdAt: string;
  sourceJobUpdatedAt: string | null;
  updatedAt: string;
}

export interface JobDisplaySnapshotJobIdentity {
  bootstrapSessionId: string | null;
  completedAt: string | null;
  createdAt: string;
  dataRoot: string | null;
  id: string;
  kind: DaemonJobKind;
  projectId: string | null;
  projectRoot: string | null;
  startedAt: string | null;
  status: DaemonJobStatus;
  updatedAt: string;
}

export interface JobDisplaySnapshotSummary {
  message: string | null;
  phase: string | null;
  progress: number | null;
  statusText: string | null;
  title: string;
}

export interface JobDisplaySnapshotPhaseTimelineItem {
  completedAt: string | null;
  eventIds: string[];
  phase: string;
  startedAt: string | null;
  status: JobDisplaySnapshotPhaseStatus;
  summary: string | null;
  title: string;
}

export interface JobDisplaySnapshotTextBoundary {
  originalChars: number | null;
  redactionState: JobDisplaySnapshotTextRedactionState;
  retainedChars: number | null;
  truncated: boolean;
}

export interface JobDisplaySnapshotArtifactRef extends JobProcessEventArtifactRef {
  checksum: string | null;
  originalChars: number | null;
  redactionState: JobDisplaySnapshotTextRedactionState;
  retained: boolean;
  retainedChars: number | null;
  storageKind: JobDisplaySnapshotArtifactStorageKind;
  truncated: boolean;
}

export interface CreateJobDisplaySnapshotArtifactRefInput extends JobProcessEventArtifactRef {
  checksum?: string | null;
  originalChars?: number | null;
  redactionState?: JobDisplaySnapshotTextRedactionState;
  retained?: boolean;
  retainedChars?: number | null;
  storageKind?: JobDisplaySnapshotArtifactStorageKind;
  truncated?: boolean;
}

export interface JobDisplaySnapshotLlmIoEntry {
  artifactRefs: JobDisplaySnapshotArtifactRef[];
  content: JobProcessEventContent | null;
  eventId: string | null;
  kind: JobDisplaySnapshotLlmIoKind;
  metadata: Record<string, unknown>;
  phase: string | null;
  redaction: JobDisplaySnapshotTextBoundary;
  sequence: number | null;
  summary: string | null;
  title: string;
  truncation: JobDisplaySnapshotTextBoundary;
}

export interface JobDisplaySnapshotLlmIoSection {
  entries: JobDisplaySnapshotLlmIoEntry[];
  evidenceIncomplete: JobDisplaySnapshotEvidenceIncomplete[];
}

export interface JobDisplaySnapshotEvidenceItem {
  artifactRefs: JobDisplaySnapshotArtifactRef[];
  id: string;
  metadata: Record<string, unknown>;
  sourceRef: string | null;
  summary: string | null;
  title: string;
}

export interface JobDisplaySnapshotWarning {
  code: string;
  evidenceIncompleteReason: JobDisplaySnapshotEvidenceIncompleteReason | null;
  message: string;
  section: JobDisplaySnapshotSection | null;
  severity: JobDisplaySnapshotSeverity;
}

export interface JobDisplaySnapshotEvidenceIncomplete {
  artifactRef: string | null;
  createdAt: string | null;
  eventId: string | null;
  message: string;
  reason: JobDisplaySnapshotEvidenceIncompleteReason;
  section: JobDisplaySnapshotSection;
  severity: Exclude<JobDisplaySnapshotSeverity, 'success'>;
}

export interface CreateJobDisplaySnapshotEvidenceIncompleteInput {
  artifactRef?: string | null;
  createdAt?: string | null;
  eventId?: string | null;
  message: string;
  reason: JobDisplaySnapshotEvidenceIncompleteReason;
  section: JobDisplaySnapshotSection;
  severity?: Exclude<JobDisplaySnapshotSeverity, 'success'>;
}

export interface JobDisplaySnapshotManifest {
  artifactCount: number;
  developerViewCount: number;
  eventCount: number;
  llmIoEntryCount: number;
  retainedArtifactCount: number;
  warningCount: number;
}

export interface JobDisplaySnapshotProducerMetadata {
  contractVersion: typeof JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION;
  modules: string[];
  name: 'alembic';
  producedAt: string;
  version: string | null;
}

export interface JobDisplaySnapshot {
  artifacts: JobDisplaySnapshotArtifactRef[];
  candidates: JobDisplaySnapshotEvidenceItem[];
  contractVersion: typeof JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION;
  developerViews: JobProcessDeveloperView[];
  events: JobProcessEvent[];
  evidenceIncomplete: JobDisplaySnapshotEvidenceIncomplete[];
  findings: JobDisplaySnapshotEvidenceItem[];
  job: JobDisplaySnapshotJobIdentity;
  llmIo: JobDisplaySnapshotLlmIoSection;
  manifest: JobDisplaySnapshotManifest;
  phaseTimeline: JobDisplaySnapshotPhaseTimelineItem[];
  producer: JobDisplaySnapshotProducerMetadata;
  snapshot: JobDisplaySnapshotMetadata;
  sourceRefs: JobDisplaySnapshotEvidenceItem[];
  summary: JobDisplaySnapshotSummary;
  warnings: JobDisplaySnapshotWarning[];
}

export interface CreateJobDisplaySnapshotInput {
  artifacts?: readonly JobDisplaySnapshotArtifactRef[];
  candidates?: readonly JobDisplaySnapshotEvidenceItem[];
  developerViews?: readonly JobProcessDeveloperView[];
  events?: readonly JobProcessEvent[];
  evidenceIncomplete?: readonly JobDisplaySnapshotEvidenceIncomplete[];
  findings?: readonly JobDisplaySnapshotEvidenceItem[];
  job: JobDisplaySnapshotJobIdentity;
  llmIo?: Partial<JobDisplaySnapshotLlmIoSection>;
  phaseTimeline?: readonly JobDisplaySnapshotPhaseTimelineItem[];
  producer: Omit<JobDisplaySnapshotProducerMetadata, 'contractVersion'>;
  snapshot: Omit<JobDisplaySnapshotMetadata, 'checksum' | 'checksumAlgorithm'> & {
    checksum?: string | null;
    checksumAlgorithm?: JobDisplaySnapshotChecksumAlgorithm;
  };
  sourceRefs?: readonly JobDisplaySnapshotEvidenceItem[];
  summary: JobDisplaySnapshotSummary;
  warnings?: readonly JobDisplaySnapshotWarning[];
}

export interface JobDisplaySnapshotValidationIssue {
  code: 'missing' | 'invalid' | 'checksum_mismatch';
  message: string;
  path: string;
}

export interface JobDisplaySnapshotValidationResult {
  evidenceIncomplete: JobDisplaySnapshotEvidenceIncomplete[];
  issues: JobDisplaySnapshotValidationIssue[];
  valid: boolean;
}

export function createJobDisplaySnapshot(input: CreateJobDisplaySnapshotInput): JobDisplaySnapshot {
  const events = input.events?.map((event) => ({ ...event })) ?? [];
  const developerViews =
    input.developerViews?.map((view) => copyJobProcessDeveloperView(view)) ??
    events
      .map((event) => createJobProcessDeveloperView(event))
      .filter((view): view is JobProcessDeveloperView => view !== null);
  const llmIoEntries =
    input.llmIo?.entries?.map((entry) => copyLlmIoEntry(entry)) ??
    collectJobDisplaySnapshotLlmIoEntries(events);
  const artifacts = input.artifacts?.map((artifact) => ({ ...artifact })) ?? [];
  const evidenceIncomplete = input.evidenceIncomplete?.map((evidence) => ({ ...evidence })) ?? [];
  const llmIoEvidenceIncomplete =
    input.llmIo?.evidenceIncomplete?.map((evidence) => ({ ...evidence })) ?? [];
  const base: JobDisplaySnapshot = {
    artifacts,
    candidates: copyEvidenceItems(input.candidates),
    contractVersion: JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION,
    developerViews,
    events,
    evidenceIncomplete,
    findings: copyEvidenceItems(input.findings),
    job: { ...input.job },
    llmIo: {
      entries: llmIoEntries,
      evidenceIncomplete: llmIoEvidenceIncomplete,
    },
    manifest: {
      artifactCount: artifacts.length,
      developerViewCount: developerViews.length,
      eventCount: events.length,
      llmIoEntryCount: llmIoEntries.length,
      retainedArtifactCount: artifacts.filter((artifact) => artifact.retained).length,
      warningCount: input.warnings?.length ?? 0,
    },
    phaseTimeline:
      input.phaseTimeline?.map((item) => ({ ...item, eventIds: [...item.eventIds] })) ?? [],
    producer: {
      contractVersion: JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION,
      ...input.producer,
      modules: [...input.producer.modules],
    },
    snapshot: {
      checksum: input.snapshot.checksum ?? null,
      checksumAlgorithm: input.snapshot.checksumAlgorithm ?? 'sha256',
      createdAt: input.snapshot.createdAt,
      jobId: input.snapshot.jobId,
      ref: input.snapshot.ref,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      sourceJobUpdatedAt: input.snapshot.sourceJobUpdatedAt,
      updatedAt: input.snapshot.updatedAt,
    },
    sourceRefs: copyEvidenceItems(input.sourceRefs),
    summary: { ...input.summary },
    warnings: input.warnings?.map((warning) => ({ ...warning })) ?? [],
  };

  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      checksum: input.snapshot.checksum ?? computeJobDisplaySnapshotChecksum(base),
    },
  };
}

export function createJobDisplaySnapshotArtifactRef(
  input: CreateJobDisplaySnapshotArtifactRefInput
): JobDisplaySnapshotArtifactRef {
  return {
    checksum: input.checksum ?? null,
    kind: input.kind,
    label: input.label ?? null,
    mimeType: input.mimeType ?? null,
    originalChars: input.originalChars ?? null,
    redactionState: input.redactionState ?? 'unknown',
    ref: input.ref,
    retained: input.retained ?? true,
    retainedChars: input.retainedChars ?? null,
    storageKind: input.storageKind ?? 'job-artifact',
    truncated: input.truncated ?? false,
  };
}

export function createJobDisplaySnapshotEvidenceIncomplete(
  input: CreateJobDisplaySnapshotEvidenceIncompleteInput
): JobDisplaySnapshotEvidenceIncomplete {
  return {
    artifactRef: input.artifactRef ?? null,
    createdAt: input.createdAt ?? null,
    eventId: input.eventId ?? null,
    message: input.message,
    reason: input.reason,
    section: input.section,
    severity: input.severity ?? 'warning',
  };
}

export function collectJobDisplaySnapshotLlmIoEntries(
  events: readonly JobProcessEvent[]
): JobDisplaySnapshotLlmIoEntry[] {
  return events
    .filter((event): event is JobProcessEvent & { kind: JobDisplaySnapshotLlmIoKind } =>
      isJobDisplaySnapshotLlmIoKind(event.kind)
    )
    .map((event) => ({
      artifactRefs: event.artifactRefs.map((artifactRef) =>
        createJobDisplaySnapshotArtifactRef(artifactRef)
      ),
      content: event.content ? { ...event.content } : null,
      eventId: event.id,
      kind: event.kind,
      metadata: { ...event.metadata },
      phase: event.phase,
      redaction: createTextBoundaryFromMetadata(event.metadata, 'redaction'),
      sequence: event.sequence,
      summary: event.summary,
      title: event.title,
      truncation: createTextBoundaryFromMetadata(event.metadata, 'truncation'),
    }));
}

export function computeJobDisplaySnapshotChecksum(snapshot: JobDisplaySnapshot): string {
  const payload: JobDisplaySnapshot = {
    ...snapshot,
    snapshot: {
      ...snapshot.snapshot,
      checksum: null,
    },
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function validateJobDisplaySnapshot(
  snapshot: JobDisplaySnapshot
): JobDisplaySnapshotValidationResult {
  const issues: JobDisplaySnapshotValidationIssue[] = [];
  if (snapshot.contractVersion !== JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION) {
    issues.push({
      code: 'invalid',
      message: 'JobDisplaySnapshot contractVersion is not supported.',
      path: 'contractVersion',
    });
  }
  if (snapshot.snapshot.jobId !== snapshot.job.id) {
    issues.push({
      code: 'invalid',
      message: 'Snapshot jobId must match job identity id.',
      path: 'snapshot.jobId',
    });
  }
  if (!snapshot.snapshot.ref) {
    issues.push({
      code: 'missing',
      message: 'Snapshot ref is required for restart-safe readback.',
      path: 'snapshot.ref',
    });
  }
  if (!snapshot.snapshot.checksum) {
    issues.push({
      code: 'missing',
      message: 'Snapshot checksum is required for same-snapshot verification.',
      path: 'snapshot.checksum',
    });
  } else {
    const expected = computeJobDisplaySnapshotChecksum(snapshot);
    if (snapshot.snapshot.checksum !== expected) {
      issues.push({
        code: 'checksum_mismatch',
        message: 'Snapshot checksum does not match serializable payload.',
        path: 'snapshot.checksum',
      });
    }
  }

  return {
    evidenceIncomplete: [...snapshot.evidenceIncomplete, ...snapshot.llmIo.evidenceIncomplete],
    issues,
    valid: issues.length === 0,
  };
}

export function isJobDisplaySnapshotEvidenceIncompleteReason(
  value: unknown
): value is JobDisplaySnapshotEvidenceIncompleteReason {
  return (
    typeof value === 'string' &&
    JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS.includes(
      value as JobDisplaySnapshotEvidenceIncompleteReason
    )
  );
}

export function normalizeJobDisplaySnapshotEvidenceIncompleteReason(
  value: unknown
): JobDisplaySnapshotEvidenceIncompleteReason | null {
  return isJobDisplaySnapshotEvidenceIncompleteReason(value) ? value : null;
}

export function isJobDisplaySnapshotLlmIoKind(kind: unknown): kind is JobDisplaySnapshotLlmIoKind {
  return kind === 'llm.input' || kind === 'llm.reflection' || kind === 'llm.output';
}

function copyJobProcessDeveloperView(view: JobProcessDeveloperView): JobProcessDeveloperView {
  return {
    ...view,
    artifactRefs: view.artifactRefs.map((artifactRef) => ({ ...artifactRef })),
    content: view.content ? { ...view.content } : null,
    metadata: { ...view.metadata },
  };
}

function copyLlmIoEntry(entry: JobDisplaySnapshotLlmIoEntry): JobDisplaySnapshotLlmIoEntry {
  return {
    ...entry,
    artifactRefs: entry.artifactRefs.map((artifactRef) => ({ ...artifactRef })),
    content: entry.content ? { ...entry.content } : null,
    metadata: { ...entry.metadata },
    redaction: { ...entry.redaction },
    truncation: { ...entry.truncation },
  };
}

function copyEvidenceItems(
  items: readonly JobDisplaySnapshotEvidenceItem[] | undefined
): JobDisplaySnapshotEvidenceItem[] {
  return (
    items?.map((item) => ({
      ...item,
      artifactRefs: item.artifactRefs.map((artifactRef) => ({ ...artifactRef })),
      metadata: { ...item.metadata },
    })) ?? []
  );
}

function createTextBoundaryFromMetadata(
  metadata: Record<string, unknown>,
  prefix: 'redaction' | 'truncation'
): JobDisplaySnapshotTextBoundary {
  return {
    originalChars: numberOrNull(metadata[`${prefix}OriginalChars`]),
    redactionState: normalizeTextRedactionState(metadata[`${prefix}State`]) ?? 'unknown',
    retainedChars: numberOrNull(metadata[`${prefix}RetainedChars`]),
    truncated: Boolean(metadata[`${prefix}Truncated`]),
  };
}

function normalizeTextRedactionState(value: unknown): JobDisplaySnapshotTextRedactionState | null {
  return typeof value === 'string' &&
    JOB_DISPLAY_SNAPSHOT_TEXT_REDACTION_STATES.includes(
      value as JobDisplaySnapshotTextRedactionState
    )
    ? (value as JobDisplaySnapshotTextRedactionState)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

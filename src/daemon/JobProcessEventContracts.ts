export const JOB_PROCESS_EVENT_CONTRACT_VERSION = 1;

export const ALEMBIC_JOB_PROCESS_EVENTS_PATH = '/api/v1/jobs/:jobId/events';

export const JOB_PROCESS_EVENT_KINDS = [
  'workflow',
  'llm.input',
  'llm.reflection',
  'llm.output',
  'tool',
  'artifact',
  'checkpoint',
  'error',
  'summary',
] as const;

export const JOB_PROCESS_EVENT_SOURCE_CLASSES = [
  'developer-facing',
  'machine-only',
  'raw-provider',
  'secret',
  'hidden-reasoning',
] as const;

export const JOB_PROCESS_EVENT_DISPLAY_POLICIES = ['full', 'summary-only', 'hidden'] as const;

export const JOB_PROCESS_EVENT_RETENTION_POLICIES = [
  'transient',
  'job-retained',
  'artifact-retained',
] as const;

export const JOB_PROCESS_EVENT_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;

export const JOB_PROCESS_EVENT_MESSAGE_ROLES = [
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
] as const;

export type JobProcessEventKind = (typeof JOB_PROCESS_EVENT_KINDS)[number];
export type JobProcessEventSourceClass = (typeof JOB_PROCESS_EVENT_SOURCE_CLASSES)[number];
export type JobProcessEventDisplayPolicy = (typeof JOB_PROCESS_EVENT_DISPLAY_POLICIES)[number];
export type JobProcessEventRetentionPolicy = (typeof JOB_PROCESS_EVENT_RETENTION_POLICIES)[number];
export type JobProcessEventSeverity = (typeof JOB_PROCESS_EVENT_SEVERITIES)[number];
export type JobProcessEventMessageRole = (typeof JOB_PROCESS_EVENT_MESSAGE_ROLES)[number];

export interface JobProcessEventContent {
  data?: unknown;
  language?: string | null;
  mimeType?: string | null;
  role?: JobProcessEventMessageRole | null;
  text: string | null;
}

export interface JobProcessEvent {
  content: JobProcessEventContent | null;
  contractVersion: typeof JOB_PROCESS_EVENT_CONTRACT_VERSION;
  correlationId: string | null;
  createdAt: string;
  displayPolicy: JobProcessEventDisplayPolicy;
  id: string;
  jobId: string;
  kind: JobProcessEventKind;
  metadata: Record<string, unknown>;
  parentId: string | null;
  phase: string | null;
  retention: JobProcessEventRetentionPolicy;
  sequence: number;
  severity: JobProcessEventSeverity;
  sourceClass: JobProcessEventSourceClass;
  summary: string | null;
  title: string;
}

export interface JobProcessDeveloperView {
  content: JobProcessEventContent | null;
  createdAt: string;
  displayPolicy: Exclude<JobProcessEventDisplayPolicy, 'hidden'>;
  eventId: string;
  jobId: string;
  kind: JobProcessEventKind;
  phase: string | null;
  sequence: number;
  severity: JobProcessEventSeverity;
  summary: string | null;
  title: string;
}

export interface CreateJobProcessEventInput {
  content?: JobProcessEventContent | null;
  correlationId?: string | null;
  createdAt: string;
  displayPolicy?: JobProcessEventDisplayPolicy;
  id: string;
  jobId: string;
  kind: JobProcessEventKind;
  metadata?: Record<string, unknown>;
  parentId?: string | null;
  phase?: string | null;
  retention?: JobProcessEventRetentionPolicy;
  sequence: number;
  severity?: JobProcessEventSeverity;
  sourceClass?: JobProcessEventSourceClass;
  summary?: string | null;
  title: string;
}

export interface JobProcessEventEndpointCapability {
  available: boolean;
  contractVersion: typeof JOB_PROCESS_EVENT_CONTRACT_VERSION;
  defaultRetention: JobProcessEventRetentionPolicy;
  developerFacingDefaultDisplayPolicy: 'full';
  endpoint: string | null;
  supportedKinds: JobProcessEventKind[];
}

export interface CreateJobProcessEventEndpointCapabilityOptions {
  available?: boolean;
  defaultRetention?: JobProcessEventRetentionPolicy;
  endpoint?: string | null;
  supportedKinds?: readonly JobProcessEventKind[];
}

export function createJobProcessEvent(input: CreateJobProcessEventInput): JobProcessEvent {
  const sourceClass = input.sourceClass ?? 'developer-facing';
  const displayPolicy = input.displayPolicy ?? defaultDisplayPolicyForSourceClass(sourceClass);
  return {
    content: input.content ?? null,
    contractVersion: JOB_PROCESS_EVENT_CONTRACT_VERSION,
    correlationId: input.correlationId ?? null,
    createdAt: input.createdAt,
    displayPolicy,
    id: input.id,
    jobId: input.jobId,
    kind: input.kind,
    metadata: input.metadata ?? {},
    parentId: input.parentId ?? null,
    phase: input.phase ?? null,
    retention: input.retention ?? defaultRetentionForSourceClass(sourceClass),
    sequence: input.sequence,
    severity: input.severity ?? defaultSeverityForKind(input.kind),
    sourceClass,
    summary: input.summary ?? null,
    title: input.title,
  };
}

export function normalizeJobProcessEvent(value: unknown): JobProcessEvent | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const kind = normalizeJobProcessEventKind(record.kind);
  const id = nonEmptyString(record.id);
  const jobId = nonEmptyString(record.jobId);
  const sequence = numberOrNull(record.sequence);
  const createdAt = nonEmptyString(record.createdAt);
  const title = nonEmptyString(record.title);
  if (!kind || !id || !jobId || sequence === null || !createdAt || !title) {
    return null;
  }

  return createJobProcessEvent({
    content: normalizeJobProcessEventContent(record.content),
    correlationId: nullableString(record.correlationId),
    createdAt,
    displayPolicy: normalizeJobProcessEventDisplayPolicy(record.displayPolicy) ?? undefined,
    id,
    jobId,
    kind,
    metadata: asRecord(record.metadata) ?? {},
    parentId: nullableString(record.parentId),
    phase: nullableString(record.phase),
    retention: normalizeJobProcessEventRetentionPolicy(record.retention) ?? undefined,
    sequence,
    severity: normalizeJobProcessEventSeverity(record.severity) ?? undefined,
    sourceClass: normalizeJobProcessEventSourceClass(record.sourceClass) ?? undefined,
    summary: nullableString(record.summary),
    title,
  });
}

export function createJobProcessDeveloperView(
  event: JobProcessEvent
): JobProcessDeveloperView | null {
  if (!isJobProcessEventDeveloperVisible(event)) {
    return null;
  }
  const displayPolicy = event.displayPolicy === 'summary-only' ? 'summary-only' : 'full';

  return {
    content: displayPolicy === 'summary-only' ? null : event.content,
    createdAt: event.createdAt,
    displayPolicy,
    eventId: event.id,
    jobId: event.jobId,
    kind: event.kind,
    phase: event.phase,
    sequence: event.sequence,
    severity: event.severity,
    summary: event.summary,
    title: event.title,
  };
}

export function createJobProcessEventEndpointCapability(
  options: CreateJobProcessEventEndpointCapabilityOptions = {}
): JobProcessEventEndpointCapability {
  return {
    available: options.available ?? false,
    contractVersion: JOB_PROCESS_EVENT_CONTRACT_VERSION,
    defaultRetention: options.defaultRetention ?? 'job-retained',
    developerFacingDefaultDisplayPolicy: 'full',
    endpoint: options.endpoint === undefined ? ALEMBIC_JOB_PROCESS_EVENTS_PATH : options.endpoint,
    supportedKinds: [...(options.supportedKinds ?? JOB_PROCESS_EVENT_KINDS)],
  };
}

export function isJobProcessEventDeveloperVisible(event: JobProcessEvent): boolean {
  // developer-facing 内容第一版默认完整展示；其它 sourceClass 不进入开发者前端。
  return event.sourceClass === 'developer-facing' && event.displayPolicy !== 'hidden';
}

export function defaultDisplayPolicyForSourceClass(
  sourceClass: JobProcessEventSourceClass
): JobProcessEventDisplayPolicy {
  return sourceClass === 'developer-facing' ? 'full' : 'hidden';
}

export function defaultRetentionForSourceClass(
  sourceClass: JobProcessEventSourceClass
): JobProcessEventRetentionPolicy {
  return sourceClass === 'secret' ||
    sourceClass === 'raw-provider' ||
    sourceClass === 'hidden-reasoning'
    ? 'transient'
    : 'job-retained';
}

export function defaultSeverityForKind(kind: JobProcessEventKind): JobProcessEventSeverity {
  return kind === 'error' ? 'error' : 'info';
}

export function isJobProcessEventKind(value: unknown): value is JobProcessEventKind {
  return typeof value === 'string' && JOB_PROCESS_EVENT_KINDS.includes(value as never);
}

export function normalizeJobProcessEventKind(value: unknown): JobProcessEventKind | null {
  return isJobProcessEventKind(value) ? value : null;
}

export function isJobProcessEventSourceClass(value: unknown): value is JobProcessEventSourceClass {
  return typeof value === 'string' && JOB_PROCESS_EVENT_SOURCE_CLASSES.includes(value as never);
}

export function normalizeJobProcessEventSourceClass(
  value: unknown
): JobProcessEventSourceClass | null {
  return isJobProcessEventSourceClass(value) ? value : null;
}

export function isJobProcessEventDisplayPolicy(
  value: unknown
): value is JobProcessEventDisplayPolicy {
  return typeof value === 'string' && JOB_PROCESS_EVENT_DISPLAY_POLICIES.includes(value as never);
}

export function normalizeJobProcessEventDisplayPolicy(
  value: unknown
): JobProcessEventDisplayPolicy | null {
  return isJobProcessEventDisplayPolicy(value) ? value : null;
}

export function isJobProcessEventRetentionPolicy(
  value: unknown
): value is JobProcessEventRetentionPolicy {
  return typeof value === 'string' && JOB_PROCESS_EVENT_RETENTION_POLICIES.includes(value as never);
}

export function normalizeJobProcessEventRetentionPolicy(
  value: unknown
): JobProcessEventRetentionPolicy | null {
  return isJobProcessEventRetentionPolicy(value) ? value : null;
}

export function isJobProcessEventSeverity(value: unknown): value is JobProcessEventSeverity {
  return typeof value === 'string' && JOB_PROCESS_EVENT_SEVERITIES.includes(value as never);
}

export function normalizeJobProcessEventSeverity(value: unknown): JobProcessEventSeverity | null {
  return isJobProcessEventSeverity(value) ? value : null;
}

export function isJobProcessEventMessageRole(value: unknown): value is JobProcessEventMessageRole {
  return typeof value === 'string' && JOB_PROCESS_EVENT_MESSAGE_ROLES.includes(value as never);
}

export function normalizeJobProcessEventMessageRole(
  value: unknown
): JobProcessEventMessageRole | null {
  return isJobProcessEventMessageRole(value) ? value : null;
}

function normalizeJobProcessEventContent(value: unknown): JobProcessEventContent | null {
  const content = asRecord(value);
  if (!content) {
    return null;
  }
  return {
    data: content.data,
    language: nullableString(content.language),
    mimeType: nullableString(content.mimeType),
    role: normalizeJobProcessEventMessageRole(content.role),
    text: nullableString(content.text),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

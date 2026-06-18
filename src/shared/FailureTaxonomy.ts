import type { CoreFieldClass, CoreFieldFailureKind } from './FieldTaxonomy.js';
import {
  CORE_FIELD_FAILURE_KINDS,
  isCoreFieldClass,
  isCoreFieldFailureKind,
  isCorePrivateFieldClass,
} from './FieldTaxonomy.js';

export const CORE_FAILURE_TAXONOMY_VERSION = 1;

// The D25 floor every provider must demonstrate. 'needs-confirmation' is
// deliberately NOT required: its only HTTP/412 producer (the decision-register
// route) was retired, so no provider is obliged to emit it. Its taxonomy entry
// is retained (see CORE_FAILURE_TAXONOMY) for providers that still classify
// confirmation flows (e.g. the Plugin MCP consent/rebuild codes).
export const CORE_D25_REQUIRED_FAILURE_KINDS = [
  'invalid-input',
  'not-found',
  'conflict',
  'permission-denied',
  'timeout',
  'cancelled',
  'unavailable',
  'degraded',
  'partial',
  'capability-mismatch',
  'provider-error',
  'host-failure',
  'internal-error',
] as const satisfies readonly CoreFieldFailureKind[];

export const CORE_FAILURE_STATUSES = [
  'blocked',
  'failed',
  'degraded',
  'partial',
  'cancelled',
  'needs-confirmation',
] as const;

export const CORE_FAILURE_PROBLEM_CLASSES = [
  'request-problem',
  'resource-problem',
  'state-conflict',
  'permission-problem',
  'time-problem',
  'cancellation',
  'availability-problem',
  'degradation',
  'partial-result',
  'capability-problem',
  'confirmation-required',
  'provider-problem',
  'host-problem',
  'internal-problem',
  'schema-problem',
  'sensitive-data-problem',
] as const;

export const CORE_FAILURE_RETRY_POLICIES = [
  'never',
  'after-caller-action',
  'after-input-change',
  'after-state-change',
  'after-confirmation',
  'retryable',
  'retryable-after-backoff',
  'operator-action',
] as const;

export const CORE_FAILURE_REF_POLICIES = [
  'none',
  'detailRef',
  'artifactRef',
  'detailRef-or-artifactRef',
  'redacted-detailRef',
] as const;

export type CoreFailureStatus = (typeof CORE_FAILURE_STATUSES)[number];
export type CoreFailureProblemClass = (typeof CORE_FAILURE_PROBLEM_CLASSES)[number];
export type CoreFailureRetryPolicy = (typeof CORE_FAILURE_RETRY_POLICIES)[number];
export type CoreFailureRefPolicy = (typeof CORE_FAILURE_REF_POLICIES)[number];
export type CoreFailureAgentBranch =
  | 'failure'
  | 'cancellation'
  | 'timeout'
  | 'permission-denial'
  | 'needs-confirmation'
  | 'partial-result'
  | 'provider-error'
  | 'host-failure'
  | 'host-adapter';

export interface CoreFailureTaxonomyEntry {
  agentBranch: CoreFailureAgentBranch;
  dashboardState: CoreFieldFailureKind;
  detailExposureClass: CoreFieldClass;
  exposureClass: CoreFieldClass;
  httpStatus: number;
  kind: CoreFieldFailureKind;
  mcpErrorCode: `core.failure.${CoreFieldFailureKind}`;
  mcpStatus: CoreFieldFailureKind;
  owner: 'AlembicCore';
  privateDataSafe: true;
  problemClass: CoreFailureProblemClass;
  publicMessage: string;
  refPolicy: CoreFailureRefPolicy;
  retryPolicy: CoreFailureRetryPolicy;
  retryable: boolean;
  stableId: `core.failure.${CoreFieldFailureKind}`;
  status: CoreFailureStatus;
}

export interface CoreFailureTaxonomyValidationIssue {
  code:
    | 'missing-failure-kind'
    | 'unexpected-failure-kind'
    | 'duplicate-failure-kind'
    | 'stable-id-mismatch'
    | 'invalid-failure-kind'
    | 'invalid-exposure-class'
    | 'invalid-detail-exposure-class'
    | 'private-detail-without-ref-policy';
  kind?: string;
  message: string;
  path: string;
}

export interface CoreFailureTaxonomyValidationResult {
  issues: CoreFailureTaxonomyValidationIssue[];
  taxonomyCount: number;
  valid: boolean;
  version: typeof CORE_FAILURE_TAXONOMY_VERSION;
}

export interface CoreFailureTaxonomySummary {
  byProblemClass: Record<CoreFailureProblemClass, number>;
  byRetryPolicy: Record<CoreFailureRetryPolicy, number>;
  byStatus: Record<CoreFailureStatus, number>;
  taxonomyCount: number;
  version: typeof CORE_FAILURE_TAXONOMY_VERSION;
}

export const CORE_FAILURE_TAXONOMY = [
  {
    agentBranch: 'failure',
    dashboardState: 'invalid-input',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 400,
    kind: 'invalid-input',
    mcpErrorCode: 'core.failure.invalid-input',
    mcpStatus: 'invalid-input',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'request-problem',
    publicMessage: 'The request is invalid.',
    refPolicy: 'none',
    retryPolicy: 'after-input-change',
    retryable: false,
    stableId: 'core.failure.invalid-input',
    status: 'blocked',
  },
  {
    agentBranch: 'host-adapter',
    dashboardState: 'unavailable',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 503,
    kind: 'unavailable',
    mcpErrorCode: 'core.failure.unavailable',
    mcpStatus: 'unavailable',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'availability-problem',
    publicMessage: 'The requested capability is unavailable.',
    refPolicy: 'detailRef',
    retryPolicy: 'retryable-after-backoff',
    retryable: true,
    stableId: 'core.failure.unavailable',
    status: 'blocked',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'capability-mismatch',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 501,
    kind: 'capability-mismatch',
    mcpErrorCode: 'core.failure.capability-mismatch',
    mcpStatus: 'capability-mismatch',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'capability-problem',
    publicMessage: 'The current capability does not support the requested operation.',
    refPolicy: 'detailRef',
    retryPolicy: 'operator-action',
    retryable: false,
    stableId: 'core.failure.capability-mismatch',
    status: 'blocked',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'not-found',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 404,
    kind: 'not-found',
    mcpErrorCode: 'core.failure.not-found',
    mcpStatus: 'not-found',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'resource-problem',
    publicMessage: 'The requested resource was not found.',
    refPolicy: 'none',
    retryPolicy: 'after-state-change',
    retryable: false,
    stableId: 'core.failure.not-found',
    status: 'blocked',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'conflict',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 409,
    kind: 'conflict',
    mcpErrorCode: 'core.failure.conflict',
    mcpStatus: 'conflict',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'state-conflict',
    publicMessage: 'The request conflicts with current state.',
    refPolicy: 'detailRef',
    retryPolicy: 'after-state-change',
    retryable: false,
    stableId: 'core.failure.conflict',
    status: 'blocked',
  },
  {
    agentBranch: 'permission-denial',
    dashboardState: 'permission-denied',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 403,
    kind: 'permission-denied',
    mcpErrorCode: 'core.failure.permission-denied',
    mcpStatus: 'permission-denied',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'permission-problem',
    publicMessage: 'Permission is denied for the requested operation.',
    refPolicy: 'none',
    retryPolicy: 'after-caller-action',
    retryable: false,
    stableId: 'core.failure.permission-denied',
    status: 'blocked',
  },
  {
    agentBranch: 'timeout',
    dashboardState: 'timeout',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 408,
    kind: 'timeout',
    mcpErrorCode: 'core.failure.timeout',
    mcpStatus: 'timeout',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'time-problem',
    publicMessage: 'The operation timed out.',
    refPolicy: 'detailRef',
    retryPolicy: 'retryable',
    retryable: true,
    stableId: 'core.failure.timeout',
    status: 'failed',
  },
  {
    agentBranch: 'cancellation',
    dashboardState: 'cancelled',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 499,
    kind: 'cancelled',
    mcpErrorCode: 'core.failure.cancelled',
    mcpStatus: 'cancelled',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'cancellation',
    publicMessage: 'The operation was cancelled.',
    refPolicy: 'none',
    retryPolicy: 'after-caller-action',
    retryable: false,
    stableId: 'core.failure.cancelled',
    status: 'cancelled',
  },
  {
    agentBranch: 'partial-result',
    dashboardState: 'partial',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 206,
    kind: 'partial',
    mcpErrorCode: 'core.failure.partial',
    mcpStatus: 'partial',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'partial-result',
    publicMessage: 'The operation completed only partially.',
    refPolicy: 'detailRef-or-artifactRef',
    retryPolicy: 'retryable',
    retryable: true,
    stableId: 'core.failure.partial',
    status: 'partial',
  },
  {
    agentBranch: 'host-adapter',
    dashboardState: 'degraded',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 503,
    kind: 'degraded',
    mcpErrorCode: 'core.failure.degraded',
    mcpStatus: 'degraded',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'degradation',
    publicMessage: 'The capability is available with degraded behavior.',
    refPolicy: 'detailRef',
    retryPolicy: 'retryable-after-backoff',
    retryable: true,
    stableId: 'core.failure.degraded',
    status: 'degraded',
  },
  {
    agentBranch: 'needs-confirmation',
    dashboardState: 'needs-confirmation',
    detailExposureClass: 'consumer-needed',
    exposureClass: 'public',
    httpStatus: 412,
    kind: 'needs-confirmation',
    mcpErrorCode: 'core.failure.needs-confirmation',
    mcpStatus: 'needs-confirmation',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'confirmation-required',
    publicMessage: 'The operation requires explicit confirmation.',
    refPolicy: 'none',
    retryPolicy: 'after-confirmation',
    retryable: false,
    stableId: 'core.failure.needs-confirmation',
    status: 'needs-confirmation',
  },
  {
    agentBranch: 'provider-error',
    dashboardState: 'provider-error',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 502,
    kind: 'provider-error',
    mcpErrorCode: 'core.failure.provider-error',
    mcpStatus: 'provider-error',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'provider-problem',
    publicMessage: 'The provider returned an error.',
    refPolicy: 'detailRef',
    retryPolicy: 'retryable-after-backoff',
    retryable: true,
    stableId: 'core.failure.provider-error',
    status: 'failed',
  },
  {
    agentBranch: 'host-failure',
    dashboardState: 'host-failure',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 424,
    kind: 'host-failure',
    mcpErrorCode: 'core.failure.host-failure',
    mcpStatus: 'host-failure',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'host-problem',
    publicMessage: 'The host runtime failed the operation.',
    refPolicy: 'detailRef',
    retryPolicy: 'operator-action',
    retryable: false,
    stableId: 'core.failure.host-failure',
    status: 'failed',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'internal-error',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 500,
    kind: 'internal-error',
    mcpErrorCode: 'core.failure.internal-error',
    mcpStatus: 'internal-error',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'internal-problem',
    publicMessage: 'An internal error occurred.',
    refPolicy: 'detailRef',
    retryPolicy: 'operator-action',
    retryable: false,
    stableId: 'core.failure.internal-error',
    status: 'failed',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'schema-drift',
    detailExposureClass: 'diagnostic',
    exposureClass: 'public',
    httpStatus: 422,
    kind: 'schema-drift',
    mcpErrorCode: 'core.failure.schema-drift',
    mcpStatus: 'schema-drift',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'schema-problem',
    publicMessage: 'The payload does not match the expected schema.',
    refPolicy: 'detailRef',
    retryPolicy: 'operator-action',
    retryable: false,
    stableId: 'core.failure.schema-drift',
    status: 'blocked',
  },
  {
    agentBranch: 'failure',
    dashboardState: 'sensitive-leak',
    detailExposureClass: 'sensitive',
    exposureClass: 'public',
    httpStatus: 500,
    kind: 'sensitive-leak',
    mcpErrorCode: 'core.failure.sensitive-leak',
    mcpStatus: 'sensitive-leak',
    owner: 'AlembicCore',
    privateDataSafe: true,
    problemClass: 'sensitive-data-problem',
    publicMessage: 'A sensitive-data safety boundary was triggered.',
    refPolicy: 'redacted-detailRef',
    retryPolicy: 'operator-action',
    retryable: false,
    stableId: 'core.failure.sensitive-leak',
    status: 'blocked',
  },
] as const satisfies readonly CoreFailureTaxonomyEntry[];

export function validateCoreFailureTaxonomy(
  entries: readonly CoreFailureTaxonomyEntry[] = CORE_FAILURE_TAXONOMY
): CoreFailureTaxonomyValidationResult {
  const issues: CoreFailureTaxonomyValidationIssue[] = [];
  const entriesByKind = new Map<CoreFieldFailureKind, CoreFailureTaxonomyEntry>();
  const expectedKinds = new Set(CORE_FIELD_FAILURE_KINDS);

  for (const entry of entries) {
    if (!isCoreFieldFailureKind(entry.kind)) {
      issues.push({
        code: 'invalid-failure-kind',
        kind: String(entry.kind),
        message: `Core failure taxonomy entry has invalid kind ${entry.kind}.`,
        path: `${entry.kind}.kind`,
      });
      continue;
    }

    if (!expectedKinds.has(entry.kind)) {
      issues.push({
        code: 'unexpected-failure-kind',
        kind: entry.kind,
        message: `Core failure taxonomy entry ${entry.kind} is not in CORE_FIELD_FAILURE_KINDS.`,
        path: `${entry.kind}.kind`,
      });
    }

    if (entriesByKind.has(entry.kind)) {
      issues.push({
        code: 'duplicate-failure-kind',
        kind: entry.kind,
        message: `Core failure taxonomy entry ${entry.kind} is duplicated.`,
        path: `${entry.kind}`,
      });
    }
    entriesByKind.set(entry.kind, entry);

    const expectedStableId = `core.failure.${entry.kind}` as const;
    if (entry.stableId !== expectedStableId || entry.mcpErrorCode !== expectedStableId) {
      issues.push({
        code: 'stable-id-mismatch',
        kind: entry.kind,
        message: `Core failure taxonomy entry ${entry.kind} must use ${expectedStableId}.`,
        path: `${entry.kind}.stableId`,
      });
    }

    if (!isCoreFieldClass(entry.exposureClass)) {
      issues.push({
        code: 'invalid-exposure-class',
        kind: entry.kind,
        message: `Core failure taxonomy entry ${entry.kind} has invalid exposure class.`,
        path: `${entry.kind}.exposureClass`,
      });
    }

    if (!isCoreFieldClass(entry.detailExposureClass)) {
      issues.push({
        code: 'invalid-detail-exposure-class',
        kind: entry.kind,
        message: `Core failure taxonomy entry ${entry.kind} has invalid detail exposure class.`,
        path: `${entry.kind}.detailExposureClass`,
      });
      continue;
    }

    if (isCorePrivateFieldClass(entry.detailExposureClass) && entry.refPolicy === 'none') {
      issues.push({
        code: 'private-detail-without-ref-policy',
        kind: entry.kind,
        message: `Private failure details for ${entry.kind} must use a ref/redaction policy.`,
        path: `${entry.kind}.refPolicy`,
      });
    }
  }

  for (const kind of CORE_FIELD_FAILURE_KINDS) {
    if (!entriesByKind.has(kind)) {
      issues.push({
        code: 'missing-failure-kind',
        kind,
        message: `Core failure taxonomy is missing ${kind}.`,
        path: `${kind}`,
      });
    }
  }

  return {
    issues,
    taxonomyCount: entries.length,
    valid: issues.length === 0,
    version: CORE_FAILURE_TAXONOMY_VERSION,
  };
}

export function summarizeCoreFailureTaxonomy(
  entries: readonly CoreFailureTaxonomyEntry[] = CORE_FAILURE_TAXONOMY
): CoreFailureTaxonomySummary {
  const byProblemClass = emptyProblemClassCounts();
  const byRetryPolicy = emptyRetryPolicyCounts();
  const byStatus = emptyFailureStatusCounts();

  for (const entry of entries) {
    byProblemClass[entry.problemClass] += 1;
    byRetryPolicy[entry.retryPolicy] += 1;
    byStatus[entry.status] += 1;
  }

  return {
    byProblemClass,
    byRetryPolicy,
    byStatus,
    taxonomyCount: entries.length,
    version: CORE_FAILURE_TAXONOMY_VERSION,
  };
}

export function getCoreFailureTaxonomyEntry(kind: CoreFieldFailureKind): CoreFailureTaxonomyEntry {
  const entry = CORE_FAILURE_TAXONOMY.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`Missing Core failure taxonomy entry for ${kind}.`);
  }
  return entry;
}

function emptyProblemClassCounts(): Record<CoreFailureProblemClass, number> {
  return {
    'availability-problem': 0,
    cancellation: 0,
    'capability-problem': 0,
    'confirmation-required': 0,
    degradation: 0,
    'host-problem': 0,
    'internal-problem': 0,
    'partial-result': 0,
    'permission-problem': 0,
    'provider-problem': 0,
    'request-problem': 0,
    'resource-problem': 0,
    'schema-problem': 0,
    'sensitive-data-problem': 0,
    'state-conflict': 0,
    'time-problem': 0,
  };
}

function emptyRetryPolicyCounts(): Record<CoreFailureRetryPolicy, number> {
  return {
    'after-caller-action': 0,
    'after-confirmation': 0,
    'after-input-change': 0,
    'after-state-change': 0,
    never: 0,
    'operator-action': 0,
    retryable: 0,
    'retryable-after-backoff': 0,
  };
}

function emptyFailureStatusCounts(): Record<CoreFailureStatus, number> {
  return {
    blocked: 0,
    cancelled: 0,
    degraded: 0,
    failed: 0,
    'needs-confirmation': 0,
    partial: 0,
  };
}

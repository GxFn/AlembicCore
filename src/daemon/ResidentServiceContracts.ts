import type { DaemonJobStatus } from './JobStore.js';
import {
  ALEMBIC_RUNTIME_HEALTH_PATH,
  ALEMBIC_RUNTIME_ROUTE_KINDS,
  type AlembicRuntimeProjectIdentitySummary,
  type AlembicRuntimeRouteKind,
  normalizeAlembicRuntimeRouteKind,
  summarizeAlembicRuntimeProjectIdentity,
} from './RuntimeContracts.js';

export const ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION = 1;

export const ALEMBIC_RESIDENT_ROUTE_KINDS = ALEMBIC_RUNTIME_ROUTE_KINDS;

export const ALEMBIC_RESIDENT_SERVICE_OWNERS = ['alembic', 'alembic-plugin'] as const;

export const ALEMBIC_RESIDENT_SERVICE_SCOPE_KINDS = [
  'current-project',
  'workspace',
  'runtime-only',
  'unknown',
] as const;

export const ALEMBIC_RESIDENT_SERVICE_UNAVAILABLE_REASONS = [
  'not-installed',
  'not-running',
  'token-missing',
  'capability-unavailable',
  'route-unavailable',
  'request-timeout',
  'request-failed',
  'unsupported-route',
  'unknown',
] as const;

export const ALEMBIC_RESIDENT_FEATURES = [
  'status.health',
  'search.keyword',
  'search.semantic',
  'jobs.api-ai.bootstrap',
  'jobs.api-ai.rescan',
  'jobs.host-agent-recoverable.bootstrap',
  'jobs.host-agent-recoverable.rescan',
  'dashboard.handoff',
  'file-monitor.git-worktree',
] as const;

export const ALEMBIC_RESIDENT_API_AI_JOB_FEATURES = [
  'jobs.api-ai.bootstrap',
  'jobs.api-ai.rescan',
] as const;

export const ALEMBIC_RESIDENT_HOST_AGENT_RECOVERABLE_JOB_FEATURES = [
  'jobs.host-agent-recoverable.bootstrap',
  'jobs.host-agent-recoverable.rescan',
] as const;

export const ALEMBIC_RESIDENT_JOB_FEATURES = [
  ...ALEMBIC_RESIDENT_API_AI_JOB_FEATURES,
  ...ALEMBIC_RESIDENT_HOST_AGENT_RECOVERABLE_JOB_FEATURES,
] as const;

export const ALEMBIC_RESIDENT_SEARCH_MODES = ['auto', 'keyword', 'semantic'] as const;

export const ALEMBIC_RESIDENT_SEARCH_RESULT_MODES = [
  'keyword',
  'semantic',
  'hybrid',
  'baseline',
] as const;

export type AlembicResidentRouteKind = AlembicRuntimeRouteKind;
export type AlembicResidentServiceOwner = (typeof ALEMBIC_RESIDENT_SERVICE_OWNERS)[number];
export type AlembicResidentServiceScopeKind = (typeof ALEMBIC_RESIDENT_SERVICE_SCOPE_KINDS)[number];
export type AlembicResidentServiceUnavailableReason =
  (typeof ALEMBIC_RESIDENT_SERVICE_UNAVAILABLE_REASONS)[number];
export type AlembicResidentFeature = (typeof ALEMBIC_RESIDENT_FEATURES)[number];
export type AlembicResidentApiAiJobFeature = (typeof ALEMBIC_RESIDENT_API_AI_JOB_FEATURES)[number];
export type AlembicResidentHostAgentRecoverableJobFeature =
  (typeof ALEMBIC_RESIDENT_HOST_AGENT_RECOVERABLE_JOB_FEATURES)[number];
export type AlembicResidentJobFeature = (typeof ALEMBIC_RESIDENT_JOB_FEATURES)[number];
export type AlembicResidentJobFamily = 'api-ai' | 'host-agent-recoverable';
export type AlembicResidentJobOperation = 'bootstrap' | 'rescan';
export type AlembicResidentSearchMode = (typeof ALEMBIC_RESIDENT_SEARCH_MODES)[number];
export type AlembicResidentSearchResultMode = (typeof ALEMBIC_RESIDENT_SEARCH_RESULT_MODES)[number];

export type AlembicResidentProjectIdentitySummary = Pick<
  AlembicRuntimeProjectIdentitySummary,
  | 'dataRootSource'
  | 'projectId'
  | 'projectScope'
  | 'projectScopeId'
  | 'schemaMigrationVersion'
  | 'workspaceMode'
>;

export interface AlembicResidentDiagnosticPaths {
  controlRoot: string | null;
  databasePath: string | null;
  dataRoot: string | null;
  projectRoot: string | null;
  runtimeDir: string | null;
  statePath: string | null;
}

export interface AlembicResidentServiceScopeSummary {
  diagnosticPaths: AlembicResidentDiagnosticPaths;
  displayName: string | null;
  kind: AlembicResidentServiceScopeKind;
  projectIdentity: AlembicResidentProjectIdentitySummary;
  scopeId: string | null;
}

export interface AlembicResidentFeatureCapability {
  available: boolean;
  feature: AlembicResidentFeature;
  message: string | null;
  owner: AlembicResidentServiceOwner;
  route: AlembicResidentRouteKind;
  unavailableReason: AlembicResidentServiceUnavailableReason | null;
}

export type AlembicResidentCapabilities = Record<
  AlembicResidentFeature,
  AlembicResidentFeatureCapability
>;

export type AlembicResidentCapabilityOverrides = Partial<
  Record<AlembicResidentFeature, Partial<Omit<AlembicResidentFeatureCapability, 'feature'>>>
>;

export interface CreateAlembicResidentCapabilitiesOptions {
  defaultAvailable?: boolean;
  overrides?: AlembicResidentCapabilityOverrides;
  owner?: AlembicResidentServiceOwner;
  route?: AlembicResidentRouteKind;
  unavailableReason?: AlembicResidentServiceUnavailableReason;
}

export interface CreateAlembicResidentServiceStatusOptions {
  apiBaseUrl?: string | null;
  capabilityOverrides?: AlembicResidentCapabilityOverrides;
  defaultCapabilityAvailable?: boolean;
  healthPath?: string | null;
  message?: string | null;
  owner?: AlembicResidentServiceOwner;
  route?: AlembicResidentRouteKind;
  serviceScope?: unknown;
}

export interface AlembicResidentServiceStatus {
  apiBaseUrl: string | null;
  capabilities: AlembicResidentCapabilities;
  contractVersion: typeof ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION;
  healthPath: string;
  message: string | null;
  owner: AlembicResidentServiceOwner;
  route: AlembicResidentRouteKind;
  serviceScope: AlembicResidentServiceScopeSummary;
}

export interface AlembicResidentServiceStatusSummary {
  availableFeatures: AlembicResidentFeature[];
  contractVersion: typeof ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION;
  owner: AlembicResidentServiceOwner;
  route: AlembicResidentRouteKind;
  serviceScope: AlembicResidentServiceScopeSummary;
  unavailableFeatures: AlembicResidentFeature[];
  unavailableReasons: Partial<
    Record<AlembicResidentFeature, AlembicResidentServiceUnavailableReason>
  >;
}

export interface AlembicResidentServiceProbe {
  checkedAt: string;
  status: AlembicResidentServiceStatus;
  summary: AlembicResidentServiceStatusSummary;
}

export type AlembicResidentServiceResult<TValue> =
  | {
      ok: true;
      owner: AlembicResidentServiceOwner;
      route: AlembicResidentRouteKind;
      status?: AlembicResidentServiceStatus;
      telemetry?: Record<string, unknown>;
      value: TValue;
    }
  | {
      errorCode?: string;
      message: string;
      ok: false;
      owner: AlembicResidentServiceOwner;
      reason: AlembicResidentServiceUnavailableReason;
      retryable: boolean;
      route: AlembicResidentRouteKind;
      status?: AlembicResidentServiceStatus;
      telemetry?: Record<string, unknown>;
    };

export interface AlembicResidentSearchRequest {
  diagnosticProjectRoot?: string | null;
  limit?: number;
  mode?: AlembicResidentSearchMode;
  query: string;
  serviceScopeId?: string | null;
  traceId?: string;
}

export interface AlembicResidentSearchResultItem {
  id: string;
  kind: string | null;
  metadata?: Record<string, unknown>;
  score: number | null;
  source: string | null;
  title: string | null;
}

export interface AlembicResidentSearchResponse {
  degradedReason: string | null;
  mode: AlembicResidentSearchResultMode;
  results: AlembicResidentSearchResultItem[];
  telemetry?: Record<string, unknown>;
}

export interface AlembicResidentJobRequest {
  diagnosticProjectRoot?: string | null;
  feature: AlembicResidentJobFeature;
  force?: boolean;
  reason?: string | null;
  serviceScopeId?: string | null;
  traceId?: string;
}

export interface AlembicResidentJobResponse {
  feature: AlembicResidentJobFeature;
  jobId: string;
  owner: AlembicResidentServiceOwner;
  route: AlembicResidentRouteKind;
  status: DaemonJobStatus;
}

export type AlembicResidentJobSubmitRequest = AlembicResidentJobRequest;
export type AlembicResidentJobSubmitResponse = AlembicResidentJobResponse;

export interface AlembicResidentJobListRequest {
  feature?: AlembicResidentJobFeature;
  limit?: number;
  status?: DaemonJobStatus;
}

export type AlembicResidentJobReadRequest = AlembicResidentJobListRequest;
export type AlembicResidentJobReadResponse =
  | AlembicResidentJobResponse
  | AlembicResidentJobResponse[];

export interface AlembicResidentDashboardHandoffRequest {
  diagnosticProjectRoot?: string | null;
  serviceScopeId?: string | null;
  traceId?: string;
}

export interface AlembicResidentDashboardHandoffResponse {
  available: boolean;
  message: string | null;
  owner: AlembicResidentServiceOwner;
  route: AlembicResidentRouteKind;
  unavailableReason: AlembicResidentServiceUnavailableReason | null;
  url: string | null;
}

export type AlembicResidentDashboardHandoff = AlembicResidentDashboardHandoffResponse;

export function createAlembicResidentFeatureCapability(
  feature: AlembicResidentFeature,
  options: Partial<Omit<AlembicResidentFeatureCapability, 'feature'>> = {}
): AlembicResidentFeatureCapability {
  const route = options.route ?? 'unavailable';
  const owner = options.owner ?? resolveAlembicResidentFeatureOwner(feature, route);
  const available = options.available ?? false;
  return {
    available,
    feature,
    message: options.message ?? null,
    owner,
    route,
    unavailableReason: available
      ? null
      : (options.unavailableReason ?? defaultUnavailableReasonForRoute(route)),
  };
}

export function createAlembicResidentCapabilities(
  options: CreateAlembicResidentCapabilitiesOptions = {}
): AlembicResidentCapabilities {
  const route = options.route ?? 'unavailable';
  const owner = options.owner ?? resolveAlembicResidentRouteOwner(route);
  const capabilities = {} as AlembicResidentCapabilities;

  for (const feature of ALEMBIC_RESIDENT_FEATURES) {
    const override = options.overrides?.[feature] ?? {};
    const defaultAvailable = options.defaultAvailable ?? false;
    capabilities[feature] = createAlembicResidentFeatureCapability(feature, {
      available: defaultAvailable,
      owner: resolveAlembicResidentFeatureOwner(feature, route, owner),
      route,
      unavailableReason: options.unavailableReason,
      ...override,
    });
  }

  return capabilities;
}

export function createAlembicResidentServiceStatus(
  options: CreateAlembicResidentServiceStatusOptions = {}
): AlembicResidentServiceStatus {
  const route = options.route ?? 'unavailable';
  const owner = options.owner ?? resolveAlembicResidentRouteOwner(route);
  return {
    apiBaseUrl: options.apiBaseUrl ?? null,
    capabilities: createAlembicResidentCapabilities({
      defaultAvailable: options.defaultCapabilityAvailable ?? false,
      overrides: options.capabilityOverrides,
      owner,
      route,
    }),
    contractVersion: ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION,
    healthPath: options.healthPath ?? ALEMBIC_RUNTIME_HEALTH_PATH,
    message: options.message ?? null,
    owner,
    route,
    serviceScope: normalizeAlembicResidentServiceScopeSummary(options.serviceScope),
  };
}

export function normalizeAlembicResidentServiceStatus(
  value: unknown
): AlembicResidentServiceStatus {
  const status = asRecord(value);
  const route = normalizeAlembicResidentRouteKind(status?.route) ?? 'unavailable';
  const owner =
    normalizeAlembicResidentServiceOwner(status?.owner) ?? resolveAlembicResidentRouteOwner(route);
  return {
    apiBaseUrl: nullableString(status?.apiBaseUrl ?? status?.baseUrl),
    capabilities: normalizeAlembicResidentCapabilities(status?.capabilities, route, owner),
    contractVersion: ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION,
    healthPath: firstString(status?.healthPath, ALEMBIC_RUNTIME_HEALTH_PATH),
    message: nullableString(status?.message),
    owner,
    route,
    serviceScope: normalizeAlembicResidentServiceScopeSummary(status?.serviceScope ?? status),
  };
}

export function normalizeAlembicResidentCapabilities(
  value: unknown,
  route: AlembicResidentRouteKind = 'unavailable',
  owner: AlembicResidentServiceOwner = resolveAlembicResidentRouteOwner(route)
): AlembicResidentCapabilities {
  const capabilitiesInput = asRecord(value);
  const capabilities = {} as AlembicResidentCapabilities;

  for (const feature of ALEMBIC_RESIDENT_FEATURES) {
    const rawCapability = asRecord(capabilitiesInput?.[feature]);
    const available = booleanOrFalse(rawCapability?.available);
    capabilities[feature] = createAlembicResidentFeatureCapability(feature, {
      available,
      message: nullableString(rawCapability?.message),
      owner:
        normalizeAlembicResidentServiceOwner(rawCapability?.owner) ??
        resolveAlembicResidentFeatureOwner(feature, route, owner),
      route: normalizeAlembicResidentRouteKind(rawCapability?.route) ?? route,
      unavailableReason: normalizeAlembicResidentServiceUnavailableReason(
        rawCapability?.unavailableReason
      ),
    });
  }

  return capabilities;
}

export function normalizeAlembicResidentServiceScopeSummary(
  value: unknown
): AlembicResidentServiceScopeSummary {
  const scope = asRecord(value);
  const projectIdentity = toResidentProjectIdentity(scope?.projectIdentity ?? scope);
  const diagnosticPaths = normalizeAlembicResidentDiagnosticPaths(scope?.diagnosticPaths ?? scope);
  return {
    // serviceScope 只描述当前服务覆盖范围；路径保留在 diagnosticPaths，不能作为项目切换身份。
    diagnosticPaths,
    displayName: nullableString(scope?.displayName),
    kind:
      normalizeAlembicResidentServiceScopeKind(scope?.kind) ??
      inferServiceScopeKind(projectIdentity, diagnosticPaths),
    projectIdentity,
    scopeId: nullableString(scope?.scopeId),
  };
}

export function normalizeAlembicResidentDiagnosticPaths(
  value: unknown
): AlembicResidentDiagnosticPaths {
  const paths = asRecord(value);
  return {
    databasePath: nullableString(paths?.databasePath),
    controlRoot: nullableString(paths?.controlRoot),
    dataRoot: nullableString(paths?.dataRoot),
    projectRoot: nullableString(paths?.projectRoot),
    runtimeDir: nullableString(paths?.runtimeDir),
    statePath: nullableString(paths?.statePath),
  };
}

export function summarizeAlembicResidentServiceStatus(
  status: AlembicResidentServiceStatus
): AlembicResidentServiceStatusSummary {
  const availableFeatures: AlembicResidentFeature[] = [];
  const unavailableFeatures: AlembicResidentFeature[] = [];
  const unavailableReasons: Partial<
    Record<AlembicResidentFeature, AlembicResidentServiceUnavailableReason>
  > = {};

  for (const feature of ALEMBIC_RESIDENT_FEATURES) {
    const capability = status.capabilities[feature];
    if (capability.available) {
      availableFeatures.push(feature);
    } else {
      unavailableFeatures.push(feature);
      if (capability.unavailableReason) {
        unavailableReasons[feature] = capability.unavailableReason;
      }
    }
  }

  return {
    availableFeatures,
    contractVersion: status.contractVersion,
    owner: status.owner,
    route: status.route,
    serviceScope: status.serviceScope,
    unavailableFeatures,
    unavailableReasons,
  };
}

export function createAlembicResidentServiceProbe(
  status: AlembicResidentServiceStatus,
  checkedAt: string
): AlembicResidentServiceProbe {
  return {
    checkedAt,
    status,
    summary: summarizeAlembicResidentServiceStatus(status),
  };
}

export function createAlembicResidentServiceSuccess<TValue>(
  value: TValue,
  status: AlembicResidentServiceStatus,
  telemetry?: Record<string, unknown>
): AlembicResidentServiceResult<TValue> {
  return {
    ok: true,
    owner: status.owner,
    route: status.route,
    status,
    telemetry,
    value,
  };
}

export function createAlembicResidentServiceUnavailable<TValue>(
  status: AlembicResidentServiceStatus,
  reason: AlembicResidentServiceUnavailableReason,
  message: string,
  options: {
    errorCode?: string;
    retryable?: boolean;
    telemetry?: Record<string, unknown>;
  } = {}
): AlembicResidentServiceResult<TValue> {
  return {
    errorCode: options.errorCode,
    message,
    ok: false,
    owner: status.owner,
    reason,
    retryable: options.retryable ?? false,
    route: status.route,
    status,
    telemetry: options.telemetry,
  };
}

export function classifyAlembicResidentJobFeature(
  feature: unknown
): AlembicResidentJobFamily | null {
  if (isAlembicResidentApiAiJobFeature(feature)) {
    return 'api-ai';
  }
  if (isAlembicResidentHostAgentRecoverableJobFeature(feature)) {
    return 'host-agent-recoverable';
  }
  return null;
}

export function getAlembicResidentJobOperation(
  feature: AlembicResidentJobFeature
): AlembicResidentJobOperation {
  return feature.endsWith('.bootstrap') ? 'bootstrap' : 'rescan';
}

export function resolveAlembicResidentRouteOwner(
  route: AlembicResidentRouteKind
): AlembicResidentServiceOwner {
  switch (route) {
    case 'local-alembic-daemon':
    case 'local-alembic-install':
      return 'alembic';
    case 'embedded-plugin-runtime':
    case 'unavailable':
      return 'alembic-plugin';
  }
}

export function resolveAlembicResidentFeatureOwner(
  feature: AlembicResidentFeature,
  route: AlembicResidentRouteKind = 'unavailable',
  fallbackOwner: AlembicResidentServiceOwner = resolveAlembicResidentRouteOwner(route)
): AlembicResidentServiceOwner {
  const family = classifyAlembicResidentJobFeature(feature);
  if (family === 'api-ai') {
    return 'alembic';
  }
  if (family === 'host-agent-recoverable') {
    return 'alembic-plugin';
  }
  return fallbackOwner;
}

export function isAlembicResidentRouteKind(value: unknown): value is AlembicResidentRouteKind {
  return normalizeAlembicRuntimeRouteKind(value) !== null;
}

export function normalizeAlembicResidentRouteKind(value: unknown): AlembicResidentRouteKind | null {
  return normalizeAlembicRuntimeRouteKind(value);
}

export function isAlembicResidentServiceOwner(
  value: unknown
): value is AlembicResidentServiceOwner {
  return typeof value === 'string' && ALEMBIC_RESIDENT_SERVICE_OWNERS.includes(value as never);
}

export function normalizeAlembicResidentServiceOwner(
  value: unknown
): AlembicResidentServiceOwner | null {
  return isAlembicResidentServiceOwner(value) ? value : null;
}

export function isAlembicResidentServiceScopeKind(
  value: unknown
): value is AlembicResidentServiceScopeKind {
  return typeof value === 'string' && ALEMBIC_RESIDENT_SERVICE_SCOPE_KINDS.includes(value as never);
}

export function normalizeAlembicResidentServiceScopeKind(
  value: unknown
): AlembicResidentServiceScopeKind | null {
  return isAlembicResidentServiceScopeKind(value) ? value : null;
}

export function isAlembicResidentServiceUnavailableReason(
  value: unknown
): value is AlembicResidentServiceUnavailableReason {
  return (
    typeof value === 'string' &&
    ALEMBIC_RESIDENT_SERVICE_UNAVAILABLE_REASONS.includes(value as never)
  );
}

export function normalizeAlembicResidentServiceUnavailableReason(
  value: unknown
): AlembicResidentServiceUnavailableReason | null {
  return isAlembicResidentServiceUnavailableReason(value) ? value : null;
}

export function isAlembicResidentFeature(value: unknown): value is AlembicResidentFeature {
  return typeof value === 'string' && ALEMBIC_RESIDENT_FEATURES.includes(value as never);
}

export function normalizeAlembicResidentFeature(value: unknown): AlembicResidentFeature | null {
  return isAlembicResidentFeature(value) ? value : null;
}

export function isAlembicResidentJobFeature(value: unknown): value is AlembicResidentJobFeature {
  return typeof value === 'string' && ALEMBIC_RESIDENT_JOB_FEATURES.includes(value as never);
}

export function isAlembicResidentApiAiJobFeature(
  value: unknown
): value is AlembicResidentApiAiJobFeature {
  return typeof value === 'string' && ALEMBIC_RESIDENT_API_AI_JOB_FEATURES.includes(value as never);
}

export function isAlembicResidentHostAgentRecoverableJobFeature(
  value: unknown
): value is AlembicResidentHostAgentRecoverableJobFeature {
  return (
    typeof value === 'string' &&
    ALEMBIC_RESIDENT_HOST_AGENT_RECOVERABLE_JOB_FEATURES.includes(value as never)
  );
}

function toResidentProjectIdentity(value: unknown): AlembicResidentProjectIdentitySummary {
  const identity = summarizeAlembicRuntimeProjectIdentity(value);
  return {
    dataRootSource: identity.dataRootSource,
    projectId: identity.projectId,
    projectScope: identity.projectScope,
    projectScopeId: identity.projectScopeId,
    schemaMigrationVersion: identity.schemaMigrationVersion,
    workspaceMode: identity.workspaceMode,
  };
}

function inferServiceScopeKind(
  identity: AlembicResidentProjectIdentitySummary,
  diagnosticPaths: AlembicResidentDiagnosticPaths
): AlembicResidentServiceScopeKind {
  if (identity.projectId || diagnosticPaths.projectRoot) {
    return 'current-project';
  }
  if (diagnosticPaths.dataRoot || diagnosticPaths.runtimeDir) {
    return 'runtime-only';
  }
  return 'unknown';
}

function defaultUnavailableReasonForRoute(
  route: AlembicResidentRouteKind
): AlembicResidentServiceUnavailableReason {
  return route === 'unavailable' ? 'route-unavailable' : 'capability-unavailable';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function booleanOrFalse(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return ALEMBIC_RUNTIME_HEALTH_PATH;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

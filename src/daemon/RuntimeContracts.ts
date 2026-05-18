import {
  type CanonicalFileChangeEventSource,
  HOST_EDIT_SOURCE,
  LEGACY_IDE_EDIT_SOURCE,
} from '../shared/source-contracts.js';

export const ALEMBIC_RUNTIME_API_VERSION = 'v1';
export const ALEMBIC_RUNTIME_PACKAGE_NAME = 'alembic-ai';
export const ALEMBIC_RUNTIME_HEALTH_PATH = '/api/v1/daemon/health';
export const ALEMBIC_FILE_CHANGES_PATH = '/api/v1/file-changes';

export const ALEMBIC_RUNTIME_ROUTE_KINDS = [
  'local-alembic-daemon',
  'embedded-plugin-runtime',
  'local-alembic-install',
  'unavailable',
] as const;

export const ALEMBIC_FILE_MONITOR_MODES = [
  'daemon-git-worktree',
  'host-event-bridge',
  'embedded-runtime-adapter',
  'disabled',
] as const;

export const ALEMBIC_JOB_KINDS = ['bootstrap', 'rescan'] as const;

export const ALEMBIC_JOB_ENDPOINTS = {
  bootstrap: '/api/v1/jobs/bootstrap',
  list: '/api/v1/jobs',
  rescan: '/api/v1/jobs/rescan',
} as const;

export const ALEMBIC_FILE_MONITOR_EVENT_SOURCES = [
  HOST_EDIT_SOURCE,
  'git-head',
  'git-worktree',
] as const satisfies readonly CanonicalFileChangeEventSource[];

export const ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES = {
  [LEGACY_IDE_EDIT_SOURCE]: HOST_EDIT_SOURCE,
} as const satisfies Readonly<Record<string, CanonicalFileChangeEventSource>>;

export type AlembicRuntimeMode = 'api' | 'daemon';
export type AlembicRuntimeRouteKind = (typeof ALEMBIC_RUNTIME_ROUTE_KINDS)[number];
export type AlembicEnhancementRoute = 'local-alembic';
export type AlembicFileMonitorMode = (typeof ALEMBIC_FILE_MONITOR_MODES)[number];
export type AlembicJobKind = (typeof ALEMBIC_JOB_KINDS)[number];
export type AlembicInternalAiConfigSource =
  | 'empty'
  | 'process-env'
  | 'runtime-overrides'
  | 'workspace-settings';

export interface AlembicRuntimeProjectIdentity {
  dataRoot: string;
  databasePath?: string;
  projectId: string | null;
  projectRoot: string;
  schemaMigrationVersion?: string | null;
}

export interface AlembicRuntimeEnhancementIdentity {
  apiVersion: typeof ALEMBIC_RUNTIME_API_VERSION;
  packageName: string;
  route: AlembicEnhancementRoute;
  version: string;
}

export interface AlembicApiCapability {
  available: boolean;
  baseUrl: string | null;
  healthPath: typeof ALEMBIC_RUNTIME_HEALTH_PATH | string;
}

export interface AlembicDashboardCapability {
  available: boolean;
  url: string | null;
}

export interface AlembicFileMonitorCapability {
  acceptedEventSources: CanonicalFileChangeEventSource[];
  available: boolean;
  compatibilityAliases: Partial<Record<string, CanonicalFileChangeEventSource>>;
  endpoint: typeof ALEMBIC_FILE_CHANGES_PATH | string | null;
  mode: AlembicFileMonitorMode;
}

export interface AlembicInternalAiCapability {
  available: boolean;
  configSource: AlembicInternalAiConfigSource;
  model: string | null;
  provider: string | null;
}

export interface AlembicJobsCapability {
  available: boolean;
  endpoints: {
    bootstrap?: string;
    list?: string;
    rescan?: string;
  };
  kinds: AlembicJobKind[];
}

export interface AlembicRuntimeCapabilities {
  api: AlembicApiCapability;
  dashboard: AlembicDashboardCapability;
  fileMonitor: AlembicFileMonitorCapability;
  internalAi: AlembicInternalAiCapability;
  jobs: AlembicJobsCapability;
}

export interface AlembicRuntimeHealthData extends AlembicRuntimeProjectIdentity {
  capabilities: AlembicRuntimeCapabilities;
  dashboardUrl: string | null;
  enhancement: AlembicRuntimeEnhancementIdentity;
  mode: AlembicRuntimeMode;
  pid?: number;
  uptime?: number;
  version: string;
}

export interface CreateAlembicRuntimeCapabilitiesOptions {
  apiAvailable?: boolean;
  apiBaseUrl: string | null;
  dashboardAvailable: boolean;
  dashboardUrl: string | null;
  fileMonitorAvailable?: boolean;
  fileMonitorEndpoint?: string | null;
  fileMonitorMode?: AlembicFileMonitorMode;
  internalAi: AlembicInternalAiCapability;
  jobEndpoints?: Partial<Record<keyof typeof ALEMBIC_JOB_ENDPOINTS, string>>;
  jobKinds?: readonly AlembicJobKind[];
  jobsAvailable?: boolean;
}

export interface CreateAlembicRuntimeHealthDataOptions extends AlembicRuntimeProjectIdentity {
  capabilities: AlembicRuntimeCapabilities;
  dashboardUrl?: string | null;
  enhancement?: Partial<AlembicRuntimeEnhancementIdentity>;
  mode: AlembicRuntimeMode;
  pid?: number;
  uptime?: number;
  version: string;
}

export interface AlembicRuntimeCapabilitySummary {
  apiAvailable: boolean | null;
  dashboardAvailable: boolean | null;
  dashboardUrl: string | null;
  fileMonitorAvailable: boolean | null;
  fileMonitorMode: AlembicFileMonitorMode | null;
  internalAiAvailable: boolean | null;
  jobsAvailable: boolean | null;
  jobKinds: string[];
}

export function createAlembicRuntimeCapabilities(
  options: CreateAlembicRuntimeCapabilitiesOptions
): AlembicRuntimeCapabilities {
  const jobKinds = [...(options.jobKinds ?? ALEMBIC_JOB_KINDS)];

  return {
    api: {
      available: options.apiAvailable ?? true,
      baseUrl: options.apiBaseUrl,
      healthPath: ALEMBIC_RUNTIME_HEALTH_PATH,
    },
    dashboard: {
      available: options.dashboardAvailable,
      url: options.dashboardUrl,
    },
    fileMonitor: {
      acceptedEventSources: [...ALEMBIC_FILE_MONITOR_EVENT_SOURCES],
      available: options.fileMonitorAvailable ?? false,
      compatibilityAliases: { ...ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES },
      endpoint: options.fileMonitorEndpoint ?? ALEMBIC_FILE_CHANGES_PATH,
      mode: options.fileMonitorMode ?? 'disabled',
    },
    internalAi: options.internalAi,
    jobs: {
      available: options.jobsAvailable ?? true,
      endpoints: {
        ...ALEMBIC_JOB_ENDPOINTS,
        ...options.jobEndpoints,
      },
      kinds: jobKinds,
    },
  };
}

export function createAlembicRuntimeHealthData(
  options: CreateAlembicRuntimeHealthDataOptions
): AlembicRuntimeHealthData {
  return {
    capabilities: options.capabilities,
    dashboardUrl: options.dashboardUrl ?? null,
    dataRoot: options.dataRoot,
    databasePath: options.databasePath,
    enhancement: createAlembicRuntimeEnhancementIdentity({
      version: options.version,
      ...options.enhancement,
    }),
    mode: options.mode,
    pid: options.pid,
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    schemaMigrationVersion: options.schemaMigrationVersion ?? null,
    uptime: options.uptime,
    version: options.version,
  };
}

export function createAlembicRuntimeEnhancementIdentity(input: {
  apiVersion?: typeof ALEMBIC_RUNTIME_API_VERSION;
  packageName?: string;
  route?: AlembicEnhancementRoute;
  version: string;
}): AlembicRuntimeEnhancementIdentity {
  return {
    apiVersion: input.apiVersion ?? ALEMBIC_RUNTIME_API_VERSION,
    packageName: input.packageName ?? ALEMBIC_RUNTIME_PACKAGE_NAME,
    route: input.route ?? 'local-alembic',
    version: input.version,
  };
}

export function summarizeAlembicRuntimeCapabilities(
  value: unknown
): AlembicRuntimeCapabilitySummary {
  const capabilities = asRecord(value);
  const api = asRecord(capabilities?.api);
  const dashboard = asRecord(capabilities?.dashboard);
  const fileMonitor = asRecord(capabilities?.fileMonitor);
  const internalAi = asRecord(capabilities?.internalAi);
  const jobs = asRecord(capabilities?.jobs);

  return {
    apiAvailable: booleanOrNull(api?.available),
    dashboardAvailable: booleanOrNull(dashboard?.available),
    dashboardUrl: firstString(dashboard?.url),
    fileMonitorAvailable: booleanOrNull(fileMonitor?.available),
    fileMonitorMode: normalizeAlembicFileMonitorMode(fileMonitor?.mode),
    internalAiAvailable: booleanOrNull(internalAi?.available),
    jobsAvailable: booleanOrNull(jobs?.available),
    jobKinds: stringArray(jobs?.kinds),
  };
}

export function isAlembicRuntimeRouteKind(value: unknown): value is AlembicRuntimeRouteKind {
  return typeof value === 'string' && ALEMBIC_RUNTIME_ROUTE_KINDS.includes(value as never);
}

export function normalizeAlembicRuntimeRouteKind(value: unknown): AlembicRuntimeRouteKind | null {
  return isAlembicRuntimeRouteKind(value) ? value : null;
}

export function isAlembicFileMonitorMode(value: unknown): value is AlembicFileMonitorMode {
  return typeof value === 'string' && ALEMBIC_FILE_MONITOR_MODES.includes(value as never);
}

export function normalizeAlembicFileMonitorMode(value: unknown): AlembicFileMonitorMode | null {
  return isAlembicFileMonitorMode(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

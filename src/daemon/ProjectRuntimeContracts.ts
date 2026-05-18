import type { WorkspaceMode } from '../shared/ProjectRegistry.js';
import type { DaemonJobStatus } from './JobStore.js';
import type { AlembicRuntimeDataRootSource } from './RuntimeContracts.js';

export const PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION = 1;

export const PROJECT_CONNECTION_STATES = [
  'ready',
  'stopped',
  'starting',
  'stale',
  'failed',
  'missing',
  'unavailable',
] as const;

export const PROJECT_RUNTIME_DAEMON_STATUSES = [
  'ready',
  'starting',
  'stopped',
  'stale',
  'failed',
  'not-checked',
] as const;

export const PROJECT_RUNTIME_INTERNAL_AI_CONFIG_SOURCES = [
  'empty',
  'process-env',
  'workspace-settings',
  'unavailable',
] as const;

export type ProjectConnectionState = (typeof PROJECT_CONNECTION_STATES)[number];
export type ProjectRuntimeDaemonStatus = (typeof PROJECT_RUNTIME_DAEMON_STATUSES)[number];
export type ProjectRuntimeInternalAiConfigSource =
  (typeof PROJECT_RUNTIME_INTERNAL_AI_CONFIG_SOURCES)[number];

export type ProjectRuntimeTarget =
  | { projectId: string; projectRoot?: never }
  | { projectId?: never; projectRoot: string };

export interface ProjectRuntimeControlState {
  activeProjectId: string | null;
  activeProjectRoot: string | null;
  schemaVersion: typeof PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION;
  selectedAt: string | null;
  selectedProjectId: string | null;
  selectedProjectRoot: string | null;
  updatedAt: string;
}

export interface CreateProjectRuntimeControlStateOptions {
  activeProjectId?: string | null;
  activeProjectRoot?: string | null;
  selectedAt?: string | null;
  selectedProjectId?: string | null;
  selectedProjectRoot?: string | null;
  updatedAt?: string;
}

export interface ProjectRuntimeJobsSummary {
  active: number;
  byStatus: Partial<Record<DaemonJobStatus, number>>;
  jobsDir: string;
  latestJobId: string | null;
  latestUpdatedAt: string | null;
  total: number;
}

export interface ProjectRuntimeFileMonitorSummary {
  acceptedEventSources: string[];
  available: boolean;
  endpoint: string | null;
  mode: string;
}

export interface ProjectRuntimeInternalAiSummary {
  available: boolean;
  configSource: ProjectRuntimeInternalAiConfigSource;
  model: string | null;
  provider: string | null;
}

export interface ProjectRuntimeDaemonSummary {
  dashboardUrl: string | null;
  logPath: string;
  message: string | null;
  pid: number | null;
  pidAlive: boolean;
  ready: boolean;
  statePath: string;
  status: ProjectRuntimeDaemonStatus;
  url: string | null;
}

export interface ProjectRuntimeFlags {
  activeRuntime: boolean;
  missing: boolean;
  selected: boolean;
  stale: boolean;
  unavailable: boolean;
}

export interface ProjectRuntimeRegistrySummary {
  createdAt: string | null;
  id: string | null;
}

export interface ProjectRuntimeScopeOwnerSummary {
  controlPlaneOwner: 'alembic';
  daemonOwner: 'per-project-daemon';
  jobStoreOwner: '@alembic/core/daemon/JobStore';
  runtimeOwner: 'alembic';
}

export interface ProjectRuntimeScopeSummary {
  cacheKey: string;
  daemon: ProjectRuntimeDaemonSummary;
  dashboardUrl: string | null;
  dataRoot: string;
  dataRootSource: AlembicRuntimeDataRootSource;
  databasePath: string;
  displayName: string;
  fileMonitor: ProjectRuntimeFileMonitorSummary;
  flags: ProjectRuntimeFlags;
  ghost: boolean;
  initializedBy: 'project-registry';
  internalAi: ProjectRuntimeInternalAiSummary;
  jobs: ProjectRuntimeJobsSummary;
  mode: WorkspaceMode;
  projectExists: boolean;
  projectId: string | null;
  projectRealpath: string;
  projectRoot: string;
  registered: boolean;
  registry: ProjectRuntimeRegistrySummary;
  runtimeDir: string;
  scope: ProjectRuntimeScopeOwnerSummary;
  status: ProjectConnectionState;
  workspaceExists: boolean;
}

export interface ProjectRuntimeControlSnapshot {
  activeRuntimeProject: ProjectRuntimeScopeSummary | null;
  generatedAt: string;
  projects: ProjectRuntimeScopeSummary[];
  selectedProject: ProjectRuntimeScopeSummary | null;
  state: ProjectRuntimeControlState;
}

export function createProjectRuntimeControlState(
  options: CreateProjectRuntimeControlStateOptions = {}
): ProjectRuntimeControlState {
  const updatedAt = options.updatedAt ?? new Date(0).toISOString();
  return {
    activeProjectId: options.activeProjectId ?? null,
    activeProjectRoot: options.activeProjectRoot ?? null,
    schemaVersion: PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION,
    selectedAt: options.selectedAt ?? null,
    selectedProjectId: options.selectedProjectId ?? null,
    selectedProjectRoot: options.selectedProjectRoot ?? null,
    updatedAt,
  };
}

export function isProjectConnectionState(value: unknown): value is ProjectConnectionState {
  return typeof value === 'string' && PROJECT_CONNECTION_STATES.includes(value as never);
}

export function normalizeProjectConnectionState(value: unknown): ProjectConnectionState | null {
  return isProjectConnectionState(value) ? value : null;
}

export function isProjectRuntimeTarget(value: unknown): value is ProjectRuntimeTarget {
  const target = asRecord(value);
  if (!target) {
    return false;
  }
  const hasProjectId = isNonEmptyString(target.projectId);
  const hasProjectRoot = isNonEmptyString(target.projectRoot);
  // 目标解析必须是 projectId / projectRoot 二选一，避免下游 route 猜测优先级。
  return hasProjectId !== hasProjectRoot;
}

export function hasSelectedProjectRuntime(state: ProjectRuntimeControlState): boolean {
  return isNonEmptyString(state.selectedProjectId) || isNonEmptyString(state.selectedProjectRoot);
}

export function hasActiveProjectRuntime(state: ProjectRuntimeControlState): boolean {
  return isNonEmptyString(state.activeProjectId) || isNonEmptyString(state.activeProjectRoot);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

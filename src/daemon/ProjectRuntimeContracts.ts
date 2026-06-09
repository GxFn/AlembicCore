import type {
  CoreFieldPolicy,
  CoreFieldPolicySummary,
  CoreFieldPolicyValidationResult,
} from '../shared/FieldTaxonomy.js';
import { summarizeCoreFieldPolicies, validateCoreFieldPolicies } from '../shared/FieldTaxonomy.js';
import type { WorkspaceMode } from '../shared/ProjectRegistry.js';
import type { ProjectScopeSummary } from '../shared/ProjectScope.js';
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

export const PROJECT_RUNTIME_API_AI_CONFIG_SOURCES = [
  'empty',
  'process-env',
  'workspace-settings',
  'unavailable',
] as const;

export const PROJECT_RUNTIME_CONTRACT_VERSION = 1;

export const PROJECT_RUNTIME_REQUIRED_SERVICES = [
  'project-identity',
  'project-scope',
  'daemon',
  'jobs',
  'api-ai',
  'dashboard',
  'file-monitor',
] as const;

export const PROJECT_RUNTIME_DEFAULT_REQUIRED_SERVICES = ['project-identity'] as const;

export const PROJECT_RUNTIME_READINESS_STATES = ['ready', 'degraded', 'blocked'] as const;

export const PROJECT_RUNTIME_FAILURE_SEVERITIES = ['info', 'warning', 'error'] as const;

export const PROJECT_RUNTIME_FAILURE_REASONS = [
  'project-identity-missing',
  'project-not-registered',
  'project-scope-unavailable',
  'daemon-not-checked',
  'daemon-starting',
  'daemon-stale',
  'daemon-failed',
  'daemon-missing',
  'daemon-unavailable',
  'jobs-unavailable',
  'api-ai-unavailable',
  'dashboard-unavailable',
  'file-monitor-unavailable',
  'runtime-unavailable',
] as const;

export type ProjectConnectionState = (typeof PROJECT_CONNECTION_STATES)[number];
export type ProjectRuntimeDaemonStatus = (typeof PROJECT_RUNTIME_DAEMON_STATUSES)[number];
export type ProjectRuntimeApiAiConfigSource =
  (typeof PROJECT_RUNTIME_API_AI_CONFIG_SOURCES)[number];
export type ProjectRuntimeRequiredService = (typeof PROJECT_RUNTIME_REQUIRED_SERVICES)[number];
export type ProjectRuntimeReadinessState = (typeof PROJECT_RUNTIME_READINESS_STATES)[number];
export type ProjectRuntimeFailureSeverity = (typeof PROJECT_RUNTIME_FAILURE_SEVERITIES)[number];
export type ProjectRuntimeFailureReason = (typeof PROJECT_RUNTIME_FAILURE_REASONS)[number];

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

export interface ProjectRuntimeIdentityContract {
  contractVersion: typeof PROJECT_RUNTIME_CONTRACT_VERSION;
  currentFolderId: string | null;
  dataRoot: string | null;
  dataRootSource: AlembicRuntimeDataRootSource | null;
  databasePath: string | null;
  ghost: boolean | null;
  mode: WorkspaceMode | null;
  projectExists: boolean | null;
  projectId: string | null;
  projectRealpath: string | null;
  projectRoot: string | null;
  projectScope: ProjectScopeSummary | null;
  projectScopeId: string | null;
  registered: boolean | null;
  runtimeDir: string | null;
  workspaceExists: boolean | null;
}

export interface CreateProjectRuntimeIdentityContractOptions {
  currentFolderId?: string | null;
  dataRoot?: string | null;
  dataRootSource?: AlembicRuntimeDataRootSource | null;
  databasePath?: string | null;
  ghost?: boolean | null;
  mode?: WorkspaceMode | null;
  projectExists?: boolean | null;
  projectId?: string | null;
  projectRealpath?: string | null;
  projectRoot?: string | null;
  projectScope?: ProjectScopeSummary | null;
  projectScopeId?: string | null;
  registered?: boolean | null;
  runtimeDir?: string | null;
  workspaceExists?: boolean | null;
}

export interface ProjectRuntimeServiceReadiness {
  available: boolean;
  message: string | null;
  reason: ProjectRuntimeFailureReason | null;
  required: boolean;
  service: ProjectRuntimeRequiredService;
  source: string | null;
  state: ProjectRuntimeReadinessState;
}

export interface CreateProjectRuntimeServiceReadinessOptions {
  available: boolean;
  message?: string | null;
  reason?: ProjectRuntimeFailureReason | null;
  required?: boolean;
  service: ProjectRuntimeRequiredService;
  source?: string | null;
}

export interface ProjectRuntimeFailureEnvelope {
  contractVersion: typeof PROJECT_RUNTIME_CONTRACT_VERSION;
  identity: ProjectRuntimeIdentityContract | null;
  message: string;
  reason: ProjectRuntimeFailureReason;
  readinessState: ProjectRuntimeReadinessState;
  service: ProjectRuntimeRequiredService | null;
  severity: ProjectRuntimeFailureSeverity;
  source: string | null;
}

export interface CreateProjectRuntimeFailureEnvelopeOptions {
  identity?: ProjectRuntimeIdentityContract | null;
  message?: string | null;
  reason: ProjectRuntimeFailureReason;
  readinessState?: ProjectRuntimeReadinessState;
  service?: ProjectRuntimeRequiredService | null;
  severity?: ProjectRuntimeFailureSeverity;
  source?: string | null;
}

export interface ProjectRuntimeReadinessSummary {
  contractVersion: typeof PROJECT_RUNTIME_CONTRACT_VERSION;
  failureEnvelopes: ProjectRuntimeFailureEnvelope[];
  identity: ProjectRuntimeIdentityContract | null;
  requiredServices: ProjectRuntimeServiceReadiness[];
  state: ProjectRuntimeReadinessState;
}

export interface SummarizeProjectRuntimeScopeReadinessOptions {
  includeOptionalServices?: boolean;
  requiredServices?: readonly ProjectRuntimeRequiredService[];
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

export interface ProjectRuntimeApiAiSummary {
  available: boolean;
  configSource: ProjectRuntimeApiAiConfigSource;
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
  apiAi: ProjectRuntimeApiAiSummary;
  jobs: ProjectRuntimeJobsSummary;
  mode: WorkspaceMode;
  projectExists: boolean;
  projectId: string | null;
  projectRealpath: string;
  projectRoot: string;
  projectScope?: ProjectScopeSummary | null;
  projectScopeId?: string | null;
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

export type ProjectRuntimeFieldPolicyContract =
  | 'ProjectRuntimeTarget'
  | 'ProjectRuntimeIdentityContract'
  | 'ProjectRuntimeFailureEnvelope'
  | 'ProjectRuntimeReadinessSummary'
  | 'ProjectRuntimeScopeSummary';

export interface ProjectRuntimeFieldPolicy extends CoreFieldPolicy {
  contract: ProjectRuntimeFieldPolicyContract;
}

export interface ProjectRuntimeFieldTaxonomyValidationResult
  extends CoreFieldPolicyValidationResult {
  contractVersion: typeof PROJECT_RUNTIME_CONTRACT_VERSION;
}

export interface ProjectRuntimeFieldTaxonomySummary extends CoreFieldPolicySummary {
  contracts: Record<ProjectRuntimeFieldPolicyContract, number>;
  contractVersion: typeof PROJECT_RUNTIME_CONTRACT_VERSION;
}

export const PROJECT_RUNTIME_FIELD_POLICIES = [
  {
    consumers: ['Alembic', 'AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeTarget',
    diagnosticPolicy: 'none',
    extensionPolicy: 'strict',
    failureKinds: ['invalid-input', 'not-found', 'unavailable'],
    fieldClass: 'consumer-needed',
    fieldPath: 'ProjectRuntimeTarget.projectId',
    interfaceRole: 'consumer-projection',
    ordinaryOutputAllowed: true,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts', 'npm run build:check'],
  },
  {
    consumers: [],
    contract: 'ProjectRuntimeTarget',
    diagnosticPolicy: 'redacted-summary',
    extensionPolicy: 'private-adapter',
    failureKinds: ['invalid-input', 'permission-denied', 'sensitive-leak'],
    fieldClass: 'sensitive',
    fieldPath: 'ProjectRuntimeTarget.projectRoot',
    interfaceRole: 'internal-runtime',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeIdentityContract',
    diagnosticPolicy: 'none',
    extensionPolicy: 'strict',
    failureKinds: ['not-found', 'unavailable', 'capability-mismatch'],
    fieldClass: 'consumer-needed',
    fieldPath: 'ProjectRuntimeIdentityContract.projectScopeId',
    interfaceRole: 'consumer-projection',
    ordinaryOutputAllowed: true,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts', 'npm run build:check'],
  },
  {
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeIdentityContract',
    diagnosticPolicy: 'diagnostic-context',
    extensionPolicy: 'diagnostic-ref',
    failureKinds: ['not-found', 'permission-denied', 'unavailable'],
    fieldClass: 'diagnostic',
    fieldPath: 'ProjectRuntimeIdentityContract.projectRoot',
    interfaceRole: 'diagnostic-extension',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: [],
    contract: 'ProjectRuntimeIdentityContract',
    diagnosticPolicy: 'redacted-summary',
    extensionPolicy: 'private-adapter',
    failureKinds: ['permission-denied', 'sensitive-leak', 'unavailable'],
    fieldClass: 'sensitive',
    fieldPath: 'ProjectRuntimeIdentityContract.databasePath',
    interfaceRole: 'internal-runtime',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: ['Alembic', 'AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeFailureEnvelope',
    diagnosticPolicy: 'none',
    extensionPolicy: 'strict',
    failureKinds: ['unavailable', 'capability-mismatch', 'internal-error'],
    fieldClass: 'public',
    fieldPath: 'ProjectRuntimeFailureEnvelope.reason',
    interfaceRole: 'producer-contract',
    ordinaryOutputAllowed: true,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts', 'npm run build:check'],
  },
  {
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeFailureEnvelope',
    diagnosticPolicy: 'diagnostic-context',
    extensionPolicy: 'diagnostic-ref',
    failureKinds: ['unavailable', 'degraded', 'internal-error'],
    fieldClass: 'diagnostic',
    fieldPath: 'ProjectRuntimeFailureEnvelope.identity',
    interfaceRole: 'diagnostic-extension',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeReadinessSummary',
    diagnosticPolicy: 'diagnostic-context',
    extensionPolicy: 'diagnostic-ref',
    failureKinds: ['partial', 'degraded', 'unavailable'],
    fieldClass: 'diagnostic',
    fieldPath: 'ProjectRuntimeReadinessSummary.failureEnvelopes',
    interfaceRole: 'diagnostic-extension',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: [],
    contract: 'ProjectRuntimeScopeSummary',
    diagnosticPolicy: 'none',
    extensionPolicy: 'private-adapter',
    failureKinds: ['schema-drift', 'internal-error'],
    fieldClass: 'internal',
    fieldPath: 'ProjectRuntimeScopeSummary.cacheKey',
    interfaceRole: 'internal-runtime',
    ordinaryOutputAllowed: false,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
  {
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    contract: 'ProjectRuntimeScopeSummary',
    diagnosticPolicy: 'none',
    extensionPolicy: 'strict',
    failureKinds: ['unavailable', 'schema-drift'],
    fieldClass: 'consumer-needed',
    fieldPath: 'ProjectRuntimeScopeSummary.fileMonitor.acceptedEventSources',
    interfaceRole: 'consumer-projection',
    ordinaryOutputAllowed: true,
    owner: 'AlembicCore',
    validationCommands: ['npm run test -- ProjectRuntimeContracts'],
  },
] as const satisfies readonly ProjectRuntimeFieldPolicy[];

export function validateProjectRuntimeFieldTaxonomy(
  policies: readonly ProjectRuntimeFieldPolicy[] = PROJECT_RUNTIME_FIELD_POLICIES
): ProjectRuntimeFieldTaxonomyValidationResult {
  const validation = validateCoreFieldPolicies(policies);

  return {
    ...validation,
    contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
  };
}

export function summarizeProjectRuntimeFieldTaxonomy(
  policies: readonly ProjectRuntimeFieldPolicy[] = PROJECT_RUNTIME_FIELD_POLICIES
): ProjectRuntimeFieldTaxonomySummary {
  const summary = summarizeCoreFieldPolicies(policies);
  const contracts = emptyProjectRuntimeFieldPolicyContractCounts();

  for (const policy of policies) {
    contracts[policy.contract] += 1;
  }

  return {
    ...summary,
    contracts,
    contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
  };
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

export function createProjectRuntimeIdentityContract(
  options: CreateProjectRuntimeIdentityContractOptions = {}
): ProjectRuntimeIdentityContract {
  return {
    contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
    currentFolderId: options.currentFolderId ?? options.projectScope?.currentFolderId ?? null,
    dataRoot: options.dataRoot ?? options.projectScope?.dataRoot ?? null,
    dataRootSource: options.dataRootSource ?? options.projectScope?.dataRootSource ?? null,
    databasePath: options.databasePath ?? null,
    ghost: options.ghost ?? null,
    mode: options.mode ?? null,
    projectExists: options.projectExists ?? null,
    projectId: options.projectId ?? options.projectScope?.projectId ?? null,
    projectRealpath: options.projectRealpath ?? null,
    projectRoot: options.projectRoot ?? options.projectScope?.currentFolderPath ?? null,
    projectScope: options.projectScope ?? null,
    projectScopeId: options.projectScopeId ?? options.projectScope?.projectScopeId ?? null,
    registered: options.registered ?? null,
    runtimeDir: options.runtimeDir ?? null,
    workspaceExists: options.workspaceExists ?? null,
  };
}

export function createProjectRuntimeIdentityContractFromScopeSummary(
  scope: ProjectRuntimeScopeSummary | null
): ProjectRuntimeIdentityContract | null {
  if (!scope) {
    return null;
  }

  return createProjectRuntimeIdentityContract({
    currentFolderId: scope.projectScope?.currentFolderId ?? null,
    dataRoot: scope.dataRoot,
    dataRootSource: scope.dataRootSource,
    databasePath: scope.databasePath,
    ghost: scope.ghost,
    mode: scope.mode,
    projectExists: scope.projectExists,
    projectId: scope.projectId,
    projectRealpath: scope.projectRealpath,
    projectRoot: scope.projectRoot,
    projectScope: scope.projectScope ?? null,
    projectScopeId: scope.projectScopeId ?? scope.projectScope?.projectScopeId ?? null,
    registered: scope.registered,
    runtimeDir: scope.runtimeDir,
    workspaceExists: scope.workspaceExists,
  });
}

export function isProjectRuntimeRequiredService(
  value: unknown
): value is ProjectRuntimeRequiredService {
  return (
    typeof value === 'string' &&
    PROJECT_RUNTIME_REQUIRED_SERVICES.includes(value as ProjectRuntimeRequiredService)
  );
}

export function normalizeProjectRuntimeRequiredService(
  value: unknown
): ProjectRuntimeRequiredService | null {
  return isProjectRuntimeRequiredService(value) ? value : null;
}

export function isProjectRuntimeFailureReason(
  value: unknown
): value is ProjectRuntimeFailureReason {
  return (
    typeof value === 'string' &&
    PROJECT_RUNTIME_FAILURE_REASONS.includes(value as ProjectRuntimeFailureReason)
  );
}

export function normalizeProjectRuntimeFailureReason(
  value: unknown
): ProjectRuntimeFailureReason | null {
  return isProjectRuntimeFailureReason(value) ? value : null;
}

export function createProjectRuntimeServiceReadiness(
  options: CreateProjectRuntimeServiceReadinessOptions
): ProjectRuntimeServiceReadiness {
  const required = options.required ?? false;
  const state: ProjectRuntimeReadinessState = options.available
    ? 'ready'
    : required
      ? 'blocked'
      : 'degraded';

  return {
    available: options.available,
    message: options.message ?? null,
    reason: options.available ? null : (options.reason ?? 'runtime-unavailable'),
    required,
    service: options.service,
    source: options.source ?? null,
    state,
  };
}

export function createProjectRuntimeFailureEnvelope(
  options: CreateProjectRuntimeFailureEnvelopeOptions
): ProjectRuntimeFailureEnvelope {
  const readinessState = options.readinessState ?? 'blocked';
  return {
    contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
    identity: options.identity ?? null,
    message: options.message ?? PROJECT_RUNTIME_FAILURE_MESSAGES[options.reason],
    reason: options.reason,
    readinessState,
    service: options.service ?? null,
    severity: options.severity ?? (readinessState === 'blocked' ? 'error' : 'warning'),
    source: options.source ?? null,
  };
}

export function summarizeProjectRuntimeScopeReadiness(
  scope: ProjectRuntimeScopeSummary | null,
  options: SummarizeProjectRuntimeScopeReadinessOptions = {}
): ProjectRuntimeReadinessSummary {
  const identity = createProjectRuntimeIdentityContractFromScopeSummary(scope);
  const requiredServices = new Set<ProjectRuntimeRequiredService>(
    options.requiredServices ?? PROJECT_RUNTIME_DEFAULT_REQUIRED_SERVICES
  );
  const services =
    options.includeOptionalServices === false
      ? [...requiredServices]
      : [...PROJECT_RUNTIME_REQUIRED_SERVICES];
  const requiredServiceReadiness = services.map((service) =>
    createReadinessForService(service, scope, identity, requiredServices.has(service))
  );
  const state = summarizeReadinessState(requiredServiceReadiness);
  const failureEnvelopes = requiredServiceReadiness
    .filter((service) => service.state !== 'ready' && service.reason)
    .map((service) =>
      createProjectRuntimeFailureEnvelope({
        identity,
        message: service.message,
        readinessState: service.state,
        reason: service.reason ?? 'runtime-unavailable',
        service: service.service,
        source: service.source,
      })
    );

  return {
    contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
    failureEnvelopes,
    identity,
    requiredServices: requiredServiceReadiness,
    state,
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

const PROJECT_RUNTIME_FAILURE_MESSAGES: Record<ProjectRuntimeFailureReason, string> = {
  'api-ai-unavailable': 'API AI provider is unavailable for the selected project runtime.',
  'dashboard-unavailable': 'Dashboard service is unavailable for the selected project runtime.',
  'daemon-failed': 'Local daemon failed for the selected project runtime.',
  'daemon-missing': 'Local daemon state is missing for the selected project runtime.',
  'daemon-not-checked': 'Local daemon state has not been checked for the selected project runtime.',
  'daemon-stale': 'Local daemon state is stale for the selected project runtime.',
  'daemon-starting': 'Local daemon is still starting for the selected project runtime.',
  'daemon-unavailable': 'Local daemon is unavailable for the selected project runtime.',
  'file-monitor-unavailable': 'File monitor is unavailable for the selected project runtime.',
  'jobs-unavailable': 'Job store is unavailable for the selected project runtime.',
  'project-identity-missing': 'Project identity is missing for the selected project runtime.',
  'project-not-registered': 'Project is not registered in the runtime source of truth.',
  'project-scope-unavailable': 'ProjectScope descriptor is unavailable for the selected project.',
  'runtime-unavailable': 'Runtime service is unavailable for the selected project.',
};

function createReadinessForService(
  service: ProjectRuntimeRequiredService,
  scope: ProjectRuntimeScopeSummary | null,
  identity: ProjectRuntimeIdentityContract | null,
  required: boolean
): ProjectRuntimeServiceReadiness {
  switch (service) {
    case 'project-identity': {
      const available = hasProjectRuntimeIdentity(identity);
      const reason = available
        ? null
        : scope && scope.registered === false
          ? 'project-not-registered'
          : 'project-identity-missing';
      return createProjectRuntimeServiceReadiness({
        available,
        reason,
        required,
        service,
        source: 'project-runtime-identity',
      });
    }
    case 'project-scope':
      return createProjectRuntimeServiceReadiness({
        available: Boolean(identity?.projectScope?.projectScopeId),
        reason: 'project-scope-unavailable',
        required,
        service,
        source: 'project-scope',
      });
    case 'daemon': {
      const reason = getDaemonFailureReason(scope?.daemon);
      return createProjectRuntimeServiceReadiness({
        available: scope?.daemon.ready === true && scope.daemon.status === 'ready',
        message: scope?.daemon.message ?? null,
        reason,
        required,
        service,
        source: 'daemon-state',
      });
    }
    case 'jobs':
      return createProjectRuntimeServiceReadiness({
        available: isNonEmptyString(scope?.jobs.jobsDir),
        reason: 'jobs-unavailable',
        required,
        service,
        source: 'job-store',
      });
    case 'api-ai':
      return createProjectRuntimeServiceReadiness({
        available: scope?.apiAi.available === true,
        reason: 'api-ai-unavailable',
        required,
        service,
        source: scope?.apiAi.configSource ?? 'api-ai',
      });
    case 'dashboard':
      return createProjectRuntimeServiceReadiness({
        available:
          isNonEmptyString(scope?.dashboardUrl) || isNonEmptyString(scope?.daemon.dashboardUrl),
        reason: 'dashboard-unavailable',
        required,
        service,
        source: 'dashboard',
      });
    case 'file-monitor':
      return createProjectRuntimeServiceReadiness({
        available: scope?.fileMonitor.available === true,
        reason: 'file-monitor-unavailable',
        required,
        service,
        source: 'file-monitor',
      });
  }
}

function summarizeReadinessState(
  services: readonly ProjectRuntimeServiceReadiness[]
): ProjectRuntimeReadinessState {
  if (services.some((service) => service.state === 'blocked')) {
    return 'blocked';
  }
  if (services.some((service) => service.state === 'degraded')) {
    return 'degraded';
  }
  return 'ready';
}

function hasProjectRuntimeIdentity(identity: ProjectRuntimeIdentityContract | null): boolean {
  return (
    Boolean(identity) &&
    isNonEmptyString(identity?.dataRoot) &&
    isNonEmptyString(identity?.projectRoot) &&
    isNonEmptyString(identity?.runtimeDir) &&
    identity?.registered !== false
  );
}

function getDaemonFailureReason(
  daemon: ProjectRuntimeDaemonSummary | undefined
): ProjectRuntimeFailureReason {
  switch (daemon?.status) {
    case 'failed':
      return 'daemon-failed';
    case 'not-checked':
      return 'daemon-not-checked';
    case 'ready':
      return 'daemon-unavailable';
    case 'stale':
      return 'daemon-stale';
    case 'starting':
      return 'daemon-starting';
    case 'stopped':
      return 'daemon-missing';
    default:
      return 'daemon-not-checked';
  }
}

function emptyProjectRuntimeFieldPolicyContractCounts(): Record<
  ProjectRuntimeFieldPolicyContract,
  number
> {
  return {
    ProjectRuntimeFailureEnvelope: 0,
    ProjectRuntimeIdentityContract: 0,
    ProjectRuntimeReadinessSummary: 0,
    ProjectRuntimeScopeSummary: 0,
    ProjectRuntimeTarget: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

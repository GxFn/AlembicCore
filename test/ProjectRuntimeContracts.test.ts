import { describe, expect, it } from 'vitest';

import {
  createProjectRuntimeControlState,
  createProjectRuntimeFailureEnvelope,
  createProjectRuntimeIdentityContractFromScopeSummary,
  hasActiveProjectRuntime,
  hasSelectedProjectRuntime,
  isProjectConnectionState,
  isProjectRuntimeTarget,
  normalizeProjectConnectionState,
  normalizeProjectRuntimeFailureReason,
  PROJECT_CONNECTION_STATES,
  PROJECT_RUNTIME_API_AI_CONFIG_SOURCES,
  PROJECT_RUNTIME_CONTRACT_VERSION,
  PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION,
  PROJECT_RUNTIME_DAEMON_STATUSES,
  PROJECT_RUNTIME_FAILURE_REASONS,
  PROJECT_RUNTIME_FIELD_POLICIES,
  PROJECT_RUNTIME_READINESS_STATES,
  PROJECT_RUNTIME_REQUIRED_SERVICES,
  type ProjectRuntimeControlSnapshot,
  summarizeProjectRuntimeFieldTaxonomy,
  summarizeProjectRuntimeScopeReadiness,
  validateProjectRuntimeFieldTaxonomy,
} from '../src/daemon/index.js';

describe('project runtime control public contracts', () => {
  it('exposes Wave 1 connection and provider state enums', () => {
    expect(PROJECT_CONNECTION_STATES).toEqual([
      'ready',
      'stopped',
      'starting',
      'stale',
      'failed',
      'missing',
      'unavailable',
    ]);
    expect(PROJECT_RUNTIME_DAEMON_STATUSES).toContain('not-checked');
    expect(PROJECT_RUNTIME_API_AI_CONFIG_SOURCES).toEqual([
      'empty',
      'process-env',
      'workspace-settings',
      'unavailable',
    ]);
    expect(PROJECT_RUNTIME_REQUIRED_SERVICES).toEqual([
      'project-identity',
      'project-scope',
      'daemon',
      'jobs',
      'api-ai',
      'dashboard',
      'file-monitor',
    ]);
    expect(PROJECT_RUNTIME_READINESS_STATES).toEqual(['ready', 'degraded', 'blocked']);
    expect(PROJECT_RUNTIME_FAILURE_REASONS).toContain('project-not-registered');
    expect(isProjectConnectionState('ready')).toBe(true);
    expect(normalizeProjectConnectionState('missing')).toBe('missing');
    expect(normalizeProjectConnectionState('unknown')).toBeNull();
    expect(normalizeProjectRuntimeFailureReason('daemon-stale')).toBe('daemon-stale');
    expect(normalizeProjectRuntimeFailureReason('unknown')).toBeNull();
  });

  it('keeps project runtime target validation as projectId or projectRoot only', () => {
    expect(isProjectRuntimeTarget({ projectId: 'project-a' })).toBe(true);
    expect(isProjectRuntimeTarget({ projectRoot: '/workspace/app' })).toBe(true);
    expect(isProjectRuntimeTarget({ projectId: 'project-a', projectRoot: '/workspace/app' })).toBe(
      false
    );
    expect(isProjectRuntimeTarget({})).toBe(false);
    expect(isProjectRuntimeTarget({ projectId: '' })).toBe(false);
  });

  it('creates registry-v1 compatible selected and active project state', () => {
    const emptyState = createProjectRuntimeControlState();
    expect(emptyState).toEqual({
      activeProjectId: null,
      activeProjectRoot: null,
      schemaVersion: PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION,
      selectedAt: null,
      selectedProjectId: null,
      selectedProjectRoot: null,
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(hasSelectedProjectRuntime(emptyState)).toBe(false);
    expect(hasActiveProjectRuntime(emptyState)).toBe(false);

    const selectedState = createProjectRuntimeControlState({
      activeProjectRoot: '/workspace/app',
      selectedAt: '2026-05-19T00:00:00.000Z',
      selectedProjectId: 'project-a',
      selectedProjectRoot: '/workspace/app',
      updatedAt: '2026-05-19T00:00:01.000Z',
    });
    expect(hasSelectedProjectRuntime(selectedState)).toBe(true);
    expect(hasActiveProjectRuntime(selectedState)).toBe(true);
  });

  it('models the Wave 1 project runtime control snapshot shape', () => {
    const state = createProjectRuntimeControlState({
      activeProjectId: 'project-a',
      activeProjectRoot: '/workspace/app',
      selectedProjectId: 'project-a',
      selectedProjectRoot: '/workspace/app',
      updatedAt: '2026-05-19T00:00:01.000Z',
    });
    const project = createRuntimeProject();
    const snapshot = {
      activeRuntimeProject: project,
      generatedAt: '2026-05-19T00:00:02.000Z',
      projects: [project],
      selectedProject: project,
      state,
    } satisfies ProjectRuntimeControlSnapshot;

    expect(snapshot.activeRuntimeProject?.flags.activeRuntime).toBe(true);
    expect(snapshot.selectedProject?.scope.controlPlaneOwner).toBe('alembic');
    expect(snapshot.projects[0]?.jobs.byStatus.queued).toBe(0);
  });

  it('creates a shared project identity contract from a runtime scope summary', () => {
    const identity = createProjectRuntimeIdentityContractFromScopeSummary(createRuntimeProject());

    expect(identity).toMatchObject({
      contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
      dataRoot: '/data',
      dataRootSource: 'ghost-registry',
      projectId: 'project-a',
      projectRoot: '/workspace/app',
      registered: true,
      runtimeDir: '/data/.asd',
    });
  });

  it('summarizes required services into runtime failure envelopes', () => {
    const project = createRuntimeProject({
      apiAi: {
        available: false,
        configSource: 'empty',
        model: null,
        provider: null,
      },
      daemon: {
        dashboardUrl: null,
        logPath: '/data/.asd/daemon.log',
        message: 'pid file points at a dead process',
        pid: 123,
        pidAlive: false,
        ready: false,
        statePath: '/data/.asd/daemon.json',
        status: 'stale',
        url: null,
      },
    });

    const readiness = summarizeProjectRuntimeScopeReadiness(project, {
      includeOptionalServices: false,
      requiredServices: ['project-identity', 'daemon', 'api-ai'],
    });

    expect(readiness.state).toBe('blocked');
    expect(readiness.identity?.projectId).toBe('project-a');
    expect(readiness.requiredServices.map((service) => service.service)).toEqual([
      'project-identity',
      'daemon',
      'api-ai',
    ]);
    expect(readiness.failureEnvelopes).toEqual([
      expect.objectContaining({
        message: 'pid file points at a dead process',
        reason: 'daemon-stale',
        readinessState: 'blocked',
        service: 'daemon',
        severity: 'error',
      }),
      expect.objectContaining({
        reason: 'api-ai-unavailable',
        readinessState: 'blocked',
        service: 'api-ai',
        severity: 'error',
      }),
    ]);
  });

  it('keeps optional service failures degraded instead of blocking the runtime', () => {
    const readiness = summarizeProjectRuntimeScopeReadiness(createRuntimeProject());
    const apiAi = readiness.requiredServices.find((service) => service.service === 'api-ai');

    expect(readiness.state).toBe('degraded');
    expect(apiAi).toMatchObject({
      available: false,
      reason: 'api-ai-unavailable',
      required: false,
      state: 'degraded',
    });
  });

  it('creates standalone failure envelopes for adapter diagnostics', () => {
    const envelope = createProjectRuntimeFailureEnvelope({
      reason: 'project-not-registered',
      service: 'project-identity',
    });

    expect(envelope).toMatchObject({
      contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
      message: 'Project is not registered in the runtime source of truth.',
      readinessState: 'blocked',
      severity: 'error',
    });
  });

  it('exports D19 field taxonomy policies for project runtime contracts', () => {
    expect(validateProjectRuntimeFieldTaxonomy()).toEqual({
      contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
      issues: [],
      policyCount: PROJECT_RUNTIME_FIELD_POLICIES.length,
      valid: true,
    });

    expect(summarizeProjectRuntimeFieldTaxonomy()).toMatchObject({
      byClass: {
        'artifactRef-only': 0,
        'compatibility-private': 0,
        'consumer-needed': 3,
        diagnostic: 3,
        'detailRef-only': 0,
        'hidden-reasoning': 0,
        internal: 1,
        public: 1,
        'raw-provider': 0,
        sensitive: 2,
        'typed-extension': 0,
      },
      contracts: {
        ProjectRuntimeFailureEnvelope: 2,
        ProjectRuntimeIdentityContract: 3,
        ProjectRuntimeReadinessSummary: 1,
        ProjectRuntimeScopeSummary: 2,
        ProjectRuntimeTarget: 2,
      },
      contractVersion: PROJECT_RUNTIME_CONTRACT_VERSION,
      policyCount: PROJECT_RUNTIME_FIELD_POLICIES.length,
    });
  });

  it('classifies runtime path fields as diagnostic or sensitive instead of ordinary output', () => {
    const projectRoot = PROJECT_RUNTIME_FIELD_POLICIES.find(
      (policy) => policy.fieldPath === 'ProjectRuntimeIdentityContract.projectRoot'
    );
    const databasePath = PROJECT_RUNTIME_FIELD_POLICIES.find(
      (policy) => policy.fieldPath === 'ProjectRuntimeIdentityContract.databasePath'
    );
    const failureReason = PROJECT_RUNTIME_FIELD_POLICIES.find(
      (policy) => policy.fieldPath === 'ProjectRuntimeFailureEnvelope.reason'
    );

    expect(projectRoot).toMatchObject({
      diagnosticPolicy: 'diagnostic-context',
      fieldClass: 'diagnostic',
      ordinaryOutputAllowed: false,
    });
    expect(databasePath).toMatchObject({
      diagnosticPolicy: 'redacted-summary',
      fieldClass: 'sensitive',
      ordinaryOutputAllowed: false,
    });
    expect(failureReason).toMatchObject({
      fieldClass: 'public',
      ordinaryOutputAllowed: true,
    });
  });
});

function createRuntimeProject(
  overrides: Partial<ProjectRuntimeControlSnapshot['projects'][number]> = {}
): ProjectRuntimeControlSnapshot['projects'][number] {
  return {
    cacheKey: 'project:project-a',
    daemon: {
      dashboardUrl: 'http://127.0.0.1:8123',
      logPath: '/data/.asd/daemon.log',
      message: null,
      pid: 123,
      pidAlive: true,
      ready: true,
      statePath: '/data/.asd/daemon.json',
      status: 'ready',
      url: 'http://127.0.0.1:8123',
    },
    dashboardUrl: 'http://127.0.0.1:8123',
    dataRoot: '/data',
    dataRootSource: 'ghost-registry',
    databasePath: '/data/.asd/alembic.db',
    displayName: 'app',
    fileMonitor: {
      acceptedEventSources: ['host-edit'],
      available: true,
      endpoint: '/api/v1/file-changes',
      mode: 'daemon-git-worktree',
    },
    flags: {
      activeRuntime: true,
      missing: false,
      selected: true,
      stale: false,
      unavailable: false,
    },
    ghost: true,
    initializedBy: 'project-registry',
    apiAi: {
      available: false,
      configSource: 'empty',
      model: null,
      provider: null,
    },
    jobs: {
      active: 0,
      byStatus: { queued: 0, running: 0 },
      jobsDir: '/data/.asd/jobs',
      latestJobId: null,
      latestUpdatedAt: null,
      total: 0,
    },
    mode: 'ghost',
    projectExists: true,
    projectId: 'project-a',
    projectRealpath: '/workspace/app',
    projectRoot: '/workspace/app',
    registered: true,
    registry: {
      createdAt: '2026-05-19T00:00:00.000Z',
      id: 'project-a',
    },
    runtimeDir: '/data/.asd',
    scope: {
      controlPlaneOwner: 'alembic',
      daemonOwner: 'per-project-daemon',
      jobStoreOwner: '@alembic/core/daemon/JobStore',
      runtimeOwner: 'alembic',
    },
    status: 'ready',
    workspaceExists: true,
    ...overrides,
  };
}

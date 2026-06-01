import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES,
  ALEMBIC_JOB_PROCESS_EVENTS_PATH,
  ALEMBIC_RUNTIME_HEALTH_PATH,
  createAlembicRuntimeCapabilities,
  createAlembicRuntimeHealthData,
  createAlembicRuntimeProjectIdentity,
  JOB_PROCESS_EVENT_CONTRACT_VERSION,
  normalizeAlembicRuntimeDataRootSource,
  normalizeAlembicRuntimeRouteKind,
  normalizeAlembicWorkspaceMode,
  summarizeAlembicRuntimeCapabilities,
  summarizeAlembicRuntimeProjectIdentity,
} from '../src/daemon/index.js';
import { PROJECT_SCOPE_OPERATIONS } from '../src/shared/index.js';

describe('Alembic runtime boundary contracts', () => {
  it('builds a daemon-owned runtime capability shape without HTTP or dashboard dependencies', () => {
    const capabilities = createAlembicRuntimeCapabilities({
      apiBaseUrl: 'http://127.0.0.1:8123',
      dashboardAvailable: true,
      dashboardUrl: 'http://127.0.0.1:8123',
      fileMonitorAvailable: true,
      fileMonitorMode: 'daemon-git-worktree',
      apiAi: {
        available: true,
        configSource: 'workspace-settings',
        model: 'model-a',
        provider: 'provider-a',
      },
    });

    expect(capabilities.api.healthPath).toBe(ALEMBIC_RUNTIME_HEALTH_PATH);
    expect(capabilities.fileMonitor.acceptedEventSources).toEqual([
      'host-edit',
      'git-head',
      'git-worktree',
    ]);
    expect(capabilities.fileMonitor.compatibilityAliases).toEqual({
      ...ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES,
    });
    expect(capabilities.jobs.kinds).toEqual(['bootstrap', 'rescan']);
    expect(capabilities.jobs.endpoints.events).toBe(ALEMBIC_JOB_PROCESS_EVENTS_PATH);
    expect(capabilities.jobs.processEvents).toMatchObject({
      available: false,
      contractVersion: JOB_PROCESS_EVENT_CONTRACT_VERSION,
      developerFacingDefaultDisplayPolicy: 'full',
      endpoint: ALEMBIC_JOB_PROCESS_EVENTS_PATH,
      supportedDisplayPolicies: ['full', 'summary-only', 'hidden'],
      supportedRetentionPolicies: ['transient', 'job-retained', 'artifact-retained'],
      supportedSourceClasses: [
        'developer-facing',
        'machine-only',
        'raw-provider',
        'secret',
        'hidden-reasoning',
      ],
    });
    expect(capabilities.projectScope).toMatchObject({
      available: false,
      storageKind: 'ghost',
      supportedOperations: [...PROJECT_SCOPE_OPERATIONS],
      supportsFolderRemove: false,
      supportsStandardStorage: false,
    });
  });

  it('creates health data and summarizes consumer-facing capability availability', () => {
    const capabilities = createAlembicRuntimeCapabilities({
      apiBaseUrl: null,
      dashboardAvailable: false,
      dashboardUrl: null,
      fileMonitorAvailable: false,
      apiAi: {
        available: false,
        configSource: 'empty',
        model: null,
        provider: null,
      },
      jobProcessEvents: {
        available: true,
        supportedKinds: ['workflow', 'llm.input', 'artifact'],
      },
    });
    const health = createAlembicRuntimeHealthData({
      capabilities,
      dataRoot: '/data',
      dataRootSource: 'ghost-registry',
      databasePath: '/data/.asd/alembic.db',
      mode: 'daemon',
      projectId: 'abcd1234',
      projectRoot: '/project',
      projectScope: {
        contractVersion: 1,
        controlRoot: '/workspace',
        controlRootIncludedInFolders: false,
        currentFolderId: 'folder-a',
        currentFolderPath: '/workspace/project',
        dataRoot: '/data',
        dataRootSource: 'ghost-registry',
        displayName: 'Project A',
        folderCount: 1,
        folders: [
          {
            displayName: 'project',
            folderId: 'folder-a',
            path: '/workspace/project',
            realpath: null,
            repositoryId: null,
            role: 'source',
            state: 'active',
          },
        ],
        projectId: 'abcd1234',
        projectRootWriteAllowed: false,
        projectScopeId: 'scope-a',
        standardWriteAllowed: false,
        storageKind: 'ghost',
      },
      runtimeDir: '/data/.asd',
      schemaMigrationVersion: '009',
      version: '0.2.0',
    });

    expect(health.enhancement).toEqual({
      apiVersion: 'v1',
      packageName: 'alembic-ai',
      route: 'local-alembic',
      version: '0.2.0',
    });
    expect(summarizeAlembicRuntimeCapabilities(health.capabilities)).toMatchObject({
      apiAvailable: true,
      dashboardAvailable: false,
      fileMonitorAvailable: false,
      fileMonitorMode: 'disabled',
      apiAiAvailable: false,
      jobEventsAvailable: true,
      jobEventDisplayPolicies: ['full', 'summary-only', 'hidden'],
      jobEventsEndpoint: ALEMBIC_JOB_PROCESS_EVENTS_PATH,
      jobEventKinds: ['workflow', 'llm.input', 'artifact'],
      jobEventRetentionPolicies: ['transient', 'job-retained', 'artifact-retained'],
      jobEventSourceClasses: [
        'developer-facing',
        'machine-only',
        'raw-provider',
        'secret',
        'hidden-reasoning',
      ],
      jobsAvailable: true,
      jobKinds: ['bootstrap', 'rescan'],
      projectScopeAvailable: false,
      projectScopeEndpoint: '/api/v1/project-scope',
      projectScopeStorageKind: 'ghost',
      projectScopeSupportedOperations: [...PROJECT_SCOPE_OPERATIONS],
    });
    expect(summarizeAlembicRuntimeProjectIdentity(health)).toMatchObject({
      dataRoot: '/data',
      dataRootSource: 'ghost-registry',
      databasePath: '/data/.asd/alembic.db',
      projectId: 'abcd1234',
      projectRoot: '/project',
      projectScope: {
        currentFolderId: 'folder-a',
        projectScopeId: 'scope-a',
        storageKind: 'ghost',
      },
      projectScopeId: 'scope-a',
      runtimeDir: '/data/.asd',
      schemaMigrationVersion: '009',
      workspaceMode: 'ghost',
    });
  });

  it('normalizes runtime route kinds for plugin and install adapters', () => {
    expect(normalizeAlembicRuntimeRouteKind('local-alembic-daemon')).toBe('local-alembic-daemon');
    expect(normalizeAlembicRuntimeRouteKind('unknown')).toBeNull();
  });

  it('creates canonical project identity fields used by daemon health consumers', () => {
    expect(
      createAlembicRuntimeProjectIdentity({
        dataRoot: '/project',
        dataRootSource: 'project-root',
        databasePath: '/project/.asd/alembic.db',
        projectId: null,
        projectRoot: '/project',
        runtimeDir: '/project/.asd',
      })
    ).toMatchObject({
      dataRootSource: 'project-root',
      runtimeDir: '/project/.asd',
      workspaceMode: 'standard',
    });
    expect(normalizeAlembicRuntimeDataRootSource('ghost-registry')).toBe('ghost-registry');
    expect(normalizeAlembicRuntimeDataRootSource('tmp')).toBeNull();
    expect(normalizeAlembicWorkspaceMode('standard')).toBe('standard');
    expect(normalizeAlembicWorkspaceMode('tmp')).toBeNull();
  });
});

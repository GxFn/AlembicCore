import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES,
  ALEMBIC_RUNTIME_HEALTH_PATH,
  createAlembicRuntimeCapabilities,
  createAlembicRuntimeHealthData,
  createAlembicRuntimeProjectIdentity,
  normalizeAlembicRuntimeDataRootSource,
  normalizeAlembicRuntimeRouteKind,
  normalizeAlembicWorkspaceMode,
  summarizeAlembicRuntimeCapabilities,
  summarizeAlembicRuntimeProjectIdentity,
} from '../src/daemon/index.js';

describe('Alembic runtime boundary contracts', () => {
  it('builds a daemon-owned runtime capability shape without HTTP or dashboard dependencies', () => {
    const capabilities = createAlembicRuntimeCapabilities({
      apiBaseUrl: 'http://127.0.0.1:8123',
      dashboardAvailable: true,
      dashboardUrl: 'http://127.0.0.1:8123',
      fileMonitorAvailable: true,
      fileMonitorMode: 'daemon-git-worktree',
      internalAi: {
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
  });

  it('creates health data and summarizes consumer-facing capability availability', () => {
    const capabilities = createAlembicRuntimeCapabilities({
      apiBaseUrl: null,
      dashboardAvailable: false,
      dashboardUrl: null,
      fileMonitorAvailable: false,
      internalAi: {
        available: false,
        configSource: 'empty',
        model: null,
        provider: null,
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
      internalAiAvailable: false,
      jobsAvailable: true,
      jobKinds: ['bootstrap', 'rescan'],
    });
    expect(summarizeAlembicRuntimeProjectIdentity(health)).toMatchObject({
      dataRoot: '/data',
      dataRootSource: 'ghost-registry',
      databasePath: '/data/.asd/alembic.db',
      projectId: 'abcd1234',
      projectRoot: '/project',
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

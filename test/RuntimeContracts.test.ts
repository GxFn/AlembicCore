import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_FILE_MONITOR_COMPATIBILITY_ALIASES,
  ALEMBIC_RUNTIME_HEALTH_PATH,
  createAlembicRuntimeCapabilities,
  createAlembicRuntimeHealthData,
  normalizeAlembicRuntimeRouteKind,
  summarizeAlembicRuntimeCapabilities,
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
      databasePath: '/data/.asd/alembic.db',
      mode: 'daemon',
      projectId: 'abcd1234',
      projectRoot: '/project',
      schemaMigrationVersion: '009',
      version: '0.1.0',
    });

    expect(health.enhancement).toEqual({
      apiVersion: 'v1',
      packageName: 'alembic-ai',
      route: 'local-alembic',
      version: '0.1.0',
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
  });

  it('normalizes runtime route kinds for plugin and install adapters', () => {
    expect(normalizeAlembicRuntimeRouteKind('local-alembic-daemon')).toBe('local-alembic-daemon');
    expect(normalizeAlembicRuntimeRouteKind('unknown')).toBeNull();
  });
});

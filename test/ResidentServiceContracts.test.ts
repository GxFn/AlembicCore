import { describe, expect, it } from 'vitest';

import {
  ALEMBIC_RESIDENT_FEATURES,
  ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION,
  classifyAlembicResidentJobFeature,
  createAlembicResidentServiceProbe,
  createAlembicResidentServiceStatus,
  getAlembicResidentJobOperation,
  normalizeAlembicResidentServiceStatus,
  resolveAlembicResidentFeatureOwner,
  summarizeAlembicResidentServiceStatus,
} from '../src/daemon/index.js';

describe('resident service public contracts', () => {
  it('models local Alembic as the resident producer without Plugin project controls', () => {
    const status = createAlembicResidentServiceStatus({
      apiBaseUrl: 'http://127.0.0.1:8123',
      capabilityOverrides: {
        'dashboard.handoff': { available: true },
        'jobs.internal-ai.bootstrap': { available: true },
        'jobs.internal-ai.rescan': { available: true },
        'search.keyword': { available: true },
        'status.health': { available: true },
      },
      owner: 'alembic',
      route: 'local-alembic-daemon',
      serviceScope: {
        dataRoot: '/runtime-data',
        dataRootSource: 'ghost-registry',
        databasePath: '/runtime-data/.asd/alembic.db',
        displayName: 'demo',
        projectId: 'project-a',
        projectRoot: '/workspace/demo',
        runtimeDir: '/runtime-data/.asd',
        schemaMigrationVersion: '009',
        workspaceMode: 'ghost',
      },
    });

    expect(status.contractVersion).toBe(ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION);
    expect(status.route).toBe('local-alembic-daemon');
    expect(status.owner).toBe('alembic');
    expect(status.serviceScope.kind).toBe('current-project');
    expect(status.serviceScope.projectIdentity).toEqual({
      dataRootSource: 'ghost-registry',
      projectId: 'project-a',
      schemaMigrationVersion: '009',
      workspaceMode: 'ghost',
    });
    expect(status.serviceScope.diagnosticPaths.projectRoot).toBe('/workspace/demo');
    expect(status.capabilities['jobs.internal-ai.bootstrap']).toMatchObject({
      available: true,
      owner: 'alembic',
      unavailableReason: null,
    });
    expect(status.capabilities['jobs.host-agent-recoverable.bootstrap']).toMatchObject({
      available: false,
      owner: 'alembic-plugin',
      unavailableReason: 'capability-unavailable',
    });
    expect(ALEMBIC_RESIDENT_FEATURES.some((feature) => feature.startsWith('projects.'))).toBe(
      false
    );
  });

  it('models embedded Plugin as a recoverable host-agent route without Alembic internal AI jobs', () => {
    const status = createAlembicResidentServiceStatus({
      capabilityOverrides: {
        'jobs.host-agent-recoverable.bootstrap': { available: true },
        'jobs.host-agent-recoverable.rescan': { available: true },
        'status.health': { available: true },
      },
      route: 'embedded-plugin-runtime',
      serviceScope: {
        displayName: 'plugin current workspace',
        kind: 'workspace',
        scopeId: 'codex-current-thread',
      },
    });

    expect(status.owner).toBe('alembic-plugin');
    expect(status.serviceScope).toMatchObject({
      displayName: 'plugin current workspace',
      kind: 'workspace',
      scopeId: 'codex-current-thread',
    });
    expect(status.capabilities['jobs.host-agent-recoverable.bootstrap']).toMatchObject({
      available: true,
      owner: 'alembic-plugin',
      unavailableReason: null,
    });
    expect(status.capabilities['jobs.internal-ai.bootstrap']).toMatchObject({
      available: false,
      owner: 'alembic',
    });
  });

  it('normalizes unavailable status into explicit reasons for every feature', () => {
    const status = normalizeAlembicResidentServiceStatus({
      capabilities: {
        'status.health': {
          available: false,
          message: 'daemon not running',
          unavailableReason: 'not-running',
        },
      },
      route: 'missing-route',
    });
    const summary = summarizeAlembicResidentServiceStatus(status);

    expect(status.route).toBe('unavailable');
    expect(status.owner).toBe('alembic-plugin');
    expect(summary.availableFeatures).toEqual([]);
    expect(summary.unavailableFeatures).toEqual([...ALEMBIC_RESIDENT_FEATURES]);
    expect(summary.unavailableReasons['status.health']).toBe('not-running');
    expect(summary.unavailableReasons['search.keyword']).toBe('route-unavailable');
  });

  it('keeps internal AI job semantics separate from host-agent recoverable jobs', () => {
    expect(classifyAlembicResidentJobFeature('jobs.internal-ai.bootstrap')).toBe('internal-ai');
    expect(classifyAlembicResidentJobFeature('jobs.host-agent-recoverable.rescan')).toBe(
      'host-agent-recoverable'
    );
    expect(classifyAlembicResidentJobFeature('search.keyword')).toBeNull();
    expect(getAlembicResidentJobOperation('jobs.internal-ai.bootstrap')).toBe('bootstrap');
    expect(getAlembicResidentJobOperation('jobs.host-agent-recoverable.rescan')).toBe('rescan');
    expect(resolveAlembicResidentFeatureOwner('jobs.internal-ai.rescan')).toBe('alembic');
    expect(resolveAlembicResidentFeatureOwner('jobs.host-agent-recoverable.rescan')).toBe(
      'alembic-plugin'
    );
  });

  it('creates a deterministic probe wrapper from the normalized status summary', () => {
    const status = createAlembicResidentServiceStatus({
      capabilityOverrides: {
        'status.health': { available: true },
      },
      route: 'embedded-plugin-runtime',
    });
    const probe = createAlembicResidentServiceProbe(status, '2026-05-23T13:30:00.000Z');

    expect(probe.checkedAt).toBe('2026-05-23T13:30:00.000Z');
    expect(probe.summary.availableFeatures).toEqual(['status.health']);
    expect(probe.summary.unavailableFeatures).toContain('search.semantic');
  });
});

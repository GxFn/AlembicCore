import { describe, expect, it } from 'vitest';

import {
  createAlembicProjectSkillDeliveryReceipt,
  createPluginProjectSkillDeliveryReceipt,
  isProjectSkillDeliveryReceipt,
  normalizeProjectSkillDeliveryReceipt,
  PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
  summarizeProjectSkillDeliveryReceipt,
  validateProjectSkillDeliveryReceipt,
} from '../src/host-agent-workflows.js';

describe('ProjectSkillDeliveryContracts', () => {
  it('builds an Alembic route receipt with runtime export evidence', () => {
    const receipt = createAlembicProjectSkillDeliveryReceipt({
      asset: {
        artifactRefs: [
          {
            dimensionId: 'architecture',
            kind: 'source-file',
            label: 'Architecture map',
            ref: 'Alembic/skills/architecture/SKILL.md',
            targetName: 'main',
          },
        ],
        contentHash: 'sha256:abc',
        path: 'Alembic/skills/architecture/SKILL.md',
      },
      authorization: {
        codexSkillRoot: '.agents/skills',
        grantedBy: 'user',
        projectScopeId: 'scope-project-1',
        required: true,
        status: 'granted',
      },
      codexSkillRoot: '.agents/skills',
      createdAt: '2026-05-24T10:00:00Z',
      dimensionId: 'architecture',
      evidenceRefs: ['reports/bootstrap/architecture.md'],
      id: 'receipt-1',
      managedMarker: {
        generatedSkillId: 'skill-architecture',
        generationHash: 'sha256:abc',
        markerPath: '.agents/skills/architecture/.alembic-managed.json',
      },
      projectId: 'project-1',
      projectRoot: '/workspace/project',
      projectScopeId: 'scope-project-1',
      runtimeExport: {
        codexSkillRoot: '.agents/skills',
        linkMode: 'symlink',
        projectScopeId: 'scope-project-1',
        refreshRequired: true,
        status: 'exported',
        targetPath: '.agents/skills/architecture',
        targetRoot: '.agents/skills',
      },
      shoutSummary: {
        trigger: '@architecture',
      },
      skillName: 'architecture',
      targetName: 'main',
    });

    expect(receipt).toMatchObject({
      authorization: {
        codexSkillRoot: '.agents/skills',
        projectScopeId: 'scope-project-1',
        status: 'granted',
      },
      contractVersion: PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
      dimensionId: 'architecture',
      managedMarker: {
        generatedSkillId: 'skill-architecture',
        generationHash: 'sha256:abc',
        managedBy: 'alembic',
        projectScopeId: 'scope-project-1',
        route: 'alembic',
        sourcePath: 'Alembic/skills/architecture/SKILL.md',
      },
      projectScopeId: 'scope-project-1',
      route: 'alembic',
      runtimeExport: {
        authorizationStatus: 'granted',
        codexSkillRoot: '.agents/skills',
        conflictStatus: 'none',
        linkMode: 'symlink',
        projectScopeId: 'scope-project-1',
        refreshRequired: true,
        status: 'exported',
        strategy: 'symlink-first',
      },
      shoutSummary: {
        delivered: true,
        runtimeVisible: true,
        skillName: 'architecture',
      },
      targetName: 'main',
    });
    expect(receipt.asset.artifactRefs[0]?.dimensionId).toBe('architecture');
    expect(summarizeProjectSkillDeliveryReceipt(receipt)).toContain('exported');
    expect(validateProjectSkillDeliveryReceipt(receipt)).toMatchObject({
      issues: [],
      ok: true,
    });
  });

  it('normalizes Plugin route receipt input without requiring runtime export', () => {
    const receipt = createPluginProjectSkillDeliveryReceipt({
      asset: {
        kind: 'skill-directory',
        path: 'Alembic/skills/react',
      },
      authorization: {
        required: false,
        status: 'not-required',
      },
      codexSkillRoot: '.agents/skills',
      conflictStatus: 'compatible-existing',
      createdAt: '2026-05-24T10:05:00Z',
      id: 'receipt-2',
      projectRoot: '/workspace/project',
      projectScopeId: 'scope-project-1',
      runtimeExport: {
        conflictStatus: 'compatible-existing',
        refreshRequired: false,
        status: 'skipped',
      },
      skillName: 'react-patterns',
    });

    const normalized = normalizeProjectSkillDeliveryReceipt({
      ...receipt,
      evidenceRefs: [
        {
          kind: 'plugin-store',
          ref: 'plugin/project-skills/react-patterns',
        },
      ],
    });

    expect(normalized).toMatchObject({
      authorization: {
        codexSkillRoot: '.agents/skills',
        projectScopeId: 'scope-project-1',
        status: 'not-required',
      },
      conflictStatus: 'compatible-existing',
      projectScopeId: 'scope-project-1',
      route: 'plugin',
      runtimeExport: {
        codexSkillRoot: '.agents/skills',
        conflictStatus: 'compatible-existing',
        projectScopeId: 'scope-project-1',
        refreshRequired: false,
        status: 'skipped',
      },
      skillName: 'react-patterns',
    });
    expect(normalized?.evidenceRefs[0]).toMatchObject({
      kind: 'plugin-store',
      ref: 'plugin/project-skills/react-patterns',
    });
  });

  it('rejects incomplete receipt shapes', () => {
    expect(isProjectSkillDeliveryReceipt({ route: 'alembic' })).toBe(false);
    expect(
      normalizeProjectSkillDeliveryReceipt({
        asset: { path: 'Alembic/skills/missing' },
        contractVersion: 99,
        createdAt: '2026-05-24T10:10:00Z',
        id: 'receipt-3',
        projectRoot: '/workspace/project',
        route: 'alembic',
        skillName: 'missing',
      })
    ).toBeNull();
  });

  it('reports scope and marker identity validation issues', () => {
    const receipt = createAlembicProjectSkillDeliveryReceipt({
      asset: {
        path: 'Alembic/skills/quality/SKILL.md',
      },
      authorization: {
        required: true,
        status: 'granted',
      },
      createdAt: '2026-05-24T10:15:00Z',
      id: 'receipt-4',
      managedMarker: {
        markerPath: '.agents/skills/quality/.alembic-managed.json',
      },
      projectRoot: '/workspace/project',
      runtimeExport: {
        status: 'exported',
      },
      skillName: 'quality',
    });

    expect(validateProjectSkillDeliveryReceipt(receipt)).toMatchObject({
      issues: [
        'authorization-scope-missing',
        'runtime-export-scope-missing',
        'managed-marker-identity-missing',
      ],
      ok: false,
    });
  });
});

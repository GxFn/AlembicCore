import { describe, expect, it } from 'vitest';

import {
  createAlembicProjectSkillDeliveryReceipt,
  createPluginProjectSkillDeliveryReceipt,
  isProjectSkillDeliveryReceipt,
  normalizeProjectSkillDeliveryReceipt,
  PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
  summarizeProjectSkillDeliveryReceipt,
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
        grantedBy: 'user',
        required: true,
        status: 'granted',
      },
      createdAt: '2026-05-24T10:00:00Z',
      dimensionId: 'architecture',
      evidenceRefs: ['reports/bootstrap/architecture.md'],
      id: 'receipt-1',
      managedMarker: {
        markerPath: '.agents/skills/architecture/.alembic-managed.json',
      },
      projectId: 'project-1',
      projectRoot: '/workspace/project',
      runtimeExport: {
        linkMode: 'symlink',
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
      authorization: { status: 'granted' },
      contractVersion: PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
      dimensionId: 'architecture',
      managedMarker: {
        managedBy: 'alembic',
        route: 'alembic',
        sourcePath: 'Alembic/skills/architecture/SKILL.md',
      },
      route: 'alembic',
      runtimeExport: {
        authorizationStatus: 'granted',
        conflictStatus: 'none',
        linkMode: 'symlink',
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
      conflictStatus: 'compatible-existing',
      createdAt: '2026-05-24T10:05:00Z',
      id: 'receipt-2',
      projectRoot: '/workspace/project',
      runtimeExport: {
        conflictStatus: 'compatible-existing',
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
      authorization: { status: 'not-required' },
      conflictStatus: 'compatible-existing',
      route: 'plugin',
      runtimeExport: {
        conflictStatus: 'compatible-existing',
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
});

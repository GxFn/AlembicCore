import { describe, expect, it } from 'vitest';

import { buildCompletenessCritic } from '../src/host-agent-workflows.js';

describe('CompletenessCritic', () => {
  it('emits grounded uncovered pattern hints sorted by guidance importance', () => {
    const result = buildCompletenessCritic({
      dimensionId: 'architecture',
      targetPerDimension: 5,
      submittedRecipeCount: 3,
      miningGuidance: [
        {
          id: 'layer-direction',
          title: 'Layer dependency direction',
          importance: 95,
          keywords: ['layer', 'dependency', 'direction'],
        },
        {
          id: 'feature-router',
          title: 'Feature router handoff',
          importance: 70,
          keywords: ['router', 'handoff'],
        },
      ],
      projectInfoTree: {
        facts: [
          {
            title: 'Layer dependency direction',
            description: 'The app defines one-way dependencies from UI into domain services.',
            importance: 90,
            dimensionIds: ['architecture'],
            sourceRefs: [
              'Sources/App/AppCoordinator.swift:12',
              'Sources/Domain/Repository.swift:4',
            ],
          },
          {
            title: 'Feature router handoff',
            description: 'Feature routers coordinate navigation handoff.',
            importance: 65,
            dimensionIds: ['architecture'],
            sourceRefs: ['Sources/Feature/Router.swift:30'],
          },
        ],
      },
      submittedRecipes: [
        {
          id: 'existing-network',
          sourceRefs: ['Sources/Networking/APIClient.swift:20'],
        },
      ],
    });

    expect(result.status).toBe('has-grounded-hints');
    expect(result.shouldBlockCompletion).toBe(false);
    expect(result.targetGate).toBe('advisory');
    expect(result.neededToTarget).toBe(2);
    expect(result.hints.map((hint) => hint.pattern)).toEqual([
      'Layer dependency direction',
      'Feature router handoff',
    ]);
    expect(result.hints[0]?.sourceRefs.map((ref) => ref.path)).toContain(
      'Sources/App/AppCoordinator.swift'
    );
    expect(result.sortedMiningGuidance.map((guidance) => guidance.id)).toEqual([
      'layer-direction',
      'feature-router',
    ]);
  });

  it('does not repeat project facts whose source refs are already covered', () => {
    const result = buildCompletenessCritic({
      dimensionId: 'architecture',
      submittedRecipeCount: 3,
      miningGuidance: [
        {
          id: 'dependency-boundary',
          title: 'Dependency boundary',
          importance: 90,
          keywords: ['dependency', 'boundary'],
        },
      ],
      projectInfoTree: {
        facts: [
          {
            title: 'Dependency boundary',
            description: 'Already covered by a submitted Recipe.',
            importance: 90,
            dimensionIds: ['architecture'],
            sourceRefs: ['Sources/Core/DependencyBoundary.swift:42'],
          },
        ],
      },
      submittedRecipes: [
        {
          id: 'covered',
          sourceRefs: ['Sources/Core/DependencyBoundary.swift:42'],
        },
      ],
    });

    expect(result.hints).toEqual([]);
    expect(result.sortedMiningGuidance[0]).toMatchObject({
      id: 'dependency-boundary',
      coverageStatus: 'covered',
    });
    expect(result.status).toBe('insufficient-grounded-evidence');
  });

  it('supports an exhausted no-padding result with an explicit reason', () => {
    const result = buildCompletenessCritic({
      dimensionId: 'testing-quality',
      submittedRecipeCount: 3,
      targetPerDimension: 5,
      noPadding: true,
      exhaustedReason:
        'Reviewed all test targets and the project has only three grounded testing patterns.',
      projectInfoTree: {
        facts: [],
      },
    });

    expect(result.status).toBe('exhausted');
    expect(result.hints).toEqual([]);
    expect(result.exhaustedReason).toContain('three grounded testing patterns');
    expect(result.notes.join('\n')).toContain('noPadding honored');
  });

  it('keeps target count advisory when no grounded missing pattern is supplied', () => {
    const result = buildCompletenessCritic({
      dimensionId: 'security-auth',
      submittedRecipeCount: 3,
      targetPerDimension: 5,
      miningGuidance: [
        {
          id: 'auth-token',
          title: 'Auth token lifecycle',
          importance: 90,
          keywords: ['auth', 'token'],
        },
      ],
      projectInfoTree: {
        facts: [
          {
            title: 'Ungrounded auth token note',
            description: 'This fact has no sourceRefs and must not become a hint.',
            importance: 90,
            dimensionIds: ['security-auth'],
          },
        ],
      },
    });

    expect(result.status).toBe('insufficient-grounded-evidence');
    expect(result.hints).toEqual([]);
    expect(result.shouldBlockCompletion).toBe(false);
    expect(result.targetGate).toBe('advisory');
  });
});

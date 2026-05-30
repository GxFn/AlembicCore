import { describe, expect, it } from 'vitest';

import { buildProjectSnapshot } from '../src/project-intelligence.js';
import type { DimensionDef, ProjectSnapshot } from '../src/types/project-snapshot.js';
import {
  buildColdStartSelectionSummary,
  createInternalColdStartIntent,
  presentInternalColdStartResponse,
} from '../src/workflows/cold-start/index.js';

function makeSnapshot(activeDimensions: DimensionDef[]): ProjectSnapshot {
  return buildProjectSnapshot({
    projectRoot: '/project',
    allFiles: [
      {
        name: 'a.ts',
        path: '/project/src/a.ts',
        relativePath: 'src/a.ts',
        content: 'export const a = 1;',
        targetName: 'app',
      },
    ],
    allTargets: [{ name: 'app', type: 'application' }],
    discoverer: { id: 'generic', displayName: 'Generic' },
    langStats: { ts: 1 },
    primaryLang: 'typescript',
    astProjectSummary: null,
    astContext: null,
    codeEntityResult: null,
    callGraphResult: null,
    panoramaResult: null,
    depGraphData: null,
    guardAudit: null,
    activeDimensions,
    enhancementPackInfo: [],
    enhancementPatterns: [],
    enhancementGuardRules: [],
    warnings: [],
  });
}

describe('cold start dimension selection summaries', () => {
  const activeDimensions: DimensionDef[] = [
    { id: 'api', label: 'API', skillWorthy: false },
    { id: 'architecture', label: 'Architecture', skillWorthy: true },
    { id: 'quality', label: 'Quality', skillWorthy: false },
  ];

  it('records requested, duplicate, unknown, and filtered dimension IDs', () => {
    const snapshot = makeSnapshot(activeDimensions);
    const intent = createInternalColdStartIntent({
      dimensions: ['api', 'architecture', 'api', 'missing'],
    });

    const summary = buildColdStartSelectionSummary({
      snapshot,
      intent,
      selectedDimensions: [activeDimensions[0]!],
    });

    expect(summary).toEqual({
      activeCount: 3,
      duplicateCollapsedCount: 1,
      duplicateRequestedDimensionIds: ['api'],
      requestedCount: 4,
      requestedDimensionIds: ['api', 'architecture', 'api', 'missing'],
      requestedUniqueCount: 3,
      selectedCount: 1,
      selectedDimensionIds: ['api'],
      skippedRequestedDimensions: [
        { id: 'missing', reason: 'unknown-requested-dimension' },
        { id: 'architecture', reason: 'filtered-after-selection' },
      ],
      unknownRequestedDimensionIds: ['missing'],
    });
  });

  it('keeps bootstrap skeleton fields and selection diagnostics in the response', () => {
    const snapshot = makeSnapshot(activeDimensions);
    const intent = createInternalColdStartIntent({ dimensions: ['api', 'missing'] });
    const selectedDimensions = [activeDimensions[0]!];
    const selectionSummary = buildColdStartSelectionSummary({
      snapshot,
      intent,
      selectedDimensions,
    });

    const response = presentInternalColdStartResponse({
      cleanupResult: { deletedFiles: 0, clearedTables: [], preservedRecipes: 0, errors: [] },
      snapshot,
      report: { phases: {} },
      targetFileMap: {},
      dimensions: selectedDimensions,
      cachedSessionId: 'session-1',
      selectionSummary,
      taskCount: 1,
      bootstrapSession: { toJSON: () => ({ id: 'session-1', dimensions: ['api'] }) },
      responseTimeMs: 12,
    });

    expect(response).toMatchObject({
      success: true,
      data: {
        sessionId: 'session-1',
        bootstrapCandidates: { status: 'filling' },
        autoSkills: { status: 'filling' },
        dimensionSelection: {
          selectedDimensionIds: ['api'],
          unknownRequestedDimensionIds: ['missing'],
        },
        analysisFramework: {
          dimensionSelection: {
            selectedDimensionIds: ['api'],
            unknownRequestedDimensionIds: ['missing'],
          },
        },
        bootstrapSession: { id: 'session-1', dimensions: ['api'] },
      },
    });
  });
});

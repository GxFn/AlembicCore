import type { DimensionDef, ProjectSnapshot } from '../../types/ProjectSnapshot.js';
import type {
  ProjectAnalysisMaterializationPlan,
  ProjectAnalysisPreparationOptions,
  ProjectAnalysisScanOptions,
} from '../shared/ProjectAnalysisPlanTypes.js';
import type { ColdStartWorkflowIntent } from './ColdStartIntent.js';
import { buildProjectIndexWorkflowPlanParts } from './ProjectIndexPlan.js';

export interface ColdStartWorkflowPlan {
  intent: ColdStartWorkflowIntent;
  cleanup: {
    policy: 'full-reset';
    projectRoot: string;
    dataRoot: string;
  };
  projectAnalysis: {
    projectRoot: string;
    prepare: ProjectAnalysisPreparationOptions;
    scan: ProjectAnalysisScanOptions;
    materialize: ProjectAnalysisMaterializationPlan;
  };
  response: {
    tool: 'alembic_bootstrap';
  };
}

export type ColdStartSelectionSkipReason =
  | 'unknown-requested-dimension'
  | 'filtered-after-selection';

export interface ColdStartSelectionSummary {
  activeCount: number;
  duplicateCollapsedCount: number;
  duplicateRequestedDimensionIds: string[];
  requestedCount: number;
  requestedDimensionIds: string[];
  requestedUniqueCount: number;
  selectedCount: number;
  selectedDimensionIds: string[];
  skippedRequestedDimensions: Array<{ id: string; reason: ColdStartSelectionSkipReason }>;
  unknownRequestedDimensionIds: string[];
}

export function buildColdStartWorkflowPlan({
  intent,
  projectRoot,
  dataRoot,
}: {
  intent: ColdStartWorkflowIntent;
  projectRoot: string;
  dataRoot: string;
}): ColdStartWorkflowPlan {
  const parts = buildProjectIndexWorkflowPlanParts({
    mode: 'full',
    intent,
    projectRoot,
    dataRoot,
  });

  return {
    intent,
    cleanup: parts.cleanup,
    projectAnalysis: parts.projectAnalysis,
    response: { tool: 'alembic_bootstrap' },
  };
}

export function selectColdStartDimensions(
  snapshot: ProjectSnapshot,
  intent: ColdStartWorkflowIntent
) {
  const dimensions = [...snapshot.activeDimensions];
  if (!intent.dimensionIds?.length) {
    return dimensions;
  }
  const requestedIds = new Set(intent.dimensionIds);
  return dimensions.filter((dimension) => requestedIds.has(dimension.id));
}

export function buildColdStartSelectionSummary({
  snapshot,
  intent,
  selectedDimensions,
}: {
  snapshot: ProjectSnapshot;
  intent: ColdStartWorkflowIntent;
  selectedDimensions: readonly DimensionDef[];
}): ColdStartSelectionSummary {
  const requestedDimensionIds = intent.dimensionIds ?? [];
  const requestedCounts = new Map<string, number>();
  for (const id of requestedDimensionIds) {
    requestedCounts.set(id, (requestedCounts.get(id) ?? 0) + 1);
  }
  const uniqueRequestedIds = [...requestedCounts.keys()];
  const duplicateRequestedDimensionIds = [...requestedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const activeIds = new Set(snapshot.activeDimensions.map((dimension) => dimension.id));
  const selectedIds = new Set(selectedDimensions.map((dimension) => dimension.id));
  const unknownRequestedDimensionIds = uniqueRequestedIds.filter((id) => !activeIds.has(id));
  const skippedRequestedDimensions = uniqueRequestedIds
    .filter((id) => activeIds.has(id) && !selectedIds.has(id))
    .map((id) => ({ id, reason: 'filtered-after-selection' as const }));

  return {
    activeCount: snapshot.activeDimensions.length,
    duplicateCollapsedCount: requestedDimensionIds.length - uniqueRequestedIds.length,
    duplicateRequestedDimensionIds,
    requestedCount: requestedDimensionIds.length,
    requestedDimensionIds,
    requestedUniqueCount: uniqueRequestedIds.length,
    selectedCount: selectedDimensions.length,
    selectedDimensionIds: selectedDimensions.map((dimension) => dimension.id),
    skippedRequestedDimensions: [
      ...unknownRequestedDimensionIds.map((id) => ({
        id,
        reason: 'unknown-requested-dimension' as const,
      })),
      ...skippedRequestedDimensions,
    ],
    unknownRequestedDimensionIds,
  };
}

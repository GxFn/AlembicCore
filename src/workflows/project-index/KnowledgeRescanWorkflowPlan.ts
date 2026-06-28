import type { DimensionDef } from '../../types/ProjectSnapshot.js';
import type {
  ProjectAnalysisMaterializationPlan,
  ProjectAnalysisPreparationOptions,
  ProjectAnalysisScanOptions,
} from '../shared/ProjectAnalysisPlanTypes.js';
import type { KnowledgeRescanWorkflowIntent } from './KnowledgeRescanIntent.js';
import { buildProjectIndexWorkflowPlanParts } from './ProjectIndexPlan.js';

export interface KnowledgeRescanWorkflowPlan {
  intent: KnowledgeRescanWorkflowIntent;
  cleanup: {
    policy: 'none' | 'force-rescan' | 'rescan-clean';
    projectRoot: string;
  };
  projectAnalysis: {
    projectRoot: string;
    prepare: ProjectAnalysisPreparationOptions;
    scan: ProjectAnalysisScanOptions;
    materialize: ProjectAnalysisMaterializationPlan;
  };
  response: {
    tool: 'alembic_rescan';
  };
}

export function buildKnowledgeRescanWorkflowPlan({
  intent,
  projectRoot,
  dataRoot,
}: {
  intent: KnowledgeRescanWorkflowIntent;
  projectRoot: string;
  dataRoot: string;
}): KnowledgeRescanWorkflowPlan {
  const parts = buildProjectIndexWorkflowPlanParts({
    mode: 'incremental',
    intent,
    projectRoot,
    dataRoot,
  });

  return {
    intent,
    cleanup: parts.cleanup,
    projectAnalysis: parts.projectAnalysis,
    response: { tool: 'alembic_rescan' },
  };
}

export function selectKnowledgeRescanDimensions(
  dimensions: readonly DimensionDef[],
  intent: KnowledgeRescanWorkflowIntent
): DimensionDef[] {
  const allDimensions = [...dimensions];
  if (!intent.dimensionIds?.length) {
    return allDimensions;
  }
  const requestedIds = new Set(intent.dimensionIds);
  return allDimensions.filter((dimension) => requestedIds.has(dimension.id));
}

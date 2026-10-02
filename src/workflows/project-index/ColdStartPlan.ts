import type {
  ProjectAnalysisMaterializationPlan,
  ProjectAnalysisPreparationOptions,
  ProjectAnalysisScanOptions,
} from '../shared/ProjectAnalysisPlanTypes.js';
import type { ColdStartWorkflowIntent } from './ColdStartIntent.js';
import { buildGenerateWorkflowPlanParts } from './ProjectIndexPlan.js';

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

export function buildColdStartWorkflowPlan({
  intent,
  projectRoot,
  dataRoot,
}: {
  intent: ColdStartWorkflowIntent;
  projectRoot: string;
  dataRoot: string;
}): ColdStartWorkflowPlan {
  const parts = buildGenerateWorkflowPlanParts({
    mode: 'full',
    intent,
    projectRoot,
    dataRoot,
  });
  const planIntent = withPlanSourceFolders(intent, parts.projectAnalysis.scan.sourceFolders);

  return {
    intent: planIntent,
    cleanup: parts.cleanup,
    projectAnalysis: parts.projectAnalysis,
    response: { tool: 'alembic_bootstrap' },
  };
}

function withPlanSourceFolders(
  intent: ColdStartWorkflowIntent,
  sourceFolders: string[] | undefined
): ColdStartWorkflowIntent {
  if (!sourceFolders?.length) {
    return intent;
  }
  return {
    ...intent,
    projectAnalysis: {
      ...intent.projectAnalysis,
      sourceFolders: [...sourceFolders],
    },
  };
}

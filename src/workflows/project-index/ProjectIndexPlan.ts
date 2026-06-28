import type { ProjectAnalysisMaterializationPlan } from '../shared/ProjectAnalysisPlanTypes.js';
import type { ColdStartWorkflowIntent } from './ColdStartIntent.js';
import type { KnowledgeRescanWorkflowIntent } from './KnowledgeRescanIntent.js';

export type ProjectIndexMode = 'full' | 'incremental';

type ProjectIndexIntentByMode = {
  full: ColdStartWorkflowIntent;
  incremental: KnowledgeRescanWorkflowIntent;
};

type ProjectIndexCleanupByMode = {
  full: {
    policy: 'full-reset';
    projectRoot: string;
    dataRoot: string;
  };
  incremental: {
    policy: 'none' | 'force-rescan' | 'rescan-clean';
    projectRoot: string;
  };
};

export interface ProjectIndexWorkflowPlanParts<Mode extends ProjectIndexMode> {
  cleanup: ProjectIndexCleanupByMode[Mode];
  projectAnalysis: {
    projectRoot: string;
    prepare: Mode extends 'full'
      ? { clearOldData: true; dataRoot?: string }
      : Record<string, never>;
    scan: {
      maxFiles: number;
      contentMaxLines: number;
      skipGuard?: boolean;
      sourceTag: ProjectIndexIntentByMode[Mode]['projectAnalysis']['sourceTag'];
      summaryPrefix?: string;
      generateReport: true;
      generateAstContext: boolean;
      incremental: boolean;
      logPrefix: Mode extends 'full' ? 'Bootstrap' : 'Rescan';
    };
    materialize: ProjectAnalysisMaterializationPlan;
  };
}

type BuildProjectIndexWorkflowPlanPartsInput<Mode extends ProjectIndexMode> = {
  dataRoot: string;
  intent: ProjectIndexIntentByMode[Mode];
  mode: Mode;
  projectRoot: string;
};

export function buildProjectIndexWorkflowPlanParts<Mode extends ProjectIndexMode>(
  input: BuildProjectIndexWorkflowPlanPartsInput<Mode>
): ProjectIndexWorkflowPlanParts<Mode> {
  const materialize: ProjectAnalysisMaterializationPlan = {
    sourceGraph: true,
    dependencyEdges: true,
    moduleEntities: true,
    guardViolations: true,
  };

  if (input.mode === 'full') {
    const intent = input.intent as ColdStartWorkflowIntent;
    return {
      cleanup: {
        policy: 'full-reset',
        projectRoot: intent.executor === 'host-agent' ? input.dataRoot : input.projectRoot,
        dataRoot: input.dataRoot,
      },
      projectAnalysis: {
        projectRoot: input.projectRoot,
        prepare: {
          clearOldData: true,
          ...(intent.executor === 'host-agent' ? { dataRoot: input.dataRoot } : {}),
        },
        scan: {
          maxFiles: intent.projectAnalysis.maxFiles,
          contentMaxLines: intent.projectAnalysis.contentMaxLines,
          skipGuard: intent.projectAnalysis.skipGuard,
          sourceTag: intent.projectAnalysis.sourceTag,
          summaryPrefix: intent.projectAnalysis.summaryPrefix,
          generateReport: true,
          generateAstContext: intent.projectAnalysis.generateAstContext,
          incremental: false,
          logPrefix: 'Bootstrap',
        },
        materialize,
      },
    } as ProjectIndexWorkflowPlanParts<Mode>;
  }

  const intent = input.intent as KnowledgeRescanWorkflowIntent;
  return {
    cleanup: {
      policy: intent.cleanupPolicy,
      projectRoot: input.dataRoot,
    },
    projectAnalysis: {
      projectRoot: input.projectRoot,
      prepare: {},
      scan: {
        maxFiles: intent.projectAnalysis.maxFiles,
        contentMaxLines: intent.projectAnalysis.contentMaxLines,
        sourceTag: intent.projectAnalysis.sourceTag,
        summaryPrefix: intent.projectAnalysis.summaryPrefix,
        generateReport: true,
        generateAstContext: intent.projectAnalysis.generateAstContext,
        incremental: intent.analysisMode === 'incremental',
        logPrefix: 'Rescan',
      },
      materialize,
    },
  } as ProjectIndexWorkflowPlanParts<Mode>;
}

import { normalizeDimensionIds, type WorkflowExecutor } from '../shared/WorkflowTypes.js';

export type KnowledgeRescanExecutor = WorkflowExecutor;

export interface RescanInput {
  force?: boolean;
  dimensions?: unknown;
  reason?: string | null;
  [key: string]: unknown;
}

export interface InternalKnowledgeRescanArgs extends RescanInput {
  skipAsyncFill?: boolean;
}

export interface KnowledgeRescanProjectAnalysisIntent {
  maxFiles: number;
  contentMaxLines: number;
  sourceTag: 'rescan-internal' | 'rescan-host-agent';
  summaryPrefix: string;
  generateAstContext: boolean;
}

export interface InternalKnowledgeRescanExecutionIntent {
  skipAsyncFill: boolean;
}

export interface KnowledgeRescanWorkflowIntent {
  kind: 'knowledge-rescan';
  executor: KnowledgeRescanExecutor;
  analysisMode: 'incremental' | 'full';
  cleanupPolicy: 'none' | 'force-rescan' | 'rescan-clean';
  completionPolicy: 'auto-fill' | 'host-agent-dimension-complete';
  projectAnalysis: KnowledgeRescanProjectAnalysisIntent;
  dimensionIds?: string[];
  reason?: string | null;
  internalExecution?: InternalKnowledgeRescanExecutionIntent;
}

export function createInternalKnowledgeRescanIntent(
  args: InternalKnowledgeRescanArgs
): KnowledgeRescanWorkflowIntent {
  const forceMode = args.force ?? false;
  const cleanupPolicy = forceMode ? 'force-rescan' : 'rescan-clean';
  return {
    kind: 'knowledge-rescan',
    executor: 'internal-agent',
    analysisMode: forceMode ? 'full' : 'incremental',
    cleanupPolicy,
    completionPolicy: 'auto-fill',
    projectAnalysis: {
      maxFiles: 500,
      contentMaxLines: 120,
      sourceTag: 'rescan-internal',
      summaryPrefix: 'Rescan-Internal scan',
      generateAstContext: true,
    },
    dimensionIds: normalizeDimensionIds(args.dimensions),
    reason: args.reason || null,
    internalExecution: {
      skipAsyncFill: args.skipAsyncFill ?? false,
    },
  };
}

export function createHostAgentKnowledgeRescanIntent(
  args: RescanInput
): KnowledgeRescanWorkflowIntent {
  const forceMode = args.force ?? false;
  const cleanupPolicy = forceMode ? 'force-rescan' : 'rescan-clean';
  return {
    kind: 'knowledge-rescan',
    executor: 'host-agent',
    analysisMode: forceMode ? 'full' : 'incremental',
    cleanupPolicy,
    completionPolicy: 'host-agent-dimension-complete',
    projectAnalysis: {
      maxFiles: 500,
      contentMaxLines: 120,
      sourceTag: 'rescan-host-agent',
      summaryPrefix: 'Rescan scan',
      generateAstContext: false,
    },
    dimensionIds: normalizeDimensionIds(args.dimensions),
    reason: args.reason || null,
  };
}

// normalizeDimensionIds → imported from WorkflowTypes

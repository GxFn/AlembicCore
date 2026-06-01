import { normalizeDimensionIds, type WorkflowExecutor } from '../shared/WorkflowTypes.js';

export type ColdStartExecutor = WorkflowExecutor;

export interface InternalColdStartArgs {
  maxFiles?: number;
  skipGuard?: boolean;
  contentMaxLines?: number;
  incremental?: boolean;
  skipAsyncFill?: boolean;
  skipTargetDelivery?: boolean;
  loadSkills?: boolean;
  dimensions?: string[];
  [key: string]: unknown;
}

export interface ColdStartProjectAnalysisIntent {
  maxFiles: number;
  contentMaxLines: number;
  skipGuard: boolean;
  sourceTag: 'bootstrap' | 'bootstrap-host-agent';
  summaryPrefix?: string;
  generateAstContext: boolean;
}

export interface InternalColdStartExecutionIntent {
  skipAsyncFill: boolean;
  skipTargetDelivery: boolean;
}

export interface ColdStartWorkflowIntent {
  kind: 'cold-start';
  executor: ColdStartExecutor;
  analysisMode: 'full';
  cleanupPolicy: 'full-reset';
  completionPolicy: 'auto-fill' | 'host-agent-dimension-complete';
  projectAnalysis: ColdStartProjectAnalysisIntent;
  dimensionIds?: string[];
  internalExecution?: InternalColdStartExecutionIntent;
  ignoredFileDiffIncremental: boolean;
}

export function createInternalColdStartIntent(
  args: InternalColdStartArgs = {}
): ColdStartWorkflowIntent {
  return {
    kind: 'cold-start',
    executor: 'internal-agent',
    analysisMode: 'full',
    cleanupPolicy: 'full-reset',
    completionPolicy: 'auto-fill',
    projectAnalysis: {
      maxFiles: args.maxFiles ?? 500,
      contentMaxLines: args.contentMaxLines ?? 120,
      skipGuard: args.skipGuard ?? false,
      sourceTag: 'bootstrap',
      generateAstContext: true,
    },
    dimensionIds: normalizeDimensionIds(args.dimensions),
    internalExecution: {
      skipAsyncFill: args.skipAsyncFill ?? false,
      skipTargetDelivery: args.skipTargetDelivery ?? false,
    },
    ignoredFileDiffIncremental: args.incremental === true,
  };
}

export function createHostAgentColdStartIntent(): ColdStartWorkflowIntent {
  return {
    kind: 'cold-start',
    executor: 'host-agent',
    analysisMode: 'full',
    cleanupPolicy: 'full-reset',
    completionPolicy: 'host-agent-dimension-complete',
    projectAnalysis: {
      maxFiles: 500,
      contentMaxLines: 120,
      skipGuard: false,
      sourceTag: 'bootstrap-host-agent',
      summaryPrefix: 'Bootstrap host-agent scan',
      generateAstContext: false,
    },
    ignoredFileDiffIncremental: false,
  };
}

// normalizeDimensionIds, normalizeStringArray → imported from WorkflowTypes

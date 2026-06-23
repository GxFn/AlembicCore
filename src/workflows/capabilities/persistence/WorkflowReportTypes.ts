import type { BootstrapFile, IncrementalPlan } from '../../../types/workflows.js';
import type { MiningSessionStore } from '../host-agent/MiningSessionStore.js';
import type { FileDiffPlanner } from './FileDiffPlanner.js';

export interface DimensionStat {
  candidateCount?: number;
  rejectedCount?: number;
  toolCallCount?: number;
  durationMs?: number;
  tokenUsage?: { input: number; output: number };
  [key: string]: unknown;
}

export interface CandidateResults {
  created: number;
  failed: number;
  errors: unknown[];
  [key: string]: unknown;
}

export interface SkillResults {
  created: number;
  failed: number;
  skills?: unknown[];
  errors?: unknown[];
  [key: string]: unknown;
}

export interface WorkflowCompletionSummary {
  mode?: string;
  isolation?: string;
  deliveryVerification?: unknown;
  semanticMemory?: unknown;
  [key: string]: unknown;
}

export interface WorkflowReportConsolidationResult {
  total: {
    added: number;
    updated: number;
    merged: number;
    skipped: number;
  };
  durationMs?: number;
  [key: string]: unknown;
}

export interface WorkflowReport {
  version: string;
  timestamp: string;
  project: { name: string; files: number; lang: string };
  duration: { totalMs: number; totalSec: number };
  dimensions: Record<string, Record<string, unknown>>;
  totals: Record<string, unknown>;
  checkpoints: { restored: string[] };
  incremental: Record<string, unknown> | null;
  semanticMemory: Record<string, unknown> | null;
  completion?: WorkflowCompletionSummary | null;
  snapshot?: WorkflowSnapshotSummary | null;
  session?: Record<string, unknown>;
  terminal?: Record<string, unknown>;
  [key: string]: unknown;
}

export type WorkflowSnapshotStatus = 'saved' | 'skipped' | 'failed';

export interface WorkflowSnapshotSummary {
  status: WorkflowSnapshotStatus;
  id: string | null;
  reason?: string;
  fileCount?: number;
  dimensionCount?: number;
}

export interface WorkflowResultPersistenceContext {
  container: {
    get(name: string): unknown;
    singletons?: Record<string, unknown>;
  };
}

export interface PersistWorkflowResultOptions {
  ctx: WorkflowResultPersistenceContext;
  dataRoot: string;
  projectRoot: string;
  projectInfo: { name: string; fileCount: number; lang: string };
  sessionId: string;
  allFiles: BootstrapFile[] | null;
  sessionStore: MiningSessionStore;
  dimensionStats: Record<string, DimensionStat>;
  candidateResults: CandidateResults;
  skillResults: SkillResults;
  consolidationResult: WorkflowReportConsolidationResult | null;
  completionSummary?: WorkflowCompletionSummary | null;
  skippedDims: string[];
  incrementalSkippedDims: string[];
  isIncremental?: boolean | null;
  incrementalPlan?: IncrementalPlan | null;
  enableParallel: boolean;
  concurrency: number;
  startedAtMs: number;
  createFileDiffPlanner?: (
    db: unknown,
    projectRoot: string
  ) => Pick<FileDiffPlanner, 'saveSnapshot'>;
}

export interface WorkflowResultPersistenceResult {
  totalTimeMs: number;
  totalTokenUsage: { input: number; output: number };
  totalToolCalls: number;
  report: WorkflowReport | null;
  snapshotId: string | null;
  snapshot: WorkflowSnapshotSummary;
}

import Logger from '../../../infrastructure/logging/Logger.js';
import type { IncrementalPlan } from '../../../types/workflows.js';
import { clearDimensionCheckpoints } from './DimensionCheckpoint.js';
import type {
  DimensionStat,
  PersistWorkflowResultOptions,
  WorkflowResultPersistenceResult,
} from './WorkflowReportTypes.js';
import { writeWorkflowReport } from './WorkflowReportWriter.js';
import { createDefaultFileDiffPlanner, saveWorkflowSnapshot } from './WorkflowSnapshotStore.js';

const logger = Logger.getInstance();

export async function persistWorkflowResult({
  ctx,
  dataRoot,
  projectRoot,
  projectInfo,
  sessionId,
  allFiles,
  sessionStore,
  dimensionStats,
  candidateResults,
  skillResults,
  consolidationResult,
  completionSummary,
  skippedDims,
  incrementalSkippedDims,
  isIncremental,
  incrementalPlan,
  enableParallel,
  concurrency,
  startedAtMs,
  createFileDiffPlanner = createDefaultFileDiffPlanner,
}: PersistWorkflowResultOptions): Promise<WorkflowResultPersistenceResult> {
  const totalTimeMs = Date.now() - startedAtMs;
  const { totalTokenUsage, totalToolCalls } = summarizeWorkflowDimensionStats(dimensionStats);
  logBootstrapSummary({
    totalTimeMs,
    totalTokenUsage,
    totalToolCalls,
    candidateResults,
    skillResults,
    consolidationResult,
    completionSummary,
    skippedDims,
    incrementalSkippedDims,
    isIncremental,
    incrementalPlan,
    enableParallel,
    concurrency,
  });

  const snapshot = saveWorkflowSnapshot({
    ctx,
    projectRoot,
    sessionId,
    allFiles,
    dimensionStats,
    sessionStore,
    totalTimeMs,
    candidateResults,
    primaryLang: projectInfo.lang,
    isIncremental,
    incrementalPlan,
    createFileDiffPlanner,
  });

  const report = await writeWorkflowReport({
    ctx,
    dataRoot,
    sessionId,
    projectRoot,
    projectInfo,
    dimensionStats,
    candidateResults,
    skillResults,
    consolidationResult,
    completionSummary,
    snapshotSummary: snapshot,
    skippedDims,
    incrementalSkippedDims,
    isIncremental,
    incrementalPlan,
    totalTimeMs,
    totalTokenUsage,
    totalToolCalls,
  });

  // 只有快照与报告都已落盘，检查点才不再是唯一恢复依据。失败/跳过时保留它们，
  // 外层仍通过原有 snapshot.status / report 返回值决定重试，不把完成进度丢掉。
  if (snapshot.status === 'saved' && report !== null) {
    await clearDimensionCheckpoints(dataRoot, sessionId);
  } else {
    logger.warn('[WorkflowPersistence] retained checkpoints because results are not durable', {
      sessionId,
      snapshotStatus: snapshot.status,
      snapshotReason: snapshot.reason,
      reportSaved: report !== null,
      recovery: 'retry workflow result persistence before clearing dimension checkpoints',
    });
  }

  return {
    totalTimeMs,
    totalTokenUsage,
    totalToolCalls,
    report,
    snapshotId: snapshot.id,
    snapshot,
  };
}

export function summarizeWorkflowDimensionStats(dimensionStats: Record<string, DimensionStat>) {
  const totalTokenUsage = { input: 0, output: 0 };
  const totalToolCalls = Object.values(dimensionStats).reduce(
    (sum, stat) => sum + (stat.toolCallCount || 0),
    0
  );
  for (const stat of Object.values(dimensionStats)) {
    if (stat.tokenUsage) {
      totalTokenUsage.input += stat.tokenUsage.input || 0;
      totalTokenUsage.output += stat.tokenUsage.output || 0;
    }
  }
  return { totalTokenUsage, totalToolCalls };
}

function logBootstrapSummary({
  totalTimeMs,
  totalTokenUsage,
  totalToolCalls,
  candidateResults,
  skillResults,
  consolidationResult,
  completionSummary,
  skippedDims,
  incrementalSkippedDims,
  isIncremental,
  incrementalPlan,
  enableParallel,
  concurrency,
}: {
  totalTimeMs: number;
  totalTokenUsage: { input: number; output: number };
  totalToolCalls: number;
  candidateResults: import('./WorkflowReportTypes.js').CandidateResults;
  skillResults: import('./WorkflowReportTypes.js').SkillResults;
  consolidationResult: import('./WorkflowReportTypes.js').WorkflowReportConsolidationResult | null;
  completionSummary?: import('./WorkflowReportTypes.js').WorkflowCompletionSummary | null;
  skippedDims: string[];
  incrementalSkippedDims: string[];
  isIncremental?: boolean | null;
  incrementalPlan?: IncrementalPlan | null;
  enableParallel: boolean;
  concurrency: number;
}) {
  logger.info(
    [
      `[generate] ═══ Pipeline complete ═══`,
      isIncremental && incrementalPlan
        ? `  Mode: INCREMENTAL (${incrementalPlan.affectedDimensions.length} affected, ${incrementalSkippedDims.length} skipped)`
        : '',
      `  Candidates: ${candidateResults.created} created, ${candidateResults.errors.length} errors`,
      `  Skills: ${skillResults.created} created, ${skillResults.failed} failed`,
      consolidationResult
        ? `  Semantic Memory: +${consolidationResult.total.added} ADD, ~${consolidationResult.total.updated} UPDATE, ⊕${consolidationResult.total.merged} MERGE`
        : '',
      completionSummary
        ? `  Completion: ${completionSummary.mode}/${completionSummary.isolation}`
        : '',
      `  Time: ${totalTimeMs}ms (${(totalTimeMs / 1000).toFixed(1)}s)`,
      `  Mode: ${enableParallel ? `parallel (concurrency=${concurrency})` : 'serial'}`,
      `  Tokens: input=${totalTokenUsage.input}, output=${totalTokenUsage.output}`,
      `  Tool calls: ${totalToolCalls}`,
      skippedDims.length > 0 ? `  Checkpoints restored: [${skippedDims.join(', ')}]` : '',
      incrementalSkippedDims.length > 0
        ? `  Incremental skip: [${incrementalSkippedDims.join(', ')}]`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

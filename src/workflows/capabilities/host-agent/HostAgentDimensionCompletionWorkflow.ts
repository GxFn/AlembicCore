import { dimensionTags } from '../../../domain/dimension/RecipeDimension.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import { getDeveloperIdentity } from '../../../shared/developer-identity.js';
import { resolveDataRoot } from '../../../shared/resolveProjectRoot.js';
import type { DimensionDef } from '../../../types/project-snapshot.js';
import { saveDimensionCheckpoint } from '../persistence/DimensionCheckpoint.js';
import { getActiveHostAgentWorkflowSession } from './HostAgentMissionWorkflow.js';

const logger = Logger.getInstance();

export interface HostAgentDimensionCompleteArgs {
  sessionId?: unknown;
  dimensionId?: unknown;
  submittedRecipeIds?: unknown;
  analysisText?: unknown;
  referencedFiles?: unknown;
  keyFindings?: unknown;
  candidateCount?: unknown;
  crossDimensionHints?: unknown;
  [key: string]: unknown;
}

interface HostAgentCompletionLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  debug?(msg: string, meta?: Record<string, unknown>): void;
}

export interface HostAgentSessionContainer {
  get(name: string): unknown;
  services?: Record<string, unknown>;
  singletons?: Record<string, unknown>;
}

interface HostAgentCompletionContainer extends HostAgentSessionContainer {
  get(name: string): unknown;
}

export interface HostAgentDimensionCompletionContext {
  container: HostAgentCompletionContainer;
  logger?: HostAgentCompletionLogger;
  dataRoot?: string;
  [key: string]: unknown;
}

export interface HostAgentDimensionCompletionResponse<T = unknown> {
  success: boolean;
  data?: T | null;
  message?: string;
  meta?: Record<string, unknown>;
  errorCode?: string | null;
}

export interface HostAgentDimensionCompletionDependencies {
  getActiveSession?: (
    container: HostAgentSessionContainer,
    sessionId?: string
  ) => Promise<HostAgentWorkflowSession | null> | HostAgentWorkflowSession | null;
  saveCheckpoint?: typeof saveDimensionCheckpoint;
  now?: () => number;
  onDimensionComplete?: (event: HostAgentDimensionCompletedEvent) => void | Promise<void>;
}

export interface HostAgentDimensionCompletedEvent {
  sessionId: string;
  dimensionId: string;
  candidateCount: number;
  recipesBound: number;
  progress: ReturnType<HostAgentWorkflowSession['getProgress']>;
  isComplete: boolean;
  updated: boolean;
}

export interface HostAgentWorkflowSession {
  id: string;
  projectRoot: string;
  expiresAt?: number;
  dimensions: DimensionDef[];
  submissionTracker: {
    getSubmissions(dimId: string): Array<{ recipeId?: string; sources: string[] }>;
    getAccumulatedEvidence(dimId: string): unknown;
  };
  sessionStore: {
    getDimensionReport(dimId: string): unknown;
  };
  getSnapshotCache?(): {
    localPackageModules?: readonly { packageName: string; name: string }[];
  } | null;
  getProgress(): {
    completed: number;
    total: number;
    completedDimIds: string[];
    remainingDimIds: string[];
  };
  readonly isComplete: boolean;
  markDimensionComplete(
    dimensionId: string,
    report: {
      analysisText: string;
      keyFindings: string[];
      referencedFiles: string[];
      recipeIds: string[];
      candidateCount: number;
    }
  ): {
    updated: boolean;
    qualityReport?: {
      totalScore: number;
      pass: boolean;
      scores: Record<string, number>;
      suggestions: string[];
    };
  };
  storeHints(dimId: string, hints: Record<string, unknown>): void;
  getAccumulatedHints(): Record<string, unknown>;
}

interface KnowledgeEntryLike {
  tags?: string[] | string;
}

interface KnowledgeServiceLike {
  get(recipeId: string): Promise<KnowledgeEntryLike | null> | KnowledgeEntryLike | null;
  update(
    recipeId: string,
    patch: { category?: string; dimensionId?: string; tags?: string[] },
    options: { userId: string }
  ): Promise<unknown> | unknown;
}

interface KnowledgeGraphServiceLike {
  addEdge(
    fromId: string,
    fromType: string,
    toId: string,
    toType: string,
    relation: string,
    meta?: Record<string, unknown>
  ): Promise<unknown> | unknown;
}

interface AccumulatedEvidenceLike {
  completedDimSummaries: Array<{
    dimId: string;
    submissionCount: number;
    titles: string[];
    referencedFiles: string[];
  }>;
  sharedFiles: unknown[];
  negativeSignals: Array<{ pattern?: string }>;
  usedTriggers: string[];
}

interface DimensionReportLike {
  analysisText?: string;
  findings?: Array<{ finding?: string; content?: string }>;
}

interface CompletionInput {
  sessionId?: string;
  dimensionId: string;
  submittedRecipeIds: string[];
  analysisText: string;
  referencedFiles: string[];
  keyFindings: string[];
  candidateCount?: number;
  crossDimensionHints?: Record<string, unknown>;
}

/**
 * 宿主 agent 的维度完成闭环。
 *
 * Core 负责校验、从提交追踪器恢复 evidence、绑定 Recipe、保存 checkpoint、
 * 写入关键发现和返回质量反馈；Skill 生成、事件广播、交付 finalizer、
 * 具体 MCP tool meta/nextActions 均由外层仓库处理。
 */
export async function runHostAgentDimensionCompletionWorkflow(
  ctx: HostAgentDimensionCompletionContext,
  args: HostAgentDimensionCompleteArgs,
  dependencies: HostAgentDimensionCompletionDependencies = {}
): Promise<HostAgentDimensionCompletionResponse> {
  const startedAtMs = dependencies.now?.() ?? Date.now();
  const input = normalizeCompletionInput(args);
  if (!input.success) {
    return input.response;
  }

  const session = await resolveHostAgentCompletionSession({
    ctx,
    input: input.value,
    dependencies,
  });
  if (!session.success) {
    return session.response;
  }

  extendSessionTtl(session.value);

  const dimension = session.value.dimensions.find(
    (candidate: { id: string }) => candidate.id === input.value.dimensionId
  );
  if (!dimension) {
    return validationFailure(
      `Unknown dimensionId: "${input.value.dimensionId}". Valid dimensions: ${session.value.dimensions
        .map((candidate: { id: string }) => candidate.id)
        .join(', ')}`,
      'VALIDATION_ERROR'
    );
  }

  const projectRoot = session.value.projectRoot;
  const dataRoot =
    ctx.dataRoot ||
    safeResolveDataRoot(ctx.container as unknown as Parameters<typeof resolveDataRoot>[0]) ||
    projectRoot;
  const referencedFiles =
    input.value.referencedFiles.length > 0
      ? input.value.referencedFiles
      : recoverReferencedFiles(session.value, input.value.dimensionId);
  const submittedRecipeIds =
    input.value.submittedRecipeIds.length > 0
      ? input.value.submittedRecipeIds
      : recoverSubmittedRecipeIds(session.value, input.value.dimensionId);
  const candidateCount = input.value.candidateCount || submittedRecipeIds.length;

  const recipesBound = await bindSubmittedRecipes({
    ctx,
    session: session.value,
    dimensionId: input.value.dimensionId,
    submittedRecipeIds,
  });

  const { updated, qualityReport } = session.value.markDimensionComplete(input.value.dimensionId, {
    analysisText: input.value.analysisText,
    keyFindings: input.value.keyFindings,
    referencedFiles,
    recipeIds: submittedRecipeIds,
    candidateCount,
  });

  await persistDimensionCheckpoint({
    session: session.value,
    dataRoot,
    dimensionId: input.value.dimensionId,
    candidateCount,
    analysisText: input.value.analysisText,
    referencedFiles,
    submittedRecipeIds,
    recipesBound,
    dependencies,
  });
  await persistKeyFindings({
    ctx,
    session: session.value,
    dimensionId: input.value.dimensionId,
    keyFindings: input.value.keyFindings,
  });

  if (input.value.crossDimensionHints) {
    session.value.storeHints(input.value.dimensionId, input.value.crossDimensionHints);
  }

  const progress = session.value.getProgress();
  const isComplete = session.value.isComplete;
  await dependencies.onDimensionComplete?.({
    sessionId: session.value.id,
    dimensionId: input.value.dimensionId,
    candidateCount,
    recipesBound,
    progress,
    isComplete,
    updated,
  });

  const accumulatedHints = session.value.getAccumulatedHints();
  const accumulatedEvidence = session.value.submissionTracker.getAccumulatedEvidence(
    input.value.dimensionId
  ) as AccumulatedEvidenceLike;

  return {
    success: true,
    data: {
      dimensionId: input.value.dimensionId,
      updated,
      recipesBound,
      progress: `${progress.completed}/${progress.total}`,
      completedDimensions: progress.completedDimIds,
      remainingDimensions: progress.remainingDimIds,
      isBootstrapComplete: isComplete,
      accumulatedHints: Object.keys(accumulatedHints).length > 0 ? accumulatedHints : undefined,
      qualityFeedback: buildQualityFeedback({
        dimensionId: input.value.dimensionId,
        qualityReport,
      }),
      evidenceHints: buildEvidenceHints({
        session: session.value,
        isComplete,
        accumulatedEvidence,
      }),
      subpackageCoverageWarning: buildSubpackageCoverageWarning({
        session: session.value,
        dimensionId: input.value.dimensionId,
        referencedFiles,
      }),
    },
    meta: {
      source: 'alembic-core',
      responseTimeMs: (dependencies.now?.() ?? Date.now()) - startedAtMs,
    },
  };
}

function normalizeCompletionInput(
  args: HostAgentDimensionCompleteArgs
):
  | { success: true; value: CompletionInput }
  | { success: false; response: HostAgentDimensionCompletionResponse } {
  const dimensionId = typeof args.dimensionId === 'string' ? args.dimensionId : undefined;
  const analysisText = typeof args.analysisText === 'string' ? args.analysisText : undefined;
  const submittedRecipeIds = args.submittedRecipeIds ?? [];

  if (!dimensionId) {
    return {
      success: false,
      response: validationFailure('Missing required parameter: dimensionId'),
    };
  }
  if (!analysisText || analysisText.length < 10) {
    return {
      success: false,
      response: validationFailure('analysisText is required and must be at least 10 characters'),
    };
  }
  if (!Array.isArray(submittedRecipeIds)) {
    return {
      success: false,
      response: validationFailure('submittedRecipeIds must be an array of recipe ID strings'),
    };
  }

  return {
    success: true,
    value: {
      sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
      dimensionId,
      submittedRecipeIds: submittedRecipeIds.filter((id): id is string => typeof id === 'string'),
      analysisText,
      referencedFiles: stringArray(args.referencedFiles),
      keyFindings: stringArray(args.keyFindings),
      candidateCount: typeof args.candidateCount === 'number' ? args.candidateCount : undefined,
      crossDimensionHints:
        args.crossDimensionHints && typeof args.crossDimensionHints === 'object'
          ? (args.crossDimensionHints as Record<string, unknown>)
          : undefined,
    },
  };
}

async function resolveHostAgentCompletionSession({
  ctx,
  input,
  dependencies,
}: {
  ctx: HostAgentDimensionCompletionContext;
  input: CompletionInput;
  dependencies: HostAgentDimensionCompletionDependencies;
}): Promise<
  | { success: true; value: HostAgentWorkflowSession }
  | { success: false; response: HostAgentDimensionCompletionResponse }
> {
  const getActiveSession = dependencies.getActiveSession ?? getActiveHostAgentWorkflowSession;
  const session = (await getActiveSession(
    ctx.container,
    input.sessionId
  )) as HostAgentWorkflowSession | null;
  if (session) {
    return { success: true, value: session };
  }

  return {
    success: false,
    response: {
      success: false,
      message: input.sessionId
        ? `No active bootstrap session found with id: ${input.sessionId}`
        : 'No active bootstrap session. Create a host-agent mining session first.',
      errorCode: 'SESSION_NOT_FOUND',
      meta: { source: 'alembic-core' },
    },
  };
}

function extendSessionTtl(session: HostAgentWorkflowSession): void {
  if (session.expiresAt) {
    session.expiresAt = Math.max(session.expiresAt, Date.now() + 60 * 60 * 1000);
  }
}

function safeResolveDataRoot(container: Parameters<typeof resolveDataRoot>[0]): string | null {
  try {
    return resolveDataRoot(container);
  } catch {
    return null;
  }
}

function recoverReferencedFiles(session: HostAgentWorkflowSession, dimensionId: string): string[] {
  try {
    const filesFromSources = new Set<string>();
    for (const submission of session.submissionTracker.getSubmissions(dimensionId)) {
      for (const source of submission.sources) {
        filesFromSources.add(source.split(':')[0] || source);
      }
    }
    return [...filesFromSources];
  } catch {
    return [];
  }
}

function recoverSubmittedRecipeIds(
  session: HostAgentWorkflowSession,
  dimensionId: string
): string[] {
  try {
    return session.submissionTracker
      .getSubmissions(dimensionId)
      .map((submission) => submission.recipeId)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

async function bindSubmittedRecipes({
  ctx,
  session,
  dimensionId,
  submittedRecipeIds,
}: {
  ctx: HostAgentDimensionCompletionContext;
  session: HostAgentWorkflowSession;
  dimensionId: string;
  submittedRecipeIds: string[];
}): Promise<number> {
  if (submittedRecipeIds.length === 0) {
    return 0;
  }

  let recipesBound = 0;
  try {
    const knowledgeService = ctx.container.get('knowledgeService') as KnowledgeServiceLike | null;
    if (!knowledgeService) {
      return recipesBound;
    }

    for (const recipeId of submittedRecipeIds) {
      try {
        const entry = await knowledgeService.get(recipeId);
        if (!entry) {
          continue;
        }
        const newTags = [
          ...new Set([
            ...dimensionTags(dimensionId, parseExistingTags(entry.tags)),
            `bootstrap:${session.id}`,
          ]),
        ];
        await knowledgeService.update(
          recipeId,
          { dimensionId, tags: newTags },
          { userId: getDeveloperIdentity() }
        );
        recipesBound++;
      } catch (err: unknown) {
        logger.debug(
          `[DimensionComplete] Failed to tag recipe ${recipeId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err: unknown) {
    logger.warn(
      `[DimensionComplete] Recipe tagging failed (degraded): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return recipesBound;
}

function parseExistingTags(tags: string[] | string | undefined): string[] {
  if (Array.isArray(tags)) {
    return tags;
  }
  if (typeof tags !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}

async function persistDimensionCheckpoint({
  session,
  dataRoot,
  dimensionId,
  candidateCount,
  analysisText,
  referencedFiles,
  submittedRecipeIds,
  recipesBound,
  dependencies,
}: {
  session: HostAgentWorkflowSession;
  dataRoot: string;
  dimensionId: string;
  candidateCount: number;
  analysisText: string;
  referencedFiles: string[];
  submittedRecipeIds: string[];
  recipesBound: number;
  dependencies: HostAgentDimensionCompletionDependencies;
}): Promise<void> {
  try {
    const saveCheckpoint = dependencies.saveCheckpoint ?? saveDimensionCheckpoint;
    await saveCheckpoint(dataRoot, session.id, dimensionId, {
      candidateCount,
      analysisChars: analysisText.length,
      referencedFiles: referencedFiles.length,
      recipeIds: submittedRecipeIds,
      recipesBound,
    });
  } catch (err: unknown) {
    logger.warn(
      `[DimensionComplete] Checkpoint save failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function persistKeyFindings({
  ctx,
  session,
  dimensionId,
  keyFindings,
}: {
  ctx: HostAgentDimensionCompletionContext;
  session: HostAgentWorkflowSession;
  dimensionId: string;
  keyFindings: string[];
}): Promise<void> {
  try {
    const knowledgeGraphService = ctx.container.get(
      'knowledgeGraphService'
    ) as KnowledgeGraphServiceLike | null;
    if (!knowledgeGraphService || keyFindings.length === 0) {
      return;
    }
    for (const finding of keyFindings) {
      await knowledgeGraphService.addEdge(
        dimensionId,
        'dimension',
        finding.substring(0, 80),
        'finding',
        'discovered_in',
        { source: 'host-agent-bootstrap', sessionId: session.id }
      );
    }
  } catch (err: unknown) {
    logger.debug(
      `[DimensionComplete] key finding persistence skipped: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function buildQualityFeedback({
  dimensionId,
  qualityReport,
}: {
  dimensionId: string;
  qualityReport: ReturnType<HostAgentWorkflowSession['markDimensionComplete']>['qualityReport'];
}): Record<string, unknown> | undefined {
  if (!qualityReport) {
    return undefined;
  }
  const feedback = {
    totalScore: qualityReport.totalScore,
    pass: qualityReport.pass,
    scores: qualityReport.scores,
    suggestions: qualityReport.suggestions.length > 0 ? qualityReport.suggestions : undefined,
  };
  if (qualityReport.pass) {
    logger.info(
      `[DimensionComplete] Quality assessment for "${dimensionId}": score=${qualityReport.totalScore}/100`
    );
  } else {
    logger.warn(
      `[DimensionComplete] Quality assessment for "${dimensionId}": score=${qualityReport.totalScore}/100`
    );
  }
  return feedback;
}

function buildSubpackageCoverageWarning({
  session,
  dimensionId,
  referencedFiles,
}: {
  session: HostAgentWorkflowSession;
  dimensionId: string;
  referencedFiles: string[];
}): string | undefined {
  try {
    const localPackages = session.getSnapshotCache?.()?.localPackageModules;
    if (!localPackages || localPackages.length === 0 || referencedFiles.length === 0) {
      return undefined;
    }
    const uncoveredPackages: string[] = [];
    for (const localPackage of localPackages) {
      const packagePrefix = localPackage.packageName.replace(/\/$/, '');
      const covered = referencedFiles.some(
        (file) => file.includes(packagePrefix) || file.includes(localPackage.name)
      );
      if (!covered) {
        uncoveredPackages.push(localPackage.name);
      }
    }
    if (uncoveredPackages.length === 0) {
      return undefined;
    }
    logger.info(
      `[DimensionComplete] Subpackage coverage gap for "${dimensionId}": ${uncoveredPackages.join(', ')}`
    );
    return (
      `本维度未覆盖以下本地子包: ${uncoveredPackages.join(', ')}。` +
      '建议在分析中纳入这些模块的源码，以确保知识库完整性。'
    );
  } catch {
    return undefined;
  }
}

function buildEvidenceHints({
  session,
  isComplete,
  accumulatedEvidence,
}: {
  session: HostAgentWorkflowSession;
  isComplete: boolean;
  accumulatedEvidence: AccumulatedEvidenceLike;
}): Record<string, unknown> | undefined {
  if (
    isComplete ||
    (accumulatedEvidence.completedDimSummaries.length === 0 &&
      accumulatedEvidence.negativeSignals.length === 0)
  ) {
    return undefined;
  }

  return {
    previousSubmissions: accumulatedEvidence.completedDimSummaries.map((summary) => ({
      dimId: summary.dimId,
      submissionCount: summary.submissionCount,
      titles: summary.titles,
      referencedFiles: summary.referencedFiles,
    })),
    previousDimensionAnalysis: buildPreviousDimensionAnalysis(session, accumulatedEvidence),
    sharedFiles:
      accumulatedEvidence.sharedFiles.length > 0 ? accumulatedEvidence.sharedFiles : undefined,
    negativeSignals:
      accumulatedEvidence.negativeSignals.length > 0
        ? accumulatedEvidence.negativeSignals.map((signal) => signal.pattern)
        : undefined,
    usedTriggers:
      accumulatedEvidence.usedTriggers.length > 0 ? accumulatedEvidence.usedTriggers : undefined,
    _note:
      '以上为前序维度的分析证据，包含分析摘要和关键发现。请利用其中的文件引用和负空间信号，避免重复分析已覆盖的内容',
  };
}

function buildPreviousDimensionAnalysis(
  session: HostAgentWorkflowSession,
  accumulatedEvidence: AccumulatedEvidenceLike
): Array<{ dimId: string; analysisSummary: string; keyFindings: string[] }> | undefined {
  try {
    const summaries: Array<{ dimId: string; analysisSummary: string; keyFindings: string[] }> = [];
    for (const dimensionSummary of accumulatedEvidence.completedDimSummaries) {
      const report = session.sessionStore.getDimensionReport(dimensionSummary.dimId) as
        | DimensionReportLike
        | undefined;
      if (!report) {
        continue;
      }
      summaries.push({
        dimId: dimensionSummary.dimId,
        analysisSummary: (report.analysisText || '').substring(0, 500),
        keyFindings: (report.findings || [])
          .slice(0, 5)
          .map((finding) => finding.finding || finding.content || ''),
      });
    }
    return summaries.length > 0 ? summaries : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function validationFailure(
  message: string,
  errorCode = 'VALIDATION_ERROR'
): HostAgentDimensionCompletionResponse {
  return {
    success: false,
    message,
    errorCode,
    meta: { source: 'alembic-core' },
  };
}

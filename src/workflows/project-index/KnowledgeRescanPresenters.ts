import type { DimensionDef } from '../../types/ProjectSnapshot.js';
import { envelope } from '../shared/WorkflowEnvelope.js';
import type {
  HostAgentRescanEvidencePlan,
  RelevanceAuditSummary,
} from '../surfaces/planning/knowledge/KnowledgeRescanPlanner.js';
import type { CleanupResult, RecipeSnapshot } from '../surfaces/RecipeSnapshotTypes.js';

/**
 * Destructive-reset honesty (MT2 / MT1 P1 finding): the rescan response
 * claims retention ("preservedRecipes") while the cleanup deletes file
 * projections — previously without surfacing whether a snapshot exists.
 * Both presenters now ship the archive ref when the cleanup produced one,
 * and an explicit archiveMissing signal when files were deleted with NO
 * snapshot (the silent-data-loss case the shared OutputBudget
 * DestructiveResetReport contract forbids).
 */
function presentRescanArchive(cleanResult: CleanupResult): {
  archive: { folder: string; movedItems: number; dbSnapshotRows: number } | null;
  archiveMissing: boolean;
} {
  return {
    archive: cleanResult.trash ?? null,
    archiveMissing: cleanResult.deletedFiles > 0 && !cleanResult.trash,
  };
}

export function presentInternalKnowledgeRescanEmptyProject({
  responseTimeMs,
}: {
  responseTimeMs: number;
}) {
  return envelope({
    success: true,
    data: { message: 'No source files found. Nothing to rescan.' },
    meta: { tool: 'alembic_rescan', responseTimeMs },
  });
}

export function presentHostAgentKnowledgeRescanEmptyProject({
  responseTimeMs,
}: {
  responseTimeMs: number;
}) {
  return envelope({
    success: true,
    data: { message: 'No source files found. Nothing to rescan.' },
    meta: { tool: 'alembic_rescan', responseTimeMs },
  });
}

export function presentHostAgentKnowledgeRescanResponse({
  recipeSnapshot,
  cleanResult,
  auditSummary,
  briefing,
  evidencePlan,
  dimensions,
  reason,
  responseTimeMs,
}: {
  recipeSnapshot: RecipeSnapshot;
  cleanResult: CleanupResult;
  auditSummary: RelevanceAuditSummary;
  briefing: Record<string, unknown>;
  evidencePlan: HostAgentRescanEvidencePlan;
  dimensions: DimensionDef[];
  reason?: string | null;
  responseTimeMs: number;
}) {
  return envelope({
    success: true,
    data: {
      rescan: {
        preservedRecipes: recipeSnapshot.count,
        cleanedTables: cleanResult.clearedTables.length,
        cleanedFiles: cleanResult.deletedFiles,
        ...presentRescanArchive(cleanResult),
        reason: reason || null,
      },
      relevanceAudit: presentRelevanceAudit(auditSummary),
      ...briefing,
    },
    message:
      `✅ Rescan 完成项目扫描，保留 ${recipeSnapshot.count} 个 Recipe（衰退 ${evidencePlan.decayCount} 个），` +
      `${evidencePlan.coveredDimensions}/${dimensions.length} 个维度已充分覆盖。` +
      `${evidencePlan.gapSummary}` +
      `对每个维度执行三步：` +
      `(1) alembic_evolve — 过滤 allRecipes 中本维度 Recipe，读源码验证后提交决策 → ` +
      `(2) alembic_submit_knowledge({ items: [...] }) — 仅对 executionMode=produce 且 createBudget>0 的维度提交未覆盖的新模式 → ` +
      `(3) alembic_dimension_complete — 标记维度完成。` +
      `注意: evidenceHints.constraints.occupiedTriggers 中的 trigger 已被占用，请勿重复。`,
    meta: { tool: 'alembic_rescan', responseTimeMs },
  });
}

function presentRelevanceAudit(auditSummary: RelevanceAuditSummary) {
  return {
    totalAudited: auditSummary.totalAudited,
    healthy: auditSummary.healthy,
    watch: auditSummary.watch,
    decay: auditSummary.decay,
    severe: auditSummary.severe,
    dead: auditSummary.dead,
    proposalsCreated: auditSummary.proposalsCreated,
    immediateDeprecated: auditSummary.immediateDeprecated,
  };
}

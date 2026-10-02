import type { MissionBriefingResult } from '../../types/ProjectSnapshot.js';
import { envelope } from '../shared/WorkflowEnvelope.js';
import type { CleanupResult } from '../surfaces/RecipeSnapshotTypes.js';

export function presentHostAgentColdStartEmptyProject({
  responseTimeMs,
}: {
  responseTimeMs: number;
}) {
  return envelope({
    success: true,
    data: { message: 'No source files found. Nothing to bootstrap.' },
    meta: { tool: 'alembic_bootstrap', responseTimeMs },
  });
}

export function presentHostAgentColdStartResponse({
  cleanupResult,
  briefing,
  dimensionCount,
  responseTimeMs,
}: {
  cleanupResult: CleanupResult;
  briefing: MissionBriefingResult;
  dimensionCount: number;
  responseTimeMs: number;
}) {
  return envelope({
    success: true,
    data: {
      cleanup: presentFullResetCleanup(cleanupResult),
      ...briefing,
    },
    message:
      `⚠️ Bootstrap 仅完成第一步（项目扫描），你必须继续完成全部 ${dimensionCount} 个维度的分析。` +
      `请立即按 executionPlan.tiers 的顺序，对每个维度执行：` +
      `(1) 用你的代码阅读能力分析该维度相关文件 → ` +
      `(2) 调用 alembic_submit_knowledge({ items: [...] }) 提交候选知识（**每维度最少 3 条，目标 5 条**，不同关注点拆为独立候选） → ` +
      `(3) 调用 alembic_dimension_complete 标记维度完成。` +
      `不要停下来等待用户确认，直接开始第一个维度。`,
    meta: { tool: 'alembic_bootstrap', responseTimeMs },
  });
}

function presentFullResetCleanup(cleanupResult: CleanupResult) {
  return {
    deletedRecipes: cleanupResult.deletedFiles,
    clearedTables: cleanupResult.clearedTables.length,
    dbCleared: true,
    errors: cleanupResult.errors,
    trash: cleanupResult.trash ?? null,
    purgedTrash: cleanupResult.purgedTrash ?? null,
  };
}

/**
 * FileDiffPlanner — workflow 完成后的文件快照保存
 *
 * 把一次 workflow 的文件指纹、各维度引用的文件、会话记忆摘要存成一份快照
 * （FileDiffSnapshotStore）。增量计划本身由宿主给出：主体从 ProjectContext 文件快照算 diff，
 * 把结果作为 plan 传进来，这里只负责把它一并记进快照。
 *
 * 这个类原先还带一个 evaluate()——读上次快照、算 diff、推断受影响维度——从未有调用方，已删除。
 */

import type { LoggerLike, SaveSnapshotParams } from '../../../types/workflows.js';
import { FileDiffSnapshotStore } from './FileDiffSnapshotStore.js';

// ──────────────────────────────────────────────────────────────
// FileDiffPlanner 类
// ──────────────────────────────────────────────────────────────

export class FileDiffPlanner {
  #snapshot;

  #projectRoot;

  constructor(db: unknown, projectRoot: string, { logger }: { logger?: LoggerLike | null } = {}) {
    this.#snapshot = new FileDiffSnapshotStore(db, { logger });
    this.#projectRoot = projectRoot;
  }

  /**
   * 保存快照 — 在 bootstrap 完成后调用
   *
   * @param [params.meta] { durationMs, candidateCount, primaryLang }
   * @param [params.plan] 宿主给出的增量计划 (增量时)
   * @returns 快照 ID
   */
  saveSnapshot(params: SaveSnapshotParams) {
    const { sessionId, allFiles, dimensionStats, episodicMemory, meta = {}, plan = null } = params;

    // 构建带 referencedFilesList 的 dimensionStats
    const enrichedStats = { ...dimensionStats };
    if (episodicMemory) {
      for (const dimId of episodicMemory.getCompletedDimensions()) {
        const report = episodicMemory.getDimensionReport?.(dimId);
        if (report && enrichedStats[dimId]) {
          enrichedStats[dimId] = {
            ...enrichedStats[dimId],
            referencedFilesList: report.referencedFiles || [],
          };
        }
      }
    }

    return this.#snapshot.save({
      sessionId,
      projectRoot: this.#projectRoot,
      allFiles,
      dimensionStats: enrichedStats,
      episodicData: episodicMemory?.toJSON() || null,
      meta,
      isIncremental: plan?.mode === 'incremental',
      parentId: plan?.previousSnapshot?.id || null,
      changedFiles: plan?.diff
        ? [...(plan.diff.added || []), ...(plan.diff.modified || []), ...(plan.diff.deleted || [])]
        : [],
      affectedDims: plan?.affectedDimensions || [],
    });
  }
}

export default FileDiffPlanner;

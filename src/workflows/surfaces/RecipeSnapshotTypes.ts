/**
 * Host-agent 挖掘闭环使用的 Recipe 快照契约。
 *
 * 这些类型原先来自外层 CleanupService；Core 只需要快照数据形状，
 * 不持有具体清理实现，避免把外层清理策略和运行时写入规则带进来。
 */

export interface CleanupResult {
  deletedFiles: number;
  clearedTables: string[];
  preservedRecipes: number;
  errors: string[];
  trash?: {
    folder: string;
    movedItems: number;
    dbSnapshotRows: number;
  };
  purgedTrash?: {
    count: number;
    freedBytes: number;
  };
}

// W4 批A(T3):RecipeSnapshotEntry 本体下收 types/planningViews(被 SnapshotViews 的
// rescanExecutionDecisions 视图字段类型链引用);re-export 保持本文件消费者与 facade 表面不变。
import type { RecipeSnapshotEntry } from '../../types/planningViews.js';

export type { RecipeSnapshotEntry } from '../../types/planningViews.js';

export interface RecipeSnapshot {
  count: number;
  entries: RecipeSnapshotEntry[];
  coverageByDimension: Record<string, number>;
}

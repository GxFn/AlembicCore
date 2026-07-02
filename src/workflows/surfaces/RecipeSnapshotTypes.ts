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

export interface RecipeSnapshotEntry {
  id: string;
  title: string;
  trigger: string;
  dimensionId?: string;
  category: string;
  knowledgeType: string;
  doClause: string;
  sourceFile?: string;
  lifecycle: string;
  content?: { markdown?: string; rationale?: string; coreCode?: string };
  sourceRefs?: string[];
}

export interface RecipeSnapshot {
  count: number;
  entries: RecipeSnapshotEntry[];
  coverageByDimension: Record<string, number>;
}

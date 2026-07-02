/**
 * Planning 视图契约 —— W4 批A(T2/T3)从 workflows/surfaces/planning/knowledge 与
 * RecipeSnapshotTypes 下收的纯数据类型:消解 types/SnapshotViews → workflows 的
 * type-only 反向依赖(SnapshotViews 的 evolutionPrescreen/rescanExecutionDecisions
 * 视图字段引用这里)。原定义文件保留 re-export,workflows 侧与
 * host-agent-workflows facade 表面不变。
 * 注意:本文件不进 types/index.ts barrel(防 `@alembic/core/types` 面扩张);
 * evolutionPrescreen 字段进 mission briefing 载荷=半 wire,只动类型宿主不动字段名。
 */
import type { DimensionDef } from './ProjectSnapshot.js';

// ── EvolutionPrescreen 族(sustain 预筛,原 planning/knowledge/EvolutionPrescreen.ts) ──

export interface PrescreenNeedsVerification {
  recipeId: string;
  title: string;
  dimension: string;
  relevanceVerdict: 'decay' | 'severe' | 'watch';
  relevanceScore: number;
  auditHint: string;
  decayReasons: string[];
}

export interface PrescreenAutoResolved {
  recipeId: string;
  resolution: 'auto-skip' | 'auto-deprecated';
  reason: string;
}

export interface DimensionGapInfo {
  target: number;
  healthy: number;
  observing: number;
  gap: number;
}

export interface EvolutionPrescreen {
  needsVerification: PrescreenNeedsVerification[];
  autoResolved: PrescreenAutoResolved[];
  dimensionGaps: Record<string, DimensionGapInfo>;
}

// ── Recipe 快照条目(原 workflows/surfaces/RecipeSnapshotTypes.ts) ──

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

// ── Rescan 执行决策(原 planning/knowledge/KnowledgeRescanPlanBuilder.ts) ──

export type RescanExecutionReasonKind =
  | 'manual-request'
  | 'coverage-gap'
  | 'recipe-decay'
  | 'file-change'
  | 'fully-covered';

export interface RescanExecutionReason {
  kind: RescanExecutionReasonKind;
  recipeIds?: string[];
  changedFiles?: string[];
  existing?: number;
  target?: number;
  gap?: number;
  detail?: string;
}

export type RescanExecutionMode = 'skip' | 'verify-only' | 'produce';

export interface KnowledgeRescanExecutionDecision {
  dimensionId: string;
  dimension: DimensionDef;
  mode: RescanExecutionMode;
  createBudget: number;
  existingCount: number;
  gap: number;
  existingRecipes: RecipeSnapshotEntry[];
  decayingRecipes: RecipeSnapshotEntry[];
  reasons: RescanExecutionReason[];
  shouldExecute: boolean;
}

/**
 * Snapshot Views — 面向消费者的衍生视图
 *
 * 核心理念：消费者不应直接操作 ProjectSnapshot 的每一个字段。
 * View Factory 提供针对特定消费场景的轻量级投影。
 *
 * @module types/SnapshotViews
 */

import type {
  AstSummary,
  CallGraphResult,
  CodeEntityGraphResult,
  DependencyGraph,
  ExistingRecipeInfo,
  GenerateSessionShape,
  GuardAudit,
  LocalPackageModule,
  ProjectSnapshot,
  SnapshotFile,
  SnapshotTarget,
} from './ProjectSnapshot.js';
import type { EvolutionPrescreen, KnowledgeRescanExecutionDecision } from './planningViews.js';

// ─── H4: SessionCacheShape ───────────────────────────────────

/**
 * GenerateSession.snapshotCache 的类型化形状。
 *
 * 替代之前 `Record<string, unknown>` 的擦除类型，
 * 消费端（dimension-complete-external、wiki-external）不再需要 `as` 手动转型。
 *
 */
export interface SessionCacheShape {
  readonly allFiles: readonly SnapshotFile[];
  readonly astProjectSummary: AstSummary | null;
  readonly codeEntityResult: CodeEntityGraphResult | null;
  readonly callGraphResult: CallGraphResult | null;
  readonly depGraphData: DependencyGraph | null;
  readonly guardAudit: GuardAudit | null;
  readonly langStats: Record<string, number>;
  readonly primaryLang: string;
  readonly targetsSummary: readonly SnapshotTarget[];
  readonly localPackageModules: readonly LocalPackageModule[];
}

// ─── 视图 0: PipelineFillView ────────────────────────────────

/** 管线执行模式：冷启动走全量 finalize，增量扫描走轻量收尾 */
export type PipelineMode = 'bootstrap' | 'rescan';

/** handler → dispatchPipelineFill → orchestrator 的统一入参 */
export interface PipelineFillView {
  /** 完整的项目快照（类型化、不可变） */
  readonly snapshot: ProjectSnapshot;
  /** 运行时上下文（DI container、logger 等）— 使用 Record 以兼容各种 McpContext 子类型 */
  readonly ctx: Record<string, unknown>;
  /** 当前 bootstrap session（可选，rescan 场景可能为 null） */
  readonly bootstrapSession: GenerateSessionShape | null;
  /** handler 构建的 target→files 映射 */
  readonly targetFileMap: Record<string, unknown[]>;
  /** 项目根路径 */
  readonly projectRoot: string;
  /** 已有 recipes（rescan 去重用） */
  readonly existingRecipes?: ExistingRecipeInfo[];
  /** 进化前置过滤结果（rescan 模式，Phase A 已完成时提供） */
  readonly evolutionPrescreen?: EvolutionPrescreen;
  /** Rescan 统一执行准入决策（skip / verify-only / produce） */
  readonly rescanExecutionDecisions?: readonly KnowledgeRescanExecutionDecision[];
  /** 管线模式：'bootstrap'（默认）全量 finalize | 'rescan' 轻量收尾 */
  readonly mode?: PipelineMode;
  /** 跳过会写入目标项目根目录的 Cursor/Wiki/Agent instruction 交付步骤 */
  readonly skipTargetDelivery?: boolean;
}

// ─── 视图 1: toSessionCache ──────────────────────────────────

/**
 * 从 ProjectSnapshot 提取 GenerateSession 的 phase cache 数据。
 *
 * 替代当前 handler 中手动拼装的 setSnapshotCache({...}) 调用。
 */
export function toSessionCache(snapshot: ProjectSnapshot): SessionCacheShape {
  return {
    allFiles: snapshot.allFiles,
    astProjectSummary: snapshot.ast,
    codeEntityResult: snapshot.codeEntityGraph,
    callGraphResult: snapshot.callGraph,
    depGraphData: snapshot.dependencyGraph,
    guardAudit: snapshot.guardAudit,
    langStats: snapshot.language.stats,
    primaryLang: snapshot.language.primaryLang,
    targetsSummary: snapshot.targetsSummary,
    localPackageModules: snapshot.localPackageModules,
  };
}

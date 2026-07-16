export * from './core/index.js';
export * from './daemon/index.js';
export * from './domain/index.js';
export {
  bindStrictProductionProjectionToHostAgentAnalysisUnitV1,
  buildHostAgentAnalysisPacketFromProjectContext,
  buildIDEAgentAnalysisPacketFromProjectContext,
  buildProjectContextMissionBriefing,
  createHostAgentAnalysisProgressSeed,
  createHostAgentAnalysisUnitKey,
  createHostAgentAnalysisUnitProgress,
  createHostAgentWorkflowSession,
  createIDEAgentAnalysisProgressSeed,
  createIDEAgentAnalysisUnitKey,
  createIDEAgentAnalysisUnitProgress,
  type HostAgentAnalysisDegradedReason,
  type HostAgentAnalysisPacket,
  type HostAgentAnalysisPacketBuilderOptions,
  type HostAgentAnalysisPacketProfile,
  type HostAgentAnalysisProgressSeed,
  type HostAgentAnalysisUnit,
  type HostAgentAnalysisUnitCheckpointLink,
  type HostAgentAnalysisUnitProgress,
  type HostAgentAnalysisUnitStatus,
  type HostAgentCompletionContract,
  type HostAgentDependencyHint,
  type HostAgentMissionBriefingInput,
  type HostAgentMissionBriefingResult,
  type HostAgentMissionSessionContainer,
  type HostAgentMissionWorkflowSession,
  type HostAgentProjectContextPacketInput,
  type HostAgentSourceRef,
  type HostAgentSourceRefRole,
  type HostAgentStableUnitKey,
  type HostAgentStableUnitKeyInput,
  type HostAgentStructuralEvidenceKind,
  type HostAgentStructuralEvidenceRef,
  type HostAgentStructuralHints,
  type IDEAgentAnalysisDegradedReason,
  type IDEAgentAnalysisPacket,
  type IDEAgentAnalysisPacketBuilderOptions,
  type IDEAgentAnalysisPacketProfile,
  type IDEAgentAnalysisProgressSeed,
  type IDEAgentAnalysisUnit,
  type IDEAgentAnalysisUnitCheckpointLink,
  type IDEAgentAnalysisUnitProgress,
  type IDEAgentAnalysisUnitStatus,
  type IDEAgentCompletionContract,
  type IDEAgentDependencyHint,
  type IDEAgentProjectContextPacketInput,
  type IDEAgentSourceRef,
  type IDEAgentSourceRefRole,
  type IDEAgentStableUnitKey,
  type IDEAgentStableUnitKeyInput,
  type IDEAgentStructuralEvidenceKind,
  type IDEAgentStructuralEvidenceRef,
  type IDEAgentStructuralHints,
  type ProjectContextMissionBriefingInput,
} from './host-agent-workflows.js';
export * from './infrastructure/index.js';
// 阶段 14：根入口只暴露外层收敛需要的稳定契约，避免把内部重复类型通过 export * 撞到一起。
export { KnowledgeRepositoryImpl } from './repository/knowledge/index.js';
export * from './service/index.js';
export type { SourceGraphIndexOptions } from './service/source-graph/SourceGraphIndexer.js';
// Track2(2026-07-10):source-graph 生命周期激活。该子系统此前连 service 门面都未
// 导出(全仓零调用方,四表恒 0 行);按 SD-5 先例经 ROOT 门面具名导出,消费方=
// 主体挖掘准备段(catchUpOnStartup:无快照全量/stale 增量/fresh noop,幂等)。
export {
  type SourceGraphLifecycleResult,
  SourceGraphLifecycleService,
} from './service/source-graph/SourceGraphLifecycle.js';
export { DivergenceError, PersistenceError } from './shared/errors/index.js';
// G-C P3(2026-07-10):readFileAtCommit 是漂移分类器的 git 历史读取封装,消费方为
// AlembicPlugin KnowledgeModule(gitReader 注入)。按 SD-5 B2=re-point 先例经 ROOT
// 门面具名导出,不进已冻结在 shrink-only 预算 192 的 ./shared 门面。
export { type ReadFileAtCommitOptions, readFileAtCommit } from './shared/gitBlob.js';
export * from './shared/index.js';
// SD-5 phase-2 (RW1, B2=re-point): the MT2 output-budget mechanism and the
// CO3 persistence/divergence error classes are re-pointed onto the ROOT facade
// (@alembic/core) so consumers keep a valid import path after the ./shared/*
// wildcard export is removed in RW2. The ./shared exact facade stays frozen at
// its CO1 shrink-only narrowness budget (189), so the root facade — not
// ./shared — is the stable adoption route for these surfaces.
export {
  applyOutputBudget,
  assertDestructiveResetHasArchive,
  CORE_CONTENT_SLICE_BUDGETS,
  CORE_TOOL_OUTPUT_BUDGETS,
  type DestructiveResetReport,
  type OutputBudgetClass,
  type OutputBudgetResult,
  type ToolOutputBudget,
} from './shared/OutputBudget.js';

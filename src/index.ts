export * from './core/index.js';
export * from './daemon/index.js';
export * from './domain/index.js';
export {
  buildProjectContextMissionBriefing,
  createHostAgentWorkflowSession,
  type HostAgentMissionBriefingInput,
  type HostAgentMissionBriefingResult,
  type HostAgentMissionSessionContainer,
  type HostAgentMissionWorkflowSession,
  type ProjectContextMissionBriefingInput,
} from './host-agent-workflows.js';
export * from './infrastructure/index.js';
// 阶段 14：根入口只暴露外层收敛需要的稳定契约，避免把内部重复类型通过 export * 撞到一起。
export { KnowledgeRepositoryImpl } from './repository/knowledge/index.js';
export * from './service/index.js';
export { DivergenceError, PersistenceError } from './shared/errors/index.js';
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
export {
  buildIDEAgentAnalysisPacket,
  buildIDEAgentAnalysisPacketFromProjectContext,
  buildIDEAgentAnalysisPacketFromSnapshot,
  createIDEAgentAnalysisProgressSeed,
  createIDEAgentAnalysisUnitKey,
  createIDEAgentAnalysisUnitProgress,
  type IDEAgentAnalysisDegradedReason,
  type IDEAgentAnalysisPacket,
  type IDEAgentAnalysisPacketBuilderInput,
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
} from './workflows/capabilities/project-intelligence/index.js';

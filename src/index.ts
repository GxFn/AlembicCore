export * from './core/index.js';
export * from './daemon/index.js';
export * from './domain/index.js';
export {
  createHostAgentWorkflowSession,
  type HostAgentMissionBriefingInput,
  type HostAgentMissionBriefingResult,
  type HostAgentMissionSessionContainer,
  type HostAgentMissionWorkflowSession,
} from './host-agent-workflows.js';
export * from './infrastructure/index.js';
// 阶段 14：根入口只暴露外层收敛需要的稳定契约，避免把内部重复类型通过 export * 撞到一起。
export { KnowledgeRepositoryImpl } from './repository/knowledge/index.js';
export * from './service/index.js';
export * from './shared/index.js';
export {
  buildIDEAgentAnalysisPacket,
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
  type IDEAgentSourceRef,
  type IDEAgentSourceRefRole,
  type IDEAgentStableUnitKey,
  type IDEAgentStableUnitKeyInput,
  type IDEAgentStructuralEvidenceKind,
  type IDEAgentStructuralEvidenceRef,
  type IDEAgentStructuralHints,
  ProjectIntelligenceCapability,
} from './workflows/capabilities/project-intelligence/index.js';

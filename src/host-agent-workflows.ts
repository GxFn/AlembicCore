/**
 * Host Agent workflow public facade.
 *
 * 这里稳定的是“宿主 agent 如何领取任务、提交证据、完成维度、恢复 checkpoint”
 * 的确定性协议；Codex MCP tool、Skill 文案、AgentRuntime、tool policy、
 * AI provider 和多渠道交付仍由外层仓库负责。
 */

export type {
  AnalysisArtifactProjectionV1,
  AnalysisFixpointReceiptV1,
  FactRecordV1,
  FinalExpandedMiningScheduleReceiptV1,
  HypothesisExpressionSetReceiptV1,
  KnowledgeClusterV1,
  ObservationPopulationV1,
  TypedGateReturnV1,
} from './service/production/StrictAnalysisContracts.js';
export * from './service/production/StrictAnalysisContracts.js';
export type {
  DimensionDef,
  MissionBriefingResult,
} from './types/ProjectSnapshot.js';
export * from './workflows/project-index/index.js';
export {
  buildColdStartWorkflowPlan as buildGenerateFullPlan,
  buildKnowledgeRescanWorkflowPlan as buildProjectIndexIncrementalPlan,
  type ColdStartWorkflowIntent as GenerateFullWorkflowIntent,
  createHostAgentColdStartIntent as createGenerateIntentFullHostAgent,
  createHostAgentKnowledgeRescanIntent as createGenerateIntentIncrementalHostAgent,
  createInternalColdStartIntent as createGenerateIntentFullInternal,
  createInternalKnowledgeRescanIntent as createGenerateIntentIncrementalInternal,
  type GenerateWorkflowRunMode,
  type KnowledgeRescanWorkflowIntent as GenerateIncrementalWorkflowIntent,
} from './workflows/project-index/index.js';
export * from './workflows/shared/index.js';
export {
  bindStrictProductionProjectionToHostAgentAnalysisUnitV1,
  buildHostAgentAnalysisPacketFromProjectContext,
  buildIDEAgentAnalysisPacketFromProjectContext,
  createHostAgentAnalysisProgressSeed,
  createHostAgentAnalysisUnitKey,
  createHostAgentAnalysisUnitProgress,
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
} from './workflows/surfaces/host-agent/briefing/HostAgentAnalysisPacketBuilder.js';
export type {
  ProjectSkillAssetKind,
  ProjectSkillAuthorizationStatus,
  ProjectSkillConflictStatus,
  ProjectSkillDeliveryAsset,
  ProjectSkillDeliveryAuthorization,
  ProjectSkillDeliveryEvidenceRef,
  ProjectSkillDeliveryReceipt,
  ProjectSkillDeliveryRoute,
  ProjectSkillDeliveryValidationIssue,
  ProjectSkillDeliveryValidationResult,
  ProjectSkillLinkMode,
  ProjectSkillManagedMarker,
  ProjectSkillRuntimeExportReceipt,
  ProjectSkillRuntimeExportStatus,
  ProjectSkillRuntimeExportStrategy,
} from './workflows/surfaces/host-agent/delivery/ProjectSkillDeliveryContracts.js';
export * from './workflows/surfaces/host-agent/index.js';
export * from './workflows/surfaces/persistence/index.js';
export * from './workflows/surfaces/planning/dimensions/index.js';
export * from './workflows/surfaces/planning/knowledge/index.js';
export { buildKnowledgeRescanPlan as buildProjectIndexGapPlan } from './workflows/surfaces/planning/knowledge/index.js';
export * from './workflows/surfaces/presentation/index.js';
export * from './workflows/surfaces/RecipeSnapshotTypes.js';
export * from './workflows/surfaces/WorkflowCleanupPolicies.js';

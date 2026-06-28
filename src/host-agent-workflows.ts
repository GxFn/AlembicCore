/**
 * Host Agent workflow public facade.
 *
 * 这里稳定的是“宿主 agent 如何领取任务、提交证据、完成维度、恢复 checkpoint”
 * 的确定性协议；Codex MCP tool、Skill 文案、AgentRuntime、tool policy、
 * AI provider 和多渠道交付仍由外层仓库负责。
 */

export type {
  DimensionDef,
  MissionBriefingResult,
} from './types/ProjectSnapshot.js';
export {
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
} from './workflows/capabilities/host-agent/HostAgentAnalysisPacketBuilder.js';
export * from './workflows/capabilities/host-agent/index.js';
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
} from './workflows/capabilities/host-agent/ProjectSkillDeliveryContracts.js';
export * from './workflows/capabilities/persistence/index.js';
export * from './workflows/capabilities/planning/dimensions/index.js';
export * from './workflows/capabilities/planning/knowledge/index.js';
export { buildKnowledgeRescanPlan as buildProjectIndexGapPlan } from './workflows/capabilities/planning/knowledge/index.js';
export * from './workflows/capabilities/presentation/index.js';
export * from './workflows/capabilities/RecipeSnapshotTypes.js';
export * from './workflows/capabilities/WorkflowCleanupPolicies.js';
export * from './workflows/project-index/index.js';
export {
  buildColdStartWorkflowPlan as buildProjectIndexFullPlan,
  buildKnowledgeRescanWorkflowPlan as buildProjectIndexIncrementalPlan,
  type ColdStartWorkflowIntent as ProjectIndexFullWorkflowIntent,
  createHostAgentColdStartIntent as createProjectIndexIntentFullHostAgent,
  createHostAgentKnowledgeRescanIntent as createProjectIndexIntentIncrementalHostAgent,
  createInternalColdStartIntent as createProjectIndexIntentFullInternal,
  createInternalKnowledgeRescanIntent as createProjectIndexIntentIncrementalInternal,
  type KnowledgeRescanWorkflowIntent as ProjectIndexIncrementalWorkflowIntent,
  type ProjectIndexMode,
} from './workflows/project-index/index.js';
export * from './workflows/shared/index.js';

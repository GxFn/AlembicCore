export type {
  ApplyPlanSelectionOptions,
  PlanDraftSource,
  PlanEvidenceRef,
  PlanIntent,
  PlanModuleBinding,
  PlanNextAction,
  PlanProjectProfile,
  PlanScaleDecision,
  PlanSelection,
  PlanSelectionProjection,
  PlanSelectionScaleOverride,
  PlanSelectionStageRequirementsOptions,
  PlanStageId,
} from './service/planIntent/index.js';
export {
  applyPlanSelection,
  assertPlanSelectionShape,
  assertPlanSelectionStageRequirements,
  hasPositiveStageBudget,
  normalizeConfirmedPlanIntent,
  planSelectionRequiresModuleTargets,
  unique,
  validateCompletePlanIntent,
} from './service/planIntent/index.js';
export type {
  BuildPlanDraftInformationPackageInput,
  PlanCodeRecipeMapping,
  PlanCoverageBucket,
  PlanCoverageGap,
  PlanDraftInformationPackage,
  PlanGenerationState,
  PlanSignatureComparison,
  PlanView,
  ProjectContextSignatureInput,
} from './service/recipeStatus/index.js';
export {
  buildCoverage,
  buildPlanDraftInformationPackage,
  compareProjectContextSignature,
  computeProjectContextSignature,
  projectPlanGenerationState,
  projectPlanGenerationStateFromRecords,
} from './service/recipeStatus/index.js';
export { buildKnowledgeRescanPlan as buildProjectIndexGapPlan } from './workflows/capabilities/planning/knowledge/index.js';
export {
  buildColdStartWorkflowPlan as buildProjectIndexFullPlan,
  type ColdStartWorkflowIntent as ProjectIndexFullWorkflowIntent,
  createHostAgentColdStartIntent as createProjectIndexIntentFullHostAgent,
  createInternalColdStartIntent as createProjectIndexIntentFullInternal,
} from './workflows/cold-start/index.js';
export {
  buildKnowledgeRescanWorkflowPlan as buildProjectIndexIncrementalPlan,
  createHostAgentKnowledgeRescanIntent as createProjectIndexIntentIncrementalHostAgent,
  createInternalKnowledgeRescanIntent as createProjectIndexIntentIncrementalInternal,
  type KnowledgeRescanWorkflowIntent as ProjectIndexIncrementalWorkflowIntent,
} from './workflows/knowledge-rescan/index.js';

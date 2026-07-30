/**
 * Strict production authority public facade.
 *
 * Agent 与 Main 通过这个稳定子路径共享同一组事实、分析、持久化和恢复合同；外层不应 deep
 * import `src/service/production/**`，也不应复制这些 canonicalizer。
 */

export { buildFactQueryCatalogSnapshot } from './service/plan/intent/coldStartProductionPlan.js';
export * from './service/plan/intent/strictTestDimensionProfile.js';
export {
  assertSemanticDispositionReviewDurableAttestationV3,
  assertSemanticDispositionReviewDurableAttestationV4,
  assertSemanticDispositionReviewDurableAttestationV5,
  assertSemanticDispositionReviewTrustPolicyV3,
  consumeMainSemanticDispositionReviewDurableAttestationV3,
  consumeMainSemanticDispositionReviewDurableAttestationV4,
  consumeMainSemanticDispositionReviewDurableAttestationV5,
  createProducerZeroDispositionAdmissionAuthorityV1,
  SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3,
  type SemanticDispositionReviewDurableAttestationV3,
  type SemanticDispositionReviewDurableAttestationV4,
  type SemanticDispositionReviewDurableAttestationV5,
  type SemanticDispositionReviewEvidenceStoreLoadReceiptV3,
  type SemanticDispositionReviewEvidenceStoreLoadReceiptV4,
  type SemanticDispositionReviewEvidenceStoreLoadReceiptV5,
  type SemanticDispositionReviewTrustPolicyV3,
} from './service/production/DurableSemanticDispositionReviewAuthority.js';
export * from './service/production/ProductionActorIdentity.js';
export * from './service/production/ProductionPersistenceContracts.js';
export {
  assertSemanticDispositionReviewExecutionV1,
  assertSemanticDispositionReviewRequestV1,
  consumeMainSemanticDispositionReviewExecutionV1,
  createAgentSemanticDispositionReviewExecutionV1,
  createAgentSemanticDispositionReviewRequestV1,
  type InvestigatedEmptyDispositionReviewContextV1,
  type ProducerNonDraftDispositionReviewContextV1,
  type ProducerZeroDispositionAdmissionAuthorityV1,
  SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1,
  SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
  SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
  SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V4,
  SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1,
  SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2,
  SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3,
  SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V4,
  type SemanticDispositionReviewAxisDecisionV1,
  type SemanticDispositionReviewAxisIdV1,
  type SemanticDispositionReviewCalibrationAxisV1,
  type SemanticDispositionReviewCalibrationV1,
  type SemanticDispositionReviewContextV1,
  type SemanticDispositionReviewDecisionV1,
  type SemanticDispositionReviewDecisionV2,
  type SemanticDispositionReviewDecisionV3,
  type SemanticDispositionReviewDecisionV4,
  type SemanticDispositionReviewEvidenceAuthorityV2,
  type SemanticDispositionReviewEvidenceAuthorityV3,
  type SemanticDispositionReviewEvidenceAuthorityV4,
  type SemanticDispositionReviewEvidenceFindingV1,
  type SemanticDispositionReviewEvidenceV1,
  type SemanticDispositionReviewExecutionReceiptBindingV3,
  type SemanticDispositionReviewExecutionV1,
  type SemanticDispositionReviewExecutionV2,
  type SemanticDispositionReviewExecutionV3,
  type SemanticDispositionReviewExecutionV4,
  type SemanticDispositionReviewerHostExecutionRecordV2,
  type SemanticDispositionReviewerHostInvocationV1,
  type SemanticDispositionReviewerModelLoadReceiptV1,
  type SemanticDispositionReviewHarvestGroupV4,
  type SemanticDispositionReviewHostCallV2,
  type SemanticDispositionReviewHostResultV2,
  type SemanticDispositionReviewKindV1,
  type SemanticDispositionReviewRequestV1,
  type SemanticDispositionReviewRequestV2,
  type SemanticDispositionReviewRequestV3,
  type SemanticDispositionReviewRequestV4,
} from './service/production/SemanticDispositionReviewExecution.js';
export * from './service/production/StrictAnalysisContracts.js';
export * from './service/production/StrictFactExecution.js';
export * from './service/production/StrictProductionAuthority.js';

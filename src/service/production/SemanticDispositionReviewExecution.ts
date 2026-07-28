import type { EvidenceEntry } from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import { hashBytes, hashCanonicalJson } from '../project-context/foundation/canonical.js';
import {
  assertProductionActorIdentityV1,
  createProductionActorIdentityV1,
  type ProductionActorIdentityV1,
} from './ProductionActorIdentity.js';
import {
  assertStrictAcceptedCorpusInspectionV1,
  assertStrictAdmissionReceiptV1,
  assertStrictG1ReceiptV1,
  createStrictAdmissionReceiptV1,
  type StrictAcceptedCorpusInspectionV1,
  type StrictAdmissionReceiptV1,
  type StrictG1ReceiptV1,
} from './ProductionPersistenceContracts.js';
import {
  type AnalysisFixpointReceiptV1,
  createKnowledgeDispositionReviewV1,
  type FalsificationReceiptV1,
  type FinalExpandedMiningScheduleReceiptV1,
  type HypothesisExpressionSetReceiptV1,
  hashKnowledgeDispositionProposalV1,
  type InductionReceiptV1,
  type KnowledgeDispositionExecutionBindingV1,
  type KnowledgeDispositionProposalV1,
  type KnowledgeDispositionReviewV1,
  type ObservationPopulationV1,
} from './StrictAnalysisContracts.js';
import {
  createStrictEvidenceLedgerSnapshotV1,
  type StrictEvidenceLedgerSnapshotV1,
  type StrictFactDirectWitnessBindingV1,
} from './StrictFactExecution.js';
import {
  assertReviewAuthorizingFactExecutionV1,
  type FactQueryExecutionReceiptV1,
} from './StrictFactExecutionReceipt.js';

export const SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1 =
  'alembic-agent.semantic-disposition-review-execution-v1';
export const SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1 =
  'alembic-main.strict-production-disposition-review-consumer-v1';

export type SemanticDispositionReviewKindV1 = Extract<
  KnowledgeDispositionReviewV1['reviewKind'],
  'producer-non-draft' | 'investigated-empty'
>;

export type SemanticDispositionReviewAxisIdV1 =
  | 'frozen-semantic-evidence-grounding'
  | 'fixpoint-population-execution-lineage'
  | 'reviewer-independence'
  | 'verdict-sufficiency'
  | 'admission-comparison-completeness'
  | 'target-disposition-consistency'
  | 'hypothesis-falsification-context'
  | 'sealed-schedule-terminal-denominator'
  | 'negative-evidence-sufficiency'
  | 'empty-population-consistency';

const COMMON_AXES = [
  'frozen-semantic-evidence-grounding',
  'fixpoint-population-execution-lineage',
  'reviewer-independence',
  'verdict-sufficiency',
] as const satisfies readonly SemanticDispositionReviewAxisIdV1[];

const PRODUCER_AXES = [
  ...COMMON_AXES,
  'admission-comparison-completeness',
  'target-disposition-consistency',
  'hypothesis-falsification-context',
] as const satisfies readonly SemanticDispositionReviewAxisIdV1[];

const INVESTIGATED_EMPTY_AXES = [
  ...COMMON_AXES,
  'sealed-schedule-terminal-denominator',
  'negative-evidence-sufficiency',
  'empty-population-consistency',
] as const satisfies readonly SemanticDispositionReviewAxisIdV1[];

export interface SemanticDispositionReviewEvidenceV1 {
  readonly evidenceEntryId: string;
  readonly evidenceSessionId: string;
  readonly sourceRevisionVectorHash: string;
  readonly canonicalSubjectRef: string;
  readonly relativePath: string;
  readonly blobHash: string;
  readonly content: string;
  readonly contentHash: string;
  readonly semanticRole: string;
  readonly evidenceHash: string;
}

export interface SemanticDispositionReviewCalibrationAxisV1 {
  readonly axisId: SemanticDispositionReviewAxisIdV1;
  readonly minimumScore: number;
  readonly calibrationEvidenceHash: string;
}

export interface SemanticDispositionReviewerModelLoadReceiptV1 {
  readonly schemaVersion: 1;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly runtimeConfigHash: string;
  readonly credentialLocationSymbol: string;
  readonly loadReceiptHash: string;
}

export interface SemanticDispositionReviewCalibrationV1 {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  readonly calibrationReceiptHash: string;
  readonly rubricVersion: string;
  readonly axes: readonly SemanticDispositionReviewCalibrationAxisV1[];
  readonly calibrationHash: string;
}

export interface ProducerNonDraftDispositionReviewContextV1 {
  readonly reviewKind: 'producer-non-draft';
  readonly privateCorpusRevision: string;
  readonly analysisFixpoint: AnalysisFixpointReceiptV1;
  readonly population: ObservationPopulationV1;
  readonly induction: InductionReceiptV1;
  readonly falsification: FalsificationReceiptV1;
  readonly proposal: Extract<
    KnowledgeDispositionProposalV1,
    { readonly reviewKind: 'producer-non-draft' }
  >;
  readonly expressionSetReceiptId: string;
  /**
   * mandatory zero row 不是“没有 candidate”，而是 Producer 对零输出处置作出的 typed authored
   * projection；它与普通 expression 一样必须先经过 exact G1 与非持久化 Admission。
   */
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly target: {
    readonly expressionId: string | null;
    readonly authoredFingerprint: string | null;
    readonly terminalFate: 'reviewed-merge' | 'reviewed-duplicate' | 'reviewed-non-draft';
    readonly targetRecipeId: string | null;
    readonly targetFingerprint: string | null;
    readonly targetReadyProofHash: string | null;
  };
}

export interface InvestigatedEmptyDispositionReviewContextV1 {
  readonly reviewKind: 'investigated-empty';
  readonly analysisFixpoint: AnalysisFixpointReceiptV1;
  readonly population: ObservationPopulationV1;
  readonly proposal: Extract<
    KnowledgeDispositionProposalV1,
    { readonly reviewKind: 'investigated-empty' }
  >;
  readonly negativeEvidenceSufficiency: {
    readonly claim: string;
    readonly requiredAbsencePredicates: readonly string[];
    readonly inspectedEvidenceEntryIds: readonly string[];
    readonly reasonCode: string;
  };
}

export type SemanticDispositionReviewContextV1 =
  | ProducerNonDraftDispositionReviewContextV1
  | InvestigatedEmptyDispositionReviewContextV1;

export interface SemanticDispositionReviewRequestV1 {
  readonly schemaVersion: 1;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1;
  readonly strictWorkflowRunId: string;
  readonly sourceRevisionVectorHash: string;
  readonly reviewKind: SemanticDispositionReviewKindV1;
  readonly currentAnalysisFixpointHash: string;
  readonly populationHash: string;
  readonly proposedDispositionHash: string;
  readonly finalExpandedSchedule: FinalExpandedMiningScheduleReceiptV1;
  readonly executionReceipts: readonly FactQueryExecutionReceiptV1[];
  readonly executionBindings: readonly KnowledgeDispositionExecutionBindingV1[];
  readonly evidence: readonly SemanticDispositionReviewEvidenceV1[];
  readonly calibration: SemanticDispositionReviewCalibrationV1;
  readonly producer: ProductionActorIdentityV1;
  readonly context: SemanticDispositionReviewContextV1;
  readonly contextHash: string;
  readonly promptHash: string;
  readonly requestId: string;
  readonly requestHash: string;
}

export interface SemanticDispositionReviewAxisDecisionV1 {
  readonly axisId: SemanticDispositionReviewAxisIdV1;
  readonly verdict: 'pass' | 'revise' | 'reject';
  readonly score: number;
  readonly reasonCode: string;
  readonly evidenceEntryIds: readonly string[];
}

export interface SemanticDispositionReviewEvidenceFindingV1 {
  readonly evidenceEntryId: string;
  readonly axisIds: readonly SemanticDispositionReviewAxisIdV1[];
  readonly finding: string;
  readonly supportsVerdict: boolean;
}

export interface SemanticDispositionReviewDecisionV1 {
  readonly schemaVersion: 1;
  readonly requestHash: string;
  readonly promptHash: string;
  readonly contextHash: string;
  readonly reviewKind: SemanticDispositionReviewKindV1;
  readonly proposedDispositionHash: string;
  readonly verdict: KnowledgeDispositionReviewV1['verdict'];
  readonly reasonCode: string;
  readonly axisDecisions: readonly SemanticDispositionReviewAxisDecisionV1[];
  readonly evidenceFindings: readonly SemanticDispositionReviewEvidenceFindingV1[];
}

export interface SemanticDispositionReviewerHostInvocationV1 {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly evaluatorRunId: string;
  readonly invocationId: string;
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  readonly requestHash: string;
  readonly promptHash: string;
  readonly responseOutput: string;
  readonly responseOutputHash: string;
  readonly status: 'success';
  readonly toolCallCount: 0;
}

export interface SemanticDispositionReviewExecutionV1 {
  readonly schemaVersion: 1;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1;
  readonly request: SemanticDispositionReviewRequestV1;
  readonly invocation: SemanticDispositionReviewerHostInvocationV1;
  readonly decision: SemanticDispositionReviewDecisionV1;
  readonly decisionHash: string;
  readonly reviewer: ProductionActorIdentityV1;
  readonly executionId: string;
  readonly executionHash: string;
}

export function createAgentSemanticDispositionReviewRequestV1(input: {
  readonly strictWorkflowRunId: string;
  readonly sourceRevisionVectorHash: string;
  readonly currentAnalysisFixpointHash: string;
  readonly populationHash: string;
  readonly proposedDispositionHash: string;
  readonly finalExpandedSchedule: FinalExpandedMiningScheduleReceiptV1;
  readonly executionReceipts: readonly FactQueryExecutionReceiptV1[];
  readonly evidence: readonly Omit<SemanticDispositionReviewEvidenceV1, 'evidenceHash'>[];
  readonly calibration: Omit<SemanticDispositionReviewCalibrationV1, 'calibrationHash'>;
  readonly producer: ProductionActorIdentityV1;
  readonly context: SemanticDispositionReviewContextV1;
}): SemanticDispositionReviewRequestV1 {
  requireText(input.strictWorkflowRunId, 'SEMANTIC_DISPOSITION_REVIEW_WORKFLOW_RUN_REQUIRED');
  requireSha256(
    input.sourceRevisionVectorHash,
    'SEMANTIC_DISPOSITION_REVIEW_SOURCE_REVISION_INVALID'
  );
  requireSha256(input.currentAnalysisFixpointHash, 'SEMANTIC_DISPOSITION_REVIEW_FIXPOINT_INVALID');
  requireSha256(input.populationHash, 'SEMANTIC_DISPOSITION_REVIEW_POPULATION_INVALID');
  requireSha256(input.proposedDispositionHash, 'SEMANTIC_DISPOSITION_REVIEW_PROPOSAL_INVALID');
  assertProductionActorIdentityV1(input.producer);
  if (input.producer.runId !== input.strictWorkflowRunId) {
    fail('SEMANTIC_DISPOSITION_REVIEW_PRODUCER_RUN_MISMATCH');
  }
  const reviewKind = input.context.reviewKind;
  const evidence = normalizeEvidence(input.evidence, input.sourceRevisionVectorHash);
  const calibration = normalizeCalibration(input.calibration, reviewKind);
  const executionReceipts = normalizeExecutionReceipts(
    input.executionReceipts,
    input.sourceRevisionVectorHash
  );
  const executionBindings = executionReceipts.map(executionBinding);
  validateRequestContext(input, executionReceipts);
  const context = freezeDeep(input.context);
  const contextHash = hashCanonicalJson(context);
  const semanticWithoutPrompt = {
    schemaVersion: 1 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1,
    strictWorkflowRunId: input.strictWorkflowRunId.trim(),
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    reviewKind,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    populationHash: input.populationHash,
    proposedDispositionHash: input.proposedDispositionHash,
    finalExpandedSchedule: input.finalExpandedSchedule,
    executionReceipts,
    executionBindings,
    evidence,
    calibration,
    producer: input.producer,
    context,
    contextHash,
  } as const;
  const promptHash = hashCanonicalJson({
    schemaVersion: 1,
    route: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1,
    semanticRequest: semanticWithoutPrompt,
  });
  const semantic = { ...semanticWithoutPrompt, promptHash };
  const requestHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    requestId: `semantic-review-request:${requestHash.slice(7, 31)}`,
    requestHash,
  });
}

/**
 * @deprecated V1 仅保留历史结构回读/迁移测试；它只能做字段一致性校验，不能证明 host call
 * 的因果来源，StrictProductionAuthority 不再接受 V1。新生产调用必须走 V3 durable
 * Agent/evidence attestation gateway。
 */
export function createAgentSemanticDispositionReviewExecutionV1(input: {
  readonly request: SemanticDispositionReviewRequestV1;
  readonly invocation: SemanticDispositionReviewerHostInvocationV1;
  readonly decision: SemanticDispositionReviewDecisionV1;
}): SemanticDispositionReviewExecutionV1 {
  assertSemanticDispositionReviewRequestV1(input.request);
  validateInvocation(input.request, input.invocation);
  const decision = normalizeDecision(input.request, input.decision);
  validateResponseOutput(input.invocation, decision);
  const reviewer = createProductionActorIdentityV1({
    providerId: input.invocation.providerId,
    modelId: input.invocation.modelId,
    modelVersion: `${input.invocation.modelVersion}/${input.invocation.methodId}/${input.invocation.methodVersion}`,
    promptHash: input.invocation.promptHash,
    runId: input.invocation.evaluatorRunId,
    invocationId: input.invocation.invocationId,
    loadReceiptHash: input.invocation.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: input.invocation.responseOutputHash,
  });
  if (
    reviewer.runId === input.request.strictWorkflowRunId ||
    reviewer.invocationId === input.request.producer.invocationId ||
    reviewer.outputHash === input.request.producer.outputHash ||
    reviewer.actorHash === input.request.producer.actorHash
  ) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  }
  const decisionHash = hashCanonicalJson({
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    axisDecisions: decision.axisDecisions,
    evidenceFindings: decision.evidenceFindings,
  });
  const semantic = {
    schemaVersion: 1 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V1,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1,
    request: input.request,
    invocation: input.invocation,
    decision,
    decisionHash,
    reviewer,
  } as const;
  const executionHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    executionId: `semantic-review-execution:${executionHash.slice(7, 31)}`,
    executionHash,
  });
}

export function assertSemanticDispositionReviewRequestV1(
  request: SemanticDispositionReviewRequestV1
): void {
  let rebuilt: SemanticDispositionReviewRequestV1;
  try {
    const evidence = request.evidence.map(({ evidenceHash: _evidenceHash, ...row }) => row);
    const { calibrationHash: _calibrationHash, ...calibration } = request.calibration;
    rebuilt = createAgentSemanticDispositionReviewRequestV1({
      strictWorkflowRunId: request.strictWorkflowRunId,
      sourceRevisionVectorHash: request.sourceRevisionVectorHash,
      currentAnalysisFixpointHash: request.currentAnalysisFixpointHash,
      populationHash: request.populationHash,
      proposedDispositionHash: request.proposedDispositionHash,
      finalExpandedSchedule: request.finalExpandedSchedule,
      executionReceipts: request.executionReceipts,
      evidence,
      calibration,
      producer: request.producer,
      context: request.context,
    });
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_INVALID');
  }
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(request)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_HASH_MISMATCH');
  }
}

export function assertSemanticDispositionReviewExecutionV1(
  execution: SemanticDispositionReviewExecutionV1
): void {
  let rebuilt: SemanticDispositionReviewExecutionV1;
  try {
    rebuilt = createAgentSemanticDispositionReviewExecutionV1({
      request: execution.request,
      invocation: execution.invocation,
      decision: execution.decision,
    });
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_INVALID');
  }
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(execution)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_HASH_MISMATCH');
  }
}

/**
 * @deprecated 该兼容 consumer 生成的 review 不具备统一生产 authority；仅供历史数据迁移。
 * Main 的生产路径必须调用 V3 durable attestation consumer。
 */
export function consumeMainSemanticDispositionReviewExecutionV1(input: {
  readonly execution: SemanticDispositionReviewExecutionV1;
  readonly expectedRequest: SemanticDispositionReviewRequestV1;
}): KnowledgeDispositionReviewV1 {
  assertSemanticDispositionReviewExecutionV1(input.execution);
  assertSemanticDispositionReviewRequestV1(input.expectedRequest);
  const { execution, expectedRequest } = input;
  if (
    execution.consumerRoute !== SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V1 ||
    execution.request.requestHash !== expectedRequest.requestHash ||
    hashCanonicalJson(execution.request) !== hashCanonicalJson(expectedRequest)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_MISMATCH');
  }
  return createKnowledgeDispositionReviewV1({
    reviewKind: execution.request.reviewKind,
    currentAnalysisFixpointHash: execution.request.currentAnalysisFixpointHash,
    populationHash: execution.request.populationHash,
    proposedDispositionHash: execution.request.proposedDispositionHash,
    executionReceipts: execution.request.executionReceipts,
    finalExpandedSchedule: execution.request.finalExpandedSchedule,
    terminalObligations: execution.request.context.analysisFixpoint.terminalObligations,
    producer: execution.request.producer,
    reviewer: execution.reviewer,
    calibrationReceiptHash: execution.request.calibration.calibrationReceiptHash,
    verdict: execution.decision.verdict,
    reasonCode: execution.decision.reasonCode,
    semanticExecutionResultHash: execution.executionHash,
  });
}

export const SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2 =
  'alembic-agent.semantic-disposition-review-execution-v2';
export const SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2 =
  'alembic-main.strict-production-disposition-review-consumer-v2';
export const SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3 =
  'alembic-agent.semantic-disposition-review-execution-v3';
export const SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3 =
  'alembic-main.strict-production-disposition-review-consumer-v3';

/**
 * V2 不再接受调用方手写 evidence summary。每一行都必须同时携带冻结 Ledger snapshot、
 * Strict Fact executor 产生的 direct-witness binding 与 exact file execution 坐标。
 */
export interface SemanticDispositionReviewEvidenceAuthorityV2 {
  readonly schemaVersion: 2;
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly witnessBinding: StrictFactDirectWitnessBindingV1;
  readonly executionReceipt: FactQueryExecutionReceiptV1;
  readonly executionReceiptHash: string;
  readonly fileExecutionHash: string;
  readonly canonicalSubjectRef: string;
  readonly emittedFactIds: readonly string[];
  readonly semanticRole: string;
  readonly authorityHash: string;
}

type CreateSemanticDispositionReviewEvidenceAuthorityInputV2 = {
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly witnessBinding: StrictFactDirectWitnessBindingV1;
  readonly executionReceipt: FactQueryExecutionReceiptV1;
  readonly fileExecutionHash: string;
  readonly semanticRole: string;
};

export function createSemanticDispositionReviewEvidenceAuthorityV2(
  input: CreateSemanticDispositionReviewEvidenceAuthorityInputV2
): SemanticDispositionReviewEvidenceAuthorityV2 {
  assertReviewAuthorizingFactExecutionV1(input.executionReceipt);
  requireText(input.semanticRole, 'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  const rebuiltSnapshot = createStrictEvidenceLedgerSnapshotV1(
    input.evidenceLedgerSnapshot.entries
  );
  const snapshotEntry = rebuiltSnapshot.entries.find(
    (entry) =>
      entry.sessionId === input.evidenceEntry.sessionId && entry.id === input.evidenceEntry.id
  );
  const fileExecution = input.executionReceipt.fileExecutions.find(
    (candidate) => candidate.executionHash === input.fileExecutionHash
  );
  if (!fileExecution) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  }
  const { bindingHash: _bindingHash, ...bindingSemantic } = input.witnessBinding;
  if (
    evidenceSnapshotInvalid(input, rebuiltSnapshot, snapshotEntry) ||
    evidenceWitnessBindingInvalid(input, rebuiltSnapshot, bindingSemantic) ||
    evidenceFileExecutionInvalid(input, fileExecution)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  }
  const semantic = {
    schemaVersion: 2 as const,
    evidenceEntry: input.evidenceEntry,
    evidenceLedgerSnapshot: rebuiltSnapshot,
    witnessBinding: input.witnessBinding,
    executionReceipt: input.executionReceipt,
    executionReceiptHash: input.executionReceipt.receiptHash,
    fileExecutionHash: fileExecution.executionHash,
    canonicalSubjectRef: input.executionReceipt.canonicalSubjectRef,
    emittedFactIds: [...fileExecution.emittedFactIds].sort(),
    semanticRole: input.semanticRole.trim(),
  };
  return freezeDeep({
    ...semantic,
    authorityHash: hashCanonicalJson(semantic),
  });
}

/**
 * V3 binding 保留每个 obligation/scale receipt 的独立身份，同时显式证明它们来自同一
 * dimension-free harvest 与同一 file execution。authority 不复制 Evidence Ledger 条目。
 */
export interface SemanticDispositionReviewExecutionReceiptBindingV3 {
  readonly schemaVersion: 3;
  readonly obligationId: string;
  readonly analysisScale: FactQueryExecutionReceiptV1['analysisScale'];
  readonly executionReceiptHash: string;
  readonly harvestKey: string;
  readonly harvestReceiptHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly canonicalSubjectRef: string;
  readonly fileExecutionHash: string;
  readonly bindingHash: string;
}

export interface SemanticDispositionReviewEvidenceAuthorityV3 {
  readonly schemaVersion: 3;
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly witnessBinding: StrictFactDirectWitnessBindingV1;
  readonly executionReceiptBindings: readonly SemanticDispositionReviewExecutionReceiptBindingV3[];
  readonly harvestKey: string;
  readonly harvestReceiptHash: string;
  readonly canonicalSubjectRef: string;
  readonly emittedFactIds: readonly string[];
  readonly semanticRole: string;
  readonly authorityHash: string;
}

type CreateSemanticDispositionReviewEvidenceAuthorityInputV3 = {
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly witnessBinding: StrictFactDirectWitnessBindingV1;
  readonly executionReceipts: readonly FactQueryExecutionReceiptV1[];
  readonly semanticRole: string;
};

/**
 * 该 producer canonicalizer 仅由 Agent durable gateway 调用。Main facade 只导出 V4
 * verifier/consumer，不导出 authority mint。
 */
export function createSemanticDispositionReviewEvidenceAuthorityV3(
  input: CreateSemanticDispositionReviewEvidenceAuthorityInputV3
): SemanticDispositionReviewEvidenceAuthorityV3 {
  requireText(input.semanticRole, 'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
  const executionReceipts = [...input.executionReceipts].sort(
    (left, right) =>
      left.obligationId.localeCompare(right.obligationId) ||
      left.receiptHash.localeCompare(right.receiptHash)
  );
  if (
    executionReceipts.length === 0 ||
    new Set(executionReceipts.map((receipt) => receipt.obligationId)).size !==
      executionReceipts.length ||
    new Set(executionReceipts.map((receipt) => receipt.receiptHash)).size !==
      executionReceipts.length
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
  }
  for (const receipt of executionReceipts) {
    assertReviewAuthorizingFactExecutionV1(receipt);
  }
  const rebuiltSnapshot = createStrictEvidenceLedgerSnapshotV1(
    input.evidenceLedgerSnapshot.entries
  );
  const snapshotEntry = rebuiltSnapshot.entries.find(
    (entry) =>
      entry.sessionId === input.evidenceEntry.sessionId && entry.id === input.evidenceEntry.id
  );
  const commonInput = {
    evidenceEntry: input.evidenceEntry,
    evidenceLedgerSnapshot: input.evidenceLedgerSnapshot,
    witnessBinding: input.witnessBinding,
  };
  const { bindingHash: _bindingHash, ...bindingSemantic } = input.witnessBinding;
  if (
    evidenceSnapshotInvalid(commonInput, rebuiltSnapshot, snapshotEntry) ||
    evidenceWitnessBindingInvalid(
      { ...commonInput, executionReceipt: executionReceipts[0]! },
      rebuiltSnapshot,
      bindingSemantic
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
  }
  const referenceReceipt = executionReceipts[0]!;
  const executionReceiptBindings = executionReceipts.map((receipt) => {
    if (
      receipt.harvestKey !== referenceReceipt.harvestKey ||
      receipt.harvestReceiptHash !== referenceReceipt.harvestReceiptHash ||
      receipt.sourceRevisionVectorHash !== referenceReceipt.sourceRevisionVectorHash ||
      receipt.canonicalSubjectRef !== referenceReceipt.canonicalSubjectRef
    ) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_HARVEST_MISMATCH');
    }
    const matchingFileExecutions = receipt.fileExecutions.filter(
      (fileExecution) =>
        fileExecution.evidenceEntryId === input.evidenceEntry.id &&
        fileExecution.witnessBindingHash === input.witnessBinding.bindingHash &&
        fileExecution.projectContextRefId === input.witnessBinding.projectContextRefId &&
        fileExecution.relativePath === input.witnessBinding.relativePath &&
        fileExecution.blobHash === input.witnessBinding.blobHash
    );
    if (
      matchingFileExecutions.length !== 1 ||
      evidenceFileExecutionInvalid(
        {
          ...commonInput,
          executionReceipt: receipt,
          fileExecutionHash: matchingFileExecutions[0]!.executionHash,
        },
        matchingFileExecutions[0]!
      )
    ) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_FILE_EXECUTION_MISMATCH');
    }
    const bindingSemanticV3 = {
      schemaVersion: 3 as const,
      obligationId: receipt.obligationId,
      analysisScale: receipt.analysisScale,
      executionReceiptHash: receipt.receiptHash,
      harvestKey: receipt.harvestKey,
      harvestReceiptHash: receipt.harvestReceiptHash,
      sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
      canonicalSubjectRef: receipt.canonicalSubjectRef,
      fileExecutionHash: matchingFileExecutions[0]!.executionHash,
    };
    return freezeDeep({
      ...bindingSemanticV3,
      bindingHash: hashCanonicalJson(bindingSemanticV3),
    });
  });
  const fileExecutionHashes = new Set(
    executionReceiptBindings.map((binding) => binding.fileExecutionHash)
  );
  if (fileExecutionHashes.size !== 1) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_FILE_EXECUTION_MISMATCH');
  }
  const fileExecution = referenceReceipt.fileExecutions.find(
    (candidate) => candidate.executionHash === executionReceiptBindings[0]!.fileExecutionHash
  )!;
  const semantic = {
    schemaVersion: 3 as const,
    evidenceEntry: input.evidenceEntry,
    evidenceLedgerSnapshot: rebuiltSnapshot,
    witnessBinding: input.witnessBinding,
    executionReceiptBindings,
    harvestKey: referenceReceipt.harvestKey,
    harvestReceiptHash: referenceReceipt.harvestReceiptHash,
    canonicalSubjectRef: referenceReceipt.canonicalSubjectRef,
    emittedFactIds: [...fileExecution.emittedFactIds].sort(),
    semanticRole: input.semanticRole.trim(),
  };
  return freezeDeep({ ...semantic, authorityHash: hashCanonicalJson(semantic) });
}

function evidenceSnapshotInvalid(
  input: Pick<
    CreateSemanticDispositionReviewEvidenceAuthorityInputV2,
    'evidenceEntry' | 'evidenceLedgerSnapshot'
  >,
  rebuiltSnapshot: StrictEvidenceLedgerSnapshotV1,
  snapshotEntry: EvidenceEntry | undefined
): boolean {
  return (
    rebuiltSnapshot.snapshotHash !== input.evidenceLedgerSnapshot.snapshotHash ||
    input.evidenceLedgerSnapshot.complete !== true ||
    input.evidenceLedgerSnapshot.truncated !== false ||
    input.evidenceLedgerSnapshot.continuation !== null ||
    !snapshotEntry ||
    hashCanonicalJson(snapshotEntry) !== hashCanonicalJson(input.evidenceEntry)
  );
}

function evidenceWitnessBindingInvalid(
  input: Pick<
    CreateSemanticDispositionReviewEvidenceAuthorityInputV2,
    'evidenceEntry' | 'evidenceLedgerSnapshot' | 'witnessBinding' | 'executionReceipt'
  >,
  rebuiltSnapshot: StrictEvidenceLedgerSnapshotV1,
  bindingSemantic: Omit<StrictFactDirectWitnessBindingV1, 'bindingHash'>
): boolean {
  return (
    hashCanonicalJson(bindingSemantic) !== input.witnessBinding.bindingHash ||
    input.witnessBinding.evidenceLedgerSnapshotHash !== rebuiltSnapshot.snapshotHash ||
    input.witnessBinding.evidenceEntryId !== input.evidenceEntry.id ||
    input.witnessBinding.evidenceSessionId !== input.evidenceEntry.sessionId ||
    input.witnessBinding.evidenceContentHash !== input.evidenceEntry.contentHash ||
    input.witnessBinding.evidenceEntryHash !== hashCanonicalJson(input.evidenceEntry) ||
    hashCanonicalJson(input.witnessBinding.evidenceEntry) !==
      hashCanonicalJson(input.evidenceEntry) ||
    input.witnessBinding.projectContextRefHash !==
      hashCanonicalJson(input.witnessBinding.projectContextRef) ||
    input.witnessBinding.projectContextRefId !== input.witnessBinding.projectContextRef.id ||
    input.witnessBinding.sourceRevisionVectorHash !==
      input.executionReceipt.sourceRevisionVectorHash ||
    input.evidenceEntry.tool !== 'code.read' ||
    input.evidenceEntry.file !== input.witnessBinding.relativePath
  );
}

function evidenceFileExecutionInvalid(
  input: Pick<
    CreateSemanticDispositionReviewEvidenceAuthorityInputV2,
    'evidenceEntry' | 'witnessBinding' | 'executionReceipt' | 'fileExecutionHash'
  >,
  fileExecution: FactQueryExecutionReceiptV1['fileExecutions'][number]
): boolean {
  return (
    fileExecution.status !== 'complete' ||
    fileExecution.truncated ||
    fileExecution.continuation !== null ||
    fileExecution.witnessBindingHash !== input.witnessBinding.bindingHash ||
    fileExecution.evidenceEntryId !== input.evidenceEntry.id ||
    fileExecution.projectContextRefId !== input.witnessBinding.projectContextRefId ||
    fileExecution.relativePath !== input.witnessBinding.relativePath ||
    fileExecution.blobHash !== input.witnessBinding.blobHash
  );
}

export interface SemanticDispositionReviewRequestV2 {
  readonly schemaVersion: 2;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2;
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidenceAuthorities: readonly SemanticDispositionReviewEvidenceAuthorityV2[];
  /** UTF-8 exact string passed to Agent host adapter; hash is byte hash, not semantic-object hash. */
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
  readonly requestId: string;
  readonly requestHash: string;
}

export function createAgentSemanticDispositionReviewRequestV2(input: {
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidenceAuthorities: readonly SemanticDispositionReviewEvidenceAuthorityV2[];
}): SemanticDispositionReviewRequestV2 {
  assertSemanticDispositionReviewRequestV1(input.semanticRequest);
  const evidenceAuthorities = input.evidenceAuthorities
    .map(assertAndFreezeEvidenceAuthorityV2)
    .sort(
      (left, right) =>
        left.evidenceEntry.sessionId.localeCompare(right.evidenceEntry.sessionId) ||
        left.evidenceEntry.id.localeCompare(right.evidenceEntry.id)
    );
  const authorityEvidenceIds = evidenceAuthorities.map((row) => row.evidenceEntry.id);
  const receiptHashes = input.semanticRequest.executionReceipts
    .map((receipt) => receipt.receiptHash)
    .sort();
  if (
    evidenceAuthorities.length === 0 ||
    new Set(evidenceAuthorities.map((row) => row.authorityHash)).size !==
      evidenceAuthorities.length ||
    new Set(
      evidenceAuthorities.map(
        (row) => `${row.evidenceEntry.sessionId}\u0000${row.evidenceEntry.id}`
      )
    ).size !== evidenceAuthorities.length ||
    !sameStrings(
      authorityEvidenceIds,
      input.semanticRequest.evidence.map((row) => row.evidenceEntryId)
    ) ||
    !sameStrings(
      [...new Set(evidenceAuthorities.map((row) => row.executionReceiptHash))],
      receiptHashes
    ) ||
    evidenceAuthorities.some(
      (row) =>
        !receiptHashes.includes(row.executionReceiptHash) ||
        hashCanonicalJson(evidenceSummaryFromAuthorityV2(row, input.semanticRequest)) !==
          hashCanonicalJson(
            input.semanticRequest.evidence.find(
              (evidence) => evidence.evidenceEntryId === row.evidenceEntry.id
            )
          )
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_MISMATCH');
  }
  const semanticWithoutPrompt = {
    schemaVersion: 2 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2,
    semanticRequest: input.semanticRequest,
    evidenceAuthorities,
  } as const;
  const compiledPrompt = JSON.stringify({
    schemaVersion: 2,
    instructionVersion: 'semantic-disposition-independent-review-v2',
    instruction:
      'Independently review the bound disposition. Return only a SemanticDispositionReviewDecisionV2 JSON object.',
    payload: semanticWithoutPrompt,
  });
  const compiledPromptHash = hashBytes(Buffer.from(compiledPrompt, 'utf8'));
  const semantic = { ...semanticWithoutPrompt, compiledPrompt, compiledPromptHash };
  const requestHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    requestId: `semantic-review-request-v2:${requestHash.slice(7, 31)}`,
    requestHash,
  });
}

export interface SemanticDispositionReviewRequestV3 {
  readonly schemaVersion: 3;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3;
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidenceAuthorities: readonly SemanticDispositionReviewEvidenceAuthorityV3[];
  /** UTF-8 exact string passed to Agent host adapter; hash is byte hash, not semantic-object hash. */
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
  readonly requestId: string;
  readonly requestHash: string;
}

export function createAgentSemanticDispositionReviewRequestV3(input: {
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidenceAuthorities: readonly SemanticDispositionReviewEvidenceAuthorityV3[];
}): SemanticDispositionReviewRequestV3 {
  assertSemanticDispositionReviewRequestV1(input.semanticRequest);
  const evidenceAuthorities = input.evidenceAuthorities
    .map((authority) => assertAndFreezeEvidenceAuthorityV3(authority, input.semanticRequest))
    .sort(
      (left, right) =>
        left.evidenceEntry.sessionId.localeCompare(right.evidenceEntry.sessionId) ||
        left.evidenceEntry.id.localeCompare(right.evidenceEntry.id)
    );
  const authorityEvidenceIds = evidenceAuthorities.map((row) => row.evidenceEntry.id);
  const requestReceiptHashes = input.semanticRequest.executionReceipts.map(
    (receipt) => receipt.receiptHash
  );
  const authorityReceiptHashes = evidenceAuthorities.flatMap((authority) =>
    authority.executionReceiptBindings.map((binding) => binding.executionReceiptHash)
  );
  const authorityAtoms = evidenceAuthorities.flatMap((authority) =>
    authority.executionReceiptBindings.map(
      (binding) =>
        `${authority.evidenceEntry.sessionId}\u0000${authority.evidenceEntry.id}\u0000${binding.executionReceiptHash}`
    )
  );
  if (
    evidenceAuthorities.length === 0 ||
    new Set(evidenceAuthorities.map((row) => row.authorityHash)).size !==
      evidenceAuthorities.length ||
    new Set(
      evidenceAuthorities.map(
        (row) => `${row.evidenceEntry.sessionId}\u0000${row.evidenceEntry.id}`
      )
    ).size !== evidenceAuthorities.length ||
    new Set(authorityAtoms).size !== authorityAtoms.length ||
    !sameStrings(
      authorityEvidenceIds,
      input.semanticRequest.evidence.map((row) => row.evidenceEntryId)
    ) ||
    !sameStrings([...new Set(authorityReceiptHashes)], requestReceiptHashes) ||
    evidenceAuthorities.some(
      (authority) =>
        hashCanonicalJson(evidenceSummaryFromAuthorityV3(authority, input.semanticRequest)) !==
        hashCanonicalJson(
          input.semanticRequest.evidence.find(
            (evidence) => evidence.evidenceEntryId === authority.evidenceEntry.id
          )
        )
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_MISMATCH');
  }
  const semanticWithoutPrompt = {
    schemaVersion: 3 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3,
    semanticRequest: input.semanticRequest,
    evidenceAuthorities,
  } as const;
  const compiledPrompt = JSON.stringify({
    schemaVersion: 3,
    instructionVersion: 'semantic-disposition-independent-review-v3',
    instruction:
      'Independently review the bound disposition and exact shared-harvest receipt sets. Return only a SemanticDispositionReviewDecisionV3 JSON object.',
    payload: semanticWithoutPrompt,
  });
  const compiledPromptHash = hashBytes(Buffer.from(compiledPrompt, 'utf8'));
  const semantic = { ...semanticWithoutPrompt, compiledPrompt, compiledPromptHash };
  const requestHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    requestId: `semantic-review-request-v3:${requestHash.slice(7, 31)}`,
    requestHash,
  });
}

export interface SemanticDispositionReviewDecisionV2 {
  readonly schemaVersion: 2;
  readonly requestHash: string;
  readonly compiledPromptHash: string;
  readonly semanticRequestHash: string;
  readonly contextHash: string;
  readonly reviewKind: SemanticDispositionReviewKindV1;
  readonly proposedDispositionHash: string;
  readonly verdict: KnowledgeDispositionReviewV1['verdict'];
  readonly reasonCode: string;
  readonly axisDecisions: readonly SemanticDispositionReviewAxisDecisionV1[];
  readonly evidenceFindings: readonly SemanticDispositionReviewEvidenceFindingV1[];
}

export interface SemanticDispositionReviewDecisionV3 {
  readonly schemaVersion: 3;
  readonly requestHash: string;
  readonly compiledPromptHash: string;
  readonly semanticRequestHash: string;
  readonly contextHash: string;
  readonly reviewKind: SemanticDispositionReviewKindV1;
  readonly proposedDispositionHash: string;
  readonly verdict: KnowledgeDispositionReviewV1['verdict'];
  readonly reasonCode: string;
  readonly axisDecisions: readonly SemanticDispositionReviewAxisDecisionV1[];
  readonly evidenceFindings: readonly SemanticDispositionReviewEvidenceFindingV1[];
}

export interface SemanticDispositionReviewHostCallV2 {
  readonly schemaVersion: 2;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2;
  readonly request: SemanticDispositionReviewRequestV2;
  readonly requestHash: string;
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
}

export interface SemanticDispositionReviewHostResultV2 {
  readonly evaluatorRunId: string;
  readonly invocationId: string;
  readonly responseOutput: string;
  readonly status: 'success';
  readonly toolCallCount: 0;
}

export interface SemanticDispositionReviewAgentHostAdapterV2 {
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  invoke(call: SemanticDispositionReviewHostCallV2): Promise<SemanticDispositionReviewHostResultV2>;
}

export interface SemanticDispositionReviewAgentHostExecutionAuthorityV2 {
  readonly schemaVersion: 2;
  readonly authorityId: string;
  readonly reviewerModelLoadReceiptHash: string;
  readonly authorityHash: string;
}

export interface SemanticDispositionReviewerHostExecutionRecordV2 {
  readonly schemaVersion: 2;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2;
  readonly authorityHash: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly runtimeConfigHash: string;
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  readonly evaluatorRunId: string;
  readonly invocationId: string;
  readonly responseOutput: string;
  readonly responseOutputHash: string;
  readonly status: 'success';
  readonly toolCallCount: 0;
  readonly recordHash: string;
}

export interface SemanticDispositionReviewExecutionV2 {
  readonly schemaVersion: 2;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2;
  readonly request: SemanticDispositionReviewRequestV2;
  readonly hostExecution: SemanticDispositionReviewerHostExecutionRecordV2;
  readonly decision: SemanticDispositionReviewDecisionV2;
  readonly decisionHash: string;
  readonly reviewer: ProductionActorIdentityV1;
  readonly hostAuthorityHash: string;
  readonly executionId: string;
  readonly executionHash: string;
}

export interface SemanticDispositionReviewAgentHostGatewayV2 {
  readonly authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2;
  execute(
    request: SemanticDispositionReviewRequestV2
  ): Promise<SemanticDispositionReviewExecutionV2>;
}

export interface SemanticDispositionReviewHostCallV3 {
  readonly schemaVersion: 3;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3;
  readonly request: SemanticDispositionReviewRequestV3;
  readonly requestHash: string;
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
}

export interface SemanticDispositionReviewAgentHostAdapterV3 {
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  invoke(call: SemanticDispositionReviewHostCallV3): Promise<SemanticDispositionReviewHostResultV2>;
}

export interface SemanticDispositionReviewAgentHostExecutionAuthorityV3 {
  readonly schemaVersion: 3;
  readonly authorityId: string;
  readonly reviewerModelLoadReceiptHash: string;
  readonly authorityHash: string;
}

export interface SemanticDispositionReviewerHostExecutionRecordV3 {
  readonly schemaVersion: 3;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3;
  readonly authorityHash: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly compiledPrompt: string;
  readonly compiledPromptHash: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly runtimeConfigHash: string;
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  readonly evaluatorRunId: string;
  readonly invocationId: string;
  readonly responseOutput: string;
  readonly responseOutputHash: string;
  readonly status: 'success';
  readonly toolCallCount: 0;
  readonly recordHash: string;
}

export interface SemanticDispositionReviewExecutionV3 {
  readonly schemaVersion: 3;
  readonly producerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3;
  readonly consumerRoute: typeof SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3;
  readonly request: SemanticDispositionReviewRequestV3;
  readonly hostExecution: SemanticDispositionReviewerHostExecutionRecordV3;
  readonly decision: SemanticDispositionReviewDecisionV3;
  readonly decisionHash: string;
  readonly reviewer: ProductionActorIdentityV1;
  readonly hostAuthorityHash: string;
  readonly executionId: string;
  readonly executionHash: string;
}

export interface SemanticDispositionReviewAgentHostGatewayV3 {
  readonly authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3;
  execute(
    request: SemanticDispositionReviewRequestV3
  ): Promise<SemanticDispositionReviewExecutionV3>;
}

interface SemanticDispositionReviewHostAuthorityStateV2 {
  readonly adapter: SemanticDispositionReviewAgentHostAdapterV2;
  readonly executions: Map<string, SemanticDispositionReviewExecutionV2>;
  readonly invocationCoordinates: Set<string>;
  readonly outputHashes: Set<string>;
}

const SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V2 = new WeakMap<
  SemanticDispositionReviewAgentHostExecutionAuthorityV2,
  SemanticDispositionReviewHostAuthorityStateV2
>();

interface SemanticDispositionReviewHostAuthorityStateV3 {
  readonly adapter: SemanticDispositionReviewAgentHostAdapterV3;
  readonly executions: Map<string, SemanticDispositionReviewExecutionV3>;
  readonly invocationCoordinates: Set<string>;
  readonly outputHashes: Set<string>;
}

const SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V3 = new WeakMap<
  SemanticDispositionReviewAgentHostExecutionAuthorityV3,
  SemanticDispositionReviewHostAuthorityStateV3
>();

/**
 * 只有 Agent 创建 gateway 时才登记 live capability。Main 能接收 record 与 capability，
 * 但无法用 JSON/spread/重算 hash 创建新的 authority registration。
 */
export function createAgentSemanticDispositionReviewHostGatewayV2(
  adapter: SemanticDispositionReviewAgentHostAdapterV2
): SemanticDispositionReviewAgentHostGatewayV2 {
  const loadReceipt = normalizeReviewerModelLoadReceipt(adapter.reviewerModelLoadReceipt);
  if (typeof adapter.invoke !== 'function') {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_ADAPTER_INVALID');
  }
  const authoritySemantic = {
    schemaVersion: 2 as const,
    authorityId: `semantic-review-host-authority:${loadReceipt.loadReceiptHash.slice(7, 31)}`,
    reviewerModelLoadReceiptHash: loadReceipt.loadReceiptHash,
  };
  const authority = freezeDeep({
    ...authoritySemantic,
    authorityHash: hashCanonicalJson(authoritySemantic),
  });
  const state: SemanticDispositionReviewHostAuthorityStateV2 = {
    adapter: {
      reviewerModelLoadReceipt: loadReceipt,
      invoke: (call) => adapter.invoke(call),
    },
    executions: new Map(),
    invocationCoordinates: new Set(),
    outputHashes: new Set(),
  };
  SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V2.set(authority, state);
  return freezeDeep({
    authority,
    execute: async (request: SemanticDispositionReviewRequestV2) =>
      executeAgentSemanticDispositionReviewV2(authority, request),
  });
}

async function executeAgentSemanticDispositionReviewV2(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2,
  request: SemanticDispositionReviewRequestV2
): Promise<SemanticDispositionReviewExecutionV2> {
  const state = requireHostAuthorityStateV2(authority);
  assertSemanticDispositionReviewRequestV2(request);
  if (
    state.adapter.reviewerModelLoadReceipt.loadReceiptHash !==
      request.semanticRequest.calibration.reviewerModelLoadReceipt.loadReceiptHash ||
    hashCanonicalJson(state.adapter.reviewerModelLoadReceipt) !==
      hashCanonicalJson(request.semanticRequest.calibration.reviewerModelLoadReceipt)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_LOAD_MISMATCH');
  }
  const call: SemanticDispositionReviewHostCallV2 = freezeDeep({
    schemaVersion: 2 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
    request,
    requestHash: request.requestHash,
    compiledPrompt: request.compiledPrompt,
    compiledPromptHash: request.compiledPromptHash,
  });
  const result = await state.adapter.invoke(call);
  const execution = buildSemanticDispositionReviewExecutionV2(authority, request, result);
  const coordinate = `${execution.hostExecution.evaluatorRunId}\u0000${execution.hostExecution.invocationId}`;
  if (
    state.executions.has(execution.executionHash) ||
    state.invocationCoordinates.has(coordinate) ||
    state.outputHashes.has(execution.hostExecution.responseOutputHash)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_EXECUTION_REUSED');
  }
  state.executions.set(execution.executionHash, execution);
  state.invocationCoordinates.add(coordinate);
  state.outputHashes.add(execution.hostExecution.responseOutputHash);
  return execution;
}

function buildSemanticDispositionReviewExecutionV2(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2,
  request: SemanticDispositionReviewRequestV2,
  result: SemanticDispositionReviewHostResultV2
): SemanticDispositionReviewExecutionV2 {
  for (const value of [result.evaluatorRunId, result.invocationId]) {
    requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_REQUIRED');
  }
  if (result.status !== 'success' || result.toolCallCount !== 0 || !result.responseOutput?.trim()) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_RESULT_INVALID');
  }
  const loadReceipt = request.semanticRequest.calibration.reviewerModelLoadReceipt;
  const responseOutputHash = hashBytes(Buffer.from(result.responseOutput, 'utf8'));
  const hostSemantic = {
    schemaVersion: 2 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
    authorityHash: authority.authorityHash,
    requestId: request.requestId,
    requestHash: request.requestHash,
    compiledPrompt: request.compiledPrompt,
    compiledPromptHash: request.compiledPromptHash,
    providerId: loadReceipt.providerId,
    modelId: loadReceipt.modelId,
    modelVersion: loadReceipt.modelVersion,
    methodId: loadReceipt.methodId,
    methodVersion: loadReceipt.methodVersion,
    runtimeConfigHash: loadReceipt.runtimeConfigHash,
    reviewerModelLoadReceipt: loadReceipt,
    evaluatorRunId: result.evaluatorRunId,
    invocationId: result.invocationId,
    responseOutput: result.responseOutput,
    responseOutputHash,
    status: result.status,
    toolCallCount: result.toolCallCount,
  } as const;
  const hostExecution = freezeDeep({
    ...hostSemantic,
    recordHash: hashCanonicalJson(hostSemantic),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.responseOutput);
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_INVALID');
  }
  const decision = normalizeDecisionV2(request, parsed as SemanticDispositionReviewDecisionV2);
  if (hashCanonicalJson(parsed) !== hashCanonicalJson(decision)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_DECISION_MISMATCH');
  }
  const reviewer = createProductionActorIdentityV1({
    providerId: hostExecution.providerId,
    modelId: hostExecution.modelId,
    modelVersion: `${hostExecution.modelVersion}/${hostExecution.methodId}/${hostExecution.methodVersion}`,
    promptHash: hostExecution.compiledPromptHash,
    runId: hostExecution.evaluatorRunId,
    invocationId: hostExecution.invocationId,
    loadReceiptHash: hostExecution.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: hostExecution.responseOutputHash,
  });
  if (
    reviewer.runId === request.semanticRequest.strictWorkflowRunId ||
    reviewer.invocationId === request.semanticRequest.producer.invocationId ||
    reviewer.outputHash === request.semanticRequest.producer.outputHash ||
    reviewer.actorHash === request.semanticRequest.producer.actorHash
  ) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  }
  const decisionHash = hashCanonicalJson(decision);
  const semantic = {
    schemaVersion: 2 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2,
    request,
    hostExecution,
    decision,
    decisionHash,
    reviewer,
    hostAuthorityHash: authority.authorityHash,
  } as const;
  const executionHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    executionId: `semantic-review-execution-v2:${executionHash.slice(7, 31)}`,
    executionHash,
  });
}

export function createAgentSemanticDispositionReviewHostGatewayV3(
  adapter: SemanticDispositionReviewAgentHostAdapterV3
): SemanticDispositionReviewAgentHostGatewayV3 {
  const loadReceipt = normalizeReviewerModelLoadReceipt(adapter.reviewerModelLoadReceipt);
  if (typeof adapter.invoke !== 'function') {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_ADAPTER_V3_INVALID');
  }
  const authoritySemantic = {
    schemaVersion: 3 as const,
    authorityId: `semantic-review-host-authority-v3:${loadReceipt.loadReceiptHash.slice(7, 31)}`,
    reviewerModelLoadReceiptHash: loadReceipt.loadReceiptHash,
  };
  const authority = freezeDeep({
    ...authoritySemantic,
    authorityHash: hashCanonicalJson(authoritySemantic),
  });
  const state: SemanticDispositionReviewHostAuthorityStateV3 = {
    adapter: {
      reviewerModelLoadReceipt: loadReceipt,
      invoke: (call) => adapter.invoke(call),
    },
    executions: new Map(),
    invocationCoordinates: new Set(),
    outputHashes: new Set(),
  };
  SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V3.set(authority, state);
  return freezeDeep({
    authority,
    execute: async (request: SemanticDispositionReviewRequestV3) =>
      executeAgentSemanticDispositionReviewV3(authority, request),
  });
}

async function executeAgentSemanticDispositionReviewV3(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3,
  request: SemanticDispositionReviewRequestV3
): Promise<SemanticDispositionReviewExecutionV3> {
  const state = requireHostAuthorityStateV3(authority);
  assertSemanticDispositionReviewRequestV3(request);
  if (
    state.adapter.reviewerModelLoadReceipt.loadReceiptHash !==
      request.semanticRequest.calibration.reviewerModelLoadReceipt.loadReceiptHash ||
    hashCanonicalJson(state.adapter.reviewerModelLoadReceipt) !==
      hashCanonicalJson(request.semanticRequest.calibration.reviewerModelLoadReceipt)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_LOAD_MISMATCH');
  }
  const call: SemanticDispositionReviewHostCallV3 = freezeDeep({
    schemaVersion: 3,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
    request,
    requestHash: request.requestHash,
    compiledPrompt: request.compiledPrompt,
    compiledPromptHash: request.compiledPromptHash,
  });
  const result = await state.adapter.invoke(call);
  const execution = buildSemanticDispositionReviewExecutionV3(authority, request, result);
  const coordinate = `${execution.hostExecution.evaluatorRunId}\u0000${execution.hostExecution.invocationId}`;
  if (
    state.executions.has(execution.executionHash) ||
    state.invocationCoordinates.has(coordinate) ||
    state.outputHashes.has(execution.hostExecution.responseOutputHash)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_EXECUTION_REUSED');
  }
  state.executions.set(execution.executionHash, execution);
  state.invocationCoordinates.add(coordinate);
  state.outputHashes.add(execution.hostExecution.responseOutputHash);
  return execution;
}

function buildSemanticDispositionReviewExecutionV3(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3,
  request: SemanticDispositionReviewRequestV3,
  result: SemanticDispositionReviewHostResultV2
): SemanticDispositionReviewExecutionV3 {
  for (const value of [result.evaluatorRunId, result.invocationId]) {
    requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_REQUIRED');
  }
  if (result.status !== 'success' || result.toolCallCount !== 0 || !result.responseOutput?.trim()) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_RESULT_INVALID');
  }
  const loadReceipt = request.semanticRequest.calibration.reviewerModelLoadReceipt;
  const responseOutputHash = hashBytes(Buffer.from(result.responseOutput, 'utf8'));
  const hostSemantic = {
    schemaVersion: 3 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
    authorityHash: authority.authorityHash,
    requestId: request.requestId,
    requestHash: request.requestHash,
    compiledPrompt: request.compiledPrompt,
    compiledPromptHash: request.compiledPromptHash,
    providerId: loadReceipt.providerId,
    modelId: loadReceipt.modelId,
    modelVersion: loadReceipt.modelVersion,
    methodId: loadReceipt.methodId,
    methodVersion: loadReceipt.methodVersion,
    runtimeConfigHash: loadReceipt.runtimeConfigHash,
    reviewerModelLoadReceipt: loadReceipt,
    evaluatorRunId: result.evaluatorRunId,
    invocationId: result.invocationId,
    responseOutput: result.responseOutput,
    responseOutputHash,
    status: result.status,
    toolCallCount: result.toolCallCount,
  } as const;
  const hostExecution = freezeDeep({
    ...hostSemantic,
    recordHash: hashCanonicalJson(hostSemantic),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.responseOutput);
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_INVALID');
  }
  const decision = normalizeDecisionV3(request, parsed as SemanticDispositionReviewDecisionV3);
  if (hashCanonicalJson(parsed) !== hashCanonicalJson(decision)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_DECISION_MISMATCH');
  }
  const reviewer = createProductionActorIdentityV1({
    providerId: hostExecution.providerId,
    modelId: hostExecution.modelId,
    modelVersion: `${hostExecution.modelVersion}/${hostExecution.methodId}/${hostExecution.methodVersion}`,
    promptHash: hostExecution.compiledPromptHash,
    runId: hostExecution.evaluatorRunId,
    invocationId: hostExecution.invocationId,
    loadReceiptHash: hostExecution.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: hostExecution.responseOutputHash,
  });
  if (
    reviewer.runId === request.semanticRequest.strictWorkflowRunId ||
    reviewer.invocationId === request.semanticRequest.producer.invocationId ||
    reviewer.outputHash === request.semanticRequest.producer.outputHash ||
    reviewer.actorHash === request.semanticRequest.producer.actorHash
  ) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  }
  const decisionHash = hashCanonicalJson(decision);
  const semantic = {
    schemaVersion: 3 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3,
    request,
    hostExecution,
    decision,
    decisionHash,
    reviewer,
    hostAuthorityHash: authority.authorityHash,
  } as const;
  const executionHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    executionId: `semantic-review-execution-v3:${executionHash.slice(7, 31)}`,
    executionHash,
  });
}

export function assertSemanticDispositionReviewRequestV2(
  request: SemanticDispositionReviewRequestV2
): void {
  let rebuilt: SemanticDispositionReviewRequestV2;
  try {
    rebuilt = createAgentSemanticDispositionReviewRequestV2({
      semanticRequest: request.semanticRequest,
      evidenceAuthorities: request.evidenceAuthorities,
    });
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_V2_INVALID');
  }
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(request)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_V2_HASH_MISMATCH');
  }
}

export function assertSemanticDispositionReviewRequestV3(
  request: SemanticDispositionReviewRequestV3
): void {
  let rebuilt: SemanticDispositionReviewRequestV3;
  try {
    rebuilt = createAgentSemanticDispositionReviewRequestV3({
      semanticRequest: request.semanticRequest,
      evidenceAuthorities: request.evidenceAuthorities,
    });
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_V3_INVALID');
  }
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(request)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_REQUEST_V3_HASH_MISMATCH');
  }
}

export function assertSemanticDispositionReviewExecutionV2(input: {
  readonly execution: SemanticDispositionReviewExecutionV2;
  readonly hostAuthority: SemanticDispositionReviewAgentHostExecutionAuthorityV2;
}): void {
  const state = requireHostAuthorityStateV2(input.hostAuthority);
  assertSemanticDispositionReviewExecutionStructureV2(input.execution, input.hostAuthority);
  const registered = state.executions.get(input.execution.executionHash);
  if (!registered || hashCanonicalJson(registered) !== hashCanonicalJson(input.execution)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
  }
}

export function consumeMainSemanticDispositionReviewExecutionV2(input: {
  readonly execution: SemanticDispositionReviewExecutionV2;
  readonly expectedRequest: SemanticDispositionReviewRequestV2;
  readonly hostAuthority: SemanticDispositionReviewAgentHostExecutionAuthorityV2;
}): KnowledgeDispositionReviewV1 {
  assertSemanticDispositionReviewExecutionV2(input);
  assertSemanticDispositionReviewRequestV2(input.expectedRequest);
  const { execution, expectedRequest } = input;
  if (
    execution.consumerRoute !== SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2 ||
    execution.request.requestHash !== expectedRequest.requestHash ||
    hashCanonicalJson(execution.request) !== hashCanonicalJson(expectedRequest)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_MISMATCH');
  }
  const request = execution.request.semanticRequest;
  return createKnowledgeDispositionReviewV1({
    reviewKind: request.reviewKind,
    currentAnalysisFixpointHash: request.currentAnalysisFixpointHash,
    populationHash: request.populationHash,
    proposedDispositionHash: request.proposedDispositionHash,
    executionReceipts: request.executionReceipts,
    finalExpandedSchedule: request.finalExpandedSchedule,
    terminalObligations: request.context.analysisFixpoint.terminalObligations,
    producer: request.producer,
    reviewer: execution.reviewer,
    calibrationReceiptHash: request.calibration.calibrationReceiptHash,
    verdict: execution.decision.verdict,
    reasonCode: execution.decision.reasonCode,
    semanticExecutionResultHash: execution.executionHash,
  });
}

export interface ProducerZeroDispositionAdmissionAuthorityV1 {
  readonly schemaVersion: 1;
  readonly semanticExecutionHash: string;
  readonly expressionSetReceiptId: string;
  readonly authoredFingerprint: string;
  readonly g1ReceiptHash: string;
  readonly admissionReceiptHash: string;
  readonly acceptedCorpusInspectionHash: string;
  readonly acceptedCorpusHash: string;
  readonly dispositionReviewReceiptHash: string;
  readonly authorityHash: string;
}

/**
 * mandatory zero row 的独立可测试 authority。它既被 unified authority 复用，也让 Agent/Main
 * 在交接前先证明“零输出不是绕过 G1/Admission 的特权路径”。
 */
export function createProducerZeroDispositionAdmissionAuthorityV1(input: {
  readonly execution: SemanticDispositionReviewExecutionV2;
  readonly hostAuthority: SemanticDispositionReviewAgentHostExecutionAuthorityV2;
  readonly expressionSet: HypothesisExpressionSetReceiptV1;
  readonly corpusInspection: StrictAcceptedCorpusInspectionV1;
}): ProducerZeroDispositionAdmissionAuthorityV1 {
  assertSemanticDispositionReviewExecutionV2({
    execution: input.execution,
    hostAuthority: input.hostAuthority,
  });
  return createProducerZeroDispositionAdmissionAuthorityFromVerifiedExecutionV1(input);
}

/**
 * 仅供同包内 durable verifier 在验签完成后复用 zero-chain canonicalizer。该入口不从
 * `@alembic/core/production` 导出；外层调用必须走 durable attestation wrapper。
 */
export function createProducerZeroDispositionAdmissionAuthorityFromVerifiedExecutionV1(input: {
  readonly execution: SemanticDispositionReviewExecutionV2 | SemanticDispositionReviewExecutionV3;
  readonly expressionSet: HypothesisExpressionSetReceiptV1;
  readonly corpusInspection: StrictAcceptedCorpusInspectionV1;
}): ProducerZeroDispositionAdmissionAuthorityV1 {
  assertStrictAcceptedCorpusInspectionV1(input.corpusInspection);
  const request = input.execution.request.semanticRequest;
  const context = request.context;
  if (
    context.reviewKind !== 'producer-non-draft' ||
    context.proposal.expression !== null ||
    !context.proposal.zeroDisposition ||
    context.proposal.zeroDisposition.terminalFate !== 'reviewed-non-draft' ||
    !context.target.authoredFingerprint
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ZERO_AUTHORITY_REQUIRED');
  }
  const zeroProposal = context.proposal.zeroDisposition;
  const rebuiltAdmission = createStrictAdmissionReceiptV1({
    g1Receipt: context.g1Receipt,
    corpusInspection: input.corpusInspection,
    inputFingerprint: context.admissionReceipt.inputFingerprint,
    finalAdmittedFingerprint: context.admissionReceipt.finalAdmittedFingerprint,
    exactMatches: context.admissionReceipt.exactMatches,
    semanticMatches: context.admissionReceipt.semanticMatches,
    consolidation: context.admissionReceipt.consolidation,
    algorithmVersion: context.admissionReceipt.algorithmVersion,
  });
  const zeroDisposition = input.expressionSet.zeroDisposition;
  if (
    !zeroDisposition ||
    zeroExpressionSetAuthorityInvalid(input, request, context, zeroProposal, zeroDisposition) ||
    zeroAdmissionAuthorityInvalid(context, rebuiltAdmission)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ZERO_ADMISSION_CHAIN_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    semanticExecutionHash: input.execution.executionHash,
    expressionSetReceiptId: input.expressionSet.receiptId,
    authoredFingerprint: context.target.authoredFingerprint,
    g1ReceiptHash: context.g1Receipt.receiptHash,
    admissionReceiptHash: context.admissionReceipt.receiptHash,
    acceptedCorpusInspectionHash: input.corpusInspection.inspectionHash,
    acceptedCorpusHash: input.corpusInspection.acceptedCorpusHash,
    dispositionReviewReceiptHash: zeroDisposition.dispositionReview.receiptHash,
  };
  return freezeDeep({ ...semantic, authorityHash: hashCanonicalJson(semantic) });
}

function zeroExpressionSetAuthorityInvalid(
  input: Parameters<
    typeof createProducerZeroDispositionAdmissionAuthorityFromVerifiedExecutionV1
  >[0],
  request: SemanticDispositionReviewRequestV1,
  context: ProducerNonDraftDispositionReviewContextV1,
  zeroProposal: NonNullable<
    ProducerNonDraftDispositionReviewContextV1['proposal']['zeroDisposition']
  >,
  zeroDisposition: NonNullable<HypothesisExpressionSetReceiptV1['zeroDisposition']>
): boolean {
  return (
    input.expressionSet.hypothesisId !== context.proposal.hypothesisId ||
    input.expressionSet.receiptId !== context.expressionSetReceiptId ||
    input.expressionSet.analysisFixpointHash !== request.currentAnalysisFixpointHash ||
    input.expressionSet.privateCorpusRevision !== context.privateCorpusRevision ||
    input.expressionSet.expressions.length !== 0 ||
    zeroDisposition.terminalFate !== 'reviewed-non-draft' ||
    zeroDisposition.reasonCode !== zeroProposal.reasonCode ||
    zeroDisposition.dispositionReview.semanticExecutionResultHash !==
      input.execution.executionHash ||
    zeroDisposition.dispositionReview.verdict !== 'pass'
  );
}

function zeroAdmissionAuthorityInvalid(
  context: ProducerNonDraftDispositionReviewContextV1,
  rebuiltAdmission: StrictAdmissionReceiptV1
): boolean {
  return (
    context.g1Receipt.verdict !== 'pass' ||
    context.g1Receipt.candidateFingerprint !== context.target.authoredFingerprint ||
    context.admissionReceipt.disposition !== 'admit' ||
    context.admissionReceipt.inputFingerprint !== context.target.authoredFingerprint ||
    context.admissionReceipt.finalAdmittedFingerprint !== context.target.authoredFingerprint ||
    context.admissionReceipt.g1ReceiptHash !== context.g1Receipt.receiptHash ||
    hashCanonicalJson(rebuiltAdmission) !== hashCanonicalJson(context.admissionReceipt)
  );
}

function assertAndFreezeEvidenceAuthorityV2(
  authority: SemanticDispositionReviewEvidenceAuthorityV2
): SemanticDispositionReviewEvidenceAuthorityV2 {
  const { authorityHash, ...semantic } = authority;
  if (authority.schemaVersion !== 2 || hashCanonicalJson(semantic) !== authorityHash) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  }
  const rebuilt = createSemanticDispositionReviewEvidenceAuthorityV2({
    evidenceEntry: authority.evidenceEntry,
    evidenceLedgerSnapshot: authority.evidenceLedgerSnapshot,
    witnessBinding: authority.witnessBinding,
    executionReceipt: authority.executionReceipt,
    fileExecutionHash: authority.fileExecutionHash,
    semanticRole: authority.semanticRole,
  });
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(authority)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  }
  return rebuilt;
}

function evidenceSummaryFromAuthorityV2(
  authority: SemanticDispositionReviewEvidenceAuthorityV2,
  request: SemanticDispositionReviewRequestV1
): SemanticDispositionReviewEvidenceV1 {
  const receipt = request.executionReceipts.find(
    (candidate) => candidate.receiptHash === authority.executionReceiptHash
  );
  const fileExecution = receipt?.fileExecutions.find(
    (candidate) => candidate.executionHash === authority.fileExecutionHash
  );
  if (!receipt || !fileExecution) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_MISMATCH');
  }
  const semantic = {
    evidenceEntryId: authority.evidenceEntry.id,
    evidenceSessionId: authority.evidenceEntry.sessionId,
    sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
    canonicalSubjectRef: receipt.canonicalSubjectRef,
    relativePath: fileExecution.relativePath,
    blobHash: fileExecution.blobHash,
    content: authority.evidenceEntry.content,
    contentHash: authority.evidenceEntry.contentHash,
    semanticRole: authority.semanticRole,
  };
  return { ...semantic, evidenceHash: hashCanonicalJson(semantic) };
}

function assertAndFreezeEvidenceAuthorityV3(
  authority: SemanticDispositionReviewEvidenceAuthorityV3,
  request: SemanticDispositionReviewRequestV1
): SemanticDispositionReviewEvidenceAuthorityV3 {
  const { authorityHash, ...semantic } = authority;
  if (authority.schemaVersion !== 3 || hashCanonicalJson(semantic) !== authorityHash) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
  }
  const receiptsByHash = new Map(
    request.executionReceipts.map((receipt) => [receipt.receiptHash, receipt] as const)
  );
  const executionReceipts = authority.executionReceiptBindings.map((binding) => {
    const receipt = receiptsByHash.get(binding.executionReceiptHash);
    if (
      !receipt ||
      binding.obligationId !== receipt.obligationId ||
      binding.analysisScale !== receipt.analysisScale ||
      binding.harvestKey !== receipt.harvestKey ||
      binding.harvestReceiptHash !== receipt.harvestReceiptHash ||
      binding.sourceRevisionVectorHash !== receipt.sourceRevisionVectorHash ||
      binding.canonicalSubjectRef !== receipt.canonicalSubjectRef
    ) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
    }
    const { bindingHash, ...bindingSemantic } = binding;
    if (hashCanonicalJson(bindingSemantic) !== bindingHash) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
    }
    return receipt;
  });
  const rebuilt = createSemanticDispositionReviewEvidenceAuthorityV3({
    evidenceEntry: authority.evidenceEntry,
    evidenceLedgerSnapshot: authority.evidenceLedgerSnapshot,
    witnessBinding: authority.witnessBinding,
    executionReceipts,
    semanticRole: authority.semanticRole,
  });
  if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(authority)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
  }
  return rebuilt;
}

function evidenceSummaryFromAuthorityV3(
  authority: SemanticDispositionReviewEvidenceAuthorityV3,
  request: SemanticDispositionReviewRequestV1
): SemanticDispositionReviewEvidenceV1 {
  const firstBinding = authority.executionReceiptBindings[0];
  const receipt = request.executionReceipts.find(
    (candidate) => candidate.receiptHash === firstBinding?.executionReceiptHash
  );
  const fileExecution = receipt?.fileExecutions.find(
    (candidate) => candidate.executionHash === firstBinding?.fileExecutionHash
  );
  if (!receipt || !fileExecution) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_MISMATCH');
  }
  const semantic = {
    evidenceEntryId: authority.evidenceEntry.id,
    evidenceSessionId: authority.evidenceEntry.sessionId,
    sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
    canonicalSubjectRef: receipt.canonicalSubjectRef,
    relativePath: fileExecution.relativePath,
    blobHash: fileExecution.blobHash,
    content: authority.evidenceEntry.content,
    contentHash: authority.evidenceEntry.contentHash,
    semanticRole: authority.semanticRole,
  };
  return { ...semantic, evidenceHash: hashCanonicalJson(semantic) };
}

/**
 * Core 从 semantic request 的完整 receipt universe 确定 expected set；Agent store 只负责
 * 读取/证明 Ledger 与 witness，不得自行猜测 scale grouping。
 */
export function createSemanticDispositionReviewExpectedExecutionReceiptBindingsV3(input: {
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidence: SemanticDispositionReviewEvidenceV1;
}): readonly SemanticDispositionReviewExecutionReceiptBindingV3[] {
  assertSemanticDispositionReviewRequestV1(input.semanticRequest);
  const rows = input.semanticRequest.executionReceipts
    .flatMap((receipt) => {
      const fileExecutions = receipt.fileExecutions.filter(
        (fileExecution) =>
          fileExecution.evidenceEntryId === input.evidence.evidenceEntryId &&
          fileExecution.relativePath === input.evidence.relativePath &&
          fileExecution.blobHash === input.evidence.blobHash &&
          receipt.sourceRevisionVectorHash === input.evidence.sourceRevisionVectorHash &&
          receipt.canonicalSubjectRef === input.evidence.canonicalSubjectRef
      );
      if (fileExecutions.length > 1) {
        fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_EXECUTION_AMBIGUOUS');
      }
      if (fileExecutions.length === 0) {
        return [];
      }
      const semantic = {
        schemaVersion: 3 as const,
        obligationId: receipt.obligationId,
        analysisScale: receipt.analysisScale,
        executionReceiptHash: receipt.receiptHash,
        harvestKey: receipt.harvestKey,
        harvestReceiptHash: receipt.harvestReceiptHash,
        sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
        canonicalSubjectRef: receipt.canonicalSubjectRef,
        fileExecutionHash: fileExecutions[0]!.executionHash,
      };
      return [{ ...semantic, bindingHash: hashCanonicalJson(semantic) }];
    })
    .sort(
      (left, right) =>
        left.obligationId.localeCompare(right.obligationId) ||
        left.executionReceiptHash.localeCompare(right.executionReceiptHash)
    );
  if (
    rows.length === 0 ||
    new Set(rows.map((row) => row.executionReceiptHash)).size !== rows.length ||
    new Set(rows.map((row) => row.obligationId)).size !== rows.length ||
    new Set(rows.map((row) => row.harvestKey)).size !== 1 ||
    new Set(rows.map((row) => row.harvestReceiptHash)).size !== 1 ||
    new Set(rows.map((row) => row.fileExecutionHash)).size !== 1
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_EXECUTION_SET_INVALID');
  }
  return freezeDeep(rows);
}

function normalizeDecisionV2(
  request: SemanticDispositionReviewRequestV2,
  decision: SemanticDispositionReviewDecisionV2
): SemanticDispositionReviewDecisionV2 {
  if (
    decision?.schemaVersion !== 2 ||
    decision.requestHash !== request.requestHash ||
    decision.compiledPromptHash !== request.compiledPromptHash ||
    decision.semanticRequestHash !== request.semanticRequest.requestHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_DECISION_CONTEXT_MISMATCH');
  }
  const normalizedV1 = normalizeDecision(request.semanticRequest, {
    schemaVersion: 1,
    requestHash: request.semanticRequest.requestHash,
    promptHash: request.semanticRequest.promptHash,
    contextHash: decision.contextHash,
    reviewKind: decision.reviewKind,
    proposedDispositionHash: decision.proposedDispositionHash,
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    axisDecisions: decision.axisDecisions,
    evidenceFindings: decision.evidenceFindings,
  });
  return freezeDeep({
    ...decision,
    reasonCode: normalizedV1.reasonCode,
    axisDecisions: normalizedV1.axisDecisions,
    evidenceFindings: normalizedV1.evidenceFindings,
  });
}

function normalizeDecisionV3(
  request: SemanticDispositionReviewRequestV3,
  decision: SemanticDispositionReviewDecisionV3
): SemanticDispositionReviewDecisionV3 {
  if (
    decision?.schemaVersion !== 3 ||
    decision.requestHash !== request.requestHash ||
    decision.compiledPromptHash !== request.compiledPromptHash ||
    decision.semanticRequestHash !== request.semanticRequest.requestHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_DECISION_CONTEXT_MISMATCH');
  }
  const normalizedV1 = normalizeDecision(request.semanticRequest, {
    schemaVersion: 1,
    requestHash: request.semanticRequest.requestHash,
    promptHash: request.semanticRequest.promptHash,
    contextHash: decision.contextHash,
    reviewKind: decision.reviewKind,
    proposedDispositionHash: decision.proposedDispositionHash,
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    axisDecisions: decision.axisDecisions,
    evidenceFindings: decision.evidenceFindings,
  });
  return freezeDeep({
    ...decision,
    reasonCode: normalizedV1.reasonCode,
    axisDecisions: normalizedV1.axisDecisions,
    evidenceFindings: normalizedV1.evidenceFindings,
  });
}

function assertSemanticDispositionReviewExecutionStructureV2(
  execution: SemanticDispositionReviewExecutionV2,
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2
): void {
  assertSemanticDispositionReviewRequestV2(execution.request);
  const host = execution.hostExecution;
  const { recordHash: _recordHash, ...hostSemantic } = host;
  const decision = normalizeDecisionV2(execution.request, execution.decision);
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(host.responseOutput);
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_INVALID');
  }
  const loadReceipt = execution.request.semanticRequest.calibration.reviewerModelLoadReceipt;
  const expectedReviewer = createProductionActorIdentityV1({
    providerId: host.providerId,
    modelId: host.modelId,
    modelVersion: `${host.modelVersion}/${host.methodId}/${host.methodVersion}`,
    promptHash: host.compiledPromptHash,
    runId: host.evaluatorRunId,
    invocationId: host.invocationId,
    loadReceiptHash: host.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: host.responseOutputHash,
  });
  const semantic = {
    schemaVersion: 2 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2,
    request: execution.request,
    hostExecution: host,
    decision,
    decisionHash: hashCanonicalJson(decision),
    reviewer: expectedReviewer,
    hostAuthorityHash: authority.authorityHash,
  } as const;
  if (
    hostExecutionRequestLineageInvalid(execution, authority) ||
    hostExecutionModelLineageInvalid(host, loadReceipt) ||
    hostExecutionPayloadInvalid(host, hostSemantic, parsedOutput, decision) ||
    semanticExecutionEnvelopeInvalid(execution, authority, expectedReviewer, semantic)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_V2_INVALID');
  }
}

/**
 * Durable V3 只复用 V2 的结构与因果字段校验，不读取 process-local registry。最终 authority
 * 由 V3 对完整 execution + frozen-store load receipts 的 detached signature 提供。
 */
export function assertSemanticDispositionReviewExecutionStructureV2ForDurableTrust(
  execution: SemanticDispositionReviewExecutionV2
): void {
  assertSemanticDispositionReviewExecutionStructureV2(execution, {
    schemaVersion: 2,
    authorityId: 'durable-attestation-embedded-host-authority',
    reviewerModelLoadReceiptHash:
      execution.request.semanticRequest.calibration.reviewerModelLoadReceipt.loadReceiptHash,
    authorityHash: execution.hostAuthorityHash,
  });
}

function assertSemanticDispositionReviewExecutionStructureV3(
  execution: SemanticDispositionReviewExecutionV3,
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3
): void {
  assertSemanticDispositionReviewRequestV3(execution.request);
  const host = execution.hostExecution;
  const { recordHash: _recordHash, ...hostSemantic } = host;
  const decision = normalizeDecisionV3(execution.request, execution.decision);
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(host.responseOutput);
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_INVALID');
  }
  const loadReceipt = execution.request.semanticRequest.calibration.reviewerModelLoadReceipt;
  const expectedReviewer = createProductionActorIdentityV1({
    providerId: host.providerId,
    modelId: host.modelId,
    modelVersion: `${host.modelVersion}/${host.methodId}/${host.methodVersion}`,
    promptHash: host.compiledPromptHash,
    runId: host.evaluatorRunId,
    invocationId: host.invocationId,
    loadReceiptHash: host.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: host.responseOutputHash,
  });
  const semantic = {
    schemaVersion: 3 as const,
    producerRoute: SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3,
    consumerRoute: SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3,
    request: execution.request,
    hostExecution: host,
    decision,
    decisionHash: hashCanonicalJson(decision),
    reviewer: expectedReviewer,
    hostAuthorityHash: authority.authorityHash,
  } as const;
  if (
    hostExecutionRequestLineageInvalid(execution, authority) ||
    hostExecutionModelLineageInvalid(host, loadReceipt) ||
    hostExecutionPayloadInvalid(host, hostSemantic, parsedOutput, decision) ||
    semanticExecutionEnvelopeInvalidV3(execution, authority, expectedReviewer, semantic)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_V3_INVALID');
  }
}

/**
 * Durable V4 对完整 V3 execution + shared-harvest store receipts 验签；这里仍只做纯结构校验。
 */
export function assertSemanticDispositionReviewExecutionStructureV3ForDurableTrust(
  execution: SemanticDispositionReviewExecutionV3
): void {
  assertSemanticDispositionReviewExecutionStructureV3(execution, {
    schemaVersion: 3,
    authorityId: 'durable-attestation-embedded-host-authority-v3',
    reviewerModelLoadReceiptHash:
      execution.request.semanticRequest.calibration.reviewerModelLoadReceipt.loadReceiptHash,
    authorityHash: execution.hostAuthorityHash,
  });
}

function hostExecutionRequestLineageInvalid(
  execution: SemanticDispositionReviewExecutionV2 | SemanticDispositionReviewExecutionV3,
  authority:
    | SemanticDispositionReviewAgentHostExecutionAuthorityV2
    | SemanticDispositionReviewAgentHostExecutionAuthorityV3
): boolean {
  const host = execution.hostExecution;
  return (
    host.authorityHash !== authority.authorityHash ||
    host.requestId !== execution.request.requestId ||
    host.requestHash !== execution.request.requestHash ||
    host.compiledPrompt !== execution.request.compiledPrompt ||
    host.compiledPromptHash !== execution.request.compiledPromptHash
  );
}

function hostExecutionModelLineageInvalid(
  host:
    | SemanticDispositionReviewerHostExecutionRecordV2
    | SemanticDispositionReviewerHostExecutionRecordV3,
  loadReceipt: SemanticDispositionReviewerModelLoadReceiptV1
): boolean {
  return (
    host.providerId !== loadReceipt.providerId ||
    host.modelId !== loadReceipt.modelId ||
    host.modelVersion !== loadReceipt.modelVersion ||
    host.methodId !== loadReceipt.methodId ||
    host.methodVersion !== loadReceipt.methodVersion ||
    host.runtimeConfigHash !== loadReceipt.runtimeConfigHash ||
    hashCanonicalJson(host.reviewerModelLoadReceipt) !== hashCanonicalJson(loadReceipt)
  );
}

function hostExecutionPayloadInvalid(
  host:
    | SemanticDispositionReviewerHostExecutionRecordV2
    | SemanticDispositionReviewerHostExecutionRecordV3,
  hostSemantic:
    | Omit<SemanticDispositionReviewerHostExecutionRecordV2, 'recordHash'>
    | Omit<SemanticDispositionReviewerHostExecutionRecordV3, 'recordHash'>,
  parsedOutput: unknown,
  decision: SemanticDispositionReviewDecisionV2 | SemanticDispositionReviewDecisionV3
): boolean {
  return (
    hashBytes(Buffer.from(host.compiledPrompt, 'utf8')) !== host.compiledPromptHash ||
    hashBytes(Buffer.from(host.responseOutput, 'utf8')) !== host.responseOutputHash ||
    hashCanonicalJson(parsedOutput) !== hashCanonicalJson(decision) ||
    hashCanonicalJson(hostSemantic) !== host.recordHash
  );
}

function semanticExecutionEnvelopeInvalid(
  execution: SemanticDispositionReviewExecutionV2,
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2,
  expectedReviewer: ProductionActorIdentityV1,
  semantic: Omit<SemanticDispositionReviewExecutionV2, 'executionId' | 'executionHash'>
): boolean {
  return (
    execution.schemaVersion !== 2 ||
    execution.producerRoute !== SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V2 ||
    execution.consumerRoute !== SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V2 ||
    execution.hostAuthorityHash !== authority.authorityHash ||
    hashCanonicalJson(execution.reviewer) !== hashCanonicalJson(expectedReviewer) ||
    execution.decisionHash !== semantic.decisionHash ||
    execution.executionHash !== hashCanonicalJson(semantic) ||
    execution.executionId !== `semantic-review-execution-v2:${execution.executionHash.slice(7, 31)}`
  );
}

function semanticExecutionEnvelopeInvalidV3(
  execution: SemanticDispositionReviewExecutionV3,
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3,
  expectedReviewer: ProductionActorIdentityV1,
  semantic: Omit<SemanticDispositionReviewExecutionV3, 'executionId' | 'executionHash'>
): boolean {
  return (
    execution.schemaVersion !== 3 ||
    execution.producerRoute !== SEMANTIC_DISPOSITION_REVIEW_AGENT_PRODUCER_ROUTE_V3 ||
    execution.consumerRoute !== SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_ROUTE_V3 ||
    execution.hostAuthorityHash !== authority.authorityHash ||
    hashCanonicalJson(execution.reviewer) !== hashCanonicalJson(expectedReviewer) ||
    execution.decisionHash !== semantic.decisionHash ||
    execution.executionHash !== hashCanonicalJson(semantic) ||
    execution.executionId !== `semantic-review-execution-v3:${execution.executionHash.slice(7, 31)}`
  );
}

function requireHostAuthorityStateV2(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV2
): SemanticDispositionReviewHostAuthorityStateV2 {
  const state = SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V2.get(authority);
  if (!state) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
  }
  return state;
}

function requireHostAuthorityStateV3(
  authority: SemanticDispositionReviewAgentHostExecutionAuthorityV3
): SemanticDispositionReviewHostAuthorityStateV3 {
  const state = SEMANTIC_DISPOSITION_HOST_AUTHORITIES_V3.get(authority);
  if (!state) {
    fail('SEMANTIC_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
  }
  return state;
}

function validateRequestContext(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  executionReceipts: readonly FactQueryExecutionReceiptV1[]
): void {
  const context = input.context;
  if (
    finalExpandedScheduleInvalid(input.finalExpandedSchedule) ||
    context.analysisFixpoint.fixpointHash !== input.currentAnalysisFixpointHash ||
    context.population.populationHash !== input.populationHash ||
    context.population.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    !context.analysisFixpoint.populationHashes.includes(input.populationHash) ||
    context.analysisFixpoint.finalExpandedScheduleHash !==
      input.finalExpandedSchedule.finalExpandedScheduleHash ||
    !sameStrings(
      input.finalExpandedSchedule.obligationIds,
      context.analysisFixpoint.terminalObligations.map((row) => row.obligationId)
    ) ||
    !sameStrings(
      executionReceipts.map((receipt) => receipt.obligationId),
      input.finalExpandedSchedule.obligationIds
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_CONTEXT_MISMATCH');
  }
  if (context.reviewKind === 'producer-non-draft') {
    validateProducerContext(input, context);
  } else {
    validateInvestigatedEmptyContext(input, context, executionReceipts);
  }
}

function finalExpandedScheduleInvalid(schedule: FinalExpandedMiningScheduleReceiptV1): boolean {
  const semantic = {
    schemaVersion: schedule.schemaVersion,
    baselineScheduleHash: schedule.baselineScheduleHash,
    expansionReceiptHashes: schedule.expansionReceiptHashes,
    obligationIds: schedule.obligationIds,
    explorationObligationCount: schedule.explorationObligationCount,
    counterexampleObligationCount: schedule.counterexampleObligationCount,
  };
  return (
    schedule.schemaVersion !== 1 ||
    hashCanonicalJson(semantic) !== schedule.finalExpandedScheduleHash
  );
}

function validateProducerContext(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: ProducerNonDraftDispositionReviewContextV1
): void {
  const hypothesis = context.induction.hypotheses.find(
    (candidate) => candidate.hypothesisId === context.proposal.hypothesisId
  );
  if (producerLineageInvalid(input, context, hypothesis?.hypothesisId)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_PRODUCER_CONTEXT_MISMATCH');
  }
  const expression = context.proposal.expression;
  validateProducerAdmissionContext(input, context, expression);
}

function producerLineageInvalid(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: ProducerNonDraftDispositionReviewContextV1,
  hypothesisId: string | undefined
): boolean {
  return (
    !context.privateCorpusRevision.trim() ||
    !context.expressionSetReceiptId.trim() ||
    !hypothesisId ||
    context.induction.populationHash !== input.populationHash ||
    context.falsification.hypothesisId !== hypothesisId ||
    context.proposal.populationHash !== input.populationHash ||
    hashKnowledgeDispositionProposalV1(context.proposal) !== input.proposedDispositionHash
  );
}

function validateProducerAdmissionContext(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: ProducerNonDraftDispositionReviewContextV1,
  expression: ProducerNonDraftDispositionReviewContextV1['proposal']['expression']
): void {
  assertStrictG1ReceiptV1(context.g1Receipt);
  const admission = context.admissionReceipt;
  if (!admission) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_REQUIRED');
  }
  assertStrictAdmissionReceiptV1(admission);
  const expectedDisposition = !expression
    ? 'admit'
    : expression.terminalFate === 'reviewed-merge'
      ? 'merge'
      : expression.terminalFate === 'reviewed-duplicate'
        ? 'duplicate'
        : null;
  const authoredFingerprint = expression?.authoredFingerprint ?? context.target.authoredFingerprint;
  if (
    !authoredFingerprint ||
    context.g1Receipt.verdict !== 'pass' ||
    context.g1Receipt.candidateFingerprint !== authoredFingerprint ||
    admission.g1ReceiptHash !== context.g1Receipt.receiptHash ||
    producerAdmissionLineageInvalid(
      input,
      context,
      authoredFingerprint,
      admission,
      expectedDisposition
    ) ||
    (expression
      ? producerAdmissionTargetInvalid(context, expression, admission)
      : producerZeroTargetInvalid(context, admission))
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_CONTEXT_MISMATCH');
  }
}

function producerAdmissionLineageInvalid(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: ProducerNonDraftDispositionReviewContextV1,
  authoredFingerprint: string,
  admission: StrictAdmissionReceiptV1,
  expectedDisposition: StrictAdmissionReceiptV1['disposition'] | null
): boolean {
  return (
    !expectedDisposition ||
    admission.disposition !== expectedDisposition ||
    admission.runId !== input.strictWorkflowRunId ||
    admission.analysisFixpointHash !== input.currentAnalysisFixpointHash ||
    admission.privateCorpusRevision !== context.privateCorpusRevision ||
    admission.inputFingerprint !== authoredFingerprint ||
    admission.finalAdmittedFingerprint !== authoredFingerprint
  );
}

function producerAdmissionTargetInvalid(
  context: ProducerNonDraftDispositionReviewContextV1,
  expression: NonNullable<ProducerNonDraftDispositionReviewContextV1['proposal']['expression']>,
  admission: StrictAdmissionReceiptV1
): boolean {
  return (
    context.target.expressionId !== expression.expressionId ||
    context.target.authoredFingerprint !== expression.authoredFingerprint ||
    context.target.terminalFate !== expression.terminalFate ||
    context.target.targetRecipeId !== expression.matchingRepresentativeId ||
    context.target.targetRecipeId !== expression.matchingContentReadyRecipeId ||
    context.target.targetRecipeId !== admission.consolidation.targetRecipeId ||
    context.target.targetFingerprint !== admission.consolidation.targetFingerprint ||
    !context.target.targetReadyProofHash ||
    !/^sha256:[0-9a-f]{64}$/.test(context.target.targetReadyProofHash)
  );
}

function producerZeroTargetInvalid(
  context: ProducerNonDraftDispositionReviewContextV1,
  admission: StrictAdmissionReceiptV1
): boolean {
  return (
    !context.proposal.zeroDisposition ||
    context.target.expressionId !== null ||
    !context.target.authoredFingerprint?.trim() ||
    context.target.terminalFate !== 'reviewed-non-draft' ||
    context.target.targetRecipeId !== null ||
    context.target.targetFingerprint !== null ||
    context.target.targetReadyProofHash !== null ||
    admission.disposition !== 'admit' ||
    admission.consolidation.action !== 'create' ||
    admission.consolidation.targetRecipeId !== null ||
    admission.consolidation.targetFingerprint !== null
  );
}

function validateInvestigatedEmptyContext(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: InvestigatedEmptyDispositionReviewContextV1,
  executionReceipts: readonly FactQueryExecutionReceiptV1[]
): void {
  const negative = context.negativeEvidenceSufficiency;
  const executionBindings = executionReceipts.map(executionBinding);
  if (
    investigatedEmptyProposalInvalid(input, context, executionBindings) ||
    investigatedEmptyPopulationInvalid(context, executionReceipts) ||
    investigatedEmptyNegativeEvidenceInvalid(input, negative)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_NEGATIVE_EVIDENCE_INVALID');
  }
}

function investigatedEmptyProposalInvalid(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: InvestigatedEmptyDispositionReviewContextV1,
  executionBindings: readonly KnowledgeDispositionExecutionBindingV1[]
): boolean {
  return (
    context.proposal.populationHash !== input.populationHash ||
    context.proposal.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    context.proposal.currentAnalysisFixpointHash !== input.currentAnalysisFixpointHash ||
    context.proposal.finalExpandedScheduleHash !==
      input.finalExpandedSchedule.finalExpandedScheduleHash ||
    hashKnowledgeDispositionProposalV1(context.proposal) !== input.proposedDispositionHash ||
    !sameStrings(
      context.proposal.expectedObligationIds,
      input.finalExpandedSchedule.obligationIds
    ) ||
    hashCanonicalJson(context.proposal.executionBindings) !==
      hashCanonicalJson(executionBindings) ||
    !sameStrings(
      context.proposal.evidenceEntryIds,
      input.evidence.map((row) => row.evidenceEntryId)
    )
  );
}

function investigatedEmptyPopulationInvalid(
  context: InvestigatedEmptyDispositionReviewContextV1,
  executionReceipts: readonly FactQueryExecutionReceiptV1[]
): boolean {
  return (
    context.population.completion !== 'complete' ||
    context.population.observations.length !== 0 ||
    context.population.conservation.error !== 0 ||
    context.population.conservation.omitted !== 0 ||
    executionReceipts.some(
      (receipt) =>
        receipt.disposition !== 'inspected-no-pattern' ||
        receipt.inspectedFileCount !== receipt.expectedFileCount ||
        receipt.expectedFileCount === 0 ||
        receipt.emittedFactIds.length > 0
    )
  );
}

function investigatedEmptyNegativeEvidenceInvalid(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  negative: InvestigatedEmptyDispositionReviewContextV1['negativeEvidenceSufficiency']
): boolean {
  return (
    !negative.claim.trim() ||
    !negative.reasonCode.trim() ||
    normalizeStrings(negative.requiredAbsencePredicates).length === 0 ||
    !sameStrings(
      negative.inspectedEvidenceEntryIds,
      input.evidence.map((row) => row.evidenceEntryId)
    )
  );
}

function normalizeExecutionReceipts(
  receipts: readonly FactQueryExecutionReceiptV1[],
  sourceRevisionVectorHash: string
): FactQueryExecutionReceiptV1[] {
  if (receipts.length === 0) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_REQUIRED');
  }
  const normalized = [...receipts].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  if (new Set(normalized.map((receipt) => receipt.receiptHash)).size !== normalized.length) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_REUSED');
  }
  for (const receipt of normalized) {
    assertReviewAuthorizingFactExecutionV1(receipt);
    if (receipt.sourceRevisionVectorHash !== sourceRevisionVectorHash) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_CONTEXT_MISMATCH');
    }
  }
  return normalized;
}

function executionBinding(
  receipt: FactQueryExecutionReceiptV1
): KnowledgeDispositionExecutionBindingV1 {
  return {
    obligationId: receipt.obligationId,
    executionReceiptHash: receipt.receiptHash,
    executionOutputHash: receipt.outputHash,
    denominatorHash: receipt.denominatorHash,
    disposition: receipt.disposition,
    terminalReceiptId: receipt.terminalReceiptId,
  };
}

function normalizeEvidence(
  evidence: readonly Omit<SemanticDispositionReviewEvidenceV1, 'evidenceHash'>[],
  sourceRevisionVectorHash: string
): SemanticDispositionReviewEvidenceV1[] {
  const normalized = evidence
    .map((row) => {
      const { evidenceHash: _evidenceHash, ...semanticInput } = row as Omit<
        SemanticDispositionReviewEvidenceV1,
        'evidenceHash'
      > &
        Partial<Pick<SemanticDispositionReviewEvidenceV1, 'evidenceHash'>>;
      for (const value of [
        semanticInput.evidenceEntryId,
        semanticInput.evidenceSessionId,
        semanticInput.canonicalSubjectRef,
        semanticInput.relativePath,
        semanticInput.semanticRole,
      ]) {
        requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_REQUIRED');
      }
      requireSha256(semanticInput.blobHash, 'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_BLOB_INVALID');
      requireSha256(
        semanticInput.contentHash,
        'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_CONTENT_INVALID'
      );
      if (
        semanticInput.sourceRevisionVectorHash !== sourceRevisionVectorHash ||
        !semanticInput.content.trim() ||
        hashBytes(Buffer.from(semanticInput.content)) !== semanticInput.contentHash
      ) {
        fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_INVALID');
      }
      const semantic = {
        ...semanticInput,
        semanticRole: semanticInput.semanticRole.trim(),
      };
      return { ...semantic, evidenceHash: hashCanonicalJson(semantic) };
    })
    .sort((left, right) => left.evidenceEntryId.localeCompare(right.evidenceEntryId));
  if (
    normalized.length === 0 ||
    new Set(normalized.map((row) => row.evidenceEntryId)).size !== normalized.length
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_REQUIRED');
  }
  return normalized;
}

function normalizeCalibration(
  calibration: Omit<SemanticDispositionReviewCalibrationV1, 'calibrationHash'>,
  reviewKind: SemanticDispositionReviewKindV1
): SemanticDispositionReviewCalibrationV1 {
  const { calibrationHash: _calibrationHash, ...semanticInput } = calibration as Omit<
    SemanticDispositionReviewCalibrationV1,
    'calibrationHash'
  > &
    Partial<Pick<SemanticDispositionReviewCalibrationV1, 'calibrationHash'>>;
  for (const value of [
    semanticInput.providerId,
    semanticInput.modelId,
    semanticInput.modelVersion,
    semanticInput.methodId,
    semanticInput.methodVersion,
    semanticInput.rubricVersion,
  ]) {
    requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_CALIBRATION_REQUIRED');
  }
  const reviewerModelLoadReceipt = normalizeReviewerModelLoadReceipt(
    semanticInput.reviewerModelLoadReceipt
  );
  if (
    reviewerModelLoadReceipt.providerId !== semanticInput.providerId ||
    reviewerModelLoadReceipt.modelId !== semanticInput.modelId ||
    reviewerModelLoadReceipt.modelVersion !== semanticInput.modelVersion ||
    reviewerModelLoadReceipt.methodId !== semanticInput.methodId ||
    reviewerModelLoadReceipt.methodVersion !== semanticInput.methodVersion
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_LOAD_RECEIPT_INVALID');
  }
  requireSha256(
    semanticInput.calibrationReceiptHash,
    'SEMANTIC_DISPOSITION_REVIEW_CALIBRATION_INVALID'
  );
  const expectedAxes = expectedAxisIds(reviewKind);
  const axes = [...semanticInput.axes].sort((left, right) =>
    left.axisId.localeCompare(right.axisId)
  );
  if (
    !sameStrings(
      axes.map((axis) => axis.axisId),
      expectedAxes
    ) ||
    axes.some(
      (axis) =>
        !Number.isFinite(axis.minimumScore) ||
        axis.minimumScore <= 0 ||
        axis.minimumScore > 1 ||
        !/^sha256:[0-9a-f]{64}$/.test(axis.calibrationEvidenceHash)
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_CALIBRATION_INVALID');
  }
  const semantic = { ...semanticInput, reviewerModelLoadReceipt, axes };
  return { ...semantic, calibrationHash: hashCanonicalJson(semantic) };
}

function normalizeReviewerModelLoadReceipt(
  receipt: SemanticDispositionReviewerModelLoadReceiptV1
): SemanticDispositionReviewerModelLoadReceiptV1 {
  for (const value of [
    receipt.providerId,
    receipt.modelId,
    receipt.modelVersion,
    receipt.methodId,
    receipt.methodVersion,
    receipt.credentialLocationSymbol,
  ]) {
    requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_LOAD_RECEIPT_INVALID');
  }
  requireSha256(receipt.runtimeConfigHash, 'SEMANTIC_DISPOSITION_REVIEW_LOAD_RECEIPT_INVALID');
  const { loadReceiptHash: _loadReceiptHash, ...semantic } = receipt;
  if (receipt.schemaVersion !== 1 || hashCanonicalJson(semantic) !== receipt.loadReceiptHash) {
    fail('SEMANTIC_DISPOSITION_REVIEW_LOAD_RECEIPT_INVALID');
  }
  return freezeDeep({ ...semantic, loadReceiptHash: receipt.loadReceiptHash });
}

function validateInvocation(
  request: SemanticDispositionReviewRequestV1,
  invocation: SemanticDispositionReviewerHostInvocationV1
): void {
  const calibration = request.calibration;
  for (const value of [invocation.evaluatorRunId, invocation.invocationId]) {
    requireText(value, 'SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_REQUIRED');
  }
  if (
    invocation.status !== 'success' ||
    invocation.toolCallCount !== 0 ||
    invocation.providerId !== calibration.providerId ||
    invocation.modelId !== calibration.modelId ||
    invocation.modelVersion !== calibration.modelVersion ||
    invocation.methodId !== calibration.methodId ||
    invocation.methodVersion !== calibration.methodVersion ||
    hashCanonicalJson(invocation.reviewerModelLoadReceipt) !==
      hashCanonicalJson(calibration.reviewerModelLoadReceipt)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_MISMATCH');
  }
  if (
    invocation.requestHash !== request.requestHash ||
    invocation.promptHash !== request.promptHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_REQUEST_MISMATCH');
  }
  requireSha256(invocation.responseOutputHash, 'SEMANTIC_DISPOSITION_REVIEW_OUTPUT_HASH_MISMATCH');
}

function validateResponseOutput(
  invocation: SemanticDispositionReviewerHostInvocationV1,
  decision: SemanticDispositionReviewDecisionV1
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(invocation.responseOutput);
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_INVALID');
  }
  if (
    !invocation.responseOutput.trim() ||
    hashBytes(Buffer.from(invocation.responseOutput)) !== invocation.responseOutputHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_HASH_MISMATCH');
  }
  if (hashCanonicalJson(parsed) !== hashCanonicalJson(decision)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_DECISION_MISMATCH');
  }
}

function normalizeDecision(
  request: SemanticDispositionReviewRequestV1,
  decision: SemanticDispositionReviewDecisionV1
): SemanticDispositionReviewDecisionV1 {
  if (decisionContextInvalid(request, decision)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_DECISION_CONTEXT_MISMATCH');
  }
  const expectedAxes = expectedAxisIds(request.reviewKind);
  const axisDecisions = decision.axisDecisions
    .map((axis) => ({
      ...axis,
      reasonCode: axis.reasonCode.trim(),
      evidenceEntryIds: normalizeStrings(axis.evidenceEntryIds),
    }))
    .sort((left, right) => left.axisId.localeCompare(right.axisId));
  const evidenceIds = request.evidence.map((row) => row.evidenceEntryId);
  const evidenceFindings = decision.evidenceFindings
    .map((finding) => ({
      ...finding,
      axisIds: normalizeStrings(finding.axisIds) as SemanticDispositionReviewAxisIdV1[],
      finding: finding.finding.trim(),
    }))
    .sort((left, right) => left.evidenceEntryId.localeCompare(right.evidenceEntryId));
  if (
    decisionAxesInvalid(axisDecisions, expectedAxes, evidenceIds) ||
    decisionFindingsInvalid(evidenceFindings, expectedAxes, evidenceIds) ||
    passingDecisionInsufficient(request, decision, axisDecisions, evidenceFindings)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_RESULT_SEMANTICS_REQUIRED');
  }
  return freezeDeep({
    ...decision,
    reasonCode: decision.reasonCode.trim(),
    axisDecisions,
    evidenceFindings,
  });
}

function decisionContextInvalid(
  request: SemanticDispositionReviewRequestV1,
  decision: SemanticDispositionReviewDecisionV1
): boolean {
  return (
    decision.schemaVersion !== 1 ||
    decision.requestHash !== request.requestHash ||
    decision.promptHash !== request.promptHash ||
    decision.contextHash !== request.contextHash ||
    decision.reviewKind !== request.reviewKind ||
    decision.proposedDispositionHash !== request.proposedDispositionHash ||
    !['pass', 'revise', 'reject'].includes(decision.verdict) ||
    !decision.reasonCode.trim()
  );
}

function decisionAxesInvalid(
  axes: readonly SemanticDispositionReviewAxisDecisionV1[],
  expectedAxes: readonly SemanticDispositionReviewAxisIdV1[],
  evidenceIds: readonly string[]
): boolean {
  return (
    !sameStrings(
      axes.map((axis) => axis.axisId),
      expectedAxes
    ) ||
    axes.some(
      (axis) =>
        !['pass', 'revise', 'reject'].includes(axis.verdict) ||
        !Number.isFinite(axis.score) ||
        axis.score < 0 ||
        axis.score > 1 ||
        !axis.reasonCode ||
        axis.evidenceEntryIds.length === 0 ||
        axis.evidenceEntryIds.some((id) => !evidenceIds.includes(id))
    )
  );
}

function decisionFindingsInvalid(
  findings: readonly SemanticDispositionReviewEvidenceFindingV1[],
  expectedAxes: readonly SemanticDispositionReviewAxisIdV1[],
  evidenceIds: readonly string[]
): boolean {
  return (
    !sameStrings(
      findings.map((finding) => finding.evidenceEntryId),
      evidenceIds
    ) ||
    findings.some(
      (finding) =>
        !finding.finding ||
        finding.axisIds.length === 0 ||
        finding.axisIds.some((axisId) => !expectedAxes.includes(axisId))
    )
  );
}

function passingDecisionInsufficient(
  request: SemanticDispositionReviewRequestV1,
  decision: SemanticDispositionReviewDecisionV1,
  axes: readonly SemanticDispositionReviewAxisDecisionV1[],
  findings: readonly SemanticDispositionReviewEvidenceFindingV1[]
): boolean {
  if (decision.verdict !== 'pass') {
    return false;
  }
  return (
    axes.some((axis) => {
      const calibration = request.calibration.axes.find(
        (candidate) => candidate.axisId === axis.axisId
      );
      return !calibration || axis.verdict !== 'pass' || axis.score < calibration.minimumScore;
    }) || findings.some((finding) => !finding.supportsVerdict)
  );
}

function expectedAxisIds(
  reviewKind: SemanticDispositionReviewKindV1
): readonly SemanticDispositionReviewAxisIdV1[] {
  return [
    ...(reviewKind === 'producer-non-draft' ? PRODUCER_AXES : INVESTIGATED_EMPTY_AXES),
  ].sort();
}

function normalizeStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean) as T[])].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizeStrings(left);
  const normalizedRight = normalizeStrings(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function requireText(value: string, code: string): void {
  if (!value?.trim()) {
    fail(code);
  }
}

function requireSha256(value: string, code: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(code);
  }
}

function fail(code: string): never {
  throw new Error(code);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
  }
  return value;
}

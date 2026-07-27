import { hashBytes, hashCanonicalJson } from '../project-context/foundation/canonical.js';
import {
  assertProductionActorIdentityV1,
  createProductionActorIdentityV1,
  type ProductionActorIdentityV1,
} from './ProductionActorIdentity.js';
import {
  assertStrictAdmissionReceiptV1,
  type StrictAdmissionReceiptV1,
} from './ProductionPersistenceContracts.js';
import {
  type AnalysisFixpointReceiptV1,
  createKnowledgeDispositionReviewV1,
  type FalsificationReceiptV1,
  type FinalExpandedMiningScheduleReceiptV1,
  hashKnowledgeDispositionProposalV1,
  type InductionReceiptV1,
  type KnowledgeDispositionExecutionBindingV1,
  type KnowledgeDispositionProposalV1,
  type KnowledgeDispositionReviewV1,
  type ObservationPopulationV1,
} from './StrictAnalysisContracts.js';
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
  readonly admissionReceipt: StrictAdmissionReceiptV1 | null;
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
 * 该构造器只能包装 Agent host adapter 返回的真实 invocation/result 坐标。
 * Main 不应再根据通用 reply 事后补盖 provider/model/run/load 身份。
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
 * Main 的唯一消费动作是重验 Agent execution 并生成绑定 executionHash 的 Core review。
 * reviewer identity 完全来自 execution；consumer 不接受可重新盖章的 reviewer 参数。
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
  if (!expression) {
    if (producerZeroTargetInvalid(context)) {
      fail('SEMANTIC_DISPOSITION_REVIEW_TARGET_MISMATCH');
    }
    return;
  }
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
  expression: NonNullable<ProducerNonDraftDispositionReviewContextV1['proposal']['expression']>
): void {
  const admission = context.admissionReceipt;
  if (!admission) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_REQUIRED');
  }
  assertStrictAdmissionReceiptV1(admission);
  const expectedDisposition =
    expression.terminalFate === 'reviewed-merge'
      ? 'merge'
      : expression.terminalFate === 'reviewed-duplicate'
        ? 'duplicate'
        : null;
  if (
    producerAdmissionLineageInvalid(input, context, expression, admission, expectedDisposition) ||
    producerAdmissionTargetInvalid(context, expression, admission)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_CONTEXT_MISMATCH');
  }
}

function producerAdmissionLineageInvalid(
  input: Parameters<typeof createAgentSemanticDispositionReviewRequestV1>[0],
  context: ProducerNonDraftDispositionReviewContextV1,
  expression: NonNullable<ProducerNonDraftDispositionReviewContextV1['proposal']['expression']>,
  admission: StrictAdmissionReceiptV1,
  expectedDisposition: StrictAdmissionReceiptV1['disposition'] | null
): boolean {
  return (
    !expectedDisposition ||
    admission.disposition !== expectedDisposition ||
    admission.runId !== input.strictWorkflowRunId ||
    admission.analysisFixpointHash !== input.currentAnalysisFixpointHash ||
    admission.privateCorpusRevision !== context.privateCorpusRevision ||
    admission.inputFingerprint !== expression.authoredFingerprint ||
    admission.finalAdmittedFingerprint !== expression.authoredFingerprint
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

function producerZeroTargetInvalid(context: ProducerNonDraftDispositionReviewContextV1): boolean {
  return (
    context.admissionReceipt !== null ||
    !context.proposal.zeroDisposition ||
    context.target.expressionId !== null ||
    context.target.authoredFingerprint !== null ||
    context.target.terminalFate !== 'reviewed-non-draft' ||
    context.target.targetRecipeId !== null ||
    context.target.targetFingerprint !== null ||
    context.target.targetReadyProofHash !== null
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

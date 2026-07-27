import type { MiningWorkScheduleV1 } from '../plan/intent/coldStartProductionPlan.js';
import { hashCanonicalJson } from '../project-context/foundation/canonical.js';
import {
  assertStrictAcceptedCorpusInspectionV1,
  assertStrictG1ReceiptV1,
  type CandidateAttemptBatchV1,
  canonicalizeCandidateAttemptBatchV1,
  createStrictAdmissionReceiptV1,
  createStrictG2ReceiptV1,
  type SerialAdmissionLedgerV1,
  type StrictAcceptedCorpusInspectionV1,
  type StrictAdmissionReceiptV1,
  type StrictG1ReceiptV1,
  type StrictG2ReceiptV1,
  validateSerialAdmissionLedgerV1,
} from './ProductionPersistenceContracts.js';
import {
  assertSemanticDispositionReviewExecutionV2,
  createProducerZeroDispositionAdmissionAuthorityV1,
  type SemanticDispositionReviewAgentHostExecutionAuthorityV2,
  type SemanticDispositionReviewExecutionV2,
} from './SemanticDispositionReviewExecution.js';
import {
  type AnalysisFixpointReceiptV1,
  type AnalysisScheduleExpansionReceiptV1,
  assertKnowledgeDispositionReviewV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisReviewContextHashV1,
  createFalsificationReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInductionReceiptV1,
  createInvestigatedEmptyDecisionV1,
  createKnowledgeClusterSemanticTransitionV1,
  createTypedGateReturnV1,
  type FalsificationReceiptV1,
  type FinalExpandedMiningScheduleReceiptV1,
  type HypothesisExpressionSetReceiptV1,
  hashKnowledgeClusterSetV1,
  hashKnowledgeClusterV1,
  hashKnowledgeDispositionProposalV1,
  type InductionReceiptV1,
  type InvestigatedEmptyDecisionV1,
  type KnowledgeClusterSemanticTransitionV1,
  type KnowledgeClusterSetV1,
  type KnowledgeDispositionReviewV1,
  type ObservationPopulationV1,
  type TypedGateReturnV1,
  validateFactRecordGraphV1,
  validateHypothesisExpressionSetLineageV1,
  validateHypothesisExpressionSetReceiptV1,
} from './StrictAnalysisContracts.js';
import {
  assertCodeFactGenerationManifestV1,
  assertFactQueryExecutionReceiptV1,
  assertMiningWorkScheduleV1,
  assertReviewAuthorizingFactExecutionV1,
  type StrictFactScheduleExecutionResultV1,
} from './StrictFactExecution.js';

export interface StrictProductionResourceConservationV1 {
  readonly candidateAttemptCap: number;
  readonly maxAuthoredCandidatesPerCellPass: number;
  readonly consumedCandidateAttempts: number;
  readonly remainingCandidateAttempts: number;
}

export interface StrictProductionAuthorityReceiptV1 {
  readonly schemaVersion: 1;
  readonly contractVersion: 'strict-production-authority-v1';
  readonly runId: string;
  readonly sourceRevisionVectorHash: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly factGenerationManifestHash: string;
  readonly factExecutionOutputHashes: readonly string[];
  readonly populationHashes: readonly string[];
  readonly clusterSetHashes: readonly string[];
  readonly clusterTransitionHashes: readonly string[];
  readonly inductionReceiptHashes: readonly string[];
  readonly falsificationReceiptHashes: readonly string[];
  readonly investigatedEmptyDecisionHashes: readonly string[];
  readonly dispositionReviewReceiptHashes: readonly string[];
  readonly semanticDispositionReviewExecutionHashes?: readonly string[];
  readonly expressionSetReceiptHashes: readonly string[];
  readonly candidateAttemptBatchHashes: readonly string[];
  readonly terminalEvidenceReceiptHashes: readonly string[];
  readonly serialAdmissionLedgerHash: string | null;
  readonly resourceConservation: StrictProductionResourceConservationV1;
  readonly authorityHash: string;
}

export interface StrictExpressionTerminalReturnReceiptV1 {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly hypothesisId: string;
  readonly expressionSetReceiptId: string;
  readonly expressionId: string;
  readonly authoredFingerprint: string;
  readonly terminalFate: 'repair-superseded' | 'failed' | 'unknown';
  readonly gateReturn: TypedGateReturnV1;
  readonly receiptHash: string;
}

export interface StrictG1TerminalBindingReceiptV1 {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly hypothesisId: string;
  readonly expressionSetReceiptId: string;
  readonly expressionId: string;
  readonly authoredFingerprint: string;
  readonly g1ReceiptHash: string;
  readonly receiptHash: string;
}

export function createStrictG1TerminalBindingReceiptV1(input: {
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly hypothesisId: string;
  readonly expressionSetReceiptId: string;
  readonly expressionId: string;
  readonly authoredFingerprint: string;
  readonly g1Receipt: StrictG1ReceiptV1;
}): StrictG1TerminalBindingReceiptV1 {
  assertStrictG1ReceiptV1(input.g1Receipt);
  for (const value of [
    input.runId,
    input.analysisFixpointHash,
    input.privateCorpusRevision,
    input.hypothesisId,
    input.expressionSetReceiptId,
    input.expressionId,
    input.authoredFingerprint,
  ]) {
    requireText(value, 'STRICT_G1_TERMINAL_BINDING_IDENTITY_REQUIRED');
  }
  if (
    input.g1Receipt.verdict !== 'fail' ||
    input.g1Receipt.candidateFingerprint !== input.authoredFingerprint
  ) {
    fail('STRICT_G1_TERMINAL_BINDING_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    hypothesisId: input.hypothesisId,
    expressionSetReceiptId: input.expressionSetReceiptId,
    expressionId: input.expressionId,
    authoredFingerprint: input.authoredFingerprint,
    g1ReceiptHash: input.g1Receipt.receiptHash,
  };
  const receiptHash = hashCanonicalJson(semantic);
  return Object.freeze({
    ...semantic,
    receiptId: `g1-terminal:${receiptHash.slice(7, 31)}`,
    receiptHash,
  });
}

export function createStrictExpressionTerminalReturnReceiptV1(input: {
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly hypothesisId: string;
  readonly expressionSetReceiptId: string;
  readonly expressionId: string;
  readonly authoredFingerprint: string;
  readonly terminalFate: StrictExpressionTerminalReturnReceiptV1['terminalFate'];
  readonly gateReturn: TypedGateReturnV1;
}): StrictExpressionTerminalReturnReceiptV1 {
  const rebuiltGateReturn = createTypedGateReturnV1({
    gate: input.gateReturn.gate,
    verdict: input.gateReturn.verdict,
    reasonCode: input.gateReturn.reasonCode,
    owner: input.gateReturn.owner,
    resumePoint: input.gateReturn.resumePoint,
    permittedMutation: input.gateReturn.permittedMutation,
    semanticRepairDepth: input.gateReturn.semanticRepairDepth,
  });
  const expectedVerdict =
    input.terminalFate === 'repair-superseded' ? 'revise' : input.terminalFate;
  if (
    hashCanonicalJson(rebuiltGateReturn) !== hashCanonicalJson(input.gateReturn) ||
    input.gateReturn.verdict !== expectedVerdict
  ) {
    fail('STRICT_EXPRESSION_TERMINAL_RETURN_INVALID');
  }
  for (const value of [
    input.runId,
    input.analysisFixpointHash,
    input.privateCorpusRevision,
    input.hypothesisId,
    input.expressionSetReceiptId,
    input.expressionId,
    input.authoredFingerprint,
  ]) {
    requireText(value, 'STRICT_EXPRESSION_TERMINAL_RETURN_IDENTITY_REQUIRED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    hypothesisId: input.hypothesisId,
    expressionSetReceiptId: input.expressionSetReceiptId,
    expressionId: input.expressionId,
    authoredFingerprint: input.authoredFingerprint,
    terminalFate: input.terminalFate,
    gateReturn: rebuiltGateReturn,
  };
  const receiptHash = hashCanonicalJson(semantic);
  return Object.freeze({
    ...semantic,
    receiptId: `expression-terminal:${receiptHash.slice(7, 31)}`,
    receiptHash,
  });
}

export interface StrictProductionAuthorityInputV1 {
  readonly runId: string;
  readonly sourceRevisionVectorHash: string;
  readonly analysisFixpoint: AnalysisFixpointReceiptV1;
  readonly privateCorpusRevision: string;
  readonly factExecution: StrictFactScheduleExecutionResultV1;
  /** baseline + expansion receipts + executed final schedule 共同关闭 schedule hash 自证路径。 */
  readonly baselineSchedule: MiningWorkScheduleV1;
  readonly scheduleExpansionReceipts: readonly AnalysisScheduleExpansionReceiptV1[];
  readonly finalExpandedSchedule: FinalExpandedMiningScheduleReceiptV1;
  readonly finalFactSchedule: MiningWorkScheduleV1;
  readonly populations: readonly ObservationPopulationV1[];
  /**
   * merge/split 的 before snapshot 只参与 transition 重放，不进入最终 fixpoint 与 induction。
   * 这样 unchanged cluster 可在 before/after 保持同一稳定 ID，而不会被误判为重复终态 cluster。
   */
  readonly historicalClusterSets?: readonly KnowledgeClusterSetV1[];
  readonly clusterSets: readonly KnowledgeClusterSetV1[];
  readonly clusterTransitions?: readonly KnowledgeClusterSemanticTransitionV1[];
  readonly inductions: readonly InductionReceiptV1[];
  readonly falsifications: readonly FalsificationReceiptV1[];
  readonly investigatedEmptyDecisions?: readonly InvestigatedEmptyDecisionV1[];
  readonly dispositionReviews: readonly KnowledgeDispositionReviewV1[];
  /**
   * Agent 产生、Main 只读消费的 evaluator execution registry。普通 analyst review 保持 V1
   * 兼容；producer-non-draft / investigated-empty 必须在这里 exact-one 连接。
   */
  readonly semanticDispositionReviewExecutions?: readonly SemanticDispositionReviewExecutionV2[];
  /** Agent live capability；普通 JSON execution 即使重算全部 hash，也不能由 Main 自行盖章。 */
  readonly semanticDispositionReviewHostAuthority?: SemanticDispositionReviewAgentHostExecutionAuthorityV2;
  /** 恢复时由宿主传入上一 checkpoint 已消费集合，防止 execution 跨 resume 重放。 */
  readonly priorSemanticDispositionReviewExecutionHashes?: readonly string[];
  readonly expressionSets: readonly HypothesisExpressionSetReceiptV1[];
  readonly candidateAttemptBatches: readonly CandidateAttemptBatchV1[];
  readonly serialAdmissionLedger: SerialAdmissionLedgerV1 | null;
  /**
   * authored expression 的 terminal fate 必须落到真实 typed receipt。G2 / Admission 还会向前
   * 重放完整的 G1→Admission→G2 链；未被 expression 或其链路消费的 receipt 会被拒绝。
   */
  readonly terminalEvidence: {
    readonly g1Receipts: readonly StrictG1ReceiptV1[];
    readonly g1TerminalBindings: readonly StrictG1TerminalBindingReceiptV1[];
    readonly corpusInspections: readonly StrictAcceptedCorpusInspectionV1[];
    readonly admissionReceipts: readonly StrictAdmissionReceiptV1[];
    readonly g2Receipts: readonly StrictG2ReceiptV1[];
    readonly gateReturns: readonly StrictExpressionTerminalReturnReceiptV1[];
  };
  readonly resourceCaps: {
    readonly candidateAttemptCap: number;
    readonly maxAuthoredCandidatesPerCellPass: number;
  };
}

/**
 * Agent→Main 的统一消费入口。它不产生第二套事实或 journal，只把现有 production primitives
 * 在同一 run/fixpoint/revision 坐标下重新验收并封成一个可跨进程持久化的 authority receipt。
 */
export function createStrictProductionAuthorityReceiptV1(
  input: StrictProductionAuthorityInputV1
): StrictProductionAuthorityReceiptV1 {
  requireText(input.runId, 'STRICT_PRODUCTION_RUN_REQUIRED');
  requireText(input.privateCorpusRevision, 'STRICT_PRODUCTION_REVISION_REQUIRED');
  requireSha256(input.sourceRevisionVectorHash, 'STRICT_PRODUCTION_SOURCE_REVISION_INVALID');

  validateScheduleLineage(input);
  const factIndex = validateFactExecution(input);
  const populationHashes = validatePopulations(input, factIndex);
  const reviewById = validateDispositionReviews(input, factIndex.receiptsByHash);
  const semanticDispositionReviewExecutionHashes = validateSemanticDispositionReviewExecutions(
    input,
    reviewById,
    factIndex.receiptsByHash
  );
  const clusterSetHashes = validateClusters(
    input,
    populationHashes,
    factIndex.factsById,
    reviewById
  );
  validateHistoricalClusters(input, populationHashes, factIndex.factsById, reviewById);
  const consumedReviewIds = new Set<string>();
  validateClusterDispositionReviews(input, reviewById, consumedReviewIds);
  validateClusterTransitions(input, reviewById, consumedReviewIds);
  validateAnalysisEvidence(input, reviewById, factIndex.receiptsByHash, consumedReviewIds);
  validateInvestigatedEmptyDecisions(
    input,
    reviewById,
    factIndex.receiptsByHash,
    consumedReviewIds
  );
  validateExpressionClosure(input, reviewById, consumedReviewIds);
  validateDispositionReviewConservation(reviewById, consumedReviewIds);
  validateFixpoint(input, populationHashes, clusterSetHashes);
  const { serialAdmissionLedgerHash, resourceConservation, terminalEvidenceReceiptHashes } =
    validateCandidateAndAdmissionConservation(input);

  const semantic = {
    schemaVersion: 1 as const,
    contractVersion: 'strict-production-authority-v1' as const,
    runId: input.runId,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    analysisFixpointHash: input.analysisFixpoint.fixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    factGenerationManifestHash: input.factExecution.manifest.manifestHash,
    factExecutionOutputHashes: input.factExecution.receipts
      .map((receipt) => receipt.outputHash)
      .sort(),
    populationHashes: [...populationHashes].sort(),
    clusterSetHashes: [...clusterSetHashes].sort(),
    clusterTransitionHashes: [...(input.clusterTransitions ?? [])]
      .map((transition) => transition.transitionHash)
      .sort(),
    inductionReceiptHashes: input.inductions.map((receipt) => receipt.receiptHash).sort(),
    falsificationReceiptHashes: input.falsifications.map((receipt) => receipt.receiptHash).sort(),
    investigatedEmptyDecisionHashes: [...(input.investigatedEmptyDecisions ?? [])]
      .map((decision) => decision.decisionHash)
      .sort(),
    dispositionReviewReceiptHashes: [...reviewById.values()]
      .map((review) => review.receiptHash)
      .sort(),
    ...(semanticDispositionReviewExecutionHashes.length > 0
      ? { semanticDispositionReviewExecutionHashes }
      : {}),
    expressionSetReceiptHashes: input.expressionSets.map((receipt) => receipt.receiptHash).sort(),
    candidateAttemptBatchHashes: input.candidateAttemptBatches
      .map((batch) => batch.batchHash)
      .sort(),
    terminalEvidenceReceiptHashes,
    serialAdmissionLedgerHash,
    resourceConservation,
  };
  return Object.freeze({ ...semantic, authorityHash: hashCanonicalJson(semantic) });
}

function validateScheduleLineage(input: StrictProductionAuthorityInputV1): void {
  assertMiningWorkScheduleV1(input.baselineSchedule);
  assertMiningWorkScheduleV1(input.finalFactSchedule);
  const rebuilt = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: input.baselineSchedule.baselineScheduleHash,
    baselineObligationIds: input.baselineSchedule.factHarvestObligations.map(
      (row) => row.obligationId
    ),
    expansionReceipts: input.scheduleExpansionReceipts,
  });
  const baselineById = new Map(
    input.baselineSchedule.factHarvestObligations.map((row) => [row.obligationId, row])
  );
  const expansionById = new Map(
    input.scheduleExpansionReceipts.flatMap((receipt) =>
      receipt.rows.map((row) => [row.obligationId, row] as const)
    )
  );
  const finalObligationIds = input.finalFactSchedule.factHarvestObligations.map(
    (row) => row.obligationId
  );
  const scheduleRowsMismatch = input.finalFactSchedule.factHarvestObligations.some((row) => {
    const baseline = baselineById.get(row.obligationId);
    if (baseline) {
      return hashCanonicalJson(baseline) !== hashCanonicalJson(row);
    }
    const expansion = expansionById.get(row.obligationId);
    return (
      !expansion ||
      row.factFamilyId !== expansion.factFamilyId ||
      row.capabilityId !== expansion.capabilityId ||
      row.canonicalSubjectRef !== expansion.canonicalSubjectRef ||
      row.analysisScale !== expansion.analysisScale ||
      row.denominator !== 'complete-frozen-subject' ||
      row.source !== 'accepted-plan-addition'
    );
  });
  if (
    hashCanonicalJson(rebuilt) !== hashCanonicalJson(input.finalExpandedSchedule) ||
    input.finalExpandedSchedule.finalExpandedScheduleHash !==
      input.analysisFixpoint.finalExpandedScheduleHash ||
    !sameStrings(input.finalExpandedSchedule.obligationIds, finalObligationIds) ||
    input.finalExpandedSchedule.obligationIds.length !== finalObligationIds.length ||
    input.finalFactSchedule.factHarvestScheduleHash !==
      input.factExecution.manifest.factHarvestScheduleHash ||
    input.finalFactSchedule.lensBindingsHash !== input.baselineSchedule.lensBindingsHash ||
    hashCanonicalJson(input.finalFactSchedule.lensBindings) !==
      hashCanonicalJson(input.baselineSchedule.lensBindings) ||
    scheduleRowsMismatch
  ) {
    fail('STRICT_PRODUCTION_SCHEDULE_LINEAGE_MISMATCH');
  }
}

function validateFactExecution(input: StrictProductionAuthorityInputV1): {
  receiptsById: Map<string, StrictFactScheduleExecutionResultV1['receipts'][number]>;
  receiptsByHash: Map<string, StrictFactScheduleExecutionResultV1['receipts'][number]>;
  factsById: Set<string>;
} {
  assertCodeFactGenerationManifestV1(input.factExecution);
  validateFactRecordGraphV1(input.factExecution.facts);
  for (const receipt of input.factExecution.receipts) {
    assertFactQueryExecutionReceiptV1(receipt);
  }
  const scheduleByObligationId = new Map(
    input.finalFactSchedule.factHarvestObligations.map((row) => [row.obligationId, row])
  );
  const receiptObligationIds = input.factExecution.receipts.map((receipt) => receipt.obligationId);
  if (
    input.factExecution.receipts.length !== scheduleByObligationId.size ||
    input.factExecution.manifest.obligationCount !== scheduleByObligationId.size ||
    new Set(receiptObligationIds).size !== receiptObligationIds.length ||
    !sameStrings(receiptObligationIds, [...scheduleByObligationId.keys()]) ||
    input.factExecution.receipts.some((receipt) => {
      const scheduled = scheduleByObligationId.get(receipt.obligationId);
      return (
        !scheduled ||
        receipt.factFamilyId !== scheduled.factFamilyId ||
        receipt.capabilityId !== scheduled.capabilityId ||
        receipt.canonicalSubjectRef !== scheduled.canonicalSubjectRef ||
        receipt.analysisScale !== scheduled.analysisScale ||
        receipt.denominator !== scheduled.denominator
      );
    }) ||
    input.factExecution.facts.some(
      (fact) =>
        fact.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
        (fact.kind === 'direct' &&
          fact.witnesses.some(
            (witness) =>
              witness.kind !== 'direct' ||
              witness.projectContextRefId !== fact.canonicalSubjectRef ||
              witness.sourceRevisionVectorHash !== input.sourceRevisionVectorHash
          ))
    ) ||
    input.factExecution.receipts.some(
      (receipt) => receipt.sourceRevisionVectorHash !== input.sourceRevisionVectorHash
    )
  ) {
    fail('STRICT_PRODUCTION_FACT_LINEAGE_MISMATCH');
  }
  const receiptsById = new Map(
    input.factExecution.receipts.map((receipt) => [receipt.obligationId, receipt])
  );
  const receiptsByHash = new Map(
    input.factExecution.receipts.map((receipt) => [receipt.receiptHash, receipt])
  );
  const factsById = new Set(input.factExecution.facts.map((fact) => fact.factId));
  return { receiptsById, receiptsByHash, factsById };
}

function validatePopulations(
  input: StrictProductionAuthorityInputV1,
  factIndex: ReturnType<typeof validateFactExecution>
): Set<string> {
  const populationHashes = new Set<string>();
  const populationObligationIds = new Set<string>();
  for (const population of input.populations) {
    validatePopulationIdentity(input, population, factIndex);
    for (const obligationId of population.denominator.expectedObligationIds) {
      validatePopulationObligation(population, obligationId, factIndex.receiptsById);
      populationObligationIds.add(obligationId);
    }
    validatePopulationFacts(population, factIndex);
    populationHashes.add(population.populationHash);
  }
  if (
    populationHashes.size === 0 ||
    [...factIndex.receiptsById.keys()].some(
      (obligationId) => !populationObligationIds.has(obligationId)
    )
  ) {
    fail('STRICT_PRODUCTION_POPULATION_SCHEDULE_INCOMPLETE');
  }
  return populationHashes;
}

function validatePopulationIdentity(
  input: StrictProductionAuthorityInputV1,
  population: ObservationPopulationV1,
  factIndex: ReturnType<typeof validateFactExecution>
): void {
  const {
    schemaVersion: _schemaVersion,
    populationHash: _populationHash,
    completion: _completion,
    conservation: _conservation,
    ...populationInput
  } = population;
  const enrolledReceipts = population.denominator.expectedObligationIds
    .map((obligationId) => factIndex.receiptsById.get(obligationId))
    .filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt));
  const rebuilt = canonicalizeObservationPopulationV1({
    ...populationInput,
    executionReceipts: enrolledReceipts,
  });
  if (rebuilt.populationHash !== population.populationHash) {
    fail('STRICT_PRODUCTION_POPULATION_HASH_MISMATCH');
  }
  if (
    rebuilt.completion !== population.completion ||
    population.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    population.completion !== 'complete'
  ) {
    fail('STRICT_PRODUCTION_POPULATION_INCOMPLETE');
  }
}

function validatePopulationObligation(
  population: ObservationPopulationV1,
  obligationId: string,
  receiptsById: ReturnType<typeof validateFactExecution>['receiptsById']
): void {
  const receipt = receiptsById.get(obligationId);
  if (
    !receipt ||
    !population.denominator.executionReceiptHashes.includes(receipt.receiptHash) ||
    !population.denominator.outputHashes.includes(receipt.outputHash) ||
    !population.denominator.denominatorHashes.includes(receipt.denominatorHash)
  ) {
    fail('STRICT_PRODUCTION_POPULATION_EXECUTION_MISMATCH');
  }
}

function validatePopulationFacts(
  population: ObservationPopulationV1,
  factIndex: ReturnType<typeof validateFactExecution>
): void {
  const unknownFact = population.observations.some((observation) =>
    observation.factIds.some((factId) => !factIndex.factsById.has(factId))
  );
  const mismatchedNoPattern = population.inspectedNoPatternObservations.some((row) => {
    const receipt = factIndex.receiptsById.get(row.obligationId);
    return (
      !receipt ||
      receipt.disposition !== 'inspected-no-pattern' ||
      receipt.receiptHash !== row.executionReceiptHash ||
      receipt.outputHash !== row.outputHash ||
      receipt.denominatorHash !== row.denominatorHash
    );
  });
  if (unknownFact || mismatchedNoPattern) {
    fail('STRICT_PRODUCTION_POPULATION_FACT_MISMATCH');
  }
}

function validateClusters(
  input: StrictProductionAuthorityInputV1,
  populationHashes: ReadonlySet<string>,
  factsById: ReadonlySet<string>,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): Set<string> {
  const clusterSetHashes = new Set<string>();
  const populationsByHash = new Map(
    input.populations.map((population) => [population.populationHash, population])
  );
  for (const clusterSet of input.clusterSets) {
    const population = populationsByHash.get(clusterSet.populationHash);
    const rebuilt =
      population &&
      canonicalizeKnowledgeClustersV1(population, {
        clusters: clusterSet.clusters.map((cluster) => ({
          mechanismKey: cluster.mechanismKey,
          mechanism: cluster.mechanism,
          observationIds: cluster.observationIds,
          mechanismEvidenceFactIds: cluster.mechanismEvidenceFactIds,
          anatomyLensIds: cluster.anatomyLensIds,
        })),
        nonClusteredDispositions: clusterSet.dispositions.flatMap((disposition) => {
          if (disposition.status === 'clustered') {
            return [];
          }
          return [
            {
              observationId: disposition.observationId,
              status: disposition.status,
              reasonCode: disposition.reasonCode ?? '',
              ...(disposition.status === 'discarded'
                ? {
                    dispositionReview: disposition.reviewerReceiptId
                      ? reviewById.get(disposition.reviewerReceiptId)
                      : undefined,
                  }
                : {
                    owner: disposition.owner ?? undefined,
                    resumePoint: disposition.resumePoint ?? undefined,
                  }),
            },
          ];
        }),
      });
    if (clusterSet.clusterSetHash !== hashKnowledgeClusterSetV1(clusterSet)) {
      fail('STRICT_PRODUCTION_CLUSTER_HASH_MISMATCH');
    }
    if (
      !population ||
      !rebuilt ||
      JSON.stringify(rebuilt) !== JSON.stringify(clusterSet) ||
      !populationHashes.has(clusterSet.populationHash) ||
      clusterSet.clusters.some(
        (cluster) =>
          cluster.populationHash !== clusterSet.populationHash ||
          cluster.memberFactIds.some((factId) => !factsById.has(factId))
      )
    ) {
      fail('STRICT_PRODUCTION_CLUSTER_LINEAGE_MISMATCH');
    }
    clusterSetHashes.add(clusterSet.clusterSetHash);
  }
  return clusterSetHashes;
}

function validateHistoricalClusters(
  input: StrictProductionAuthorityInputV1,
  populationHashes: ReadonlySet<string>,
  factsById: ReadonlySet<string>,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): void {
  const finalHashes = new Set(input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash));
  const populationsByHash = new Map(
    input.populations.map((population) => [population.populationHash, population])
  );
  const historicalHashes = new Set<string>();
  for (const clusterSet of input.historicalClusterSets ?? []) {
    const population = populationsByHash.get(clusterSet.populationHash);
    const rebuilt =
      population &&
      canonicalizeKnowledgeClustersV1(population, {
        clusters: clusterSet.clusters.map((cluster) => ({
          mechanismKey: cluster.mechanismKey,
          mechanism: cluster.mechanism,
          observationIds: cluster.observationIds,
          mechanismEvidenceFactIds: cluster.mechanismEvidenceFactIds,
          anatomyLensIds: cluster.anatomyLensIds,
        })),
        nonClusteredDispositions: clusterSet.dispositions.flatMap((disposition) => {
          if (disposition.status === 'clustered') {
            return [];
          }
          return [
            {
              observationId: disposition.observationId,
              status: disposition.status,
              reasonCode: disposition.reasonCode ?? '',
              ...(disposition.status === 'discarded'
                ? {
                    dispositionReview: disposition.reviewerReceiptId
                      ? reviewById.get(disposition.reviewerReceiptId)
                      : undefined,
                  }
                : {
                    owner: disposition.owner ?? undefined,
                    resumePoint: disposition.resumePoint ?? undefined,
                  }),
            },
          ];
        }),
      });
    if (
      !population ||
      !rebuilt ||
      JSON.stringify(rebuilt) !== JSON.stringify(clusterSet) ||
      !populationHashes.has(clusterSet.populationHash) ||
      finalHashes.has(clusterSet.clusterSetHash) ||
      historicalHashes.has(clusterSet.clusterSetHash) ||
      clusterSet.clusters.some(
        (cluster) =>
          cluster.populationHash !== clusterSet.populationHash ||
          cluster.memberFactIds.some((factId) => !factsById.has(factId))
      )
    ) {
      fail('STRICT_PRODUCTION_HISTORICAL_CLUSTER_LINEAGE_MISMATCH');
    }
    historicalHashes.add(clusterSet.clusterSetHash);
  }
}

function validateDispositionReviews(
  input: StrictProductionAuthorityInputV1,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): Map<string, KnowledgeDispositionReviewV1> {
  const reviewById = new Map<string, KnowledgeDispositionReviewV1>();
  const terminalObligations = new Map(
    input.analysisFixpoint.terminalObligations.map((obligation) => [
      obligation.obligationId,
      obligation,
    ])
  );
  for (const review of input.dispositionReviews) {
    assertKnowledgeDispositionReviewV1(review);
    const expectedReviewContextHash =
      review.reviewKind === 'producer-non-draft' || review.reviewKind === 'investigated-empty'
        ? input.analysisFixpoint.fixpointHash
        : input.analysisFixpoint.analysisReviewContextHash;
    const executionReceipts = review.executionBindings.map((binding) =>
      receiptsByHash.get(binding.executionReceiptHash)
    );
    if (
      dispositionReviewLineageInvalid(
        input,
        review,
        expectedReviewContextHash,
        executionReceipts,
        terminalObligations,
        reviewById
      )
    ) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_LINEAGE_MISMATCH');
    }
    if (review.verdict === 'pass') {
      for (const receipt of executionReceipts) {
        if (!receipt) {
          fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_LINEAGE_MISMATCH');
        }
        assertReviewAuthorizingFactExecutionV1(receipt);
      }
    }
    reviewById.set(review.reviewReceiptId, review);
  }
  return reviewById;
}

function dispositionReviewLineageInvalid(
  input: StrictProductionAuthorityInputV1,
  review: KnowledgeDispositionReviewV1,
  expectedReviewContextHash: string,
  executionReceipts: readonly (
    | StrictFactScheduleExecutionResultV1['receipts'][number]
    | undefined
  )[],
  terminalObligations: ReadonlyMap<
    string,
    AnalysisFixpointReceiptV1['terminalObligations'][number]
  >,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): boolean {
  return (
    review.currentAnalysisFixpointHash !== expectedReviewContextHash ||
    review.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    review.executionScope.finalExpandedScheduleHash !==
      input.analysisFixpoint.finalExpandedScheduleHash ||
    JSON.stringify(review.executionScope.terminalObligations) !==
      JSON.stringify(input.analysisFixpoint.terminalObligations) ||
    review.producer.runId !== input.runId ||
    (review.semanticExecutionResultHash
      ? review.reviewer.runId === input.runId
      : review.reviewer.runId !== input.runId) ||
    executionReceipts.some((receipt) => !receipt) ||
    executionReceipts.some((receipt) =>
      executionReceiptTerminalMismatch(receipt, terminalObligations)
    ) ||
    review.executionBindings.some((binding, index) =>
      executionBindingReceiptMismatch(binding, executionReceipts[index])
    ) ||
    reviewById.has(review.reviewReceiptId)
  );
}

function validateSemanticDispositionReviewExecutions(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): readonly string[] {
  const executions = [...(input.semanticDispositionReviewExecutions ?? [])];
  const priorHashes = new Set(input.priorSemanticDispositionReviewExecutionHashes ?? []);
  const byHash = new Map<string, SemanticDispositionReviewExecutionV2>();
  const executionIds = new Set<string>();
  const invocationCoordinates = new Set<string>();
  const outputHashes = new Set<string>();
  const decisionHashes = new Set<string>();
  for (const execution of executions) {
    if (!input.semanticDispositionReviewHostAuthority) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
    }
    assertSemanticDispositionReviewExecutionV2({
      execution,
      hostAuthority: input.semanticDispositionReviewHostAuthority,
    });
    const invocationCoordinate = `${execution.hostExecution.evaluatorRunId}\u0000${execution.hostExecution.invocationId}`;
    if (
      priorHashes.has(execution.executionHash) ||
      byHash.has(execution.executionHash) ||
      executionIds.has(execution.executionId) ||
      invocationCoordinates.has(invocationCoordinate) ||
      outputHashes.has(execution.hostExecution.responseOutputHash) ||
      decisionHashes.has(execution.decisionHash)
    ) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_REUSED');
    }
    byHash.set(execution.executionHash, execution);
    executionIds.add(execution.executionId);
    invocationCoordinates.add(invocationCoordinate);
    outputHashes.add(execution.hostExecution.responseOutputHash);
    decisionHashes.add(execution.decisionHash);
  }

  const consumed = new Set<string>();
  for (const review of reviewById.values()) {
    const requiresSemanticExecution =
      review.reviewKind === 'producer-non-draft' || review.reviewKind === 'investigated-empty';
    if (!requiresSemanticExecution) {
      if (review.semanticExecutionResultHash) {
        fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_UNEXPECTED');
      }
      continue;
    }
    const execution = review.semanticExecutionResultHash
      ? byHash.get(review.semanticExecutionResultHash)
      : undefined;
    if (
      !execution ||
      consumed.has(execution.executionHash) ||
      semanticDispositionReviewExecutionMismatch(input, review, execution, receiptsByHash)
    ) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_MISMATCH');
    }
    consumed.add(execution.executionHash);
  }
  if (
    consumed.size !== byHash.size ||
    [...byHash.keys()].some((executionHash) => !consumed.has(executionHash))
  ) {
    fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_ORPHANED');
  }
  return [...consumed].sort();
}

function semanticDispositionReviewExecutionMismatch(
  input: StrictProductionAuthorityInputV1,
  review: KnowledgeDispositionReviewV1,
  execution: SemanticDispositionReviewExecutionV2,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): boolean {
  const request = execution.request.semanticRequest;
  const actualPopulation = input.populations.find(
    (population) => population.populationHash === request.populationHash
  );
  const contextPopulation = request.context.population;
  const requestReceiptHashes = request.executionReceipts.map((receipt) => receipt.receiptHash);
  const actualRequestReceipts = requestReceiptHashes.map((receiptHash) =>
    receiptsByHash.get(receiptHash)
  );
  return (
    request.strictWorkflowRunId !== input.runId ||
    request.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    request.currentAnalysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
    request.reviewKind !== review.reviewKind ||
    request.populationHash !== review.populationHash ||
    request.proposedDispositionHash !== review.proposedDispositionHash ||
    semanticDispositionReviewScheduleMismatch(input, request) ||
    hashCanonicalJson(request.context.analysisFixpoint) !==
      hashCanonicalJson(input.analysisFixpoint) ||
    !actualPopulation ||
    hashCanonicalJson(contextPopulation) !== hashCanonicalJson(actualPopulation) ||
    actualRequestReceipts.some((receipt) => !receipt) ||
    actualRequestReceipts.some(
      (receipt, index) =>
        hashCanonicalJson(receipt) !== hashCanonicalJson(request.executionReceipts[index])
    ) ||
    !sameStrings(requestReceiptHashes, review.executionReceiptHashes) ||
    request.producer.actorHash !== review.producer.actorHash ||
    execution.reviewer.actorHash !== review.reviewer.actorHash ||
    request.calibration.calibrationReceiptHash !== review.calibrationReceiptHash ||
    execution.decision.verdict !== review.verdict ||
    execution.decision.reasonCode !== review.reasonCode ||
    execution.executionHash !== review.semanticExecutionResultHash ||
    semanticDispositionReviewContextMissing(input, execution)
  );
}

function semanticDispositionReviewScheduleMismatch(
  input: StrictProductionAuthorityInputV1,
  request: SemanticDispositionReviewExecutionV2['request']['semanticRequest']
): boolean {
  return (
    request.finalExpandedSchedule.finalExpandedScheduleHash !==
      input.finalExpandedSchedule.finalExpandedScheduleHash ||
    hashCanonicalJson(request.finalExpandedSchedule) !==
      hashCanonicalJson(input.finalExpandedSchedule)
  );
}

function semanticDispositionReviewContextMissing(
  input: StrictProductionAuthorityInputV1,
  execution: SemanticDispositionReviewExecutionV2
): boolean {
  const context = execution.request.semanticRequest.context;
  if (context.reviewKind === 'investigated-empty') {
    return false;
  }
  const induction = input.inductions.find(
    (candidate) =>
      candidate.hypotheses.some(
        (hypothesis) => hypothesis.hypothesisId === context.proposal.hypothesisId
      ) && candidate.populationHash === context.population.populationHash
  );
  const falsification = input.falsifications.find(
    (candidate) => candidate.hypothesisId === context.proposal.hypothesisId
  );
  const admission = context.admissionReceipt
    ? input.terminalEvidence.admissionReceipts.find(
        (candidate) => candidate.receiptHash === context.admissionReceipt?.receiptHash
      )
    : null;
  const g1 = input.terminalEvidence.g1Receipts.find(
    (candidate) => candidate.receiptHash === context.g1Receipt.receiptHash
  );
  return (
    context.privateCorpusRevision !== input.privateCorpusRevision ||
    semanticDispositionExpressionSetMissing(input, execution) ||
    !induction ||
    hashCanonicalJson(induction) !== hashCanonicalJson(context.induction) ||
    !falsification ||
    hashCanonicalJson(falsification) !== hashCanonicalJson(context.falsification) ||
    !g1 ||
    hashCanonicalJson(g1) !== hashCanonicalJson(context.g1Receipt) ||
    !admission ||
    hashCanonicalJson(admission) !== hashCanonicalJson(context.admissionReceipt)
  );
}

function semanticDispositionExpressionSetMissing(
  input: StrictProductionAuthorityInputV1,
  execution: SemanticDispositionReviewExecutionV2
): boolean {
  const context = execution.request.semanticRequest.context;
  if (context.reviewKind !== 'producer-non-draft') {
    return false;
  }
  const expressionSet = input.expressionSets.find(
    (candidate) => candidate.receiptId === context.expressionSetReceiptId
  );
  if (
    !expressionSet ||
    expressionSet.hypothesisId !== context.proposal.hypothesisId ||
    expressionSet.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
    expressionSet.privateCorpusRevision !== context.privateCorpusRevision
  ) {
    return true;
  }
  const proposalExpression = context.proposal.expression;
  if (!proposalExpression) {
    return (
      !context.proposal.zeroDisposition ||
      expressionSet.expressions.length !== 0 ||
      expressionSet.zeroDisposition?.reasonCode !== context.proposal.zeroDisposition.reasonCode ||
      expressionSet.zeroDisposition?.terminalFate !==
        context.proposal.zeroDisposition.terminalFate ||
      expressionSet.zeroDisposition?.dispositionReview.semanticExecutionResultHash !==
        execution.executionHash
    );
  }
  const expression = expressionSet.expressions.find(
    (candidate) => candidate.expressionId === proposalExpression.expressionId
  );
  return (
    !expression ||
    expression.authoredFingerprint !== proposalExpression.authoredFingerprint ||
    expression.terminalFate !== proposalExpression.terminalFate ||
    (expression.matchingRepresentativeId ?? null) !== proposalExpression.matchingRepresentativeId ||
    (expression.matchingContentReadyRecipeId ?? null) !==
      proposalExpression.matchingContentReadyRecipeId ||
    expression.dispositionReview?.semanticExecutionResultHash !== execution.executionHash
  );
}

function executionReceiptTerminalMismatch(
  receipt: StrictFactScheduleExecutionResultV1['receipts'][number] | undefined,
  terminalObligations: ReadonlyMap<string, AnalysisFixpointReceiptV1['terminalObligations'][number]>
): boolean {
  if (!receipt) {
    return true;
  }
  const terminal = terminalObligations.get(receipt.obligationId);
  return (
    !terminal ||
    terminal.terminalReceiptId !== receipt.terminalReceiptId ||
    terminal.disposition !== receipt.disposition
  );
}

function executionBindingReceiptMismatch(
  binding: KnowledgeDispositionReviewV1['executionBindings'][number],
  receipt: StrictFactScheduleExecutionResultV1['receipts'][number] | undefined
): boolean {
  return (
    !receipt ||
    binding.obligationId !== receipt.obligationId ||
    binding.executionReceiptHash !== receipt.receiptHash ||
    binding.executionOutputHash !== receipt.outputHash ||
    binding.denominatorHash !== receipt.denominatorHash
  );
}

function validateClusterDispositionReviews(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  const populationsByHash = new Map(
    input.populations.map((population) => [population.populationHash, population])
  );
  for (const clusterSet of input.clusterSets) {
    const observationsById = new Map(
      populationsByHash
        .get(clusterSet.populationHash)
        ?.observations.map((observation) => [observation.observationId, observation]) ?? []
    );
    for (const disposition of clusterSet.dispositions) {
      const review = disposition.reviewerReceiptId
        ? reviewById.get(disposition.reviewerReceiptId)
        : undefined;
      if (
        disposition.status === 'discarded' &&
        (!review ||
          review.reviewKind !== 'cluster-discard' ||
          review.populationHash !== clusterSet.populationHash ||
          !sameStrings(
            review.obligationIds,
            observationsById.get(disposition.observationId)?.obligationIds ?? []
          ) ||
          review.proposedDispositionHash !==
            hashKnowledgeDispositionProposalV1({
              reviewKind: 'cluster-discard',
              populationHash: clusterSet.populationHash,
              observationId: disposition.observationId,
              status: 'discarded',
              reasonCode: disposition.reasonCode ?? '',
            }))
      ) {
        fail('STRICT_PRODUCTION_CLUSTER_DISPOSITION_REVIEW_MISMATCH');
      }
      if (review) {
        consumeDispositionReview(review, 'cluster-discard', consumedReviewIds);
      }
    }
  }
}

function validateClusterTransitions(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  const clusterSetsByHash = new Map(
    [...(input.historicalClusterSets ?? []), ...input.clusterSets].map((clusterSet) => [
      clusterSet.clusterSetHash,
      clusterSet,
    ])
  );
  const historicalHashes = new Set(
    (input.historicalClusterSets ?? []).map((clusterSet) => clusterSet.clusterSetHash)
  );
  const finalHashes = new Set(input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash));
  const transitionKeys = new Set<string>();
  const consumedHistoricalHashes = new Set<string>();
  for (const transition of input.clusterTransitions ?? []) {
    assertCanonicalHash(
      transition,
      'transitionHash',
      'STRICT_PRODUCTION_CLUSTER_TRANSITION_HASH_MISMATCH'
    );
    const review = reviewById.get(transition.dispositionReviewReceiptId);
    const sourceClusterSet = clusterSetsByHash.get(transition.sourceClusterSetHash);
    const targetClusterSet = clusterSetsByHash.get(transition.targetClusterSetHash);
    const transitionKey = `${transition.reviewKind}\u0000${transition.sourceClusterSetHash}\u0000${transition.targetClusterSetHash}\u0000${transition.sourceClusterIds.join('\u0001')}\u0000${transition.targetClusterIds.join('\u0001')}`;
    const rebuilt =
      review &&
      sourceClusterSet &&
      targetClusterSet &&
      createKnowledgeClusterSemanticTransitionV1({
        reviewKind: transition.reviewKind,
        sourceClusterSet,
        targetClusterSet,
        sourceClusterIds: transition.sourceClusterIds,
        targetClusterIds: transition.targetClusterIds,
        reasonCode: transition.reasonCode,
        dispositionReview: review,
      });
    if (
      !review ||
      !rebuilt ||
      !historicalHashes.has(transition.sourceClusterSetHash) ||
      !finalHashes.has(transition.targetClusterSetHash) ||
      transitionKeys.has(transitionKey) ||
      rebuilt.transitionHash !== transition.transitionHash ||
      review.proposedDispositionHash !==
        hashKnowledgeDispositionProposalV1({
          reviewKind: transition.reviewKind,
          populationHash: transition.populationHash,
          sourceClusterSetHash: transition.sourceClusterSetHash,
          targetClusterSetHash: transition.targetClusterSetHash,
          sourceClusterIds: transition.sourceClusterIds,
          targetClusterIds: transition.targetClusterIds,
          observationIds: transition.observationIds,
          reasonCode: transition.reasonCode,
        })
    ) {
      fail('STRICT_PRODUCTION_CLUSTER_TRANSITION_LINEAGE_MISMATCH');
    }
    transitionKeys.add(transitionKey);
    consumedHistoricalHashes.add(transition.sourceClusterSetHash);
    consumeDispositionReview(review, transition.reviewKind, consumedReviewIds);
  }
  if (
    historicalHashes.size !== consumedHistoricalHashes.size ||
    [...historicalHashes].some((hash) => !consumedHistoricalHashes.has(hash))
  ) {
    fail('STRICT_PRODUCTION_HISTORICAL_CLUSTER_ORPHANED');
  }
}

function validateAnalysisEvidence(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash'],
  consumedReviewIds: Set<string>
): void {
  const hypothesesById = validateInductionEvidence(input, reviewById, consumedReviewIds);
  validateFalsificationEvidence(
    input,
    reviewById,
    receiptsByHash,
    consumedReviewIds,
    hypothesesById
  );
}

interface HypothesisInductionBinding {
  readonly induction: InductionReceiptV1;
  readonly premiseFactIds: readonly string[];
  readonly sourceObligationIds: readonly string[];
}

function validateInductionEvidence(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): Map<string, HypothesisInductionBinding> {
  const clustersById = collectInductionClusters(input);
  const populationHashes = new Set(
    input.populations.map((population) => population.populationHash)
  );
  const inducedClusterIds = new Set<string>();
  const hypothesesById = new Map<string, HypothesisInductionBinding>();
  for (const induction of input.inductions) {
    const cluster = validateInductionAuthority(
      input,
      induction,
      clustersById,
      populationHashes,
      inducedClusterIds,
      reviewById
    );
    inducedClusterIds.add(induction.clusterId);
    registerInductionHypotheses(induction, cluster, hypothesesById);
    consumeZeroHypothesisReview(induction, cluster, reviewById, consumedReviewIds);
  }
  if (inductionClustersNotConserved(clustersById, inducedClusterIds)) {
    fail('STRICT_PRODUCTION_CLUSTER_INDUCTION_CONSERVATION_FAILED');
  }
  return hypothesesById;
}

function collectInductionClusters(
  input: StrictProductionAuthorityInputV1
): Map<string, KnowledgeClusterSetV1['clusters'][number]> {
  const clustersById = new Map<string, KnowledgeClusterSetV1['clusters'][number]>();
  for (const clusterSet of input.clusterSets) {
    for (const cluster of clusterSet.clusters) {
      if (clustersById.has(cluster.clusterId)) {
        fail('STRICT_PRODUCTION_CLUSTER_INDUCTION_CONSERVATION_FAILED');
      }
      clustersById.set(cluster.clusterId, cluster);
    }
  }
  return clustersById;
}

function validateInductionAuthority(
  input: StrictProductionAuthorityInputV1,
  induction: InductionReceiptV1,
  clustersById: ReadonlyMap<string, KnowledgeClusterSetV1['clusters'][number]>,
  populationHashes: ReadonlySet<string>,
  inducedClusterIds: ReadonlySet<string>,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): KnowledgeClusterSetV1['clusters'][number] {
  assertCanonicalHash(induction, 'receiptHash', 'STRICT_PRODUCTION_INDUCTION_HASH_MISMATCH');
  const cluster = clustersById.get(induction.clusterId);
  const zeroReview = induction.zeroHypothesisReviewReceiptId
    ? reviewById.get(induction.zeroHypothesisReviewReceiptId)
    : undefined;
  const rebuiltInduction =
    cluster &&
    createInductionReceiptV1({
      populationHash: induction.populationHash,
      clusterHash: induction.clusterHash,
      clusterId: induction.clusterId,
      observationIds: induction.observationIds,
      mode: induction.mode,
      hypotheses: induction.hypotheses,
      currentAnalysisFixpointHash: induction.currentAnalysisFixpointHash,
      zeroHypothesisReason: induction.zeroHypothesisReason,
      zeroHypothesisDispositionReview: zeroReview,
    });
  if (
    inductionAuthorityInvalid(
      input,
      induction,
      cluster,
      rebuiltInduction,
      populationHashes,
      inducedClusterIds,
      zeroReview
    )
  ) {
    fail('STRICT_PRODUCTION_INDUCTION_LINEAGE_MISMATCH');
  }
  return cluster;
}

function inductionAuthorityInvalid(
  input: StrictProductionAuthorityInputV1,
  induction: InductionReceiptV1,
  cluster: KnowledgeClusterSetV1['clusters'][number] | undefined,
  rebuiltInduction: InductionReceiptV1 | undefined,
  populationHashes: ReadonlySet<string>,
  inducedClusterIds: ReadonlySet<string>,
  zeroReview: KnowledgeDispositionReviewV1 | undefined
): cluster is undefined {
  return (
    !cluster ||
    !rebuiltInduction ||
    rebuiltInduction.receiptHash !== induction.receiptHash ||
    inducedClusterIds.has(induction.clusterId) ||
    !populationHashes.has(induction.populationHash) ||
    induction.populationHash !== cluster.populationHash ||
    induction.clusterHash !== hashKnowledgeClusterV1(cluster) ||
    !sameStrings(induction.observationIds, cluster.observationIds) ||
    induction.currentAnalysisFixpointHash !== input.analysisFixpoint.analysisReviewContextHash ||
    (Boolean(induction.zeroHypothesisReviewReceiptId) &&
      zeroReview?.reviewKind !== 'zero-hypothesis')
  );
}

function registerInductionHypotheses(
  induction: InductionReceiptV1,
  cluster: KnowledgeClusterSetV1['clusters'][number],
  hypothesesById: Map<string, HypothesisInductionBinding>
): void {
  const sourceObligationIds = [
    ...new Set(cluster.memberLineage.flatMap((member) => member.obligationIds)),
  ].sort();
  for (const hypothesis of induction.hypotheses) {
    if (
      hypothesesById.has(hypothesis.hypothesisId) ||
      hypothesis.premiseFactIds.some((factId) => !cluster.memberFactIds.includes(factId))
    ) {
      fail('STRICT_PRODUCTION_HYPOTHESIS_INDUCTION_CONSERVATION_FAILED');
    }
    hypothesesById.set(hypothesis.hypothesisId, {
      induction,
      premiseFactIds: hypothesis.premiseFactIds,
      sourceObligationIds,
    });
  }
}

function consumeZeroHypothesisReview(
  induction: InductionReceiptV1,
  cluster: KnowledgeClusterSetV1['clusters'][number],
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  if (!induction.zeroHypothesisReviewReceiptId) {
    return;
  }
  const review = reviewById.get(induction.zeroHypothesisReviewReceiptId);
  const zeroHypothesisReason = induction.zeroHypothesisReason;
  if (
    !review ||
    !zeroHypothesisReason ||
    !sameUniqueStrings(
      review.obligationIds,
      cluster.memberLineage.flatMap((member) => member.obligationIds)
    ) ||
    review.proposedDispositionHash !== hashZeroHypothesisProposal(induction, zeroHypothesisReason)
  ) {
    fail('STRICT_PRODUCTION_INDUCTION_LINEAGE_MISMATCH');
  }
  consumeDispositionReview(review, 'zero-hypothesis', consumedReviewIds);
}

function hashZeroHypothesisProposal(
  induction: InductionReceiptV1,
  zeroHypothesisReason: NonNullable<InductionReceiptV1['zeroHypothesisReason']>
): string {
  return hashKnowledgeDispositionProposalV1({
    reviewKind: 'zero-hypothesis',
    populationHash: induction.populationHash,
    clusterHash: induction.clusterHash,
    clusterId: induction.clusterId,
    observationIds: induction.observationIds,
    mode: induction.mode,
    zeroHypothesisReason,
  });
}

function inductionClustersNotConserved(
  clustersById: ReadonlyMap<string, KnowledgeClusterSetV1['clusters'][number]>,
  inducedClusterIds: ReadonlySet<string>
): boolean {
  return (
    clustersById.size !== inducedClusterIds.size ||
    [...clustersById.keys()].some((clusterId) => !inducedClusterIds.has(clusterId))
  );
}

function validateFalsificationEvidence(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash'],
  consumedReviewIds: Set<string>,
  hypothesesById: ReadonlyMap<string, HypothesisInductionBinding>
): void {
  if (
    input.falsifications.some((falsification) => !hypothesesById.has(falsification.hypothesisId))
  ) {
    fail('STRICT_PRODUCTION_HYPOTHESIS_INDUCTION_CONSERVATION_FAILED');
  }

  const falsifiedHypothesisIds = new Set<string>();
  for (const falsification of input.falsifications) {
    const inductionBinding = hypothesesById.get(falsification.hypothesisId);
    const review = reviewById.get(falsification.dispositionReviewReceiptId);
    validateFalsificationAuthority(
      input,
      falsification,
      inductionBinding,
      review,
      receiptsByHash,
      falsifiedHypothesisIds
    );
    if (!review) {
      fail('STRICT_PRODUCTION_FALSIFICATION_LINEAGE_MISMATCH');
    }
    falsifiedHypothesisIds.add(falsification.hypothesisId);
    consumeDispositionReview(review, 'falsification', consumedReviewIds);
  }
  if (
    hypothesesById.size !== falsifiedHypothesisIds.size ||
    [...hypothesesById.keys()].some((hypothesisId) => !falsifiedHypothesisIds.has(hypothesisId))
  ) {
    fail('STRICT_PRODUCTION_HYPOTHESIS_INDUCTION_CONSERVATION_FAILED');
  }
}

function validateFalsificationAuthority(
  input: StrictProductionAuthorityInputV1,
  falsification: FalsificationReceiptV1,
  inductionBinding: HypothesisInductionBinding | undefined,
  review: KnowledgeDispositionReviewV1 | undefined,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash'],
  falsifiedHypothesisIds: ReadonlySet<string>
): void {
  assertCanonicalHash(
    falsification,
    'receiptHash',
    'STRICT_PRODUCTION_FALSIFICATION_HASH_MISMATCH'
  );
  const rebuiltFalsification =
    review &&
    createFalsificationReceiptV1({
      hypothesisId: falsification.hypothesisId,
      enrolledCounterqueryIds: falsification.enrolledCounterqueryIds,
      executions: falsification.executions,
      counterqueryApplicability: falsification.counterqueryApplicability,
      currentAnalysisFixpointHash: falsification.currentAnalysisFixpointHash,
      dispositionReview: review,
    });
  if (
    falsificationEnvelopeInvalid(
      input,
      falsification,
      rebuiltFalsification,
      inductionBinding,
      falsifiedHypothesisIds
    ) ||
    falsificationReviewInvalid(falsification, inductionBinding, review) ||
    falsificationExecutionsInvalid(falsification, receiptsByHash)
  ) {
    fail('STRICT_PRODUCTION_FALSIFICATION_LINEAGE_MISMATCH');
  }
}

function falsificationEnvelopeInvalid(
  input: StrictProductionAuthorityInputV1,
  falsification: FalsificationReceiptV1,
  rebuiltFalsification: FalsificationReceiptV1 | undefined,
  inductionBinding: HypothesisInductionBinding | undefined,
  falsifiedHypothesisIds: ReadonlySet<string>
): boolean {
  return (
    !inductionBinding ||
    !rebuiltFalsification ||
    rebuiltFalsification.receiptHash !== falsification.receiptHash ||
    falsifiedHypothesisIds.has(falsification.hypothesisId) ||
    falsification.verdict === 'unknown' ||
    falsification.currentAnalysisFixpointHash !== input.analysisFixpoint.analysisReviewContextHash
  );
}

function falsificationReviewInvalid(
  falsification: FalsificationReceiptV1,
  inductionBinding: HypothesisInductionBinding | undefined,
  review: KnowledgeDispositionReviewV1 | undefined
): boolean {
  if (!inductionBinding || !review) {
    return true;
  }
  const expectedObligationIds =
    falsification.counterqueryApplicability.status === 'required'
      ? falsification.executions.map((execution) => execution.obligationId)
      : inductionBinding.sourceObligationIds;
  return (
    review.reviewKind !== 'falsification' ||
    review.populationHash !== inductionBinding.induction.populationHash ||
    !sameStrings(review.obligationIds, expectedObligationIds) ||
    falsificationReviewExecutionHashesInvalid(falsification, review) ||
    review.proposedDispositionHash !==
      hashFalsificationDispositionProposal(falsification, review.populationHash)
  );
}

function falsificationReviewExecutionHashesInvalid(
  falsification: FalsificationReceiptV1,
  review: KnowledgeDispositionReviewV1
): boolean {
  return (
    falsification.counterqueryApplicability.status === 'required' &&
    !sameStrings(
      review.executionReceiptHashes,
      falsification.executions.map((execution) => execution.executionReceipt.receiptHash)
    )
  );
}

function hashFalsificationDispositionProposal(
  falsification: FalsificationReceiptV1,
  populationHash: string
): string {
  return hashKnowledgeDispositionProposalV1({
    reviewKind: 'falsification',
    populationHash,
    hypothesisId: falsification.hypothesisId,
    enrolledCounterqueryIds: falsification.enrolledCounterqueryIds,
    executions: falsification.executions.map((execution) => ({
      counterqueryId: execution.counterqueryId,
      obligationId: execution.obligationId,
      executionReceiptHash: execution.executionReceipt.receiptHash,
      executionOutputHash: execution.executionReceipt.outputHash,
      denominatorHash: execution.executionReceipt.denominatorHash,
      counterexampleFactIds: execution.counterexampleFactIds,
    })),
    counterqueryApplicability: {
      status: falsification.counterqueryApplicability.status,
      reasonCode: falsification.counterqueryApplicability.reasonCode,
    },
  });
}

function falsificationExecutionsInvalid(
  falsification: FalsificationReceiptV1,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): boolean {
  return falsification.executions.some((execution) => {
    const enrolledReceipt = receiptsByHash.get(execution.executionReceipt.receiptHash);
    return !enrolledReceipt || enrolledReceipt.outputHash !== execution.executionReceipt.outputHash;
  });
}

function validateExpressionClosure(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  const expressionGroups = new Map<string, HypothesisExpressionSetReceiptV1[]>();
  const context = buildExpressionLineageContext(input);
  for (const expressionSet of input.expressionSets) {
    validateExpressionSetAuthority(input, expressionSet, context, reviewById, consumedReviewIds);
    const group = expressionGroups.get(expressionSet.hypothesisId) ?? [];
    group.push(expressionSet);
    expressionGroups.set(expressionSet.hypothesisId, group);
  }
  validateExpressionGroupClosure(input, expressionGroups);
}

interface ExpressionLineageContext {
  readonly hypothesisObligations: ReadonlyMap<string, readonly string[]>;
  readonly hypothesisPopulations: ReadonlyMap<string, string>;
}

function buildExpressionLineageContext(
  input: StrictProductionAuthorityInputV1
): ExpressionLineageContext {
  const clustersById = new Map(
    input.clusterSets.flatMap((clusterSet) =>
      clusterSet.clusters.map((cluster) => [cluster.clusterId, cluster] as const)
    )
  );
  const hypothesisObligations = new Map<string, readonly string[]>();
  const hypothesisPopulations = new Map<string, string>();
  for (const induction of input.inductions) {
    const cluster = clustersById.get(induction.clusterId);
    const obligationIds = [
      ...new Set(cluster?.memberLineage.flatMap((member) => member.obligationIds) ?? []),
    ].sort();
    for (const hypothesis of induction.hypotheses) {
      hypothesisObligations.set(hypothesis.hypothesisId, obligationIds);
      hypothesisPopulations.set(hypothesis.hypothesisId, induction.populationHash);
    }
  }
  return { hypothesisObligations, hypothesisPopulations };
}

function validateExpressionSetAuthority(
  input: StrictProductionAuthorityInputV1,
  expressionSet: HypothesisExpressionSetReceiptV1,
  context: ExpressionLineageContext,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  assertCanonicalHash(
    expressionSet,
    'receiptHash',
    'STRICT_PRODUCTION_EXPRESSION_SET_HASH_MISMATCH'
  );
  const rebuiltExpressionSet = validateHypothesisExpressionSetReceiptV1({
    schemaVersion: expressionSet.schemaVersion,
    receiptId: expressionSet.receiptId,
    hypothesisId: expressionSet.hypothesisId,
    analysisFixpointHash: expressionSet.analysisFixpointHash,
    privateCorpusRevision: expressionSet.privateCorpusRevision,
    version: expressionSet.version,
    parentReceiptId: expressionSet.parentReceiptId,
    terminalHead: expressionSet.terminalHead,
    expressions: expressionSet.expressions,
    zeroDisposition: expressionSet.zeroDisposition,
  });
  if (
    rebuiltExpressionSet.receiptHash !== expressionSet.receiptHash ||
    expressionSet.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
    expressionSet.privateCorpusRevision !== input.privateCorpusRevision ||
    !context.hypothesisPopulations.has(expressionSet.hypothesisId)
  ) {
    fail('STRICT_PRODUCTION_EXPRESSION_SET_LINEAGE_MISMATCH');
  }
  consumeExpressionDispositionReviews(expressionSet, context, reviewById, consumedReviewIds);
  consumeZeroExpressionDispositionReview(expressionSet, context, reviewById, consumedReviewIds);
}

function consumeExpressionDispositionReviews(
  expressionSet: HypothesisExpressionSetReceiptV1,
  context: ExpressionLineageContext,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  for (const row of expressionSet.expressions) {
    if (!row.dispositionReview) {
      continue;
    }
    const review = reviewById.get(row.dispositionReview.reviewReceiptId);
    const expectedProposalHash =
      review &&
      hashKnowledgeDispositionProposalV1({
        reviewKind: 'producer-non-draft',
        populationHash: review.populationHash,
        hypothesisId: expressionSet.hypothesisId,
        expression: {
          expressionId: row.expressionId,
          authoredFingerprint: row.authoredFingerprint,
          terminalFate: row.terminalFate,
          matchingRepresentativeId: row.matchingRepresentativeId ?? null,
          matchingContentReadyRecipeId: row.matchingContentReadyRecipeId ?? null,
        },
        zeroDisposition: null,
      });
    if (
      !review ||
      review.receiptHash !== row.dispositionReview.receiptHash ||
      review.populationHash !== context.hypothesisPopulations.get(expressionSet.hypothesisId) ||
      !sameStrings(
        review.obligationIds,
        context.hypothesisObligations.get(expressionSet.hypothesisId) ?? []
      ) ||
      review.proposedDispositionHash !== expectedProposalHash
    ) {
      fail('STRICT_PRODUCTION_EXPRESSION_SET_LINEAGE_MISMATCH');
    }
    consumeDispositionReview(review, 'producer-non-draft', consumedReviewIds);
  }
}

function consumeZeroExpressionDispositionReview(
  expressionSet: HypothesisExpressionSetReceiptV1,
  context: ExpressionLineageContext,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: Set<string>
): void {
  if (!expressionSet.zeroDisposition) {
    return;
  }
  const review = reviewById.get(expressionSet.zeroDisposition.dispositionReview.reviewReceiptId);
  const expectedProposalHash =
    review &&
    hashKnowledgeDispositionProposalV1({
      reviewKind: 'producer-non-draft',
      populationHash: review.populationHash,
      hypothesisId: expressionSet.hypothesisId,
      expression: null,
      zeroDisposition: {
        reasonCode: expressionSet.zeroDisposition.reasonCode,
        terminalFate: expressionSet.zeroDisposition.terminalFate,
      },
    });
  if (
    !review ||
    review.receiptHash !== expressionSet.zeroDisposition.dispositionReview.receiptHash ||
    review.populationHash !== context.hypothesisPopulations.get(expressionSet.hypothesisId) ||
    !sameStrings(
      review.obligationIds,
      context.hypothesisObligations.get(expressionSet.hypothesisId) ?? []
    ) ||
    review.proposedDispositionHash !== expectedProposalHash
  ) {
    fail('STRICT_PRODUCTION_EXPRESSION_SET_LINEAGE_MISMATCH');
  }
  consumeDispositionReview(review, 'producer-non-draft', consumedReviewIds);
}

function validateExpressionGroupClosure(
  input: StrictProductionAuthorityInputV1,
  expressionGroups: ReadonlyMap<string, readonly HypothesisExpressionSetReceiptV1[]>
): void {
  const eligibleHypothesisIds = [
    ...new Set(
      input.falsifications
        .filter((receipt) => receipt.verdict === 'survived' || receipt.verdict === 'not-required')
        .map((receipt) => receipt.hypothesisId)
    ),
  ].sort();
  const expressionHypothesisIds = [...expressionGroups.keys()].sort();
  for (const receipts of expressionGroups.values()) {
    validateHypothesisExpressionSetLineageV1(receipts);
  }
  if (
    !sameStrings(eligibleHypothesisIds, expressionHypothesisIds) ||
    [...expressionGroups.values()].some(
      (receipts) => receipts.filter((receipt) => receipt.terminalHead).length !== 1
    )
  ) {
    fail('STRICT_PRODUCTION_EXPRESSION_CLOSURE_MISMATCH');
  }
}

function validateInvestigatedEmptyDecisions(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash'],
  consumedReviewIds: Set<string>
): void {
  for (const decision of input.investigatedEmptyDecisions ?? []) {
    assertCanonicalHash(
      decision,
      'decisionHash',
      'STRICT_PRODUCTION_INVESTIGATED_EMPTY_HASH_MISMATCH'
    );
    const review = reviewById.get(decision.dispositionReviewReceiptId);
    const population = input.populations.find(
      (candidate) => candidate.populationHash === review?.populationHash
    );
    const executionReceipts =
      review?.executionBindings.map((binding) =>
        receiptsByHash.get(binding.executionReceiptHash)
      ) ?? [];
    const rebuiltDecision =
      review &&
      population &&
      executionReceipts.every((receipt): receipt is NonNullable<typeof receipt> =>
        Boolean(receipt)
      ) &&
      createInvestigatedEmptyDecisionV1({
        sourceRevisionVectorHash: decision.sourceRevisionVectorHash,
        finalExpandedScheduleHash: decision.finalExpandedScheduleHash,
        currentAnalysisFixpointHash: decision.currentAnalysisFixpointHash,
        expectedObligationIds: decision.expectedObligationIds,
        executionReceipts,
        dispositionReview: review,
        evidenceEntryIds: decision.evidenceEntryIds,
      });
    const scheduledObligationIds = input.analysisFixpoint.terminalObligations.map(
      (obligation) => obligation.obligationId
    );
    if (
      !review ||
      !population ||
      !rebuiltDecision ||
      rebuiltDecision.decisionHash !== decision.decisionHash ||
      JSON.stringify(rebuiltDecision) !== JSON.stringify(decision) ||
      population.completion !== 'complete' ||
      population.observations.length !== 0 ||
      decision.verdict !== 'pass' ||
      decision.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
      decision.finalExpandedScheduleHash !== input.analysisFixpoint.finalExpandedScheduleHash ||
      decision.currentAnalysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
      !sameStrings(decision.expectedObligationIds, scheduledObligationIds) ||
      !sameStrings(decision.expectedObligationIds, review.obligationIds) ||
      !sameStrings(decision.terminalExecutionReceiptHashes, review.executionReceiptHashes) ||
      review.proposedDispositionHash !==
        hashKnowledgeDispositionProposalV1({
          reviewKind: 'investigated-empty',
          populationHash: review.populationHash,
          sourceRevisionVectorHash: decision.sourceRevisionVectorHash,
          finalExpandedScheduleHash: decision.finalExpandedScheduleHash,
          currentAnalysisFixpointHash: decision.currentAnalysisFixpointHash,
          expectedObligationIds: decision.expectedObligationIds,
          executionBindings: review.executionBindings,
          evidenceEntryIds: decision.evidenceEntryIds,
        })
    ) {
      fail('STRICT_PRODUCTION_INVESTIGATED_EMPTY_LINEAGE_MISMATCH');
    }
    consumeDispositionReview(review, 'investigated-empty', consumedReviewIds);
  }
}

function consumeDispositionReview(
  review: KnowledgeDispositionReviewV1,
  expectedKind: KnowledgeDispositionReviewV1['reviewKind'],
  consumedReviewIds: Set<string>
): void {
  if (
    review.reviewKind !== expectedKind ||
    review.verdict !== 'pass' ||
    consumedReviewIds.has(review.reviewReceiptId)
  ) {
    fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_CONSUMPTION_INVALID');
  }
  consumedReviewIds.add(review.reviewReceiptId);
}

function validateDispositionReviewConservation(
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  consumedReviewIds: ReadonlySet<string>
): void {
  if (
    reviewById.size !== consumedReviewIds.size ||
    [...reviewById.keys()].some((reviewId) => !consumedReviewIds.has(reviewId))
  ) {
    fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_ORPHANED');
  }
}

function validateFixpoint(
  input: StrictProductionAuthorityInputV1,
  populationHashes: ReadonlySet<string>,
  clusterSetHashes: ReadonlySet<string>
): void {
  assertCanonicalHash(
    input.analysisFixpoint,
    'fixpointHash',
    'STRICT_PRODUCTION_FIXPOINT_HASH_MISMATCH'
  );
  const terminalByObligation = new Map(
    input.analysisFixpoint.terminalObligations.map((obligation) => [
      obligation.obligationId,
      obligation,
    ])
  );
  if (
    input.analysisFixpoint.analysisReviewContextHash !==
      createAnalysisReviewContextHashV1({
        finalExpandedScheduleHash: input.analysisFixpoint.finalExpandedScheduleHash,
        terminalObligations: input.analysisFixpoint.terminalObligations,
        populationHashes: input.analysisFixpoint.populationHashes,
        clusterSetHashes: input.analysisFixpoint.clusterSetHashes,
      }) ||
    !sameStrings(input.analysisFixpoint.populationHashes, [...populationHashes].sort()) ||
    !sameStrings(input.analysisFixpoint.clusterSetHashes, [...clusterSetHashes].sort()) ||
    input.clusterSets.some((clusterSet) =>
      clusterSet.dispositions.some((disposition) => disposition.status === 'unresolved')
    ) ||
    !sameStrings(
      input.analysisFixpoint.inductionReceiptHashes,
      input.inductions.map((receipt) => receipt.receiptHash)
    ) ||
    !sameStrings(
      input.analysisFixpoint.falsificationReceiptHashes,
      input.falsifications.map((receipt) => receipt.receiptHash)
    ) ||
    terminalByObligation.size !== input.factExecution.receipts.length ||
    input.factExecution.receipts.some((receipt) => {
      const terminal = terminalByObligation.get(receipt.obligationId);
      return (
        !terminal ||
        terminal.terminalReceiptId !== receipt.terminalReceiptId ||
        terminal.disposition !== receipt.disposition
      );
    })
  ) {
    fail('STRICT_PRODUCTION_FIXPOINT_LINEAGE_MISMATCH');
  }
}

function validateCandidateAndAdmissionConservation(input: StrictProductionAuthorityInputV1): {
  serialAdmissionLedgerHash: string | null;
  resourceConservation: StrictProductionResourceConservationV1;
  terminalEvidenceReceiptHashes: readonly string[];
} {
  const candidateState = validateCandidateBatches(input);
  const expressionByAttemptKey = validateCandidateExpressionBindings(
    input,
    candidateState.candidateAttempts
  );
  const terminalEvidence = validateTerminalEvidence(input, expressionByAttemptKey.values());
  const serialAdmissionLedgerHash = validateAdmissionLedgerAuthority(
    input,
    candidateState.candidateAttempts,
    expressionByAttemptKey,
    terminalEvidence.acceptedCorpusHashByTerminalId
  );
  return {
    serialAdmissionLedgerHash,
    resourceConservation: {
      ...candidateState.resourceCaps,
      consumedCandidateAttempts: candidateState.consumedCandidateAttempts,
      remainingCandidateAttempts:
        candidateState.resourceCaps.candidateAttemptCap - candidateState.consumedCandidateAttempts,
    },
    terminalEvidenceReceiptHashes: terminalEvidence.receiptHashes,
  };
}

type CandidateAttempt = CandidateAttemptBatchV1['attempts'][number];

interface CandidateBatchAuthorityState {
  readonly resourceCaps: StrictProductionAuthorityInputV1['resourceCaps'];
  readonly candidateAttempts: readonly CandidateAttempt[];
  readonly consumedCandidateAttempts: number;
}

function validateCandidateBatches(
  input: StrictProductionAuthorityInputV1
): CandidateBatchAuthorityState {
  const resourceCaps = validateResourceCaps(input.resourceCaps);
  let consumedCandidateAttempts = 0;
  let previousPassOrdinal = -1;
  const candidateBatchHashes = new Set<string>();
  const candidateAttemptIds = new Set<string>();
  const candidateAttempts: CandidateAttempt[] = [];
  for (const batch of input.candidateAttemptBatches) {
    const rebuilt = canonicalizeCandidateAttemptBatchV1({
      attempts: batch.attempts,
      existingAttemptCount: consumedCandidateAttempts,
      candidateAttemptCap: resourceCaps.candidateAttemptCap,
      maxAuthoredCandidatesPerCellPass: resourceCaps.maxAuthoredCandidatesPerCellPass,
    });
    if (candidateBatchLineageInvalid(input, batch, rebuilt.batchHash)) {
      fail('STRICT_PRODUCTION_CANDIDATE_BATCH_LINEAGE_MISMATCH');
    }
    if (
      batch.passOrdinal <= previousPassOrdinal ||
      candidateBatchHashes.has(batch.batchHash) ||
      candidateBatchHasDuplicateAttempt(batch.attempts, candidateAttemptIds)
    ) {
      fail('STRICT_PRODUCTION_CANDIDATE_BATCH_SEQUENCE_INVALID');
    }
    previousPassOrdinal = batch.passOrdinal;
    candidateBatchHashes.add(batch.batchHash);
    consumedCandidateAttempts += batch.attempts.length;
    candidateAttempts.push(...batch.attempts);
  }
  return { resourceCaps, candidateAttempts, consumedCandidateAttempts };
}

function candidateBatchLineageInvalid(
  input: StrictProductionAuthorityInputV1,
  batch: CandidateAttemptBatchV1,
  rebuiltBatchHash: string
): boolean {
  return (
    rebuiltBatchHash !== batch.batchHash ||
    batch.attempts.some(
      (attempt) =>
        attempt.runId !== input.runId ||
        attempt.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
        attempt.privateCorpusRevision !== input.privateCorpusRevision
    )
  );
}

function candidateBatchHasDuplicateAttempt(
  attempts: readonly CandidateAttempt[],
  candidateAttemptIds: Set<string>
): boolean {
  let duplicate = false;
  for (const attempt of attempts) {
    if (candidateAttemptIds.has(attempt.attemptId)) {
      duplicate = true;
    }
    candidateAttemptIds.add(attempt.attemptId);
  }
  return duplicate;
}

function validateCandidateExpressionBindings(
  input: StrictProductionAuthorityInputV1,
  candidateAttempts: readonly CandidateAttempt[]
): Map<string, TerminalExpressionAuthorityRow> {
  const expressionByAttemptKey = collectTerminalExpressions(input);
  const consumedExpressionKeys = new Set<string>();
  if (
    expressionByAttemptKey.size !== candidateAttempts.length ||
    candidateAttempts.some((attempt) =>
      candidateExpressionBindingInvalid(attempt, expressionByAttemptKey, consumedExpressionKeys)
    ) ||
    consumedExpressionKeys.size !== expressionByAttemptKey.size
  ) {
    fail('STRICT_PRODUCTION_CANDIDATE_EXPRESSION_CONSERVATION_FAILED');
  }
  return expressionByAttemptKey;
}

function candidateExpressionBindingInvalid(
  attempt: CandidateAttempt,
  expressionByAttemptKey: ReadonlyMap<string, TerminalExpressionAuthorityRow>,
  consumedExpressionKeys: Set<string>
): boolean {
  const expressionKey = candidateAttemptExpressionKey(attempt);
  const expression = expressionByAttemptKey.get(expressionKey)?.expression;
  const duplicate = consumedExpressionKeys.has(expressionKey);
  consumedExpressionKeys.add(expressionKey);
  return (
    duplicate ||
    !expression ||
    expression.authoredFingerprint !== attempt.authoredFingerprint ||
    expression.terminalReceiptId !== attempt.terminalReceiptId ||
    expression.terminalReceiptHash !== attempt.terminalReceiptHash
  );
}

function validateAdmissionLedgerAuthority(
  input: StrictProductionAuthorityInputV1,
  candidateAttempts: readonly CandidateAttempt[],
  expressionByAttemptKey: ReadonlyMap<string, TerminalExpressionAuthorityRow>,
  acceptedCorpusHashByTerminalId: ReadonlyMap<string, string>
): string | null {
  if (!input.serialAdmissionLedger) {
    if (candidateAttempts.length > 0) {
      fail('STRICT_PRODUCTION_ADMISSION_LEDGER_REQUIRED');
    }
    return null;
  }
  const rebuilt = validateSerialAdmissionLedgerV1({
    initialAcceptedCorpusHash: input.serialAdmissionLedger.initialAcceptedCorpusHash,
    rows: input.serialAdmissionLedger.rows,
  });
  if (rebuilt.ledgerHash !== input.serialAdmissionLedger.ledgerHash) {
    fail('STRICT_PRODUCTION_ADMISSION_LEDGER_HASH_MISMATCH');
  }
  if (
    rebuilt.rows.length !== candidateAttempts.length ||
    rebuilt.rows.some((row, index) =>
      admissionLedgerRowInvalid(
        row,
        candidateAttempts[index],
        expressionByAttemptKey,
        acceptedCorpusHashByTerminalId
      )
    )
  ) {
    fail('STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED');
  }
  return rebuilt.ledgerHash;
}

function admissionLedgerRowInvalid(
  row: SerialAdmissionLedgerV1['rows'][number],
  attempt: CandidateAttempt | undefined,
  expressionByAttemptKey: ReadonlyMap<string, TerminalExpressionAuthorityRow>,
  acceptedCorpusHashByTerminalId: ReadonlyMap<string, string>
): boolean {
  if (!attempt) {
    return true;
  }
  const expression = expressionByAttemptKey.get(candidateAttemptExpressionKey(attempt))?.expression;
  const acceptedCorpusHash = acceptedCorpusHashByTerminalId.get(row.terminalReceiptId);
  return (
    !expression ||
    row.proposalId !== attempt.attemptId ||
    row.attemptHash !== attempt.attemptHash ||
    row.authoredFingerprint !== attempt.authoredFingerprint ||
    row.terminalReceiptId !== expression.terminalReceiptId ||
    row.terminalReceiptHash !== expression.terminalReceiptHash ||
    row.terminalReceiptId !== attempt.terminalReceiptId ||
    row.terminalReceiptHash !== attempt.terminalReceiptHash ||
    (acceptedCorpusHash !== undefined && row.observedAcceptedCorpusHash !== acceptedCorpusHash) ||
    row.terminalFate !== admissionFateForExpression(expression.terminalFate)
  );
}

function candidateAttemptExpressionKey(attempt: CandidateAttempt): string {
  return `${attempt.hypothesisId}\u0000${attempt.expressionSetReceiptId}\u0000${attempt.expressionId}`;
}

function validateTerminalEvidence(
  input: StrictProductionAuthorityInputV1,
  expressions: Iterable<TerminalExpressionAuthorityRow>
): {
  receiptHashes: readonly string[];
  acceptedCorpusHashByTerminalId: ReadonlyMap<string, string>;
} {
  const registry = buildTerminalEvidenceRegistry(input);
  validateTerminalAdmissionChains(input, registry);
  validateTerminalG2Chains(input, registry);
  const consumption = createTerminalEvidenceConsumption();
  for (const expressionRef of expressions) {
    consumeExpressionTerminalEvidence(input, registry, consumption, expressionRef);
  }
  consumeZeroDispositionTerminalEvidence(input, registry, consumption);
  validateTerminalEvidenceConservation(registry, consumption);
  return {
    receiptHashes: collectTerminalEvidenceReceiptHashes(input),
    acceptedCorpusHashByTerminalId: consumption.acceptedCorpusHashByTerminalId,
  };
}

/**
 * 零输出不是 terminal-evidence 的空集：reviewed-non-draft row 必须消费与普通 candidate
 * 相同的 G1→非持久化 Admission→完整 accepted-corpus inspection 链。
 */
function consumeZeroDispositionTerminalEvidence(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption
): void {
  for (const execution of input.semanticDispositionReviewExecutions ?? []) {
    const request = execution.request.semanticRequest;
    const context = request.context;
    if (context.reviewKind !== 'producer-non-draft' || context.proposal.expression !== null) {
      continue;
    }
    const expressionSet = input.expressionSets.find(
      (candidate) => candidate.receiptId === context.expressionSetReceiptId
    );
    const admission = registry.admissionByHash.get(context.admissionReceipt.receiptHash);
    const g1 = registry.g1ByHash.get(context.g1Receipt.receiptHash);
    const corpusInspection = registry.corpusInspectionByHash.get(
      context.admissionReceipt.acceptedCorpusInspectionHash
    );
    if (
      !context.proposal.zeroDisposition ||
      context.proposal.zeroDisposition.terminalFate !== 'reviewed-non-draft' ||
      expressionSet?.zeroDisposition?.terminalFate !== 'reviewed-non-draft' ||
      expressionSet.zeroDisposition.dispositionReview.semanticExecutionResultHash !==
        execution.executionHash ||
      !context.target.authoredFingerprint ||
      !admission ||
      !g1 ||
      !corpusInspection ||
      admission.disposition !== 'admit' ||
      admission.inputFingerprint !== context.target.authoredFingerprint ||
      admission.finalAdmittedFingerprint !== context.target.authoredFingerprint ||
      admission.g1ReceiptHash !== g1.receiptHash ||
      hashCanonicalJson(admission) !== hashCanonicalJson(context.admissionReceipt) ||
      hashCanonicalJson(g1) !== hashCanonicalJson(context.g1Receipt)
    ) {
      fail('STRICT_PRODUCTION_ZERO_DISPOSITION_ADMISSION_CHAIN_INVALID');
    }
    if (!input.semanticDispositionReviewHostAuthority) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
    }
    createProducerZeroDispositionAdmissionAuthorityV1({
      execution,
      hostAuthority: input.semanticDispositionReviewHostAuthority,
      expressionSet,
      corpusInspection,
    });
    consumeAdmissionEvidence(registry, consumption, admission);
  }
}

interface TerminalEvidenceRegistry {
  readonly g1ById: Map<string, StrictG1ReceiptV1>;
  readonly g1ByHash: Map<string, StrictG1ReceiptV1>;
  readonly g1TerminalBindingById: Map<string, StrictG1TerminalBindingReceiptV1>;
  readonly corpusInspectionByHash: Map<string, StrictAcceptedCorpusInspectionV1>;
  readonly admissionById: Map<string, StrictAdmissionReceiptV1>;
  readonly admissionByHash: Map<string, StrictAdmissionReceiptV1>;
  readonly g2ById: Map<string, StrictG2ReceiptV1>;
  readonly gateReturnById: Map<string, StrictExpressionTerminalReturnReceiptV1>;
  readonly allIds: Set<string>;
}

interface TerminalEvidenceConsumption {
  readonly consumedG1Ids: Set<string>;
  readonly consumedG1TerminalBindingIds: Set<string>;
  readonly consumedCorpusInspectionHashes: Set<string>;
  readonly consumedAdmissionIds: Set<string>;
  readonly consumedG2Ids: Set<string>;
  readonly consumedGateReturnIds: Set<string>;
  readonly consumedExpressionTerminalIds: Set<string>;
  readonly acceptedCorpusHashByTerminalId: Map<string, string>;
}

function buildTerminalEvidenceRegistry(
  input: StrictProductionAuthorityInputV1
): TerminalEvidenceRegistry {
  const g1ById = new Map<string, StrictG1ReceiptV1>();
  const g1ByHash = new Map<string, StrictG1ReceiptV1>();
  const g1TerminalBindingById = new Map<string, StrictG1TerminalBindingReceiptV1>();
  const corpusInspectionByHash = new Map<string, StrictAcceptedCorpusInspectionV1>();
  const admissionById = new Map<string, StrictAdmissionReceiptV1>();
  const admissionByHash = new Map<string, StrictAdmissionReceiptV1>();
  const g2ById = new Map<string, StrictG2ReceiptV1>();
  const gateReturnById = new Map<string, StrictExpressionTerminalReturnReceiptV1>();
  const allIds = new Set<string>();
  for (const receipt of input.terminalEvidence.g1Receipts) {
    assertStrictG1ReceiptV1(receipt);
    registerTerminalEvidence(allIds, g1ById, strictG1TerminalId(receipt), receipt);
    g1ByHash.set(receipt.receiptHash, receipt);
  }
  const registry = {
    g1ById,
    g1ByHash,
    g1TerminalBindingById,
    corpusInspectionByHash,
    admissionById,
    admissionByHash,
    g2ById,
    gateReturnById,
    allIds,
  };
  registerG1TerminalBindings(input, registry);
  registerCorpusInspections(input, registry);
  registerAdmissionReceipts(input, registry);
  registerG2Receipts(input, registry);
  registerGateReturns(input, registry);
  return registry;
}

function registerTerminalEvidence<T>(
  allIds: Set<string>,
  map: Map<string, T>,
  id: string,
  value: T
): void {
  if (allIds.has(id)) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_DUPLICATE');
  }
  allIds.add(id);
  map.set(id, value);
}

function registerG1TerminalBindings(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const binding of input.terminalEvidence.g1TerminalBindings) {
    const g1 = registry.g1ByHash.get(binding.g1ReceiptHash);
    const rebuilt =
      g1 &&
      createStrictG1TerminalBindingReceiptV1({
        runId: binding.runId,
        analysisFixpointHash: binding.analysisFixpointHash,
        privateCorpusRevision: binding.privateCorpusRevision,
        hypothesisId: binding.hypothesisId,
        expressionSetReceiptId: binding.expressionSetReceiptId,
        expressionId: binding.expressionId,
        authoredFingerprint: binding.authoredFingerprint,
        g1Receipt: g1,
      });
    if (!rebuilt || hashCanonicalJson(rebuilt) !== hashCanonicalJson(binding)) {
      fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_INVALID');
    }
    registerTerminalEvidence(
      registry.allIds,
      registry.g1TerminalBindingById,
      binding.receiptId,
      binding
    );
  }
}

function registerCorpusInspections(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const inspection of input.terminalEvidence.corpusInspections) {
    assertStrictAcceptedCorpusInspectionV1(inspection);
    if (registry.corpusInspectionByHash.has(inspection.inspectionHash)) {
      fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_DUPLICATE');
    }
    registry.corpusInspectionByHash.set(inspection.inspectionHash, inspection);
  }
}

function registerAdmissionReceipts(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const receipt of input.terminalEvidence.admissionReceipts) {
    registerTerminalEvidence(registry.allIds, registry.admissionById, receipt.admissionId, receipt);
    registry.admissionByHash.set(receipt.receiptHash, receipt);
  }
}

function registerG2Receipts(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const receipt of input.terminalEvidence.g2Receipts) {
    registerTerminalEvidence(
      registry.allIds,
      registry.g2ById,
      strictG2TerminalId(receipt),
      receipt
    );
  }
}

function registerGateReturns(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const receipt of input.terminalEvidence.gateReturns) {
    const rebuilt = createStrictExpressionTerminalReturnReceiptV1({
      runId: receipt.runId,
      analysisFixpointHash: receipt.analysisFixpointHash,
      privateCorpusRevision: receipt.privateCorpusRevision,
      hypothesisId: receipt.hypothesisId,
      expressionSetReceiptId: receipt.expressionSetReceiptId,
      expressionId: receipt.expressionId,
      authoredFingerprint: receipt.authoredFingerprint,
      terminalFate: receipt.terminalFate,
      gateReturn: receipt.gateReturn,
    });
    if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(receipt)) {
      fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_INVALID');
    }
    registerTerminalEvidence(registry.allIds, registry.gateReturnById, receipt.receiptId, receipt);
  }
}

function validateTerminalAdmissionChains(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  // 先把 registry 内每条 admission / G2 的真实前驱链接重放完，再允许 expression 消费终态。
  for (const receipt of registry.admissionById.values()) {
    const g1 = registry.g1ByHash.get(receipt.g1ReceiptHash);
    const corpusInspection = registry.corpusInspectionByHash.get(
      receipt.acceptedCorpusInspectionHash
    );
    const rebuilt =
      g1 &&
      corpusInspection &&
      createStrictAdmissionReceiptV1({
        g1Receipt: g1,
        corpusInspection,
        inputFingerprint: receipt.inputFingerprint,
        finalAdmittedFingerprint: receipt.finalAdmittedFingerprint,
        exactMatches: receipt.exactMatches,
        semanticMatches: receipt.semanticMatches,
        consolidation: receipt.consolidation,
        algorithmVersion: receipt.algorithmVersion,
      });
    if (
      !g1 ||
      !corpusInspection ||
      !rebuilt ||
      hashCanonicalJson(rebuilt) !== hashCanonicalJson(receipt) ||
      g1.verdict !== 'pass' ||
      g1.candidateFingerprint !== receipt.inputFingerprint ||
      receipt.runId !== input.runId ||
      receipt.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
      receipt.privateCorpusRevision !== input.privateCorpusRevision
    ) {
      fail('STRICT_PRODUCTION_TERMINAL_ADMISSION_CHAIN_INVALID');
    }
  }
}

function validateTerminalG2Chains(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry
): void {
  for (const receipt of registry.g2ById.values()) {
    const g1 = registry.g1ByHash.get(receipt.g1ReceiptHash);
    const admission = registry.admissionByHash.get(receipt.admissionReceiptHash);
    const rebuilt =
      g1 &&
      admission &&
      createStrictG2ReceiptV1({
        g1Receipt: g1,
        admissionReceipt: admission,
        reviewedFingerprint: receipt.reviewedFingerprint,
        producer: receipt.producer,
        reviewer: receipt.reviewer,
        rows: receipt.rows,
        novelty: receipt.novelty,
        duplicate: receipt.duplicate,
        repairAttempt: receipt.repairAttempt,
        calibrationReceiptHash: receipt.calibrationReceiptHash,
        ruleVersion: receipt.ruleVersion,
        permittedRepairFields: receipt.permittedRepairFields,
      });
    if (
      !g1 ||
      !admission ||
      !rebuilt ||
      hashCanonicalJson(rebuilt) !== hashCanonicalJson(receipt) ||
      g1.verdict !== 'pass' ||
      admission.disposition !== 'admit' ||
      admission.g1ReceiptHash !== g1.receiptHash ||
      receipt.runId !== input.runId ||
      receipt.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
      receipt.privateCorpusRevision !== input.privateCorpusRevision ||
      receipt.candidateFingerprint !== receipt.reviewedFingerprint ||
      receipt.reviewedFingerprint !== admission.finalAdmittedFingerprint ||
      admission.inputFingerprint !== g1.candidateFingerprint
    ) {
      fail('STRICT_PRODUCTION_TERMINAL_G2_CHAIN_INVALID');
    }
  }
}

function createTerminalEvidenceConsumption(): TerminalEvidenceConsumption {
  return {
    consumedG1Ids: new Set<string>(),
    consumedG1TerminalBindingIds: new Set<string>(),
    consumedCorpusInspectionHashes: new Set<string>(),
    consumedAdmissionIds: new Set<string>(),
    consumedG2Ids: new Set<string>(),
    consumedGateReturnIds: new Set<string>(),
    consumedExpressionTerminalIds: new Set<string>(),
    acceptedCorpusHashByTerminalId: new Map<string, string>(),
  };
}

function consumeExpressionTerminalEvidence(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow
): void {
  const expression = expressionRef.expression;
  if (consumption.consumedExpressionTerminalIds.has(expression.terminalReceiptId)) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_REUSED');
  }
  consumption.consumedExpressionTerminalIds.add(expression.terminalReceiptId);
  if (
    expression.terminalFate === 'reviewed-merge' ||
    expression.terminalFate === 'reviewed-duplicate'
  ) {
    const review = expression.dispositionReview;
    const execution = input.semanticDispositionReviewExecutions?.find(
      (candidate) => candidate.executionHash === review?.semanticExecutionResultHash
    );
    const admission =
      execution?.request.semanticRequest.context.reviewKind === 'producer-non-draft'
        ? execution.request.semanticRequest.context.admissionReceipt
        : null;
    const registeredAdmission = admission
      ? registry.admissionByHash.get(admission.receiptHash)
      : undefined;
    if (
      !review ||
      !execution ||
      !admission ||
      !registeredAdmission ||
      registeredAdmission.admissionId !== admission.admissionId ||
      expression.authoredFingerprint !== admission.inputFingerprint ||
      (expression.terminalFate === 'reviewed-merge'
        ? admission.disposition !== 'merge'
        : admission.disposition !== 'duplicate')
    ) {
      fail('STRICT_PRODUCTION_TERMINAL_ADMISSION_CHAIN_INVALID');
    }
    // review 是 expression 的 terminal receipt；真实 Admission/G1/corpus inspection 则从
    // Agent execution 的完整 context 回放并消费，不能再因 terminal id 不同而旁路。
    consumeAdmissionEvidence(registry, consumption, registeredAdmission);
    consumption.acceptedCorpusHashByTerminalId.set(
      expression.terminalReceiptId,
      registeredAdmission.acceptedCorpusHash
    );
    return;
  }
  const g1TerminalBinding = registry.g1TerminalBindingById.get(expression.terminalReceiptId);
  const admission = registry.admissionById.get(expression.terminalReceiptId);
  const g2 = registry.g2ById.get(expression.terminalReceiptId);
  const gateReturn = registry.gateReturnById.get(expression.terminalReceiptId);
  const terminalHash =
    g1TerminalBinding?.receiptHash ??
    admission?.receiptHash ??
    g2?.receiptHash ??
    gateReturn?.receiptHash;
  if (!terminalHash || terminalHash !== expression.terminalReceiptHash) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  switch (expression.terminalFate) {
    case 'content-ready':
      consumeContentReadyTerminal(registry, consumption, expressionRef, g2);
      return;
    case 'g1-rejected':
      consumeG1RejectedTerminal(input, registry, consumption, expressionRef, g1TerminalBinding);
      return;
    case 'admission-rejected':
      consumeAdmissionRejectedTerminal(registry, consumption, expressionRef, admission);
      return;
    case 'g2-rejected':
      consumeG2RejectedTerminal(registry, consumption, expressionRef, g2);
      return;
    case 'repair-superseded':
      consumeRepairSupersededTerminal(input, registry, consumption, expressionRef, g2, gateReturn);
      return;
    case 'failed':
    case 'unknown':
      consumeGateReturnTerminal(input, consumption, expressionRef, gateReturn);
      return;
    default:
      fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
}

function consumeContentReadyTerminal(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  receipt: StrictG2ReceiptV1 | undefined
): void {
  if (
    !receipt ||
    receipt.verdict !== 'pass' ||
    receipt.reviewedFingerprint !== expressionRef.expression.authoredFingerprint
  ) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeG2Evidence(registry, consumption, receipt);
}

function consumeG1RejectedTerminal(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  binding: StrictG1TerminalBindingReceiptV1 | undefined
): void {
  if (!binding || !terminalReturnCoordinatesMatchExpression(binding, expressionRef, input)) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeEvidenceIdOnce(consumption.consumedG1TerminalBindingIds, binding.receiptId);
  const terminalG1 = registry.g1ByHash.get(binding.g1ReceiptHash);
  if (!terminalG1) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeG1Evidence(consumption, terminalG1);
}

function consumeAdmissionRejectedTerminal(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  receipt: StrictAdmissionReceiptV1 | undefined
): void {
  if (
    !receipt ||
    receipt.disposition === 'admit' ||
    receipt.inputFingerprint !== expressionRef.expression.authoredFingerprint
  ) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeAdmissionEvidence(registry, consumption, receipt);
}

function consumeG2RejectedTerminal(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  receipt: StrictG2ReceiptV1 | undefined
): void {
  if (
    !receipt ||
    receipt.verdict !== 'reject' ||
    receipt.reviewedFingerprint !== expressionRef.expression.authoredFingerprint
  ) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeG2Evidence(registry, consumption, receipt);
}

function consumeRepairSupersededTerminal(
  input: StrictProductionAuthorityInputV1,
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  g2: StrictG2ReceiptV1 | undefined,
  gateReturn: StrictExpressionTerminalReturnReceiptV1 | undefined
): void {
  if (
    g2?.verdict === 'revise' &&
    g2.reviewedFingerprint === expressionRef.expression.authoredFingerprint
  ) {
    consumeG2Evidence(registry, consumption, g2);
    return;
  }
  if (
    gateReturn?.terminalFate === expressionRef.expression.terminalFate &&
    terminalReturnMatchesExpression(gateReturn, expressionRef, input)
  ) {
    consumeEvidenceIdOnce(consumption.consumedGateReturnIds, gateReturn.receiptId);
    return;
  }
  fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
}

function consumeGateReturnTerminal(
  input: StrictProductionAuthorityInputV1,
  consumption: TerminalEvidenceConsumption,
  expressionRef: TerminalExpressionAuthorityRow,
  gateReturn: StrictExpressionTerminalReturnReceiptV1 | undefined
): void {
  if (
    !gateReturn ||
    gateReturn.terminalFate !== expressionRef.expression.terminalFate ||
    !terminalReturnMatchesExpression(gateReturn, expressionRef, input)
  ) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
  }
  consumeEvidenceIdOnce(consumption.consumedGateReturnIds, gateReturn.receiptId);
}

function consumeG1Evidence(
  consumption: TerminalEvidenceConsumption,
  receipt: StrictG1ReceiptV1
): void {
  consumeEvidenceIdOnce(consumption.consumedG1Ids, strictG1TerminalId(receipt));
}

function consumeAdmissionEvidence(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  receipt: StrictAdmissionReceiptV1
): void {
  consumeEvidenceIdOnce(consumption.consumedAdmissionIds, receipt.admissionId);
  const g1 = registry.g1ByHash.get(receipt.g1ReceiptHash);
  const inspection = registry.corpusInspectionByHash.get(receipt.acceptedCorpusInspectionHash);
  if (!g1 || !inspection) {
    fail('STRICT_PRODUCTION_TERMINAL_ADMISSION_CHAIN_INVALID');
  }
  consumeEvidenceIdOnce(consumption.consumedCorpusInspectionHashes, inspection.inspectionHash);
  consumption.acceptedCorpusHashByTerminalId.set(
    receipt.admissionId,
    inspection.acceptedCorpusHash
  );
  consumeG1Evidence(consumption, g1);
}

function consumeG2Evidence(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption,
  receipt: StrictG2ReceiptV1
): void {
  const terminalId = strictG2TerminalId(receipt);
  consumeEvidenceIdOnce(consumption.consumedG2Ids, terminalId);
  const admission = registry.admissionByHash.get(receipt.admissionReceiptHash);
  if (!admission) {
    fail('STRICT_PRODUCTION_TERMINAL_G2_CHAIN_INVALID');
  }
  consumeAdmissionEvidence(registry, consumption, admission);
  consumption.acceptedCorpusHashByTerminalId.set(terminalId, admission.acceptedCorpusHash);
}

function consumeEvidenceIdOnce(consumedIds: Set<string>, id: string): void {
  if (consumedIds.has(id)) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_REUSED');
  }
  consumedIds.add(id);
}

function validateTerminalEvidenceConservation(
  registry: TerminalEvidenceRegistry,
  consumption: TerminalEvidenceConsumption
): void {
  if (
    !sameStrings([...consumption.consumedG1Ids], [...registry.g1ById.keys()]) ||
    !sameStrings(
      [...consumption.consumedG1TerminalBindingIds],
      [...registry.g1TerminalBindingById.keys()]
    ) ||
    !sameStrings(
      [...consumption.consumedCorpusInspectionHashes],
      [...registry.corpusInspectionByHash.keys()]
    ) ||
    !sameStrings([...consumption.consumedAdmissionIds], [...registry.admissionById.keys()]) ||
    !sameStrings([...consumption.consumedG2Ids], [...registry.g2ById.keys()]) ||
    !sameStrings([...consumption.consumedGateReturnIds], [...registry.gateReturnById.keys()])
  ) {
    fail('STRICT_PRODUCTION_TERMINAL_EVIDENCE_ORPHANED');
  }
}

function collectTerminalEvidenceReceiptHashes(
  input: StrictProductionAuthorityInputV1
): readonly string[] {
  return [
    ...input.terminalEvidence.g1Receipts.map((receipt) => receipt.receiptHash),
    ...input.terminalEvidence.g1TerminalBindings.map((binding) => binding.receiptHash),
    ...input.terminalEvidence.corpusInspections.map((inspection) => inspection.inspectionHash),
    ...input.terminalEvidence.admissionReceipts.map((receipt) => receipt.receiptHash),
    ...input.terminalEvidence.g2Receipts.map((receipt) => receipt.receiptHash),
    ...input.terminalEvidence.gateReturns.map((receipt) => receipt.receiptHash),
  ].sort();
}

function terminalReturnMatchesExpression(
  receipt: StrictExpressionTerminalReturnReceiptV1,
  expressionRef: TerminalExpressionAuthorityRow,
  input: StrictProductionAuthorityInputV1
): boolean {
  return terminalReturnCoordinatesMatchExpression(receipt, expressionRef, input);
}

function terminalReturnCoordinatesMatchExpression(
  receipt: {
    readonly runId: string;
    readonly analysisFixpointHash: string;
    readonly privateCorpusRevision: string;
    readonly hypothesisId: string;
    readonly expressionSetReceiptId: string;
    readonly expressionId: string;
    readonly authoredFingerprint: string;
  },
  expressionRef: TerminalExpressionAuthorityRow,
  input: StrictProductionAuthorityInputV1
): boolean {
  return (
    receipt.runId === input.runId &&
    receipt.analysisFixpointHash === input.analysisFixpoint.fixpointHash &&
    receipt.privateCorpusRevision === input.privateCorpusRevision &&
    receipt.hypothesisId === expressionRef.hypothesisId &&
    receipt.expressionSetReceiptId === expressionRef.expressionSetReceiptId &&
    receipt.expressionId === expressionRef.expression.expressionId &&
    receipt.authoredFingerprint === expressionRef.expression.authoredFingerprint
  );
}

function strictG1TerminalId(receipt: StrictG1ReceiptV1): string {
  return `g1:${receipt.receiptHash.slice(7, 31)}`;
}

function strictG2TerminalId(receipt: StrictG2ReceiptV1): string {
  return `g2:${receipt.receiptHash.slice(7, 31)}`;
}

function collectTerminalExpressions(
  input: StrictProductionAuthorityInputV1
): Map<string, TerminalExpressionAuthorityRow> {
  const expressions = new Map<string, TerminalExpressionAuthorityRow>();
  // 每个版本中的 authored expression 都消耗 attempt/cap；terminalHead 只决定 lineage 终态，
  // 不能让 historical rejected/superseded rows 从资源账和 admission journal 消失。
  for (const expressionSet of input.expressionSets) {
    for (const expression of expressionSet.expressions) {
      const key = `${expressionSet.hypothesisId}\u0000${expressionSet.receiptId}\u0000${expression.expressionId}`;
      if (expressions.has(key)) {
        fail('STRICT_PRODUCTION_CANDIDATE_EXPRESSION_CONSERVATION_FAILED');
      }
      expressions.set(key, {
        hypothesisId: expressionSet.hypothesisId,
        expressionSetReceiptId: expressionSet.receiptId,
        expression,
      });
    }
  }
  return expressions;
}

interface TerminalExpressionAuthorityRow {
  readonly hypothesisId: string;
  readonly expressionSetReceiptId: string;
  readonly expression: HypothesisExpressionSetReceiptV1['expressions'][number];
}

function admissionFateForExpression(
  fate: HypothesisExpressionSetReceiptV1['expressions'][number]['terminalFate']
): 'accepted' | 'rejected' | 'revise' {
  if (fate === 'content-ready') {
    return 'accepted';
  }
  if (fate === 'repair-superseded' || fate === 'failed' || fate === 'unknown') {
    return 'revise';
  }
  return 'rejected';
}

function assertCanonicalHash<T extends object, K extends keyof T>(
  value: T,
  hashKey: K,
  code: string
): void {
  const semantic = { ...value } as Record<string, unknown>;
  const key = String(hashKey);
  const hash = semantic[key];
  delete semantic[key];
  if (typeof hash !== 'string' || hashCanonicalJson(semantic) !== hash) {
    fail(code);
  }
}

function validateResourceCaps(input: {
  readonly candidateAttemptCap: number;
  readonly maxAuthoredCandidatesPerCellPass: number;
}) {
  if (
    !Number.isSafeInteger(input.candidateAttemptCap) ||
    input.candidateAttemptCap < 0 ||
    !Number.isSafeInteger(input.maxAuthoredCandidatesPerCellPass) ||
    input.maxAuthoredCandidatesPerCellPass < 0
  ) {
    fail('STRICT_PRODUCTION_RESOURCE_CAP_INVALID');
  }
  return { ...input };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sameUniqueStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
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

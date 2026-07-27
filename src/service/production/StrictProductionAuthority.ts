import { hashCanonicalJson } from '../project-context/foundation/canonical.js';
import {
  type CandidateAttemptBatchV1,
  canonicalizeCandidateAttemptBatchV1,
  type SerialAdmissionLedgerV1,
  validateSerialAdmissionLedgerV1,
} from './ProductionPersistenceContracts.js';
import {
  type AnalysisFixpointReceiptV1,
  assertKnowledgeDispositionReviewV1,
  canonicalizeObservationPopulationV1,
  createAnalysisReviewContextHashV1,
  type FalsificationReceiptV1,
  type HypothesisExpressionSetReceiptV1,
  type InductionReceiptV1,
  type KnowledgeClusterSetV1,
  type KnowledgeDispositionReviewV1,
  type ObservationPopulationV1,
  validateFactRecordGraphV1,
} from './StrictAnalysisContracts.js';
import {
  assertCodeFactGenerationManifestV1,
  assertFactQueryExecutionReceiptV1,
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
  readonly falsificationReceiptHashes: readonly string[];
  readonly dispositionReviewReceiptHashes: readonly string[];
  readonly expressionSetReceiptHashes: readonly string[];
  readonly candidateAttemptBatchHashes: readonly string[];
  readonly serialAdmissionLedgerHash: string | null;
  readonly resourceConservation: StrictProductionResourceConservationV1;
  readonly authorityHash: string;
}

export interface StrictProductionAuthorityInputV1 {
  readonly runId: string;
  readonly sourceRevisionVectorHash: string;
  readonly analysisFixpoint: AnalysisFixpointReceiptV1;
  readonly privateCorpusRevision: string;
  readonly factExecution: StrictFactScheduleExecutionResultV1;
  readonly populations: readonly ObservationPopulationV1[];
  readonly clusterSets: readonly KnowledgeClusterSetV1[];
  readonly inductions: readonly InductionReceiptV1[];
  readonly falsifications: readonly FalsificationReceiptV1[];
  readonly dispositionReviews: readonly KnowledgeDispositionReviewV1[];
  readonly expressionSets: readonly HypothesisExpressionSetReceiptV1[];
  readonly candidateAttemptBatches: readonly CandidateAttemptBatchV1[];
  readonly serialAdmissionLedger: SerialAdmissionLedgerV1 | null;
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

  const factIndex = validateFactExecution(input);
  const populationHashes = validatePopulations(input, factIndex);
  const clusterSetHashes = validateClusters(input, populationHashes, factIndex.factsById);
  const reviewById = validateDispositionReviews(input, factIndex.receiptsByHash);
  validateClusterDispositionReviews(input.clusterSets, reviewById);
  validateAnalysisEvidence(input, reviewById, factIndex.receiptsByHash);
  validateExpressionClosure(input, reviewById);
  validateFixpoint(input, populationHashes, clusterSetHashes);
  const { serialAdmissionLedgerHash, resourceConservation } =
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
    falsificationReceiptHashes: input.falsifications.map((receipt) => receipt.receiptHash).sort(),
    dispositionReviewReceiptHashes: [...reviewById.values()]
      .map((review) => review.receiptHash)
      .sort(),
    expressionSetReceiptHashes: input.expressionSets.map((receipt) => receipt.receiptHash).sort(),
    candidateAttemptBatchHashes: input.candidateAttemptBatches
      .map((batch) => batch.batchHash)
      .sort(),
    serialAdmissionLedgerHash,
    resourceConservation,
  };
  return Object.freeze({ ...semantic, authorityHash: hashCanonicalJson(semantic) });
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
  if (
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
  factsById: ReadonlySet<string>
): Set<string> {
  const clusterSetHashes = new Set<string>();
  for (const clusterSet of input.clusterSets) {
    assertCanonicalHash(clusterSet, 'clusterSetHash', 'STRICT_PRODUCTION_CLUSTER_HASH_MISMATCH');
    if (
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

function validateDispositionReviews(
  input: StrictProductionAuthorityInputV1,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): Map<string, KnowledgeDispositionReviewV1> {
  const reviewById = new Map<string, KnowledgeDispositionReviewV1>();
  for (const review of input.dispositionReviews) {
    assertKnowledgeDispositionReviewV1(review);
    const expectedReviewContextHash =
      review.reviewKind === 'producer-non-draft' || review.reviewKind === 'investigated-empty'
        ? input.analysisFixpoint.fixpointHash
        : input.analysisFixpoint.analysisReviewContextHash;
    if (
      review.currentAnalysisFixpointHash !== expectedReviewContextHash ||
      review.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
      review.producer.runId !== input.runId ||
      review.reviewer.runId !== input.runId ||
      review.executionReceiptHashes.some((receiptHash, index) => {
        const executionReceipt = receiptsByHash.get(receiptHash);
        return (
          !executionReceipt || executionReceipt.outputHash !== review.executionOutputHashes[index]
        );
      }) ||
      reviewById.has(review.reviewReceiptId)
    ) {
      fail('STRICT_PRODUCTION_DISPOSITION_REVIEW_LINEAGE_MISMATCH');
    }
    reviewById.set(review.reviewReceiptId, review);
  }
  return reviewById;
}

function validateClusterDispositionReviews(
  clusterSets: readonly KnowledgeClusterSetV1[],
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): void {
  for (const clusterSet of clusterSets) {
    for (const disposition of clusterSet.dispositions) {
      if (
        disposition.status === 'discarded' &&
        (!disposition.reviewerReceiptId ||
          reviewById.get(disposition.reviewerReceiptId)?.reviewKind !== 'cluster-discard')
      ) {
        fail('STRICT_PRODUCTION_CLUSTER_DISPOSITION_REVIEW_MISMATCH');
      }
    }
  }
}

function validateAnalysisEvidence(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>,
  receiptsByHash: ReturnType<typeof validateFactExecution>['receiptsByHash']
): void {
  for (const induction of input.inductions) {
    assertCanonicalHash(induction, 'receiptHash', 'STRICT_PRODUCTION_INDUCTION_HASH_MISMATCH');
    if (
      induction.currentAnalysisFixpointHash !== input.analysisFixpoint.analysisReviewContextHash ||
      (induction.zeroHypothesisReviewReceiptId &&
        reviewById.get(induction.zeroHypothesisReviewReceiptId)?.reviewKind !== 'zero-hypothesis')
    ) {
      fail('STRICT_PRODUCTION_INDUCTION_LINEAGE_MISMATCH');
    }
  }

  for (const falsification of input.falsifications) {
    assertCanonicalHash(
      falsification,
      'receiptHash',
      'STRICT_PRODUCTION_FALSIFICATION_HASH_MISMATCH'
    );
    if (
      falsification.currentAnalysisFixpointHash !==
        input.analysisFixpoint.analysisReviewContextHash ||
      !reviewById.has(falsification.dispositionReviewReceiptId) ||
      falsification.executions.some((execution) => {
        const enrolledReceipt = receiptsByHash.get(execution.executionReceipt.receiptHash);
        return (
          !enrolledReceipt || enrolledReceipt.outputHash !== execution.executionReceipt.outputHash
        );
      })
    ) {
      fail('STRICT_PRODUCTION_FALSIFICATION_LINEAGE_MISMATCH');
    }
  }
}

function validateExpressionClosure(
  input: StrictProductionAuthorityInputV1,
  reviewById: ReadonlyMap<string, KnowledgeDispositionReviewV1>
): void {
  for (const expressionSet of input.expressionSets) {
    assertCanonicalHash(
      expressionSet,
      'receiptHash',
      'STRICT_PRODUCTION_EXPRESSION_SET_HASH_MISMATCH'
    );
    if (
      expressionSet.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
      expressionSet.privateCorpusRevision !== input.privateCorpusRevision ||
      expressionSet.expressions.some(
        (row) => row.dispositionReview && !reviewById.has(row.dispositionReview.reviewReceiptId)
      ) ||
      (expressionSet.zeroDisposition &&
        !reviewById.has(expressionSet.zeroDisposition.dispositionReview.reviewReceiptId))
    ) {
      fail('STRICT_PRODUCTION_EXPRESSION_SET_LINEAGE_MISMATCH');
    }
  }
  const eligibleHypothesisIds = [
    ...new Set(
      input.falsifications
        .filter((receipt) => receipt.verdict === 'survived' || receipt.verdict === 'not-required')
        .map((receipt) => receipt.hypothesisId)
    ),
  ].sort();
  const expressionHypothesisIds = input.expressionSets
    .map((receipt) => receipt.hypothesisId)
    .sort();
  if (
    new Set(expressionHypothesisIds).size !== expressionHypothesisIds.length ||
    !sameStrings(eligibleHypothesisIds, expressionHypothesisIds) ||
    input.expressionSets.some(
      (receipt) => !receipt.terminalHead || receipt.terminalClosure === 'historical'
    )
  ) {
    fail('STRICT_PRODUCTION_EXPRESSION_CLOSURE_MISMATCH');
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
    !sameStrings(
      input.analysisFixpoint.inductionReceiptHashes,
      input.inductions.map((receipt) => receipt.receiptHash)
    ) ||
    !sameStrings(
      input.analysisFixpoint.falsificationReceiptHashes,
      input.falsifications.map((receipt) => receipt.receiptHash)
    )
  ) {
    fail('STRICT_PRODUCTION_FIXPOINT_LINEAGE_MISMATCH');
  }
}

function validateCandidateAndAdmissionConservation(input: StrictProductionAuthorityInputV1): {
  serialAdmissionLedgerHash: string | null;
  resourceConservation: StrictProductionResourceConservationV1;
} {
  const resourceCaps = validateResourceCaps(input.resourceCaps);
  let consumedCandidateAttempts = 0;
  let previousPassOrdinal = -1;
  const candidateBatchHashes = new Set<string>();
  const candidateAttemptHashes = new Set<string>();
  for (const batch of input.candidateAttemptBatches) {
    const rebuilt = canonicalizeCandidateAttemptBatchV1({
      attempts: batch.attempts,
      existingAttemptCount: consumedCandidateAttempts,
      candidateAttemptCap: resourceCaps.candidateAttemptCap,
      maxAuthoredCandidatesPerCellPass: resourceCaps.maxAuthoredCandidatesPerCellPass,
    });
    if (
      rebuilt.batchHash !== batch.batchHash ||
      batch.attempts.some(
        (attempt) =>
          attempt.runId !== input.runId ||
          attempt.analysisFixpointHash !== input.analysisFixpoint.fixpointHash ||
          attempt.privateCorpusRevision !== input.privateCorpusRevision
      )
    ) {
      fail('STRICT_PRODUCTION_CANDIDATE_BATCH_LINEAGE_MISMATCH');
    }
    if (
      batch.passOrdinal <= previousPassOrdinal ||
      candidateBatchHashes.has(batch.batchHash) ||
      batch.attempts.some((attempt) => {
        const attemptHash = hashCanonicalJson(attempt);
        if (candidateAttemptHashes.has(attemptHash)) {
          return true;
        }
        candidateAttemptHashes.add(attemptHash);
        return false;
      })
    ) {
      fail('STRICT_PRODUCTION_CANDIDATE_BATCH_SEQUENCE_INVALID');
    }
    previousPassOrdinal = batch.passOrdinal;
    candidateBatchHashes.add(batch.batchHash);
    consumedCandidateAttempts += batch.attempts.length;
  }
  let serialAdmissionLedgerHash: string | null = null;
  if (input.serialAdmissionLedger) {
    const rebuilt = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: input.serialAdmissionLedger.initialAcceptedCorpusHash,
      rows: input.serialAdmissionLedger.rows,
    });
    if (rebuilt.ledgerHash !== input.serialAdmissionLedger.ledgerHash) {
      fail('STRICT_PRODUCTION_ADMISSION_LEDGER_HASH_MISMATCH');
    }
    serialAdmissionLedgerHash = rebuilt.ledgerHash;
    if (rebuilt.rows.length !== consumedCandidateAttempts) {
      fail('STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED');
    }
  } else if (consumedCandidateAttempts > 0) {
    fail('STRICT_PRODUCTION_ADMISSION_LEDGER_REQUIRED');
  }
  return {
    serialAdmissionLedgerHash,
    resourceConservation: {
      ...resourceCaps,
      consumedCandidateAttempts,
      remainingCandidateAttempts: resourceCaps.candidateAttemptCap - consumedCandidateAttempts,
    },
  };
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

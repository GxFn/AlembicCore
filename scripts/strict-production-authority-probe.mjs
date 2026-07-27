import {
  canonicalizeCandidateAttemptBatchV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createAnalysisReviewContextHashV1,
  createFalsificationReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createKnowledgeDispositionReviewV1,
  createProductionActorIdentityV1,
  createStrictProductionAuthorityReceiptV1,
  validateHypothesisExpressionSetReceiptV1,
  validateSerialAdmissionLedgerV1,
} from '@alembic/core/production';
import { hashCanonicalJson } from '@alembic/core/project-context-foundation';

const hash = (character) => `sha256:${character.repeat(64)}`;
const sourceRevisionVectorHash = hash('1');
const runId = 'run:fresh-process-production-probe';
const privateCorpusRevision = 'revision:fresh-process-production-probe';

function actor(role) {
  const producer = role === 'producer';
  return createProductionActorIdentityV1({
    providerId: 'provider:frozen-probe',
    modelId: 'model:strict-probe',
    modelVersion: '2026-07-27',
    promptHash: hash(producer ? '2' : '3'),
    runId,
    invocationId: `invocation:${role}`,
    loadReceiptHash: hash(producer ? '4' : '5'),
    outputHash: hash(producer ? '6' : '7'),
  });
}

function createExecutionReceipt() {
  const obligationId = 'obligation:fresh-process-no-pattern';
  const denominatorFileIds = [`repo:src/probe.ts@${hash('8')}`];
  const fileSemantic = {
    repoId: 'repo',
    relativePath: 'src/probe.ts',
    blobHash: hash('8'),
    status: 'complete',
    reasonCode: 'COMPLETE',
    truncated: false,
    continuation: null,
    witnessBindingHash: hash('9'),
    evidenceEntryId: 'E-PROBE',
    projectContextRefId: 'file:repo:src/probe.ts',
    stagedFactIds: [],
    discardedFactIds: [],
    emittedFactIds: [],
  };
  const fileExecution = {
    ...fileSemantic,
    executionHash: hashCanonicalJson(fileSemantic),
  };
  const outputSemantic = {
    obligationId,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    fileExecutionHashes: [fileExecution.executionHash],
    derivedFactIds: [],
    emittedFactIds: [],
    disposition: 'inspected-no-pattern',
    truncated: false,
    continuation: null,
  };
  const semantic = {
    schemaVersion: 1,
    obligationId,
    factFamilyId: 'syntax-idiom',
    capabilityId: 'tree-sitter-query',
    canonicalSubjectRef: 'file:repo:src/probe.ts',
    analysisScale: 'file',
    denominator: 'complete-frozen-subject',
    sourceRevisionVectorHash,
    backendProducer: 'loaded:fresh-process-probe',
    backendManifestHash: hash('a'),
    backendLoadReceiptHash: hash('b'),
    queryPackHash: hash('c'),
    harvestKey: hash('d'),
    harvestReceiptHash: hash('e'),
    expectedFileCount: 1,
    inspectedFileCount: 1,
    denominatorFileIds,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    witnessBindingHash: hash('9'),
    fileExecutions: [fileExecution],
    derivedFactIds: [],
    emittedFactIds: [],
    disposition: 'inspected-no-pattern',
    reasonCode: 'COMPLETE_FROZEN_SUBJECT_INSPECTED',
    truncated: false,
    continuation: null,
    outputHash: hashCanonicalJson(outputSemantic),
  };
  const receiptHash = hashCanonicalJson(semantic);
  return {
    ...semantic,
    terminalReceiptId: `fact-execution:${receiptHash.slice(7, 31)}`,
    receiptHash,
  };
}

function createFactExecution(receipt) {
  const terminalReceiptHashes = [receipt.receiptHash];
  const semantic = {
    schemaVersion: 1,
    sourceArtifactId: 'artifact:fresh-process-production-probe',
    sourceRevisionVectorHash,
    factQueryCatalogHash: hash('1'),
    factHarvestScheduleHash: hash('2'),
    backendRegistryHash: hash('3'),
    obligationCount: 1,
    terminalReceiptIds: [receipt.terminalReceiptId],
    terminalReceiptHashes,
    terminalReceiptSetHash: hashCanonicalJson(terminalReceiptHashes),
    harvestReceiptHashes: [receipt.harvestReceiptHash],
    harvestCount: 1,
    denominatorHashes: [receipt.denominatorHash],
    witnessBindingSetHash: hashCanonicalJson([receipt.witnessBindingHash]),
    factIds: [],
    factCount: 0,
    unexecutableCatalogFamilyIds: [],
    unregisteredBackendFamilyIds: [],
    failedObligationIds: [],
    unknownObligationIds: [],
    verdict: 'passed',
  };
  return {
    facts: [],
    receipts: [receipt],
    manifest: { ...semantic, manifestHash: hashCanonicalJson(semantic) },
  };
}

const executionReceipt = createExecutionReceipt();
const factExecution = createFactExecution(executionReceipt);
const population = canonicalizeObservationPopulationV1({
  populationId: 'population:fresh-process-production-probe',
  revision: 1,
  parentPopulationHash: null,
  sourceRevisionVectorHash,
  denominator: {
    kind: 'frozen-complete-subjects',
    expectedObservationIds: ['observation:fresh-process-no-pattern'],
    expectedObligationIds: [executionReceipt.obligationId],
    executionReceiptHashes: [executionReceipt.receiptHash],
    outputHashes: [executionReceipt.outputHash],
    denominatorHashes: [executionReceipt.denominatorHash],
    complete: true,
    truncated: false,
    continuation: null,
    omittedObservationIds: [],
  },
  executionReceipts: [executionReceipt],
  observations: [],
  duplicateObservations: [],
  excludedObservations: [],
  errorObservations: [],
  inspectedNoPatternObservations: [
    {
      observationId: 'observation:fresh-process-no-pattern',
      obligationId: executionReceipt.obligationId,
      canonicalSubjectRef: executionReceipt.canonicalSubjectRef,
      parentSubjectRefs: ['repo:repo'],
      executionReceiptHash: executionReceipt.receiptHash,
      outputHash: executionReceipt.outputHash,
      denominatorHash: executionReceipt.denominatorHash,
    },
  ],
});
const clusterSet = canonicalizeKnowledgeClustersV1(population, {
  clusters: [],
  nonClusteredDispositions: [],
});
const finalSchedule = createFinalExpandedMiningScheduleReceiptV1({
  baselineScheduleHash: hash('f'),
  baselineObligationIds: [executionReceipt.obligationId],
  expansionReceipts: [],
});
const terminalObligations = [
  {
    obligationId: executionReceipt.obligationId,
    disposition: 'inspected-no-pattern',
    terminalReceiptId: executionReceipt.terminalReceiptId,
  },
];
const analysisReviewContextHash = createAnalysisReviewContextHashV1({
  finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
  terminalObligations,
  populationHashes: [population.populationHash],
  clusterSetHashes: [clusterSet.clusterSetHash],
});
const falsificationReview = createKnowledgeDispositionReviewV1({
  reviewKind: 'falsification',
  currentAnalysisFixpointHash: analysisReviewContextHash,
  populationHash: population.populationHash,
  proposedDispositionHash: hash('a'),
  executionReceipts: [executionReceipt],
  producer: actor('producer'),
  reviewer: actor('reviewer'),
  calibrationReceiptHash: hash('b'),
  verdict: 'pass',
  reasonCode: 'bounded-contract-needs-no-counterquery',
});
const falsification = createFalsificationReceiptV1({
  hypothesisId: 'hypothesis:fresh-process-production-probe',
  enrolledCounterqueryIds: [],
  executions: [],
  counterqueryApplicability: {
    status: 'not-required',
    reasonCode: 'exact-bounded-contract',
    reviewerReceiptId: falsificationReview.reviewReceiptId,
  },
  currentAnalysisFixpointHash: analysisReviewContextHash,
  dispositionReview: falsificationReview,
});
const analysisFixpoint = createAnalysisFixpointReceiptV1({
  finalExpandedSchedule: finalSchedule,
  terminalObligations,
  populationHashes: [population.populationHash],
  clusterSets: [clusterSet],
  inductionReceiptHashes: [],
  falsificationReceiptHashes: [falsification.receiptHash],
});
const producerReview = createKnowledgeDispositionReviewV1({
  reviewKind: 'producer-non-draft',
  currentAnalysisFixpointHash: analysisFixpoint.fixpointHash,
  populationHash: population.populationHash,
  proposedDispositionHash: hash('c'),
  executionReceipts: [executionReceipt],
  producer: actor('producer'),
  reviewer: actor('reviewer'),
  calibrationReceiptHash: hash('d'),
  verdict: 'pass',
  reasonCode: 'reviewed-non-draft',
});
const expressionSet = validateHypothesisExpressionSetReceiptV1({
  schemaVersion: 1,
  receiptId: 'expression-set:fresh-process-production-probe',
  hypothesisId: falsification.hypothesisId,
  analysisFixpointHash: analysisFixpoint.fixpointHash,
  privateCorpusRevision,
  version: 1,
  parentReceiptId: null,
  terminalHead: true,
  expressions: [],
  zeroDisposition: {
    reasonCode: 'reviewed-non-draft',
    reviewerReceiptId: producerReview.reviewReceiptId,
    dispositionReview: producerReview,
    terminalFate: 'reviewed-non-draft',
  },
});
const candidateBatch = canonicalizeCandidateAttemptBatchV1({
  existingAttemptCount: 0,
  candidateAttemptCap: 2,
  maxAuthoredCandidatesPerCellPass: 1,
  attempts: [
    {
      runId,
      analysisFixpointHash: analysisFixpoint.fixpointHash,
      privateCorpusRevision,
      cellId: 'core::architecture',
      criticality: 'critical',
      passOrdinal: 0,
      authoredFingerprint: hash('e'),
      causalParentIds: [],
    },
  ],
});
const admissionLedger = validateSerialAdmissionLedgerV1({
  initialAcceptedCorpusHash: hash('f'),
  rows: [
    {
      proposalId: 'proposal:fresh-process-production-probe',
      observedAcceptedCorpusHash: hash('f'),
      terminalFate: 'rejected',
      resultingAcceptedCorpusHash: hash('f'),
      terminalReceiptId: 'admission:fresh-process-production-probe',
    },
  ],
});
const authorityInput = {
  runId,
  sourceRevisionVectorHash,
  analysisFixpoint,
  privateCorpusRevision,
  factExecution,
  populations: [population],
  clusterSets: [clusterSet],
  inductions: [],
  falsifications: [falsification],
  dispositionReviews: [falsificationReview, producerReview],
  expressionSets: [expressionSet],
  candidateAttemptBatches: [candidateBatch],
  serialAdmissionLedger: admissionLedger,
  resourceCaps: {
    candidateAttemptCap: 2,
    maxAuthoredCandidatesPerCellPass: 1,
  },
};
const authority = createStrictProductionAuthorityReceiptV1(authorityInput);

let faultCode = null;
try {
  createStrictProductionAuthorityReceiptV1({
    ...authorityInput,
    factExecution: {
      ...factExecution,
      receipts: [{ ...executionReceipt, outputHash: hash('0') }],
    },
  });
} catch (error) {
  faultCode = error instanceof Error ? error.message : String(error);
}
if (faultCode !== 'STRICT_FACT_GENERATION_MANIFEST_INVALID') {
  throw new Error(`STRICT_PRODUCTION_FAULT_PROBE_FAILED:${faultCode ?? 'no-error'}`);
}

const report = {
  schemaVersion: 1,
  probe: 'strict-production-authority-fresh-process',
  contractVersion: authority.contractVersion,
  authorityHash: authority.authorityHash,
  analysisReviewContextHash,
  publicSubpaths: ['@alembic/core/production', '@alembic/core/project-context-foundation'],
  resourceConservation: authority.resourceConservation,
  fault: {
    mutation: 'fact-execution-output-hash',
    rejected: true,
    code: faultCode,
  },
};
process.stdout.write(
  `${JSON.stringify({ ...report, reportHash: hashCanonicalJson(report) }, null, 2)}\n`
);

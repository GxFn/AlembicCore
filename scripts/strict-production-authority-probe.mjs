import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildFactQueryCatalogSnapshot,
  canonicalizeCandidateAttemptBatchV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createAnalysisReviewContextHashV1,
  createConfigFactQueryBackendV1,
  createConfigFactQueryFamilyV1,
  createFalsificationReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInductionReceiptV1,
  createKnowledgeDispositionReviewV1,
  createProductionActorIdentityV1,
  createStrictAcceptedCorpusInspectionV1,
  createStrictAdmissionReceiptV1,
  createStrictEvidenceLedgerSnapshotV1,
  createStrictFactBackendRegistryV1,
  createStrictFactDirectWitnessBindingV1,
  createStrictFactSubjectBindingV1,
  createStrictFactWitnessAuthorityV1,
  createStrictG1ReceiptV1,
  createStrictG2ReceiptV1,
  createStrictProductionAuthorityReceiptV1,
  executeStrictFactScheduleV1,
  hashKnowledgeClusterV1,
  hashKnowledgeDispositionProposalV1,
  STRICT_G1_HARD_AXES_V1,
  STRICT_G2_HARD_AXES_V1,
  validateHypothesisExpressionSetReceiptV1,
  validateSerialAdmissionLedgerV1,
} from '@alembic/core/production';
import {
  buildProjectContextRequestMatrixV2,
  buildProjectScopeManifestV1,
  captureCertifiedProjectFactsV2,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  createProjectContextFileRef,
  createProjectContextRequestAuditPlansV2,
  hashBytes,
  hashCanonicalJson,
  readCertifiedProjectFactsFrozenFile,
} from '@alembic/core/project-context-foundation';

const runId = 'run:fresh-process-production-probe';
const privateCorpusRevision = 'revision:fresh-process-production-probe';
const controlRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-strict-authority-probe-'))
);

try {
  await runProbe(controlRoot);
} finally {
  fs.rmSync(controlRoot, { force: true, recursive: true });
}

async function runProbe(root) {
  const real = await createRealExecutorFixture(root);
  const analysis = createAnalysisFixture(real);
  const falsification = createFalsificationFixture(real, analysis);
  const candidate = createCandidateAuthorityFixture(real, analysis, falsification);
  const failed = await createFailedReviewFixture(real, analysis, falsification);
  const coreFaults = await runCoreAuthorityFaults(
    analysis,
    falsification,
    candidate,
    failed
  );
  const orphanReview = createOrphanReviewFixture(real, analysis);
  const ledgerFaults = await runLedgerAuthorityFaults(
    falsification,
    candidate,
    orphanReview
  );
  const scheduleFaults = await runScheduleAuthorityFaults(
    real,
    analysis,
    candidate
  );
  writeProbeReport({
    real,
    analysis,
    falsification,
    candidate,
    faults: [...coreFaults, ...ledgerFaults, ...scheduleFaults],
  });
}

async function createRealExecutorFixture(root) {
  const artifact = await createStrictArtifact(root);
  const planningFacts = createPlanningFacts(artifact);
  const family = createConfigFactQueryFamilyV1({
    familyId: 'config-declaration',
    supportedScales: ['file'],
    parser: 'nx-project-json',
  });
  const catalog = buildFactQueryCatalogSnapshot([family]);
  const subjectBinding = createStrictFactSubjectBindingV1({
    artifact,
    planningFacts,
    selector: { kind: 'repository', repoId: 'core' },
  });
  const witness = createWitnessMaterial(artifact);
  const registry = createStrictFactBackendRegistryV1([
    createConfigFactQueryBackendV1({ family, parser: 'nx-project-json' }),
  ]);
  const schedule = createSchedule(family, subjectBinding.canonicalSubjectRef);
  const executorInput = {
    artifact,
    planningFacts,
    catalog,
    schedule,
    subjectBindings: [subjectBinding],
    witnessBindings: witness.bindings,
    witnessAuthority: witness.authority,
    registry,
  };
  const factExecution = await executeStrictFactScheduleV1(executorInput);
  const executionReceipt = factExecution.receipts[0];
  if (
    factExecution.manifest.verdict !== 'passed' ||
    factExecution.facts.length === 0 ||
    !executionReceipt ||
    executionReceipt.disposition !== 'matched' ||
    executionReceipt.expectedFileCount !== 1 ||
    executionReceipt.inspectedFileCount !== 1
  ) {
    throw new Error('STRICT_PRODUCTION_REAL_EXECUTOR_POSITIVE_FAILED');
  }
  return {
    artifact,
    planningFacts,
    family,
    catalog,
    subjectBinding,
    witness,
    registry,
    schedule,
    executorInput,
    factExecution,
    executionReceipt,
  };
}

function createAnalysisFixture(real) {
  const { artifact, factExecution, executionReceipt, schedule } = real;
  const sourceRevisionVectorHash = artifact.sourceVectorHash;
  const observationId = 'observation:fresh-process-config';
  const population = canonicalizeObservationPopulationV1({
    populationId: 'population:fresh-process-production-probe',
    revision: 1,
    parentPopulationHash: null,
    sourceRevisionVectorHash,
    denominator: {
      kind: 'frozen-complete-subjects',
      expectedObservationIds: [observationId],
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
    observations: [
      {
        observationId,
        factIds: factExecution.facts.map((fact) => fact.factId),
        obligationIds: [executionReceipt.obligationId],
        canonicalSubjectRefs: [executionReceipt.canonicalSubjectRef],
        parentSubjectRefs: ['repo:core'],
        variantKeys: ['nx-project-json'],
        outlierReasonCodes: [],
        negativeControl: false,
      },
    ],
    duplicateObservations: [],
    excludedObservations: [],
    errorObservations: [],
    inspectedNoPatternObservations: [],
  });
  const clusterSet = canonicalizeKnowledgeClustersV1(population, {
    clusters: [
      {
        mechanismKey: 'mechanism:strict-config-declaration',
        mechanism: {
          backend: 'strict-config-fact-backend-v1',
          invariant: 'frozen config declarations are parser-derived',
        },
        observationIds: [observationId],
        mechanismEvidenceFactIds: factExecution.facts.map((fact) => fact.factId),
        anatomyLensIds: ['entrypoint-and-contract'],
      },
    ],
    nonClusteredDispositions: [],
  });
  const cluster = clusterSet.clusters[0];
  if (!cluster) {
    throw new Error('STRICT_PRODUCTION_REAL_CLUSTER_MISSING');
  }
  const finalSchedule = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: schedule.baselineScheduleHash,
    baselineObligationIds: [executionReceipt.obligationId],
    expansionReceipts: [],
  });
  const terminalObligations = [
    {
      obligationId: executionReceipt.obligationId,
      disposition: executionReceipt.disposition,
      terminalReceiptId: executionReceipt.terminalReceiptId,
    },
  ];
  const analysisReviewContextHash = createAnalysisReviewContextHashV1({
    finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
    terminalObligations,
    populationHashes: [population.populationHash],
    clusterSetHashes: [clusterSet.clusterSetHash],
  });
  const hypothesisId = 'hypothesis:fresh-process-production-probe';
  const induction = createInductionReceiptV1({
    populationHash: population.populationHash,
    clusterHash: hashKnowledgeClusterV1(cluster),
    clusterId: cluster.clusterId,
    observationIds: cluster.observationIds,
    mode: 'bounded-singleton',
    hypotheses: [
      {
        hypothesisId,
        statement: 'The frozen config parser produces a deterministic declaration fact.',
        premiseFactIds: factExecution.facts.map((fact) => fact.factId),
      },
    ],
    currentAnalysisFixpointHash: analysisReviewContextHash,
  });
  return {
    sourceRevisionVectorHash,
    observationId,
    population,
    clusterSet,
    cluster,
    finalSchedule,
    terminalObligations,
    analysisReviewContextHash,
    hypothesisId,
    induction,
  };
}

function createFalsificationFixture(real, analysis) {
  const { catalog, registry, family, factExecution, executionReceipt } = real;
  const {
    population,
    finalSchedule,
    terminalObligations,
    analysisReviewContextHash,
    hypothesisId,
    induction,
    clusterSet,
  } = analysis;
  const falsificationProposalHash = hashKnowledgeDispositionProposalV1({
    reviewKind: 'falsification',
    populationHash: population.populationHash,
    hypothesisId,
    enrolledCounterqueryIds: [],
    executions: [],
    counterqueryApplicability: {
      status: 'not-required',
      reasonCode: 'single-frozen-config-contract',
    },
  });
  const falsificationCalibrationReceiptHash = hashCanonicalJson({
    catalogHash: catalog.catalogHash,
    registryHash: registry.registryHash,
  });
  const falsificationReviewReasonCode = 'real-executor-evidence-reviewed';
  const falsificationActors = createActors(
    family,
    factExecution.manifest.manifestHash,
    falsificationProposalHash,
    {
      reviewKind: 'falsification',
      executionReceipts: [executionReceipt],
      calibrationReceiptHash: falsificationCalibrationReceiptHash,
      verdict: 'pass',
      reasonCode: falsificationReviewReasonCode,
    }
  );
  const falsificationReview = createKnowledgeDispositionReviewV1({
    reviewKind: 'falsification',
    currentAnalysisFixpointHash: analysisReviewContextHash,
    populationHash: population.populationHash,
    proposedDispositionHash: falsificationProposalHash,
    executionReceipts: [executionReceipt],
    finalExpandedSchedule: finalSchedule,
    terminalObligations,
    producer: falsificationActors.producer,
    reviewer: falsificationActors.reviewer,
    calibrationReceiptHash: falsificationCalibrationReceiptHash,
    verdict: 'pass',
    reasonCode: falsificationReviewReasonCode,
  });
  const falsification = createFalsificationReceiptV1({
    hypothesisId,
    enrolledCounterqueryIds: [],
    executions: [],
    counterqueryApplicability: {
      status: 'not-required',
      reasonCode: 'single-frozen-config-contract',
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
    inductionReceiptHashes: [induction.receiptHash],
    falsificationReceiptHashes: [falsification.receiptHash],
  });
  return {
    falsificationProposalHash,
    falsificationCalibrationReceiptHash,
    falsificationReviewReasonCode,
    falsificationActors,
    falsificationReview,
    falsification,
    analysisFixpoint,
  };
}

function createCandidateAuthorityFixture(real, analysis, falsificationFixture) {
  const { factExecution, schedule } = real;
  const {
    sourceRevisionVectorHash,
    population,
    clusterSet,
    finalSchedule,
    hypothesisId,
    induction,
  } = analysis;
  const {
    falsificationReview,
    falsification,
    analysisFixpoint,
  } = falsificationFixture;
  const authoredFingerprint = hashCanonicalJson({
    hypothesisId,
    factIds: factExecution.facts.map((fact) => fact.factId),
    value: factExecution.facts.map((fact) => fact.value),
  });
  const contentReadyTerminal = createContentReadyTerminalEvidence({
    analysisFixpointHash: analysisFixpoint.fixpointHash,
    authoredFingerprint,
  });
  const expressionSet = validateHypothesisExpressionSetReceiptV1({
    schemaVersion: 1,
    receiptId: 'expression-set:fresh-process-production-probe',
    hypothesisId,
    analysisFixpointHash: analysisFixpoint.fixpointHash,
    privateCorpusRevision,
    version: 1,
    parentReceiptId: null,
    terminalHead: true,
    expressions: [
      {
        expressionId: 'expression:fresh-process-production-probe',
        authoredFingerprint,
        terminalFate: 'content-ready',
        terminalReceiptId: contentReadyTerminal.terminalReceiptId,
        terminalReceiptHash: contentReadyTerminal.terminalReceiptHash,
      },
    ],
    zeroDisposition: null,
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
        hypothesisId,
        expressionSetReceiptId: expressionSet.receiptId,
        expressionId: expressionSet.expressions[0].expressionId,
        terminalReceiptId: expressionSet.expressions[0].terminalReceiptId,
        terminalReceiptHash: expressionSet.expressions[0].terminalReceiptHash,
        cellId: 'core::architecture',
        criticality: 'critical',
        passOrdinal: 0,
        authoredFingerprint,
        causalParentIds: [],
      },
    ],
  });
  const attempt = candidateBatch.attempts[0];
  const admissionLedger = validateSerialAdmissionLedgerV1({
    initialAcceptedCorpusHash: hashCanonicalJson([]),
    rows: [
      {
        proposalId: attempt.attemptId,
        attemptHash: attempt.attemptHash,
        authoredFingerprint: attempt.authoredFingerprint,
        observedAcceptedCorpusHash: hashCanonicalJson([]),
        terminalFate: 'accepted',
        resultingAcceptedCorpusHash: hashCanonicalJson([attempt.authoredFingerprint]),
        terminalReceiptId: expressionSet.expressions[0].terminalReceiptId,
        terminalReceiptHash: expressionSet.expressions[0].terminalReceiptHash,
      },
    ],
  });
  const authorityInput = {
    runId,
    sourceRevisionVectorHash,
    analysisFixpoint,
    privateCorpusRevision,
    factExecution,
    baselineSchedule: schedule,
    scheduleExpansionReceipts: [],
    finalExpandedSchedule: finalSchedule,
    finalFactSchedule: schedule,
    populations: [population],
    clusterSets: [clusterSet],
    inductions: [induction],
    falsifications: [falsification],
    dispositionReviews: [falsificationReview],
    expressionSets: [expressionSet],
    candidateAttemptBatches: [candidateBatch],
    serialAdmissionLedger: admissionLedger,
    terminalEvidence: contentReadyTerminal.terminalEvidence,
    resourceCaps: {
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
    },
  };
  const authority = createStrictProductionAuthorityReceiptV1(authorityInput);
  return {
    authoredFingerprint,
    contentReadyTerminal,
    expressionSet,
    candidateBatch,
    attempt,
    admissionLedger,
    authorityInput,
    authority,
  };
}

async function createFailedReviewFixture(real, analysis, falsificationFixture) {
  const { executorInput, family } = real;
  const { population, finalSchedule, hypothesisId } = analysis;
  const { analysisFixpoint } = falsificationFixture;
  const failedFactExecution = await executeStrictFactScheduleV1({
    ...executorInput,
    subjectBindings: [],
  });
  const failedReceipt = failedFactExecution.receipts[0];
  if (!failedReceipt || failedReceipt.disposition !== 'failed') {
    throw new Error('STRICT_PRODUCTION_REAL_EXECUTOR_NEGATIVE_FAILED');
  }
  const failedProposalHash = hashKnowledgeDispositionProposalV1({
    reviewKind: 'producer-non-draft',
    populationHash: population.populationHash,
    hypothesisId,
    expression: null,
    zeroDisposition: {
      reasonCode: 'failed-execution-must-not-authorize',
      terminalFate: 'reviewed-non-draft',
    },
  });
  const failedCalibrationReceiptHash = hashCanonicalJson({
    failedManifestHash: failedFactExecution.manifest.manifestHash,
  });
  const failedReviewReasonCode = 'must-not-authorize';
  const failedActors = createActors(
    family,
    failedFactExecution.manifest.manifestHash,
    failedProposalHash,
    {
      reviewKind: 'producer-non-draft',
      executionReceipts: [failedReceipt],
      calibrationReceiptHash: failedCalibrationReceiptHash,
      verdict: 'pass',
      reasonCode: failedReviewReasonCode,
    }
  );
  return {
    failedFactExecution,
    failedReceipt,
    failedProposalHash,
    failedCalibrationReceiptHash,
    failedReviewReasonCode,
    failedActors,
  };
}

async function runCoreAuthorityFaults(
  analysis,
  falsificationFixture,
  candidate,
  failed
) {
  const {
    population,
    finalSchedule,
    terminalObligations,
    analysisReviewContextHash,
    hypothesisId,
  } = analysis;
  const { analysisFixpoint, falsificationReview } = falsificationFixture;
  const { authorityInput } = candidate;
  const {
    failedReceipt,
    failedProposalHash,
    failedCalibrationReceiptHash,
    failedReviewReasonCode,
    failedActors,
  } = failed;
  const faults = [];
  faults.push(
    await faultCard(
      'empty-failed-pass-review',
      'knowledge-disposition-review',
      'KNOWLEDGE_DISPOSITION_EXECUTION_NONTERMINAL',
      () =>
        createKnowledgeDispositionReviewV1({
          reviewKind: 'producer-non-draft',
          currentAnalysisFixpointHash: analysisFixpoint.fixpointHash,
          populationHash: population.populationHash,
          proposedDispositionHash: failedProposalHash,
          executionReceipts: [failedReceipt],
          finalExpandedSchedule: finalSchedule,
          terminalObligations: [
            {
              obligationId: failedReceipt.obligationId,
              disposition: failedReceipt.disposition,
              terminalReceiptId: failedReceipt.terminalReceiptId,
            },
          ],
          producer: failedActors.producer,
          reviewer: failedActors.reviewer,
          calibrationReceiptHash: failedCalibrationReceiptHash,
          verdict: 'pass',
          reasonCode: failedReviewReasonCode,
        })
    )
  );
  faults.push(
    await faultCard(
      'review-proposal-rebind',
      'falsification-consumer',
      'FALSIFICATION_REVIEW_DISPOSITION_MISMATCH',
      () =>
        createFalsificationReceiptV1({
          hypothesisId: 'hypothesis:unrelated',
          enrolledCounterqueryIds: [],
          executions: [],
          counterqueryApplicability: {
            status: 'not-required',
            reasonCode: 'single-frozen-config-contract',
            reviewerReceiptId: falsificationReview.reviewReceiptId,
          },
          currentAnalysisFixpointHash: analysisReviewContextHash,
          dispositionReview: falsificationReview,
        })
    )
  );
  faults.push(
    await faultCard(
      'missing-induction-chain',
      'strict-production-authority',
      'STRICT_PRODUCTION_CLUSTER_INDUCTION_CONSERVATION_FAILED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          inductions: [],
        })
    )
  );
  faults.push(
    await faultCard(
      'orphan-hypothesis',
      'strict-production-authority',
      'STRICT_PRODUCTION_HYPOTHESIS_INDUCTION_CONSERVATION_FAILED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          falsifications: [],
          dispositionReviews: [],
          expressionSets: [],
          candidateAttemptBatches: [],
          serialAdmissionLedger: null,
      })
    )
  );
  return faults;
}

function createOrphanReviewFixture(real, analysis) {
  const { family, factExecution, executionReceipt } = real;
  const {
    population,
    clusterSet,
    cluster,
    analysisReviewContextHash,
    finalSchedule,
    terminalObligations,
  } = analysis;
  const orphanProposalHash = hashKnowledgeDispositionProposalV1({
    reviewKind: 'semantic-merge',
    populationHash: population.populationHash,
    sourceClusterSetHash: clusterSet.clusterSetHash,
    targetClusterSetHash: clusterSet.clusterSetHash,
    sourceClusterIds: [cluster.clusterId],
    targetClusterIds: [cluster.clusterId],
    observationIds: cluster.observationIds,
    reasonCode: 'orphan-review-must-fail',
  });
  const orphanCalibrationReceiptHash = hashCanonicalJson({ orphanProposalHash });
  const orphanReviewReasonCode = 'orphan-review-must-fail';
  const orphanActors = createActors(
    family,
    factExecution.manifest.manifestHash,
    orphanProposalHash,
    {
      reviewKind: 'semantic-merge',
      executionReceipts: [executionReceipt],
      calibrationReceiptHash: orphanCalibrationReceiptHash,
      verdict: 'pass',
      reasonCode: orphanReviewReasonCode,
    }
  );
  const orphanReview = createKnowledgeDispositionReviewV1({
    reviewKind: 'semantic-merge',
    currentAnalysisFixpointHash: analysisReviewContextHash,
    populationHash: population.populationHash,
    proposedDispositionHash: orphanProposalHash,
    executionReceipts: [executionReceipt],
    finalExpandedSchedule: finalSchedule,
    terminalObligations,
    producer: orphanActors.producer,
    reviewer: orphanActors.reviewer,
    calibrationReceiptHash: orphanCalibrationReceiptHash,
    verdict: 'pass',
    reasonCode: orphanReviewReasonCode,
  });
  return orphanReview;
}

async function runLedgerAuthorityFaults(
  falsificationFixture,
  candidate,
  orphanReview
) {
  const { falsificationReview } = falsificationFixture;
  const { authorityInput, admissionLedger } = candidate;
  const faults = [];
  faults.push(
    await faultCard(
      'orphan-review',
      'strict-production-authority',
      'STRICT_PRODUCTION_DISPOSITION_REVIEW_ORPHANED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          dispositionReviews: [falsificationReview, orphanReview],
        })
    )
  );
  const reboundAdmissionLedger = validateSerialAdmissionLedgerV1({
    initialAcceptedCorpusHash: admissionLedger.initialAcceptedCorpusHash,
    rows: [
      {
        ...admissionLedger.rows[0],
        proposalId: 'candidate-attempt:unrelated',
      },
    ],
  });
  faults.push(
    await faultCard(
      'attempt-admission-rebind',
      'strict-production-authority',
      'STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          serialAdmissionLedger: reboundAdmissionLedger,
        })
    )
  );
  const reboundTerminalLedger = validateSerialAdmissionLedgerV1({
    initialAcceptedCorpusHash: admissionLedger.initialAcceptedCorpusHash,
    rows: [
      {
        ...admissionLedger.rows[0],
        terminalReceiptHash: hashCanonicalJson({
          unrelatedTerminalReceiptHash: admissionLedger.rows[0].terminalReceiptHash,
        }),
      },
    ],
  });
  faults.push(
    await faultCard(
      'attempt-terminal-receipt-rebind',
      'strict-production-authority',
      'STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          serialAdmissionLedger: reboundTerminalLedger,
      })
    )
  );
  faults.push(
    await faultCard(
      'terminal-evidence-registry-omitted',
      'strict-production-authority',
      'STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          terminalEvidence: {
            g1Receipts: [],
            g1TerminalBindings: [],
            corpusInspections: [],
            admissionReceipts: [],
            g2Receipts: [],
            gateReturns: [],
          },
      })
    )
  );
  const staleCorpusHash = hashCanonicalJson({
    kind: 'stale-private-corpus',
    privateCorpusRevision,
  });
  const staleCorpusLedger = validateSerialAdmissionLedgerV1({
    initialAcceptedCorpusHash: staleCorpusHash,
    rows: [
      {
        ...admissionLedger.rows[0],
        observedAcceptedCorpusHash: staleCorpusHash,
      },
    ],
  });
  faults.push(
    await faultCard(
      'admission-ledger-corpus-rebind',
      'strict-production-authority',
      'STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          serialAdmissionLedger: staleCorpusLedger,
      })
    )
  );
  return faults;
}

async function runScheduleAuthorityFaults(real, analysis, candidate) {
  const { family, schedule, factExecution, executionReceipt } = real;
  const { authorityInput } = candidate;
  const faults = [];
  const reboundLensBindings = [
    {
      bindingId: 'lens-binding:unrelated',
      cellId: 'core::unrelated',
      anatomyLensId: 'entrypoint-and-contract',
      questionIds: ['question:unrelated'],
      factFamilyIds: [family.id],
      counterqueryRequired: false,
    },
  ];
  const reboundLensBindingsHash = hashCanonicalJson(reboundLensBindings);
  const reboundSchedule = {
    ...schedule,
    lensBindings: reboundLensBindings,
    lensBindingsHash: reboundLensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({
      factHarvestScheduleHash: schedule.factHarvestScheduleHash,
      lensBindingsHash: reboundLensBindingsHash,
    }),
  };
  const reboundFinalSchedule = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: reboundSchedule.baselineScheduleHash,
    baselineObligationIds: reboundSchedule.factHarvestObligations.map(
      (obligation) => obligation.obligationId
    ),
    expansionReceipts: [],
  });
  faults.push(
    await faultCard(
      'schedule-lineage-rebind',
      'strict-production-authority',
      'STRICT_PRODUCTION_SCHEDULE_LINEAGE_MISMATCH',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          baselineSchedule: reboundSchedule,
          finalFactSchedule: reboundSchedule,
          finalExpandedSchedule: reboundFinalSchedule,
        })
    )
  );
  faults.push(
    await faultCard(
      'tampered-output',
      'strict-fact-generation-manifest',
      'STRICT_FACT_GENERATION_MANIFEST_INVALID',
      () =>
        createStrictProductionAuthorityReceiptV1({
          ...authorityInput,
          factExecution: {
            ...factExecution,
            receipts: [
              {
                ...executionReceipt,
                outputHash: hashCanonicalJson({ tampered: executionReceipt.outputHash }),
              },
            ],
          },
      })
    )
  );
  return faults;
}

function writeProbeReport({ real, analysis, falsification, candidate, faults }) {
  const {
    artifact,
    catalog,
    registry,
    schedule,
    subjectBinding,
    witness,
    factExecution,
    executionReceipt,
  } = real;
  const { finalSchedule, analysisReviewContextHash } = analysis;
  const { falsificationActors, falsificationProposalHash } = falsification;
  const { authority, contentReadyTerminal, admissionLedger } = candidate;
  if (faults.some((fault) => !fault.rejected)) {
    throw new Error('STRICT_PRODUCTION_FAULT_MATRIX_INCOMPLETE');
  }
  const report = {
    schemaVersion: 2,
    probe: 'strict-production-authority-fresh-process',
    contractVersion: authority.contractVersion,
    authorityHash: authority.authorityHash,
    analysisReviewContextHash,
    publicSubpaths: [
      '@alembic/core/production',
      '@alembic/core/project-context-foundation',
    ],
    executor: {
      realExecutor: true,
      sourceArtifactId: artifact.artifactId,
      sourceRevisionVectorHash: artifact.sourceVectorHash,
      certificationBindingHash: artifact.certificationBindingHash,
      catalogHash: catalog.catalogHash,
      scheduleHash: schedule.factHarvestScheduleHash,
      registryHash: registry.registryHash,
      subjectBindingHash: subjectBinding.bindingHash,
      witnessAuthorityHash: witness.authority.authorityHash,
      manifestHash: factExecution.manifest.manifestHash,
      receiptHash: executionReceipt.receiptHash,
      outputHash: executionReceipt.outputHash,
      factIds: factExecution.facts.map((fact) => fact.factId),
      disposition: executionReceipt.disposition,
      expectedFileCount: executionReceipt.expectedFileCount,
      inspectedFileCount: executionReceipt.inspectedFileCount,
    },
    resourceConservation: authority.resourceConservation,
    authorityBindings: {
      baselineScheduleHash: schedule.baselineScheduleHash,
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      executedFactScheduleHash: schedule.factHarvestScheduleHash,
      terminalEvidenceReceiptHashes: authority.terminalEvidenceReceiptHashes,
      inspectedAcceptedCorpusHash:
        contentReadyTerminal.terminalEvidence.corpusInspections[0].acceptedCorpusHash,
      ledgerInitialAcceptedCorpusHash: admissionLedger.initialAcceptedCorpusHash,
    },
    actorBindings: {
      producerActorHash: falsificationActors.producer.actorHash,
      producerLoadReceiptHash: falsificationActors.producer.loadReceiptHash,
      producerOutputHash: falsificationActors.producer.outputHash,
      reviewerActorHash: falsificationActors.reviewer.actorHash,
      reviewerLoadReceiptHash: falsificationActors.reviewer.loadReceiptHash,
      reviewerOutputHash: falsificationActors.reviewer.outputHash,
      proposalHash: falsificationProposalHash,
      actorKind: 'deterministic-no-llm-review-fixture',
    },
    faults,
  };
  process.stdout.write(
    `${JSON.stringify({ ...report, reportHash: hashCanonicalJson(report) }, null, 2)}\n`
  );
}

async function faultCard(mutation, stage, expectedCode, action) {
  let actualCode = null;
  try {
    await action();
  } catch (error) {
    actualCode = error instanceof Error ? error.message : String(error);
  }
  if (actualCode !== expectedCode) {
    throw new Error(
      `STRICT_PRODUCTION_FAULT_PROBE_FAILED:${mutation}:${actualCode ?? 'no-error'}`
    );
  }
  return {
    mutation,
    stage,
    expectedCode,
    actualCode,
    rejected: true,
  };
}

function createActors(family, manifestHash, proposalHash, reviewDecision) {
  const create = (role) => {
    const loadReceiptHash = hashCanonicalJson({
      kind: 'deterministic-review-actor-load',
      role,
      providerId: 'provider:deterministic-probe-fixture',
      modelId: 'model:strict-probe-no-llm',
      modelVersion: '2026-07-27',
    });
    const promptHash = hashCanonicalJson({
      kind: 'knowledge-disposition-review-prompt',
      role,
      reviewKind: reviewDecision.reviewKind,
      familyId: family.id,
      queryPackHash: family.queryPackHash,
      proposalHash,
    });
    const outputHash =
      role === 'producer'
        ? proposalHash
        : hashCanonicalJson({
            kind: 'knowledge-disposition-review-verdict',
            reviewKind: reviewDecision.reviewKind,
            proposalHash,
            manifestHash,
            executionBindings: reviewDecision.executionReceipts.map((receipt) => ({
              obligationId: receipt.obligationId,
              executionReceiptHash: receipt.receiptHash,
              executionOutputHash: receipt.outputHash,
              denominatorHash: receipt.denominatorHash,
              disposition: receipt.disposition,
              terminalReceiptId: receipt.terminalReceiptId,
            })),
            verdict: reviewDecision.verdict,
            reasonCode: reviewDecision.reasonCode,
            calibrationReceiptHash: reviewDecision.calibrationReceiptHash,
          });
    return createProductionActorIdentityV1({
      providerId: 'provider:deterministic-probe-fixture',
      modelId: 'model:strict-probe-no-llm',
      modelVersion: '2026-07-27',
      promptHash,
      runId,
      invocationId: `invocation:${role}:${proposalHash.slice(7, 19)}`,
      loadReceiptHash,
      outputHash,
    });
  };
  return { producer: create('producer'), reviewer: create('reviewer') };
}

function createSchedule(family, canonicalSubjectRef) {
  const obligationSemantic = {
    factFamilyId: family.id,
    capabilityId: family.capabilityId,
    canonicalSubjectRef,
    analysisScale: 'file',
    denominator: 'complete-frozen-subject',
  };
  const factHarvestObligations = [
    {
      obligationId: `fact:${hashCanonicalJson(obligationSemantic).slice(7, 31)}`,
      ...obligationSemantic,
      source: 'required-universe',
    },
  ];
  const factHarvestScheduleHash = hashCanonicalJson(factHarvestObligations);
  const lensBindings = [];
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  return {
    schemaVersion: 1,
    factHarvestObligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  };
}

function createContentReadyTerminalEvidence({ analysisFixpointHash, authoredFingerprint }) {
  const g1Receipt = createStrictG1ReceiptV1({
    candidateFingerprint: authoredFingerprint,
    retrievalReadinessHash: hashCanonicalJson({
      kind: 'fresh-process-retrieval-readiness',
      analysisFixpointHash,
    }),
    rows: STRICT_G1_HARD_AXES_V1.map((axis) => ({
      axis,
      verdict: 'pass',
      reasonCode: 'fresh-process-authority-verified',
      evidenceRefs: [`probe:${axis}`],
    })),
  });
  const corpusInspection = createStrictAcceptedCorpusInspectionV1({
    runId,
    analysisFixpointHash,
    privateCorpusRevision,
    revisionRootManifestHash: hashCanonicalJson({
      kind: 'fresh-process-private-corpus-root',
      privateCorpusRevision,
    }),
    entries: [],
  });
  const admissionReceipt = createStrictAdmissionReceiptV1({
    g1Receipt,
    corpusInspection,
    inputFingerprint: authoredFingerprint,
    finalAdmittedFingerprint: authoredFingerprint,
    exactMatches: [],
    semanticMatches: [],
    consolidation: {
      action: 'create',
      reasonCode: 'fresh-process-novel-candidate',
      targetRecipeId: null,
      targetFingerprint: null,
    },
    algorithmVersion: 'strict-authority-probe-admission-v1',
  });
  const g2Receipt = createStrictG2ReceiptV1({
    g1Receipt,
    admissionReceipt,
    reviewedFingerprint: authoredFingerprint,
    producer: {
      identity: 'probe-terminal-producer',
      method: 'deterministic-terminal-fixture',
      modelHash: hashCanonicalJson({ actor: 'probe-terminal-producer' }),
      promptHash: hashCanonicalJson({ prompt: 'probe-terminal-producer' }),
    },
    reviewer: {
      identity: 'probe-terminal-independent-reviewer',
      method: 'deterministic-terminal-fixture',
      modelHash: hashCanonicalJson({ actor: 'probe-terminal-independent-reviewer' }),
      promptHash: hashCanonicalJson({ prompt: 'probe-terminal-independent-reviewer' }),
    },
    rows: STRICT_G2_HARD_AXES_V1.map((axis) => ({
      axis,
      axisVerdict: 'pass',
      score: 2,
      reasonCode: 'fresh-process-authority-verified',
      evidenceRefs: [`probe:${axis}`],
      repairable: false,
    })),
    novelty: {
      decision: 'novel-project-specific',
      reasonCode: 'fresh-process-project-specific',
      evidenceRefs: ['probe:real-executor-fact'],
    },
    duplicate: {
      decision: 'no-match',
      reasonCode: 'fresh-process-complete-corpus-no-match',
      evidenceRefs: ['probe:private-corpus-inspection'],
      admissionAlgorithmVersion: admissionReceipt.algorithmVersion,
      comparedPrivateCorpusRevision: admissionReceipt.privateCorpusRevision,
      matchedRecipeIds: [],
      matchedFingerprints: [],
      targetRecipeId: null,
      consolidationFingerprint: null,
    },
    repairAttempt: 0,
    calibrationReceiptHash: hashCanonicalJson({
      kind: 'fresh-process-g2-calibration',
      analysisFixpointHash,
    }),
    ruleVersion: 'strict-authority-probe-g2-v1',
    permittedRepairFields: [],
  });
  return {
    terminalReceiptId: `g2:${g2Receipt.receiptHash.slice(7, 31)}`,
    terminalReceiptHash: g2Receipt.receiptHash,
    terminalEvidence: {
      g1Receipts: [g1Receipt],
      g1TerminalBindings: [],
      corpusInspections: [corpusInspection],
      admissionReceipts: [admissionReceipt],
      g2Receipts: [g2Receipt],
      gateReturns: [],
    },
  };
}

function createPlanningFacts(artifact) {
  return {
    schemaVersion: 1,
    factsHash: artifact.factsContentHash,
    sourceRevisionVectorHash: artifact.sourceVectorHash,
    sourceArtifactHash: artifact.certificationBindingHash,
    modules: [
      {
        moduleId: 'core',
        scopeId: 'repo:core',
        relativePath: '.',
        moduleClass: 'production-library',
        ownedProductionFileCount: artifact.facts.inventory.files.length,
        languages: [...new Set(artifact.facts.inventory.files.map((file) => file.language))],
        frameworks: ['nx'],
        roles: ['library'],
        entrypointRefs: [],
        publicSurfaceRefs: [],
        crossRepoEdgeRefs: [],
        boundaryRefs: [],
        ownership: {
          origin: 'certified-project-facts',
          confidence: 1,
          evidenceRefs: ['artifact:inventory'],
        },
      },
    ],
  };
}

function createWitnessMaterial(artifact) {
  const entries = artifact.facts.inventory.files.map((file, index) => {
    const content = Buffer.from(readCertifiedProjectFactsFrozenFile(artifact, file)).toString(
      'utf8'
    );
    return {
      id: `E-${index + 1}`,
      sessionId: 'strict-production-authority-probe',
      dimensionId: 'strict-fact-execution',
      tool: 'code.read',
      callId: `call-${index + 1}`,
      file: file.relativePath,
      content,
      contentHash: hashBytes(Buffer.from(content)),
      capturedAt: index + 1,
    };
  });
  const evidenceLedgerSnapshot = createStrictEvidenceLedgerSnapshotV1(entries);
  const projectContextRefs = artifact.facts.inventory.files.map((file) =>
    createProjectContextFileRef({
      projectRoot: '/certified/strict-production-authority-probe',
      repoId: file.repoId,
      filePath: file.relativePath,
      hash: file.blobSha256,
    })
  );
  const bindings = artifact.facts.inventory.files.map((file, index) =>
    createStrictFactDirectWitnessBindingV1({
      artifact,
      repoId: file.repoId,
      relativePath: file.relativePath,
      evidenceEntry: entries[index],
      evidenceLedgerSnapshot,
      projectContextRef: projectContextRefs[index],
    })
  );
  return {
    bindings,
    authority: createStrictFactWitnessAuthorityV1({
      artifact,
      evidenceLedgerSnapshot,
      projectContextRefs,
    }),
  };
}

async function createStrictArtifact(root) {
  const fixture = createStrictArtifactFixture(root);
  return captureCertifiedProjectFactsV2(
    fixture.input,
    createStrictArtifactPorts(fixture.sourceFile, fixture.sourceContent)
  );
}

function createStrictArtifactFixture(root) {
  const sourceFile = {
    language: 'json',
    mode: '100644',
    ownerModuleIds: [],
    ownersV2: [],
    relativePath: 'project.json',
  };
  const sourceContent = Buffer.from(
    `${JSON.stringify({
      name: 'strict-authority-probe',
      projectType: 'library',
      targets: {
        build: {
          executor: 'nx:run-commands',
          options: { command: 'tsc -p tsconfig.json' },
        },
      },
    })}\n`
  );
  const repository = {
    relativeRoot: '.',
    repoId: 'core',
    scopeId: 'repo:core',
    sourceRoot: root,
  };
  const projectScope = buildProjectScopeManifestV1({
    acceptedScope: {
      projectIdentity: { projectId: 'strict-authority-probe', scopeId: 'repo:core' },
      projectMode: 'SINGLE',
      repositories: [{ relativeRoot: '.', repoId: 'core' }],
    },
    controlRoot: root,
    sourceRoots: [{ repoId: 'core', sourceRoot: root }],
  });
  const requestMatrix = buildProjectContextRequestMatrixV2(
    projectScope.manifest,
    createProjectContextRequestAuditPlansV2({
      repository,
      eligibleFiles: [sourceFile],
      projectScopeManifest: projectScope.manifest,
    })
  );
  const input = {
    projectMode: 'SINGLE',
    repositories: [repository],
    inventoryPolicy: {
      excludeDirectories: ['node_modules', '.git'],
      includeExtensions: ['.json'],
      version: 'strict-production-authority-probe-v1',
    },
    detailPolicy: {
      chunkBytes: 256,
      maxPreviewBytes: 256,
      maxSelectedFiles: 1,
    },
    requestPlans: requestMatrix.plans,
    legacyEntries: [],
    projections: Object.fromEntries(
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [consumer, { consumer }])
    ),
    certification: {
      acceptedConfigHash: hashCanonicalJson({ config: 'probe' }),
      acceptedRuntimeHash: hashCanonicalJson({ runtime: 'probe' }),
      capabilityHash: hashCanonicalJson({ capability: 'config-parser' }),
      parserHash: hashCanonicalJson({ parser: 'nx-project-json' }),
      scopeIdentityHash: projectScope.manifest.canonicalScopeHash,
    },
    projectScope,
    requestMatrix,
  };
  return { sourceFile, sourceContent, input };
}

function createStrictArtifactPorts(sourceFile, sourceContent) {
  return {
    enumerateEligibleFiles: async () => [sourceFile],
    executeRequest: async ({ plan }) => {
      const selector = plan.selector;
      return {
        detectedLanguage: selector.filePath ? 'json' : undefined,
        output: { kind: plan.kind, selector: plan.selector },
        parserRuntime: selector.filePath ? 'ready' : 'not-required',
        queryInitialization: selector.filePath ? 'ready' : 'not-required',
        sourceRanges: selector.filePath
          ? [
              {
                repoId: plan.repoId,
                relativePath: selector.filePath,
                startLine: 1,
                endLine: 1,
              },
            ]
          : [],
        terminalStatus: 'completed',
      };
    },
    observeRevision: async () => ({
      kind: 'git',
      dirty: false,
      commitId: 'a'.repeat(40),
      treeId: 'b'.repeat(40),
    }),
    readFile: async ({ relativePath }) => {
      if (relativePath !== sourceFile.relativePath) {
        throw new Error(`STRICT_PRODUCTION_PROBE_UNEXPECTED_FILE:${relativePath}`);
      }
      return sourceContent;
    },
    verifySnapshot: async ({ candidate }) => ({
      version: 1,
      verified: true,
      binding: 'git-tree',
      finalRevision: candidate.postRevision,
      eligibleInventoryHash: candidate.eligibleInventoryHash,
      workingTreeContentHash: candidate.workingTreeContentHash,
      treeId:
        candidate.postRevision.kind === 'git'
          ? (candidate.postRevision.treeId ?? undefined)
          : undefined,
      typedReason: 'strict-production-authority-probe-snapshot',
    }),
  };
}

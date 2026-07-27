import { describe, expect, it } from 'vitest';
import {
  assertFactQueryExecutionReceiptV1,
  canonicalizeCandidateAttemptBatchV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createAnalysisReviewContextHashV1,
  createFactRecordV1,
  createFalsificationReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInductionReceiptV1,
  createInvestigatedEmptyDecisionV1,
  createKnowledgeClusterSemanticTransitionV1,
  createKnowledgeDispositionReviewV1,
  createProductionActorIdentityV1,
  createStrictAcceptedCorpusInspectionV1,
  createStrictAdmissionReceiptV1,
  createStrictG1ReceiptV1,
  createStrictG2ReceiptV1,
  createStrictProductionAuthorityReceiptV1,
  type FactQueryExecutionReceiptV1,
  hashKnowledgeClusterSetProposalV1,
  hashKnowledgeClusterV1,
  hashKnowledgeDispositionProposalV1,
  STRICT_G1_HARD_AXES_V1,
  STRICT_G2_HARD_AXES_V1,
  validateHypothesisExpressionSetReceiptV1,
  validateSerialAdmissionLedgerV1,
} from '../src/production.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';

const SOURCE_REVISION = `sha256:${'1'.repeat(64)}`;
const FIXPOINT = `sha256:${'2'.repeat(64)}`;

function actor(role: 'producer' | 'reviewer') {
  return createProductionActorIdentityV1({
    providerId: 'provider:frozen',
    modelId: 'model:strict-v1',
    modelVersion: '2026-07-27',
    promptHash: `sha256:${role === 'producer' ? '3' : '4'}`.padEnd(
      71,
      role === 'producer' ? '3' : '4'
    ),
    runId: 'run-semantic-authority',
    invocationId: `invocation:${role}`,
    loadReceiptHash: `sha256:${role === 'producer' ? '5' : '6'}`.padEnd(
      71,
      role === 'producer' ? '5' : '6'
    ),
    outputHash: `sha256:${role === 'producer' ? '7' : '8'}`.padEnd(
      71,
      role === 'producer' ? '7' : '8'
    ),
  });
}

function directFact(obligationId: string, suffix: string, behavior: string) {
  const canonicalSubjectRef = `file:repo:src/${obligationId}.ts`;
  return createFactRecordV1({
    factFamilyId: 'syntax-idiom',
    canonicalSubjectRef,
    primaryScale: 'file',
    sourceRevisionVectorHash: SOURCE_REVISION,
    value: { behavior },
    witnesses: [
      {
        kind: 'direct',
        evidenceEntryId: `E-${suffix}`,
        evidenceSessionId: 'session-semantic-authority',
        evidenceContentHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
        sourceRevisionVectorHash: SOURCE_REVISION,
        projectContextRefId: canonicalSubjectRef,
        projectContextRefHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
        canonicalSubjectRef,
        anchor: {
          relativePath: `src/${obligationId}.ts`,
          blobHash: `sha256:${'9'.repeat(64)}`,
          range: { startLine: Number.parseInt(suffix, 16), endLine: Number.parseInt(suffix, 16) },
        },
      },
    ],
  });
}

function executionReceipt(input: {
  obligationId: string;
  disposition: FactQueryExecutionReceiptV1['disposition'];
  emittedFactIds?: readonly string[];
}): FactQueryExecutionReceiptV1 {
  const emittedFactIds = [...(input.emittedFactIds ?? [])].sort();
  const obligationSemantic = {
    factFamilyId: 'syntax-idiom',
    capabilityId: 'tree-sitter-query',
    canonicalSubjectRef: `file:repo:src/${input.obligationId}.ts`,
    analysisScale: 'file' as const,
    denominator: 'complete-frozen-subject' as const,
  };
  const obligationId = `fact:${hashCanonicalJson(obligationSemantic).slice(7, 31)}`;
  const denominatorFileIds = [`repo:src/${input.obligationId}.ts@sha256:${'9'.repeat(64)}`];
  const fileExecutionSemantic = {
    repoId: 'repo',
    relativePath: `src/${input.obligationId}.ts`,
    blobHash: `sha256:${'9'.repeat(64)}`,
    status: 'complete' as const,
    reasonCode: 'COMPLETE',
    truncated: false,
    continuation: null,
    witnessBindingHash: `sha256:${'0'.repeat(64)}`,
    evidenceEntryId: 'E-1',
    projectContextRefId: `file:repo:src/${input.obligationId}.ts`,
    stagedFactIds: emittedFactIds,
    discardedFactIds: [] as string[],
    emittedFactIds,
  };
  const fileExecution = {
    ...fileExecutionSemantic,
    executionHash: hashCanonicalJson(fileExecutionSemantic),
  };
  const outputSemantic = {
    obligationId,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    fileExecutionHashes: [fileExecution.executionHash],
    derivedFactIds: [] as string[],
    emittedFactIds,
    disposition: input.disposition,
    truncated: false,
    continuation: null,
  };
  const outputHash = hashCanonicalJson(outputSemantic);
  const semantic = {
    schemaVersion: 1 as const,
    obligationId,
    ...obligationSemantic,
    sourceRevisionVectorHash: SOURCE_REVISION,
    backendProducer: 'loaded:test',
    backendManifestHash: `sha256:${'b'.repeat(64)}`,
    backendLoadReceiptHash: `sha256:${'c'.repeat(64)}`,
    queryPackHash: `sha256:${'d'.repeat(64)}`,
    harvestKey: `sha256:${'e'.repeat(64)}`,
    harvestReceiptHash: `sha256:${'f'.repeat(64)}`,
    expectedFileCount: 1,
    inspectedFileCount: 1,
    denominatorFileIds,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    witnessBindingHash: `sha256:${'0'.repeat(64)}`,
    fileExecutions: [fileExecution],
    derivedFactIds: [] as string[],
    emittedFactIds,
    disposition: input.disposition,
    reasonCode:
      input.disposition === 'matched'
        ? 'COMPLETE_FROZEN_SUBJECT_INSPECTED'
        : 'COMPLETE_FROZEN_SUBJECT_INSPECTED',
    truncated: false,
    continuation: null,
    outputHash,
  };
  const receiptHash = hashCanonicalJson(semantic);
  return {
    ...semantic,
    terminalReceiptId: `fact-execution:${receiptHash.slice(7, 31)}`,
    receiptHash,
  };
}

function failedEmptyExecutionReceipt(obligationId: string): FactQueryExecutionReceiptV1 {
  const denominatorFileIds: string[] = [];
  const outputSemantic = {
    obligationId,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    fileExecutionHashes: [] as string[],
    derivedFactIds: [] as string[],
    emittedFactIds: [] as string[],
    disposition: 'failed' as const,
    truncated: false,
    continuation: null,
  };
  const semantic = {
    schemaVersion: 1 as const,
    obligationId,
    factFamilyId: 'syntax-idiom',
    capabilityId: 'tree-sitter-query',
    canonicalSubjectRef: 'repo:repo',
    analysisScale: 'repository' as const,
    denominator: 'complete-frozen-subject' as const,
    sourceRevisionVectorHash: SOURCE_REVISION,
    backendProducer: 'unavailable:test',
    backendManifestHash: `sha256:${'b'.repeat(64)}`,
    backendLoadReceiptHash: `sha256:${'c'.repeat(64)}`,
    queryPackHash: `sha256:${'d'.repeat(64)}`,
    harvestKey: `sha256:${'e'.repeat(64)}`,
    harvestReceiptHash: `sha256:${'f'.repeat(64)}`,
    expectedFileCount: 0,
    inspectedFileCount: 0,
    denominatorFileIds,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    witnessBindingHash: hashCanonicalJson([]),
    fileExecutions: [],
    derivedFactIds: [],
    emittedFactIds: [],
    disposition: 'failed' as const,
    reasonCode: 'SUBJECT_BINDING_UNAVAILABLE',
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

function reviewExecutionScope(receipts: readonly FactQueryExecutionReceiptV1[]) {
  const { finalExpandedSchedule } = authorityScheduleLineage(receipts);
  return {
    finalExpandedSchedule,
    terminalObligations: receipts
      .map((receipt) => ({
        obligationId: receipt.obligationId,
        disposition: receipt.disposition,
        terminalReceiptId: receipt.terminalReceiptId,
      }))
      .sort((left, right) => left.obligationId.localeCompare(right.obligationId)),
  };
}

function authorityScheduleLineage(receipts: readonly FactQueryExecutionReceiptV1[]) {
  const factHarvestObligations = receipts
    .map((receipt) => ({
      obligationId: receipt.obligationId,
      factFamilyId: receipt.factFamilyId,
      capabilityId: receipt.capabilityId,
      canonicalSubjectRef: receipt.canonicalSubjectRef,
      analysisScale: receipt.analysisScale,
      denominator: receipt.denominator,
      source: 'required-universe' as const,
    }))
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
  const factHarvestScheduleHash = hashCanonicalJson(factHarvestObligations);
  const lensBindings: [] = [];
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  const baselineSchedule = {
    schemaVersion: 1 as const,
    factHarvestObligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  };
  const finalExpandedSchedule = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: baselineSchedule.baselineScheduleHash,
    baselineObligationIds: factHarvestObligations.map((row) => row.obligationId),
    expansionReceipts: [],
  });
  return {
    baselineSchedule,
    scheduleExpansionReceipts: [],
    finalExpandedSchedule,
    finalFactSchedule: baselineSchedule,
  };
}

function factExecutionResult(
  receipt: FactQueryExecutionReceiptV1,
  facts: ReturnType<typeof createFactRecordV1>[] = []
) {
  const { finalFactSchedule } = authorityScheduleLineage([receipt]);
  const terminalReceiptHashes = [receipt.receiptHash];
  const harvestReceiptHashes = [receipt.harvestReceiptHash];
  const denominatorHashes = [receipt.denominatorHash];
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: 'artifact:strict-production-probe',
    sourceRevisionVectorHash: SOURCE_REVISION,
    factQueryCatalogHash: `sha256:${'1'.repeat(64)}`,
    factHarvestScheduleHash: finalFactSchedule.factHarvestScheduleHash,
    backendRegistryHash: `sha256:${'3'.repeat(64)}`,
    obligationCount: 1,
    terminalReceiptIds: [receipt.terminalReceiptId],
    terminalReceiptHashes,
    terminalReceiptSetHash: hashCanonicalJson(terminalReceiptHashes),
    harvestReceiptHashes,
    harvestCount: 1,
    denominatorHashes,
    witnessBindingSetHash: hashCanonicalJson([receipt.witnessBindingHash]),
    factIds: facts.map((fact) => fact.factId).sort(),
    factCount: facts.length,
    unexecutableCatalogFamilyIds: [] as string[],
    unregisteredBackendFamilyIds: [] as string[],
    failedObligationIds: [] as string[],
    unknownObligationIds: [] as string[],
    verdict: 'passed' as const,
  };
  return {
    facts,
    receipts: [receipt],
    manifest: { ...semantic, manifestHash: hashCanonicalJson(semantic) },
  };
}

function contentReadyTerminalEvidence(input: {
  runId: string;
  analysisFixpointHash: string;
  privateCorpusRevision: string;
  authoredFingerprint: string;
}) {
  const g1Receipt = createStrictG1ReceiptV1({
    candidateFingerprint: input.authoredFingerprint,
    retrievalReadinessHash: `sha256:${'a'.repeat(64)}`,
    rows: STRICT_G1_HARD_AXES_V1.map((axis) => ({
      axis,
      verdict: 'pass' as const,
      reasonCode: 'verified',
      evidenceRefs: [`evidence:${axis}`],
    })),
  });
  const corpusInspection = createStrictAcceptedCorpusInspectionV1({
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    revisionRootManifestHash: `sha256:${'b'.repeat(64)}`,
    entries: [],
  });
  const admissionReceipt = createStrictAdmissionReceiptV1({
    g1Receipt,
    corpusInspection,
    inputFingerprint: input.authoredFingerprint,
    finalAdmittedFingerprint: input.authoredFingerprint,
    exactMatches: [],
    semanticMatches: [],
    consolidation: {
      action: 'create',
      reasonCode: 'strict-authority-novel-candidate',
      targetRecipeId: null,
      targetFingerprint: null,
    },
    algorithmVersion: 'strict-authority-admission-v1',
  });
  const g2Receipt = createStrictG2ReceiptV1({
    g1Receipt,
    admissionReceipt,
    reviewedFingerprint: input.authoredFingerprint,
    producer: {
      identity: 'producer-model',
      method: 'recipe-expression-v1',
      modelHash: `sha256:${'c'.repeat(64)}`,
      promptHash: `sha256:${'d'.repeat(64)}`,
    },
    reviewer: {
      identity: 'independent-reviewer',
      method: 'value-gate-v1',
      modelHash: `sha256:${'e'.repeat(64)}`,
      promptHash: `sha256:${'f'.repeat(64)}`,
    },
    rows: STRICT_G2_HARD_AXES_V1.map((axis) => ({
      axis,
      axisVerdict: 'pass' as const,
      score: 2 as const,
      reasonCode: 'verified',
      evidenceRefs: [`evidence:${axis}`],
      repairable: false,
    })),
    novelty: {
      decision: 'novel-project-specific',
      reasonCode: 'project-specific-mechanism',
      evidenceRefs: ['E-1'],
    },
    duplicate: {
      decision: 'no-match',
      reasonCode: 'complete-corpus-no-match',
      evidenceRefs: ['E-1'],
      admissionAlgorithmVersion: admissionReceipt.algorithmVersion,
      comparedPrivateCorpusRevision: admissionReceipt.privateCorpusRevision,
      matchedRecipeIds: [],
      matchedFingerprints: [],
      targetRecipeId: null,
      consolidationFingerprint: null,
    },
    repairAttempt: 0,
    calibrationReceiptHash: `sha256:${'1'.repeat(64)}`,
    ruleVersion: 'strict-g2-rule-v1',
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

const EMPTY_TERMINAL_EVIDENCE = {
  g1Receipts: [],
  g1TerminalBindings: [],
  corpusInspections: [],
  admissionReceipts: [],
  g2Receipts: [],
  gateReturns: [],
} as const;

describe('strict semantic evidence authority', () => {
  it('rejects an empty failed execution as authority for a pass disposition review', () => {
    const receipt = failedEmptyExecutionReceipt('obligation-unavailable');
    const {
      terminalReceiptId: _terminalReceiptId,
      receiptHash: _receiptHash,
      ...receiptSemantic
    } = receipt;
    const forgedDenominatorSemantic = {
      ...receiptSemantic,
      denominator: 'caller-declared-partial',
    };
    const forgedDenominatorHash = hashCanonicalJson(forgedDenominatorSemantic);
    expect(() =>
      assertFactQueryExecutionReceiptV1({
        ...forgedDenominatorSemantic,
        terminalReceiptId: `fact-execution:${forgedDenominatorHash.slice(7, 31)}`,
        receiptHash: forgedDenominatorHash,
      } as unknown as FactQueryExecutionReceiptV1)
    ).toThrow('FACT_QUERY_EXECUTION_RECEIPT_INVALID');

    expect(() =>
      createKnowledgeDispositionReviewV1({
        reviewKind: 'producer-non-draft',
        currentAnalysisFixpointHash: FIXPOINT,
        populationHash: `sha256:${'a'.repeat(64)}`,
        proposedDispositionHash: `sha256:${'b'.repeat(64)}`,
        executionReceipts: [receipt],
        ...reviewExecutionScope([receipt]),
        producer: actor('producer'),
        reviewer: actor('reviewer'),
        calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
        verdict: 'pass',
        reasonCode: 'must-not-authorize',
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_EXECUTION_NONTERMINAL');
  });

  it('rejects a cluster-discard review that signs a different disposition', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-cluster-discard',
      disposition: 'matched',
      emittedFactIds: ['fact:discarded'],
    });
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-cluster-discard',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['observation-discarded'],
        expectedObligationIds: [receipt.obligationId],
        executionReceiptHashes: [receipt.receiptHash],
        outputHashes: [receipt.outputHash],
        denominatorHashes: [receipt.denominatorHash],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      executionReceipts: [receipt],
      observations: [
        {
          observationId: 'observation-discarded',
          factIds: ['fact:discarded'],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: [receipt.canonicalSubjectRef],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [],
    });
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'cluster-discard',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: population.populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'cluster-discard',
        populationHash: population.populationHash,
        observationId: 'observation-other',
        status: 'discarded',
        reasonCode: 'not-representative',
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'independent-review',
    });

    expect(() =>
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [],
        nonClusteredDispositions: [
          {
            observationId: 'observation-discarded',
            status: 'discarded',
            reasonCode: 'not-representative',
            dispositionReview: review,
          },
        ],
      })
    ).toThrow('CLUSTER_DISCARD_REVIEW_INVALID');

    const clusterProposalHash = hashKnowledgeClusterSetProposalV1(population, {
      clusters: [],
      nonClusteredDispositions: [
        {
          observationId: 'observation-discarded',
          status: 'discarded',
          reasonCode: 'not-representative',
        },
      ],
    });
    const validReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'cluster-discard',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: population.populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'cluster-discard',
        populationHash: population.populationHash,
        observationId: 'observation-discarded',
        status: 'discarded',
        reasonCode: 'not-representative',
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'independent-review',
    });
    expect(
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [],
        nonClusteredDispositions: [
          {
            observationId: 'observation-discarded',
            status: 'discarded',
            reasonCode: 'not-representative',
            dispositionReview: validReview,
          },
        ],
      }).clusterSetHash
    ).toBe(clusterProposalHash);
  });

  it('keeps a complete population denominator and allows Analyst-owned cross-subject mechanisms', () => {
    const firstReceipt = executionReceipt({
      obligationId: 'obligation-a',
      disposition: 'matched',
      emittedFactIds: ['fact:a'],
    });
    const secondReceipt = executionReceipt({
      obligationId: 'obligation-b',
      disposition: 'matched',
      emittedFactIds: ['fact:b'],
    });
    const noPatternReceipt = executionReceipt({
      obligationId: 'obligation-negative',
      disposition: 'inspected-no-pattern',
    });
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-semantic',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['observation-a', 'observation-b', 'observation-negative'],
        expectedObligationIds: [
          firstReceipt.obligationId,
          secondReceipt.obligationId,
          noPatternReceipt.obligationId,
        ],
        executionReceiptHashes: [
          firstReceipt.receiptHash,
          secondReceipt.receiptHash,
          noPatternReceipt.receiptHash,
        ],
        outputHashes: [
          firstReceipt.outputHash,
          secondReceipt.outputHash,
          noPatternReceipt.outputHash,
        ],
        denominatorHashes: [
          firstReceipt.denominatorHash,
          secondReceipt.denominatorHash,
          noPatternReceipt.denominatorHash,
        ],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      executionReceipts: [firstReceipt, secondReceipt, noPatternReceipt],
      observations: [
        {
          observationId: 'observation-a',
          factIds: ['fact:a'],
          obligationIds: [firstReceipt.obligationId],
          canonicalSubjectRefs: ['file:repo:src/a.ts'],
          parentSubjectRefs: ['repo:repo'],
          variantKeys: ['async'],
          outlierReasonCodes: [],
          negativeControl: false,
        },
        {
          observationId: 'observation-b',
          factIds: ['fact:b'],
          obligationIds: [secondReceipt.obligationId],
          canonicalSubjectRefs: ['file:repo:src/b.ts'],
          parentSubjectRefs: ['repo:repo'],
          variantKeys: ['sync'],
          outlierReasonCodes: [],
          negativeControl: false,
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [
        {
          observationId: 'observation-negative',
          obligationId: noPatternReceipt.obligationId,
          canonicalSubjectRef: noPatternReceipt.canonicalSubjectRef,
          parentSubjectRefs: ['repo:repo'],
          executionReceiptHash: noPatternReceipt.receiptHash,
          outputHash: noPatternReceipt.outputHash,
          denominatorHash: noPatternReceipt.denominatorHash,
        },
      ],
    });

    expect(population.completion).toBe('complete');
    expect(population.conservation).toEqual({
      raw: 3,
      accepted: 2,
      duplicate: 0,
      excluded: 0,
      error: 0,
      inspectedNoPattern: 1,
      omitted: 0,
    });

    const clusters = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:atomic-replace',
          mechanism: { invariant: 'write temp, fsync, rename' },
          observationIds: ['observation-a', 'observation-b'],
          mechanismEvidenceFactIds: ['fact:a', 'fact:b'],
          anatomyLensIds: ['state-lifecycle-persistence'],
        },
      ],
      nonClusteredDispositions: [],
    });

    expect(clusters.clusters[0]).toMatchObject({
      mechanismKey: 'mechanism:atomic-replace',
      memberFactIds: ['fact:a', 'fact:b'],
      canonicalSubjectRefs: ['file:repo:src/a.ts', 'file:repo:src/b.ts'],
      variantKeys: ['async', 'sync'],
    });
  });

  it('fails caller-declared completion closed and conserves every disposition with execution lineage', () => {
    const matched = executionReceipt({
      obligationId: 'obligation-dispositions',
      disposition: 'matched',
      emittedFactIds: ['fact:accepted', 'fact:duplicate', 'fact:excluded'],
    });
    const failed = executionReceipt({
      obligationId: 'obligation-error',
      disposition: 'failed',
    });
    const noPattern = executionReceipt({
      obligationId: 'obligation-no-pattern',
      disposition: 'inspected-no-pattern',
    });
    const denominator = {
      kind: 'frozen-complete-subjects' as const,
      expectedObservationIds: ['accepted', 'duplicate', 'excluded', 'error', 'no-pattern'],
      expectedObligationIds: [matched.obligationId, failed.obligationId, noPattern.obligationId],
      executionReceiptHashes: [matched.receiptHash, failed.receiptHash, noPattern.receiptHash],
      outputHashes: [matched.outputHash, failed.outputHash, noPattern.outputHash],
      denominatorHashes: [
        matched.denominatorHash,
        failed.denominatorHash,
        noPattern.denominatorHash,
      ],
      complete: true,
      truncated: false,
      continuation: null,
      omittedObservationIds: [],
    };
    const input = {
      populationId: 'population-dispositions',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator,
      observations: [
        {
          observationId: 'accepted',
          factIds: ['fact:accepted'],
          obligationIds: [matched.obligationId],
          canonicalSubjectRefs: [matched.canonicalSubjectRef],
          parentSubjectRefs: ['repo:repo'],
          variantKeys: ['baseline'],
          outlierReasonCodes: [],
          negativeControl: false,
        },
      ],
      duplicateObservations: [
        {
          observationId: 'duplicate',
          duplicateOf: 'accepted',
          factIds: ['fact:duplicate'],
          obligationIds: [matched.obligationId],
          canonicalSubjectRefs: [matched.canonicalSubjectRef],
          parentSubjectRefs: ['repo:repo'],
        },
      ],
      excludedObservations: [
        {
          observationId: 'excluded',
          reasonCode: 'frozen-policy-exclusion',
          factIds: ['fact:excluded'],
          obligationIds: [matched.obligationId],
          canonicalSubjectRefs: [matched.canonicalSubjectRef],
          parentSubjectRefs: ['repo:repo'],
        },
      ],
      errorObservations: [
        {
          observationId: 'error',
          reasonCode: 'backend-failed',
          factIds: [],
          obligationIds: [failed.obligationId],
          canonicalSubjectRefs: [failed.canonicalSubjectRef],
          parentSubjectRefs: ['repo:repo'],
        },
      ],
      inspectedNoPatternObservations: [
        {
          observationId: 'no-pattern',
          obligationId: noPattern.obligationId,
          canonicalSubjectRef: noPattern.canonicalSubjectRef,
          parentSubjectRefs: ['repo:repo'],
          executionReceiptHash: noPattern.receiptHash,
          outputHash: noPattern.outputHash,
          denominatorHash: noPattern.denominatorHash,
        },
      ],
    };

    expect(canonicalizeObservationPopulationV1(input)).toMatchObject({
      completion: 'unknown',
      conservation: {
        raw: 5,
        accepted: 1,
        duplicate: 1,
        excluded: 1,
        error: 1,
        inspectedNoPattern: 1,
        omitted: 0,
      },
    });
    expect(
      canonicalizeObservationPopulationV1({
        ...input,
        errorObservations: [],
        denominator: {
          ...denominator,
          expectedObservationIds: ['accepted', 'duplicate', 'excluded', 'no-pattern'],
          expectedObligationIds: [matched.obligationId, noPattern.obligationId],
          executionReceiptHashes: [matched.receiptHash, noPattern.receiptHash],
          outputHashes: [matched.outputHash, noPattern.outputHash],
          denominatorHashes: [matched.denominatorHash, noPattern.denominatorHash],
        },
      }).completion
    ).toBe('unknown');
  });

  it('keeps split and singleton clusters but rejects a merge without member evidence', () => {
    const factA = directFact('obligation-clusters', '1', 'mechanism a');
    const factB = directFact('obligation-clusters', '2', 'mechanism b');
    const receipt = executionReceipt({
      obligationId: 'obligation-clusters',
      disposition: 'matched',
      emittedFactIds: [factA.factId, factB.factId],
    });
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-clusters',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['o1', 'o2'],
        expectedObligationIds: [receipt.obligationId],
        executionReceiptHashes: [receipt.receiptHash],
        outputHashes: [receipt.outputHash],
        denominatorHashes: [receipt.denominatorHash],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      executionReceipts: [receipt],
      observations: [
        {
          observationId: 'o1',
          factIds: [factA.factId],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: ['file:a'],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
        {
          observationId: 'o2',
          factIds: [factB.factId],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: ['file:b'],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: ['different-invariant'],
          negativeControl: false,
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [],
    });

    const splitClusterSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:a',
          mechanism: { invariant: 'a' },
          observationIds: ['o1'],
          mechanismEvidenceFactIds: [factA.factId],
          anatomyLensIds: [],
        },
        {
          mechanismKey: 'mechanism:b',
          mechanism: { invariant: 'b' },
          observationIds: ['o2'],
          mechanismEvidenceFactIds: [factB.factId],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });
    expect(splitClusterSet.clusters).toHaveLength(2);

    const mergedClusterSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:shared',
          mechanism: { invariant: 'a and b' },
          observationIds: ['o1', 'o2'],
          mechanismEvidenceFactIds: [factA.factId, factB.factId],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });
    const transitionScheduleLineage = authorityScheduleLineage([receipt]);
    const finalSchedule = transitionScheduleLineage.finalExpandedSchedule;
    const terminalObligations = [
      {
        obligationId: receipt.obligationId,
        disposition: 'matched' as const,
        terminalReceiptId: receipt.terminalReceiptId,
      },
    ];
    const analysisReviewContextHash = createAnalysisReviewContextHashV1({
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      terminalObligations,
      populationHashes: [population.populationHash],
      clusterSetHashes: [mergedClusterSet.clusterSetHash],
    });
    const transitionReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'semantic-merge',
      currentAnalysisFixpointHash: analysisReviewContextHash,
      populationHash: population.populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'semantic-merge',
        populationHash: population.populationHash,
        sourceClusterSetHash: splitClusterSet.clusterSetHash,
        targetClusterSetHash: mergedClusterSet.clusterSetHash,
        sourceClusterIds: splitClusterSet.clusters.map((cluster) => cluster.clusterId),
        targetClusterIds: mergedClusterSet.clusters.map((cluster) => cluster.clusterId),
        observationIds: ['o1', 'o2'],
        reasonCode: 'same-reviewed-mechanism',
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'same-reviewed-mechanism',
    });
    const transition = createKnowledgeClusterSemanticTransitionV1({
      reviewKind: 'semantic-merge',
      sourceClusterSet: splitClusterSet,
      targetClusterSet: mergedClusterSet,
      sourceClusterIds: splitClusterSet.clusters.map((cluster) => cluster.clusterId),
      targetClusterIds: mergedClusterSet.clusters.map((cluster) => cluster.clusterId),
      reasonCode: 'same-reviewed-mechanism',
      dispositionReview: transitionReview,
    });
    expect(transition).toMatchObject({
      reviewKind: 'semantic-merge',
      observationIds: ['o1', 'o2'],
      dispositionReviewReceiptId: transitionReview.reviewReceiptId,
    });
    const mergedCluster = mergedClusterSet.clusters[0]!;
    const zeroProposalHash = hashKnowledgeDispositionProposalV1({
      reviewKind: 'zero-hypothesis',
      populationHash: population.populationHash,
      clusterHash: hashKnowledgeClusterV1(mergedCluster),
      clusterId: mergedCluster.clusterId,
      observationIds: mergedCluster.observationIds,
      mode: 'recurring',
      zeroHypothesisReason: 'insufficient-evidence',
    });
    const zeroReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'zero-hypothesis',
      currentAnalysisFixpointHash: analysisReviewContextHash,
      populationHash: population.populationHash,
      proposedDispositionHash: zeroProposalHash,
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'d'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'bounded-evidence-does-not-support-induction',
    });
    const induction = createInductionReceiptV1({
      populationHash: population.populationHash,
      clusterHash: hashKnowledgeClusterV1(mergedCluster),
      clusterId: mergedCluster.clusterId,
      observationIds: mergedCluster.observationIds,
      mode: 'recurring',
      hypotheses: [],
      currentAnalysisFixpointHash: analysisReviewContextHash,
      zeroHypothesisReason: 'insufficient-evidence',
      zeroHypothesisDispositionReview: zeroReview,
    });
    const fixpoint = createAnalysisFixpointReceiptV1({
      finalExpandedSchedule: finalSchedule,
      terminalObligations,
      populationHashes: [population.populationHash],
      clusterSets: [mergedClusterSet],
      inductionReceiptHashes: [induction.receiptHash],
      falsificationReceiptHashes: [],
    });
    const transitionAuthorityInput = {
      runId: 'run-semantic-authority',
      sourceRevisionVectorHash: SOURCE_REVISION,
      analysisFixpoint: fixpoint,
      privateCorpusRevision: 'revision-semantic-transition',
      factExecution: factExecutionResult(receipt, [factA, factB]),
      ...transitionScheduleLineage,
      populations: [population],
      historicalClusterSets: [splitClusterSet],
      clusterSets: [mergedClusterSet],
      clusterTransitions: [transition],
      inductions: [induction],
      falsifications: [],
      dispositionReviews: [transitionReview, zeroReview],
      expressionSets: [],
      candidateAttemptBatches: [],
      serialAdmissionLedger: null,
      terminalEvidence: EMPTY_TERMINAL_EVIDENCE,
      resourceCaps: {
        candidateAttemptCap: 0,
        maxAuthoredCandidatesPerCellPass: 0,
      },
    } as const;
    expect(createStrictProductionAuthorityReceiptV1(transitionAuthorityInput)).toMatchObject({
      clusterTransitionHashes: [transition.transitionHash],
      inductionReceiptHashes: [induction.receiptHash],
    });
    const alternateHistoricalSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:alternate-a',
          mechanism: { invariant: 'alternate a' },
          observationIds: ['o1'],
          mechanismEvidenceFactIds: [factA.factId],
          anatomyLensIds: [],
        },
        {
          mechanismKey: 'mechanism:alternate-b',
          mechanism: { invariant: 'alternate b' },
          observationIds: ['o2'],
          mechanismEvidenceFactIds: [factB.factId],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...transitionAuthorityInput,
        historicalClusterSets: [splitClusterSet, alternateHistoricalSet],
      })
    ).toThrow('STRICT_PRODUCTION_HISTORICAL_CLUSTER_ORPHANED');

    expect(() =>
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [
          {
            mechanismKey: 'mechanism:incorrect-merge',
            mechanism: { invariant: 'a only' },
            observationIds: ['o1', 'o2'],
            mechanismEvidenceFactIds: [factA.factId],
            anatomyLensIds: [],
          },
        ],
        nonClusteredDispositions: [],
      })
    ).toThrow('CLUSTER_MEMBER_EVIDENCE_INCOMPLETE');
  });

  it('rejects a semantic transition that changes an unreviewed complement cluster', () => {
    const factA = directFact('obligation-transition-complement', '1', 'mechanism a');
    const factB = directFact('obligation-transition-complement', '2', 'mechanism b');
    const factC = directFact('obligation-transition-complement', '3', 'mechanism c');
    const receipt = executionReceipt({
      obligationId: 'obligation-transition-complement',
      disposition: 'matched',
      emittedFactIds: [factA.factId, factB.factId, factC.factId],
    });
    const observations = [factA, factB, factC].map((fact, index) => ({
      observationId: `o${index + 1}`,
      factIds: [fact.factId],
      obligationIds: [receipt.obligationId],
      canonicalSubjectRefs: [fact.canonicalSubjectRef],
      parentSubjectRefs: [] as string[],
      variantKeys: [] as string[],
      outlierReasonCodes: [] as string[],
      negativeControl: false,
    }));
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-transition-complement',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: observations.map((row) => row.observationId),
        expectedObligationIds: [receipt.obligationId],
        executionReceiptHashes: [receipt.receiptHash],
        outputHashes: [receipt.outputHash],
        denominatorHashes: [receipt.denominatorHash],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      executionReceipts: [receipt],
      observations,
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [],
    });
    const sourceClusterSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:a',
          mechanism: { invariant: 'a' },
          observationIds: ['o1'],
          mechanismEvidenceFactIds: [factA.factId],
          anatomyLensIds: [],
        },
        {
          mechanismKey: 'mechanism:b',
          mechanism: { invariant: 'b' },
          observationIds: ['o2'],
          mechanismEvidenceFactIds: [factB.factId],
          anatomyLensIds: [],
        },
        {
          mechanismKey: 'mechanism:c',
          mechanism: { invariant: 'c' },
          observationIds: ['o3'],
          mechanismEvidenceFactIds: [factC.factId],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });
    const targetClusterSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'mechanism:ab',
          mechanism: { invariant: 'a and b' },
          observationIds: ['o1', 'o2'],
          mechanismEvidenceFactIds: [factA.factId, factB.factId],
          anatomyLensIds: [],
        },
        {
          mechanismKey: 'mechanism:c-rewritten-without-review',
          mechanism: { invariant: 'c prime' },
          observationIds: ['o3'],
          mechanismEvidenceFactIds: [factC.factId],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });
    const sourceClusterIds = sourceClusterSet.clusters
      .filter((cluster) => cluster.observationIds.some((id) => id === 'o1' || id === 'o2'))
      .map((cluster) => cluster.clusterId);
    const targetClusterIds = targetClusterSet.clusters
      .filter((cluster) => cluster.observationIds.includes('o1'))
      .map((cluster) => cluster.clusterId);
    const proposalHash = hashKnowledgeDispositionProposalV1({
      reviewKind: 'semantic-merge',
      populationHash: population.populationHash,
      sourceClusterSetHash: sourceClusterSet.clusterSetHash,
      targetClusterSetHash: targetClusterSet.clusterSetHash,
      sourceClusterIds,
      targetClusterIds,
      observationIds: ['o1', 'o2'],
      reasonCode: 'merge-ab-only',
    });
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'semantic-merge',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: population.populationHash,
      proposedDispositionHash: proposalHash,
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'d'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'merge-ab-only',
    });
    expect(() =>
      createKnowledgeClusterSemanticTransitionV1({
        reviewKind: 'semantic-merge',
        sourceClusterSet,
        targetClusterSet,
        sourceClusterIds,
        targetClusterIds,
        reasonCode: 'merge-ab-only',
        dispositionReview: review,
      })
    ).toThrow('CLUSTER_TRANSITION_REVIEW_INVALID');
  });

  it('binds investigated-empty to non-empty real execution outputs and an independent review', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-empty',
      disposition: 'inspected-no-pattern',
    });
    const executionScope = reviewExecutionScope([receipt]);
    const finalExpandedScheduleHash =
      executionScope.finalExpandedSchedule.finalExpandedScheduleHash;
    const populationHash = `sha256:${'a'.repeat(64)}`;
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'investigated-empty',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'investigated-empty',
        populationHash,
        sourceRevisionVectorHash: SOURCE_REVISION,
        finalExpandedScheduleHash,
        currentAnalysisFixpointHash: FIXPOINT,
        expectedObligationIds: [receipt.obligationId],
        executionBindings: [
          {
            obligationId: receipt.obligationId,
            executionReceiptHash: receipt.receiptHash,
            executionOutputHash: receipt.outputHash,
            denominatorHash: receipt.denominatorHash,
            disposition: receipt.disposition,
            terminalReceiptId: receipt.terminalReceiptId,
          },
        ],
        evidenceEntryIds: ['E-1'],
      }),
      executionReceipts: [receipt],
      ...executionScope,
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'complete-negative-denominator',
    });
    const decision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: SOURCE_REVISION,
      finalExpandedScheduleHash,
      currentAnalysisFixpointHash: FIXPOINT,
      expectedObligationIds: [receipt.obligationId],
      executionReceipts: [receipt],
      dispositionReview: review,
      evidenceEntryIds: ['E-1'],
    });

    expect(decision.verdict).toBe('pass');
    expect(
      createInvestigatedEmptyDecisionV1({
        sourceRevisionVectorHash: SOURCE_REVISION,
        finalExpandedScheduleHash: `sha256:${'d'.repeat(64)}`,
        currentAnalysisFixpointHash: FIXPOINT,
        expectedObligationIds: [],
        executionReceipts: [],
        dispositionReview: review,
        evidenceEntryIds: ['E-1'],
      })
    ).toMatchObject({ verdict: 'unknown', reasonCode: 'EMPTY_DENOMINATOR_REQUIRED' });
  });

  it('rejects caller strings and self-review as semantic disposition authority', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-review',
      disposition: 'inspected-no-pattern',
    });
    const producer = actor('producer');
    expect(() =>
      createKnowledgeDispositionReviewV1({
        reviewKind: 'investigated-empty',
        currentAnalysisFixpointHash: FIXPOINT,
        populationHash: `sha256:${'a'.repeat(64)}`,
        proposedDispositionHash: `sha256:${'b'.repeat(64)}`,
        executionReceipts: [receipt],
        ...reviewExecutionScope([receipt]),
        producer,
        reviewer: producer,
        calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
        verdict: 'pass',
        reasonCode: 'self-certified',
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
    const sameOutputReviewer = createProductionActorIdentityV1({
      providerId: 'provider:frozen',
      modelId: 'model:strict-v1',
      modelVersion: '2026-07-27',
      promptHash: `sha256:${'4'.repeat(64)}`,
      runId: 'run-semantic-authority',
      invocationId: 'invocation:reviewer-same-output',
      loadReceiptHash: `sha256:${'6'.repeat(64)}`,
      outputHash: producer.outputHash,
    });
    expect(() =>
      createKnowledgeDispositionReviewV1({
        reviewKind: 'investigated-empty',
        currentAnalysisFixpointHash: FIXPOINT,
        populationHash: `sha256:${'a'.repeat(64)}`,
        proposedDispositionHash: `sha256:${'b'.repeat(64)}`,
        executionReceipts: [receipt],
        ...reviewExecutionScope([receipt]),
        producer,
        reviewer: sameOutputReviewer,
        calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
        verdict: 'pass',
        reasonCode: 'same-output-self-certification',
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  });

  it('rejects zero-hypothesis and Producer non-draft reviews rebound to another subject', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-review-rebind',
      disposition: 'inspected-no-pattern',
    });
    const populationHash = `sha256:${'a'.repeat(64)}`;
    const zeroReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'zero-hypothesis',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'zero-hypothesis',
        populationHash,
        clusterHash: `sha256:${'b'.repeat(64)}`,
        clusterId: 'cluster:a',
        observationIds: ['observation:a'],
        mode: 'bounded-singleton',
        zeroHypothesisReason: 'insufficient-evidence',
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'zero-reviewed',
    });
    expect(() =>
      createInductionReceiptV1({
        populationHash,
        clusterHash: `sha256:${'d'.repeat(64)}`,
        clusterId: 'cluster:b',
        observationIds: ['observation:b'],
        mode: 'bounded-singleton',
        hypotheses: [],
        currentAnalysisFixpointHash: FIXPOINT,
        zeroHypothesisReason: 'insufficient-evidence',
        zeroHypothesisDispositionReview: zeroReview,
      })
    ).toThrow('INDUCTION_ZERO_REASON_REQUIRED');

    const producerReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'producer-non-draft',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'producer-non-draft',
        populationHash,
        hypothesisId: 'hypothesis:a',
        expression: null,
        zeroDisposition: {
          reasonCode: 'reviewed-zero-expression',
          terminalFate: 'reviewed-non-draft',
        },
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'non-draft-reviewed',
    });
    expect(() =>
      validateHypothesisExpressionSetReceiptV1({
        schemaVersion: 1,
        receiptId: 'expression-set:review-rebind',
        hypothesisId: 'hypothesis:b',
        analysisFixpointHash: FIXPOINT,
        privateCorpusRevision: 'revision-review-rebind',
        version: 1,
        parentReceiptId: null,
        terminalHead: true,
        expressions: [],
        zeroDisposition: {
          reasonCode: 'reviewed-zero-expression',
          reviewerReceiptId: producerReview.reviewReceiptId,
          dispositionReview: producerReview,
          terminalFate: 'reviewed-non-draft',
        },
      })
    ).toThrow('EXPRESSION_SET_ZERO_DISPOSITION_UNREVIEWED');
  });

  it('never lets an enrolled but empty counterquery execution survive falsification', () => {
    const receipt = executionReceipt({
      obligationId: 'counterquery:required',
      disposition: 'inspected-no-pattern',
    });
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'falsification',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: `sha256:${'a'.repeat(64)}`,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'falsification',
        populationHash: `sha256:${'a'.repeat(64)}`,
        hypothesisId: 'hypothesis:counterquery',
        enrolledCounterqueryIds: [receipt.obligationId],
        executions: [],
        counterqueryApplicability: {
          status: 'required',
          reasonCode: 'negative-search-required',
        },
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'counterquery-reviewed',
    });
    const emptyExecution = createFalsificationReceiptV1({
      hypothesisId: 'hypothesis:counterquery',
      enrolledCounterqueryIds: [receipt.obligationId],
      executions: [],
      counterqueryApplicability: {
        status: 'required',
        reasonCode: 'negative-search-required',
        reviewerReceiptId: null,
      },
      currentAnalysisFixpointHash: FIXPOINT,
      dispositionReview: review,
    });
    expect(emptyExecution.verdict).toBe('unknown');

    const terminalReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'falsification',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: `sha256:${'a'.repeat(64)}`,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'falsification',
        populationHash: `sha256:${'a'.repeat(64)}`,
        hypothesisId: 'hypothesis:counterquery',
        enrolledCounterqueryIds: [receipt.obligationId],
        executions: [
          {
            counterqueryId: receipt.obligationId,
            obligationId: receipt.obligationId,
            executionReceiptHash: receipt.receiptHash,
            executionOutputHash: receipt.outputHash,
            denominatorHash: receipt.denominatorHash,
            counterexampleFactIds: [],
          },
        ],
        counterqueryApplicability: {
          status: 'required',
          reasonCode: 'negative-search-required',
        },
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'counterquery-reviewed',
    });
    const terminal = createFalsificationReceiptV1({
      hypothesisId: 'hypothesis:counterquery',
      enrolledCounterqueryIds: [receipt.obligationId],
      executions: [
        {
          counterqueryId: receipt.obligationId,
          obligationId: receipt.obligationId,
          executionReceipt: receipt,
          counterexampleFactIds: [],
        },
      ],
      counterqueryApplicability: {
        status: 'required',
        reasonCode: 'negative-search-required',
        reviewerReceiptId: null,
      },
      currentAnalysisFixpointHash: FIXPOINT,
      dispositionReview: terminalReview,
    });
    expect(terminal.verdict).toBe('survived');
    expect(() =>
      createFalsificationReceiptV1({
        hypothesisId: 'hypothesis:counterquery',
        enrolledCounterqueryIds: [receipt.obligationId],
        executions: [
          {
            counterqueryId: receipt.obligationId,
            obligationId: receipt.obligationId,
            executionReceipt: { ...receipt, outputHash: `sha256:${'0'.repeat(64)}` },
            counterexampleFactIds: [],
          },
        ],
        counterqueryApplicability: {
          status: 'required',
          reasonCode: 'negative-search-required',
          reviewerReceiptId: null,
        },
        currentAnalysisFixpointHash: FIXPOINT,
        dispositionReview: terminalReview,
      })
    ).toThrow('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
  });

  it('consumes fact, population, cluster, review, expression, attempt, admission, and cap primitives through one public contract', () => {
    const obligationId = 'obligation-production-authority';
    const canonicalSubjectRef = `file:repo:src/${obligationId}.ts`;
    const fact = createFactRecordV1({
      factFamilyId: 'syntax-idiom',
      canonicalSubjectRef,
      primaryScale: 'file',
      sourceRevisionVectorHash: SOURCE_REVISION,
      value: { behavior: 'uses an exact deterministic authority chain' },
      witnesses: [
        {
          kind: 'direct',
          evidenceEntryId: 'E-1',
          evidenceSessionId: 'session-production-authority',
          evidenceContentHash: `sha256:${'a'.repeat(64)}`,
          sourceRevisionVectorHash: SOURCE_REVISION,
          projectContextRefId: canonicalSubjectRef,
          projectContextRefHash: `sha256:${'b'.repeat(64)}`,
          canonicalSubjectRef,
          anchor: {
            relativePath: `src/${obligationId}.ts`,
            blobHash: `sha256:${'9'.repeat(64)}`,
            range: { startLine: 1, endLine: 1 },
          },
        },
      ],
    });
    const receipt = executionReceipt({
      obligationId,
      disposition: 'matched',
      emittedFactIds: [fact.factId],
    });
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-production-authority',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['observation-production-authority'],
        expectedObligationIds: [receipt.obligationId],
        executionReceiptHashes: [receipt.receiptHash],
        outputHashes: [receipt.outputHash],
        denominatorHashes: [receipt.denominatorHash],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      executionReceipts: [receipt],
      observations: [
        {
          observationId: 'observation-production-authority',
          factIds: [fact.factId],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: [receipt.canonicalSubjectRef],
          parentSubjectRefs: ['repo:repo'],
          variantKeys: ['deterministic'],
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
          mechanismKey: 'mechanism:deterministic-authority',
          mechanism: { invariant: 'every terminal edge is bound exactly once' },
          observationIds: ['observation-production-authority'],
          mechanismEvidenceFactIds: [fact.factId],
          anatomyLensIds: ['entrypoint-and-contract'],
        },
      ],
      nonClusteredDispositions: [],
    });
    const cluster = clusterSet.clusters[0]!;
    const scheduleLineage = authorityScheduleLineage([receipt]);
    const finalSchedule = scheduleLineage.finalExpandedSchedule;
    const analysisReviewContextHash = createAnalysisReviewContextHashV1({
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      terminalObligations: [
        {
          obligationId: receipt.obligationId,
          disposition: 'matched',
          terminalReceiptId: receipt.terminalReceiptId,
        },
      ],
      populationHashes: [population.populationHash],
      clusterSetHashes: [clusterSet.clusterSetHash],
    });
    const induction = createInductionReceiptV1({
      populationHash: population.populationHash,
      clusterHash: hashKnowledgeClusterV1(cluster),
      clusterId: cluster.clusterId,
      observationIds: cluster.observationIds,
      mode: 'bounded-singleton',
      hypotheses: [
        {
          hypothesisId: 'hypothesis:production-authority',
          statement: 'The terminal authority conserves every semantic edge.',
          premiseFactIds: [fact.factId],
        },
      ],
      currentAnalysisFixpointHash: analysisReviewContextHash,
    });
    const falsificationReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'falsification',
      currentAnalysisFixpointHash: analysisReviewContextHash,
      populationHash: population.populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'falsification',
        populationHash: population.populationHash,
        hypothesisId: 'hypothesis:production-authority',
        enrolledCounterqueryIds: [],
        executions: [],
        counterqueryApplicability: {
          status: 'not-required',
          reasonCode: 'exact-bounded-contract',
        },
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'5'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'bounded-contract-needs-no-counterquery',
    });
    const falsification = createFalsificationReceiptV1({
      hypothesisId: 'hypothesis:production-authority',
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
    const fixpoint = createAnalysisFixpointReceiptV1({
      finalExpandedSchedule: finalSchedule,
      terminalObligations: [
        {
          obligationId: receipt.obligationId,
          disposition: 'matched',
          terminalReceiptId: receipt.terminalReceiptId,
        },
      ],
      populationHashes: [population.populationHash],
      clusterSets: [clusterSet],
      inductionReceiptHashes: [induction.receiptHash],
      falsificationReceiptHashes: [falsification.receiptHash],
    });
    expect(fixpoint.analysisReviewContextHash).toBe(analysisReviewContextHash);
    const contentReadyTerminal = contentReadyTerminalEvidence({
      runId: 'run-semantic-authority',
      analysisFixpointHash: fixpoint.fixpointHash,
      privateCorpusRevision: 'revision-production-authority',
      authoredFingerprint: `sha256:${'7'.repeat(64)}`,
    });
    const expressionSet = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: 'expression-set:production-authority',
      hypothesisId: 'hypothesis:production-authority',
      analysisFixpointHash: fixpoint.fixpointHash,
      privateCorpusRevision: 'revision-production-authority',
      version: 1,
      parentReceiptId: null,
      terminalHead: true,
      expressions: [
        {
          expressionId: 'expression:production-authority',
          authoredFingerprint: `sha256:${'7'.repeat(64)}`,
          terminalFate: 'content-ready',
          terminalReceiptId: contentReadyTerminal.terminalReceiptId,
          terminalReceiptHash: contentReadyTerminal.terminalReceiptHash,
        },
      ],
      zeroDisposition: null,
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [],
        falsifications: [falsification],
        dispositionReviews: [falsificationReview],
        expressionSets: [expressionSet],
        candidateAttemptBatches: [],
        serialAdmissionLedger: null,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_CLUSTER_INDUCTION_CONSERVATION_FAILED');
    const candidateBatch = canonicalizeCandidateAttemptBatchV1({
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
      attempts: [
        {
          runId: 'run-semantic-authority',
          analysisFixpointHash: fixpoint.fixpointHash,
          privateCorpusRevision: 'revision-production-authority',
          hypothesisId: 'hypothesis:production-authority',
          expressionSetReceiptId: expressionSet.receiptId,
          expressionId: 'expression:production-authority',
          terminalReceiptId: expressionSet.expressions[0]!.terminalReceiptId,
          terminalReceiptHash: expressionSet.expressions[0]!.terminalReceiptHash,
          cellId: 'core::architecture',
          criticality: 'critical',
          passOrdinal: 0,
          authoredFingerprint: `sha256:${'7'.repeat(64)}`,
          causalParentIds: [],
        },
      ],
    });
    const acceptedCorpusHash =
      contentReadyTerminal.terminalEvidence.corpusInspections[0]!.acceptedCorpusHash;
    const admissionLedger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: acceptedCorpusHash,
      rows: [
        {
          proposalId: candidateBatch.attempts[0]!.attemptId,
          attemptHash: candidateBatch.attempts[0]!.attemptHash,
          authoredFingerprint: candidateBatch.attempts[0]!.authoredFingerprint,
          observedAcceptedCorpusHash: acceptedCorpusHash,
          terminalFate: 'accepted',
          resultingAcceptedCorpusHash: `sha256:${'9'.repeat(64)}`,
          terminalReceiptId: expressionSet.expressions[0]!.terminalReceiptId,
          terminalReceiptHash: expressionSet.expressions[0]!.terminalReceiptHash,
        },
      ],
    });

    const authorityInput = {
      runId: 'run-semantic-authority',
      sourceRevisionVectorHash: SOURCE_REVISION,
      analysisFixpoint: fixpoint,
      privateCorpusRevision: 'revision-production-authority',
      factExecution: factExecutionResult(receipt, [fact]),
      ...scheduleLineage,
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
    } as const;
    const authority = createStrictProductionAuthorityReceiptV1(authorityInput);

    expect(authority).toMatchObject({
      contractVersion: 'strict-production-authority-v1',
      analysisFixpointHash: fixpoint.fixpointHash,
      resourceConservation: {
        candidateAttemptCap: 2,
        consumedCandidateAttempts: 1,
        remainingCandidateAttempts: 1,
      },
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        terminalEvidence: EMPTY_TERMINAL_EVIDENCE,
      })
    ).toThrow('STRICT_PRODUCTION_TERMINAL_EVIDENCE_MISMATCH');
    const reusedTerminalExpressionSet = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: 'expression-set:reused-terminal-authority',
      hypothesisId: expressionSet.hypothesisId,
      analysisFixpointHash: expressionSet.analysisFixpointHash,
      privateCorpusRevision: expressionSet.privateCorpusRevision,
      version: 1,
      parentReceiptId: null,
      terminalHead: true,
      expressions: [
        {
          ...expressionSet.expressions[0]!,
          expressionId: 'expression:reused-terminal-a',
        },
        {
          ...expressionSet.expressions[0]!,
          expressionId: 'expression:reused-terminal-b',
        },
      ],
      zeroDisposition: null,
    });
    const reusedTerminalBatch = canonicalizeCandidateAttemptBatchV1({
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
      attempts: reusedTerminalExpressionSet.expressions.map((expression, index) => ({
        runId: 'run-semantic-authority',
        analysisFixpointHash: fixpoint.fixpointHash,
        privateCorpusRevision: 'revision-production-authority',
        hypothesisId: reusedTerminalExpressionSet.hypothesisId,
        expressionSetReceiptId: reusedTerminalExpressionSet.receiptId,
        expressionId: expression.expressionId,
        terminalReceiptId: expression.terminalReceiptId,
        terminalReceiptHash: expression.terminalReceiptHash,
        cellId: `core::reused-terminal-${index}`,
        criticality: 'critical' as const,
        passOrdinal: 0,
        authoredFingerprint: expression.authoredFingerprint,
        causalParentIds: [],
      })),
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        expressionSets: [reusedTerminalExpressionSet],
        candidateAttemptBatches: [reusedTerminalBatch],
        serialAdmissionLedger: null,
      })
    ).toThrow('STRICT_PRODUCTION_TERMINAL_EVIDENCE_REUSED');
    const staleCorpusLedger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: `sha256:${'8'.repeat(64)}`,
      rows: [
        {
          ...admissionLedger.rows[0]!,
          observedAcceptedCorpusHash: `sha256:${'8'.repeat(64)}`,
        },
      ],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        serialAdmissionLedger: staleCorpusLedger,
      })
    ).toThrow('STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED');
    const reboundLensBindings = [
      {
        bindingId: 'lens-binding:unrelated',
        cellId: 'core::unrelated',
        anatomyLensId: 'entrypoint-and-contract' as const,
        questionIds: ['question:unrelated'],
        factFamilyIds: [receipt.factFamilyId],
        counterqueryRequired: false,
      },
    ];
    const reboundLensBindingsHash = hashCanonicalJson(reboundLensBindings);
    const reboundBaselineSchedule = {
      ...scheduleLineage.baselineSchedule,
      lensBindings: reboundLensBindings,
      lensBindingsHash: reboundLensBindingsHash,
      baselineScheduleHash: hashCanonicalJson({
        factHarvestScheduleHash: scheduleLineage.baselineSchedule.factHarvestScheduleHash,
        lensBindingsHash: reboundLensBindingsHash,
      }),
    };
    const reboundFinalSchedule = createFinalExpandedMiningScheduleReceiptV1({
      baselineScheduleHash: reboundBaselineSchedule.baselineScheduleHash,
      baselineObligationIds: reboundBaselineSchedule.factHarvestObligations.map(
        (row) => row.obligationId
      ),
      expansionReceipts: [],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        baselineSchedule: reboundBaselineSchedule,
        finalFactSchedule: reboundBaselineSchedule,
        finalExpandedSchedule: reboundFinalSchedule,
      })
    ).toThrow('STRICT_PRODUCTION_SCHEDULE_LINEAGE_MISMATCH');

    const investigatedProposalHash = hashKnowledgeDispositionProposalV1({
      reviewKind: 'investigated-empty',
      populationHash: population.populationHash,
      sourceRevisionVectorHash: SOURCE_REVISION,
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      currentAnalysisFixpointHash: fixpoint.fixpointHash,
      expectedObligationIds: [receipt.obligationId],
      executionBindings: [
        {
          obligationId: receipt.obligationId,
          executionReceiptHash: receipt.receiptHash,
          executionOutputHash: receipt.outputHash,
          denominatorHash: receipt.denominatorHash,
          disposition: receipt.disposition,
          terminalReceiptId: receipt.terminalReceiptId,
        },
      ],
      evidenceEntryIds: ['E-1'],
    });
    const investigatedReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'investigated-empty',
      currentAnalysisFixpointHash: fixpoint.fixpointHash,
      populationHash: population.populationHash,
      proposedDispositionHash: investigatedProposalHash,
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'d'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'matched-must-not-be-empty',
    });
    const unknownInvestigatedDecision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: SOURCE_REVISION,
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      currentAnalysisFixpointHash: fixpoint.fixpointHash,
      expectedObligationIds: [receipt.obligationId],
      executionReceipts: [receipt],
      dispositionReview: investigatedReview,
      evidenceEntryIds: ['E-1'],
    });
    expect(unknownInvestigatedDecision.verdict).toBe('unknown');
    const { decisionHash: _decisionHash, ...unknownInvestigatedDecisionSemantic } =
      unknownInvestigatedDecision;
    const forgedInvestigatedDecisionSemantic = {
      ...unknownInvestigatedDecisionSemantic,
      verdict: 'pass' as const,
      reasonCode: 'COMPLETE_DENOMINATOR_INVESTIGATED_EMPTY',
    };
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [falsification],
        investigatedEmptyDecisions: [
          {
            ...forgedInvestigatedDecisionSemantic,
            decisionHash: hashCanonicalJson(forgedInvestigatedDecisionSemantic),
          },
        ],
        dispositionReviews: [falsificationReview, investigatedReview],
        expressionSets: [expressionSet],
        candidateAttemptBatches: [candidateBatch],
        serialAdmissionLedger: admissionLedger,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_MISMATCH');

    const historicalExpressionSet = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: 'expression-set:production-authority-v1',
      hypothesisId: 'hypothesis:production-authority',
      analysisFixpointHash: fixpoint.fixpointHash,
      privateCorpusRevision: 'revision-production-authority',
      version: 1,
      parentReceiptId: null,
      terminalHead: false,
      expressions: expressionSet.expressions,
      zeroDisposition: null,
    });
    const terminalExpressionSet = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: 'expression-set:production-authority-v2',
      hypothesisId: 'hypothesis:production-authority',
      analysisFixpointHash: fixpoint.fixpointHash,
      privateCorpusRevision: 'revision-production-authority',
      version: 2,
      parentReceiptId: historicalExpressionSet.receiptId,
      terminalHead: true,
      expressions: expressionSet.expressions,
      zeroDisposition: null,
    });
    const terminalOnlyBatch = canonicalizeCandidateAttemptBatchV1({
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
      attempts: [
        {
          ...candidateBatch.attempts[0]!,
          expressionSetReceiptId: terminalExpressionSet.receiptId,
        },
      ],
    });
    const terminalOnlyLedger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: admissionLedger.initialAcceptedCorpusHash,
      rows: [
        {
          ...admissionLedger.rows[0]!,
          proposalId: terminalOnlyBatch.attempts[0]!.attemptId,
          attemptHash: terminalOnlyBatch.attempts[0]!.attemptHash,
        },
      ],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [falsification],
        dispositionReviews: [falsificationReview],
        expressionSets: [historicalExpressionSet, terminalExpressionSet],
        candidateAttemptBatches: [terminalOnlyBatch],
        serialAdmissionLedger: terminalOnlyLedger,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_CANDIDATE_EXPRESSION_CONSERVATION_FAILED');
    const duplicatedExpressionBatch = canonicalizeCandidateAttemptBatchV1({
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
      attempts: [
        {
          ...candidateBatch.attempts[0]!,
          expressionSetReceiptId: terminalExpressionSet.receiptId,
          cellId: 'core::architecture-a',
        },
        {
          ...candidateBatch.attempts[0]!,
          expressionSetReceiptId: terminalExpressionSet.receiptId,
          cellId: 'core::architecture-b',
        },
      ],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        expressionSets: [historicalExpressionSet, terminalExpressionSet],
        candidateAttemptBatches: [duplicatedExpressionBatch],
        serialAdmissionLedger: null,
      })
    ).toThrow('STRICT_PRODUCTION_CANDIDATE_EXPRESSION_CONSERVATION_FAILED');

    const { receiptHash: _inductionHash, ...inductionSemantic } = induction;
    const forgedInductionSemantic = {
      ...inductionSemantic,
      hypotheses: [],
      zeroHypothesisReason: null,
      zeroHypothesisReviewReceiptId: null,
    };
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...{
          runId: 'run-semantic-authority',
          sourceRevisionVectorHash: SOURCE_REVISION,
          analysisFixpoint: fixpoint,
          privateCorpusRevision: 'revision-production-authority',
          factExecution: factExecutionResult(receipt, [fact]),
          ...scheduleLineage,
          populations: [population],
          clusterSets: [clusterSet],
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
        },
        inductions: [
          {
            ...forgedInductionSemantic,
            receiptHash: hashCanonicalJson(forgedInductionSemantic),
          },
        ],
      })
    ).toThrow('INDUCTION_ZERO_REASON_REQUIRED');

    const { receiptHash: _falsificationHash, ...falsificationSemantic } = falsification;
    const forgedFalsificationSemantic = {
      ...falsificationSemantic,
      verdict: 'refuted' as const,
    };
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [
          {
            ...forgedFalsificationSemantic,
            receiptHash: hashCanonicalJson(forgedFalsificationSemantic),
          },
        ],
        dispositionReviews: [falsificationReview],
        expressionSets: [expressionSet],
        candidateAttemptBatches: [candidateBatch],
        serialAdmissionLedger: admissionLedger,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_FALSIFICATION_LINEAGE_MISMATCH');

    const { receiptHash: _expressionHash, ...expressionSemantic } = expressionSet;
    const forgedExpressionSemantic = {
      ...expressionSemantic,
      expressions: [],
      zeroDisposition: null,
      conservation: { authored: 0, terminal: 0, unresolved: 0 },
      terminalClosure: 'expressed' as const,
    };
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [falsification],
        dispositionReviews: [falsificationReview],
        expressionSets: [
          {
            ...forgedExpressionSemantic,
            receiptHash: hashCanonicalJson(forgedExpressionSemantic),
          },
        ],
        candidateAttemptBatches: [],
        serialAdmissionLedger: null,
        terminalEvidence: EMPTY_TERMINAL_EVIDENCE,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('EXPRESSION_SET_ZERO_DISPOSITION_REQUIRED');

    const orphanReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'semantic-merge',
      currentAnalysisFixpointHash: analysisReviewContextHash,
      populationHash: population.populationHash,
      proposedDispositionHash: hashKnowledgeDispositionProposalV1({
        reviewKind: 'semantic-merge',
        populationHash: population.populationHash,
        sourceClusterSetHash: clusterSet.clusterSetHash,
        targetClusterSetHash: clusterSet.clusterSetHash,
        sourceClusterIds: [cluster.clusterId],
        targetClusterIds: [cluster.clusterId],
        observationIds: cluster.observationIds,
        reasonCode: 'orphan-must-not-authorize',
      }),
      executionReceipts: [receipt],
      ...reviewExecutionScope([receipt]),
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'6'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'orphan-must-not-authorize',
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [falsification],
        dispositionReviews: [falsificationReview, orphanReview],
        expressionSets: [expressionSet],
        candidateAttemptBatches: [candidateBatch],
        serialAdmissionLedger: admissionLedger,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_DISPOSITION_REVIEW_ORPHANED');

    const reboundAdmissionLedger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: admissionLedger.initialAcceptedCorpusHash,
      rows: [
        {
          ...admissionLedger.rows[0]!,
          proposalId: 'candidate-attempt:unrelated',
        },
      ],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        runId: 'run-semantic-authority',
        sourceRevisionVectorHash: SOURCE_REVISION,
        analysisFixpoint: fixpoint,
        privateCorpusRevision: 'revision-production-authority',
        factExecution: factExecutionResult(receipt, [fact]),
        ...scheduleLineage,
        populations: [population],
        clusterSets: [clusterSet],
        inductions: [induction],
        falsifications: [falsification],
        dispositionReviews: [falsificationReview],
        expressionSets: [expressionSet],
        candidateAttemptBatches: [candidateBatch],
        serialAdmissionLedger: reboundAdmissionLedger,
        terminalEvidence: contentReadyTerminal.terminalEvidence,
        resourceCaps: {
          candidateAttemptCap: 2,
          maxAuthoredCandidatesPerCellPass: 1,
        },
      })
    ).toThrow('STRICT_PRODUCTION_ADMISSION_ATTEMPT_CONSERVATION_FAILED');
  });
});

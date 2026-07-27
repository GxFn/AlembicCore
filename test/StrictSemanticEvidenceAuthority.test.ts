import { describe, expect, it } from 'vitest';
import {
  canonicalizeCandidateAttemptBatchV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createAnalysisReviewContextHashV1,
  createFalsificationReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInvestigatedEmptyDecisionV1,
  createKnowledgeDispositionReviewV1,
  createProductionActorIdentityV1,
  createStrictProductionAuthorityReceiptV1,
  type FactQueryExecutionReceiptV1,
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

function executionReceipt(input: {
  obligationId: string;
  disposition: FactQueryExecutionReceiptV1['disposition'];
  emittedFactIds?: readonly string[];
}): FactQueryExecutionReceiptV1 {
  const emittedFactIds = [...(input.emittedFactIds ?? [])].sort();
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
    obligationId: input.obligationId,
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
    obligationId: input.obligationId,
    factFamilyId: 'syntax-idiom',
    capabilityId: 'tree-sitter-query',
    canonicalSubjectRef: `file:repo:src/${input.obligationId}.ts`,
    analysisScale: 'file' as const,
    denominator: 'complete-frozen-subject' as const,
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

function factExecutionResult(receipt: FactQueryExecutionReceiptV1) {
  const terminalReceiptHashes = [receipt.receiptHash];
  const harvestReceiptHashes = [receipt.harvestReceiptHash];
  const denominatorHashes = [receipt.denominatorHash];
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: 'artifact:strict-production-probe',
    sourceRevisionVectorHash: SOURCE_REVISION,
    factQueryCatalogHash: `sha256:${'1'.repeat(64)}`,
    factHarvestScheduleHash: `sha256:${'2'.repeat(64)}`,
    backendRegistryHash: `sha256:${'3'.repeat(64)}`,
    obligationCount: 1,
    terminalReceiptIds: [receipt.terminalReceiptId],
    terminalReceiptHashes,
    terminalReceiptSetHash: hashCanonicalJson(terminalReceiptHashes),
    harvestReceiptHashes,
    harvestCount: 1,
    denominatorHashes,
    witnessBindingSetHash: hashCanonicalJson([receipt.witnessBindingHash]),
    factIds: [] as string[],
    factCount: 0,
    unexecutableCatalogFamilyIds: [] as string[],
    unregisteredBackendFamilyIds: [] as string[],
    failedObligationIds: [] as string[],
    unknownObligationIds: [] as string[],
    verdict: 'passed' as const,
  };
  return {
    facts: [],
    receipts: [receipt],
    manifest: { ...semantic, manifestHash: hashCanonicalJson(semantic) },
  };
}

describe('strict semantic evidence authority', () => {
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
    const receipt = executionReceipt({
      obligationId: 'obligation-clusters',
      disposition: 'matched',
      emittedFactIds: ['fact:a', 'fact:b'],
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
          factIds: ['fact:a'],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: ['file:a'],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
        {
          observationId: 'o2',
          factIds: ['fact:b'],
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

    expect(
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [
          {
            mechanismKey: 'mechanism:a',
            mechanism: { invariant: 'a' },
            observationIds: ['o1'],
            mechanismEvidenceFactIds: ['fact:a'],
            anatomyLensIds: [],
          },
          {
            mechanismKey: 'mechanism:b',
            mechanism: { invariant: 'b' },
            observationIds: ['o2'],
            mechanismEvidenceFactIds: ['fact:b'],
            anatomyLensIds: [],
          },
        ],
        nonClusteredDispositions: [],
      }).clusters
    ).toHaveLength(2);

    expect(() =>
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [
          {
            mechanismKey: 'mechanism:incorrect-merge',
            mechanism: { invariant: 'a only' },
            observationIds: ['o1', 'o2'],
            mechanismEvidenceFactIds: ['fact:a'],
            anatomyLensIds: [],
          },
        ],
        nonClusteredDispositions: [],
      })
    ).toThrow('CLUSTER_MEMBER_EVIDENCE_INCOMPLETE');
  });

  it('binds investigated-empty to non-empty real execution outputs and an independent review', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-empty',
      disposition: 'inspected-no-pattern',
    });
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'investigated-empty',
      currentAnalysisFixpointHash: FIXPOINT,
      populationHash: `sha256:${'a'.repeat(64)}`,
      proposedDispositionHash: `sha256:${'b'.repeat(64)}`,
      executionReceipts: [receipt],
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'complete-negative-denominator',
    });
    const decision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: SOURCE_REVISION,
      finalExpandedScheduleHash: `sha256:${'d'.repeat(64)}`,
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
        producer,
        reviewer: sameOutputReviewer,
        calibrationReceiptHash: `sha256:${'c'.repeat(64)}`,
        verdict: 'pass',
        reasonCode: 'same-output-self-certification',
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
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
      proposedDispositionHash: `sha256:${'b'.repeat(64)}`,
      executionReceipts: [receipt],
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
      dispositionReview: review,
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
        dispositionReview: review,
      })
    ).toThrow('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
  });

  it('consumes fact, population, cluster, review, expression, attempt, admission, and cap primitives through one public contract', () => {
    const receipt = executionReceipt({
      obligationId: 'obligation-production-authority',
      disposition: 'inspected-no-pattern',
    });
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-production-authority',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['observation-no-pattern'],
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
      observations: [],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [
        {
          observationId: 'observation-no-pattern',
          obligationId: receipt.obligationId,
          canonicalSubjectRef: receipt.canonicalSubjectRef,
          parentSubjectRefs: [],
          executionReceiptHash: receipt.receiptHash,
          outputHash: receipt.outputHash,
          denominatorHash: receipt.denominatorHash,
        },
      ],
    });
    const clusterSet = canonicalizeKnowledgeClustersV1(population, {
      clusters: [],
      nonClusteredDispositions: [],
    });
    const finalSchedule = createFinalExpandedMiningScheduleReceiptV1({
      baselineScheduleHash: `sha256:${'4'.repeat(64)}`,
      baselineObligationIds: [receipt.obligationId],
      expansionReceipts: [],
    });
    const analysisReviewContextHash = createAnalysisReviewContextHashV1({
      finalExpandedScheduleHash: finalSchedule.finalExpandedScheduleHash,
      terminalObligations: [
        {
          obligationId: receipt.obligationId,
          disposition: 'inspected-no-pattern',
          terminalReceiptId: receipt.terminalReceiptId,
        },
      ],
      populationHashes: [population.populationHash],
      clusterSetHashes: [clusterSet.clusterSetHash],
    });
    const falsificationReview = createKnowledgeDispositionReviewV1({
      reviewKind: 'falsification',
      currentAnalysisFixpointHash: analysisReviewContextHash,
      populationHash: population.populationHash,
      proposedDispositionHash: `sha256:${'4'.repeat(64)}`,
      executionReceipts: [receipt],
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
          disposition: 'inspected-no-pattern',
          terminalReceiptId: receipt.terminalReceiptId,
        },
      ],
      populationHashes: [population.populationHash],
      clusterSets: [clusterSet],
      inductionReceiptHashes: [],
      falsificationReceiptHashes: [falsification.receiptHash],
    });
    expect(fixpoint.analysisReviewContextHash).toBe(analysisReviewContextHash);
    const review = createKnowledgeDispositionReviewV1({
      reviewKind: 'producer-non-draft',
      currentAnalysisFixpointHash: fixpoint.fixpointHash,
      populationHash: population.populationHash,
      proposedDispositionHash: `sha256:${'5'.repeat(64)}`,
      executionReceipts: [receipt],
      producer: actor('producer'),
      reviewer: actor('reviewer'),
      calibrationReceiptHash: `sha256:${'6'.repeat(64)}`,
      verdict: 'pass',
      reasonCode: 'reviewed-zero-expression',
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
      expressions: [],
      zeroDisposition: {
        reasonCode: 'reviewed-zero-expression',
        reviewerReceiptId: review.reviewReceiptId,
        dispositionReview: review,
        terminalFate: 'reviewed-non-draft',
      },
    });
    const candidateBatch = canonicalizeCandidateAttemptBatchV1({
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
      attempts: [
        {
          runId: 'run-semantic-authority',
          analysisFixpointHash: fixpoint.fixpointHash,
          privateCorpusRevision: 'revision-production-authority',
          cellId: 'core::architecture',
          criticality: 'critical',
          passOrdinal: 0,
          authoredFingerprint: `sha256:${'7'.repeat(64)}`,
          causalParentIds: [],
        },
      ],
    });
    const admissionLedger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: `sha256:${'8'.repeat(64)}`,
      rows: [
        {
          proposalId: 'proposal:production-authority',
          observedAcceptedCorpusHash: `sha256:${'8'.repeat(64)}`,
          terminalFate: 'accepted',
          resultingAcceptedCorpusHash: `sha256:${'9'.repeat(64)}`,
          terminalReceiptId: 'admission:production-authority',
        },
      ],
    });

    const authority = createStrictProductionAuthorityReceiptV1({
      runId: 'run-semantic-authority',
      sourceRevisionVectorHash: SOURCE_REVISION,
      analysisFixpoint: fixpoint,
      privateCorpusRevision: 'revision-production-authority',
      factExecution: factExecutionResult(receipt),
      populations: [population],
      clusterSets: [clusterSet],
      inductions: [],
      falsifications: [falsification],
      dispositionReviews: [falsificationReview, review],
      expressionSets: [expressionSet],
      candidateAttemptBatches: [candidateBatch],
      serialAdmissionLedger: admissionLedger,
      resourceCaps: {
        candidateAttemptCap: 2,
        maxAuthoredCandidatesPerCellPass: 1,
      },
    });

    expect(authority).toMatchObject({
      contractVersion: 'strict-production-authority-v1',
      analysisFixpointHash: fixpoint.fixpointHash,
      resourceConservation: {
        candidateAttemptCap: 2,
        consumedCandidateAttempts: 1,
        remainingCandidateAttempts: 1,
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  bindStrictProductionProjectionToHostAgentAnalysisUnitV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createFactRecordV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInductionReceiptV1,
  createTypedGateReturnV1,
  type DirectFactWitnessInputV1,
  type FactRecordV1,
  validateAnalysisScheduleExpansionV1,
  validateFactRecordGraphV1,
  validateHypothesisExpressionSetLineageV1,
  validateHypothesisExpressionSetReceiptV1,
} from '../src/host-agent-workflows.js';

const DIRECT_WITNESS: DirectFactWitnessInputV1 = {
  kind: 'direct',
  evidenceEntryId: 'E-17',
  evidenceSessionId: 'session-1',
  evidenceContentHash: 'sha256:evidence',
  sourceRevisionVectorHash: 'sha256:revision',
  projectContextRefId: 'symbol:a',
  projectContextRefHash: `sha256:${'a'.repeat(64)}`,
  canonicalSubjectRef: 'symbol:a',
  anchor: {
    relativePath: 'src/a.ts',
    blobHash: 'sha256:blob-a',
    range: { startLine: 10, endLine: 12 },
  },
};

describe('strict analysis production contracts', () => {
  it('creates dimension-free direct Fact IDs while preserving scale and accepted witness identity', () => {
    const left = createFactRecordV1({
      factFamilyId: 'syntax-idiom',
      canonicalSubjectRef: 'symbol:a',
      primaryScale: 'symbol',
      sourceRevisionVectorHash: 'sha256:revision',
      value: { behavior: 'returns typed failure', order: ['validate', 'persist'] },
      witnesses: [DIRECT_WITNESS],
      dimensionId: 'architecture',
      cellId: 'core::architecture',
      viewId: 'view-a',
      anatomyLensId: 'entrypoint-and-contract',
    });
    const right = createFactRecordV1({
      factFamilyId: 'syntax-idiom',
      canonicalSubjectRef: 'symbol:a',
      primaryScale: 'symbol',
      sourceRevisionVectorHash: 'sha256:revision',
      value: { order: ['validate', 'persist'], behavior: 'returns typed failure' },
      witnesses: [DIRECT_WITNESS],
      dimensionId: 'testing-quality',
      cellId: 'core::testing-quality',
      viewId: 'view-b',
      anatomyLensId: 'error-recovery-concurrency',
    });

    expect(right.factId).toBe(left.factId);
    expect(right).toEqual(left);
    expect(left.primaryScale).toBe('symbol');
    expect(left.valueHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(left.witnesses[0]).toMatchObject({
      evidenceEntryId: 'E-17',
      evidenceSessionId: 'session-1',
      projectContextRefId: 'symbol:a',
      projectContextRefHash: `sha256:${'a'.repeat(64)}`,
    });
    expect(left).not.toHaveProperty('dimensionId');
    expect(left).not.toHaveProperty('cellId');
    expect(left).not.toHaveProperty('viewId');
    expect(left).not.toHaveProperty('anatomyLensId');
  });

  it('binds the existing HostAgent unit to IDs derived from canonical Facts', () => {
    const fact = createFactRecordV1({
      factFamilyId: 'syntax-idiom',
      canonicalSubjectRef: 'symbol:a',
      primaryScale: 'symbol',
      sourceRevisionVectorHash: 'sha256:revision',
      value: 'bound fact',
      witnesses: [DIRECT_WITNESS],
    });
    const unit = bindStrictProductionProjectionToHostAgentAnalysisUnitV1(
      { unitId: 'existing-host-agent-unit' } as never,
      {
        canonicalSubjectRef: 'symbol:a',
        parentSubjectRefs: ['file:src/a.ts'],
        primaryScale: 'symbol',
        anatomyLensIds: ['entrypoint-and-contract'],
        facts: [fact],
      }
    );

    expect(unit.strictProjection.factIds).toEqual([fact.factId]);
    expect(unit.strictProjection.witnessIds).toEqual(fact.witnessIds);
  });

  it('requires bound direct witnesses and replayable ordered premises for derived facts', () => {
    expect(() =>
      createFactRecordV1({
        factFamilyId: 'syntax-idiom',
        canonicalSubjectRef: 'symbol:a',
        primaryScale: 'symbol',
        sourceRevisionVectorHash: 'sha256:revision',
        value: 'bare evidence is not sufficient',
        witnesses: [{ ...DIRECT_WITNESS, evidenceSessionId: '' }],
      })
    ).toThrow('FACT_DIRECT_WITNESS_UNBOUND');

    expect(() =>
      createFactRecordV1({
        factFamilyId: 'syntax-idiom',
        canonicalSubjectRef: 'symbol:b',
        primaryScale: 'symbol',
        sourceRevisionVectorHash: 'sha256:revision',
        value: 'wrong subject',
        witnesses: [DIRECT_WITNESS],
      })
    ).toThrow('FACT_WITNESS_SUBJECT_MISMATCH');

    const premise = createFactRecordV1({
      factFamilyId: 'syntax-idiom',
      canonicalSubjectRef: 'symbol:a',
      primaryScale: 'symbol',
      sourceRevisionVectorHash: 'sha256:revision',
      value: 'premise',
      witnesses: [DIRECT_WITNESS],
    });
    const derived = createFactRecordV1({
      factFamilyId: 'synthesis-cross-cutting',
      canonicalSubjectRef: 'repo:core',
      primaryScale: 'repository',
      sourceRevisionVectorHash: 'sha256:revision',
      value: 'derived invariant',
      witnesses: [
        {
          kind: 'derived',
          derivationRuleId: 'rule:ordered-summary-v1',
          orderedPremiseFactIds: [premise.factId],
          sourceRevisionVectorHash: 'sha256:revision',
        },
      ],
    });

    expect(() => validateFactRecordGraphV1([premise, derived])).not.toThrow();
    expect(() =>
      createFactRecordV1({
        factFamilyId: 'synthesis-cross-cutting',
        canonicalSubjectRef: 'repo:core',
        primaryScale: 'repository',
        sourceRevisionVectorHash: 'sha256:revision',
        value: 'conflicting replay',
        witnesses: [
          {
            kind: 'derived',
            derivationRuleId: 'rule:ordered-summary-v1',
            orderedPremiseFactIds: [premise.factId],
            sourceRevisionVectorHash: 'sha256:revision',
          },
          {
            kind: 'derived',
            derivationRuleId: 'rule:ordered-summary-v1',
            orderedPremiseFactIds: ['fact:different'],
            sourceRevisionVectorHash: 'sha256:revision',
          },
        ],
      })
    ).toThrow('FACT_DERIVED_PREMISE_REPLAY_MISMATCH');
    expect(() =>
      validateFactRecordGraphV1([
        premise,
        { ...derived, premiseFactIds: ['fact:missing'] } as FactRecordV1,
      ])
    ).toThrow('FACT_DERIVED_PREMISE_MISSING');
  });

  it('conserves the complete population and keeps a long tail without first-N truncation', () => {
    const observations = Array.from({ length: 73 }, (_, index) => ({
      observationId: `obs-${index}`,
      factIds: [`fact-${index}`],
      obligationIds: ['obligation:fixture'],
      mechanismKey: index % 2 === 0 ? 'safe-write' : 'typed-return',
      canonicalSubjectRefs: [`symbol:${index}`],
    }));
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-1',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: 'sha256:revision',
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: observations.map((row) => row.observationId),
        ...completeExecutionDenominator(),
      },
      observations: observations.map((observation) => ({
        ...observation,
        parentSubjectRefs: [],
        variantKeys: [],
        outlierReasonCodes: [],
        negativeControl: false,
      })),
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [],
    });

    expect(population.observations).toHaveLength(73);
    expect(population.conservation).toEqual({
      raw: 73,
      accepted: 73,
      duplicate: 0,
      excluded: 0,
      error: 0,
      inspectedNoPattern: 0,
      omitted: 0,
    });
  });

  it('canonicalizes one-to-many cluster membership while giving every observation one disposition', () => {
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-2',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: 'sha256:revision',
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['o1', 'o2', 'o3'],
        ...completeExecutionDenominator(),
      },
      observations: [
        {
          observationId: 'o1',
          factIds: ['f1'],
          obligationIds: ['obligation:fixture'],
          mechanismKey: 'safe-write',
          canonicalSubjectRefs: ['s1'],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
        {
          observationId: 'o2',
          factIds: ['f2'],
          obligationIds: ['obligation:fixture'],
          mechanismKey: 'safe-write',
          canonicalSubjectRefs: ['s2'],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
        {
          observationId: 'o3',
          factIds: ['f3'],
          obligationIds: ['obligation:fixture'],
          mechanismKey: 'other',
          canonicalSubjectRefs: ['s3'],
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
    const clusters = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'safe-write',
          mechanism: { invariant: 'safe write' },
          observationIds: ['o1', 'o2'],
          mechanismEvidenceFactIds: ['f1', 'f2'],
          anatomyLensIds: ['state-lifecycle-persistence'],
        },
        {
          mechanismKey: 'safe-write',
          mechanism: { invariant: 'safe write with error recovery' },
          observationIds: ['o1'],
          mechanismEvidenceFactIds: ['f1'],
          anatomyLensIds: ['error-recovery-concurrency'],
        },
        {
          mechanismKey: 'other',
          mechanism: { invariant: 'other' },
          observationIds: ['o3'],
          mechanismEvidenceFactIds: ['f3'],
          anatomyLensIds: [],
        },
      ],
      nonClusteredDispositions: [],
    });

    expect(clusters.dispositions).toEqual([
      expect.objectContaining({
        observationId: 'o1',
        status: 'clustered',
        clusterIds: expect.any(Array),
      }),
      expect.objectContaining({ observationId: 'o2', status: 'clustered' }),
      expect.objectContaining({ observationId: 'o3', status: 'clustered' }),
    ]);
    expect(() =>
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [
          {
            mechanismKey: 'safe-write',
            mechanism: { invariant: 'safe write' },
            observationIds: ['o1', 'o3'],
            mechanismEvidenceFactIds: ['f1'],
            anatomyLensIds: [],
          },
        ],
        nonClusteredDispositions: [
          {
            observationId: 'o2',
            status: 'unresolved',
            reasonCode: 'review-pending',
            owner: 'HostAgent',
            resumePoint: 'cluster-review',
          },
        ],
      })
    ).toThrow('CLUSTER_MEMBER_EVIDENCE_INCOMPLETE');
  });

  it('supports singleton and recurring induction while rejecting string-certified zero', () => {
    const singleton = createInductionReceiptV1({
      populationHash: 'sha256:population',
      clusterHash: 'sha256:cluster-one',
      clusterId: 'cluster-one',
      observationIds: ['o1'],
      mode: 'bounded-singleton',
      currentAnalysisFixpointHash: `sha256:${'b'.repeat(64)}`,
      hypotheses: [
        { hypothesisId: 'h1', statement: 'bounded local invariant', premiseFactIds: ['f1'] },
      ],
    });
    expect(singleton.hypotheses).toHaveLength(1);

    expect(() =>
      createInductionReceiptV1({
        populationHash: 'sha256:population',
        clusterHash: 'sha256:cluster-one',
        clusterId: 'cluster-one',
        observationIds: ['o1'],
        mode: 'recurring',
        currentAnalysisFixpointHash: `sha256:${'b'.repeat(64)}`,
        hypotheses: [{ hypothesisId: 'h1', statement: 'not recurring', premiseFactIds: ['f1'] }],
      })
    ).toThrow('INDUCTION_RECURRING_DENOMINATOR_INSUFFICIENT');

    expect(() =>
      createInductionReceiptV1({
        populationHash: 'sha256:population',
        clusterHash: 'sha256:cluster-zero',
        clusterId: 'cluster-zero',
        observationIds: ['o2', 'o3'],
        mode: 'recurring',
        currentAnalysisFixpointHash: `sha256:${'b'.repeat(64)}`,
        hypotheses: [],
        zeroHypothesisReason: 'refuted',
        zeroHypothesisReviewReceiptId: 'review:zero',
      })
    ).toThrow('INDUCTION_ZERO_REASON_REQUIRED');
  });

  it('requires owner/resume for every non-pass gate', () => {
    expect(() =>
      createTypedGateReturnV1({ gate: 'G1', verdict: 'revise', reasonCode: 'bad' })
    ).toThrow('GATE_RETURN_OWNER_RESUME_REQUIRED');
    expect(
      createTypedGateReturnV1({
        gate: 'G1',
        verdict: 'revise',
        reasonCode: 'mechanism-missing',
        owner: 'Producer',
        resumePoint: 'producer-expression-repair',
        permittedMutation: 'authored-expression-only',
        semanticRepairDepth: 1,
      }).owner
    ).toBe('Producer');
  });

  it('conserves every hypothesis expression row and the mandatory zero disposition', () => {
    expect(() =>
      validateHypothesisExpressionSetReceiptV1({
        schemaVersion: 1,
        receiptId: 'set-1',
        hypothesisId: 'h1',
        analysisFixpointHash: 'sha256:fixpoint',
        privateCorpusRevision: 'revision-1',
        version: 1,
        parentReceiptId: null,
        terminalHead: true,
        expressions: [],
        zeroDisposition: null,
      })
    ).toThrow('EXPRESSION_SET_ZERO_DISPOSITION_REQUIRED');

    const receipt = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: 'set-2',
      hypothesisId: 'h1',
      analysisFixpointHash: 'sha256:fixpoint',
      privateCorpusRevision: 'revision-1',
      version: 1,
      parentReceiptId: null,
      terminalHead: true,
      expressions: [
        {
          expressionId: 'e1',
          authoredFingerprint: 'sha256:e1',
          terminalFate: 'content-ready',
          terminalReceiptId: 'r1',
          terminalReceiptHash: `sha256:${'1'.repeat(64)}`,
        },
        {
          expressionId: 'e2',
          authoredFingerprint: 'sha256:e2',
          terminalFate: 'g1-rejected',
          terminalReceiptId: 'r2',
          terminalReceiptHash: `sha256:${'2'.repeat(64)}`,
        },
      ],
      zeroDisposition: null,
    });
    expect(receipt.conservation).toEqual({ authored: 2, terminal: 2, unresolved: 0 });
    expect(receipt.terminalClosure).toBe('expressed');
    expect(() =>
      validateHypothesisExpressionSetLineageV1([
        receipt,
        { ...receipt, receiptId: 'set-3', version: 2, parentReceiptId: 'wrong-parent' },
      ])
    ).toThrow('EXPRESSION_SET_LINEAGE_BROKEN');
  });

  it('only appends purpose-tagged unique expansions and seals a fully terminal fixpoint', () => {
    const expansion = validateAnalysisScheduleExpansionV1({
      previousExpansionHeadHash: null,
      baselineObligationIds: ['baseline-1'],
      existingExpansionObligationIds: [],
      rows: [
        {
          obligationId: 'expansion-1',
          purpose: 'counterexample',
          factFamilyId: 'syntax-idiom',
          capabilityId: 'tree-sitter-query',
          canonicalSubjectRef: 'symbol:a',
          analysisScale: 'symbol',
          reasonCode: 'challenge-recurring-claim',
        },
      ],
      knownFactFamilies: [
        {
          id: 'syntax-idiom',
          capabilityId: 'tree-sitter-query',
          supportedScales: ['symbol'],
        },
      ],
      knownSubjectRefs: ['symbol:a'],
      obligationCap: 2,
    });
    expect(expansion.resultingScheduledCount).toBe(2);
    expect(() =>
      validateAnalysisScheduleExpansionV1({
        previousExpansionHeadHash: expansion.receiptHash,
        baselineObligationIds: ['baseline-1'],
        existingExpansionObligationIds: ['expansion-1'],
        rows: [expansion.rows[0]],
        knownFactFamilies: [
          {
            id: 'syntax-idiom',
            capabilityId: 'tree-sitter-query',
            supportedScales: ['symbol'],
          },
        ],
        knownSubjectRefs: ['symbol:a'],
        obligationCap: 3,
      })
    ).toThrow('ANALYSIS_EXPANSION_DUPLICATE_OBLIGATION');

    const finalSchedule = createFinalExpandedMiningScheduleReceiptV1({
      baselineScheduleHash: 'sha256:baseline',
      baselineObligationIds: ['baseline-1'],
      expansionReceipts: [expansion],
    });
    expect(finalSchedule.counterexampleObligationCount).toBe(1);

    const fixpoint = createAnalysisFixpointReceiptV1({
      finalExpandedSchedule: finalSchedule,
      terminalObligations: [
        { obligationId: 'expansion-1', disposition: 'matched', terminalReceiptId: 'terminal-2' },
        {
          obligationId: 'baseline-1',
          disposition: 'inspected-no-pattern',
          terminalReceiptId: 'terminal-1',
        },
      ],
      populationHashes: ['population-1'],
      clusterSets: [],
      inductionReceiptHashes: ['induction-1'],
      falsificationReceiptHashes: ['falsification-1'],
    });
    expect(fixpoint.terminalObligations).toHaveLength(2);
    const unresolvedPopulation = canonicalizeObservationPopulationV1({
      populationId: 'population-unresolved',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: 'sha256:revision',
      denominator: {
        kind: 'frozen-complete-subjects',
        expectedObservationIds: ['o1'],
        ...completeExecutionDenominator(),
      },
      observations: [
        {
          observationId: 'o1',
          factIds: ['f1'],
          obligationIds: ['obligation:fixture'],
          mechanismKey: 'pending-review',
          canonicalSubjectRefs: ['symbol:a'],
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
    const unresolvedClusters = canonicalizeKnowledgeClustersV1(unresolvedPopulation, {
      clusters: [],
      nonClusteredDispositions: [
        {
          observationId: 'o1',
          status: 'unresolved',
          reasonCode: 'mechanism-review-pending',
          owner: 'HostAgent',
          resumePoint: 'cluster-review',
        },
      ],
    });
    expect(() =>
      createAnalysisFixpointReceiptV1({
        finalExpandedSchedule: finalSchedule,
        terminalObligations: fixpoint.terminalObligations,
        populationHashes: [unresolvedPopulation.populationHash],
        clusterSets: [unresolvedClusters],
        inductionReceiptHashes: [],
        falsificationReceiptHashes: [],
      })
    ).toThrow('ANALYSIS_FIXPOINT_CLUSTER_UNRESOLVED');
    expect(() =>
      createAnalysisFixpointReceiptV1({
        finalExpandedSchedule: finalSchedule,
        terminalObligations: [
          { obligationId: 'baseline-1', disposition: 'unknown', terminalReceiptId: 'terminal-1' },
          { obligationId: 'expansion-1', disposition: 'matched', terminalReceiptId: 'terminal-2' },
        ],
        populationHashes: [],
        clusterSets: [],
        inductionReceiptHashes: [],
        falsificationReceiptHashes: [],
      })
    ).toThrow('ANALYSIS_FIXPOINT_NONTERMINAL');
  });
});

function completeExecutionDenominator() {
  return {
    expectedObligationIds: ['obligation:fixture'],
    executionReceiptHashes: [`sha256:${'c'.repeat(64)}`],
    outputHashes: [`sha256:${'d'.repeat(64)}`],
    denominatorHashes: [`sha256:${'e'.repeat(64)}`],
    complete: true,
    truncated: false,
    continuation: null,
    omittedObservationIds: [],
  } as const;
}

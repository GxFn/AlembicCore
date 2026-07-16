import { describe, expect, it } from 'vitest';
import {
  bindStrictProductionProjectionToHostAgentAnalysisUnitV1,
  canonicalizeKnowledgeClustersV1,
  canonicalizeObservationPopulationV1,
  createAnalysisFixpointReceiptV1,
  createFactRecordV1,
  createFalsificationReceiptV1,
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
  projectContextRefId: 'ref:symbol:a',
  canonicalSubjectRef: 'symbol:a',
  anchor: {
    relativePath: 'src/a.ts',
    blobHash: 'sha256:blob-a',
    range: { startLine: 10, endLine: 12 },
  },
};

describe('strict analysis production contracts', () => {
  it('creates dimension-free direct Fact IDs independent from view, scale, lens, and input order', () => {
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
      primaryScale: 'repository',
      sourceRevisionVectorHash: 'sha256:revision',
      value: { order: ['validate', 'persist'], behavior: 'returns typed failure' },
      witnesses: [
        {
          ...DIRECT_WITNESS,
          evidenceEntryId: 'E-18',
          evidenceSessionId: 'session-2',
          projectContextRefId: 'ref:query-specific:a',
        },
      ],
      dimensionId: 'testing-quality',
      cellId: 'core::testing-quality',
      viewId: 'view-b',
      anatomyLensId: 'error-recovery-concurrency',
    });

    expect(right.factId).toBe(left.factId);
    expect(right).toEqual(left);
    expect(left).not.toHaveProperty('primaryScale');
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
      },
      observations,
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
    });

    expect(population.observations).toHaveLength(73);
    expect(population.conservation).toEqual({
      raw: 73,
      accepted: 73,
      duplicate: 0,
      excluded: 0,
      error: 0,
    });
  });

  it('canonicalizes one-to-many cluster membership while giving every observation one disposition', () => {
    const population = canonicalizeObservationPopulationV1({
      populationId: 'population-2',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: 'sha256:revision',
      denominator: { kind: 'frozen-complete-subjects', expectedObservationIds: ['o1', 'o2', 'o3'] },
      observations: [
        {
          observationId: 'o1',
          factIds: ['f1'],
          mechanismKey: 'safe-write',
          canonicalSubjectRefs: ['s1'],
        },
        {
          observationId: 'o2',
          factIds: ['f2'],
          mechanismKey: 'safe-write',
          canonicalSubjectRefs: ['s2'],
        },
        {
          observationId: 'o3',
          factIds: ['f3'],
          mechanismKey: 'other',
          canonicalSubjectRefs: ['s3'],
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
    });
    const clusters = canonicalizeKnowledgeClustersV1(population, {
      clusters: [
        {
          mechanismKey: 'safe-write',
          observationIds: ['o1', 'o2'],
          anatomyLensIds: ['state-lifecycle-persistence'],
        },
        {
          mechanismKey: 'safe-write',
          observationIds: ['o1'],
          anatomyLensIds: ['error-recovery-concurrency'],
        },
      ],
      nonClusteredDispositions: [
        {
          observationId: 'o3',
          status: 'discarded',
          reasonCode: 'independently-reviewed-nonmechanism',
          reviewerReceiptId: 'review:o3',
        },
      ],
    });

    expect(clusters.dispositions).toEqual([
      expect.objectContaining({
        observationId: 'o1',
        status: 'clustered',
        clusterIds: expect.any(Array),
      }),
      expect.objectContaining({ observationId: 'o2', status: 'clustered' }),
      expect.objectContaining({ observationId: 'o3', status: 'discarded' }),
    ]);
    expect(() =>
      canonicalizeKnowledgeClustersV1(population, {
        clusters: [
          { mechanismKey: 'safe-write', observationIds: ['o1', 'o3'], anatomyLensIds: [] },
        ],
        nonClusteredDispositions: [
          {
            observationId: 'o2',
            status: 'discarded',
            reasonCode: 'reviewed-nonmechanism',
            reviewerReceiptId: 'review:o2',
          },
        ],
      })
    ).toThrow('CLUSTER_MECHANISM_MISMATCH');
  });

  it('supports zero, singleton, and recurring induction without inventing a minimum', () => {
    const singleton = createInductionReceiptV1({
      populationHash: 'sha256:population',
      clusterHash: 'sha256:cluster-one',
      clusterId: 'cluster-one',
      observationIds: ['o1'],
      mode: 'bounded-singleton',
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
        hypotheses: [{ hypothesisId: 'h1', statement: 'not recurring', premiseFactIds: ['f1'] }],
      })
    ).toThrow('INDUCTION_RECURRING_DENOMINATOR_INSUFFICIENT');

    const zero = createInductionReceiptV1({
      populationHash: 'sha256:population',
      clusterHash: 'sha256:cluster-zero',
      clusterId: 'cluster-zero',
      observationIds: ['o2', 'o3'],
      mode: 'recurring',
      hypotheses: [],
      zeroHypothesisReason: 'refuted',
      zeroHypothesisReviewReceiptId: 'review:zero',
    });
    expect(zero.zeroHypothesisReason).toBeTruthy();
  });

  it('fails counterqueries closed and requires owner/resume for every non-pass gate', () => {
    const unknown = createFalsificationReceiptV1({
      hypothesisId: 'h1',
      enrolledCounterqueryIds: ['counter:q1'],
      counterqueryApplicability: {
        status: 'required',
        reasonCode: 'claim-requires-negative-search',
        reviewerReceiptId: null,
      },
      executions: [
        {
          counterqueryId: 'counter:q1',
          backendStatus: 'complete',
          denominatorComplete: true,
          truncated: true,
          counterexampleFactIds: [],
        },
      ],
    });
    expect(unknown.verdict).toBe('unknown');

    expect(() =>
      createFalsificationReceiptV1({
        hypothesisId: 'h1',
        enrolledCounterqueryIds: ['counter:q1'],
        counterqueryApplicability: {
          status: 'required',
          reasonCode: 'claim-requires-negative-search',
          reviewerReceiptId: null,
        },
        executions: [
          {
            counterqueryId: 'counter:unenrolled',
            backendStatus: 'complete',
            denominatorComplete: true,
            truncated: false,
            counterexampleFactIds: [],
          },
        ],
      })
    ).toThrow('FALSIFICATION_COUNTERQUERY_UNENROLLED');

    expect(() =>
      createFalsificationReceiptV1({
        hypothesisId: 'h1',
        enrolledCounterqueryIds: [],
        counterqueryApplicability: {
          status: 'required',
          reasonCode: 'claim-requires-negative-search',
          reviewerReceiptId: null,
        },
        executions: [],
      })
    ).toThrow('FALSIFICATION_COUNTERQUERY_REQUIRED');
    expect(
      createFalsificationReceiptV1({
        hypothesisId: 'h1',
        enrolledCounterqueryIds: [],
        counterqueryApplicability: {
          status: 'not-required',
          reasonCode: 'structurally-nonfalsifiable-at-this-stage',
          reviewerReceiptId: 'review:not-required',
        },
        executions: [],
      }).verdict
    ).toBe('not-required');

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
        },
        {
          expressionId: 'e2',
          authoredFingerprint: 'sha256:e2',
          terminalFate: 'g1-rejected',
          terminalReceiptId: 'r2',
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
      denominator: { kind: 'frozen-complete-subjects', expectedObservationIds: ['o1'] },
      observations: [
        {
          observationId: 'o1',
          factIds: ['f1'],
          mechanismKey: 'pending-review',
          canonicalSubjectRefs: ['symbol:a'],
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
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

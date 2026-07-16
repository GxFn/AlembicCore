import type { EvidenceRange } from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import { EVIDENCE_ID_RE } from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import {
  ANATOMY_LENS_IDS,
  type AnalysisScale,
  type AnatomyLensId,
} from '../plan/intent/coldStartProductionPlan.js';
import { hashCanonicalJson, toProjectFactsJson } from '../project-context/foundation/canonical.js';

export interface DirectFactWitnessInputV1 {
  readonly kind: 'direct';
  readonly evidenceEntryId: string;
  readonly evidenceSessionId: string;
  readonly evidenceContentHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly projectContextRefId: string;
  readonly canonicalSubjectRef: string;
  readonly anchor: {
    readonly relativePath: string;
    readonly blobHash: string;
    readonly range?: {
      readonly startLine: number;
      readonly endLine: number;
      readonly startColumn?: number;
      readonly endColumn?: number;
    };
  };
}

export interface DerivedFactWitnessInputV1 {
  readonly kind: 'derived';
  readonly derivationRuleId: string;
  readonly orderedPremiseFactIds: readonly string[];
  readonly sourceRevisionVectorHash: string;
}

export type FactWitnessInputV1 = DirectFactWitnessInputV1 | DerivedFactWitnessInputV1;

export type FactWitnessV1 =
  | {
      readonly kind: 'direct';
      readonly witnessId: string;
      readonly evidenceContentHash: string;
      readonly sourceRevisionVectorHash: string;
      readonly canonicalSubjectRef: string;
      readonly anchor: DirectFactWitnessInputV1['anchor'];
    }
  | (DerivedFactWitnessInputV1 & { readonly witnessId: string });

export interface CreateFactRecordInputV1 {
  readonly factFamilyId: string;
  readonly canonicalSubjectRef: string;
  readonly primaryScale: AnalysisScale;
  readonly sourceRevisionVectorHash: string;
  readonly value: unknown;
  readonly witnesses: readonly FactWitnessInputV1[];
  /** Binding-only caller fields are accepted for compatibility but never persisted or hashed. */
  readonly dimensionId?: string;
  readonly cellId?: string;
  readonly viewId?: string;
  readonly anatomyLensId?: string;
  readonly queryId?: string;
}

export interface FactRecordV1 {
  readonly schemaVersion: 1;
  readonly factId: string;
  readonly kind: 'direct' | 'derived';
  readonly factFamilyId: string;
  readonly canonicalSubjectRef: string;
  readonly sourceRevisionVectorHash: string;
  readonly value: ReturnType<typeof toProjectFactsJson>;
  readonly witnesses: readonly FactWitnessV1[];
  readonly witnessIds: readonly string[];
  readonly derivationRuleId: string | null;
  readonly premiseFactIds: readonly string[];
}

export interface StrictHostAgentAnalysisUnitProjectionV1 {
  readonly schemaVersion: 1;
  readonly canonicalSubjectRef: string;
  readonly parentSubjectRefs: readonly string[];
  readonly primaryScale: AnalysisScale;
  readonly anatomyLensIds: readonly AnatomyLensId[];
  readonly factIds: readonly string[];
  readonly witnessIds: readonly string[];
}

export interface ObservationV1 {
  readonly observationId: string;
  readonly factIds: readonly string[];
  readonly mechanismKey: string;
  readonly canonicalSubjectRefs: readonly string[];
}

export interface ObservationPopulationInputV1 {
  readonly populationId: string;
  readonly revision: number;
  readonly parentPopulationHash: string | null;
  readonly sourceRevisionVectorHash: string;
  readonly denominator: {
    readonly kind: 'frozen-complete-subjects';
    readonly expectedObservationIds: readonly string[];
  };
  readonly observations: readonly ObservationV1[];
  readonly duplicateObservations: readonly {
    readonly observationId: string;
    readonly duplicateOf: string;
  }[];
  readonly excludedObservations: readonly {
    readonly observationId: string;
    readonly reasonCode: string;
  }[];
  readonly errorObservations: readonly {
    readonly observationId: string;
    readonly reasonCode: string;
  }[];
}

export interface ObservationPopulationV1 extends ObservationPopulationInputV1 {
  readonly schemaVersion: 1;
  readonly populationHash: string;
  readonly conservation: {
    readonly raw: number;
    readonly accepted: number;
    readonly duplicate: number;
    readonly excluded: number;
    readonly error: number;
  };
}

export interface KnowledgeClusterInputV1 {
  readonly mechanismKey: string;
  readonly observationIds: readonly string[];
  readonly anatomyLensIds: readonly string[];
}

export interface KnowledgeClusterV1 extends KnowledgeClusterInputV1 {
  readonly clusterId: string;
}

export interface KnowledgeClusterSetV1 {
  readonly schemaVersion: 1;
  readonly populationHash: string;
  readonly clusters: readonly KnowledgeClusterV1[];
  readonly dispositions: readonly {
    readonly observationId: string;
    readonly status: 'clustered' | 'discarded' | 'unresolved';
    readonly clusterIds: readonly string[];
    readonly reasonCode: string | null;
    readonly reviewerReceiptId: string | null;
    readonly owner: string | null;
    readonly resumePoint: string | null;
  }[];
  readonly clusterSetHash: string;
}

export interface HypothesisV1 {
  readonly hypothesisId: string;
  readonly statement: string;
  readonly premiseFactIds: readonly string[];
}

export interface InductionReceiptV1 {
  readonly schemaVersion: 1;
  readonly populationHash: string;
  readonly clusterHash: string;
  readonly clusterId: string;
  readonly observationIds: readonly string[];
  readonly mode: 'recurring' | 'bounded-singleton';
  readonly hypotheses: readonly HypothesisV1[];
  readonly zeroHypothesisReason: 'refuted' | 'insufficient-evidence' | 'unknown' | null;
  readonly zeroHypothesisReviewReceiptId: string | null;
  readonly receiptHash: string;
}

export interface CounterqueryExecutionV1 {
  readonly counterqueryId: string;
  readonly backendStatus: 'complete' | 'missing' | 'failed' | 'unknown';
  readonly denominatorComplete: boolean;
  readonly truncated: boolean;
  readonly counterexampleFactIds: readonly string[];
}

export interface FalsificationReceiptV1 {
  readonly schemaVersion: 1;
  readonly hypothesisId: string;
  readonly enrolledCounterqueryIds: readonly string[];
  readonly executions: readonly CounterqueryExecutionV1[];
  readonly counterqueryApplicability: {
    readonly status: 'required' | 'not-required';
    readonly reasonCode: string;
    readonly reviewerReceiptId: string | null;
  };
  readonly verdict: 'survived' | 'refuted' | 'unknown' | 'not-required';
  readonly receiptHash: string;
}

export interface TypedGateReturnInputV1 {
  readonly gate: 'G1' | 'ADMISSION' | 'G2' | 'G3' | 'G4' | 'DURABLE' | 'PUBLIC';
  readonly verdict: 'pass' | 'revise' | 'reject' | 'failed' | 'unknown';
  readonly reasonCode: string;
  readonly owner?: string;
  readonly resumePoint?: string;
  readonly permittedMutation?: string;
  readonly semanticRepairDepth?: number;
}

export interface TypedGateReturnV1 extends TypedGateReturnInputV1 {
  readonly schemaVersion: 1;
  readonly returnHash: string;
}

export type HypothesisExpressionTerminalFate =
  | 'content-ready'
  | 'reviewed-merge'
  | 'reviewed-duplicate'
  | 'g1-rejected'
  | 'admission-rejected'
  | 'g2-rejected'
  | 'repair-superseded'
  | 'failed'
  | 'unknown';

export interface HypothesisExpressionRowV1 {
  readonly expressionId: string;
  readonly authoredFingerprint: string;
  readonly terminalFate: HypothesisExpressionTerminalFate;
  readonly terminalReceiptId: string;
  readonly matchingRepresentativeId?: string;
  readonly matchingContentReadyRecipeId?: string;
}

export interface HypothesisExpressionSetReceiptInputV1 {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly hypothesisId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly version: number;
  readonly parentReceiptId: string | null;
  readonly terminalHead: boolean;
  readonly expressions: readonly HypothesisExpressionRowV1[];
  readonly zeroDisposition: {
    readonly reasonCode: string;
    readonly reviewerReceiptId: string;
    readonly terminalFate:
      | 'reviewed-non-draft'
      | 'rejected'
      | 'repair-superseded'
      | 'failed'
      | 'unknown';
  } | null;
}

export interface HypothesisExpressionSetReceiptV1 extends HypothesisExpressionSetReceiptInputV1 {
  readonly conservation: {
    readonly authored: number;
    readonly terminal: number;
    readonly unresolved: number;
  };
  readonly terminalClosure: 'historical' | 'expressed' | 'represented-by' | 'reviewed-non-draft';
  readonly receiptHash: string;
}

export type AnalysisExpansionPurposeV1 = 'exploration' | 'counterexample';

export interface AnalysisScheduleExpansionRowV1 {
  readonly obligationId: string;
  readonly purpose: AnalysisExpansionPurposeV1;
  readonly factFamilyId: string;
  readonly capabilityId: string;
  readonly canonicalSubjectRef: string;
  readonly analysisScale: AnalysisScale;
  readonly reasonCode: string;
}

export interface AnalysisScheduleExpansionReceiptV1 {
  readonly schemaVersion: 1;
  readonly previousExpansionHeadHash: string | null;
  readonly rows: readonly AnalysisScheduleExpansionRowV1[];
  readonly resultingScheduledCount: number;
  readonly receiptHash: string;
}

export interface FinalExpandedMiningScheduleReceiptV1 {
  readonly schemaVersion: 1;
  readonly baselineScheduleHash: string;
  readonly expansionReceiptHashes: readonly string[];
  readonly obligationIds: readonly string[];
  readonly explorationObligationCount: number;
  readonly counterexampleObligationCount: number;
  readonly finalExpandedScheduleHash: string;
}

export interface AnalysisFixpointReceiptV1 {
  readonly schemaVersion: 1;
  readonly finalExpandedScheduleHash: string;
  readonly terminalObligations: readonly {
    readonly obligationId: string;
    readonly disposition: 'matched' | 'inspected-no-pattern' | 'failed' | 'unknown';
    readonly terminalReceiptId: string;
  }[];
  readonly populationHashes: readonly string[];
  readonly clusterSetHashes: readonly string[];
  readonly inductionReceiptHashes: readonly string[];
  readonly falsificationReceiptHashes: readonly string[];
  readonly fixpointHash: string;
}

export interface AnalysisArtifactProjectionV1 {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly sourceRevisionVectorHash: string;
  readonly factIds: readonly string[];
  readonly witnessIds: readonly string[];
  readonly populationHashes: readonly string[];
  readonly clusterSetHashes: readonly string[];
  readonly analysisFixpointHash: string;
  readonly projectionHash: string;
}

export function createFactRecordV1(input: CreateFactRecordInputV1): FactRecordV1 {
  requireText(input.factFamilyId, 'FACT_FAMILY_REQUIRED');
  requireText(input.canonicalSubjectRef, 'FACT_SUBJECT_REQUIRED');
  requireText(input.sourceRevisionVectorHash, 'FACT_SOURCE_REVISION_REQUIRED');
  if (!ANALYSIS_SCALES.has(input.primaryScale)) {
    fail('FACT_SCALE_INVALID');
  }
  if (input.witnesses.length === 0) {
    fail('FACT_WITNESS_REQUIRED');
  }

  const kinds = new Set(input.witnesses.map((witness) => witness.kind));
  if (kinds.size !== 1) {
    fail('FACT_WITNESS_KIND_MIXED');
  }
  const kind = input.witnesses[0]?.kind;
  if (!kind) {
    fail('FACT_WITNESS_REQUIRED');
  }
  const witnesses = input.witnesses.map(normalizeWitness).sort(byId('witnessId'));
  const derivationRuleIds = normalizeStrings(
    witnesses.flatMap((witness) => (witness.kind === 'derived' ? [witness.derivationRuleId] : []))
  );
  if (kind === 'derived' && derivationRuleIds.length !== 1) {
    fail('FACT_DERIVATION_RULE_INCONSISTENT');
  }
  const premiseFactIds =
    kind === 'derived'
      ? (witnesses[0] as FactWitnessV1 & DerivedFactWitnessInputV1).orderedPremiseFactIds
      : [];
  for (const witness of witnesses) {
    if (witness.sourceRevisionVectorHash !== input.sourceRevisionVectorHash) {
      fail('FACT_WITNESS_SOURCE_REVISION_MISMATCH');
    }
    if (witness.kind === 'direct' && witness.canonicalSubjectRef !== input.canonicalSubjectRef) {
      fail('FACT_WITNESS_SUBJECT_MISMATCH');
    }
    if (
      witness.kind === 'derived' &&
      JSON.stringify(witness.orderedPremiseFactIds) !== JSON.stringify(premiseFactIds)
    ) {
      fail('FACT_DERIVED_PREMISE_REPLAY_MISMATCH');
    }
  }
  const value = toProjectFactsJson(input.value);
  const identity =
    kind === 'direct'
      ? {
          kind,
          factFamilyId: input.factFamilyId,
          canonicalSubjectRef: input.canonicalSubjectRef,
          sourceRevisionVectorHash: input.sourceRevisionVectorHash,
          value,
          directWitnessAnchors: uniqueCanonicalValues(
            witnesses.map((witness) => directWitnessIdentity(witness))
          ),
        }
      : {
          kind,
          derivationRuleId: derivationRuleIds[0],
          orderedPremiseFactIds: premiseFactIds,
          factFamilyId: input.factFamilyId,
          canonicalSubjectRef: input.canonicalSubjectRef,
          sourceRevisionVectorHash: input.sourceRevisionVectorHash,
          value,
        };
  const factId = `fact:${hashCanonicalJson(identity).slice(7)}`;
  return freezeDeep({
    schemaVersion: 1,
    factId,
    kind,
    factFamilyId: input.factFamilyId,
    canonicalSubjectRef: input.canonicalSubjectRef,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    value,
    witnesses,
    witnessIds: witnesses.map((witness) => witness.witnessId),
    derivationRuleId: derivationRuleIds[0] ?? null,
    premiseFactIds: [...premiseFactIds],
  });
}

export function validateFactRecordGraphV1(records: readonly FactRecordV1[]): void {
  const byFactId = new Map<string, FactRecordV1>();
  for (const record of records) {
    if (byFactId.has(record.factId)) {
      fail('FACT_ID_DUPLICATE');
    }
    byFactId.set(record.factId, record);
  }
  for (const record of records) {
    for (const premiseId of record.premiseFactIds) {
      if (!byFactId.has(premiseId)) {
        fail('FACT_DERIVED_PREMISE_MISSING');
      }
    }
    if (record.kind === 'derived') {
      for (const witness of record.witnesses) {
        if (
          witness.kind !== 'derived' ||
          JSON.stringify(witness.orderedPremiseFactIds) !== JSON.stringify(record.premiseFactIds) ||
          witness.sourceRevisionVectorHash !== record.sourceRevisionVectorHash
        ) {
          fail('FACT_DERIVED_PREMISE_REPLAY_MISMATCH');
        }
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (factId: string): void => {
    if (visiting.has(factId)) {
      fail('FACT_DERIVATION_CYCLE');
    }
    if (visited.has(factId)) {
      return;
    }
    visiting.add(factId);
    for (const premiseId of byFactId.get(factId)?.premiseFactIds ?? []) {
      visit(premiseId);
    }
    visiting.delete(factId);
    visited.add(factId);
  };
  for (const factId of byFactId.keys()) {
    visit(factId);
  }
}

export function canonicalizeObservationPopulationV1(
  input: ObservationPopulationInputV1
): ObservationPopulationV1 {
  requireText(input.populationId, 'POPULATION_ID_REQUIRED');
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    fail('POPULATION_REVISION_INVALID');
  }
  if (input.revision === 1 && input.parentPopulationHash !== null) {
    fail('POPULATION_PARENT_UNEXPECTED');
  }
  if (input.revision > 1 && !input.parentPopulationHash) {
    fail('POPULATION_PARENT_REQUIRED');
  }

  const observations = input.observations
    .map((observation) => ({
      ...observation,
      factIds: normalizeStrings(observation.factIds),
      canonicalSubjectRefs: normalizeStrings(observation.canonicalSubjectRefs),
    }))
    .sort(byId('observationId'));
  for (const observation of observations) {
    requireText(observation.observationId, 'POPULATION_OBSERVATION_INVALID');
    requireText(observation.mechanismKey, 'POPULATION_MECHANISM_REQUIRED');
    if (observation.factIds.length === 0 || observation.canonicalSubjectRefs.length === 0) {
      fail('POPULATION_OBSERVATION_UNGROUNDED');
    }
  }
  const duplicateObservations = [...input.duplicateObservations].sort(byId('observationId'));
  const excludedObservations = [...input.excludedObservations].sort(byId('observationId'));
  const errorObservations = [...input.errorObservations].sort(byId('observationId'));
  const actualIds = [
    ...observations.map((row) => row.observationId),
    ...duplicateObservations.map((row) => row.observationId),
    ...excludedObservations.map((row) => row.observationId),
    ...errorObservations.map((row) => row.observationId),
  ];
  if (new Set(actualIds).size !== actualIds.length) {
    fail('POPULATION_DISPOSITION_DUPLICATE');
  }
  const expectedIds = normalizeStrings(input.denominator.expectedObservationIds);
  if (JSON.stringify([...actualIds].sort()) !== JSON.stringify(expectedIds)) {
    fail('POPULATION_DENOMINATOR_MISMATCH');
  }
  for (const duplicate of duplicateObservations) {
    if (!observations.some((row) => row.observationId === duplicate.duplicateOf)) {
      fail('POPULATION_DUPLICATE_TARGET_MISSING');
    }
  }
  const conservation = {
    raw: expectedIds.length,
    accepted: observations.length,
    duplicate: duplicateObservations.length,
    excluded: excludedObservations.length,
    error: errorObservations.length,
  };
  if (
    conservation.raw !==
    conservation.accepted + conservation.duplicate + conservation.excluded + conservation.error
  ) {
    fail('POPULATION_CONSERVATION_FAILED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    populationId: input.populationId,
    revision: input.revision,
    parentPopulationHash: input.parentPopulationHash,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    denominator: { ...input.denominator, expectedObservationIds: expectedIds },
    observations,
    duplicateObservations,
    excludedObservations,
    errorObservations,
    conservation,
  };
  return freezeDeep({ ...semantic, populationHash: hashCanonicalJson(semantic) });
}

export function canonicalizeKnowledgeClustersV1(
  population: ObservationPopulationV1,
  input: {
    readonly clusters: readonly KnowledgeClusterInputV1[];
    readonly nonClusteredDispositions: readonly {
      readonly observationId: string;
      readonly status: 'discarded' | 'unresolved';
      readonly reasonCode: string;
      readonly reviewerReceiptId?: string;
      readonly owner?: string;
      readonly resumePoint?: string;
    }[];
  }
): KnowledgeClusterSetV1 {
  const observations = new Map(population.observations.map((row) => [row.observationId, row]));
  const clusters = input.clusters
    .map((candidate) => {
      const observationIds = normalizeStrings(candidate.observationIds);
      if (observationIds.length === 0) {
        fail('CLUSTER_EMPTY');
      }
      for (const observationId of observationIds) {
        const observation = observations.get(observationId);
        if (!observation) {
          fail('CLUSTER_OBSERVATION_UNKNOWN');
        }
        if (observation.mechanismKey !== candidate.mechanismKey) {
          fail('CLUSTER_MECHANISM_MISMATCH');
        }
      }
      const semantic = {
        mechanismKey: candidate.mechanismKey,
        observationIds,
        anatomyLensIds: normalizeStrings(candidate.anatomyLensIds),
      };
      return { clusterId: `cluster:${hashCanonicalJson(semantic).slice(7)}`, ...semantic };
    })
    .sort(byId('clusterId'));
  if (new Set(clusters.map((cluster) => cluster.clusterId)).size !== clusters.length) {
    fail('CLUSTER_DUPLICATE');
  }
  const nonClustered = new Map(
    input.nonClusteredDispositions.map((row) => [row.observationId, row] as const)
  );
  if (nonClustered.size !== input.nonClusteredDispositions.length) {
    fail('CLUSTER_DISPOSITION_DUPLICATE');
  }
  const dispositions = [...observations.keys()].sort().map((observationId) => {
    const clusterIds = clusters
      .filter((cluster) => cluster.observationIds.includes(observationId))
      .map((cluster) => cluster.clusterId);
    const nonClusteredDisposition = nonClustered.get(observationId);
    if (clusterIds.length > 0 && nonClusteredDisposition) {
      fail('CLUSTER_DISPOSITION_DUPLICATE');
    }
    if (clusterIds.length === 0 && !nonClusteredDisposition) {
      fail('CLUSTER_DISPOSITION_MISSING');
    }
    if (
      nonClusteredDisposition?.status === 'discarded' &&
      (!nonClusteredDisposition.reasonCode.trim() ||
        !nonClusteredDisposition.reviewerReceiptId?.trim())
    ) {
      fail('CLUSTER_DISCARD_REVIEW_REQUIRED');
    }
    if (
      nonClusteredDisposition?.status === 'unresolved' &&
      (!nonClusteredDisposition.reasonCode.trim() ||
        !nonClusteredDisposition.owner?.trim() ||
        !nonClusteredDisposition.resumePoint?.trim())
    ) {
      fail('CLUSTER_UNRESOLVED_OWNER_REQUIRED');
    }
    return {
      observationId,
      status: clusterIds.length > 0 ? ('clustered' as const) : nonClusteredDisposition!.status,
      clusterIds,
      reasonCode: nonClusteredDisposition?.reasonCode ?? null,
      reviewerReceiptId: nonClusteredDisposition?.reviewerReceiptId ?? null,
      owner: nonClusteredDisposition?.owner ?? null,
      resumePoint: nonClusteredDisposition?.resumePoint ?? null,
    };
  });
  for (const observationId of nonClustered.keys()) {
    if (!observations.has(observationId)) {
      fail('CLUSTER_OBSERVATION_UNKNOWN');
    }
  }
  const semantic = {
    schemaVersion: 1 as const,
    populationHash: population.populationHash,
    clusters,
    dispositions,
  };
  return freezeDeep({ ...semantic, clusterSetHash: hashCanonicalJson(semantic) });
}

export function createInductionReceiptV1(input: {
  readonly populationHash: string;
  readonly clusterHash: string;
  readonly clusterId: string;
  readonly observationIds: readonly string[];
  readonly mode: 'recurring' | 'bounded-singleton';
  readonly hypotheses: readonly HypothesisV1[];
  readonly zeroHypothesisReason?: InductionReceiptV1['zeroHypothesisReason'];
  readonly zeroHypothesisReviewReceiptId?: string;
}): InductionReceiptV1 {
  const observationIds = normalizeStrings(input.observationIds);
  if (observationIds.length === 0) {
    fail('INDUCTION_OBSERVATIONS_REQUIRED');
  }
  if (input.mode === 'recurring' && observationIds.length < 2) {
    fail('INDUCTION_RECURRING_DENOMINATOR_INSUFFICIENT');
  }
  if (input.mode === 'bounded-singleton' && observationIds.length !== 1) {
    fail('INDUCTION_SINGLETON_DENOMINATOR_INVALID');
  }
  const hypotheses = input.hypotheses
    .map((hypothesis) => ({
      ...hypothesis,
      premiseFactIds: normalizeStrings(hypothesis.premiseFactIds),
    }))
    .sort(byId('hypothesisId'));
  if (new Set(hypotheses.map((row) => row.hypothesisId)).size !== hypotheses.length) {
    fail('INDUCTION_HYPOTHESIS_DUPLICATE');
  }
  if (hypotheses.some((row) => !row.statement || row.premiseFactIds.length === 0)) {
    fail('INDUCTION_HYPOTHESIS_UNGROUNDED');
  }
  const zeroHypothesisReason = input.zeroHypothesisReason ?? null;
  const zeroHypothesisReviewReceiptId = input.zeroHypothesisReviewReceiptId?.trim() || null;
  if (zeroHypothesisReason !== null && !ZERO_HYPOTHESIS_REASONS.has(zeroHypothesisReason)) {
    fail('INDUCTION_ZERO_REASON_INVALID');
  }
  if (hypotheses.length === 0 && (!zeroHypothesisReason || !zeroHypothesisReviewReceiptId)) {
    fail('INDUCTION_ZERO_REASON_REQUIRED');
  }
  if (hypotheses.length > 0 && (zeroHypothesisReason || zeroHypothesisReviewReceiptId)) {
    fail('INDUCTION_ZERO_REASON_CONFLICT');
  }
  const semantic = {
    schemaVersion: 1 as const,
    populationHash: input.populationHash,
    clusterHash: input.clusterHash,
    clusterId: input.clusterId,
    observationIds,
    mode: input.mode,
    hypotheses,
    zeroHypothesisReason,
    zeroHypothesisReviewReceiptId,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export function createFalsificationReceiptV1(input: {
  readonly hypothesisId: string;
  readonly enrolledCounterqueryIds: readonly string[];
  readonly executions: readonly CounterqueryExecutionV1[];
  readonly counterqueryApplicability: FalsificationReceiptV1['counterqueryApplicability'];
}): FalsificationReceiptV1 {
  requireText(input.hypothesisId, 'FALSIFICATION_HYPOTHESIS_REQUIRED');
  const enrolledCounterqueryIds = normalizeStrings(input.enrolledCounterqueryIds);
  const enrolled = new Set(enrolledCounterqueryIds);
  const executions = input.executions
    .map((execution) => ({
      ...execution,
      counterexampleFactIds: normalizeStrings(execution.counterexampleFactIds),
    }))
    .sort(byId('counterqueryId'));
  if (new Set(executions.map((row) => row.counterqueryId)).size !== executions.length) {
    fail('FALSIFICATION_COUNTERQUERY_DUPLICATE');
  }
  if (executions.some((row) => !enrolled.has(row.counterqueryId))) {
    fail('FALSIFICATION_COUNTERQUERY_UNENROLLED');
  }
  if (
    executions.some(
      (row) =>
        !COUNTERQUERY_BACKEND_STATUSES.has(row.backendStatus) ||
        typeof row.denominatorComplete !== 'boolean' ||
        typeof row.truncated !== 'boolean'
    )
  ) {
    fail('FALSIFICATION_EXECUTION_INVALID');
  }
  const applicability = input.counterqueryApplicability;
  if (
    !COUNTERQUERY_APPLICABILITY_STATUSES.has(applicability.status) ||
    !applicability.reasonCode?.trim()
  ) {
    fail('FALSIFICATION_APPLICABILITY_INVALID');
  }
  if (applicability.status === 'not-required') {
    if (
      enrolledCounterqueryIds.length !== 0 ||
      executions.length !== 0 ||
      !applicability.reviewerReceiptId?.trim()
    ) {
      fail('FALSIFICATION_NOT_REQUIRED_REVIEW_INVALID');
    }
    const semantic = {
      schemaVersion: 1 as const,
      hypothesisId: input.hypothesisId,
      enrolledCounterqueryIds,
      executions,
      counterqueryApplicability: { ...applicability },
      verdict: 'not-required' as const,
    };
    return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
  }
  if (enrolledCounterqueryIds.length === 0) {
    fail('FALSIFICATION_COUNTERQUERY_REQUIRED');
  }
  const executed = new Set(executions.map((row) => row.counterqueryId));
  const incomplete =
    enrolledCounterqueryIds.some((id) => !executed.has(id)) ||
    executions.some(
      (row) => row.backendStatus !== 'complete' || !row.denominatorComplete || row.truncated
    );
  const verdict: FalsificationReceiptV1['verdict'] = incomplete
    ? 'unknown'
    : executions.some((row) => row.counterexampleFactIds.length > 0)
      ? 'refuted'
      : 'survived';
  const semantic = {
    schemaVersion: 1 as const,
    hypothesisId: input.hypothesisId,
    enrolledCounterqueryIds,
    executions,
    counterqueryApplicability: { ...applicability, reviewerReceiptId: null },
    verdict,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export function createTypedGateReturnV1(input: TypedGateReturnInputV1): TypedGateReturnV1 {
  if (
    !GATE_IDS.has(input.gate) ||
    !GATE_VERDICTS.has(input.verdict) ||
    !/^[a-z0-9][a-z0-9:.-]*$/.test(input.reasonCode)
  ) {
    fail('GATE_RETURN_INVALID');
  }
  const semanticRepairDepth = input.semanticRepairDepth ?? 0;
  if (
    !Number.isInteger(semanticRepairDepth) ||
    semanticRepairDepth < 0 ||
    semanticRepairDepth > 2
  ) {
    fail('GATE_RETURN_REPAIR_LIMIT');
  }
  if (
    input.verdict !== 'pass' &&
    (!input.owner?.trim() || !input.resumePoint?.trim() || !input.permittedMutation?.trim())
  ) {
    fail('GATE_RETURN_OWNER_RESUME_REQUIRED');
  }
  if (
    input.verdict === 'pass' &&
    (input.owner || input.resumePoint || input.permittedMutation || semanticRepairDepth !== 0)
  ) {
    fail('GATE_RETURN_PASS_MUST_BE_TERMINAL');
  }
  const semantic = { schemaVersion: 1 as const, ...input, semanticRepairDepth };
  return freezeDeep({ ...semantic, returnHash: hashCanonicalJson(semantic) });
}

export function validateHypothesisExpressionSetReceiptV1(
  input: HypothesisExpressionSetReceiptInputV1
): HypothesisExpressionSetReceiptV1 {
  if (!Number.isInteger(input.version) || input.version < 1) {
    fail('EXPRESSION_SET_VERSION_INVALID');
  }
  if (input.version === 1 && input.parentReceiptId !== null) {
    fail('EXPRESSION_SET_PARENT_UNEXPECTED');
  }
  if (input.version > 1 && !input.parentReceiptId) {
    fail('EXPRESSION_SET_PARENT_REQUIRED');
  }
  const expressions = [...input.expressions].sort(byId('expressionId'));
  if (new Set(expressions.map((row) => row.expressionId)).size !== expressions.length) {
    fail('EXPRESSION_SET_ROW_DUPLICATE');
  }
  for (const expression of expressions) {
    requireText(expression.authoredFingerprint, 'EXPRESSION_SET_FINGERPRINT_REQUIRED');
    requireText(expression.terminalReceiptId, 'EXPRESSION_SET_TERMINAL_RECEIPT_REQUIRED');
    if (!EXPRESSION_TERMINAL_FATES.has(expression.terminalFate)) {
      fail('EXPRESSION_SET_TERMINAL_FATE_INVALID');
    }
    if (
      (expression.terminalFate === 'reviewed-merge' ||
        expression.terminalFate === 'reviewed-duplicate') &&
      (!expression.matchingRepresentativeId || !expression.matchingContentReadyRecipeId)
    ) {
      fail('EXPRESSION_SET_REPRESENTATIVE_REQUIRED');
    }
  }
  if (expressions.length === 0 && !input.zeroDisposition) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_REQUIRED');
  }
  if (expressions.length > 0 && input.zeroDisposition) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_CONFLICT');
  }
  if (
    input.zeroDisposition &&
    (!input.zeroDisposition.reasonCode || !input.zeroDisposition.reviewerReceiptId)
  ) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_UNREVIEWED');
  }
  const unresolved =
    expressions.filter((row) => row.terminalFate === 'failed' || row.terminalFate === 'unknown')
      .length +
    (input.zeroDisposition?.terminalFate === 'failed' ||
    input.zeroDisposition?.terminalFate === 'unknown'
      ? 1
      : 0);
  let terminalClosure: HypothesisExpressionSetReceiptV1['terminalClosure'] = 'historical';
  if (input.terminalHead) {
    if (unresolved > 0) {
      fail('EXPRESSION_SET_TERMINAL_HEAD_UNRESOLVED');
    }
    if (input.zeroDisposition?.terminalFate === 'reviewed-non-draft') {
      terminalClosure = 'reviewed-non-draft';
    } else if (expressions.some((row) => row.terminalFate === 'content-ready')) {
      terminalClosure = 'expressed';
    } else if (
      expressions.length > 0 &&
      expressions.every(
        (row) =>
          (row.terminalFate === 'reviewed-merge' || row.terminalFate === 'reviewed-duplicate') &&
          Boolean(row.matchingRepresentativeId && row.matchingContentReadyRecipeId)
      )
    ) {
      terminalClosure = 'represented-by';
    } else {
      fail('EXPRESSION_SET_TERMINAL_HEAD_NOT_CLOSED');
    }
  }
  const conservation = {
    authored: expressions.length,
    terminal: expressions.length - unresolved,
    unresolved,
  };
  const semantic = { ...input, expressions, conservation, terminalClosure };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export function validateHypothesisExpressionSetLineageV1(
  receiptsInput: readonly HypothesisExpressionSetReceiptV1[]
): readonly HypothesisExpressionSetReceiptV1[] {
  if (receiptsInput.length === 0) {
    fail('EXPRESSION_SET_LINEAGE_EMPTY');
  }
  const receipts = [...receiptsInput].sort((left, right) => left.version - right.version);
  const first = receipts[0];
  if (!first) {
    fail('EXPRESSION_SET_LINEAGE_EMPTY');
  }
  const ids = new Set<string>();
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const previous = receipts[index - 1];
    if (
      ids.has(receipt.receiptId) ||
      receipt.version !== index + 1 ||
      receipt.parentReceiptId !== (previous?.receiptId ?? null) ||
      receipt.hypothesisId !== first.hypothesisId ||
      receipt.analysisFixpointHash !== first.analysisFixpointHash ||
      receipt.privateCorpusRevision !== first.privateCorpusRevision ||
      (index < receipts.length - 1 && receipt.terminalHead) ||
      (index === receipts.length - 1 && !receipt.terminalHead)
    ) {
      fail('EXPRESSION_SET_LINEAGE_BROKEN');
    }
    ids.add(receipt.receiptId);
  }
  return freezeDeep(receipts);
}

export function createStrictHostAgentAnalysisUnitProjectionV1(
  input: StrictHostAgentAnalysisUnitProjectionV1
): StrictHostAgentAnalysisUnitProjectionV1 {
  if (!input.canonicalSubjectRef || input.factIds.length === 0 || input.witnessIds.length === 0) {
    fail('STRICT_ANALYSIS_UNIT_UNGROUNDED');
  }
  if (
    !ANALYSIS_SCALES.has(input.primaryScale) ||
    input.anatomyLensIds.length === 0 ||
    input.anatomyLensIds.some((lensId) => !ANATOMY_LENSES.has(lensId))
  ) {
    fail('STRICT_ANALYSIS_UNIT_SCOPE_INVALID');
  }
  if (input.parentSubjectRefs.includes(input.canonicalSubjectRef)) {
    fail('STRICT_ANALYSIS_UNIT_PARENT_SELF_REFERENCE');
  }
  return freezeDeep({
    schemaVersion: 1,
    canonicalSubjectRef: input.canonicalSubjectRef,
    parentSubjectRefs: normalizeStrings(input.parentSubjectRefs),
    primaryScale: input.primaryScale,
    anatomyLensIds: normalizeStrings(input.anatomyLensIds) as AnatomyLensId[],
    factIds: normalizeStrings(input.factIds),
    witnessIds: normalizeStrings(input.witnessIds),
  });
}

export function createStrictHostAgentAnalysisUnitProjectionFromFactsV1(input: {
  readonly canonicalSubjectRef: string;
  readonly parentSubjectRefs: readonly string[];
  readonly primaryScale: AnalysisScale;
  readonly anatomyLensIds: readonly AnatomyLensId[];
  readonly facts: readonly FactRecordV1[];
}): StrictHostAgentAnalysisUnitProjectionV1 {
  const facts = input.facts.filter(
    (fact) => fact.canonicalSubjectRef === input.canonicalSubjectRef
  );
  if (facts.length === 0) {
    fail('STRICT_ANALYSIS_UNIT_SUBJECT_FACTS_REQUIRED');
  }
  const sourceRevisionHashes = new Set(facts.map((fact) => fact.sourceRevisionVectorHash));
  if (sourceRevisionHashes.size !== 1) {
    fail('STRICT_ANALYSIS_UNIT_SOURCE_REVISION_MISMATCH');
  }
  return createStrictHostAgentAnalysisUnitProjectionV1({
    schemaVersion: 1,
    canonicalSubjectRef: input.canonicalSubjectRef,
    parentSubjectRefs: input.parentSubjectRefs,
    primaryScale: input.primaryScale,
    anatomyLensIds: input.anatomyLensIds,
    factIds: facts.map((fact) => fact.factId),
    witnessIds: facts.flatMap((fact) => fact.witnessIds),
  });
}

export function validateAnalysisScheduleExpansionV1(input: {
  readonly previousExpansionHeadHash: string | null;
  readonly baselineObligationIds: readonly string[];
  readonly existingExpansionObligationIds: readonly string[];
  readonly rows: readonly AnalysisScheduleExpansionRowV1[];
  readonly knownFactFamilies: readonly {
    readonly id: string;
    readonly capabilityId: string;
    readonly supportedScales: readonly AnalysisScale[];
  }[];
  readonly knownSubjectRefs: readonly string[];
  readonly obligationCap: number;
}): AnalysisScheduleExpansionReceiptV1 {
  const existing = new Set([
    ...input.baselineObligationIds,
    ...input.existingExpansionObligationIds,
  ]);
  const families = new Map(input.knownFactFamilies.map((family) => [family.id, family]));
  const subjects = new Set(input.knownSubjectRefs);
  const rows = [...input.rows].sort(byId('obligationId'));
  for (const row of rows) {
    if (existing.has(row.obligationId)) {
      fail('ANALYSIS_EXPANSION_DUPLICATE_OBLIGATION');
    }
    const family = families.get(row.factFamilyId);
    if (!family) {
      fail('ANALYSIS_EXPANSION_UNKNOWN_FACT_FAMILY');
    }
    if (
      family.capabilityId !== row.capabilityId ||
      !family.supportedScales.includes(row.analysisScale)
    ) {
      fail('ANALYSIS_EXPANSION_QUERY_CAPABILITY_SCALE_MISMATCH');
    }
    if (!subjects.has(row.canonicalSubjectRef)) {
      fail('ANALYSIS_EXPANSION_UNKNOWN_SUBJECT');
    }
    if (
      !EXPANSION_PURPOSES.has(row.purpose) ||
      !ANALYSIS_SCALES.has(row.analysisScale) ||
      !row.reasonCode
    ) {
      fail('ANALYSIS_EXPANSION_PURPOSE_REQUIRED');
    }
    existing.add(row.obligationId);
  }
  const resultingScheduledCount = existing.size;
  if (resultingScheduledCount > input.obligationCap) {
    fail('MINING_SCALE_UNSUPPORTED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    previousExpansionHeadHash: input.previousExpansionHeadHash,
    rows,
    resultingScheduledCount,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export function createFinalExpandedMiningScheduleReceiptV1(input: {
  readonly baselineScheduleHash: string;
  readonly baselineObligationIds: readonly string[];
  readonly expansionReceipts: readonly AnalysisScheduleExpansionReceiptV1[];
}): FinalExpandedMiningScheduleReceiptV1 {
  requireText(input.baselineScheduleHash, 'ANALYSIS_BASELINE_SCHEDULE_HASH_REQUIRED');
  const obligationIds = new Set(normalizeStrings(input.baselineObligationIds));
  let previousHead: string | null = null;
  let explorationObligationCount = 0;
  let counterexampleObligationCount = 0;
  for (const receipt of input.expansionReceipts) {
    const receiptSemantic = {
      schemaVersion: 1 as const,
      previousExpansionHeadHash: receipt.previousExpansionHeadHash,
      rows: receipt.rows,
      resultingScheduledCount: receipt.resultingScheduledCount,
    };
    if (receipt.receiptHash !== hashCanonicalJson(receiptSemantic)) {
      fail('ANALYSIS_EXPANSION_RECEIPT_HASH_MISMATCH');
    }
    if (receipt.previousExpansionHeadHash !== previousHead) {
      fail('ANALYSIS_EXPANSION_CHAIN_BROKEN');
    }
    for (const row of receipt.rows) {
      if (obligationIds.has(row.obligationId)) {
        fail('ANALYSIS_EXPANSION_DUPLICATE_OBLIGATION');
      }
      obligationIds.add(row.obligationId);
      if (row.purpose === 'counterexample') {
        counterexampleObligationCount += 1;
      } else {
        explorationObligationCount += 1;
      }
    }
    if (receipt.resultingScheduledCount !== obligationIds.size) {
      fail('ANALYSIS_EXPANSION_SCHEDULE_CONSERVATION');
    }
    previousHead = receipt.receiptHash;
  }
  const semantic = {
    schemaVersion: 1 as const,
    baselineScheduleHash: input.baselineScheduleHash,
    expansionReceiptHashes: input.expansionReceipts.map((receipt) => receipt.receiptHash),
    obligationIds: [...obligationIds].sort(),
    explorationObligationCount,
    counterexampleObligationCount,
  };
  return freezeDeep({ ...semantic, finalExpandedScheduleHash: hashCanonicalJson(semantic) });
}

export function createAnalysisFixpointReceiptV1(input: {
  readonly finalExpandedSchedule: FinalExpandedMiningScheduleReceiptV1;
  readonly terminalObligations: AnalysisFixpointReceiptV1['terminalObligations'];
  readonly populationHashes: readonly string[];
  readonly clusterSets: readonly KnowledgeClusterSetV1[];
  readonly inductionReceiptHashes: readonly string[];
  readonly falsificationReceiptHashes: readonly string[];
}): AnalysisFixpointReceiptV1 {
  const finalScheduleSemantic = {
    schemaVersion: 1 as const,
    baselineScheduleHash: input.finalExpandedSchedule.baselineScheduleHash,
    expansionReceiptHashes: input.finalExpandedSchedule.expansionReceiptHashes,
    obligationIds: input.finalExpandedSchedule.obligationIds,
    explorationObligationCount: input.finalExpandedSchedule.explorationObligationCount,
    counterexampleObligationCount: input.finalExpandedSchedule.counterexampleObligationCount,
  };
  if (
    input.finalExpandedSchedule.finalExpandedScheduleHash !==
    hashCanonicalJson(finalScheduleSemantic)
  ) {
    fail('ANALYSIS_FIXPOINT_SCHEDULE_HASH_MISMATCH');
  }
  const scheduled = normalizeStrings(input.finalExpandedSchedule.obligationIds);
  const terminalObligations = [...input.terminalObligations].sort(byId('obligationId'));
  if (
    new Set(terminalObligations.map((row) => row.obligationId)).size !== terminalObligations.length
  ) {
    fail('ANALYSIS_FIXPOINT_TERMINAL_DUPLICATE');
  }
  if (
    JSON.stringify(terminalObligations.map((row) => row.obligationId)) !== JSON.stringify(scheduled)
  ) {
    fail('ANALYSIS_FIXPOINT_SCHEDULE_CONSERVATION');
  }
  if (
    terminalObligations.some(
      (row) => !row.terminalReceiptId || !FACT_QUERY_TERMINAL_DISPOSITIONS.has(row.disposition)
    )
  ) {
    fail('ANALYSIS_FIXPOINT_TERMINAL_RECEIPT_REQUIRED');
  }
  if (
    terminalObligations.some((row) => row.disposition === 'failed' || row.disposition === 'unknown')
  ) {
    fail('ANALYSIS_FIXPOINT_NONTERMINAL');
  }
  if (
    input.clusterSets.some((clusterSet) =>
      clusterSet.dispositions.some((disposition) => disposition.status === 'unresolved')
    )
  ) {
    fail('ANALYSIS_FIXPOINT_CLUSTER_UNRESOLVED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    finalExpandedScheduleHash: input.finalExpandedSchedule.finalExpandedScheduleHash,
    terminalObligations,
    populationHashes: normalizeStrings(input.populationHashes),
    clusterSetHashes: normalizeStrings(
      input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash)
    ),
    inductionReceiptHashes: normalizeStrings(input.inductionReceiptHashes),
    falsificationReceiptHashes: normalizeStrings(input.falsificationReceiptHashes),
  };
  return freezeDeep({ ...semantic, fixpointHash: hashCanonicalJson(semantic) });
}

export function createAnalysisArtifactProjectionV1(input: {
  readonly artifactId: string;
  readonly sourceRevisionVectorHash: string;
  readonly facts: readonly FactRecordV1[];
  readonly populations: readonly ObservationPopulationV1[];
  readonly clusterSets: readonly KnowledgeClusterSetV1[];
  readonly analysisFixpoint: AnalysisFixpointReceiptV1;
}): AnalysisArtifactProjectionV1 {
  if (
    !input.artifactId ||
    !input.sourceRevisionVectorHash ||
    !input.analysisFixpoint.fixpointHash
  ) {
    fail('ANALYSIS_ARTIFACT_PROJECTION_IDENTITY_REQUIRED');
  }
  if (
    input.facts.some((fact) => fact.sourceRevisionVectorHash !== input.sourceRevisionVectorHash) ||
    input.populations.some(
      (population) => population.sourceRevisionVectorHash !== input.sourceRevisionVectorHash
    )
  ) {
    fail('ANALYSIS_ARTIFACT_SOURCE_REVISION_MISMATCH');
  }
  const populationHashes = normalizeStrings(
    input.populations.map((population) => population.populationHash)
  );
  const clusterSetHashes = normalizeStrings(
    input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash)
  );
  if (
    JSON.stringify(populationHashes) !== JSON.stringify(input.analysisFixpoint.populationHashes) ||
    JSON.stringify(clusterSetHashes) !== JSON.stringify(input.analysisFixpoint.clusterSetHashes)
  ) {
    fail('ANALYSIS_ARTIFACT_FIXPOINT_LINEAGE_MISMATCH');
  }
  const semantic = {
    schemaVersion: 1 as const,
    artifactId: input.artifactId,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    factIds: normalizeStrings(input.facts.map((fact) => fact.factId)),
    witnessIds: normalizeStrings(input.facts.flatMap((fact) => fact.witnessIds)),
    populationHashes,
    clusterSetHashes,
    analysisFixpointHash: input.analysisFixpoint.fixpointHash,
  };
  return freezeDeep({ ...semantic, projectionHash: hashCanonicalJson(semantic) });
}

function normalizeWitness(input: FactWitnessInputV1): FactWitnessV1 {
  if (input.kind === 'direct') {
    if (
      !EVIDENCE_ID_RE.test(input.evidenceEntryId) ||
      !input.evidenceSessionId ||
      !input.evidenceContentHash ||
      !input.sourceRevisionVectorHash ||
      !input.projectContextRefId ||
      !input.canonicalSubjectRef ||
      !input.anchor.relativePath ||
      !input.anchor.blobHash ||
      (input.anchor.range && !validRange(input.anchor.range))
    ) {
      fail('FACT_DIRECT_WITNESS_UNBOUND');
    }
    const semantic = {
      kind: 'direct' as const,
      evidenceContentHash: input.evidenceContentHash,
      sourceRevisionVectorHash: input.sourceRevisionVectorHash,
      canonicalSubjectRef: input.canonicalSubjectRef,
      anchor: {
        ...input.anchor,
        relativePath: normalizeRelativePath(input.anchor.relativePath),
      },
    };
    return freezeDeep({
      ...semantic,
      witnessId: `witness:${hashCanonicalJson(semantic).slice(7)}`,
    });
  }
  if (
    !input.derivationRuleId ||
    !input.sourceRevisionVectorHash ||
    input.orderedPremiseFactIds.length === 0 ||
    new Set(input.orderedPremiseFactIds).size !== input.orderedPremiseFactIds.length
  ) {
    fail('FACT_DERIVED_WITNESS_INVALID');
  }
  const semantic = { ...input, orderedPremiseFactIds: [...input.orderedPremiseFactIds] };
  return freezeDeep({ ...semantic, witnessId: `witness:${hashCanonicalJson(semantic).slice(7)}` });
}

function directWitnessIdentity(witness: FactWitnessV1): unknown {
  if (witness.kind !== 'direct') {
    fail('FACT_DIRECT_WITNESS_REQUIRED');
  }
  return {
    evidenceContentHash: witness.evidenceContentHash,
    sourceRevisionVectorHash: witness.sourceRevisionVectorHash,
    canonicalSubjectRef: witness.canonicalSubjectRef,
    anchor: witness.anchor,
  };
}

function validRange(range: EvidenceRange | DirectFactWitnessInputV1['anchor']['range']): boolean {
  if (!range) {
    return false;
  }
  const start = 'start' in range ? range.start : range.startLine;
  const end = 'end' in range ? range.end : range.endLine;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    fail('FACT_ANCHOR_PATH_INVALID');
  }
  return normalized;
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function uniqueCanonicalValues(values: readonly unknown[]): unknown[] {
  const byHash = new Map(values.map((value) => [hashCanonicalJson(value), value] as const));
  return [...byHash.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function byId<K extends string>(key: K) {
  return <T extends Record<K, string>>(left: T, right: T): number =>
    left[key].localeCompare(right[key]);
}

function requireText(value: string, code: string): void {
  if (!value?.trim()) {
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

const ANALYSIS_SCALES = new Set<AnalysisScale>([
  'source-range',
  'symbol',
  'file',
  'module',
  'package',
  'repository',
  'project',
]);
const ANATOMY_LENSES = new Set<string>(ANATOMY_LENS_IDS);
const ZERO_HYPOTHESIS_REASONS = new Set<NonNullable<InductionReceiptV1['zeroHypothesisReason']>>([
  'refuted',
  'insufficient-evidence',
  'unknown',
]);
const COUNTERQUERY_BACKEND_STATUSES = new Set<CounterqueryExecutionV1['backendStatus']>([
  'complete',
  'missing',
  'failed',
  'unknown',
]);
const COUNTERQUERY_APPLICABILITY_STATUSES = new Set<
  FalsificationReceiptV1['counterqueryApplicability']['status']
>(['required', 'not-required']);
const GATE_IDS = new Set<TypedGateReturnInputV1['gate']>([
  'G1',
  'ADMISSION',
  'G2',
  'G3',
  'G4',
  'DURABLE',
  'PUBLIC',
]);
const GATE_VERDICTS = new Set<TypedGateReturnInputV1['verdict']>([
  'pass',
  'revise',
  'reject',
  'failed',
  'unknown',
]);
const EXPRESSION_TERMINAL_FATES = new Set<HypothesisExpressionTerminalFate>([
  'content-ready',
  'reviewed-merge',
  'reviewed-duplicate',
  'g1-rejected',
  'admission-rejected',
  'g2-rejected',
  'repair-superseded',
  'failed',
  'unknown',
]);
const EXPANSION_PURPOSES = new Set<AnalysisExpansionPurposeV1>(['exploration', 'counterexample']);
const FACT_QUERY_TERMINAL_DISPOSITIONS = new Set<
  AnalysisFixpointReceiptV1['terminalObligations'][number]['disposition']
>(['matched', 'inspected-no-pattern', 'failed', 'unknown']);

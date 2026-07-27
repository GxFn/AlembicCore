import type { EvidenceRange } from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import { EVIDENCE_ID_RE } from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import {
  ANATOMY_LENS_IDS,
  type AnalysisScale,
  type AnatomyLensId,
} from '../plan/intent/coldStartProductionPlan.js';
import { hashCanonicalJson, toProjectFactsJson } from '../project-context/foundation/canonical.js';
import {
  assertProductionActorIdentityV1,
  type ProductionActorIdentityV1,
} from './ProductionActorIdentity.js';
import {
  assertFactQueryExecutionReceiptV1,
  assertReviewAuthorizingFactExecutionV1,
  type FactQueryExecutionReceiptV1,
} from './StrictFactExecutionReceipt.js';

export interface DirectFactWitnessInputV1 {
  readonly kind: 'direct';
  readonly evidenceEntryId: string;
  readonly evidenceSessionId: string;
  readonly evidenceContentHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly projectContextRefId: string;
  readonly projectContextRefHash: string;
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
      readonly evidenceEntryId: string;
      readonly evidenceSessionId: string;
      readonly evidenceContentHash: string;
      readonly sourceRevisionVectorHash: string;
      readonly projectContextRefId: string;
      readonly projectContextRefHash: string;
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
  readonly primaryScale: AnalysisScale;
  readonly sourceRevisionVectorHash: string;
  readonly value: ReturnType<typeof toProjectFactsJson>;
  readonly valueHash: string;
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
  /** 一个 observation 可以汇合多个已执行 obligation，但不能脱离真实执行收据单独声明事实。 */
  readonly obligationIds: readonly string[];
  /** 兼容 Analyst 的候选提示；最终 cluster mechanism 不受该字段约束。 */
  readonly mechanismKey?: string | null;
  readonly canonicalSubjectRefs: readonly string[];
  readonly parentSubjectRefs: readonly string[];
  readonly variantKeys: readonly string[];
  readonly outlierReasonCodes: readonly string[];
  readonly negativeControl: boolean;
}

export interface ObservationPopulationInputV1 {
  readonly populationId: string;
  readonly revision: number;
  readonly parentPopulationHash: string | null;
  readonly sourceRevisionVectorHash: string;
  readonly denominator: {
    readonly kind: 'frozen-complete-subjects';
    readonly expectedObservationIds: readonly string[];
    readonly expectedObligationIds: readonly string[];
    readonly executionReceiptHashes: readonly string[];
    readonly outputHashes: readonly string[];
    readonly denominatorHashes: readonly string[];
    readonly complete: boolean;
    readonly truncated: boolean;
    readonly continuation: string | null;
    readonly omittedObservationIds: readonly string[];
  };
  /**
   * 调用者提供的 hash 只用于跨进程传输；canonicalizer 必须重新验收真实 receipt 后才能把
   * population 标成 complete。为兼容历史 evidence，缺少 receipt 时仍生成 unknown。
   */
  readonly executionReceipts?: readonly FactQueryExecutionReceiptV1[];
  readonly observations: readonly ObservationV1[];
  readonly duplicateObservations: readonly {
    readonly observationId: string;
    readonly duplicateOf: string;
    readonly factIds: readonly string[];
    readonly obligationIds: readonly string[];
    readonly canonicalSubjectRefs: readonly string[];
    readonly parentSubjectRefs: readonly string[];
  }[];
  readonly excludedObservations: readonly {
    readonly observationId: string;
    readonly reasonCode: string;
    readonly factIds: readonly string[];
    readonly obligationIds: readonly string[];
    readonly canonicalSubjectRefs: readonly string[];
    readonly parentSubjectRefs: readonly string[];
  }[];
  readonly errorObservations: readonly {
    readonly observationId: string;
    readonly reasonCode: string;
    readonly factIds: readonly string[];
    readonly obligationIds: readonly string[];
    readonly canonicalSubjectRefs: readonly string[];
    readonly parentSubjectRefs: readonly string[];
  }[];
  readonly inspectedNoPatternObservations: readonly {
    readonly observationId: string;
    readonly obligationId: string;
    readonly canonicalSubjectRef: string;
    readonly parentSubjectRefs: readonly string[];
    readonly executionReceiptHash: string;
    readonly outputHash: string;
    readonly denominatorHash: string;
  }[];
}

export interface ObservationPopulationV1
  extends Omit<ObservationPopulationInputV1, 'executionReceipts'> {
  readonly schemaVersion: 1;
  readonly populationHash: string;
  readonly completion: 'complete' | 'unknown';
  readonly conservation: {
    readonly raw: number;
    readonly accepted: number;
    readonly duplicate: number;
    readonly excluded: number;
    readonly error: number;
    readonly inspectedNoPattern: number;
    readonly omitted: number;
  };
}

export interface KnowledgeClusterInputV1 {
  readonly mechanismKey: string;
  readonly mechanism: unknown;
  readonly observationIds: readonly string[];
  readonly mechanismEvidenceFactIds: readonly string[];
  readonly anatomyLensIds: readonly string[];
}

export interface KnowledgeClusterV1 {
  readonly clusterId: string;
  readonly populationHash: string;
  readonly mechanismKey: string;
  readonly mechanism: ReturnType<typeof toProjectFactsJson>;
  readonly observationIds: readonly string[];
  readonly mechanismEvidenceFactIds: readonly string[];
  readonly anatomyLensIds: readonly string[];
  readonly memberFactIds: readonly string[];
  readonly canonicalSubjectRefs: readonly string[];
  readonly parentSubjectRefs: readonly string[];
  readonly variantKeys: readonly string[];
  readonly outlierObservationIds: readonly string[];
  readonly negativeControlObservationIds: readonly string[];
  readonly memberLineage: readonly {
    readonly observationId: string;
    readonly factIds: readonly string[];
    readonly obligationIds: readonly string[];
    readonly canonicalSubjectRefs: readonly string[];
    readonly parentSubjectRefs: readonly string[];
    readonly variantKeys: readonly string[];
    readonly outlierReasonCodes: readonly string[];
    readonly negativeControl: boolean;
  }[];
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

export interface KnowledgeClusterSemanticTransitionV1 {
  readonly schemaVersion: 1;
  readonly reviewKind: 'semantic-merge' | 'semantic-split';
  readonly populationHash: string;
  readonly sourceClusterSetHash: string;
  readonly targetClusterSetHash: string;
  readonly sourceClusterIds: readonly string[];
  readonly targetClusterIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly reasonCode: string;
  readonly dispositionReviewReceiptId: string;
  readonly transitionHash: string;
}

export function hashKnowledgeClusterV1(cluster: KnowledgeClusterV1): string {
  const { clusterId, ...semantic } = cluster;
  const clusterHash = hashCanonicalJson(semantic);
  if (clusterId !== `cluster:${clusterHash.slice(7)}`) {
    fail('CLUSTER_IDENTITY_INVALID');
  }
  return clusterHash;
}

export function hashKnowledgeClusterSetV1(clusterSet: KnowledgeClusterSetV1): string {
  return hashCanonicalJson({
    schemaVersion: clusterSet.schemaVersion,
    populationHash: clusterSet.populationHash,
    clusters: clusterSet.clusters,
    dispositions: clusterSet.dispositions.map(
      ({ reviewerReceiptId: _reviewerReceiptId, ...disposition }) => disposition
    ),
  });
}

/**
 * cluster review 在最终 cluster set 之前发生。proposal hash 排除尚不存在的 review ID，
 * 从而形成 population→cluster proposal→review→reviewed cluster set 的无环构造顺序。
 */
export function hashKnowledgeClusterSetProposalV1(
  population: ObservationPopulationV1,
  input: {
    readonly clusters: readonly KnowledgeClusterInputV1[];
    readonly nonClusteredDispositions: readonly {
      readonly observationId: string;
      readonly status: 'discarded' | 'unresolved';
      readonly reasonCode: string;
      readonly owner?: string;
      readonly resumePoint?: string;
    }[];
  }
): string {
  const observations = new Map(population.observations.map((row) => [row.observationId, row]));
  const clusters = input.clusters
    .map((candidate) => canonicalizeKnowledgeCluster(population, candidate, observations))
    .sort(byId('clusterId'));
  const nonClustered = new Map(
    input.nonClusteredDispositions.map((row) => [row.observationId, row] as const)
  );
  if (
    new Set(clusters.map((cluster) => cluster.clusterId)).size !== clusters.length ||
    nonClustered.size !== input.nonClusteredDispositions.length
  ) {
    fail('CLUSTER_PROPOSAL_DUPLICATE');
  }
  const dispositions = [...observations.keys()].sort().map((observationId) => {
    const clusterIds = clusters
      .filter((cluster) => cluster.observationIds.includes(observationId))
      .map((cluster) => cluster.clusterId);
    const nonClusteredDisposition = nonClustered.get(observationId);
    if (clusterIds.length > 0) {
      if (nonClusteredDisposition) {
        fail('CLUSTER_DISPOSITION_DUPLICATE');
      }
      return {
        observationId,
        status: 'clustered' as const,
        clusterIds,
        reasonCode: null,
        reviewerReceiptId: null,
        owner: null,
        resumePoint: null,
      };
    }
    if (!nonClusteredDisposition?.reasonCode.trim()) {
      fail('CLUSTER_DISPOSITION_MISSING');
    }
    if (
      nonClusteredDisposition.status === 'unresolved' &&
      (!nonClusteredDisposition.owner?.trim() || !nonClusteredDisposition.resumePoint?.trim())
    ) {
      fail('CLUSTER_UNRESOLVED_OWNER_REQUIRED');
    }
    return {
      observationId,
      status: nonClusteredDisposition.status,
      clusterIds,
      reasonCode: nonClusteredDisposition.reasonCode.trim(),
      reviewerReceiptId: null,
      owner: nonClusteredDisposition.owner?.trim() ?? null,
      resumePoint: nonClusteredDisposition.resumePoint?.trim() ?? null,
    };
  });
  if ([...nonClustered.keys()].some((observationId) => !observations.has(observationId))) {
    fail('CLUSTER_OBSERVATION_UNKNOWN');
  }
  return hashKnowledgeClusterSetV1({
    schemaVersion: 1,
    populationHash: population.populationHash,
    clusters,
    dispositions,
    clusterSetHash: '',
  });
}

/**
 * merge/split 只有在 before/after cluster set 对同一 observation 集守恒时才成为真实处置。
 * review kind 本身不构成 consumer；该 transition receipt 才是 unified authority 可消费的事实。
 */
export function createKnowledgeClusterSemanticTransitionV1(input: {
  readonly reviewKind: 'semantic-merge' | 'semantic-split';
  readonly sourceClusterSet: KnowledgeClusterSetV1;
  readonly targetClusterSet: KnowledgeClusterSetV1;
  readonly sourceClusterIds: readonly string[];
  readonly targetClusterIds: readonly string[];
  readonly reasonCode: string;
  readonly dispositionReview: KnowledgeDispositionReviewV1;
}): KnowledgeClusterSemanticTransitionV1 {
  if (input.sourceClusterSet.clusterSetHash !== hashKnowledgeClusterSetV1(input.sourceClusterSet)) {
    fail('CLUSTER_TRANSITION_SOURCE_INVALID');
  }
  if (input.targetClusterSet.clusterSetHash !== hashKnowledgeClusterSetV1(input.targetClusterSet)) {
    fail('CLUSTER_TRANSITION_TARGET_INVALID');
  }
  const sourceClusterIds = normalizeStrings(input.sourceClusterIds);
  const targetClusterIds = normalizeStrings(input.targetClusterIds);
  const sourceClusters = selectTransitionClusters(
    input.sourceClusterSet,
    sourceClusterIds,
    'CLUSTER_TRANSITION_SOURCE_INVALID'
  );
  const targetClusters = selectTransitionClusters(
    input.targetClusterSet,
    targetClusterIds,
    'CLUSTER_TRANSITION_TARGET_INVALID'
  );
  const sourceObservationRows = sourceClusters.flatMap((cluster) => cluster.observationIds);
  const targetObservationRows = targetClusters.flatMap((cluster) => cluster.observationIds);
  const sourceObservationIds = normalizeStrings(sourceObservationRows);
  const targetObservationIds = normalizeStrings(targetObservationRows);
  const selectedObservationIds = new Set(sourceObservationIds);
  const sourceUnselectedClusters = input.sourceClusterSet.clusters.filter(
    (cluster) => !sourceClusterIds.includes(cluster.clusterId)
  );
  const targetUnselectedClusters = input.targetClusterSet.clusters.filter(
    (cluster) => !targetClusterIds.includes(cluster.clusterId)
  );
  const transitionSelectionIncomplete =
    sourceUnselectedClusters.some((cluster) =>
      cluster.observationIds.some((observationId) => selectedObservationIds.has(observationId))
    ) ||
    targetUnselectedClusters.some((cluster) =>
      cluster.observationIds.some((observationId) => selectedObservationIds.has(observationId))
    );
  const sourceComplement = {
    clusters: sourceUnselectedClusters,
    dispositions: input.sourceClusterSet.dispositions.filter(
      (row) => !selectedObservationIds.has(row.observationId)
    ),
  };
  const targetComplement = {
    clusters: targetUnselectedClusters,
    dispositions: input.targetClusterSet.dispositions.filter(
      (row) => !selectedObservationIds.has(row.observationId)
    ),
  };
  const sourceObligationIds = normalizeStrings(
    sourceClusters.flatMap((cluster) =>
      cluster.memberLineage.flatMap((member) => member.obligationIds)
    )
  );
  const shapeInvalid =
    input.reviewKind === 'semantic-merge'
      ? sourceClusterIds.length < 2 || targetClusterIds.length !== 1
      : sourceClusterIds.length !== 1 || targetClusterIds.length < 2;
  requireText(input.reasonCode, 'CLUSTER_TRANSITION_REASON_REQUIRED');
  assertKnowledgeDispositionReviewIntegrity(input.dispositionReview);
  if (
    shapeInvalid ||
    input.sourceClusterSet.clusterSetHash === input.targetClusterSet.clusterSetHash ||
    transitionSelectionIncomplete ||
    hashCanonicalJson(sourceComplement) !== hashCanonicalJson(targetComplement) ||
    sourceObservationRows.length !== sourceObservationIds.length ||
    targetObservationRows.length !== targetObservationIds.length ||
    input.sourceClusterSet.populationHash !== input.targetClusterSet.populationHash ||
    !sameStringSet(sourceObservationIds, targetObservationIds) ||
    input.dispositionReview.reviewKind !== input.reviewKind ||
    input.dispositionReview.verdict !== 'pass' ||
    input.dispositionReview.populationHash !== input.sourceClusterSet.populationHash ||
    !sameStringSet(input.dispositionReview.obligationIds, sourceObligationIds) ||
    input.dispositionReview.proposedDispositionHash !==
      hashKnowledgeDispositionProposalV1({
        reviewKind: input.reviewKind,
        populationHash: input.sourceClusterSet.populationHash,
        sourceClusterSetHash: input.sourceClusterSet.clusterSetHash,
        targetClusterSetHash: input.targetClusterSet.clusterSetHash,
        sourceClusterIds,
        targetClusterIds,
        observationIds: sourceObservationIds,
        reasonCode: input.reasonCode,
      })
  ) {
    fail('CLUSTER_TRANSITION_REVIEW_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    reviewKind: input.reviewKind,
    populationHash: input.sourceClusterSet.populationHash,
    sourceClusterSetHash: input.sourceClusterSet.clusterSetHash,
    targetClusterSetHash: input.targetClusterSet.clusterSetHash,
    sourceClusterIds,
    targetClusterIds,
    observationIds: sourceObservationIds,
    reasonCode: input.reasonCode.trim(),
    dispositionReviewReceiptId: input.dispositionReview.reviewReceiptId,
  };
  return freezeDeep({ ...semantic, transitionHash: hashCanonicalJson(semantic) });
}

function selectTransitionClusters(
  clusterSet: KnowledgeClusterSetV1,
  clusterIds: readonly string[],
  code: string
): KnowledgeClusterV1[] {
  const byId = new Map(clusterSet.clusters.map((cluster) => [cluster.clusterId, cluster]));
  const clusters = clusterIds.map((clusterId) => byId.get(clusterId));
  if (clusterIds.length === 0 || clusters.some((cluster) => !cluster)) {
    fail(code);
  }
  return clusters as KnowledgeClusterV1[];
}

export interface KnowledgeClusterCanonicalizationInputV1 {
  readonly clusters: readonly KnowledgeClusterInputV1[];
  readonly nonClusteredDispositions: readonly {
    readonly observationId: string;
    readonly status: 'discarded' | 'unresolved';
    readonly reasonCode: string;
    readonly dispositionReview?: KnowledgeDispositionReviewV1;
    /** @deprecated A string is retained only so legacy callers receive a typed rejection. */
    readonly reviewerReceiptId?: string;
    readonly owner?: string;
    readonly resumePoint?: string;
  }[];
}

export type KnowledgeDispositionReviewKindV1 =
  | 'cluster-discard'
  | 'zero-hypothesis'
  | 'falsification'
  | 'semantic-merge'
  | 'semantic-split'
  | 'producer-non-draft'
  | 'investigated-empty';

/**
 * 评审签名的不是调用者自报字符串，而是由实际处置 consumer 可重建的规范语义。
 * `currentAnalysisFixpointHash`、执行分母和 actor identity 由 review receipt 另行封印。
 */
export type KnowledgeDispositionProposalV1 =
  | {
      readonly reviewKind: 'cluster-discard';
      readonly populationHash: string;
      readonly observationId: string;
      readonly status: 'discarded';
      readonly reasonCode: string;
    }
  | {
      readonly reviewKind: 'zero-hypothesis';
      readonly populationHash: string;
      readonly clusterHash: string;
      readonly clusterId: string;
      readonly observationIds: readonly string[];
      readonly mode: InductionReceiptV1['mode'];
      readonly zeroHypothesisReason: NonNullable<InductionReceiptV1['zeroHypothesisReason']>;
    }
  | {
      readonly reviewKind: 'falsification';
      readonly populationHash: string;
      readonly hypothesisId: string;
      readonly enrolledCounterqueryIds: readonly string[];
      readonly executions: readonly {
        readonly counterqueryId: string;
        readonly obligationId: string;
        readonly executionReceiptHash: string;
        readonly executionOutputHash: string;
        readonly denominatorHash: string;
        readonly counterexampleFactIds: readonly string[];
      }[];
      readonly counterqueryApplicability: {
        readonly status: FalsificationReceiptV1['counterqueryApplicability']['status'];
        readonly reasonCode: string;
      };
    }
  | {
      readonly reviewKind: 'producer-non-draft';
      readonly populationHash: string;
      readonly hypothesisId: string;
      readonly expression: {
        readonly expressionId: string;
        readonly authoredFingerprint: string;
        readonly terminalFate: HypothesisExpressionTerminalFate;
        readonly matchingRepresentativeId: string | null;
        readonly matchingContentReadyRecipeId: string | null;
      } | null;
      readonly zeroDisposition: {
        readonly reasonCode: string;
        readonly terminalFate:
          | 'reviewed-non-draft'
          | 'rejected'
          | 'repair-superseded'
          | 'failed'
          | 'unknown';
      } | null;
    }
  | {
      readonly reviewKind: 'investigated-empty';
      readonly populationHash: string;
      readonly sourceRevisionVectorHash: string;
      readonly finalExpandedScheduleHash: string;
      readonly currentAnalysisFixpointHash: string;
      readonly expectedObligationIds: readonly string[];
      readonly executionBindings: readonly KnowledgeDispositionExecutionBindingV1[];
      readonly evidenceEntryIds: readonly string[];
    }
  | {
      readonly reviewKind: 'semantic-merge' | 'semantic-split';
      readonly populationHash: string;
      readonly sourceClusterSetHash: string;
      readonly targetClusterSetHash: string;
      readonly sourceClusterIds: readonly string[];
      readonly targetClusterIds: readonly string[];
      readonly observationIds: readonly string[];
      readonly reasonCode: string;
    };

export function hashKnowledgeDispositionProposalV1(
  proposal: KnowledgeDispositionProposalV1
): string {
  let normalized: KnowledgeDispositionProposalV1;
  switch (proposal.reviewKind) {
    case 'cluster-discard':
      normalized = { ...proposal, reasonCode: proposal.reasonCode.trim() };
      break;
    case 'zero-hypothesis':
      normalized = { ...proposal, observationIds: normalizeStrings(proposal.observationIds) };
      break;
    case 'falsification':
      normalized = {
        ...proposal,
        enrolledCounterqueryIds: normalizeStrings(proposal.enrolledCounterqueryIds),
        executions: proposal.executions
          .map((execution) => ({
            ...execution,
            counterexampleFactIds: normalizeStrings(execution.counterexampleFactIds),
          }))
          .sort(byId('obligationId')),
        counterqueryApplicability: {
          ...proposal.counterqueryApplicability,
          reasonCode: proposal.counterqueryApplicability.reasonCode.trim(),
        },
      };
      break;
    case 'producer-non-draft':
      normalized = {
        ...proposal,
        expression: proposal.expression
          ? {
              ...proposal.expression,
              matchingRepresentativeId: proposal.expression.matchingRepresentativeId ?? null,
              matchingContentReadyRecipeId:
                proposal.expression.matchingContentReadyRecipeId ?? null,
            }
          : null,
        zeroDisposition: proposal.zeroDisposition
          ? {
              ...proposal.zeroDisposition,
              reasonCode: proposal.zeroDisposition.reasonCode.trim(),
            }
          : null,
      };
      break;
    case 'investigated-empty':
      normalized = {
        ...proposal,
        expectedObligationIds: normalizeStrings(proposal.expectedObligationIds),
        executionBindings: [...proposal.executionBindings].sort(byId('obligationId')),
        evidenceEntryIds: normalizeStrings(proposal.evidenceEntryIds),
      };
      break;
    case 'semantic-merge':
    case 'semantic-split':
      normalized = {
        ...proposal,
        sourceClusterIds: normalizeStrings(proposal.sourceClusterIds),
        targetClusterIds: normalizeStrings(proposal.targetClusterIds),
        observationIds: normalizeStrings(proposal.observationIds),
        reasonCode: proposal.reasonCode.trim(),
      };
      break;
  }
  return hashCanonicalJson({ schemaVersion: 1, ...normalized });
}

export interface KnowledgeDispositionExecutionBindingV1 {
  readonly obligationId: string;
  readonly executionReceiptHash: string;
  readonly executionOutputHash: string;
  readonly denominatorHash: string;
  readonly disposition: FactQueryExecutionReceiptV1['disposition'];
  readonly terminalReceiptId: string;
}

export interface KnowledgeDispositionExecutionScopeV1 {
  readonly finalExpandedScheduleHash: string;
  readonly scheduledObligationIds: readonly string[];
  readonly terminalObligations: AnalysisFixpointReceiptV1['terminalObligations'];
  readonly scopeHash: string;
}

export interface KnowledgeDispositionReviewV1 {
  readonly schemaVersion: 1;
  readonly reviewKind: KnowledgeDispositionReviewKindV1;
  readonly currentAnalysisFixpointHash: string;
  readonly populationHash: string;
  readonly proposedDispositionHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly executionScope: KnowledgeDispositionExecutionScopeV1;
  readonly obligationIds: readonly string[];
  readonly executionReceiptHashes: readonly string[];
  readonly executionOutputHashes: readonly string[];
  readonly denominatorHashes: readonly string[];
  /**
   * 三个兼容数组不能表达逐条关系；binding rows 才是 review 授权所依据的不可交换 tuple。
   * authority 会同时核对 tuple 与兼容数组，防止交换 output/denominator 后重算 hash 自证。
   */
  readonly executionBindings: readonly KnowledgeDispositionExecutionBindingV1[];
  readonly producer: ProductionActorIdentityV1;
  readonly reviewer: ProductionActorIdentityV1;
  readonly calibrationReceiptHash: string;
  /**
   * Agent 真实 evaluator execution 的完整 authority 留在 companion registry；这里绑定其
   * canonical hash。旧 analyst review 不带此字段，以保持既有 V1 receipt hash 兼容。
   */
  readonly semanticExecutionResultHash?: string;
  readonly verdict: 'pass' | 'revise' | 'reject';
  readonly reasonCode: string;
  readonly reviewReceiptId: string;
  readonly receiptHash: string;
}

export interface InvestigatedEmptyDecisionV1 {
  readonly schemaVersion: 1;
  readonly sourceRevisionVectorHash: string;
  readonly finalExpandedScheduleHash: string;
  readonly currentAnalysisFixpointHash: string;
  readonly expectedObligationIds: readonly string[];
  readonly terminalExecutionReceiptHashes: readonly string[];
  readonly dispositionReviewReceiptId: string;
  readonly evidenceEntryIds: readonly string[];
  readonly verdict: 'pass' | 'unknown';
  readonly reasonCode: string;
  readonly decisionHash: string;
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
  readonly currentAnalysisFixpointHash: string;
  readonly zeroHypothesisReason: 'refuted' | 'insufficient-evidence' | 'unknown' | null;
  readonly zeroHypothesisReviewReceiptId: string | null;
  readonly receiptHash: string;
}

export interface CounterqueryExecutionV1 {
  readonly counterqueryId: string;
  readonly obligationId: string;
  readonly executionReceipt: FactQueryExecutionReceiptV1;
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
  readonly currentAnalysisFixpointHash: string;
  readonly dispositionReviewReceiptId: string;
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
  readonly terminalReceiptHash: string;
  readonly dispositionReview?: KnowledgeDispositionReviewV1;
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
    readonly dispositionReview: KnowledgeDispositionReviewV1;
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
  /**
   * Analyst 处置发生在最终 seal 之前；这个稳定坐标只覆盖 schedule/terminal/population/cluster，
   * 让 induction/falsification/review 能绑定“当前 fixpoint 上下文”而不与最终 receipt 自循环。
   */
  readonly analysisReviewContextHash: string;
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
  const valueHash = hashCanonicalJson(value);
  const identity =
    kind === 'direct'
      ? {
          kind,
          factFamilyId: input.factFamilyId,
          canonicalSubjectRef: input.canonicalSubjectRef,
          primaryScale: input.primaryScale,
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
          primaryScale: input.primaryScale,
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
    primaryScale: input.primaryScale,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    value,
    valueHash,
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
  validatePopulationRevision(input);
  const rows = normalizePopulationRows(input);
  const denominator = normalizePopulationDenominator(input, rows);
  const execution = validatePopulationExecutionReceipts(input, denominator);
  validatePopulationObservationLineage(rows, execution);
  validatePopulationDuplicateTargets(rows);
  validateNoPatternObservations(rows, denominator, execution);
  const conservation = createPopulationConservation(rows, denominator.expectedIds.length);
  const receiptAuthorityComplete = validatePopulationReceiptConservation(
    input,
    rows,
    denominator,
    execution
  );
  const completion =
    input.denominator.complete &&
    receiptAuthorityComplete &&
    !input.denominator.truncated &&
    input.denominator.continuation === null &&
    denominator.omittedObservationIds.length === 0 &&
    rows.errorObservations.length === 0
      ? ('complete' as const)
      : ('unknown' as const);
  const semantic = {
    schemaVersion: 1 as const,
    populationId: input.populationId,
    revision: input.revision,
    parentPopulationHash: input.parentPopulationHash,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    denominator: {
      ...input.denominator,
      expectedObservationIds: denominator.expectedIds,
      expectedObligationIds: denominator.expectedObligationIds,
      executionReceiptHashes: denominator.executionReceiptHashes,
      outputHashes: denominator.outputHashes,
      denominatorHashes: denominator.denominatorHashes,
      omittedObservationIds: denominator.omittedObservationIds,
    },
    ...rows,
    completion,
    conservation,
  };
  return freezeDeep({ ...semantic, populationHash: hashCanonicalJson(semantic) });
}

function validatePopulationRevision(input: ObservationPopulationInputV1): void {
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
}

function normalizePopulationRows(input: ObservationPopulationInputV1) {
  const observations = input.observations
    .map((observation) => ({
      ...observation,
      factIds: normalizeStrings(observation.factIds),
      obligationIds: normalizeStrings(observation.obligationIds),
      canonicalSubjectRefs: normalizeStrings(observation.canonicalSubjectRefs),
      parentSubjectRefs: normalizeStrings(observation.parentSubjectRefs),
      variantKeys: normalizeStrings(observation.variantKeys),
      outlierReasonCodes: normalizeStrings(observation.outlierReasonCodes),
      mechanismKey: observation.mechanismKey?.trim() || null,
    }))
    .sort(byId('observationId'));
  for (const observation of observations) {
    requireText(observation.observationId, 'POPULATION_OBSERVATION_INVALID');
    if (
      observation.factIds.length === 0 ||
      observation.obligationIds.length === 0 ||
      observation.canonicalSubjectRefs.length === 0
    ) {
      fail('POPULATION_OBSERVATION_UNGROUNDED');
    }
    if (typeof observation.negativeControl !== 'boolean') {
      fail('POPULATION_OBSERVATION_SEMANTICS_INVALID');
    }
  }
  const duplicateObservations = input.duplicateObservations
    .map((row) => normalizeObservationDispositionLineage(row))
    .sort(byId('observationId'));
  const excludedObservations = input.excludedObservations
    .map((row) => normalizeObservationDispositionLineage(row))
    .sort(byId('observationId'));
  const errorObservations = input.errorObservations
    .map((row) => normalizeObservationDispositionLineage(row))
    .sort(byId('observationId'));
  const inspectedNoPatternObservations = input.inspectedNoPatternObservations
    .map((row) => ({ ...row, parentSubjectRefs: normalizeStrings(row.parentSubjectRefs) }))
    .sort(byId('observationId'));
  return {
    observations,
    duplicateObservations,
    excludedObservations,
    errorObservations,
    inspectedNoPatternObservations,
  };
}

function normalizePopulationDenominator(
  input: ObservationPopulationInputV1,
  rows: ReturnType<typeof normalizePopulationRows>
) {
  const omittedObservationIds = normalizeStrings(input.denominator.omittedObservationIds);
  const actualIds = [
    ...rows.observations.map((row) => row.observationId),
    ...rows.duplicateObservations.map((row) => row.observationId),
    ...rows.excludedObservations.map((row) => row.observationId),
    ...rows.errorObservations.map((row) => row.observationId),
    ...rows.inspectedNoPatternObservations.map((row) => row.observationId),
    ...omittedObservationIds,
  ];
  if (new Set(actualIds).size !== actualIds.length) {
    fail('POPULATION_DISPOSITION_DUPLICATE');
  }
  const expectedIds = normalizeStrings(input.denominator.expectedObservationIds);
  const expectedObligationIds = normalizeStrings(input.denominator.expectedObligationIds);
  const executionReceiptHashes = normalizeSha256Set(
    input.denominator.executionReceiptHashes,
    'POPULATION_EXECUTION_RECEIPT_HASH_INVALID'
  );
  const outputHashes = normalizeSha256Set(
    input.denominator.outputHashes,
    'POPULATION_OUTPUT_HASH_INVALID'
  );
  const denominatorHashes = normalizeSha256Set(
    input.denominator.denominatorHashes,
    'POPULATION_DENOMINATOR_HASH_INVALID'
  );
  if (
    expectedIds.length === 0 ||
    expectedObligationIds.length === 0 ||
    executionReceiptHashes.length === 0 ||
    outputHashes.length === 0 ||
    denominatorHashes.length === 0
  ) {
    fail('POPULATION_DENOMINATOR_EMPTY');
  }
  if (JSON.stringify([...actualIds].sort()) !== JSON.stringify(expectedIds)) {
    fail('POPULATION_DENOMINATOR_MISMATCH');
  }
  if (
    typeof input.denominator.complete !== 'boolean' ||
    typeof input.denominator.truncated !== 'boolean' ||
    (input.denominator.continuation !== null && !input.denominator.continuation.trim())
  ) {
    fail('POPULATION_DENOMINATOR_STATE_INVALID');
  }
  return {
    expectedIds,
    expectedObligationIds,
    executionReceiptHashes,
    outputHashes,
    denominatorHashes,
    omittedObservationIds,
  };
}

function validatePopulationExecutionReceipts(
  input: ObservationPopulationInputV1,
  denominator: ReturnType<typeof normalizePopulationDenominator>
) {
  const executionReceipts = [...(input.executionReceipts ?? [])].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  for (const receipt of executionReceipts) {
    assertFactQueryExecutionReceiptV1(receipt);
  }
  if (
    new Set(executionReceipts.map((receipt) => receipt.obligationId)).size !==
    executionReceipts.length
  ) {
    fail('POPULATION_EXECUTION_RECEIPT_DUPLICATE');
  }
  if (
    executionReceipts.length > 0 &&
    (!sameStringSet(
      denominator.executionReceiptHashes,
      executionReceipts.map((receipt) => receipt.receiptHash)
    ) ||
      !sameStringSet(
        denominator.outputHashes,
        executionReceipts.map((receipt) => receipt.outputHash)
      ) ||
      !sameStringSet(
        denominator.denominatorHashes,
        executionReceipts.map((receipt) => receipt.denominatorHash)
      ))
  ) {
    fail('POPULATION_EXECUTION_RECEIPT_SET_MISMATCH');
  }
  const receiptsByObligationId = new Map(
    executionReceipts.map((receipt) => [receipt.obligationId, receipt] as const)
  );
  return { executionReceipts, receiptsByObligationId };
}

function validatePopulationObservationLineage(
  rows: ReturnType<typeof normalizePopulationRows>,
  execution: ReturnType<typeof validatePopulationExecutionReceipts>
): void {
  const factBearingRows = [
    ...rows.observations,
    ...rows.duplicateObservations,
    ...rows.excludedObservations,
    ...rows.errorObservations,
  ];
  for (const row of factBearingRows) {
    if (row.obligationIds.length === 0 || row.canonicalSubjectRefs.length === 0) {
      fail('POPULATION_OBSERVATION_LINEAGE_REQUIRED');
    }
    const enrolledReceipts = row.obligationIds
      .map((obligationId) => execution.receiptsByObligationId.get(obligationId))
      .filter((receipt): receipt is FactQueryExecutionReceiptV1 => Boolean(receipt));
    if (
      execution.executionReceipts.length > 0 &&
      (enrolledReceipts.length !== row.obligationIds.length ||
        row.factIds.some(
          (factId) => !enrolledReceipts.some((receipt) => receipt.emittedFactIds.includes(factId))
        ))
    ) {
      fail('POPULATION_OBSERVATION_EXECUTION_UNBOUND');
    }
  }
}

function validatePopulationDuplicateTargets(
  rows: ReturnType<typeof normalizePopulationRows>
): void {
  for (const duplicate of rows.duplicateObservations) {
    if (!rows.observations.some((row) => row.observationId === duplicate.duplicateOf)) {
      fail('POPULATION_DUPLICATE_TARGET_MISSING');
    }
  }
}

function validateNoPatternObservations(
  rows: ReturnType<typeof normalizePopulationRows>,
  denominator: ReturnType<typeof normalizePopulationDenominator>,
  execution: ReturnType<typeof validatePopulationExecutionReceipts>
): void {
  for (const row of rows.inspectedNoPatternObservations) {
    requireText(row.obligationId, 'POPULATION_NO_PATTERN_OBLIGATION_REQUIRED');
    requireText(row.canonicalSubjectRef, 'POPULATION_NO_PATTERN_SUBJECT_REQUIRED');
    for (const value of [row.executionReceiptHash, row.outputHash, row.denominatorHash]) {
      if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
        fail('POPULATION_NO_PATTERN_RECEIPT_INVALID');
      }
    }
    if (
      !denominator.expectedObligationIds.includes(row.obligationId) ||
      !denominator.executionReceiptHashes.includes(row.executionReceiptHash) ||
      !denominator.outputHashes.includes(row.outputHash) ||
      !denominator.denominatorHashes.includes(row.denominatorHash)
    ) {
      fail('POPULATION_NO_PATTERN_RECEIPT_UNENROLLED');
    }
    const receipt = execution.receiptsByObligationId.get(row.obligationId);
    if (
      execution.executionReceipts.length > 0 &&
      (!receipt ||
        receipt.disposition !== 'inspected-no-pattern' ||
        receipt.canonicalSubjectRef !== row.canonicalSubjectRef ||
        receipt.receiptHash !== row.executionReceiptHash ||
        receipt.outputHash !== row.outputHash ||
        receipt.denominatorHash !== row.denominatorHash)
    ) {
      fail('POPULATION_NO_PATTERN_RECEIPT_MISMATCH');
    }
  }
}

function createPopulationConservation(
  rows: ReturnType<typeof normalizePopulationRows>,
  raw: number
): ObservationPopulationV1['conservation'] {
  const conservation = {
    raw,
    accepted: rows.observations.length,
    duplicate: rows.duplicateObservations.length,
    excluded: rows.excludedObservations.length,
    error: rows.errorObservations.length,
    inspectedNoPattern: rows.inspectedNoPatternObservations.length,
    omitted:
      raw -
      rows.observations.length -
      rows.duplicateObservations.length -
      rows.excludedObservations.length -
      rows.errorObservations.length -
      rows.inspectedNoPatternObservations.length,
  };
  if (
    conservation.raw !==
    conservation.accepted +
      conservation.duplicate +
      conservation.excluded +
      conservation.error +
      conservation.inspectedNoPattern +
      conservation.omitted
  ) {
    fail('POPULATION_CONSERVATION_FAILED');
  }
  return conservation;
}

function validatePopulationReceiptConservation(
  input: ObservationPopulationInputV1,
  rows: ReturnType<typeof normalizePopulationRows>,
  denominator: ReturnType<typeof normalizePopulationDenominator>,
  execution: ReturnType<typeof validatePopulationExecutionReceipts>
): boolean {
  const { executionReceipts } = execution;
  const receiptAuthorityComplete =
    executionReceipts.length > 0 &&
    sameStringSet(
      denominator.expectedObligationIds,
      executionReceipts.map((receipt) => receipt.obligationId)
    ) &&
    executionReceipts.every(
      (receipt) =>
        receipt.sourceRevisionVectorHash === input.sourceRevisionVectorHash &&
        (receipt.disposition === 'matched' || receipt.disposition === 'inspected-no-pattern') &&
        receipt.expectedFileCount > 0 &&
        receipt.inspectedFileCount === receipt.expectedFileCount &&
        !receipt.truncated &&
        receipt.continuation === null
    );
  if (!receiptAuthorityComplete) {
    return false;
  }
  const factBearingRows = [
    ...rows.observations,
    ...rows.duplicateObservations,
    ...rows.excludedObservations,
    ...rows.errorObservations,
  ];
  const accountedFactIds = normalizeStrings(factBearingRows.flatMap((row) => row.factIds));
  const emittedFactIds = normalizeStrings(
    executionReceipts.flatMap((receipt) => receipt.emittedFactIds)
  );
  if (!sameStringSet(accountedFactIds, emittedFactIds)) {
    fail('POPULATION_EXECUTION_FACT_CONSERVATION_FAILED');
  }
  const expectedNoPatternObligations = executionReceipts
    .filter((receipt) => receipt.disposition === 'inspected-no-pattern')
    .map((receipt) => receipt.obligationId);
  const actualNoPatternObligations = rows.inspectedNoPatternObservations.map(
    (row) => row.obligationId
  );
  if (!sameStringSet(expectedNoPatternObligations, actualNoPatternObligations)) {
    fail('POPULATION_NO_PATTERN_CONSERVATION_FAILED');
  }
  return true;
}

export function canonicalizeKnowledgeClustersV1(
  population: ObservationPopulationV1,
  input: KnowledgeClusterCanonicalizationInputV1
): KnowledgeClusterSetV1 {
  const observations = new Map(population.observations.map((row) => [row.observationId, row]));
  const clusters = input.clusters
    .map((candidate) => canonicalizeKnowledgeCluster(population, candidate, observations))
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
  const dispositions = [...observations.keys()]
    .sort()
    .map((observationId) =>
      createKnowledgeClusterDisposition(
        population.populationHash,
        observationId,
        clusters,
        nonClustered.get(observationId)
      )
    );
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
  const clusterSet = { ...semantic, clusterSetHash: '' };
  return freezeDeep({ ...semantic, clusterSetHash: hashKnowledgeClusterSetV1(clusterSet) });
}

function canonicalizeKnowledgeCluster(
  population: ObservationPopulationV1,
  candidate: KnowledgeClusterInputV1,
  observations: ReadonlyMap<string, ObservationV1>
): KnowledgeClusterV1 {
  const observationIds = normalizeStrings(candidate.observationIds);
  if (observationIds.length === 0) {
    fail('CLUSTER_EMPTY');
  }
  requireText(candidate.mechanismKey, 'CLUSTER_MECHANISM_REQUIRED');
  const mechanism = normalizeClusterMechanism(candidate.mechanism);
  const members = observationIds.map((observationId) => {
    const observation = observations.get(observationId);
    if (!observation) {
      fail('CLUSTER_OBSERVATION_UNKNOWN');
    }
    return observation;
  });
  const memberFactIds = normalizeStrings(members.flatMap((member) => member.factIds));
  const mechanismEvidenceFactIds = normalizeStrings(candidate.mechanismEvidenceFactIds);
  if (
    mechanismEvidenceFactIds.length === 0 ||
    !sameStringSet(memberFactIds, mechanismEvidenceFactIds)
  ) {
    fail('CLUSTER_MEMBER_EVIDENCE_INCOMPLETE');
  }
  const memberLineage = members
    .map((member) => ({
      observationId: member.observationId,
      factIds: [...member.factIds],
      obligationIds: [...member.obligationIds],
      canonicalSubjectRefs: [...member.canonicalSubjectRefs],
      parentSubjectRefs: [...member.parentSubjectRefs],
      variantKeys: [...member.variantKeys],
      outlierReasonCodes: [...member.outlierReasonCodes],
      negativeControl: member.negativeControl,
    }))
    .sort(byId('observationId'));
  const semantic = {
    populationHash: population.populationHash,
    mechanismKey: candidate.mechanismKey.trim(),
    mechanism,
    observationIds,
    mechanismEvidenceFactIds,
    anatomyLensIds: normalizeStrings(candidate.anatomyLensIds),
    memberFactIds,
    canonicalSubjectRefs: normalizeStrings(
      members.flatMap((member) => member.canonicalSubjectRefs)
    ),
    parentSubjectRefs: normalizeStrings(members.flatMap((member) => member.parentSubjectRefs)),
    variantKeys: normalizeStrings(members.flatMap((member) => member.variantKeys)),
    outlierObservationIds: members
      .filter((member) => member.outlierReasonCodes.length > 0)
      .map((member) => member.observationId)
      .sort(),
    negativeControlObservationIds: members
      .filter((member) => member.negativeControl)
      .map((member) => member.observationId)
      .sort(),
    memberLineage,
  };
  return { clusterId: `cluster:${hashCanonicalJson(semantic).slice(7)}`, ...semantic };
}

function normalizeClusterMechanism(input: unknown): ReturnType<typeof toProjectFactsJson> {
  const mechanism = toProjectFactsJson(input);
  const emptyObject =
    typeof mechanism === 'object' &&
    mechanism !== null &&
    !Array.isArray(mechanism) &&
    Object.keys(mechanism).length === 0;
  if (
    mechanism === null ||
    (typeof mechanism === 'string' && mechanism.trim().length === 0) ||
    (Array.isArray(mechanism) && mechanism.length === 0) ||
    emptyObject
  ) {
    fail('CLUSTER_MECHANISM_EVIDENCE_REQUIRED');
  }
  return mechanism;
}

function createKnowledgeClusterDisposition(
  populationHash: string,
  observationId: string,
  clusters: readonly KnowledgeClusterV1[],
  nonClusteredDisposition:
    | KnowledgeClusterCanonicalizationInputV1['nonClusteredDispositions'][number]
    | undefined
): KnowledgeClusterSetV1['dispositions'][number] {
  const clusterIds = clusters
    .filter((cluster) => cluster.observationIds.includes(observationId))
    .map((cluster) => cluster.clusterId);
  if (clusterIds.length > 0) {
    if (nonClusteredDisposition) {
      fail('CLUSTER_DISPOSITION_DUPLICATE');
    }
    return {
      observationId,
      status: 'clustered',
      clusterIds,
      reasonCode: null,
      reviewerReceiptId: null,
      owner: null,
      resumePoint: null,
    };
  }
  if (!nonClusteredDisposition) {
    fail('CLUSTER_DISPOSITION_MISSING');
  }
  validateNonClusteredDisposition(populationHash, nonClusteredDisposition);
  return {
    observationId,
    status: nonClusteredDisposition.status,
    clusterIds,
    reasonCode: nonClusteredDisposition.reasonCode,
    reviewerReceiptId:
      nonClusteredDisposition.dispositionReview?.reviewReceiptId ??
      nonClusteredDisposition.reviewerReceiptId ??
      null,
    owner: nonClusteredDisposition.owner ?? null,
    resumePoint: nonClusteredDisposition.resumePoint ?? null,
  };
}

function validateNonClusteredDisposition(
  populationHash: string,
  disposition: KnowledgeClusterCanonicalizationInputV1['nonClusteredDispositions'][number]
): void {
  if (disposition.status === 'unresolved') {
    if (
      !disposition.reasonCode.trim() ||
      !disposition.owner?.trim() ||
      !disposition.resumePoint?.trim()
    ) {
      fail('CLUSTER_UNRESOLVED_OWNER_REQUIRED');
    }
    return;
  }
  const review = disposition.dispositionReview;
  if (!disposition.reasonCode.trim() || !review) {
    fail('CLUSTER_DISCARD_REVIEW_REQUIRED');
  }
  assertKnowledgeDispositionReviewIntegrity(review);
  if (
    review.reviewKind !== 'cluster-discard' ||
    review.verdict !== 'pass' ||
    review.populationHash !== populationHash ||
    review.proposedDispositionHash !==
      hashKnowledgeDispositionProposalV1({
        reviewKind: 'cluster-discard',
        populationHash,
        observationId: disposition.observationId,
        status: 'discarded',
        reasonCode: disposition.reasonCode.trim(),
      })
  ) {
    fail('CLUSTER_DISCARD_REVIEW_INVALID');
  }
}

interface CreateKnowledgeDispositionReviewInputV1 {
  readonly reviewKind: KnowledgeDispositionReviewKindV1;
  readonly currentAnalysisFixpointHash: string;
  readonly populationHash: string;
  readonly proposedDispositionHash: string;
  readonly executionReceipts: readonly FactQueryExecutionReceiptV1[];
  readonly finalExpandedSchedule: FinalExpandedMiningScheduleReceiptV1;
  readonly terminalObligations: AnalysisFixpointReceiptV1['terminalObligations'];
  readonly producer: ProductionActorIdentityV1;
  readonly reviewer: ProductionActorIdentityV1;
  readonly calibrationReceiptHash: string;
  readonly semanticExecutionResultHash?: string;
  readonly verdict: KnowledgeDispositionReviewV1['verdict'];
  readonly reasonCode: string;
}

export function createKnowledgeDispositionReviewV1(
  input: CreateKnowledgeDispositionReviewInputV1
): KnowledgeDispositionReviewV1 {
  validateKnowledgeDispositionReviewInput(input);
  assertFinalExpandedScheduleReceiptV1(input.finalExpandedSchedule);
  const receipts = [...input.executionReceipts].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  if (new Set(receipts.map((receipt) => receipt.obligationId)).size !== receipts.length) {
    fail('KNOWLEDGE_DISPOSITION_EXECUTION_DUPLICATE');
  }
  for (const receipt of receipts) {
    if (input.verdict === 'pass') {
      assertReviewAuthorizingFactExecutionV1(receipt);
    } else {
      assertFactQueryExecutionReceiptV1(receipt);
    }
  }
  const sourceRevisionVectorHashes = normalizeStrings(
    receipts.map((receipt) => receipt.sourceRevisionVectorHash)
  );
  if (sourceRevisionVectorHashes.length !== 1) {
    fail('KNOWLEDGE_DISPOSITION_SOURCE_REVISION_MISMATCH');
  }
  const terminalObligations = [...input.terminalObligations].sort(byId('obligationId'));
  const scheduledObligationIds = normalizeStrings(input.finalExpandedSchedule.obligationIds);
  if (
    new Set(terminalObligations.map((obligation) => obligation.obligationId)).size !==
      terminalObligations.length ||
    !sameOrderedStrings(
      terminalObligations.map((obligation) => obligation.obligationId),
      scheduledObligationIds
    ) ||
    receipts.some((receipt) => {
      const terminal = terminalObligations.find(
        (obligation) => obligation.obligationId === receipt.obligationId
      );
      return (
        !terminal ||
        terminal.terminalReceiptId !== receipt.terminalReceiptId ||
        terminal.disposition !== receipt.disposition
      );
    })
  ) {
    fail('KNOWLEDGE_DISPOSITION_EXECUTION_SCOPE_MISMATCH');
  }
  const executionScopeSemantic = {
    finalExpandedScheduleHash: input.finalExpandedSchedule.finalExpandedScheduleHash,
    scheduledObligationIds,
    terminalObligations,
  };
  const executionScope = {
    ...executionScopeSemantic,
    scopeHash: hashCanonicalJson(executionScopeSemantic),
  };
  const semantic = {
    schemaVersion: 1 as const,
    reviewKind: input.reviewKind,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    populationHash: input.populationHash,
    proposedDispositionHash: input.proposedDispositionHash,
    sourceRevisionVectorHash: sourceRevisionVectorHashes[0]!,
    executionScope,
    obligationIds: receipts.map((receipt) => receipt.obligationId),
    executionReceiptHashes: receipts.map((receipt) => receipt.receiptHash),
    executionOutputHashes: receipts.map((receipt) => receipt.outputHash),
    denominatorHashes: receipts.map((receipt) => receipt.denominatorHash),
    executionBindings: receipts.map((receipt) => ({
      obligationId: receipt.obligationId,
      executionReceiptHash: receipt.receiptHash,
      executionOutputHash: receipt.outputHash,
      denominatorHash: receipt.denominatorHash,
      disposition: receipt.disposition,
      terminalReceiptId: receipt.terminalReceiptId,
    })),
    producer: input.producer,
    reviewer: input.reviewer,
    calibrationReceiptHash: input.calibrationReceiptHash,
    ...(input.semanticExecutionResultHash
      ? { semanticExecutionResultHash: input.semanticExecutionResultHash }
      : {}),
    verdict: input.verdict,
    reasonCode: input.reasonCode.trim(),
  };
  const receiptHash = hashCanonicalJson(semantic);
  return freezeDeep({
    ...semantic,
    reviewReceiptId: `knowledge-review:${receiptHash.slice(7, 31)}`,
    receiptHash,
  });
}

function validateKnowledgeDispositionReviewInput(
  input: CreateKnowledgeDispositionReviewInputV1
): void {
  if (!KNOWLEDGE_DISPOSITION_REVIEW_KINDS.has(input.reviewKind)) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_KIND_INVALID');
  }
  for (const [value, code] of [
    [input.currentAnalysisFixpointHash, 'KNOWLEDGE_DISPOSITION_FIXPOINT_INVALID'],
    [input.populationHash, 'KNOWLEDGE_DISPOSITION_POPULATION_INVALID'],
    [input.proposedDispositionHash, 'KNOWLEDGE_DISPOSITION_PROPOSAL_INVALID'],
    [input.calibrationReceiptHash, 'KNOWLEDGE_DISPOSITION_CALIBRATION_INVALID'],
  ] as const) {
    requireSha256(value, code);
  }
  if (input.semanticExecutionResultHash !== undefined) {
    if (input.reviewKind !== 'producer-non-draft' && input.reviewKind !== 'investigated-empty') {
      fail('KNOWLEDGE_DISPOSITION_SEMANTIC_EXECUTION_UNEXPECTED');
    }
    requireSha256(
      input.semanticExecutionResultHash,
      'KNOWLEDGE_DISPOSITION_SEMANTIC_EXECUTION_INVALID'
    );
  }
  requireText(input.reasonCode, 'KNOWLEDGE_DISPOSITION_REASON_REQUIRED');
  if (!KNOWLEDGE_DISPOSITION_REVIEW_VERDICTS.has(input.verdict)) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_VERDICT_INVALID');
  }
  assertProductionActorIdentityV1(input.producer);
  assertProductionActorIdentityV1(input.reviewer);
  const hasSemanticExecution = input.semanticExecutionResultHash !== undefined;
  if (
    (hasSemanticExecution
      ? input.producer.runId === input.reviewer.runId
      : input.producer.runId !== input.reviewer.runId) ||
    input.producer.actorHash === input.reviewer.actorHash ||
    input.producer.invocationId === input.reviewer.invocationId ||
    input.producer.outputHash === input.reviewer.outputHash
  ) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  }
  if (input.executionReceipts.length === 0) {
    fail('KNOWLEDGE_DISPOSITION_EXECUTION_REQUIRED');
  }
}

/**
 * investigated-empty 是完整执行分母上的独立裁决，不是 “模型没有输出” 的同义词。
 * 不完整输入仍生成可记录的 unknown receipt；伪造或被篡改的执行/review receipt 直接拒绝。
 */
export function createInvestigatedEmptyDecisionV1(input: {
  readonly sourceRevisionVectorHash: string;
  readonly finalExpandedScheduleHash: string;
  readonly currentAnalysisFixpointHash: string;
  readonly expectedObligationIds: readonly string[];
  readonly executionReceipts: readonly FactQueryExecutionReceiptV1[];
  readonly dispositionReview: KnowledgeDispositionReviewV1;
  readonly evidenceEntryIds: readonly string[];
}): InvestigatedEmptyDecisionV1 {
  requireSha256(input.sourceRevisionVectorHash, 'INVESTIGATED_EMPTY_SOURCE_REVISION_INVALID');
  requireSha256(input.finalExpandedScheduleHash, 'INVESTIGATED_EMPTY_SCHEDULE_INVALID');
  requireSha256(input.currentAnalysisFixpointHash, 'INVESTIGATED_EMPTY_FIXPOINT_INVALID');
  assertKnowledgeDispositionReviewIntegrity(input.dispositionReview);
  const expectedObligationIds = normalizeStrings(input.expectedObligationIds);
  const evidenceEntryIds = normalizeStrings(input.evidenceEntryIds);
  const receipts = [...input.executionReceipts].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  for (const receipt of receipts) {
    assertReviewAuthorizingFactExecutionV1(receipt);
  }
  const reasonCode = resolveInvestigatedEmptyReason(
    input,
    expectedObligationIds,
    evidenceEntryIds,
    receipts
  );
  const semantic = {
    schemaVersion: 1 as const,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    finalExpandedScheduleHash: input.finalExpandedScheduleHash,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    expectedObligationIds,
    terminalExecutionReceiptHashes: receipts.map((receipt) => receipt.receiptHash),
    dispositionReviewReceiptId: input.dispositionReview.reviewReceiptId,
    evidenceEntryIds,
    verdict: (reasonCode === 'COMPLETE_DENOMINATOR_INVESTIGATED_EMPTY'
      ? 'pass'
      : 'unknown') as InvestigatedEmptyDecisionV1['verdict'],
    reasonCode,
  };
  return freezeDeep({ ...semantic, decisionHash: hashCanonicalJson(semantic) });
}

function resolveInvestigatedEmptyReason(
  input: Parameters<typeof createInvestigatedEmptyDecisionV1>[0],
  expectedObligationIds: readonly string[],
  evidenceEntryIds: readonly string[],
  receipts: readonly FactQueryExecutionReceiptV1[]
): string {
  if (expectedObligationIds.length === 0) {
    return 'EMPTY_DENOMINATOR_REQUIRED';
  }
  if (
    JSON.stringify(expectedObligationIds) !==
    JSON.stringify(receipts.map((receipt) => receipt.obligationId))
  ) {
    return 'EMPTY_DENOMINATOR_INCOMPLETE';
  }
  if (receipts.some((receipt) => investigatedEmptyExecutionInvalid(receipt, input))) {
    return 'EMPTY_EXECUTION_NONTERMINAL';
  }
  if (investigatedEmptyReviewInvalid(input, expectedObligationIds, evidenceEntryIds, receipts)) {
    return 'EMPTY_INDEPENDENT_REVIEW_INVALID';
  }
  return evidenceEntryIds.length === 0
    ? 'EMPTY_EVIDENCE_REQUIRED'
    : 'COMPLETE_DENOMINATOR_INVESTIGATED_EMPTY';
}

function investigatedEmptyExecutionInvalid(
  receipt: FactQueryExecutionReceiptV1,
  input: Parameters<typeof createInvestigatedEmptyDecisionV1>[0]
): boolean {
  return (
    receipt.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    receipt.disposition !== 'inspected-no-pattern' ||
    receipt.expectedFileCount === 0 ||
    receipt.inspectedFileCount !== receipt.expectedFileCount ||
    receipt.emittedFactIds.length > 0 ||
    receipt.truncated ||
    receipt.continuation !== null
  );
}

function investigatedEmptyReviewInvalid(
  input: Parameters<typeof createInvestigatedEmptyDecisionV1>[0],
  expectedObligationIds: readonly string[],
  evidenceEntryIds: readonly string[],
  receipts: readonly FactQueryExecutionReceiptV1[]
): boolean {
  const review = input.dispositionReview;
  return (
    review.reviewKind !== 'investigated-empty' ||
    review.verdict !== 'pass' ||
    review.currentAnalysisFixpointHash !== input.currentAnalysisFixpointHash ||
    review.sourceRevisionVectorHash !== input.sourceRevisionVectorHash ||
    review.executionScope.finalExpandedScheduleHash !== input.finalExpandedScheduleHash ||
    JSON.stringify(review.executionScope.scheduledObligationIds) !==
      JSON.stringify(expectedObligationIds) ||
    JSON.stringify(review.obligationIds) !== JSON.stringify(expectedObligationIds) ||
    JSON.stringify(review.executionReceiptHashes) !==
      JSON.stringify(receipts.map((receipt) => receipt.receiptHash)) ||
    review.proposedDispositionHash !==
      hashKnowledgeDispositionProposalV1({
        reviewKind: 'investigated-empty',
        populationHash: review.populationHash,
        sourceRevisionVectorHash: input.sourceRevisionVectorHash,
        finalExpandedScheduleHash: input.finalExpandedScheduleHash,
        currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
        expectedObligationIds,
        executionBindings: receipts.map((receipt) => ({
          obligationId: receipt.obligationId,
          executionReceiptHash: receipt.receiptHash,
          executionOutputHash: receipt.outputHash,
          denominatorHash: receipt.denominatorHash,
          disposition: receipt.disposition,
          terminalReceiptId: receipt.terminalReceiptId,
        })),
        evidenceEntryIds,
      })
  );
}

export function createInductionReceiptV1(input: {
  readonly populationHash: string;
  readonly clusterHash: string;
  readonly clusterId: string;
  readonly observationIds: readonly string[];
  readonly mode: 'recurring' | 'bounded-singleton';
  readonly hypotheses: readonly HypothesisV1[];
  readonly currentAnalysisFixpointHash: string;
  readonly zeroHypothesisReason?: InductionReceiptV1['zeroHypothesisReason'];
  readonly zeroHypothesisDispositionReview?: KnowledgeDispositionReviewV1;
  /** @deprecated A string cannot independently authorize a zero hypothesis. */
  readonly zeroHypothesisReviewReceiptId?: string;
}): InductionReceiptV1 {
  requireSha256(input.currentAnalysisFixpointHash, 'INDUCTION_FIXPOINT_INVALID');
  const observationIds = normalizeStrings(input.observationIds);
  validateInductionObservationMode(input.mode, observationIds);
  const hypotheses = normalizeInductionHypotheses(input.hypotheses);
  const zeroHypothesisReason = input.zeroHypothesisReason ?? null;
  const zeroReview = input.zeroHypothesisDispositionReview;
  if (zeroReview) {
    assertKnowledgeDispositionReviewIntegrity(zeroReview);
  }
  const zeroHypothesisReviewReceiptId = zeroReview?.reviewReceiptId ?? null;
  validateZeroInductionDisposition(
    input,
    hypotheses,
    zeroHypothesisReason,
    zeroReview,
    zeroHypothesisReviewReceiptId
  );
  const semantic = {
    schemaVersion: 1 as const,
    populationHash: input.populationHash,
    clusterHash: input.clusterHash,
    clusterId: input.clusterId,
    observationIds,
    mode: input.mode,
    hypotheses,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    zeroHypothesisReason,
    zeroHypothesisReviewReceiptId,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

function validateInductionObservationMode(
  mode: InductionReceiptV1['mode'],
  observationIds: readonly string[]
): void {
  if (observationIds.length === 0) {
    fail('INDUCTION_OBSERVATIONS_REQUIRED');
  }
  if (mode === 'recurring' && observationIds.length < 2) {
    fail('INDUCTION_RECURRING_DENOMINATOR_INSUFFICIENT');
  }
  if (mode === 'bounded-singleton' && observationIds.length !== 1) {
    fail('INDUCTION_SINGLETON_DENOMINATOR_INVALID');
  }
}

function normalizeInductionHypotheses(hypotheses: readonly HypothesisV1[]): HypothesisV1[] {
  const normalized = hypotheses
    .map((hypothesis) => ({
      ...hypothesis,
      premiseFactIds: normalizeStrings(hypothesis.premiseFactIds),
    }))
    .sort(byId('hypothesisId'));
  if (new Set(normalized.map((row) => row.hypothesisId)).size !== normalized.length) {
    fail('INDUCTION_HYPOTHESIS_DUPLICATE');
  }
  if (normalized.some((row) => !row.statement || row.premiseFactIds.length === 0)) {
    fail('INDUCTION_HYPOTHESIS_UNGROUNDED');
  }
  return normalized;
}

function validateZeroInductionDisposition(
  input: Parameters<typeof createInductionReceiptV1>[0],
  hypotheses: readonly HypothesisV1[],
  zeroReason: InductionReceiptV1['zeroHypothesisReason'],
  zeroReview: KnowledgeDispositionReviewV1 | undefined,
  zeroReviewReceiptId: string | null
): void {
  if (zeroReason !== null && !ZERO_HYPOTHESIS_REASONS.has(zeroReason)) {
    fail('INDUCTION_ZERO_REASON_INVALID');
  }
  if (hypotheses.length === 0) {
    if (
      !zeroReason ||
      !zeroReview ||
      zeroReview.reviewKind !== 'zero-hypothesis' ||
      zeroReview.verdict !== 'pass' ||
      zeroReview.currentAnalysisFixpointHash !== input.currentAnalysisFixpointHash ||
      zeroReview.populationHash !== input.populationHash ||
      zeroReview.proposedDispositionHash !==
        hashKnowledgeDispositionProposalV1({
          reviewKind: 'zero-hypothesis',
          populationHash: input.populationHash,
          clusterHash: input.clusterHash,
          clusterId: input.clusterId,
          observationIds: input.observationIds,
          mode: input.mode,
          zeroHypothesisReason: zeroReason,
        })
    ) {
      fail('INDUCTION_ZERO_REASON_REQUIRED');
    }
    return;
  }
  if (zeroReason || zeroReview || input.zeroHypothesisReviewReceiptId || zeroReviewReceiptId) {
    fail('INDUCTION_ZERO_REASON_CONFLICT');
  }
}

export function createFalsificationReceiptV1(input: {
  readonly hypothesisId: string;
  readonly enrolledCounterqueryIds: readonly string[];
  readonly executions: readonly CounterqueryExecutionV1[];
  readonly counterqueryApplicability: FalsificationReceiptV1['counterqueryApplicability'];
  readonly currentAnalysisFixpointHash: string;
  readonly dispositionReview: KnowledgeDispositionReviewV1;
}): FalsificationReceiptV1 {
  requireText(input.hypothesisId, 'FALSIFICATION_HYPOTHESIS_REQUIRED');
  requireSha256(input.currentAnalysisFixpointHash, 'FALSIFICATION_FIXPOINT_INVALID');
  validateFalsificationReview(input);
  const enrolledCounterqueryIds = normalizeStrings(input.enrolledCounterqueryIds);
  const executions = normalizeFalsificationExecutions(input.executions, enrolledCounterqueryIds);
  const applicability = input.counterqueryApplicability;
  validateFalsificationApplicability(applicability);
  validateFalsificationProposal(input, enrolledCounterqueryIds, executions);
  if (applicability.status === 'not-required') {
    return createNotRequiredFalsificationReceipt(input, enrolledCounterqueryIds, executions);
  }
  if (enrolledCounterqueryIds.length === 0) {
    fail('FALSIFICATION_COUNTERQUERY_REQUIRED');
  }
  validateFalsificationExecutionReview(input, executions, enrolledCounterqueryIds);
  const verdict = decideFalsificationVerdict(executions, enrolledCounterqueryIds);
  const semantic = {
    schemaVersion: 1 as const,
    hypothesisId: input.hypothesisId,
    enrolledCounterqueryIds,
    executions,
    counterqueryApplicability: {
      ...applicability,
      reviewerReceiptId: input.dispositionReview.reviewReceiptId,
    },
    verdict,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    dispositionReviewReceiptId: input.dispositionReview.reviewReceiptId,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

function validateFalsificationProposal(
  input: Parameters<typeof createFalsificationReceiptV1>[0],
  enrolledCounterqueryIds: readonly string[],
  executions: readonly CounterqueryExecutionV1[]
): void {
  if (
    input.dispositionReview.proposedDispositionHash !==
    hashKnowledgeDispositionProposalV1({
      reviewKind: 'falsification',
      populationHash: input.dispositionReview.populationHash,
      hypothesisId: input.hypothesisId,
      enrolledCounterqueryIds,
      executions: executions.map((execution) => ({
        counterqueryId: execution.counterqueryId,
        obligationId: execution.obligationId,
        executionReceiptHash: execution.executionReceipt.receiptHash,
        executionOutputHash: execution.executionReceipt.outputHash,
        denominatorHash: execution.executionReceipt.denominatorHash,
        counterexampleFactIds: execution.counterexampleFactIds,
      })),
      counterqueryApplicability: {
        status: input.counterqueryApplicability.status,
        reasonCode: input.counterqueryApplicability.reasonCode,
      },
    })
  ) {
    fail('FALSIFICATION_REVIEW_DISPOSITION_MISMATCH');
  }
}

function validateFalsificationReview(
  input: Parameters<typeof createFalsificationReceiptV1>[0]
): void {
  assertKnowledgeDispositionReviewIntegrity(input.dispositionReview);
  if (
    input.dispositionReview.reviewKind !== 'falsification' ||
    input.dispositionReview.verdict !== 'pass' ||
    input.dispositionReview.currentAnalysisFixpointHash !== input.currentAnalysisFixpointHash
  ) {
    fail('FALSIFICATION_REVIEW_INVALID');
  }
}

function normalizeFalsificationExecutions(
  input: readonly CounterqueryExecutionV1[],
  enrolledCounterqueryIds: readonly string[]
): CounterqueryExecutionV1[] {
  const enrolled = new Set(enrolledCounterqueryIds);
  const executions = input
    .map((execution) => ({
      ...execution,
      counterexampleFactIds: normalizeStrings(execution.counterexampleFactIds),
    }))
    .sort(byId('obligationId'));
  if (new Set(executions.map((row) => row.counterqueryId)).size !== executions.length) {
    fail('FALSIFICATION_COUNTERQUERY_DUPLICATE');
  }
  if (
    executions.some(
      (row) =>
        row.counterqueryId !== row.obligationId ||
        !enrolled.has(row.obligationId) ||
        row.executionReceipt.obligationId !== row.obligationId
    )
  ) {
    fail('FALSIFICATION_COUNTERQUERY_UNENROLLED');
  }
  for (const execution of executions) {
    assertFactQueryExecutionReceiptV1(execution.executionReceipt);
    if (
      execution.counterexampleFactIds.some(
        (factId) => !execution.executionReceipt.emittedFactIds.includes(factId)
      )
    ) {
      fail('FALSIFICATION_COUNTEREXAMPLE_FACT_UNBOUND');
    }
  }
  return executions;
}

function validateFalsificationApplicability(
  applicability: FalsificationReceiptV1['counterqueryApplicability']
): void {
  if (
    !COUNTERQUERY_APPLICABILITY_STATUSES.has(applicability.status) ||
    !applicability.reasonCode?.trim()
  ) {
    fail('FALSIFICATION_APPLICABILITY_INVALID');
  }
}

function createNotRequiredFalsificationReceipt(
  input: Parameters<typeof createFalsificationReceiptV1>[0],
  enrolledCounterqueryIds: readonly string[],
  executions: readonly CounterqueryExecutionV1[]
): FalsificationReceiptV1 {
  if (
    enrolledCounterqueryIds.length !== 0 ||
    executions.length !== 0 ||
    input.counterqueryApplicability.reviewerReceiptId !== input.dispositionReview.reviewReceiptId
  ) {
    fail('FALSIFICATION_NOT_REQUIRED_REVIEW_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    hypothesisId: input.hypothesisId,
    enrolledCounterqueryIds,
    executions,
    counterqueryApplicability: { ...input.counterqueryApplicability },
    verdict: 'not-required' as const,
    currentAnalysisFixpointHash: input.currentAnalysisFixpointHash,
    dispositionReviewReceiptId: input.dispositionReview.reviewReceiptId,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

function validateFalsificationExecutionReview(
  input: Parameters<typeof createFalsificationReceiptV1>[0],
  executions: readonly CounterqueryExecutionV1[],
  enrolledCounterqueryIds: readonly string[]
): void {
  const enrolled = new Set(enrolledCounterqueryIds);
  if (
    input.dispositionReview.obligationIds.some((id) => !enrolled.has(id)) ||
    executions.some(
      (row) =>
        !input.dispositionReview.executionReceiptHashes.includes(
          row.executionReceipt.receiptHash
        ) ||
        !input.dispositionReview.executionOutputHashes.includes(row.executionReceipt.outputHash)
    )
  ) {
    fail('FALSIFICATION_REVIEW_EXECUTION_MISMATCH');
  }
}

function decideFalsificationVerdict(
  executions: readonly CounterqueryExecutionV1[],
  enrolledCounterqueryIds: readonly string[]
): FalsificationReceiptV1['verdict'] {
  const executed = new Set(executions.map((row) => row.counterqueryId));
  const incomplete =
    enrolledCounterqueryIds.some((id) => !executed.has(id)) ||
    executions.some((row) => !isCompleteCounterqueryExecution(row));
  if (incomplete) {
    return 'unknown';
  }
  return executions.some((row) => row.counterexampleFactIds.length > 0) ? 'refuted' : 'survived';
}

function isCompleteCounterqueryExecution(row: CounterqueryExecutionV1): boolean {
  return (
    row.executionReceipt.disposition !== 'failed' &&
    row.executionReceipt.disposition !== 'unknown' &&
    row.executionReceipt.expectedFileCount > 0 &&
    row.executionReceipt.inspectedFileCount === row.executionReceipt.expectedFileCount &&
    !row.executionReceipt.truncated &&
    row.executionReceipt.continuation === null
  );
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
  validateExpressionSetVersion(input);
  const expressions = normalizeHypothesisExpressions(input);
  validateExpressionSetZeroDisposition(input, expressions.length);
  const unresolved = countUnresolvedHypothesisExpressions(input, expressions);
  const terminalClosure = resolveHypothesisExpressionTerminalClosure(
    input,
    expressions,
    unresolved
  );
  const conservation = {
    authored: expressions.length,
    terminal: expressions.length - unresolved,
    unresolved,
  };
  const semantic = { ...input, expressions, conservation, terminalClosure };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

function validateExpressionSetVersion(input: HypothesisExpressionSetReceiptInputV1): void {
  if (!Number.isInteger(input.version) || input.version < 1) {
    fail('EXPRESSION_SET_VERSION_INVALID');
  }
  if (input.version === 1 && input.parentReceiptId !== null) {
    fail('EXPRESSION_SET_PARENT_UNEXPECTED');
  }
  if (input.version > 1 && !input.parentReceiptId) {
    fail('EXPRESSION_SET_PARENT_REQUIRED');
  }
}

function normalizeHypothesisExpressions(
  input: HypothesisExpressionSetReceiptInputV1
): HypothesisExpressionRowV1[] {
  const expressions = [...input.expressions].sort(byId('expressionId'));
  if (new Set(expressions.map((row) => row.expressionId)).size !== expressions.length) {
    fail('EXPRESSION_SET_ROW_DUPLICATE');
  }
  for (const expression of expressions) {
    requireText(expression.authoredFingerprint, 'EXPRESSION_SET_FINGERPRINT_REQUIRED');
    requireText(expression.terminalReceiptId, 'EXPRESSION_SET_TERMINAL_RECEIPT_REQUIRED');
    requireSha256(expression.terminalReceiptHash, 'EXPRESSION_SET_TERMINAL_RECEIPT_HASH_REQUIRED');
    if (!EXPRESSION_TERMINAL_FATES.has(expression.terminalFate)) {
      fail('EXPRESSION_SET_TERMINAL_FATE_INVALID');
    }
    if (
      (expression.terminalFate === 'reviewed-merge' ||
        expression.terminalFate === 'reviewed-duplicate') &&
      (!expression.matchingRepresentativeId ||
        !expression.matchingContentReadyRecipeId ||
        !expression.dispositionReview)
    ) {
      fail('EXPRESSION_SET_REPRESENTATIVE_REQUIRED');
    }
    if (expression.dispositionReview) {
      assertKnowledgeDispositionReviewIntegrity(expression.dispositionReview);
      if (
        (expression.terminalFate !== 'reviewed-merge' &&
          expression.terminalFate !== 'reviewed-duplicate') ||
        expression.dispositionReview.reviewKind !== 'producer-non-draft' ||
        expression.dispositionReview.verdict !== 'pass' ||
        expression.dispositionReview.currentAnalysisFixpointHash !== input.analysisFixpointHash ||
        expression.terminalReceiptId !== expression.dispositionReview.reviewReceiptId ||
        expression.terminalReceiptHash !== expression.dispositionReview.receiptHash ||
        expression.dispositionReview.proposedDispositionHash !==
          hashKnowledgeDispositionProposalV1({
            reviewKind: 'producer-non-draft',
            populationHash: expression.dispositionReview.populationHash,
            hypothesisId: input.hypothesisId,
            expression: {
              expressionId: expression.expressionId,
              authoredFingerprint: expression.authoredFingerprint,
              terminalFate: expression.terminalFate,
              matchingRepresentativeId: expression.matchingRepresentativeId ?? null,
              matchingContentReadyRecipeId: expression.matchingContentReadyRecipeId ?? null,
            },
            zeroDisposition: null,
          })
      ) {
        fail('EXPRESSION_SET_DISPOSITION_REVIEW_INVALID');
      }
    }
  }
  return expressions;
}

function validateExpressionSetZeroDisposition(
  input: HypothesisExpressionSetReceiptInputV1,
  expressionCount: number
): void {
  if (expressionCount === 0 && !input.zeroDisposition) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_REQUIRED');
  }
  if (expressionCount > 0 && input.zeroDisposition) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_CONFLICT');
  }
  const zeroDisposition = input.zeroDisposition;
  if (!zeroDisposition) {
    return;
  }
  if (!zeroDisposition.reasonCode || !zeroDisposition.reviewerReceiptId) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_UNREVIEWED');
  }
  assertKnowledgeDispositionReviewIntegrity(zeroDisposition.dispositionReview);
  if (
    zeroDisposition.dispositionReview.reviewKind !== 'producer-non-draft' ||
    zeroDisposition.dispositionReview.verdict !== 'pass' ||
    zeroDisposition.dispositionReview.currentAnalysisFixpointHash !== input.analysisFixpointHash ||
    zeroDisposition.reviewerReceiptId !== zeroDisposition.dispositionReview.reviewReceiptId ||
    zeroDisposition.dispositionReview.proposedDispositionHash !==
      hashKnowledgeDispositionProposalV1({
        reviewKind: 'producer-non-draft',
        populationHash: zeroDisposition.dispositionReview.populationHash,
        hypothesisId: input.hypothesisId,
        expression: null,
        zeroDisposition: {
          reasonCode: zeroDisposition.reasonCode,
          terminalFate: zeroDisposition.terminalFate,
        },
      })
  ) {
    fail('EXPRESSION_SET_ZERO_DISPOSITION_UNREVIEWED');
  }
}

function countUnresolvedHypothesisExpressions(
  input: HypothesisExpressionSetReceiptInputV1,
  expressions: readonly HypothesisExpressionRowV1[]
): number {
  return (
    expressions.filter((row) => row.terminalFate === 'failed' || row.terminalFate === 'unknown')
      .length +
    (input.zeroDisposition?.terminalFate === 'failed' ||
    input.zeroDisposition?.terminalFate === 'unknown'
      ? 1
      : 0)
  );
}

function resolveHypothesisExpressionTerminalClosure(
  input: HypothesisExpressionSetReceiptInputV1,
  expressions: readonly HypothesisExpressionRowV1[],
  unresolved: number
): HypothesisExpressionSetReceiptV1['terminalClosure'] {
  if (!input.terminalHead) {
    return 'historical';
  }
  if (unresolved > 0) {
    fail('EXPRESSION_SET_TERMINAL_HEAD_UNRESOLVED');
  }
  if (input.zeroDisposition?.terminalFate === 'reviewed-non-draft') {
    return 'reviewed-non-draft';
  }
  if (expressions.some((row) => row.terminalFate === 'content-ready')) {
    return 'expressed';
  }
  if (
    expressions.length > 0 &&
    expressions.every(
      (row) =>
        (row.terminalFate === 'reviewed-merge' || row.terminalFate === 'reviewed-duplicate') &&
        Boolean(row.matchingRepresentativeId && row.matchingContentReadyRecipeId)
    )
  ) {
    return 'represented-by';
  }
  fail('EXPRESSION_SET_TERMINAL_HEAD_NOT_CLOSED');
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
    if (receipt.schemaVersion !== 1 || receipt.receiptHash !== hashCanonicalJson(receiptSemantic)) {
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

function assertFinalExpandedScheduleReceiptV1(receipt: FinalExpandedMiningScheduleReceiptV1): void {
  const semantic = {
    schemaVersion: receipt.schemaVersion,
    baselineScheduleHash: receipt.baselineScheduleHash,
    expansionReceiptHashes: receipt.expansionReceiptHashes,
    obligationIds: receipt.obligationIds,
    explorationObligationCount: receipt.explorationObligationCount,
    counterexampleObligationCount: receipt.counterexampleObligationCount,
  };
  if (
    receipt.schemaVersion !== 1 ||
    receipt.finalExpandedScheduleHash !== hashCanonicalJson(semantic) ||
    normalizeStrings(receipt.obligationIds).length !== receipt.obligationIds.length ||
    JSON.stringify(normalizeStrings(receipt.obligationIds)) !==
      JSON.stringify(receipt.obligationIds) ||
    receipt.explorationObligationCount < 0 ||
    receipt.counterexampleObligationCount < 0
  ) {
    fail('FINAL_EXPANDED_SCHEDULE_RECEIPT_INVALID');
  }
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
  const analysisReviewContextHash = createAnalysisReviewContextHashV1({
    finalExpandedScheduleHash: input.finalExpandedSchedule.finalExpandedScheduleHash,
    terminalObligations,
    populationHashes: normalizeStrings(input.populationHashes),
    clusterSetHashes: normalizeStrings(
      input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash)
    ),
  });
  const semantic = {
    schemaVersion: 1 as const,
    finalExpandedScheduleHash: input.finalExpandedSchedule.finalExpandedScheduleHash,
    terminalObligations,
    populationHashes: normalizeStrings(input.populationHashes),
    clusterSetHashes: normalizeStrings(
      input.clusterSets.map((clusterSet) => clusterSet.clusterSetHash)
    ),
    analysisReviewContextHash,
    inductionReceiptHashes: normalizeStrings(input.inductionReceiptHashes),
    falsificationReceiptHashes: normalizeStrings(input.falsificationReceiptHashes),
  };
  return freezeDeep({ ...semantic, fixpointHash: hashCanonicalJson(semantic) });
}

export function createAnalysisReviewContextHashV1(input: {
  readonly finalExpandedScheduleHash: string;
  readonly terminalObligations: AnalysisFixpointReceiptV1['terminalObligations'];
  readonly populationHashes: readonly string[];
  readonly clusterSetHashes: readonly string[];
}): string {
  return hashCanonicalJson({
    schemaVersion: 1,
    finalExpandedScheduleHash: input.finalExpandedScheduleHash,
    terminalObligations: [...input.terminalObligations].sort(byId('obligationId')),
    populationHashes: normalizeStrings(input.populationHashes),
    clusterSetHashes: normalizeStrings(input.clusterSetHashes),
  });
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
      !/^sha256:[0-9a-f]{64}$/.test(input.projectContextRefHash) ||
      !input.canonicalSubjectRef ||
      input.canonicalSubjectRef !== input.projectContextRefId ||
      !input.anchor.relativePath ||
      !input.anchor.blobHash ||
      (input.anchor.range && !validRange(input.anchor.range))
    ) {
      fail('FACT_DIRECT_WITNESS_UNBOUND');
    }
    const semantic = {
      kind: 'direct' as const,
      evidenceEntryId: input.evidenceEntryId,
      evidenceSessionId: input.evidenceSessionId,
      evidenceContentHash: input.evidenceContentHash,
      sourceRevisionVectorHash: input.sourceRevisionVectorHash,
      projectContextRefId: input.projectContextRefId,
      projectContextRefHash: input.projectContextRefHash,
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
    projectContextRefId: witness.projectContextRefId,
    projectContextRefHash: witness.projectContextRefHash,
    sourceRevisionVectorHash: witness.sourceRevisionVectorHash,
    canonicalSubjectRef: witness.canonicalSubjectRef,
    anchor: witness.anchor,
  };
}

function assertKnowledgeDispositionReviewIntegrity(review: KnowledgeDispositionReviewV1): void {
  assertProductionActorIdentityV1(review.producer);
  assertProductionActorIdentityV1(review.reviewer);
  const { reviewReceiptId, receiptHash, ...semantic } = review;
  const executionBindings = [...review.executionBindings].sort(byId('obligationId'));
  const executionScopeSemantic = {
    finalExpandedScheduleHash: review.executionScope.finalExpandedScheduleHash,
    scheduledObligationIds: review.executionScope.scheduledObligationIds,
    terminalObligations: review.executionScope.terminalObligations,
  };
  const scheduledObligationIds = normalizeStrings(review.executionScope.scheduledObligationIds);
  const terminalObligations = [...review.executionScope.terminalObligations].sort(
    byId('obligationId')
  );
  if (
    knowledgeReviewEnvelopeInvalid(review, semantic, receiptHash, reviewReceiptId) ||
    knowledgeReviewScopeInvalid(
      review,
      executionScopeSemantic,
      scheduledObligationIds,
      terminalObligations
    ) ||
    knowledgeReviewBindingsInvalid(review, executionBindings, terminalObligations)
  ) {
    fail('KNOWLEDGE_DISPOSITION_REVIEW_INVALID');
  }
}

function knowledgeReviewEnvelopeInvalid(
  review: KnowledgeDispositionReviewV1,
  semantic: Omit<KnowledgeDispositionReviewV1, 'reviewReceiptId' | 'receiptHash'>,
  receiptHash: string,
  reviewReceiptId: string
): boolean {
  return (
    review.schemaVersion !== 1 ||
    !KNOWLEDGE_DISPOSITION_REVIEW_KINDS.has(review.reviewKind) ||
    !KNOWLEDGE_DISPOSITION_REVIEW_VERDICTS.has(review.verdict) ||
    !review.reasonCode?.trim() ||
    !/^sha256:[0-9a-f]{64}$/.test(review.currentAnalysisFixpointHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(review.populationHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(review.proposedDispositionHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(review.sourceRevisionVectorHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(review.calibrationReceiptHash) ||
    hashCanonicalJson(semantic) !== receiptHash ||
    reviewReceiptId !== `knowledge-review:${receiptHash.slice(7, 31)}` ||
    (review.semanticExecutionResultHash !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(review.semanticExecutionResultHash)) ||
    (review.semanticExecutionResultHash !== undefined
      ? review.producer.runId === review.reviewer.runId
      : review.producer.runId !== review.reviewer.runId) ||
    review.producer.actorHash === review.reviewer.actorHash ||
    review.producer.invocationId === review.reviewer.invocationId ||
    review.producer.outputHash === review.reviewer.outputHash
  );
}

function knowledgeReviewScopeInvalid(
  review: KnowledgeDispositionReviewV1,
  executionScopeSemantic: {
    readonly finalExpandedScheduleHash: string;
    readonly scheduledObligationIds: readonly string[];
    readonly terminalObligations: KnowledgeDispositionReviewV1['executionScope']['terminalObligations'];
  },
  scheduledObligationIds: readonly string[],
  terminalObligations: KnowledgeDispositionReviewV1['executionScope']['terminalObligations']
): boolean {
  return (
    review.executionScope.scopeHash !== hashCanonicalJson(executionScopeSemantic) ||
    !/^sha256:[0-9a-f]{64}$/.test(review.executionScope.finalExpandedScheduleHash) ||
    !sameOrderedStrings(review.executionScope.scheduledObligationIds, scheduledObligationIds) ||
    !sameOrderedStrings(
      terminalObligations.map((obligation) => obligation.obligationId),
      scheduledObligationIds
    )
  );
}

function knowledgeReviewBindingsInvalid(
  review: KnowledgeDispositionReviewV1,
  executionBindings: readonly KnowledgeDispositionExecutionBindingV1[],
  terminalObligations: KnowledgeDispositionReviewV1['executionScope']['terminalObligations']
): boolean {
  return (
    executionBindings.length === 0 ||
    JSON.stringify(review.executionBindings) !== JSON.stringify(executionBindings) ||
    new Set(executionBindings.map((binding) => binding.obligationId)).size !==
      executionBindings.length ||
    executionBindings.some(
      (binding) =>
        !binding.obligationId.trim() ||
        !/^sha256:[0-9a-f]{64}$/.test(binding.executionReceiptHash) ||
        !/^sha256:[0-9a-f]{64}$/.test(binding.executionOutputHash) ||
        !/^sha256:[0-9a-f]{64}$/.test(binding.denominatorHash) ||
        !binding.terminalReceiptId.trim() ||
        !FACT_QUERY_TERMINAL_DISPOSITIONS.has(binding.disposition) ||
        !terminalObligations.some(
          (terminal) =>
            terminal.obligationId === binding.obligationId &&
            terminal.terminalReceiptId === binding.terminalReceiptId &&
            terminal.disposition === binding.disposition
        )
    ) ||
    !sameOrderedStrings(
      review.obligationIds,
      executionBindings.map((binding) => binding.obligationId)
    ) ||
    !sameOrderedStrings(
      review.executionReceiptHashes,
      executionBindings.map((binding) => binding.executionReceiptHash)
    ) ||
    !sameOrderedStrings(
      review.executionOutputHashes,
      executionBindings.map((binding) => binding.executionOutputHash)
    ) ||
    !sameOrderedStrings(
      review.denominatorHashes,
      executionBindings.map((binding) => binding.denominatorHash)
    )
  );
}

export function assertKnowledgeDispositionReviewV1(review: KnowledgeDispositionReviewV1): void {
  assertKnowledgeDispositionReviewIntegrity(review);
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

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeObservationDispositionLineage<
  T extends {
    readonly observationId: string;
    readonly factIds: readonly string[];
    readonly obligationIds: readonly string[];
    readonly canonicalSubjectRefs: readonly string[];
    readonly parentSubjectRefs: readonly string[];
  },
>(row: T): T {
  return {
    ...row,
    factIds: normalizeStrings(row.factIds),
    obligationIds: normalizeStrings(row.obligationIds),
    canonicalSubjectRefs: normalizeStrings(row.canonicalSubjectRefs),
    parentSubjectRefs: normalizeStrings(row.parentSubjectRefs),
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalizeStrings(left)) === JSON.stringify(normalizeStrings(right));
}

function normalizeSha256Set(values: readonly string[], code: string): string[] {
  const normalized = normalizeStrings(values);
  if (
    normalized.length !== values.length ||
    normalized.some((value) => !/^sha256:[0-9a-f]{64}$/.test(value))
  ) {
    fail(code);
  }
  return normalized;
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
const COUNTERQUERY_APPLICABILITY_STATUSES = new Set<
  FalsificationReceiptV1['counterqueryApplicability']['status']
>(['required', 'not-required']);
const KNOWLEDGE_DISPOSITION_REVIEW_KINDS = new Set<KnowledgeDispositionReviewKindV1>([
  'cluster-discard',
  'zero-hypothesis',
  'falsification',
  'semantic-merge',
  'semantic-split',
  'producer-non-draft',
  'investigated-empty',
]);
const KNOWLEDGE_DISPOSITION_REVIEW_VERDICTS = new Set<KnowledgeDispositionReviewV1['verdict']>([
  'pass',
  'revise',
  'reject',
]);
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

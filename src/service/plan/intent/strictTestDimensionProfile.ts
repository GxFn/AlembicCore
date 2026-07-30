import {
  createServingSnapshotManifestV1,
  type FinalCoverageBindingReceiptV1,
  type ServingSnapshotManifestV1,
} from '../../production/ProductionPersistenceContracts.js';
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from '../../project-context/foundation/canonical.js';
import type { CanonicalSha256 } from '../../project-context/foundation/contracts.js';
import {
  buildDimensionCatalogSnapshot,
  type ColdStartCellUniverseV1,
  type CompiledColdStartPlanV2,
  type DimensionCatalogSnapshotV1,
  type FactQueryCatalogSnapshotV1,
  type PlanCellV1,
  type RequiredFactApplicabilityUniverseV1,
} from './coldStartProductionPlan.js';

export const STRICT_TEST_DIMENSION_PROFILE_V1 = 'strict-test-dimension' as const;
export const STRICT_TEST_UNEXECUTED_DISPOSITION_V1 = 'not-executed-by-strict-test-profile' as const;
export const STRICT_TEST_STATE_SEQUENCE_V1 = Object.freeze([
  'PREFLIGHT_REQUESTED',
  'PREFLIGHT_FACTS_FROZEN',
  'PREFLIGHT_UNIVERSE_VALIDATED',
  'AWAITING_CONFIRMATION',
  'SELECTION_CONFIRMED',
  'PRIVATE_WORKSPACE_READY',
  'PLAN_COMPILED',
  'FACT_SCHEDULE_FROZEN',
  'ANALYSIS_FIXPOINT_CLOSED',
  'EXPRESSION_SETS_REVIEWED',
  'PRIVATE_CORPUS_SEALED',
  'PRIVATE_INDEXES_VERIFIED',
  'PRIVATE_G4_READY',
  'PRIVATE_SERVING_VALIDATED',
  'STRICT_TEST_COMPLETED_PRIVATE',
] as const);

export type StrictTestStateV1 = (typeof STRICT_TEST_STATE_SEQUENCE_V1)[number];
export type StrictTestTerminalStateV1 = 'STRICT_TEST_COMPLETED_PRIVATE' | 'STRICT_TEST_FAILED';
export type StrictTestDimensionApplicabilityV1 = 'applicable' | 'excluded' | 'unknown';
export type StrictTestFailureStageV1 = Exclude<StrictTestStateV1, 'STRICT_TEST_COMPLETED_PRIVATE'>;
export type StrictTestFailureAuthorityRequirementV1 = 'required' | 'forbidden';

export interface StrictTestFailureStageAuthorityV1 {
  readonly preflight: StrictTestFailureAuthorityRequirementV1;
  readonly confirmation: StrictTestFailureAuthorityRequirementV1;
  readonly projection: StrictTestFailureAuthorityRequirementV1;
}

/**
 * failure receipt 只能绑定进入 failedStage 时已经存在的 authority。该表是 Agent/Main
 * 的唯一解释源，constructor、terminal validator 与 audit 都必须通过同一 resolver。
 */
export const STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1: Readonly<
  Record<StrictTestFailureStageV1, StrictTestFailureStageAuthorityV1>
> = freezeDeep({
  PREFLIGHT_REQUESTED: {
    preflight: 'forbidden',
    confirmation: 'forbidden',
    projection: 'forbidden',
  },
  PREFLIGHT_FACTS_FROZEN: {
    preflight: 'forbidden',
    confirmation: 'forbidden',
    projection: 'forbidden',
  },
  PREFLIGHT_UNIVERSE_VALIDATED: {
    preflight: 'forbidden',
    confirmation: 'forbidden',
    projection: 'forbidden',
  },
  AWAITING_CONFIRMATION: {
    preflight: 'required',
    confirmation: 'forbidden',
    projection: 'forbidden',
  },
  SELECTION_CONFIRMED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'forbidden',
  },
  PRIVATE_WORKSPACE_READY: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  PLAN_COMPILED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  FACT_SCHEDULE_FROZEN: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  ANALYSIS_FIXPOINT_CLOSED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  EXPRESSION_SETS_REVIEWED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  PRIVATE_CORPUS_SEALED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  PRIVATE_INDEXES_VERIFIED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  PRIVATE_G4_READY: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
  PRIVATE_SERVING_VALIDATED: {
    preflight: 'required',
    confirmation: 'required',
    projection: 'required',
  },
});

export function resolveStrictTestFailureStageAuthorityV1(
  failedStage: StrictTestStateV1
): StrictTestFailureStageAuthorityV1 {
  if (
    failedStage === 'STRICT_TEST_COMPLETED_PRIVATE' ||
    !Object.hasOwn(STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1, failedStage)
  ) {
    fail('STRICT_TEST_FAILURE_FIELDS_INVALID', 'unknown/completed stage cannot fail');
  }
  return STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1[failedStage as StrictTestFailureStageV1];
}

/**
 * 外层只读 preflight 必须显式提供这些已加载绑定。Core 不读取环境变量、文件系统或宿主
 * 状态，也不会根据 dimension 数量、budget 或旧 testMode 猜测 profile。
 */
export interface StrictTestPreflightBindingsV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly demandKey: string;
  readonly runId: string;
  readonly projectRootIdentity: string;
  readonly controlRootIdentity: string;
  readonly sourceRootIdentity: string;
  readonly canonicalProjectIdentityHash: CanonicalSha256;
  readonly sourceRevisionVectorHash: CanonicalSha256;
  readonly sourceInventoryHash: CanonicalSha256;
  readonly sourceFileCount: number;
  readonly moduleCount: number;
  readonly languageCount: number;
  readonly parserCount: number;
  readonly backendCount: number;
  readonly certifiedProjectFactsArtifactHash: CanonicalSha256;
  readonly certifiedProjectFactsContentHash: CanonicalSha256;
  readonly certifiedProjectFactsSourceArtifactHash: CanonicalSha256;
  readonly certifiedProjectFactsSourceVectorHash: CanonicalSha256;
  readonly certifiedProjectFactsConsumerReceiptHash: CanonicalSha256;
  readonly strictConfigReceiptHash: CanonicalSha256;
  readonly providerModelHash: CanonicalSha256;
  readonly promptSopHash: CanonicalSha256;
  readonly factQueryBackendHash: CanonicalSha256;
  readonly parserBackendHash: CanonicalSha256;
  readonly embeddingVectorHash: CanonicalSha256;
  readonly runtimeArtifactManifestHash: CanonicalSha256;
  readonly runtimeArtifactBindingHash: CanonicalSha256;
  readonly productionBeforeStateHash: CanonicalSha256;
  readonly productionAfterReadStateHash: CanonicalSha256;
  readonly publicRouteBeforeStateHash: CanonicalSha256;
  readonly officialRecipeBeforeStateHash: CanonicalSha256;
  readonly privateWorkspacePolicyHash: CanonicalSha256;
  readonly generatedAt: string;
  readonly validUntil: string | null;
}

export interface StrictTestDimensionPreflightResultV1 {
  readonly dimensionId: string;
  readonly status: StrictTestDimensionApplicabilityV1;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly eligibleCellIds: readonly string[];
  readonly excludedCellIds: readonly string[];
  readonly eligibleCellCount: number;
  readonly excludedCellCount: number;
  readonly requiredFactsSupported: boolean;
  readonly dimensionCellSetHash: CanonicalSha256;
}

export interface StrictTestDimensionRecommendationV1 {
  readonly dimensionId: string;
  readonly reasonCode:
    | 'ARCHITECTURE_APPLICABLE_AND_SUPPORTED'
    | 'FIRST_EVIDENCE_SUPPORTED_APPLICABLE_DIMENSION';
  readonly evidenceRefs: readonly string[];
  readonly alternativeDimensionIds: readonly string[];
  readonly recommendationHash: CanonicalSha256;
}

export interface StrictTestPreflightReceiptV1 {
  readonly schemaVersion: 1;
  readonly canonicalizerVersion: 'canonical-json-v1';
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly state: 'AWAITING_CONFIRMATION';
  readonly demandKey: string;
  readonly runId: string;
  readonly projectRootIdentity: string;
  readonly controlRootIdentity: string;
  readonly sourceRootIdentity: string;
  readonly canonicalProjectIdentityHash: CanonicalSha256;
  readonly sourceRevisionVectorHash: CanonicalSha256;
  readonly sourceInventoryHash: CanonicalSha256;
  readonly sourceFileCount: number;
  readonly moduleCount: number;
  readonly languageCount: number;
  readonly parserCount: number;
  readonly backendCount: number;
  readonly certifiedProjectFactsArtifactHash: CanonicalSha256;
  readonly certifiedProjectFactsContentHash: CanonicalSha256;
  readonly certifiedProjectFactsSourceArtifactHash: CanonicalSha256;
  readonly certifiedProjectFactsSourceVectorHash: CanonicalSha256;
  readonly certifiedProjectFactsConsumerReceiptHash: CanonicalSha256;
  readonly compiledPlanHash: CanonicalSha256;
  readonly catalog: DimensionCatalogSnapshotV1;
  readonly cellUniverse: ColdStartCellUniverseV1;
  readonly fullCellUniverseHash: CanonicalSha256;
  readonly requiredFactApplicability: RequiredFactApplicabilityUniverseV1;
  readonly requiredFactApplicabilityUniverseHash: CanonicalSha256;
  readonly factQueryCatalog: FactQueryCatalogSnapshotV1;
  readonly factQueryCatalogHash: CanonicalSha256;
  readonly baselineScheduleHash: CanonicalSha256;
  readonly dimensionResults: readonly StrictTestDimensionPreflightResultV1[];
  readonly applicableDimensionCount: number;
  readonly excludedDimensionCount: number;
  readonly unknownDimensionCount: 0;
  readonly unknownApplicabilityCount: 0;
  readonly unsupportedBackendCount: 0;
  readonly strictConfigReceiptHash: CanonicalSha256;
  readonly providerModelHash: CanonicalSha256;
  readonly promptSopHash: CanonicalSha256;
  readonly factQueryBackendHash: CanonicalSha256;
  readonly parserBackendHash: CanonicalSha256;
  readonly embeddingVectorHash: CanonicalSha256;
  readonly runtimeArtifactManifestHash: CanonicalSha256;
  readonly runtimeArtifactBindingHash: CanonicalSha256;
  readonly productionBeforeStateHash: CanonicalSha256;
  readonly productionAfterReadStateHash: CanonicalSha256;
  readonly publicRouteBeforeStateHash: CanonicalSha256;
  readonly officialRecipeBeforeStateHash: CanonicalSha256;
  readonly privateWorkspacePolicyHash: CanonicalSha256;
  readonly recommendation: StrictTestDimensionRecommendationV1;
  readonly generatedAt: string;
  readonly validUntil: string | null;
  readonly bindingHash: CanonicalSha256;
  readonly driftInvalidationHash: CanonicalSha256;
  readonly preflightHash: CanonicalSha256;
}

export interface StrictTestPreflightPreviewV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly preflightHash: CanonicalSha256;
  readonly state: 'AWAITING_CONFIRMATION';
  readonly canConfirm: true;
  readonly recommendation: StrictTestDimensionRecommendationV1;
  readonly dimensions: readonly StrictTestDimensionPreflightResultV1[];
  readonly blockers: readonly [];
  readonly previewHash: CanonicalSha256;
}

export interface StrictTestSelectionConfirmationV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly state: 'SELECTION_CONFIRMED';
  readonly demandKey: string;
  readonly runId: string;
  readonly preflightHash: CanonicalSha256;
  readonly bindingHash: CanonicalSha256;
  readonly selectedDimensionId: string;
  readonly fullCellUniverseHash: CanonicalSha256;
  readonly selectedEligibleCellIds: readonly string[];
  readonly selectedEligibleCellsHash: CanonicalSha256;
  readonly strictConfigReceiptHash: CanonicalSha256;
  readonly providerModelHash: CanonicalSha256;
  readonly runtimeArtifactBindingHash: CanonicalSha256;
  readonly privateWorkspacePolicyHash: CanonicalSha256;
  readonly privateStrictTestOnly: true;
  readonly productionFinalized: false;
  readonly publicRouteChanged: false;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly confirmationHash: CanonicalSha256;
}

export interface StrictTestDimensionExecutionStateV1 {
  readonly dimensionId: string;
  readonly disposition: 'selected-for-execution' | typeof STRICT_TEST_UNEXECUTED_DISPOSITION_V1;
  readonly executionCellIds: readonly string[];
  readonly executionCellCount: number;
}

export interface StrictTestDimensionExecutionProjectionV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly state: 'SELECTION_CONFIRMED';
  readonly demandKey: string;
  readonly runId: string;
  readonly preflightHash: CanonicalSha256;
  readonly confirmationHash: CanonicalSha256;
  readonly bindingHash: CanonicalSha256;
  readonly selectedDimensionId: string;
  readonly executionCellIds: readonly string[];
  readonly executionCellSetHash: CanonicalSha256;
  readonly dimensionStates: readonly StrictTestDimensionExecutionStateV1[];
  readonly fullCatalogHash: CanonicalSha256;
  readonly fullCatalogSourceArtifactHash: CanonicalSha256;
  readonly fullCellUniverseHash: CanonicalSha256;
  readonly fullEligibleCellsHash: CanonicalSha256;
  readonly fullExcludedCellsHash: CanonicalSha256;
  readonly fullApplicabilityUniverseHash: CanonicalSha256;
  readonly fullFactQueryCatalogHash: CanonicalSha256;
  readonly fullBaselineScheduleHash: CanonicalSha256;
  readonly certifiedProjectFactsContentHash: CanonicalSha256;
  readonly sourceRevisionVectorHash: CanonicalSha256;
  readonly sourceInventoryHash: CanonicalSha256;
  readonly productionFinalized: false;
  readonly publicRouteChanged: false;
  readonly projectedAt: string;
  readonly projectionHash: CanonicalSha256;
}

export interface StrictTestPrivateTerminalAuthorityContextV1 {
  readonly currentBindings: StrictTestPreflightBindingsV1;
  readonly preflight: StrictTestPreflightReceiptV1 | null;
  readonly confirmation: StrictTestSelectionConfirmationV1 | null;
  readonly projection: StrictTestDimensionExecutionProjectionV1 | null;
}

export interface StrictTestPrivateCompletionReceiptV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly terminalState: 'STRICT_TEST_COMPLETED_PRIVATE';
  readonly demandKey: string;
  readonly runId: string;
  readonly preflightHash: CanonicalSha256;
  readonly confirmationHash: CanonicalSha256;
  readonly projectionHash: CanonicalSha256;
  readonly finalCoverageBinding: FinalCoverageBindingReceiptV1;
  readonly servingSnapshotManifest: ServingSnapshotManifestV1;
  readonly privateG4ReceiptHash: CanonicalSha256;
  readonly privateServingValidationHash: CanonicalSha256;
  readonly privateEvidenceRefs: readonly string[];
  readonly productionBeforeStateHash: CanonicalSha256;
  readonly productionAfterStateHash: CanonicalSha256;
  readonly publicRouteBeforeStateHash: CanonicalSha256;
  readonly publicRouteAfterStateHash: CanonicalSha256;
  readonly productionFinalized: false;
  readonly publicRouteChanged: false;
  readonly completedAt: string;
  readonly terminalHash: CanonicalSha256;
}

export interface StrictTestPrivateFailureReceiptV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly terminalState: 'STRICT_TEST_FAILED';
  readonly demandKey: string;
  readonly runId: string;
  readonly observedBindingsHash: CanonicalSha256;
  readonly preflightHash: CanonicalSha256 | null;
  readonly confirmationHash: CanonicalSha256 | null;
  readonly projectionHash: CanonicalSha256 | null;
  readonly failedStage: StrictTestFailureStageV1;
  readonly errorCode: string;
  readonly privateEvidenceRefs: readonly string[];
  readonly forbiddenInferences: readonly string[];
  readonly productionBeforeStateHash: CanonicalSha256;
  readonly productionAfterStateHash: CanonicalSha256;
  readonly publicRouteBeforeStateHash: CanonicalSha256;
  readonly publicRouteAfterStateHash: CanonicalSha256;
  readonly productionFinalized: false;
  readonly publicRouteChanged: false;
  readonly failedAt: string;
  readonly terminalHash: CanonicalSha256;
}

export type StrictTestPrivateTerminalReceiptV1 =
  | StrictTestPrivateCompletionReceiptV1
  | StrictTestPrivateFailureReceiptV1;

export interface StrictTestAuditReportV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof STRICT_TEST_DIMENSION_PROFILE_V1;
  readonly demandKey: string;
  readonly runId: string;
  readonly preflightHash: CanonicalSha256 | null;
  readonly confirmationHash: CanonicalSha256 | null;
  readonly projectionHash: CanonicalSha256 | null;
  readonly terminalHash: CanonicalSha256;
  readonly terminalState: StrictTestTerminalStateV1;
  readonly fullUniverse: {
    readonly dimensionCount: 26;
    readonly cellCount: number;
    readonly eligibleCellCount: number;
    readonly excludedCellCount: number;
    readonly cellUniverseHash: CanonicalSha256;
  } | null;
  readonly executedProjection: {
    readonly dimensionId: string;
    readonly cellCount: number;
    readonly cellSetHash: CanonicalSha256;
  } | null;
  readonly unexecutedDimensionIds: readonly string[] | null;
  readonly failure: {
    readonly failedStage: StrictTestFailureStageV1;
    readonly errorCode: string;
  } | null;
  readonly verificationCommands: readonly string[];
  readonly privateArtifactRefs: readonly string[];
  readonly forbiddenConclusions: readonly string[];
  readonly productionFinalized: false;
  readonly publicRouteChanged: false;
  readonly reportHash: CanonicalSha256;
}

const PREFLIGHT_BINDING_KEYS: readonly (keyof StrictTestPreflightBindingsV1)[] = [
  'schemaVersion',
  'profile',
  'demandKey',
  'runId',
  'projectRootIdentity',
  'controlRootIdentity',
  'sourceRootIdentity',
  'canonicalProjectIdentityHash',
  'sourceRevisionVectorHash',
  'sourceInventoryHash',
  'sourceFileCount',
  'moduleCount',
  'languageCount',
  'parserCount',
  'backendCount',
  'certifiedProjectFactsArtifactHash',
  'certifiedProjectFactsContentHash',
  'certifiedProjectFactsSourceArtifactHash',
  'certifiedProjectFactsSourceVectorHash',
  'certifiedProjectFactsConsumerReceiptHash',
  'strictConfigReceiptHash',
  'providerModelHash',
  'promptSopHash',
  'factQueryBackendHash',
  'parserBackendHash',
  'embeddingVectorHash',
  'runtimeArtifactManifestHash',
  'runtimeArtifactBindingHash',
  'productionBeforeStateHash',
  'productionAfterReadStateHash',
  'publicRouteBeforeStateHash',
  'officialRecipeBeforeStateHash',
  'privateWorkspacePolicyHash',
  'generatedAt',
  'validUntil',
];

const CONFIRMATION_INPUT_KEYS = [
  'preflight',
  'currentBindings',
  'selectedDimensionIds',
  'confirmedBy',
  'confirmedAt',
] as const;

const PROJECTION_INPUT_KEYS = [
  'preflight',
  'confirmation',
  'currentBindings',
  'projectedAt',
] as const;
const COMPLETION_INPUT_KEYS = [
  'preflight',
  'confirmation',
  'projection',
  'currentBindings',
  'finalCoverageBinding',
  'servingSnapshotManifest',
  'privateG4ReceiptHash',
  'privateServingValidationHash',
  'productionAfterStateHash',
  'publicRouteAfterStateHash',
  'privateEvidenceRefs',
  'completedAt',
] as const;
const FAILURE_INPUT_KEYS = [
  'context',
  'failedStage',
  'errorCode',
  'privateEvidenceRefs',
  'productionAfterStateHash',
  'publicRouteAfterStateHash',
  'failedAt',
] as const;
const REPORT_INPUT_KEYS = [
  'context',
  'terminal',
  'verificationCommands',
  'privateArtifactRefs',
] as const;
const TERMINAL_AUTHORITY_CONTEXT_KEYS = [
  'currentBindings',
  'preflight',
  'confirmation',
  'projection',
] as const;
const RESUME_INPUT_KEYS = [
  'preflight',
  'confirmation',
  'projection',
  'currentBindings',
  'privateWorkspacePolicyHash',
] as const;
const CONFIRMATION_RECEIPT_KEYS = [
  'schemaVersion',
  'profile',
  'state',
  'demandKey',
  'runId',
  'preflightHash',
  'bindingHash',
  'selectedDimensionId',
  'fullCellUniverseHash',
  'selectedEligibleCellIds',
  'selectedEligibleCellsHash',
  'strictConfigReceiptHash',
  'providerModelHash',
  'runtimeArtifactBindingHash',
  'privateWorkspacePolicyHash',
  'privateStrictTestOnly',
  'productionFinalized',
  'publicRouteChanged',
  'confirmedBy',
  'confirmedAt',
  'confirmationHash',
] as const;
const PROJECTION_RECEIPT_KEYS = [
  'schemaVersion',
  'profile',
  'state',
  'demandKey',
  'runId',
  'preflightHash',
  'confirmationHash',
  'bindingHash',
  'selectedDimensionId',
  'executionCellIds',
  'executionCellSetHash',
  'dimensionStates',
  'fullCatalogHash',
  'fullCatalogSourceArtifactHash',
  'fullCellUniverseHash',
  'fullEligibleCellsHash',
  'fullExcludedCellsHash',
  'fullApplicabilityUniverseHash',
  'fullFactQueryCatalogHash',
  'fullBaselineScheduleHash',
  'certifiedProjectFactsContentHash',
  'sourceRevisionVectorHash',
  'sourceInventoryHash',
  'productionFinalized',
  'publicRouteChanged',
  'projectedAt',
  'projectionHash',
] as const;
const PROJECTION_DIMENSION_STATE_KEYS = [
  'dimensionId',
  'disposition',
  'executionCellIds',
  'executionCellCount',
] as const;
const PRIVATE_COMPLETION_RECEIPT_KEYS = [
  'schemaVersion',
  'profile',
  'terminalState',
  'demandKey',
  'runId',
  'preflightHash',
  'confirmationHash',
  'projectionHash',
  'finalCoverageBinding',
  'servingSnapshotManifest',
  'privateG4ReceiptHash',
  'privateServingValidationHash',
  'privateEvidenceRefs',
  'productionBeforeStateHash',
  'productionAfterStateHash',
  'publicRouteBeforeStateHash',
  'publicRouteAfterStateHash',
  'productionFinalized',
  'publicRouteChanged',
  'completedAt',
  'terminalHash',
] as const;
const PRIVATE_FAILURE_RECEIPT_KEYS = [
  'schemaVersion',
  'profile',
  'terminalState',
  'demandKey',
  'runId',
  'observedBindingsHash',
  'preflightHash',
  'confirmationHash',
  'projectionHash',
  'failedStage',
  'errorCode',
  'privateEvidenceRefs',
  'forbiddenInferences',
  'productionBeforeStateHash',
  'productionAfterStateHash',
  'publicRouteBeforeStateHash',
  'publicRouteAfterStateHash',
  'productionFinalized',
  'publicRouteChanged',
  'failedAt',
  'terminalHash',
] as const;
const FINAL_COVERAGE_BINDING_KEYS = [
  'schemaVersion',
  'candidateCoverageReceiptHash',
  'candidateCellSetHash',
  'g4ReceiptHash',
  'candidateDataManifestHash',
  'cells',
  'receiptHash',
] as const;
const FINAL_COVERAGE_CELL_KEYS = [
  'cellId',
  'finalDisposition',
  'finalRecipeIds',
  'finalRecipeFingerprints',
] as const;

export function hashStrictTestPreflightBindingsV1(
  bindings: StrictTestPreflightBindingsV1
): CanonicalSha256 {
  validatePreflightBindings(bindings);
  return hashCanonicalJson(bindings);
}

/**
 * 从已完成生产 Plan 编译的完整分母派生只读 preflight。任何未知、缺失、漂移或 backend
 * 不可用都会在 receipt 生成前拒绝，外层不能通过删除问题维度获得“可确认”状态。
 */
export function validateStrictTestPreflightV1(
  compiledPlan: CompiledColdStartPlanV2,
  bindings: StrictTestPreflightBindingsV1
): StrictTestPreflightReceiptV1 {
  validatePreflightBindings(bindings);
  validateCompiledPlan(compiledPlan, bindings);

  const dimensionResults = compiledPlan.catalog.dimensions.map((dimension) =>
    buildDimensionResult(dimension.id, compiledPlan.universe.cells)
  );
  const applicable = dimensionResults.filter((row) => row.status === 'applicable');
  const excluded = dimensionResults.filter((row) => row.status === 'excluded');
  const unknown = dimensionResults.filter((row) => row.status === 'unknown');
  if (unknown.length > 0) {
    fail(
      'STRICT_TEST_PREFLIGHT_UNKNOWN_DIMENSION',
      unknown.map((row) => row.dimensionId).join(',')
    );
  }
  if (applicable.length === 0) {
    fail('STRICT_TEST_PREFLIGHT_EMPTY_APPLICABLE_UNIVERSE', 'no executable dimension');
  }
  const recommendation = buildRecommendation(applicable);
  const bindingHash = hashCanonicalJson(bindings);
  const driftInvalidationHash = hashCanonicalJson(buildDriftFields(compiledPlan, bindings));
  const semantic = {
    schemaVersion: 1 as const,
    canonicalizerVersion: 'canonical-json-v1' as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    state: 'AWAITING_CONFIRMATION' as const,
    demandKey: bindings.demandKey,
    runId: bindings.runId,
    projectRootIdentity: bindings.projectRootIdentity,
    controlRootIdentity: bindings.controlRootIdentity,
    sourceRootIdentity: bindings.sourceRootIdentity,
    canonicalProjectIdentityHash: bindings.canonicalProjectIdentityHash,
    sourceRevisionVectorHash: bindings.sourceRevisionVectorHash,
    sourceInventoryHash: bindings.sourceInventoryHash,
    sourceFileCount: bindings.sourceFileCount,
    moduleCount: bindings.moduleCount,
    languageCount: bindings.languageCount,
    parserCount: bindings.parserCount,
    backendCount: bindings.backendCount,
    certifiedProjectFactsArtifactHash: bindings.certifiedProjectFactsArtifactHash,
    certifiedProjectFactsContentHash: bindings.certifiedProjectFactsContentHash,
    certifiedProjectFactsSourceArtifactHash: bindings.certifiedProjectFactsSourceArtifactHash,
    certifiedProjectFactsSourceVectorHash: bindings.certifiedProjectFactsSourceVectorHash,
    certifiedProjectFactsConsumerReceiptHash: bindings.certifiedProjectFactsConsumerReceiptHash,
    compiledPlanHash: compiledPlan.canonicalPlanHash,
    catalog: compiledPlan.catalog,
    cellUniverse: compiledPlan.universe,
    fullCellUniverseHash: compiledPlan.universe.cellUniverseHash,
    requiredFactApplicability: compiledPlan.requiredFactApplicability,
    requiredFactApplicabilityUniverseHash: compiledPlan.requiredFactApplicability.universeHash,
    factQueryCatalog: compiledPlan.factQueryCatalog,
    factQueryCatalogHash: compiledPlan.factQueryCatalog.catalogHash,
    baselineScheduleHash: compiledPlan.schedule.baselineScheduleHash,
    dimensionResults,
    applicableDimensionCount: applicable.length,
    excludedDimensionCount: excluded.length,
    unknownDimensionCount: 0 as const,
    unknownApplicabilityCount: 0 as const,
    unsupportedBackendCount: 0 as const,
    strictConfigReceiptHash: bindings.strictConfigReceiptHash,
    providerModelHash: bindings.providerModelHash,
    promptSopHash: bindings.promptSopHash,
    factQueryBackendHash: bindings.factQueryBackendHash,
    parserBackendHash: bindings.parserBackendHash,
    embeddingVectorHash: bindings.embeddingVectorHash,
    runtimeArtifactManifestHash: bindings.runtimeArtifactManifestHash,
    runtimeArtifactBindingHash: bindings.runtimeArtifactBindingHash,
    productionBeforeStateHash: bindings.productionBeforeStateHash,
    productionAfterReadStateHash: bindings.productionAfterReadStateHash,
    publicRouteBeforeStateHash: bindings.publicRouteBeforeStateHash,
    officialRecipeBeforeStateHash: bindings.officialRecipeBeforeStateHash,
    privateWorkspacePolicyHash: bindings.privateWorkspacePolicyHash,
    recommendation,
    generatedAt: bindings.generatedAt,
    validUntil: bindings.validUntil,
    bindingHash,
    driftInvalidationHash,
  };
  return freezeDeep({ ...semantic, preflightHash: hashCanonicalJson(semantic) });
}

export function assertStrictTestPreflightReceiptV1(receipt: StrictTestPreflightReceiptV1): void {
  assertPreflightEnvelopeInvariant(receipt);
  assertPreflightHash(receipt);
  assertAcceptedPreflightCatalog(receipt.catalog);
  validateEmbeddedUniverse(receipt.catalog, receipt.cellUniverse);
  validateApplicability(receipt.requiredFactApplicability);
  validateFactQueryCatalog(receipt.factQueryCatalog);
  assertPreflightDimensionConservation(receipt);
  assertPreflightBindingConservation(receipt);
  assertPreflightEmbeddedLineage(receipt);
}

function assertPreflightEnvelopeInvariant(receipt: StrictTestPreflightReceiptV1): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.profile !== STRICT_TEST_DIMENSION_PROFILE_V1 ||
    receipt.state !== 'AWAITING_CONFIRMATION' ||
    receipt.catalog.dimensions.length !== 26 ||
    receipt.dimensionResults.length !== 26 ||
    receipt.unknownDimensionCount !== 0 ||
    receipt.unknownApplicabilityCount !== 0 ||
    receipt.unsupportedBackendCount !== 0 ||
    receipt.applicableDimensionCount < 1 ||
    receipt.productionBeforeStateHash !== receipt.productionAfterReadStateHash
  ) {
    fail('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID', 'invariant');
  }
}

function assertPreflightHash(receipt: StrictTestPreflightReceiptV1): void {
  const { preflightHash, ...semantic } = receipt;
  if (preflightHash !== hashCanonicalJson(semantic)) {
    fail('STRICT_TEST_PREFLIGHT_HASH_MISMATCH', 'preflightHash');
  }
}

function assertAcceptedPreflightCatalog(catalog: DimensionCatalogSnapshotV1): void {
  const acceptedCatalog = buildDimensionCatalogSnapshot();
  if (
    catalog.catalogHash !== acceptedCatalog.catalogHash ||
    catalog.sourceArtifactHash !== acceptedCatalog.sourceArtifactHash ||
    canonicalJsonStringify(catalog.dimensions) !==
      canonicalJsonStringify(acceptedCatalog.dimensions)
  ) {
    fail('STRICT_TEST_DIMENSION_CATALOG_DRIFT', 'embedded catalog');
  }
}

function assertPreflightDimensionConservation(receipt: StrictTestPreflightReceiptV1): void {
  const expectedDimensionResults = receipt.catalog.dimensions.map((dimension) =>
    buildDimensionResult(dimension.id, receipt.cellUniverse.cells)
  );
  if (
    canonicalJsonStringify(receipt.dimensionResults) !==
      canonicalJsonStringify(expectedDimensionResults) ||
    receipt.applicableDimensionCount !==
      expectedDimensionResults.filter((row) => row.status === 'applicable').length ||
    receipt.excludedDimensionCount !==
      expectedDimensionResults.filter((row) => row.status === 'excluded').length
  ) {
    fail('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID', 'dimension conservation');
  }
  const expectedRecommendation = buildRecommendation(
    expectedDimensionResults.filter((row) => row.status === 'applicable')
  );
  if (
    canonicalJsonStringify(receipt.recommendation) !==
    canonicalJsonStringify(expectedRecommendation)
  ) {
    fail('STRICT_TEST_PREFLIGHT_RECOMMENDATION_INVALID', 'canonical recommendation');
  }
  const recommendation = receipt.dimensionResults.find(
    (row) => row.dimensionId === receipt.recommendation.dimensionId
  );
  if (
    !recommendation ||
    recommendation.status !== 'applicable' ||
    recommendation.eligibleCellCount < 1
  ) {
    fail('STRICT_TEST_PREFLIGHT_RECOMMENDATION_INVALID', receipt.recommendation.dimensionId);
  }
}

function assertPreflightBindingConservation(receipt: StrictTestPreflightReceiptV1): void {
  const embeddedBindings = preflightBindingsFromReceipt(receipt);
  if (receipt.bindingHash !== hashStrictTestPreflightBindingsV1(embeddedBindings)) {
    fail('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID', 'bindingHash');
  }
  const expectedDriftHash = hashCanonicalJson(buildReceiptDriftFields(receipt));
  if (receipt.driftInvalidationHash !== expectedDriftHash) {
    fail('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID', 'driftInvalidationHash');
  }
}

function assertPreflightEmbeddedLineage(receipt: StrictTestPreflightReceiptV1): void {
  if (
    receipt.fullCellUniverseHash !== receipt.cellUniverse.cellUniverseHash ||
    receipt.requiredFactApplicabilityUniverseHash !==
      receipt.requiredFactApplicability.universeHash ||
    receipt.factQueryCatalogHash !== receipt.factQueryCatalog.catalogHash
  ) {
    fail('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID', 'embedded lineage');
  }
}

export function assertStrictTestPreflightCurrentV1(
  receipt: StrictTestPreflightReceiptV1,
  currentBindings: StrictTestPreflightBindingsV1,
  observedAt?: string
): void {
  assertStrictTestPreflightReceiptV1(receipt);
  const bindingHash = hashStrictTestPreflightBindingsV1(currentBindings);
  if (
    bindingHash !== receipt.bindingHash ||
    currentBindings.demandKey !== receipt.demandKey ||
    currentBindings.runId !== receipt.runId
  ) {
    fail('STRICT_TEST_PREFLIGHT_DRIFT', 'binding hash or demand/run changed');
  }
  if (observedAt !== undefined) {
    requireTimestamp(observedAt, 'STRICT_TEST_PREFLIGHT_TIME_INVALID');
    if (Date.parse(observedAt) < Date.parse(receipt.generatedAt)) {
      fail('STRICT_TEST_PREFLIGHT_TIME_INVALID', observedAt);
    }
    if (receipt.validUntil !== null && Date.parse(observedAt) > Date.parse(receipt.validUntil)) {
      fail('STRICT_TEST_PREFLIGHT_EXPIRED', observedAt);
    }
  }
}

export function createStrictTestPreflightPreviewV1(
  preflight: StrictTestPreflightReceiptV1
): StrictTestPreflightPreviewV1 {
  assertStrictTestPreflightReceiptV1(preflight);
  const semantic = {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    preflightHash: preflight.preflightHash,
    state: 'AWAITING_CONFIRMATION' as const,
    canConfirm: true as const,
    recommendation: preflight.recommendation,
    dimensions: preflight.dimensionResults,
    blockers: [] as const,
  };
  return freezeDeep({ ...semantic, previewHash: hashCanonicalJson(semantic) });
}

export function createStrictTestSelectionConfirmationV1(input: {
  readonly preflight: StrictTestPreflightReceiptV1;
  readonly currentBindings: StrictTestPreflightBindingsV1;
  readonly selectedDimensionIds: readonly string[];
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}): StrictTestSelectionConfirmationV1 {
  assertExactKeys(input, CONFIRMATION_INPUT_KEYS, 'STRICT_TEST_CONFIRMATION_FIELDS_INVALID');
  assertStrictTestPreflightCurrentV1(input.preflight, input.currentBindings, input.confirmedAt);
  if (input.selectedDimensionIds.length !== 1) {
    fail('STRICT_TEST_SELECTION_EXACTLY_ONE_REQUIRED', `${input.selectedDimensionIds.length}`);
  }
  const selectedDimensionId = input.selectedDimensionIds[0]?.trim() ?? '';
  if (
    !selectedDimensionId ||
    new Set(input.selectedDimensionIds).size !== input.selectedDimensionIds.length
  ) {
    fail('STRICT_TEST_SELECTION_EXACTLY_ONE_REQUIRED', 'empty or duplicate');
  }
  const selected = input.preflight.dimensionResults.find(
    (row) => row.dimensionId === selectedDimensionId
  );
  if (!selected || selected.status !== 'applicable' || selected.eligibleCellCount === 0) {
    fail('STRICT_TEST_SELECTION_DIMENSION_NOT_APPLICABLE', selectedDimensionId);
  }
  requireText(input.confirmedBy, 'STRICT_TEST_CONFIRMATION_FIELDS_INVALID');
  requireTimestamp(input.confirmedAt, 'STRICT_TEST_CONFIRMATION_FIELDS_INVALID');
  const selectedEligibleCellIds = [...selected.eligibleCellIds];
  const semantic = {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    state: 'SELECTION_CONFIRMED' as const,
    demandKey: input.preflight.demandKey,
    runId: input.preflight.runId,
    preflightHash: input.preflight.preflightHash,
    bindingHash: input.preflight.bindingHash,
    selectedDimensionId,
    fullCellUniverseHash: input.preflight.fullCellUniverseHash,
    selectedEligibleCellIds,
    selectedEligibleCellsHash: hashCanonicalJson(selectedEligibleCellIds),
    strictConfigReceiptHash: input.preflight.strictConfigReceiptHash,
    providerModelHash: input.preflight.providerModelHash,
    runtimeArtifactBindingHash: input.preflight.runtimeArtifactBindingHash,
    privateWorkspacePolicyHash: input.preflight.privateWorkspacePolicyHash,
    privateStrictTestOnly: true as const,
    productionFinalized: false as const,
    publicRouteChanged: false as const,
    confirmedBy: input.confirmedBy.trim(),
    confirmedAt: input.confirmedAt,
  };
  return freezeDeep({ ...semantic, confirmationHash: hashCanonicalJson(semantic) });
}

export function assertStrictTestSelectionConfirmationV1(
  confirmation: StrictTestSelectionConfirmationV1,
  preflight: StrictTestPreflightReceiptV1
): void {
  assertExactKeys(confirmation, CONFIRMATION_RECEIPT_KEYS, 'STRICT_TEST_CONFIRMATION_INVALID');
  assertConfirmationShape(confirmation);
  assertConfirmationFields(confirmation);
  const { confirmationHash, ...semantic } = confirmation;
  if (confirmationHash !== hashCanonicalJson(semantic)) {
    fail('STRICT_TEST_CONFIRMATION_HASH_MISMATCH', 'confirmationHash');
  }
  if (!preflight) {
    fail('STRICT_TEST_CONFIRMATION_CONTEXT_REQUIRED', 'preflight');
  }
  assertStrictTestPreflightCurrentV1(
    preflight,
    preflightBindingsFromReceipt(preflight),
    confirmation.confirmedAt
  );
  assertConfirmationPreflightLineage(confirmation, preflight);
}

function assertConfirmationShape(confirmation: StrictTestSelectionConfirmationV1): void {
  if (
    confirmation.schemaVersion !== 1 ||
    confirmation.profile !== STRICT_TEST_DIMENSION_PROFILE_V1 ||
    confirmation.state !== 'SELECTION_CONFIRMED' ||
    !confirmation.privateStrictTestOnly ||
    confirmation.productionFinalized !== false ||
    confirmation.publicRouteChanged !== false ||
    confirmation.selectedEligibleCellIds.length === 0 ||
    new Set(confirmation.selectedEligibleCellIds).size !==
      confirmation.selectedEligibleCellIds.length ||
    confirmation.selectedEligibleCellIds.some((cellId) => !cellId.trim()) ||
    confirmation.selectedEligibleCellsHash !==
      hashCanonicalJson(confirmation.selectedEligibleCellIds)
  ) {
    fail('STRICT_TEST_CONFIRMATION_INVALID', 'invariant');
  }
}

function assertConfirmationFields(confirmation: StrictTestSelectionConfirmationV1): void {
  for (const value of [
    confirmation.demandKey,
    confirmation.runId,
    confirmation.selectedDimensionId,
    confirmation.confirmedBy,
  ]) {
    requireText(value, 'STRICT_TEST_CONFIRMATION_INVALID');
  }
  requireTimestamp(confirmation.confirmedAt, 'STRICT_TEST_CONFIRMATION_INVALID');
  for (const hash of [
    confirmation.preflightHash,
    confirmation.bindingHash,
    confirmation.fullCellUniverseHash,
    confirmation.selectedEligibleCellsHash,
    confirmation.strictConfigReceiptHash,
    confirmation.providerModelHash,
    confirmation.runtimeArtifactBindingHash,
    confirmation.privateWorkspacePolicyHash,
    confirmation.confirmationHash,
  ]) {
    requireSha(hash, 'STRICT_TEST_CONFIRMATION_INVALID');
  }
}

function assertConfirmationPreflightLineage(
  confirmation: StrictTestSelectionConfirmationV1,
  preflight: StrictTestPreflightReceiptV1
): void {
  const selected = preflight.dimensionResults.find(
    (row) => row.dimensionId === confirmation.selectedDimensionId
  );
  if (
    confirmation.demandKey !== preflight.demandKey ||
    confirmation.runId !== preflight.runId ||
    confirmation.preflightHash !== preflight.preflightHash ||
    confirmation.bindingHash !== preflight.bindingHash ||
    confirmation.fullCellUniverseHash !== preflight.fullCellUniverseHash ||
    confirmation.strictConfigReceiptHash !== preflight.strictConfigReceiptHash ||
    confirmation.providerModelHash !== preflight.providerModelHash ||
    confirmation.runtimeArtifactBindingHash !== preflight.runtimeArtifactBindingHash ||
    confirmation.privateWorkspacePolicyHash !== preflight.privateWorkspacePolicyHash ||
    !selected ||
    selected.status !== 'applicable' ||
    selected.eligibleCellCount === 0 ||
    confirmation.selectedEligibleCellsHash !== hashCanonicalJson(selected.eligibleCellIds) ||
    canonicalJsonStringify(confirmation.selectedEligibleCellIds) !==
      canonicalJsonStringify(selected.eligibleCellIds)
  ) {
    fail('STRICT_TEST_CONFIRMATION_PREFLIGHT_MISMATCH', confirmation.selectedDimensionId);
  }
}

export function createStrictTestDimensionExecutionProjectionV1(input: {
  readonly preflight: StrictTestPreflightReceiptV1;
  readonly confirmation: StrictTestSelectionConfirmationV1;
  readonly currentBindings: StrictTestPreflightBindingsV1;
  readonly projectedAt: string;
}): StrictTestDimensionExecutionProjectionV1 {
  assertExactKeys(input, PROJECTION_INPUT_KEYS, 'STRICT_TEST_PROJECTION_FIELDS_INVALID');
  assertStrictTestPreflightCurrentV1(input.preflight, input.currentBindings, input.projectedAt);
  assertStrictTestSelectionConfirmationV1(input.confirmation, input.preflight);
  requireTimestamp(input.projectedAt, 'STRICT_TEST_PROJECTION_TIME_INVALID');
  if (Date.parse(input.projectedAt) < Date.parse(input.confirmation.confirmedAt)) {
    fail('STRICT_TEST_PROJECTION_TIME_INVALID', 'projectedAt precedes confirmedAt');
  }
  const semantic = buildProjectionSemantic(input.preflight, input.confirmation, input.projectedAt);
  return freezeDeep({ ...semantic, projectionHash: hashCanonicalJson(semantic) });
}

function buildProjectionSemantic(
  preflight: StrictTestPreflightReceiptV1,
  confirmation: StrictTestSelectionConfirmationV1,
  projectedAt: string
) {
  const executionCellIds = [...confirmation.selectedEligibleCellIds];
  const dimensionStates = buildProjectionDimensionStates(preflight, confirmation);
  return {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    state: 'SELECTION_CONFIRMED' as const,
    demandKey: preflight.demandKey,
    runId: preflight.runId,
    preflightHash: preflight.preflightHash,
    confirmationHash: confirmation.confirmationHash,
    bindingHash: preflight.bindingHash,
    selectedDimensionId: confirmation.selectedDimensionId,
    executionCellIds,
    executionCellSetHash: hashCanonicalJson(executionCellIds),
    dimensionStates,
    fullCatalogHash: preflight.catalog.catalogHash,
    fullCatalogSourceArtifactHash: preflight.catalog.sourceArtifactHash,
    fullCellUniverseHash: preflight.fullCellUniverseHash,
    fullEligibleCellsHash: preflight.cellUniverse.eligibleCellsHash,
    fullExcludedCellsHash: preflight.cellUniverse.excludedCellsHash,
    fullApplicabilityUniverseHash: preflight.requiredFactApplicabilityUniverseHash,
    fullFactQueryCatalogHash: preflight.factQueryCatalogHash,
    fullBaselineScheduleHash: preflight.baselineScheduleHash,
    certifiedProjectFactsContentHash: preflight.certifiedProjectFactsContentHash,
    sourceRevisionVectorHash: preflight.sourceRevisionVectorHash,
    sourceInventoryHash: preflight.sourceInventoryHash,
    productionFinalized: false as const,
    publicRouteChanged: false as const,
    projectedAt,
  };
}

function buildProjectionDimensionStates(
  preflight: StrictTestPreflightReceiptV1,
  confirmation: StrictTestSelectionConfirmationV1
): StrictTestDimensionExecutionStateV1[] {
  const executionCellIds = [...confirmation.selectedEligibleCellIds];
  return preflight.dimensionResults.map((row) =>
    row.dimensionId === confirmation.selectedDimensionId
      ? {
          dimensionId: row.dimensionId,
          disposition: 'selected-for-execution' as const,
          executionCellIds,
          executionCellCount: executionCellIds.length,
        }
      : {
          dimensionId: row.dimensionId,
          disposition: STRICT_TEST_UNEXECUTED_DISPOSITION_V1,
          executionCellIds: [] as readonly string[],
          executionCellCount: 0,
        }
  );
}

export function assertStrictTestDimensionExecutionProjectionV1(
  projection: StrictTestDimensionExecutionProjectionV1,
  preflight: StrictTestPreflightReceiptV1,
  confirmation: StrictTestSelectionConfirmationV1
): void {
  assertProjectionShape(projection);
  const { projectionHash, ...semantic } = projection;
  if (projectionHash !== hashCanonicalJson(semantic)) {
    fail('STRICT_TEST_PROJECTION_HASH_MISMATCH', 'projectionHash');
  }
  if (!preflight || !confirmation) {
    fail('STRICT_TEST_PROJECTION_CONTEXT_REQUIRED', 'preflight and confirmation');
  }
  assertProjectionLineage(projection, preflight, confirmation);
}

function assertProjectionShape(projection: StrictTestDimensionExecutionProjectionV1): void {
  assertExactKeys(projection, PROJECTION_RECEIPT_KEYS, 'STRICT_TEST_PROJECTION_INVALID');
  assertProjectionDimensionStatesShape(projection);
  assertProjectionEnvelopeShape(projection);
  assertProjectionHashFields(projection);
}

function assertProjectionDimensionStatesShape(
  projection: StrictTestDimensionExecutionProjectionV1
): void {
  for (const state of projection.dimensionStates) {
    assertExactKeys(state, PROJECTION_DIMENSION_STATE_KEYS, 'STRICT_TEST_PROJECTION_INVALID');
    requireText(state.dimensionId, 'STRICT_TEST_PROJECTION_INVALID');
    if (
      !Number.isSafeInteger(state.executionCellCount) ||
      state.executionCellCount < 0 ||
      new Set(state.executionCellIds).size !== state.executionCellIds.length ||
      state.executionCellIds.some((cellId) => !cellId.trim())
    ) {
      fail('STRICT_TEST_PROJECTION_INVALID', 'dimension state cells');
    }
  }
}

function assertProjectionEnvelopeShape(projection: StrictTestDimensionExecutionProjectionV1): void {
  const selectedStates = projection.dimensionStates.filter(
    (state) => state.disposition === 'selected-for-execution'
  );
  const selectedState = selectedStates[0];
  const dimensionIds = projection.dimensionStates.map((state) => state.dimensionId);
  const invalidUnselectedState = projection.dimensionStates.some((state) =>
    isInvalidUnselectedDimensionState(state, projection.selectedDimensionId)
  );
  if (
    projection.schemaVersion !== 1 ||
    projection.profile !== STRICT_TEST_DIMENSION_PROFILE_V1 ||
    projection.state !== 'SELECTION_CONFIRMED' ||
    projection.productionFinalized !== false ||
    projection.publicRouteChanged !== false ||
    projection.executionCellIds.length === 0 ||
    new Set(projection.executionCellIds).size !== projection.executionCellIds.length ||
    projection.executionCellIds.some((cellId) => !cellId.trim()) ||
    projection.executionCellSetHash !== hashCanonicalJson(projection.executionCellIds) ||
    projection.dimensionStates.length !== 26 ||
    new Set(dimensionIds).size !== 26 ||
    selectedStates.length !== 1 ||
    !selectedState ||
    selectedState.dimensionId !== projection.selectedDimensionId ||
    selectedState.executionCellCount !== projection.executionCellIds.length ||
    canonicalJsonStringify(selectedState.executionCellIds) !==
      canonicalJsonStringify(projection.executionCellIds) ||
    invalidUnselectedState
  ) {
    fail('STRICT_TEST_PROJECTION_INVALID', 'conservation invariant');
  }
  for (const value of [projection.demandKey, projection.runId, projection.selectedDimensionId]) {
    requireText(value, 'STRICT_TEST_PROJECTION_INVALID');
  }
  requireTimestamp(projection.projectedAt, 'STRICT_TEST_PROJECTION_INVALID');
}

function assertProjectionHashFields(projection: StrictTestDimensionExecutionProjectionV1): void {
  for (const hash of [
    projection.preflightHash,
    projection.confirmationHash,
    projection.bindingHash,
    projection.executionCellSetHash,
    projection.fullCatalogHash,
    projection.fullCatalogSourceArtifactHash,
    projection.fullCellUniverseHash,
    projection.fullEligibleCellsHash,
    projection.fullExcludedCellsHash,
    projection.fullApplicabilityUniverseHash,
    projection.fullFactQueryCatalogHash,
    projection.fullBaselineScheduleHash,
    projection.certifiedProjectFactsContentHash,
    projection.sourceRevisionVectorHash,
    projection.sourceInventoryHash,
    projection.projectionHash,
  ]) {
    requireSha(hash, 'STRICT_TEST_PROJECTION_INVALID');
  }
}

function isInvalidUnselectedDimensionState(
  state: StrictTestDimensionExecutionStateV1,
  selectedDimensionId: string
): boolean {
  return (
    state.dimensionId !== selectedDimensionId &&
    (state.disposition !== STRICT_TEST_UNEXECUTED_DISPOSITION_V1 ||
      state.executionCellCount !== 0 ||
      state.executionCellIds.length !== 0)
  );
}

function assertProjectionLineage(
  projection: StrictTestDimensionExecutionProjectionV1,
  preflight: StrictTestPreflightReceiptV1,
  confirmation: StrictTestSelectionConfirmationV1
): void {
  assertStrictTestSelectionConfirmationV1(confirmation, preflight);
  const { projectionHash: _projectionHash, ...projectionSemantic } = projection;
  const expectedSemantic = buildProjectionSemantic(preflight, confirmation, projection.projectedAt);
  if (canonicalJsonStringify(projectionSemantic) !== canonicalJsonStringify(expectedSemantic)) {
    fail('STRICT_TEST_PROJECTION_LINEAGE_MISMATCH', projection.selectedDimensionId);
  }
  if (Date.parse(projection.projectedAt) < Date.parse(confirmation.confirmedAt)) {
    fail('STRICT_TEST_PROJECTION_TIME_INVALID', 'projectedAt precedes confirmedAt');
  }
}

export function assertStrictTestResumeContextV1(input: {
  readonly preflight: StrictTestPreflightReceiptV1;
  readonly confirmation: StrictTestSelectionConfirmationV1;
  readonly projection: StrictTestDimensionExecutionProjectionV1;
  readonly currentBindings: StrictTestPreflightBindingsV1;
  readonly privateWorkspacePolicyHash: CanonicalSha256;
}): void {
  assertExactKeys(input, RESUME_INPUT_KEYS, 'STRICT_TEST_RESUME_CONTEXT_INVALID');
  assertStrictTestPreflightCurrentV1(input.preflight, input.currentBindings);
  assertStrictTestSelectionConfirmationV1(input.confirmation, input.preflight);
  assertStrictTestDimensionExecutionProjectionV1(
    input.projection,
    input.preflight,
    input.confirmation
  );
  if (
    input.privateWorkspacePolicyHash !== input.preflight.privateWorkspacePolicyHash ||
    input.privateWorkspacePolicyHash !== input.confirmation.privateWorkspacePolicyHash
  ) {
    fail('STRICT_TEST_RESUME_CONTEXT_DRIFT', 'private workspace owner/policy');
  }
}

export function createStrictTestPrivateCompletionReceiptV1(input: {
  readonly preflight: StrictTestPreflightReceiptV1;
  readonly confirmation: StrictTestSelectionConfirmationV1;
  readonly projection: StrictTestDimensionExecutionProjectionV1;
  readonly currentBindings: StrictTestPreflightBindingsV1;
  readonly finalCoverageBinding: FinalCoverageBindingReceiptV1;
  readonly servingSnapshotManifest: ServingSnapshotManifestV1;
  readonly privateG4ReceiptHash: CanonicalSha256;
  readonly privateServingValidationHash: CanonicalSha256;
  readonly productionAfterStateHash: CanonicalSha256;
  readonly publicRouteAfterStateHash: CanonicalSha256;
  readonly privateEvidenceRefs: readonly string[];
  readonly completedAt: string;
}): StrictTestPrivateCompletionReceiptV1 {
  assertExactKeys(input, COMPLETION_INPUT_KEYS, 'STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID');
  assertStrictTestPreflightCurrentV1(input.preflight, input.currentBindings, input.completedAt);
  assertStrictTestSelectionConfirmationV1(input.confirmation, input.preflight);
  assertStrictTestDimensionExecutionProjectionV1(
    input.projection,
    input.preflight,
    input.confirmation
  );
  validatePrivateCompletionBindings(input);
  const semantic = {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    terminalState: 'STRICT_TEST_COMPLETED_PRIVATE' as const,
    demandKey: input.preflight.demandKey,
    runId: input.preflight.runId,
    preflightHash: input.preflight.preflightHash,
    confirmationHash: input.confirmation.confirmationHash,
    projectionHash: input.projection.projectionHash,
    finalCoverageBinding: input.finalCoverageBinding,
    servingSnapshotManifest: input.servingSnapshotManifest,
    privateG4ReceiptHash: input.privateG4ReceiptHash,
    privateServingValidationHash: input.privateServingValidationHash,
    privateEvidenceRefs: normalizeStrings(input.privateEvidenceRefs),
    productionBeforeStateHash: input.preflight.productionBeforeStateHash,
    productionAfterStateHash: input.productionAfterStateHash,
    publicRouteBeforeStateHash: input.preflight.publicRouteBeforeStateHash,
    publicRouteAfterStateHash: input.publicRouteAfterStateHash,
    productionFinalized: false as const,
    publicRouteChanged: false as const,
    completedAt: input.completedAt,
  };
  return freezeDeep({ ...semantic, terminalHash: hashCanonicalJson(semantic) });
}

export function createStrictTestPrivateFailureReceiptV1(input: {
  readonly context: StrictTestPrivateTerminalAuthorityContextV1;
  readonly failedStage: StrictTestFailureStageV1;
  readonly errorCode: string;
  readonly privateEvidenceRefs: readonly string[];
  readonly productionAfterStateHash: CanonicalSha256;
  readonly publicRouteAfterStateHash: CanonicalSha256;
  readonly failedAt: string;
}): StrictTestPrivateFailureReceiptV1 {
  assertExactKeys(input, FAILURE_INPUT_KEYS, 'STRICT_TEST_FAILURE_FIELDS_INVALID');
  requireText(input.errorCode, 'STRICT_TEST_FAILURE_FIELDS_INVALID');
  requireTimestamp(input.failedAt, 'STRICT_TEST_FAILURE_FIELDS_INVALID');
  const authority = validateStrictTestFailureAuthorityContextV1(
    input.failedStage,
    input.context,
    input.failedAt
  );
  const privateEvidenceRefs = normalizeStrings(input.privateEvidenceRefs);
  if (privateEvidenceRefs.length === 0) {
    fail('STRICT_TEST_FAILURE_FIELDS_INVALID', 'private evidence');
  }
  if (
    input.productionAfterStateHash !== authority.productionBeforeStateHash ||
    input.publicRouteAfterStateHash !== authority.publicRouteBeforeStateHash
  ) {
    fail('STRICT_TEST_PRODUCTION_MUTATION_DETECTED', input.failedStage);
  }
  const forbiddenInferences = strictTestForbiddenConclusions();
  const semantic = {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    terminalState: 'STRICT_TEST_FAILED' as const,
    demandKey: authority.demandKey,
    runId: authority.runId,
    observedBindingsHash: authority.observedBindingsHash,
    preflightHash: authority.preflightHash,
    confirmationHash: authority.confirmationHash,
    projectionHash: authority.projectionHash,
    failedStage: input.failedStage,
    errorCode: input.errorCode.trim(),
    privateEvidenceRefs,
    forbiddenInferences,
    productionBeforeStateHash: authority.productionBeforeStateHash,
    productionAfterStateHash: input.productionAfterStateHash,
    publicRouteBeforeStateHash: authority.publicRouteBeforeStateHash,
    publicRouteAfterStateHash: input.publicRouteAfterStateHash,
    productionFinalized: false as const,
    publicRouteChanged: false as const,
    failedAt: input.failedAt,
  };
  return freezeDeep({ ...semantic, terminalHash: hashCanonicalJson(semantic) });
}

export function assertStrictTestPrivateTerminalReceiptV1(
  receipt: StrictTestPrivateTerminalReceiptV1,
  context: StrictTestPrivateTerminalAuthorityContextV1
): void {
  assertExactKeys(
    context,
    TERMINAL_AUTHORITY_CONTEXT_KEYS,
    receipt.terminalState === 'STRICT_TEST_FAILED'
      ? 'STRICT_TEST_FAILURE_AUTHORITY_MISMATCH'
      : 'STRICT_TEST_PRIVATE_TERMINAL_CONTEXT_REQUIRED'
  );
  if (receipt.terminalState === 'STRICT_TEST_COMPLETED_PRIVATE') {
    assertExactKeys(
      receipt,
      PRIVATE_COMPLETION_RECEIPT_KEYS,
      'STRICT_TEST_PRIVATE_TERMINAL_INVALID'
    );
  } else if (receipt.terminalState === 'STRICT_TEST_FAILED') {
    assertExactKeys(receipt, PRIVATE_FAILURE_RECEIPT_KEYS, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  } else {
    fail('STRICT_TEST_PRIVATE_TERMINAL_INVALID', 'terminalState');
  }
  assertPrivateTerminalNonMutation(receipt);
  const { terminalHash, ...semantic } = receipt;
  if (terminalHash !== hashCanonicalJson(semantic)) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_HASH_MISMATCH', 'terminalHash');
  }
  if (receipt.terminalState === 'STRICT_TEST_COMPLETED_PRIVATE') {
    assertPrivateCompletionAuthorityContext(receipt, context);
    return;
  }
  assertPrivateFailureAuthorityContext(receipt, context);
}

function assertPrivateCompletionAuthorityContext(
  receipt: StrictTestPrivateCompletionReceiptV1,
  context: StrictTestPrivateTerminalAuthorityContextV1
): void {
  const { preflight, confirmation, projection } = context;
  if (!preflight || !confirmation || !projection) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_CONTEXT_REQUIRED', 'preflight, confirmation and projection');
  }
  assertStrictTestPreflightCurrentV1(preflight, context.currentBindings, receipt.completedAt);
  assertStrictTestSelectionConfirmationV1(confirmation, preflight);
  assertStrictTestDimensionExecutionProjectionV1(projection, preflight, confirmation);
  if (
    receipt.demandKey !== preflight.demandKey ||
    receipt.runId !== preflight.runId ||
    receipt.preflightHash !== preflight.preflightHash ||
    receipt.productionBeforeStateHash !== preflight.productionBeforeStateHash ||
    receipt.publicRouteBeforeStateHash !== preflight.publicRouteBeforeStateHash
  ) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_CONTEXT_MISMATCH', receipt.terminalState);
  }
  assertPrivateCompletionLineage(receipt);
  if (
    receipt.confirmationHash !== confirmation.confirmationHash ||
    receipt.projectionHash !== projection.projectionHash ||
    Date.parse(receipt.completedAt) < Date.parse(projection.projectedAt)
  ) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_CONTEXT_MISMATCH', 'completion lineage');
  }
  validatePrivateCompletionBindings({
    preflight,
    projection,
    finalCoverageBinding: receipt.finalCoverageBinding,
    servingSnapshotManifest: receipt.servingSnapshotManifest,
    privateG4ReceiptHash: receipt.privateG4ReceiptHash,
    privateServingValidationHash: receipt.privateServingValidationHash,
    productionAfterStateHash: receipt.productionAfterStateHash,
    publicRouteAfterStateHash: receipt.publicRouteAfterStateHash,
    privateEvidenceRefs: receipt.privateEvidenceRefs,
    completedAt: receipt.completedAt,
  });
}

function assertPrivateFailureAuthorityContext(
  receipt: StrictTestPrivateFailureReceiptV1,
  context: StrictTestPrivateTerminalAuthorityContextV1
): void {
  assertPrivateFailureLineage(receipt);
  const authority = validateStrictTestFailureAuthorityContextV1(
    receipt.failedStage,
    context,
    receipt.failedAt
  );
  if (
    receipt.demandKey !== authority.demandKey ||
    receipt.runId !== authority.runId ||
    receipt.observedBindingsHash !== authority.observedBindingsHash ||
    receipt.preflightHash !== authority.preflightHash ||
    receipt.confirmationHash !== authority.confirmationHash ||
    receipt.projectionHash !== authority.projectionHash ||
    receipt.productionBeforeStateHash !== authority.productionBeforeStateHash ||
    receipt.publicRouteBeforeStateHash !== authority.publicRouteBeforeStateHash
  ) {
    fail('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH', receipt.failedStage);
  }
}

function validateStrictTestFailureAuthorityContextV1(
  failedStage: StrictTestFailureStageV1,
  context: StrictTestPrivateTerminalAuthorityContextV1,
  failedAt: string
) {
  assertExactKeys(
    context,
    TERMINAL_AUTHORITY_CONTEXT_KEYS,
    'STRICT_TEST_FAILURE_AUTHORITY_MISMATCH'
  );
  requireTimestamp(failedAt, 'STRICT_TEST_FAILURE_FIELDS_INVALID');
  const matrix = resolveStrictTestFailureStageAuthorityV1(failedStage);
  for (const key of ['preflight', 'confirmation', 'projection'] as const) {
    // 运行时调用方可能绕过 TypeScript 传入 undefined；authority 只有非 null/undefined
    // 才算存在，避免 required 槽位以“有 key、无 receipt”的方式穿过矩阵。
    const present = context[key] !== null && context[key] !== undefined;
    if ((matrix[key] === 'required') !== present) {
      fail('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH', `${failedStage}:${key}`);
    }
  }

  const observedBindingsHash = hashStrictTestPreflightBindingsV1(context.currentBindings);
  if (Date.parse(context.currentBindings.generatedAt) > Date.parse(failedAt)) {
    fail('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE', 'currentBindings.generatedAt');
  }

  const { preflight, confirmation, projection } = context;
  if (preflight) {
    assertStrictTestPreflightReceiptV1(preflight);
    if (
      preflight.demandKey !== context.currentBindings.demandKey ||
      preflight.runId !== context.currentBindings.runId
    ) {
      fail('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH', 'preflight demand/run');
    }
    if (Date.parse(preflight.generatedAt) > Date.parse(failedAt)) {
      fail('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE', 'preflight.generatedAt');
    }
  }
  if (confirmation) {
    if (!preflight) {
      fail('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH', 'confirmation without preflight');
    }
    assertStrictTestSelectionConfirmationV1(confirmation, preflight);
    if (Date.parse(confirmation.confirmedAt) > Date.parse(failedAt)) {
      fail('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE', 'confirmation.confirmedAt');
    }
  }
  if (projection) {
    if (!preflight || !confirmation) {
      fail('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH', 'projection without predecessors');
    }
    assertStrictTestDimensionExecutionProjectionV1(projection, preflight, confirmation);
    if (Date.parse(projection.projectedAt) > Date.parse(failedAt)) {
      fail('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE', 'projection.projectedAt');
    }
  }

  return {
    observedBindingsHash,
    preflightHash: preflight?.preflightHash ?? null,
    confirmationHash: confirmation?.confirmationHash ?? null,
    projectionHash: projection?.projectionHash ?? null,
    demandKey: preflight?.demandKey ?? context.currentBindings.demandKey,
    runId: preflight?.runId ?? context.currentBindings.runId,
    productionBeforeStateHash:
      preflight?.productionBeforeStateHash ?? context.currentBindings.productionBeforeStateHash,
    publicRouteBeforeStateHash:
      preflight?.publicRouteBeforeStateHash ?? context.currentBindings.publicRouteBeforeStateHash,
  };
}

function assertPrivateTerminalNonMutation(receipt: StrictTestPrivateTerminalReceiptV1): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.profile !== STRICT_TEST_DIMENSION_PROFILE_V1 ||
    receipt.productionFinalized !== false ||
    receipt.publicRouteChanged !== false ||
    receipt.productionBeforeStateHash !== receipt.productionAfterStateHash ||
    receipt.publicRouteBeforeStateHash !== receipt.publicRouteAfterStateHash
  ) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_INVALID', 'non-mutation invariant');
  }
  for (const value of [receipt.demandKey, receipt.runId]) {
    requireText(value, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  }
  for (const hash of [
    receipt.productionBeforeStateHash,
    receipt.productionAfterStateHash,
    receipt.publicRouteBeforeStateHash,
    receipt.publicRouteAfterStateHash,
    receipt.terminalHash,
  ]) {
    requireSha(hash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  }
  if (receipt.preflightHash !== null) {
    requireSha(receipt.preflightHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  }
}

function assertPrivateCompletionLineage(receipt: StrictTestPrivateCompletionReceiptV1): void {
  requireTimestamp(receipt.completedAt, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  requireSha(receipt.confirmationHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  requireSha(receipt.projectionHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  requireSha(receipt.privateG4ReceiptHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  requireSha(receipt.privateServingValidationHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  const finalCoverageSemantic = omitHash(receipt.finalCoverageBinding, 'receiptHash');
  const servingSemantic = omitHash(receipt.servingSnapshotManifest, 'manifestHash');
  const hasNonPassingCell = receipt.finalCoverageBinding.cells.some(
    (cell) => cell.finalDisposition === 'failed' || cell.finalDisposition === 'unknown'
  );
  if (
    receipt.finalCoverageBinding.receiptHash !== hashCanonicalJson(finalCoverageSemantic) ||
    receipt.servingSnapshotManifest.manifestHash !== hashCanonicalJson(servingSemantic) ||
    receipt.finalCoverageBinding.g4ReceiptHash !== receipt.privateG4ReceiptHash ||
    receipt.servingSnapshotManifest.finalCoverageBindingHash !==
      receipt.finalCoverageBinding.receiptHash ||
    receipt.servingSnapshotManifest.candidateDataManifestHash !==
      receipt.finalCoverageBinding.candidateDataManifestHash ||
    receipt.servingSnapshotManifest.servingSnapshotValidationHash !==
      receipt.privateServingValidationHash ||
    receipt.finalCoverageBinding.cells.length === 0 ||
    normalizeStrings(receipt.privateEvidenceRefs).length === 0 ||
    hasNonPassingCell
  ) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_INVALID', 'private coverage/serving lineage');
  }
}

function assertPrivateFailureLineage(receipt: StrictTestPrivateFailureReceiptV1): void {
  requireTimestamp(receipt.failedAt, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  requireSha(receipt.observedBindingsHash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
  for (const hash of [receipt.preflightHash, receipt.confirmationHash, receipt.projectionHash]) {
    if (hash !== null) {
      requireSha(hash, 'STRICT_TEST_PRIVATE_TERMINAL_INVALID');
    }
  }
  resolveStrictTestFailureStageAuthorityV1(receipt.failedStage);
  if (
    !receipt.errorCode ||
    normalizeStrings(receipt.privateEvidenceRefs).length === 0 ||
    canonicalJsonStringify(receipt.forbiddenInferences) !==
      canonicalJsonStringify(strictTestForbiddenConclusions())
  ) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_INVALID', 'failure lineage');
  }
}

export function createStrictTestAuditReportV1(input: {
  readonly context: StrictTestPrivateTerminalAuthorityContextV1;
  readonly terminal: StrictTestPrivateTerminalReceiptV1;
  readonly verificationCommands: readonly string[];
  readonly privateArtifactRefs: readonly string[];
}): StrictTestAuditReportV1 {
  assertExactKeys(input, REPORT_INPUT_KEYS, 'STRICT_TEST_REPORT_FIELDS_INVALID');
  assertStrictTestPrivateTerminalReceiptV1(input.terminal, input.context);
  const { preflight, projection } = input.context;
  const failure =
    input.terminal.terminalState === 'STRICT_TEST_FAILED'
      ? {
          failedStage: input.terminal.failedStage,
          errorCode: input.terminal.errorCode,
        }
      : null;
  const privateArtifactRefs = normalizeStrings(
    input.terminal.terminalState === 'STRICT_TEST_FAILED'
      ? [...input.terminal.privateEvidenceRefs, ...input.privateArtifactRefs]
      : input.privateArtifactRefs
  );
  const semantic = {
    schemaVersion: 1 as const,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    demandKey: input.terminal.demandKey,
    runId: input.terminal.runId,
    preflightHash: input.terminal.preflightHash,
    confirmationHash: input.terminal.confirmationHash,
    projectionHash: input.terminal.projectionHash,
    terminalHash: input.terminal.terminalHash,
    terminalState: input.terminal.terminalState,
    fullUniverse: preflight
      ? {
          dimensionCount: 26 as const,
          cellCount: preflight.cellUniverse.universeCount,
          eligibleCellCount: preflight.cellUniverse.eligibleCount,
          excludedCellCount: preflight.cellUniverse.excludedCount,
          cellUniverseHash: preflight.fullCellUniverseHash,
        }
      : null,
    executedProjection: projection
      ? {
          dimensionId: projection.selectedDimensionId,
          cellCount: projection.executionCellIds.length,
          cellSetHash: projection.executionCellSetHash,
        }
      : null,
    unexecutedDimensionIds: projection
      ? projection.dimensionStates
          .filter((row) => row.disposition === STRICT_TEST_UNEXECUTED_DISPOSITION_V1)
          .map((row) => row.dimensionId)
      : null,
    failure,
    verificationCommands: normalizeStrings(input.verificationCommands),
    privateArtifactRefs,
    forbiddenConclusions: strictTestForbiddenConclusions(),
    productionFinalized: false as const,
    publicRouteChanged: false as const,
  };
  return freezeDeep({ ...semantic, reportHash: hashCanonicalJson(semantic) });
}

function validateCompiledPlan(
  plan: CompiledColdStartPlanV2,
  bindings: StrictTestPreflightBindingsV1
): void {
  assertCompiledPlanEnvelope(plan);
  assertAcceptedPreflightCatalog(plan.catalog);
  validateEmbeddedUniverse(plan.catalog, plan.universe);
  validateApplicability(plan.requiredFactApplicability);
  validateFactQueryCatalog(plan.factQueryCatalog);
  assertCompiledSelectionUniverse(plan, bindings);
  assertCompiledExecutionLineage(plan, bindings);
}

function assertCompiledPlanEnvelope(plan: CompiledColdStartPlanV2): void {
  const { canonicalPlanHash, ...semantic } = plan;
  if (
    plan.schemaVersion !== 2 ||
    plan.compilerVersion !== 'cold-start-plan-compiler-v2' ||
    canonicalPlanHash !== hashCanonicalJson(semantic)
  ) {
    fail('STRICT_TEST_COMPILED_PLAN_INVALID', 'canonical plan hash');
  }
}

function assertCompiledSelectionUniverse(
  plan: CompiledColdStartPlanV2,
  bindings: StrictTestPreflightBindingsV1
): void {
  const moduleIds = normalizeStrings(plan.selection.moduleIds);
  const dimensionIds = plan.catalog.dimensions.map((row) => row.id);
  const eligibleCellIds = plan.universe.cells
    .filter((cell) => cell.status === 'eligible')
    .map((cell) => cell.cellId);
  const excludedCellIds = plan.universe.cells
    .filter((cell) => cell.status === 'excluded')
    .map((cell) => cell.cellId);
  if (
    bindings.moduleCount !== moduleIds.length ||
    bindings.moduleCount < 1 ||
    plan.universe.universeCount !== moduleIds.length * dimensionIds.length ||
    canonicalJsonStringify(plan.selection.dimensionIds) !== canonicalJsonStringify(dimensionIds) ||
    canonicalJsonStringify(plan.selection.eligibleCellIds) !==
      canonicalJsonStringify(eligibleCellIds) ||
    canonicalJsonStringify(plan.selection.excludedCellIds) !==
      canonicalJsonStringify(excludedCellIds) ||
    plan.selection.deferredCells.length !== 0
  ) {
    fail('STRICT_TEST_FULL_UNIVERSE_CONSERVATION', 'selection/universe mismatch');
  }
  const expectedCellIds = moduleIds.flatMap((moduleId) =>
    dimensionIds.map((dimensionId) => `${moduleId}::${dimensionId}`)
  );
  if (
    !setEquals(new Set(expectedCellIds), new Set(plan.universe.cells.map((cell) => cell.cellId)))
  ) {
    fail('STRICT_TEST_FULL_UNIVERSE_CONSERVATION', 'missing or extra module×dimension cell');
  }
}

function assertCompiledExecutionLineage(
  plan: CompiledColdStartPlanV2,
  bindings: StrictTestPreflightBindingsV1
): void {
  const executionCellsMatchSelection =
    plan.execution.orderedCells.length === plan.selection.eligibleCellIds.length &&
    setEquals(new Set(plan.execution.orderedCells), new Set(plan.selection.eligibleCellIds));
  if (
    plan.execution.factsBindingHash !== bindings.certifiedProjectFactsContentHash ||
    plan.execution.sourceRevisionVectorHash !== bindings.sourceRevisionVectorHash ||
    bindings.certifiedProjectFactsSourceVectorHash !== bindings.sourceRevisionVectorHash ||
    plan.selection.sourceArtifactHash !== bindings.certifiedProjectFactsSourceArtifactHash ||
    plan.selection.strictConfigReceiptHash !== bindings.strictConfigReceiptHash ||
    plan.execution.factQueryCatalogHash !== plan.factQueryCatalog.catalogHash ||
    plan.execution.anatomyApplicabilityHash !== plan.requiredFactApplicability.universeHash ||
    plan.execution.factHarvestScheduleHash !== plan.schedule.factHarvestScheduleHash ||
    plan.execution.lensBindingsHash !== plan.schedule.lensBindingsHash ||
    !executionCellsMatchSelection
  ) {
    fail('STRICT_TEST_FACTS_LINEAGE_MISMATCH', 'compiled plan/runtime bindings');
  }
}

function validateEmbeddedUniverse(
  catalog: DimensionCatalogSnapshotV1,
  universe: ColdStartCellUniverseV1
): void {
  const cells = [...universe.cells];
  const eligible = cells.filter((cell) => cell.status === 'eligible');
  const excluded = cells.filter((cell) => cell.status === 'excluded');
  if (
    cells.length === 0 ||
    new Set(cells.map((cell) => cell.cellId)).size !== cells.length ||
    universe.universeCount !== cells.length ||
    universe.eligibleCount !== eligible.length ||
    universe.excludedCount !== excluded.length ||
    eligible.length + excluded.length !== cells.length ||
    universe.cellUniverseHash !== hashCanonicalJson(cells) ||
    universe.eligibleCellsHash !== hashCanonicalJson(eligible) ||
    universe.excludedCellsHash !== hashCanonicalJson(excluded)
  ) {
    fail('STRICT_TEST_CELL_UNIVERSE_INVALID', 'hash/count/identity mismatch');
  }
  const catalogIds = new Set(catalog.dimensions.map((row) => row.id));
  for (const cell of cells) {
    validateCell(cell, catalogIds);
  }
}

function validateCell(cell: PlanCellV1, catalogIds: ReadonlySet<string>): void {
  if (
    !cell.cellId ||
    !cell.moduleId ||
    !cell.scopeId ||
    !catalogIds.has(cell.dimensionId) ||
    cell.cellId !== `${cell.moduleId}::${cell.dimensionId}` ||
    cell.evidenceRefs.length === 0
  ) {
    fail('STRICT_TEST_CELL_UNIVERSE_INVALID', cell.cellId);
  }
  if (
    (cell.status === 'eligible' && cell.exclusionReason !== undefined) ||
    (cell.status === 'excluded' && !cell.exclusionReason)
  ) {
    fail('STRICT_TEST_CELL_APPLICABILITY_INVALID', cell.cellId);
  }
}

function validateApplicability(universe: RequiredFactApplicabilityUniverseV1): void {
  const required = universe.rows.filter((row) => row.status === 'required');
  const excluded = universe.rows.filter((row) => row.status === 'typed-excluded');
  const unsupported = universe.rows.filter((row) => row.status === 'unsupported-blocked');
  if (
    universe.rows.length === 0 ||
    new Set(universe.rows.map((row) => row.applicabilityId)).size !== universe.rows.length ||
    universe.universeCount !== universe.rows.length ||
    universe.requiredCount !== required.length ||
    universe.typedExcludedCount !== excluded.length ||
    universe.unsupportedBlockedCount !== unsupported.length ||
    required.length + excluded.length + unsupported.length !== universe.rows.length ||
    universe.universeHash !== hashCanonicalJson(universe.rows) ||
    universe.requiredHash !== hashCanonicalJson(required) ||
    universe.exclusionsHash !== hashCanonicalJson([...excluded, ...unsupported]) ||
    unsupported.length > 0
  ) {
    fail('STRICT_TEST_REQUIRED_FACT_APPLICABILITY_INVALID', 'unknown/unsupported/hash mismatch');
  }
  for (const row of universe.rows) {
    if (
      !row.applicabilityId ||
      !row.scopeId ||
      row.evidenceRefs.length === 0 ||
      (row.status === 'required' && row.reasonCode !== null) ||
      (row.status !== 'required' && !row.reasonCode)
    ) {
      fail('STRICT_TEST_REQUIRED_FACT_APPLICABILITY_INVALID', row.applicabilityId);
    }
  }
}

function validateFactQueryCatalog(catalog: FactQueryCatalogSnapshotV1): void {
  const semantic = {
    schemaVersion: 1 as const,
    capabilities: catalog.capabilities,
    families: catalog.families,
  };
  if (
    catalog.families.length === 0 ||
    catalog.capabilities.length === 0 ||
    new Set(catalog.families.map((family) => family.id)).size !== catalog.families.length ||
    new Set(catalog.capabilities).size !== catalog.capabilities.length ||
    canonicalJsonStringify(catalog.capabilities) !==
      canonicalJsonStringify(
        [...new Set(catalog.families.map((family) => family.capabilityId))].sort()
      ) ||
    catalog.catalogHash !== hashCanonicalJson(semantic)
  ) {
    fail('STRICT_TEST_FACT_QUERY_BACKEND_INVALID', 'catalog');
  }
  for (const family of catalog.families) {
    if (
      !family.id ||
      !family.capabilityId ||
      !family.loadedProducer ||
      family.supportedScales.length === 0 ||
      !family.queryPackHash
    ) {
      fail('STRICT_TEST_FACT_QUERY_BACKEND_UNSUPPORTED', family.id);
    }
    for (const hash of [
      family.queryPackHash,
      family.producerManifestHash,
      family.loadReceiptHash,
      family.positiveFixtureHash,
      family.negativeFixtureHash,
      family.edgeFixtureHash,
    ]) {
      requireSha(hash, 'STRICT_TEST_FACT_QUERY_BACKEND_INVALID');
    }
  }
}

function buildDimensionResult(
  dimensionId: string,
  cells: readonly PlanCellV1[]
): StrictTestDimensionPreflightResultV1 {
  const dimensionCells = cells.filter((cell) => cell.dimensionId === dimensionId);
  const eligible = dimensionCells.filter((cell) => cell.status === 'eligible');
  const excluded = dimensionCells.filter((cell) => cell.status === 'excluded');
  let status: StrictTestDimensionApplicabilityV1 = 'unknown';
  let reasonCode = 'DIMENSION_APPLICABILITY_UNKNOWN';
  if (eligible.length > 0 && eligible.length + excluded.length === dimensionCells.length) {
    status = 'applicable';
    reasonCode = 'ELIGIBLE_CELLS_PRESENT';
  } else if (
    dimensionCells.length > 0 &&
    excluded.length === dimensionCells.length &&
    excluded.every((cell) => Boolean(cell.exclusionReason) && cell.evidenceRefs.length > 0)
  ) {
    status = 'excluded';
    reasonCode = 'ALL_MODULE_CELLS_TYPED_EXCLUDED';
  }
  const evidenceRefs = normalizeStrings(dimensionCells.flatMap((cell) => cell.evidenceRefs));
  const semantic = {
    dimensionId,
    status,
    reasonCode,
    evidenceRefs,
    eligibleCellIds: eligible.map((cell) => cell.cellId),
    excludedCellIds: excluded.map((cell) => cell.cellId),
    eligibleCellCount: eligible.length,
    excludedCellCount: excluded.length,
    requiredFactsSupported: true,
  };
  return freezeDeep({ ...semantic, dimensionCellSetHash: hashCanonicalJson(dimensionCells) });
}

function buildRecommendation(
  applicable: readonly StrictTestDimensionPreflightResultV1[]
): StrictTestDimensionRecommendationV1 {
  const architecture = applicable.find(
    (row) =>
      row.dimensionId === 'architecture' && row.eligibleCellCount > 0 && row.requiredFactsSupported
  );
  const selected = architecture ?? applicable[0];
  if (!selected) {
    fail('STRICT_TEST_PREFLIGHT_EMPTY_APPLICABLE_UNIVERSE', 'recommendation');
  }
  const semantic = {
    dimensionId: selected.dimensionId,
    reasonCode: architecture
      ? ('ARCHITECTURE_APPLICABLE_AND_SUPPORTED' as const)
      : ('FIRST_EVIDENCE_SUPPORTED_APPLICABLE_DIMENSION' as const),
    evidenceRefs: selected.evidenceRefs,
    alternativeDimensionIds: applicable
      .filter((row) => row.dimensionId !== selected.dimensionId)
      .map((row) => row.dimensionId),
  };
  return freezeDeep({ ...semantic, recommendationHash: hashCanonicalJson(semantic) });
}

function validatePreflightBindings(bindings: StrictTestPreflightBindingsV1): void {
  assertExactKeys(bindings, PREFLIGHT_BINDING_KEYS, 'STRICT_TEST_PREFLIGHT_BINDINGS_INVALID');
  if (bindings.schemaVersion !== 1 || bindings.profile !== STRICT_TEST_DIMENSION_PROFILE_V1) {
    fail('STRICT_TEST_PROFILE_INVALID', String(bindings.profile));
  }
  for (const value of [
    bindings.demandKey,
    bindings.runId,
    bindings.projectRootIdentity,
    bindings.controlRootIdentity,
    bindings.sourceRootIdentity,
  ]) {
    requireText(value, 'STRICT_TEST_PREFLIGHT_BINDINGS_INVALID');
  }
  for (const count of [
    bindings.sourceFileCount,
    bindings.moduleCount,
    bindings.languageCount,
    bindings.parserCount,
    bindings.backendCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 1) {
      fail('STRICT_TEST_PREFLIGHT_EMPTY_SOURCE_UNIVERSE', `${count}`);
    }
  }
  for (const hash of PREFLIGHT_BINDING_KEYS.filter((key) => key.endsWith('Hash')).map(
    (key) => bindings[key]
  )) {
    requireSha(hash, 'STRICT_TEST_PREFLIGHT_BINDINGS_INVALID');
  }
  requireTimestamp(bindings.generatedAt, 'STRICT_TEST_PREFLIGHT_BINDINGS_INVALID');
  if (bindings.validUntil !== null) {
    requireTimestamp(bindings.validUntil, 'STRICT_TEST_PREFLIGHT_BINDINGS_INVALID');
    if (Date.parse(bindings.validUntil) <= Date.parse(bindings.generatedAt)) {
      fail('STRICT_TEST_PREFLIGHT_BINDINGS_INVALID', 'validUntil');
    }
  }
  if (
    bindings.certifiedProjectFactsSourceVectorHash !== bindings.sourceRevisionVectorHash ||
    bindings.productionBeforeStateHash !== bindings.productionAfterReadStateHash
  ) {
    fail('STRICT_TEST_FACTS_LINEAGE_MISMATCH', 'source vector or before-state');
  }
}

function buildDriftFields(
  plan: CompiledColdStartPlanV2,
  bindings: StrictTestPreflightBindingsV1
): object {
  return {
    demandKey: bindings.demandKey,
    runId: bindings.runId,
    roots: [
      bindings.projectRootIdentity,
      bindings.controlRootIdentity,
      bindings.sourceRootIdentity,
    ],
    canonicalProjectIdentityHash: bindings.canonicalProjectIdentityHash,
    sourceRevisionVectorHash: bindings.sourceRevisionVectorHash,
    sourceInventoryHash: bindings.sourceInventoryHash,
    certifiedProjectFactsArtifactHash: bindings.certifiedProjectFactsArtifactHash,
    certifiedProjectFactsContentHash: bindings.certifiedProjectFactsContentHash,
    certifiedProjectFactsSourceArtifactHash: bindings.certifiedProjectFactsSourceArtifactHash,
    certifiedProjectFactsConsumerReceiptHash: bindings.certifiedProjectFactsConsumerReceiptHash,
    catalogHash: plan.catalog.catalogHash,
    catalogSourceArtifactHash: plan.catalog.sourceArtifactHash,
    applicabilityUniverseHash: plan.requiredFactApplicability.universeHash,
    factQueryCatalogHash: plan.factQueryCatalog.catalogHash,
    cellUniverseHash: plan.universe.cellUniverseHash,
    strictConfigReceiptHash: bindings.strictConfigReceiptHash,
    providerModelHash: bindings.providerModelHash,
    promptSopHash: bindings.promptSopHash,
    factQueryBackendHash: bindings.factQueryBackendHash,
    parserBackendHash: bindings.parserBackendHash,
    embeddingVectorHash: bindings.embeddingVectorHash,
    runtimeArtifactManifestHash: bindings.runtimeArtifactManifestHash,
    runtimeArtifactBindingHash: bindings.runtimeArtifactBindingHash,
    privateWorkspacePolicyHash: bindings.privateWorkspacePolicyHash,
  };
}

function preflightBindingsFromReceipt(
  receipt: StrictTestPreflightReceiptV1
): StrictTestPreflightBindingsV1 {
  return {
    schemaVersion: 1,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    demandKey: receipt.demandKey,
    runId: receipt.runId,
    projectRootIdentity: receipt.projectRootIdentity,
    controlRootIdentity: receipt.controlRootIdentity,
    sourceRootIdentity: receipt.sourceRootIdentity,
    canonicalProjectIdentityHash: receipt.canonicalProjectIdentityHash,
    sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
    sourceInventoryHash: receipt.sourceInventoryHash,
    sourceFileCount: receipt.sourceFileCount,
    moduleCount: receipt.moduleCount,
    languageCount: receipt.languageCount,
    parserCount: receipt.parserCount,
    backendCount: receipt.backendCount,
    certifiedProjectFactsArtifactHash: receipt.certifiedProjectFactsArtifactHash,
    certifiedProjectFactsContentHash: receipt.certifiedProjectFactsContentHash,
    certifiedProjectFactsSourceArtifactHash: receipt.certifiedProjectFactsSourceArtifactHash,
    certifiedProjectFactsSourceVectorHash: receipt.certifiedProjectFactsSourceVectorHash,
    certifiedProjectFactsConsumerReceiptHash: receipt.certifiedProjectFactsConsumerReceiptHash,
    strictConfigReceiptHash: receipt.strictConfigReceiptHash,
    providerModelHash: receipt.providerModelHash,
    promptSopHash: receipt.promptSopHash,
    factQueryBackendHash: receipt.factQueryBackendHash,
    parserBackendHash: receipt.parserBackendHash,
    embeddingVectorHash: receipt.embeddingVectorHash,
    runtimeArtifactManifestHash: receipt.runtimeArtifactManifestHash,
    runtimeArtifactBindingHash: receipt.runtimeArtifactBindingHash,
    productionBeforeStateHash: receipt.productionBeforeStateHash,
    productionAfterReadStateHash: receipt.productionAfterReadStateHash,
    publicRouteBeforeStateHash: receipt.publicRouteBeforeStateHash,
    officialRecipeBeforeStateHash: receipt.officialRecipeBeforeStateHash,
    privateWorkspacePolicyHash: receipt.privateWorkspacePolicyHash,
    generatedAt: receipt.generatedAt,
    validUntil: receipt.validUntil,
  };
}

function buildReceiptDriftFields(receipt: StrictTestPreflightReceiptV1): object {
  return {
    demandKey: receipt.demandKey,
    runId: receipt.runId,
    roots: [receipt.projectRootIdentity, receipt.controlRootIdentity, receipt.sourceRootIdentity],
    canonicalProjectIdentityHash: receipt.canonicalProjectIdentityHash,
    sourceRevisionVectorHash: receipt.sourceRevisionVectorHash,
    sourceInventoryHash: receipt.sourceInventoryHash,
    certifiedProjectFactsArtifactHash: receipt.certifiedProjectFactsArtifactHash,
    certifiedProjectFactsContentHash: receipt.certifiedProjectFactsContentHash,
    certifiedProjectFactsSourceArtifactHash: receipt.certifiedProjectFactsSourceArtifactHash,
    certifiedProjectFactsConsumerReceiptHash: receipt.certifiedProjectFactsConsumerReceiptHash,
    catalogHash: receipt.catalog.catalogHash,
    catalogSourceArtifactHash: receipt.catalog.sourceArtifactHash,
    applicabilityUniverseHash: receipt.requiredFactApplicabilityUniverseHash,
    factQueryCatalogHash: receipt.factQueryCatalogHash,
    cellUniverseHash: receipt.fullCellUniverseHash,
    strictConfigReceiptHash: receipt.strictConfigReceiptHash,
    providerModelHash: receipt.providerModelHash,
    promptSopHash: receipt.promptSopHash,
    factQueryBackendHash: receipt.factQueryBackendHash,
    parserBackendHash: receipt.parserBackendHash,
    embeddingVectorHash: receipt.embeddingVectorHash,
    runtimeArtifactManifestHash: receipt.runtimeArtifactManifestHash,
    runtimeArtifactBindingHash: receipt.runtimeArtifactBindingHash,
    privateWorkspacePolicyHash: receipt.privateWorkspacePolicyHash,
  };
}

function validatePrivateCompletionBindings(input: {
  readonly preflight: StrictTestPreflightReceiptV1;
  readonly projection: StrictTestDimensionExecutionProjectionV1;
  readonly finalCoverageBinding: FinalCoverageBindingReceiptV1;
  readonly servingSnapshotManifest: ServingSnapshotManifestV1;
  readonly privateG4ReceiptHash: CanonicalSha256;
  readonly privateServingValidationHash: CanonicalSha256;
  readonly productionAfterStateHash: CanonicalSha256;
  readonly publicRouteAfterStateHash: CanonicalSha256;
  readonly privateEvidenceRefs: readonly string[];
  readonly completedAt: string;
}): void {
  requireTimestamp(input.completedAt, 'STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID');
  requireSha(input.privateG4ReceiptHash, 'STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID');
  requireSha(input.privateServingValidationHash, 'STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID');
  validateFinalCoverageBindingShape(input.finalCoverageBinding, input.projection.executionCellIds);
  validateServingSnapshotManifestShape(input.servingSnapshotManifest);
  if (input.privateEvidenceRefs.length === 0) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID', 'private evidence');
  }
  if (normalizeStrings(input.privateEvidenceRefs).length === 0) {
    fail('STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID', 'private evidence');
  }
  for (const hash of [
    input.finalCoverageBinding.candidateCoverageReceiptHash,
    input.finalCoverageBinding.candidateCellSetHash,
    input.finalCoverageBinding.g4ReceiptHash,
    input.finalCoverageBinding.candidateDataManifestHash,
    input.finalCoverageBinding.receiptHash,
    input.servingSnapshotManifest.finalCoverageBindingHash,
    input.servingSnapshotManifest.servingSnapshotValidationHash,
    input.servingSnapshotManifest.vectorManifestHash,
    input.servingSnapshotManifest.certifiedProjectFactsHash,
    input.servingSnapshotManifest.sourceRevisionVectorHash,
    input.servingSnapshotManifest.analysisFixpointHash,
    input.servingSnapshotManifest.manifestHash,
  ]) {
    requireSha(hash, 'STRICT_TEST_PRIVATE_TERMINAL_FIELDS_INVALID');
  }
  const finalCoverageSemantic = omitHash(input.finalCoverageBinding, 'receiptHash');
  const servingSemantic = omitHash(input.servingSnapshotManifest, 'manifestHash');
  const selectedCellIds = input.finalCoverageBinding.cells.map((cell) => cell.cellId);
  if (
    input.finalCoverageBinding.receiptHash !== hashCanonicalJson(finalCoverageSemantic) ||
    input.servingSnapshotManifest.manifestHash !== hashCanonicalJson(servingSemantic) ||
    canonicalJsonStringify(selectedCellIds) !==
      canonicalJsonStringify(input.projection.executionCellIds) ||
    input.finalCoverageBinding.candidateCellSetHash !==
      hashCanonicalJson(input.projection.executionCellIds) ||
    input.finalCoverageBinding.g4ReceiptHash !== input.privateG4ReceiptHash ||
    input.servingSnapshotManifest.finalCoverageBindingHash !==
      input.finalCoverageBinding.receiptHash ||
    input.servingSnapshotManifest.candidateDataManifestHash !==
      input.finalCoverageBinding.candidateDataManifestHash ||
    input.servingSnapshotManifest.servingSnapshotValidationHash !==
      input.privateServingValidationHash ||
    input.servingSnapshotManifest.certifiedProjectFactsHash !==
      input.preflight.certifiedProjectFactsContentHash ||
    input.servingSnapshotManifest.sourceRevisionVectorHash !==
      input.preflight.sourceRevisionVectorHash ||
    input.finalCoverageBinding.cells.some(
      (cell) => cell.finalDisposition === 'failed' || cell.finalDisposition === 'unknown'
    )
  ) {
    fail('STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID', 'G4/final coverage/serving');
  }
  if (
    input.productionAfterStateHash !== input.preflight.productionBeforeStateHash ||
    input.publicRouteAfterStateHash !== input.preflight.publicRouteBeforeStateHash
  ) {
    fail('STRICT_TEST_PRODUCTION_MUTATION_DETECTED', 'completion');
  }
}

/**
 * Final coverage 的 candidate receipt 本体由外层私有流水线持有，Core 在此仍可完整重放其
 * durable binding 可见的不变量：字段集合、终态、排序、选中 cell 分母与自哈希。这样即使
 * 调用方重算 receiptHash，也不能替换或删减 strict-test projection 的执行 cell。
 */
function validateFinalCoverageBindingShape(
  binding: FinalCoverageBindingReceiptV1,
  executionCellIds: readonly string[]
): void {
  assertExactKeys(
    binding,
    FINAL_COVERAGE_BINDING_KEYS,
    'STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID'
  );
  if (
    binding.schemaVersion !== 1 ||
    binding.cells.length === 0 ||
    new Set(binding.cells.map((cell) => cell.cellId)).size !== binding.cells.length ||
    binding.candidateCellSetHash !== hashCanonicalJson(executionCellIds) ||
    canonicalJsonStringify(binding.cells.map((cell) => cell.cellId)) !==
      canonicalJsonStringify(executionCellIds)
  ) {
    fail('STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID', 'final coverage cell universe');
  }
  for (const hash of [
    binding.candidateCoverageReceiptHash,
    binding.candidateCellSetHash,
    binding.g4ReceiptHash,
    binding.candidateDataManifestHash,
    binding.receiptHash,
  ]) {
    requireSha(hash, 'STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID');
  }
  for (const cell of binding.cells) {
    assertExactKeys(cell, FINAL_COVERAGE_CELL_KEYS, 'STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID');
    requireText(cell.cellId, 'STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID');
    const normalizedRecipeIds = normalizeStrings(cell.finalRecipeIds);
    const normalizedFingerprints = normalizeStrings(cell.finalRecipeFingerprints);
    if (
      canonicalJsonStringify(cell.finalRecipeIds) !== canonicalJsonStringify(normalizedRecipeIds) ||
      canonicalJsonStringify(cell.finalRecipeFingerprints) !==
        canonicalJsonStringify(normalizedFingerprints) ||
      (cell.finalDisposition !== 'covered-by-ready-recipe' &&
        cell.finalDisposition !== 'investigated-empty') ||
      (cell.finalDisposition === 'covered-by-ready-recipe' &&
        (cell.finalRecipeIds.length === 0 ||
          cell.finalRecipeIds.length !== cell.finalRecipeFingerprints.length)) ||
      (cell.finalDisposition === 'investigated-empty' &&
        (cell.finalRecipeIds.length !== 0 || cell.finalRecipeFingerprints.length !== 0))
    ) {
      fail('STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID', `final coverage ${cell.cellId}`);
    }
  }
}

/**
 * 复用正式 serving manifest constructor，而不是在 strict-test 分支复制一个较弱校验器。
 * constructor 会强制 snapshotId ↔ candidateDataManifestHash、精确字段集与非空身份字段。
 */
function validateServingSnapshotManifestShape(manifest: ServingSnapshotManifestV1): void {
  const { schemaVersion, manifestHash: _manifestHash, ...input } = manifest;
  if (schemaVersion !== 1) {
    fail('SERVING_SNAPSHOT_FIELDS_INVALID', 'schemaVersion');
  }
  const rebuilt = createServingSnapshotManifestV1(input);
  if (canonicalJsonStringify(rebuilt) !== canonicalJsonStringify(manifest)) {
    fail('SERVING_SNAPSHOT_FIELDS_INVALID', 'manifestHash');
  }
}

function strictTestForbiddenConclusions(): readonly string[] {
  return Object.freeze([
    'full-production-coverage',
    'production-finalized',
    'public-route-published',
    'unselected-dimensions-completed',
    'strict-production-accepted',
  ]);
}

function omitHash<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const result = { ...value };
  delete result[key];
  return result;
}

function assertExactKeys(value: object, expected: readonly PropertyKey[], code: string): void {
  const actual = Reflect.ownKeys(value).sort((left, right) =>
    String(left).localeCompare(String(right))
  );
  const normalizedExpected = [...expected].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
  if (canonicalJsonStringify(actual) !== canonicalJsonStringify(normalizedExpected)) {
    fail(code, 'unknown/missing fields');
  }
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function requireText(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, 'text');
  }
}

function requireSha(value: unknown, code: string): asserts value is CanonicalSha256 {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail(code, 'canonical sha256');
  }
}

function requireTimestamp(value: string, code: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) {
    fail(code, 'timestamp');
  }
}

function setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
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

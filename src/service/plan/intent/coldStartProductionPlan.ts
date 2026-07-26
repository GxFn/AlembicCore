import { DIMENSION_REGISTRY, type UnifiedDimension } from '../../../domain/dimension/index.js';
import {
  ALL_DIMENSION_IDS,
  FRAMEWORK_DIM_IDS,
  LANGUAGE_DIM_IDS,
  SYNTHESIS_DIM_IDS,
  UNIVERSAL_DIM_IDS,
} from '../../../domain/dimension/UnifiedDimension.js';
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from '../../project-context/foundation/canonical.js';
import type { CanonicalSha256 } from '../../project-context/foundation/contracts.js';
import type { PlanIntent } from './contracts.js';

export const ANATOMY_LENS_IDS = [
  'structure-and-boundary',
  'entrypoint-and-contract',
  'dependency-call-data-control',
  'state-lifecycle-persistence',
  'error-recovery-concurrency',
  'configuration-build-migration',
  'api-protocol-usage',
  'cross-cutting-concern',
  'idiom-and-convention',
  'evolution-and-rationale',
] as const;

export type AnatomyLensId = (typeof ANATOMY_LENS_IDS)[number];
export type AnalysisScale =
  | 'source-range'
  | 'symbol'
  | 'file'
  | 'module'
  | 'package'
  | 'repository'
  | 'project';
export type DimensionClassification = 'universal' | 'language' | 'framework' | 'synthesis';

export interface DimensionCatalogSnapshotRowV1 {
  readonly id: string;
  readonly classification: DimensionClassification;
  readonly codeLayer: UnifiedDimension['layer'];
  readonly conditions: NonNullable<UnifiedDimension['conditions']>;
  readonly relatedRoles: readonly string[];
  readonly tier: number | null;
  readonly outputMode: UnifiedDimension['outputMode'];
  readonly evidenceMetadata: {
    readonly allowedKnowledgeTypes: readonly string[];
    readonly matchTopics: readonly string[];
    readonly matchCategories: readonly string[];
  };
  readonly qualityMetadata: {
    readonly description: string;
    readonly weight: number;
  };
}

export interface DimensionCatalogSnapshotV1 {
  readonly schemaVersion: 1;
  readonly canonicalizerVersion: 'canonical-json-v1';
  readonly dimensions: readonly DimensionCatalogSnapshotRowV1[];
  readonly sourceArtifactHash: CanonicalSha256;
  readonly catalogHash: CanonicalSha256;
}

export interface AnatomyLensCatalogRowV1 {
  readonly id: AnatomyLensId;
  readonly question: string;
  readonly analysisScales: readonly AnalysisScale[];
  readonly factFamilyIds: readonly string[];
  readonly capabilityIds: readonly string[];
}

export interface AnatomyLensCatalogSnapshotV1 {
  readonly schemaVersion: 1;
  readonly lenses: readonly AnatomyLensCatalogRowV1[];
  readonly catalogHash: CanonicalSha256;
}

export type RequiredFactApplicabilityStatus = 'required' | 'typed-excluded' | 'unsupported-blocked';

export interface RequiredFactApplicabilityRowV1 {
  readonly applicabilityId: string;
  readonly scopeId: string;
  readonly anatomyLensId: AnatomyLensId;
  readonly status: RequiredFactApplicabilityStatus;
  readonly analysisScales: readonly AnalysisScale[];
  readonly factFamilyIds: readonly string[];
  readonly capabilityIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string | null;
}

export interface RequiredFactApplicabilityUniverseV1 {
  readonly schemaVersion: 1;
  readonly rows: readonly RequiredFactApplicabilityRowV1[];
  readonly universeCount: number;
  readonly requiredCount: number;
  readonly typedExcludedCount: number;
  readonly unsupportedBlockedCount: number;
  readonly universeHash: CanonicalSha256;
  readonly requiredHash: CanonicalSha256;
  readonly exclusionsHash: CanonicalSha256;
}

export interface ModulePlanningFactsV1 {
  readonly moduleId: string;
  readonly scopeId: string;
  readonly relativePath: string;
  readonly moduleClass: string;
  readonly ownedProductionFileCount: number;
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly roles: readonly string[];
  readonly entrypointRefs: readonly string[];
  readonly publicSurfaceRefs: readonly string[];
  readonly crossRepoEdgeRefs: readonly string[];
  readonly boundaryRefs: readonly string[];
  readonly generatedOrScript?: boolean;
  readonly displayOnlyAggregate?: boolean;
  readonly supportScope?: boolean;
  readonly ownership: {
    readonly origin: string;
    readonly confidence: number;
    readonly evidenceRefs: readonly string[];
  };
}

export interface CertifiedPlanningFactsV1 {
  readonly schemaVersion: 1;
  readonly factsHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly sourceArtifactHash: string;
  readonly modules: readonly ModulePlanningFactsV1[];
}

export interface PlanningRoleVocabularyV1 {
  readonly schemaVersion: 1;
  readonly mappings: Readonly<Record<string, readonly string[]>>;
  readonly sourceArtifactHash: CanonicalSha256;
  readonly vocabularyHash: CanonicalSha256;
}

export interface CoveragePlanPolicyV1 {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly batchBarrierVersion: string;
  readonly semanticRepairLimit: 2;
  readonly roleVocabulary: PlanningRoleVocabularyV1;
}

export const STRICT_AUTHORING_POLICY_V1 = Object.freeze({
  policy: 'evidence-bounded-no-floor' as const,
  candidateAttempts: 'upper-bound-only' as const,
  authoredCandidates: 'zero-to-many' as const,
  quantityFloor: null,
  semanticRepairLimit: 2 as const,
  batchFailureMode: 'whole-batch' as const,
});

export function createPlanningRoleVocabularyV1(
  sourceArtifactHash: CanonicalSha256,
  mappingsInput: Readonly<Record<string, readonly string[]>>
): PlanningRoleVocabularyV1 {
  if (!isCanonicalSha256(sourceArtifactHash)) {
    fail('PLAN_ROLE_VOCABULARY_INVALID', 'source artifact hash');
  }
  const mappings = Object.fromEntries(
    Object.entries(mappingsInput)
      .map(([moduleClass, roles]) => [moduleClass.trim(), normalizeStrings(roles)] as const)
      .filter(([moduleClass]) => moduleClass.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  if (
    Object.keys(mappings).length !== Object.keys(mappingsInput).length ||
    Object.values(mappings).some((roles) => roles.length === 0)
  ) {
    fail('PLAN_ROLE_VOCABULARY_INVALID', 'empty or duplicate mapping');
  }
  const semantic = { schemaVersion: 1 as const, mappings, sourceArtifactHash };
  return freezeDeep({ ...semantic, vocabularyHash: hashCanonicalJson(semantic) });
}

export type StrictColdStartConfigField =
  | 'candidateAttemptCap'
  | 'maxAuthoredCandidatesPerCellPass'
  | 'providerRequestCap'
  | 'detailRequestCap'
  | 'tokenCap'
  | 'timeMsCap'
  | 'costMicrousdCap'
  | 'factQueryObligationCap'
  | 'moduleWireBound'
  | 'cellWireBound';

export interface StrictConfigValueProvenanceV1 {
  readonly source: string;
  readonly loadHash: CanonicalSha256;
  readonly schemaBound: readonly [number, number];
}

export interface ResolvedStrictColdStartConfigReceiptV1 {
  readonly schemaVersion: 1;
  readonly loadHash: CanonicalSha256;
  readonly sourceArtifactHash: CanonicalSha256;
  readonly strictColdStart: Readonly<Record<StrictColdStartConfigField, number>>;
  readonly provenance: Readonly<Record<StrictColdStartConfigField, StrictConfigValueProvenanceV1>>;
}

export interface StrictColdStartConfigProjectionInputV1 {
  readonly sourceArtifactHash: CanonicalSha256;
  readonly strictColdStart: Readonly<Record<StrictColdStartConfigField, number>>;
  readonly fieldSources: Readonly<Record<StrictColdStartConfigField, string>>;
}

export interface PlanQuestionBudgetV1 {
  readonly initialBreadth: number;
  readonly expansionReserve: number;
  readonly counterqueryReserve: number;
  readonly starvationGuard: number;
}

export interface PlanInvestigationQuestionV1 {
  readonly questionId: string;
  readonly subquestionIds: readonly string[];
  readonly anatomyLensIds: readonly string[];
  readonly subjectRefs: readonly string[];
  readonly analysisScales: readonly AnalysisScale[];
  readonly capabilityIds: readonly string[];
  readonly queryFamilyIds: readonly string[];
  readonly expectedSupport: readonly string[];
  readonly expectedCounterevidence: readonly string[];
  readonly synthesisTarget: string;
  readonly uncertainty: string;
  readonly stopCondition: string;
  readonly escalationCondition: string;
  readonly priority: 'critical' | 'high' | 'standard' | 'support';
  readonly budget: PlanQuestionBudgetV1;
}

export interface PlanInvestigationDecompositionV1 {
  readonly schemaVersion: 1;
  readonly questions: readonly PlanInvestigationQuestionV1[];
}

export interface PlanBudgetStrategyV1 {
  readonly schemaVersion: 1;
  readonly providerRequests: number;
  readonly detailRequests: number;
  readonly tokens: number;
  readonly timeMs: number;
  readonly costMicrousd: number;
}

export interface StrictPlanIntentV1 extends PlanIntent {
  readonly investigationDecomposition?: PlanInvestigationDecompositionV1;
  readonly budgetStrategy?: PlanBudgetStrategyV1;
  /** Plan-owned, frozen prerequisite IDs for every synthesis cell. */
  readonly synthesisPrerequisiteCellIds?: Readonly<Record<string, readonly string[]>>;
}

export interface PlanCognitionInvocationV1 {
  readonly invocationId: string;
  readonly parentInvocationId?: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly reason?: string;
  readonly modelHash: string;
  readonly promptHash: string;
}

export interface PlanCognitionLineageV1 {
  readonly schemaVersion: 1;
  readonly initial: PlanCognitionInvocationV1;
  readonly repairs: readonly PlanCognitionInvocationV1[];
  readonly transportRetryCount: number;
}

export interface PlanCognitionReceiptV1 {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly factsHash: string;
  readonly catalogHash: string;
  readonly intent: StrictPlanIntentV1;
  readonly lineage: PlanCognitionLineageV1;
  readonly validatorVerdict: 'accepted' | 'revise' | 'rejected';
}

export interface FactQueryFamilyV1 {
  readonly id: string;
  readonly capabilityId: string;
  readonly supportedScales: readonly AnalysisScale[];
  /** Strict executor query/occurrence pack identity; legacy catalogs may omit it and cannot execute strictly. */
  readonly queryPackHash?: CanonicalSha256;
  readonly loadedProducer: string;
  readonly producerManifestHash: CanonicalSha256;
  readonly loadReceiptHash: CanonicalSha256;
  readonly positiveFixtureHash: CanonicalSha256;
  readonly negativeFixtureHash: CanonicalSha256;
  readonly edgeFixtureHash: CanonicalSha256;
}

export interface FactQueryCatalogSnapshotV1 {
  readonly schemaVersion: 1;
  readonly capabilities: readonly string[];
  readonly families: readonly FactQueryFamilyV1[];
  readonly catalogHash: CanonicalSha256;
}

export type CellExclusionReason =
  | 'GENERATED_OR_SCRIPT'
  | 'DISPLAY_AGGREGATE'
  | 'NO_OWNED_PRODUCTION_FILES'
  | 'ROLE_NOT_APPLICABLE'
  | 'LANGUAGE_NOT_APPLICABLE'
  | 'FRAMEWORK_NOT_APPLICABLE'
  | 'SYNTHESIS_PREREQUISITE_INSUFFICIENT'
  | 'REQUIRED_FACT_MISSING';

export interface PlanCellV1 {
  readonly cellId: string;
  readonly moduleId: string;
  readonly scopeId: string;
  readonly dimensionId: string;
  readonly criticality: 'critical' | 'standard' | 'non-critical';
  readonly status: 'eligible' | 'excluded';
  readonly exclusionReason?: CellExclusionReason;
  readonly evidenceRefs: readonly string[];
  readonly synthesisPrerequisiteCellIds: readonly string[];
}

export interface ColdStartCellUniverseV1 {
  readonly cells: readonly PlanCellV1[];
  readonly universeCount: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly cellUniverseHash: CanonicalSha256;
  readonly eligibleCellsHash: CanonicalSha256;
  readonly excludedCellsHash: CanonicalSha256;
}

export interface FactHarvestObligationV1 {
  readonly obligationId: string;
  readonly factFamilyId: string;
  readonly capabilityId: string;
  readonly canonicalSubjectRef: string;
  readonly analysisScale: AnalysisScale;
  readonly denominator: 'complete-frozen-subject';
  readonly source: 'required-universe' | 'accepted-plan-addition';
}

export interface LensBindingV1 {
  readonly bindingId: string;
  readonly cellId: string;
  readonly anatomyLensId: AnatomyLensId;
  readonly questionIds: readonly string[];
  readonly factFamilyIds: readonly string[];
  readonly counterqueryRequired: boolean;
}

export interface MiningWorkScheduleV1 {
  readonly schemaVersion: 1;
  readonly factHarvestObligations: readonly FactHarvestObligationV1[];
  readonly lensBindings: readonly LensBindingV1[];
  readonly factHarvestScheduleHash: CanonicalSha256;
  readonly lensBindingsHash: CanonicalSha256;
  readonly baselineScheduleHash: CanonicalSha256;
}

export interface ColdStartPlanSelectionV2 {
  readonly schemaVersion: 2;
  readonly kind: 'cold-start-upper-cap';
  readonly generationStage: 'coldStart';
  readonly moduleIds: readonly string[];
  readonly dimensionIds: readonly string[];
  readonly eligibleCellIds: readonly string[];
  readonly excludedCellIds: readonly string[];
  readonly candidateAttemptCap: number;
  readonly maxAuthoredCandidatesPerCellPass: number;
  readonly semanticRepairLimit: 2;
  readonly batchBarrierVersion: string;
  readonly policyVersion: string;
  readonly policyHash: CanonicalSha256;
  readonly modulePlanningFactsHash: CanonicalSha256;
  readonly sourceArtifactHash: string;
  readonly strictConfigReceiptHash: CanonicalSha256;
  readonly authoringPolicy: typeof STRICT_AUTHORING_POLICY_V1;
  readonly deferredCells: readonly [];
  readonly resourceCaps: Omit<
    ResolvedStrictColdStartConfigReceiptV1['strictColdStart'],
    'candidateAttemptCap' | 'maxAuthoredCandidatesPerCellPass' | 'moduleWireBound' | 'cellWireBound'
  >;
}

export interface OrderedInvestigationActionV2 {
  readonly actionId: string;
  readonly questionId: string;
  readonly dependsOnQuestionIds: readonly string[];
  readonly anatomyLensIds: readonly string[];
  readonly subjectRefs: readonly string[];
  readonly analysisScales: readonly AnalysisScale[];
  readonly capabilityId: string;
  readonly queryFamilyId: string;
  readonly expectedSupport: readonly string[];
  readonly expectedCounterevidence: readonly string[];
  readonly synthesisTarget: string;
  readonly uncertainty: string;
  readonly priority: PlanInvestigationQuestionV1['priority'];
  readonly stopCondition: string;
  readonly escalationCondition: string;
  readonly budget: PlanQuestionBudgetV1;
}

export interface ColdStartExecutionProjectionV2 {
  readonly schemaVersion: 2;
  readonly factsBindingHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly planCognitionHash: CanonicalSha256;
  readonly orderedDimensionIds: readonly string[];
  readonly orderedCells: readonly string[];
  readonly orderedInvestigationActions: readonly OrderedInvestigationActionV2[];
  readonly anatomyApplicabilityHash: CanonicalSha256;
  readonly lensBindingsHash: CanonicalSha256;
  readonly factHarvestScheduleHash: CanonicalSha256;
  readonly factQueryCatalogHash: CanonicalSha256;
  readonly moduleScope: readonly string[];
  readonly synthesisPrerequisites: Readonly<Record<string, readonly string[]>>;
  readonly resourceCaps: ColdStartPlanSelectionV2['resourceCaps'];
}

export interface CompiledColdStartPlanV2 {
  readonly schemaVersion: 2;
  readonly compilerVersion: 'cold-start-plan-compiler-v2';
  readonly catalog: DimensionCatalogSnapshotV1;
  readonly anatomy: AnatomyLensCatalogSnapshotV1;
  readonly requiredFactApplicability: RequiredFactApplicabilityUniverseV1;
  readonly factQueryCatalog: FactQueryCatalogSnapshotV1;
  readonly universe: ColdStartCellUniverseV1;
  readonly schedule: MiningWorkScheduleV1;
  readonly selection: ColdStartPlanSelectionV2;
  readonly execution: ColdStartExecutionProjectionV2;
  readonly canonicalPlanHash: CanonicalSha256;
}

const CLASSIFICATION_IDS: Readonly<Record<DimensionClassification, readonly string[]>> = {
  universal: UNIVERSAL_DIM_IDS,
  language: LANGUAGE_DIM_IDS,
  framework: FRAMEWORK_DIM_IDS,
  synthesis: SYNTHESIS_DIM_IDS,
};

const ANATOMY_LENS_DEFINITIONS: readonly AnatomyLensCatalogRowV1[] = [
  anatomy(
    'structure-and-boundary',
    'What are the real ownership and public boundaries?',
    ['module', 'package', 'repository', 'project'],
    ['architecture-dependency'],
    ['certified-project-context']
  ),
  anatomy(
    'entrypoint-and-contract',
    'Where do execution and API contracts begin?',
    ['symbol', 'module', 'repository'],
    ['architecture-dependency', 'api-protocol'],
    ['certified-project-context']
  ),
  anatomy(
    'dependency-call-data-control',
    'How do dependencies, calls, values and control move?',
    ['source-range', 'symbol', 'module', 'project'],
    ['architecture-dependency', 'api-protocol'],
    ['certified-project-context']
  ),
  anatomy(
    'state-lifecycle-persistence',
    'What state exists and how does it transition and persist?',
    ['symbol', 'module', 'project'],
    ['lifecycle-error-invariant'],
    ['certified-project-context']
  ),
  anatomy(
    'error-recovery-concurrency',
    'How do failures, compensation, idempotency and races behave?',
    ['source-range', 'symbol', 'module', 'project'],
    ['lifecycle-error-invariant'],
    ['tree-sitter-query']
  ),
  anatomy(
    'configuration-build-migration',
    'Which configuration, build and migration facts alter behavior?',
    ['file', 'module', 'project'],
    ['config-build-test-migration'],
    ['certified-project-context']
  ),
  anatomy(
    'api-protocol-usage',
    'What call, order and resource protocol must a developer follow?',
    ['source-range', 'symbol', 'repository'],
    ['api-protocol'],
    ['tree-sitter-query']
  ),
  anatomy(
    'cross-cutting-concern',
    'Which concerns span modules and where are their anchors?',
    ['module', 'repository', 'project'],
    ['synthesis-cross-cutting'],
    ['certified-project-context']
  ),
  anatomy(
    'idiom-and-convention',
    'Which local implementation idioms recur?',
    ['symbol', 'module', 'repository'],
    ['syntax-idiom'],
    ['tree-sitter-query']
  ),
  anatomy(
    'evolution-and-rationale',
    'What accepted evidence explains a pattern?',
    ['symbol', 'repository'],
    ['history-fix-pattern'],
    ['certified-project-context']
  ),
];

export function buildDimensionCatalogSnapshot(): DimensionCatalogSnapshotV1 {
  const registryById = new Map(DIMENSION_REGISTRY.map((dimension) => [dimension.id, dimension]));
  const expected = new Set<string>(ALL_DIMENSION_IDS);
  if (
    registryById.size !== expected.size ||
    [...registryById.keys()].some((id) => !expected.has(id))
  ) {
    throw new Error('DIMENSION_CATALOG_DRIFT: registry must exactly match the accepted 26 IDs');
  }
  const dimensions = [...ALL_DIMENSION_IDS]
    .map((id) => {
      const dimension = registryById.get(id);
      if (!dimension) {
        throw new Error(`DIMENSION_CATALOG_DRIFT: missing ${id}`);
      }
      return normalizeDimensionRow(dimension, classifyDimension(id));
    })
    .sort(compareBy((row) => row.id));
  const sourceArtifactHash = hashCanonicalJson(
    DIMENSION_REGISTRY.map((dimension) =>
      normalizeDimensionRow(dimension, classifyDimension(dimension.id))
    ).sort(compareBy((row) => row.id))
  );
  const semantic = {
    schemaVersion: 1 as const,
    canonicalizerVersion: 'canonical-json-v1' as const,
    dimensions,
    sourceArtifactHash,
  };
  return freezeDeep({ ...semantic, catalogHash: hashCanonicalJson(semantic) });
}

export function buildAnatomyLensCatalogSnapshot(): AnatomyLensCatalogSnapshotV1 {
  const lenses = [...ANATOMY_LENS_DEFINITIONS].map((lens) => ({ ...lens }));
  if (
    lenses.length !== ANATOMY_LENS_IDS.length ||
    new Set(lenses.map((lens) => lens.id)).size !== ANATOMY_LENS_IDS.length ||
    lenses.some((lens, index) => lens.id !== ANATOMY_LENS_IDS[index])
  ) {
    fail('ANATOMY_LENS_CATALOG_DRIFT', 'catalog must exactly match the accepted ten lenses');
  }
  return freezeDeep({ schemaVersion: 1, lenses, catalogHash: hashCanonicalJson(lenses) });
}

export function buildRequiredFactApplicabilityUniverseV1(
  modulesInput: readonly ModulePlanningFactsV1[],
  anatomy: AnatomyLensCatalogSnapshotV1,
  factQueryCatalog: FactQueryCatalogSnapshotV1
): RequiredFactApplicabilityUniverseV1 {
  const modules = validateAndNormalizeModules(modulesInput);
  const families = new Map(factQueryCatalog.families.map((family) => [family.id, family]));
  const capabilities = new Set(factQueryCatalog.capabilities);
  const rows = modules
    .flatMap((module) =>
      anatomy.lenses.map((lens) => {
        const typedExclusion = module.generatedOrScript
          ? 'GENERATED_OR_SCRIPT'
          : module.displayOnlyAggregate
            ? 'DISPLAY_AGGREGATE'
            : module.ownedProductionFileCount === 0
              ? 'NO_OWNED_PRODUCTION_FILES'
              : null;
        const backendMissing = lens.factFamilyIds.some((familyId) => {
          const family = families.get(familyId);
          return (
            !family ||
            !family.loadedProducer ||
            !capabilities.has(family.capabilityId) ||
            !family.supportedScales.some((scale) => lens.analysisScales.includes(scale))
          );
        });
        const status: RequiredFactApplicabilityStatus = typedExclusion
          ? 'typed-excluded'
          : backendMissing
            ? 'unsupported-blocked'
            : 'required';
        const semantic = {
          scopeId: module.scopeId,
          anatomyLensId: lens.id,
          status,
          analysisScales: [...lens.analysisScales].sort() as AnalysisScale[],
          factFamilyIds: [...lens.factFamilyIds].sort(),
          capabilityIds: [...lens.capabilityIds].sort(),
          evidenceRefs: normalizeStrings(module.ownership.evidenceRefs),
          reasonCode: typedExclusion ?? (backendMissing ? 'REQUIRED_BACKEND_UNAVAILABLE' : null),
        };
        return {
          applicabilityId: `applicability:${hashCanonicalJson(semantic).slice(7, 31)}`,
          ...semantic,
        };
      })
    )
    .sort(compareBy((row) => `${row.scopeId}\u0000${row.anatomyLensId}`));
  const required = rows.filter((row) => row.status === 'required');
  const exclusions = rows.filter((row) => row.status !== 'required');
  if (
    rows.length !== modules.length * ANATOMY_LENS_IDS.length ||
    new Set(rows.map((row) => `${row.scopeId}\u0000${row.anatomyLensId}`)).size !== rows.length
  ) {
    fail('REQUIRED_FACT_APPLICABILITY_CONSERVATION', 'scope × anatomy universe drift');
  }
  return freezeDeep({
    schemaVersion: 1,
    rows,
    universeCount: rows.length,
    requiredCount: required.length,
    typedExcludedCount: rows.filter((row) => row.status === 'typed-excluded').length,
    unsupportedBlockedCount: rows.filter((row) => row.status === 'unsupported-blocked').length,
    universeHash: hashCanonicalJson(rows),
    requiredHash: hashCanonicalJson(required),
    exclusionsHash: hashCanonicalJson(exclusions),
  });
}

export function buildFactQueryCatalogSnapshot(
  loadedFamilies: readonly FactQueryFamilyV1[]
): FactQueryCatalogSnapshotV1 {
  const families = loadedFamilies
    .map((family) => ({
      ...family,
      supportedScales: [...family.supportedScales].sort() as AnalysisScale[],
    }))
    .sort(compareBy((family) => family.id));
  const capabilities = [...new Set(families.map((family) => family.capabilityId))].sort();
  const semantic = { schemaVersion: 1 as const, capabilities, families };
  return freezeDeep({ ...semantic, catalogHash: hashCanonicalJson(semantic) });
}

export function createResolvedStrictColdStartConfigReceiptV1(
  input: StrictColdStartConfigProjectionInputV1
): ResolvedStrictColdStartConfigReceiptV1 {
  if (!isCanonicalSha256(input.sourceArtifactHash)) {
    fail('CONFIG_UNSUPPORTED', 'source artifact hash must be canonical sha256');
  }
  const strictColdStart = {} as Record<StrictColdStartConfigField, number>;
  const provenance = {} as Record<StrictColdStartConfigField, StrictConfigValueProvenanceV1>;
  for (const field of STRICT_CONFIG_FIELDS) {
    const value = input.strictColdStart[field];
    const source = input.fieldSources[field];
    const schemaBound = STRICT_CONFIG_SCHEMA_BOUNDS[field];
    if (
      !Number.isSafeInteger(value) ||
      value < schemaBound[0] ||
      value > schemaBound[1] ||
      typeof source !== 'string' ||
      source.trim().length === 0
    ) {
      fail('CONFIG_UNSUPPORTED', `invalid ${field}`);
    }
    strictColdStart[field] = value;
    provenance[field] = {
      source,
      schemaBound,
      loadHash: hashCanonicalJson({
        sourceArtifactHash: input.sourceArtifactHash,
        field,
        value,
        source,
        schemaBound,
      }),
    };
  }
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactHash: input.sourceArtifactHash,
    strictColdStart,
    provenance,
  };
  return freezeDeep({ ...semantic, loadHash: hashCanonicalJson(semantic) });
}

export function hashStrictPlanIntentV1(intent: StrictPlanIntentV1): CanonicalSha256 {
  return hashCanonicalJson(normalizeStrictPlanIntent(intent));
}

export function compileColdStartPlan(
  certifiedFacts: CertifiedPlanningFactsV1,
  registryPayload: DimensionCatalogSnapshotV1,
  policy: CoveragePlanPolicyV1,
  planCognition: PlanCognitionReceiptV1,
  resolvedStrictConfig: ResolvedStrictColdStartConfigReceiptV1,
  factQueryCatalog: FactQueryCatalogSnapshotV1
): CompiledColdStartPlanV2 {
  const catalog = validateAndNormalizeCatalog(registryPayload);
  const anatomy = buildAnatomyLensCatalogSnapshot();
  const modules = validateAndNormalizeModules(certifiedFacts.modules);
  validatePolicy(policy, modules);
  validateConfig(resolvedStrictConfig, modules.length, modules.length * catalog.dimensions.length);
  validateFactQueryCatalog(factQueryCatalog);
  const requiredFactApplicability = buildRequiredFactApplicabilityUniverseV1(
    modules,
    anatomy,
    factQueryCatalog
  );
  if (requiredFactApplicability.unsupportedBlockedCount > 0) {
    fail('FACT_QUERY_BACKEND_UNAVAILABLE', 'required applicability contains blocked backends');
  }
  validateCognition(
    planCognition,
    certifiedFacts,
    catalog,
    anatomy,
    modules,
    factQueryCatalog,
    resolvedStrictConfig,
    policy,
    requiredFactApplicability
  );
  const normalizedCognition = normalizePlanCognitionReceipt(planCognition);
  const universe = buildCellUniverse(modules, catalog, policy, normalizedCognition);
  const schedule = buildMiningSchedule(
    universe,
    modules,
    anatomy,
    requiredFactApplicability,
    factQueryCatalog,
    normalizedCognition
  );
  if (
    schedule.factHarvestObligations.length >
    resolvedStrictConfig.strictColdStart.factQueryObligationCap
  ) {
    fail('MINING_SCALE_UNSUPPORTED', 'complete baseline exceeds accepted fact/query bound');
  }
  const selection = buildSelection(
    universe,
    modules,
    catalog,
    policy,
    resolvedStrictConfig,
    certifiedFacts.sourceArtifactHash
  );
  const planCognitionHash = hashCanonicalJson(normalizedCognition);
  const execution = buildExecution(
    certifiedFacts,
    modules,
    universe,
    schedule,
    requiredFactApplicability,
    selection,
    normalizedCognition,
    planCognitionHash,
    factQueryCatalog
  );
  const semantic = {
    schemaVersion: 2 as const,
    compilerVersion: 'cold-start-plan-compiler-v2' as const,
    catalog,
    anatomy,
    requiredFactApplicability,
    factQueryCatalog: normalizeFactQueryCatalog(factQueryCatalog),
    universe,
    schedule,
    selection,
    execution,
  };
  return freezeDeep({ ...semantic, canonicalPlanHash: hashCanonicalJson(semantic) });
}

function validateAndNormalizeCatalog(
  catalog: DimensionCatalogSnapshotV1
): DimensionCatalogSnapshotV1 {
  const accepted = buildDimensionCatalogSnapshot();
  const rows = [...catalog.dimensions].sort(compareBy((row) => row.id));
  if (canonicalJsonStringify(rows) !== canonicalJsonStringify(accepted.dimensions)) {
    fail('DIMENSION_CATALOG_DRIFT', 'catalog rows do not match registry truth');
  }
  if (
    catalog.catalogHash !== accepted.catalogHash ||
    catalog.sourceArtifactHash !== accepted.sourceArtifactHash
  ) {
    fail('DIMENSION_CATALOG_DRIFT', 'catalog hashes do not match registry truth');
  }
  return accepted;
}

function validateAndNormalizeModules(
  rows: readonly ModulePlanningFactsV1[]
): ModulePlanningFactsV1[] {
  const seenModules = new Set<string>();
  const seenScopes = new Set<string>();
  return rows
    .map((row) => {
      requireText(row.moduleId, 'PLAN_FACT_MISSING', 'moduleId');
      requireText(row.scopeId, 'PLAN_FACT_MISSING', 'scopeId');
      requireText(row.relativePath, 'PLAN_FACT_MISSING', 'relativePath');
      requireText(row.moduleClass, 'PLAN_FACT_MISSING', 'moduleClass');
      if (!Number.isInteger(row.ownedProductionFileCount) || row.ownedProductionFileCount < 0) {
        fail('PLAN_FACT_MISSING', `invalid ownedProductionFileCount for ${row.moduleId}`);
      }
      if (seenModules.has(row.moduleId) || seenScopes.has(row.scopeId)) {
        fail('PLAN_FACT_DUPLICATE', `${row.moduleId}/${row.scopeId}`);
      }
      seenModules.add(row.moduleId);
      seenScopes.add(row.scopeId);
      if (!row.ownership.origin || row.ownership.evidenceRefs.length === 0) {
        fail('PLAN_FACT_MISSING', `ownership evidence for ${row.moduleId}`);
      }
      return freezeDeep({
        ...row,
        languages: normalizeStrings(row.languages),
        frameworks: normalizeStrings(row.frameworks),
        roles: normalizeStrings(row.roles),
        entrypointRefs: normalizeStrings(row.entrypointRefs),
        publicSurfaceRefs: normalizeStrings(row.publicSurfaceRefs),
        crossRepoEdgeRefs: normalizeStrings(row.crossRepoEdgeRefs),
        boundaryRefs: normalizeStrings(row.boundaryRefs),
        ownership: { ...row.ownership, evidenceRefs: normalizeStrings(row.ownership.evidenceRefs) },
      });
    })
    .sort(compareBy((row) => row.moduleId));
}

function validatePolicy(
  policy: CoveragePlanPolicyV1,
  modules: readonly ModulePlanningFactsV1[]
): void {
  if (policy.semanticRepairLimit !== 2 || !policy.policyVersion || !policy.batchBarrierVersion) {
    fail('PLAN_POLICY_UNSUPPORTED', 'semantic repair limit must be exactly 2');
  }
  const normalizedVocabulary = createPlanningRoleVocabularyV1(
    policy.roleVocabulary.sourceArtifactHash,
    policy.roleVocabulary.mappings
  );
  if (
    canonicalJsonStringify(normalizedVocabulary) !== canonicalJsonStringify(policy.roleVocabulary)
  ) {
    fail('PLAN_ROLE_VOCABULARY_INVALID', 'vocabulary hash or canonical mapping mismatch');
  }
  for (const module of modules) {
    if (
      module.ownedProductionFileCount > 0 &&
      !policy.roleVocabulary.mappings[module.moduleClass]
    ) {
      fail('PLAN_ROLE_VOCABULARY_MISSING', module.moduleClass);
    }
  }
}

function validateConfig(
  receipt: ResolvedStrictColdStartConfigReceiptV1,
  moduleCount: number,
  cellCount: number
): void {
  const reconstructed = createResolvedStrictColdStartConfigReceiptV1({
    sourceArtifactHash: receipt.sourceArtifactHash,
    strictColdStart: receipt.strictColdStart,
    fieldSources: Object.fromEntries(
      STRICT_CONFIG_FIELDS.map((field) => [field, receipt.provenance[field]?.source])
    ) as Record<StrictColdStartConfigField, string>,
  });
  if (canonicalJsonStringify(reconstructed) !== canonicalJsonStringify(receipt)) {
    fail('CONFIG_UNSUPPORTED', 'receipt provenance or load hash mismatch');
  }
  for (const field of STRICT_CONFIG_FIELDS) {
    const value = receipt.strictColdStart[field];
    const provenance = receipt.provenance[field];
    if (!Number.isSafeInteger(value) || value < 0 || !provenance?.source || !provenance.loadHash) {
      fail('CONFIG_UNSUPPORTED', `missing or invalid ${field}`);
    }
    if (value < provenance.schemaBound[0] || value > provenance.schemaBound[1]) {
      fail('CONFIG_UNSUPPORTED', `${field} outside accepted schema bound`);
    }
  }
  if (
    moduleCount > receipt.strictColdStart.moduleWireBound ||
    cellCount > receipt.strictColdStart.cellWireBound
  ) {
    fail('PLAN_SCALE_UNSUPPORTED', 'complete module/cell universe exceeds strict-v2 wire');
  }
}

function validateFactQueryCatalog(catalog: FactQueryCatalogSnapshotV1): void {
  const normalized = normalizeFactQueryCatalog(catalog);
  if (catalog.catalogHash !== normalized.catalogHash) {
    fail('FACT_QUERY_CATALOG_DRIFT', 'catalog hash mismatch');
  }
  const families = new Set<string>();
  const capabilityIds = new Set(normalized.capabilities);
  const referencedCapabilities = new Set<string>();
  for (const family of normalized.families) {
    if (families.has(family.id)) {
      fail('FACT_QUERY_CATALOG_DRIFT', `duplicate family ${family.id}`);
    }
    families.add(family.id);
    referencedCapabilities.add(family.capabilityId);
    if (
      !family.loadedProducer.startsWith('loaded:') ||
      !isCanonicalSha256(family.producerManifestHash) ||
      !isCanonicalSha256(family.loadReceiptHash) ||
      !isCanonicalSha256(family.positiveFixtureHash) ||
      !isCanonicalSha256(family.negativeFixtureHash) ||
      !isCanonicalSha256(family.edgeFixtureHash) ||
      !capabilityIds.has(family.capabilityId) ||
      family.supportedScales.length === 0 ||
      family.supportedScales.some((scale) => !ANALYSIS_SCALES.has(scale))
    ) {
      fail('FACT_QUERY_BACKEND_UNAVAILABLE', family.id);
    }
  }
  if (!setEquals(capabilityIds, referencedCapabilities)) {
    fail('FACT_QUERY_CATALOG_DRIFT', 'capability set must exactly match loaded producers');
  }
}

function validateCognition(
  receipt: PlanCognitionReceiptV1,
  facts: CertifiedPlanningFactsV1,
  catalog: DimensionCatalogSnapshotV1,
  anatomy: AnatomyLensCatalogSnapshotV1,
  modules: readonly ModulePlanningFactsV1[],
  queries: FactQueryCatalogSnapshotV1,
  config: ResolvedStrictColdStartConfigReceiptV1,
  policy: CoveragePlanPolicyV1,
  applicability: RequiredFactApplicabilityUniverseV1
): void {
  if (receipt.validatorVerdict !== 'accepted') {
    fail('PLAN_COGNITION_NOT_ACCEPTED', receipt.validatorVerdict);
  }
  if (receipt.factsHash !== facts.factsHash || receipt.catalogHash !== catalog.catalogHash) {
    fail('PLAN_COGNITION_STALE', 'facts or catalog hash mismatch');
  }
  if (receipt.intent.generationStage !== 'coldStart') {
    fail('PLAN_STAGE_UNSUPPORTED', receipt.intent.generationStage);
  }
  requireText(receipt.receiptId, 'PLAN_COGNITION_INVALID', 'receiptId');
  validateLineage(receipt.lineage, policy, receipt.intent);
  const decomposition = receipt.intent.investigationDecomposition;
  const budget = receipt.intent.budgetStrategy;
  if (!decomposition || !budget) {
    fail('PLAN_DECOMPOSITION_MISSING', 'strict cognition sections are required');
  }
  validateBudgetStrategy(budget, config);
  const questions = new Map<string, PlanInvestigationQuestionV1>();
  const subjectIds = new Set(modules.flatMap((module) => [module.moduleId, module.scopeId]));
  const capabilityIds = new Set(queries.capabilities);
  const familiesById = new Map(queries.families.map((family) => [family.id, family]));
  const familyIds = new Set(familiesById.keys());
  const lensIds = new Set<string>(anatomy.lenses.map((lens) => lens.id));
  let allocatedInitialBreadth = 0;
  let allocatedDetailWork = 0;
  for (const question of decomposition.questions) {
    requireText(question.questionId, 'PLAN_QUESTION_INVALID', 'questionId');
    if (questions.has(question.questionId)) {
      fail('PLAN_QUESTION_DUPLICATE', question.questionId);
    }
    if (question.subjectRefs.some((ref) => !subjectIds.has(ref))) {
      fail('PLAN_UNKNOWN_SUBJECT', question.questionId);
    }
    if (question.capabilityIds.some((id) => !capabilityIds.has(id))) {
      fail('PLAN_UNKNOWN_CAPABILITY', question.questionId);
    }
    if (question.queryFamilyIds.some((id) => !familyIds.has(id))) {
      fail('PLAN_UNKNOWN_QUERY_FAMILY', question.questionId);
    }
    if (question.anatomyLensIds.some((id) => !lensIds.has(id))) {
      fail('PLAN_UNKNOWN_ANATOMY_LENS', question.questionId);
    }
    if (question.analysisScales.some((scale) => !ANALYSIS_SCALES.has(scale))) {
      fail('PLAN_UNKNOWN_ANALYSIS_SCALE', question.questionId);
    }
    if (
      question.anatomyLensIds.length === 0 ||
      question.subjectRefs.length === 0 ||
      question.analysisScales.length === 0 ||
      question.capabilityIds.length === 0 ||
      question.queryFamilyIds.length === 0 ||
      question.expectedSupport.length === 0 ||
      question.expectedCounterevidence.length === 0 ||
      !question.synthesisTarget ||
      !question.uncertainty ||
      !question.stopCondition ||
      !question.escalationCondition ||
      !PLAN_PRIORITIES.has(question.priority)
    ) {
      fail('PLAN_QUESTION_INCOMPLETE', question.questionId);
    }
    const allocations = [
      question.budget.initialBreadth,
      question.budget.expansionReserve,
      question.budget.counterqueryReserve,
      question.budget.starvationGuard,
    ];
    if (allocations.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      fail('PLAN_BUDGET_OUT_OF_BOUNDS', question.questionId);
    }
    if (question.budget.starvationGuard < 1) {
      fail('PLAN_REQUIRED_LENS_STARVED', question.questionId);
    }
    for (const familyId of question.queryFamilyIds) {
      const family = familiesById.get(familyId);
      if (
        !family ||
        !question.capabilityIds.includes(family.capabilityId) ||
        !question.analysisScales.some((scale) => family.supportedScales.includes(scale))
      ) {
        fail('PLAN_QUERY_CAPABILITY_SCALE_MISMATCH', `${question.questionId}/${familyId}`);
      }
    }
    allocatedInitialBreadth += question.budget.initialBreadth;
    allocatedDetailWork +=
      question.budget.initialBreadth +
      question.budget.expansionReserve +
      question.budget.counterqueryReserve;
    questions.set(question.questionId, question);
  }
  if (
    allocatedInitialBreadth > budget.providerRequests ||
    allocatedDetailWork > budget.detailRequests
  ) {
    fail('PLAN_BUDGET_OUT_OF_BOUNDS', 'question allocations exceed accepted strategy');
  }
  for (const question of questions.values()) {
    if (question.subquestionIds.some((id) => !questions.has(id))) {
      fail('PLAN_UNKNOWN_SUBQUESTION', question.questionId);
    }
  }
  assertAcyclic(questions);
  const subjectToScope = new Map(
    modules.flatMap((module) => [
      [module.scopeId, module.scopeId] as const,
      [module.moduleId, module.scopeId] as const,
    ])
  );
  for (const row of applicability.rows.filter((candidate) => candidate.status === 'required')) {
    const scheduled = [...questions.values()].some(
      (question) =>
        question.anatomyLensIds.includes(row.anatomyLensId) &&
        question.subjectRefs.some((subject) => subjectToScope.get(subject) === row.scopeId)
    );
    if (!scheduled) {
      fail('PLAN_REQUIRED_LENS_UNSCHEDULED', `${row.scopeId}/${row.anatomyLensId}`);
    }
  }
  validateActions(receipt.intent, questions, capabilityIds, familiesById, subjectIds, lensIds);
}

function validateLineage(
  lineage: PlanCognitionLineageV1,
  policy: CoveragePlanPolicyV1,
  intent: StrictPlanIntentV1
): void {
  if (lineage.repairs.length > policy.semanticRepairLimit) {
    fail('PLAN_SEMANTIC_REPAIR_LIMIT', String(lineage.repairs.length));
  }
  if (!Number.isSafeInteger(lineage.transportRetryCount) || lineage.transportRetryCount < 0) {
    fail('PLAN_LINEAGE_BROKEN', 'transportRetryCount');
  }
  const invocationIds = new Set<string>();
  validateInvocation(lineage.initial, invocationIds);
  let parent = lineage.initial.invocationId;
  for (const repair of lineage.repairs) {
    validateInvocation(repair, invocationIds);
    if (repair.parentInvocationId !== parent || !repair.reason) {
      fail('PLAN_LINEAGE_BROKEN', repair.invocationId);
    }
    parent = repair.invocationId;
  }
  const finalInvocation = lineage.repairs.at(-1) ?? lineage.initial;
  if (finalInvocation.outputHash !== hashStrictPlanIntentV1(intent)) {
    fail('PLAN_LINEAGE_OUTPUT_MISMATCH', finalInvocation.invocationId);
  }
}

function validateInvocation(
  invocation: PlanCognitionInvocationV1,
  invocationIds: Set<string>
): void {
  for (const [field, value] of Object.entries({
    invocationId: invocation.invocationId,
    inputHash: invocation.inputHash,
    outputHash: invocation.outputHash,
    modelHash: invocation.modelHash,
    promptHash: invocation.promptHash,
  })) {
    requireText(value, 'PLAN_LINEAGE_BROKEN', field);
  }
  if (invocationIds.has(invocation.invocationId)) {
    fail('PLAN_LINEAGE_BROKEN', `duplicate ${invocation.invocationId}`);
  }
  invocationIds.add(invocation.invocationId);
}

function validateBudgetStrategy(
  budget: PlanBudgetStrategyV1,
  config: ResolvedStrictColdStartConfigReceiptV1
): void {
  const comparisons: Array<[number, number, string]> = [
    [budget.providerRequests, config.strictColdStart.providerRequestCap, 'provider requests'],
    [budget.detailRequests, config.strictColdStart.detailRequestCap, 'detail requests'],
    [budget.tokens, config.strictColdStart.tokenCap, 'tokens'],
    [budget.timeMs, config.strictColdStart.timeMsCap, 'time'],
    [budget.costMicrousd, config.strictColdStart.costMicrousdCap, 'cost'],
  ];
  for (const [value, cap, label] of comparisons) {
    if (!Number.isSafeInteger(value) || value < 0 || value > cap) {
      fail('PLAN_BUDGET_OUT_OF_BOUNDS', label);
    }
  }
}

function validateActions(
  intent: StrictPlanIntentV1,
  questions: ReadonlyMap<string, PlanInvestigationQuestionV1>,
  capabilities: ReadonlySet<string>,
  families: ReadonlyMap<string, FactQueryFamilyV1>,
  subjects: ReadonlySet<string>,
  lenses: ReadonlySet<string>
): void {
  const scheduled = new Set<string>();
  for (const action of intent.plannedNextActions) {
    if (!action.questionId || !questions.has(action.questionId)) {
      fail('PLAN_ACTION_UNKNOWN_QUESTION', action.questionId ?? '<missing>');
    }
    if (!action.capabilityId || !capabilities.has(action.capabilityId)) {
      fail('PLAN_UNKNOWN_CAPABILITY', action.capabilityId ?? '<missing>');
    }
    if (!action.queryFamilyId || !families.has(action.queryFamilyId)) {
      fail('PLAN_UNKNOWN_QUERY_FAMILY', action.queryFamilyId ?? '<missing>');
    }
    const question = questions.get(action.questionId);
    const family = families.get(action.queryFamilyId);
    if (
      !question ||
      !family ||
      !action.priority ||
      !action.stopCondition ||
      !action.escalationCondition ||
      !action.budget ||
      !action.expectedSupport ||
      !action.expectedCounterevidence ||
      !action.synthesisTarget ||
      !action.uncertainty
    ) {
      fail('PLAN_ACTION_INCOMPLETE', action.questionId);
    }
    const actionLenses = normalizeStrings(action.anatomyLensIds ?? []);
    const actionSubjects = normalizeStrings(action.subjectRefs ?? []);
    const actionScales = normalizeStrings(action.analysisScales ?? []) as AnalysisScale[];
    if (
      actionLenses.some((id) => !lenses.has(id)) ||
      actionSubjects.some((id) => !subjects.has(id)) ||
      actionScales.some((scale) => !ANALYSIS_SCALES.has(scale)) ||
      canonicalJsonStringify(actionLenses) !==
        canonicalJsonStringify(normalizeStrings(question.anatomyLensIds)) ||
      canonicalJsonStringify(actionSubjects) !==
        canonicalJsonStringify(normalizeStrings(question.subjectRefs)) ||
      canonicalJsonStringify(actionScales) !==
        canonicalJsonStringify(normalizeStrings(question.analysisScales)) ||
      !question.capabilityIds.includes(action.capabilityId) ||
      !question.queryFamilyIds.includes(action.queryFamilyId) ||
      family.capabilityId !== action.capabilityId ||
      !actionScales.some((scale) => family.supportedScales.includes(scale)) ||
      action.tool !== action.capabilityId ||
      action.priority !== question.priority ||
      action.stopCondition !== question.stopCondition ||
      action.escalationCondition !== question.escalationCondition ||
      canonicalJsonStringify(action.budget) !== canonicalJsonStringify(question.budget) ||
      canonicalJsonStringify(normalizeStrings(action.expectedSupport)) !==
        canonicalJsonStringify(normalizeStrings(question.expectedSupport)) ||
      canonicalJsonStringify(normalizeStrings(action.expectedCounterevidence)) !==
        canonicalJsonStringify(normalizeStrings(question.expectedCounterevidence)) ||
      action.synthesisTarget !== question.synthesisTarget ||
      action.uncertainty !== question.uncertainty ||
      !Number.isSafeInteger(action.order) ||
      action.order < 1
    ) {
      fail('PLAN_ACTION_SCOPE_MISMATCH', action.questionId);
    }
    scheduled.add(action.questionId);
  }
  for (const questionId of questions.keys()) {
    if (!scheduled.has(questionId)) {
      fail('PLAN_QUESTION_UNSCHEDULED', questionId);
    }
  }
}

function buildCellUniverse(
  modules: readonly ModulePlanningFactsV1[],
  catalog: DimensionCatalogSnapshotV1,
  policy: CoveragePlanPolicyV1,
  cognition: PlanCognitionReceiptV1
): ColdStartCellUniverseV1 {
  const cells: PlanCellV1[] = [];
  const plannedPrerequisites = cognition.intent.synthesisPrerequisiteCellIds ?? {};
  const expectedSynthesisCells = new Set<string>();
  for (const module of modules) {
    const preliminary = catalog.dimensions
      .filter((dimension) => dimension.classification !== 'synthesis')
      .map((dimension) => buildCell(module, dimension, [], policy));
    const eligiblePrerequisiteIds = new Set(
      preliminary.filter((cell) => cell.status === 'eligible').map((cell) => cell.cellId)
    );
    cells.push(...preliminary);
    for (const dimension of catalog.dimensions.filter(
      (row) => row.classification === 'synthesis'
    )) {
      const synthesisCellId = `${module.moduleId}::${dimension.id}`;
      expectedSynthesisCells.add(synthesisCellId);
      const prerequisites = normalizeStrings(plannedPrerequisites[synthesisCellId] ?? []);
      if (
        !module.generatedOrScript &&
        !module.displayOnlyAggregate &&
        module.ownedProductionFileCount > 0 &&
        (prerequisites.length < 2 ||
          prerequisites.some((cellId) => !eligiblePrerequisiteIds.has(cellId)))
      ) {
        fail('PLAN_SYNTHESIS_PREREQUISITES_INVALID', synthesisCellId);
      }
      cells.push(buildCell(module, dimension, prerequisites, policy));
    }
  }
  if (Object.keys(plannedPrerequisites).some((cellId) => !expectedSynthesisCells.has(cellId))) {
    fail('PLAN_SYNTHESIS_PREREQUISITES_INVALID', 'unknown synthesis cell');
  }
  cells.sort(compareBy((cell) => cell.cellId));
  const eligible = cells.filter((cell) => cell.status === 'eligible');
  const excluded = cells.filter((cell) => cell.status === 'excluded');
  if (
    eligible.length + excluded.length !== cells.length ||
    new Set(cells.map((cell) => cell.cellId)).size !== cells.length
  ) {
    fail('PLAN_CELL_UNIVERSE_CONSERVATION', 'duplicate or missing cells');
  }
  return freezeDeep({
    cells,
    universeCount: cells.length,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    cellUniverseHash: hashCanonicalJson(cells),
    eligibleCellsHash: hashCanonicalJson(eligible),
    excludedCellsHash: hashCanonicalJson(excluded),
  });
}

function buildCell(
  module: ModulePlanningFactsV1,
  dimension: DimensionCatalogSnapshotRowV1,
  synthesisPrerequisites: readonly string[],
  policy: CoveragePlanPolicyV1
): PlanCellV1 {
  const cellId = `${module.moduleId}::${dimension.id}`;
  const evidenceRefs = normalizeStrings([
    ...module.ownership.evidenceRefs,
    ...module.entrypointRefs,
    ...module.publicSurfaceRefs,
    ...module.crossRepoEdgeRefs,
    ...module.boundaryRefs,
  ]);
  const criticality = module.supportScope
    ? 'non-critical'
    : module.entrypointRefs.length +
          module.publicSurfaceRefs.length +
          module.crossRepoEdgeRefs.length +
          module.boundaryRefs.length >
        0
      ? 'critical'
      : 'standard';
  const reason = exclusionReason(module, dimension, synthesisPrerequisites, policy);
  return freezeDeep({
    cellId,
    moduleId: module.moduleId,
    scopeId: module.scopeId,
    dimensionId: dimension.id,
    criticality,
    status: reason ? 'excluded' : 'eligible',
    ...(reason ? { exclusionReason: reason } : {}),
    evidenceRefs,
    synthesisPrerequisiteCellIds:
      dimension.classification === 'synthesis' ? [...synthesisPrerequisites].sort() : [],
  });
}

function exclusionReason(
  module: ModulePlanningFactsV1,
  dimension: DimensionCatalogSnapshotRowV1,
  synthesisPrerequisites: readonly string[],
  policy: CoveragePlanPolicyV1
): CellExclusionReason | null {
  if (module.generatedOrScript) {
    return 'GENERATED_OR_SCRIPT';
  }
  if (module.displayOnlyAggregate) {
    return 'DISPLAY_AGGREGATE';
  }
  if (module.ownedProductionFileCount === 0) {
    return 'NO_OWNED_PRODUCTION_FILES';
  }
  if (!module.moduleClass || !module.ownership.origin) {
    return 'REQUIRED_FACT_MISSING';
  }
  if (
    dimension.classification === 'universal' &&
    dimension.relatedRoles.length > 0 &&
    !intersects(policy.roleVocabulary.mappings[module.moduleClass] ?? [], dimension.relatedRoles)
  ) {
    return 'ROLE_NOT_APPLICABLE';
  }
  if (dimension.classification === 'language') {
    return intersects(module.languages, dimension.conditions.languages ?? [])
      ? null
      : 'LANGUAGE_NOT_APPLICABLE';
  }
  if (dimension.classification === 'framework') {
    const frameworkMatch = intersects(module.frameworks, dimension.conditions.frameworks ?? []);
    const languageMatch =
      (dimension.conditions.languages?.length ?? 0) === 0 ||
      intersects(module.languages, dimension.conditions.languages ?? []);
    return frameworkMatch && languageMatch ? null : 'FRAMEWORK_NOT_APPLICABLE';
  }
  if (dimension.classification === 'synthesis') {
    return synthesisPrerequisites.length >= 2 ? null : 'SYNTHESIS_PREREQUISITE_INSUFFICIENT';
  }
  return null;
}

function buildMiningSchedule(
  universe: ColdStartCellUniverseV1,
  modules: readonly ModulePlanningFactsV1[],
  anatomy: AnatomyLensCatalogSnapshotV1,
  applicability: RequiredFactApplicabilityUniverseV1,
  queries: FactQueryCatalogSnapshotV1,
  cognition: PlanCognitionReceiptV1
): MiningWorkScheduleV1 {
  const families = new Map(queries.families.map((family) => [family.id, family]));
  const modulesByScope = new Map(modules.map((module) => [module.scopeId, module]));
  const subjectToScope = new Map(
    modules.flatMap((module) => [
      [module.scopeId, module.scopeId] as const,
      [module.moduleId, module.scopeId] as const,
    ])
  );
  const lensesById = new Map(anatomy.lenses.map((lens) => [lens.id, lens]));
  const obligations = new Map<string, FactHarvestObligationV1>();
  for (const row of applicability.rows.filter((candidate) => candidate.status === 'required')) {
    const module = modulesByScope.get(row.scopeId);
    const lens = lensesById.get(row.anatomyLensId);
    if (!module || !lens) {
      fail('REQUIRED_FACT_APPLICABILITY_CONSERVATION', row.applicabilityId);
    }
    for (const familyId of lens.factFamilyIds) {
      const family = families.get(familyId);
      if (!family) {
        fail('FACT_QUERY_BACKEND_UNAVAILABLE', familyId);
      }
      for (const scale of lens.analysisScales.filter((candidate) =>
        family.supportedScales.includes(candidate)
      )) {
        const identity = {
          factFamilyId: family.id,
          capabilityId: family.capabilityId,
          canonicalSubjectRef: module.scopeId,
          analysisScale: scale,
          denominator: 'complete-frozen-subject' as const,
        };
        const obligationId = `fact:${hashCanonicalJson(identity).slice(7, 31)}`;
        obligations.set(obligationId, {
          obligationId,
          ...identity,
          source: 'required-universe',
        });
      }
    }
  }
  const questions = cognition.intent.investigationDecomposition?.questions ?? [];
  for (const question of questions) {
    for (const subjectRef of question.subjectRefs) {
      const canonicalSubjectRef = subjectToScope.get(subjectRef);
      if (!canonicalSubjectRef) {
        fail('PLAN_UNKNOWN_SUBJECT', subjectRef);
      }
      for (const familyId of question.queryFamilyIds) {
        const family = families.get(familyId);
        if (!family || !question.capabilityIds.includes(family.capabilityId)) {
          fail('PLAN_QUERY_CAPABILITY_SCALE_MISMATCH', `${question.questionId}/${familyId}`);
        }
        for (const analysisScale of question.analysisScales.filter((scale) =>
          family.supportedScales.includes(scale)
        )) {
          const identity = {
            factFamilyId: family.id,
            capabilityId: family.capabilityId,
            canonicalSubjectRef,
            analysisScale,
            denominator: 'complete-frozen-subject' as const,
          };
          const obligationId = `fact:${hashCanonicalJson(identity).slice(7, 31)}`;
          if (!obligations.has(obligationId)) {
            obligations.set(obligationId, {
              obligationId,
              ...identity,
              source: 'accepted-plan-addition',
            });
          }
        }
      }
    }
  }
  const questionIdsByScopeAndLens = new Map<string, string[]>();
  for (const question of questions) {
    for (const subjectRef of question.subjectRefs) {
      const scopeId = subjectToScope.get(subjectRef);
      if (!scopeId) {
        continue;
      }
      for (const lensId of question.anatomyLensIds) {
        const key = `${scopeId}\u0000${lensId}`;
        questionIdsByScopeAndLens.set(
          key,
          normalizeStrings([...(questionIdsByScopeAndLens.get(key) ?? []), question.questionId])
        );
      }
    }
  }
  const lensBindings = universe.cells
    .filter((cell) => cell.status === 'eligible')
    .flatMap((cell) =>
      anatomy.lenses.map((lens) => {
        const questionIds = questionIdsByScopeAndLens.get(`${cell.scopeId}\u0000${lens.id}`) ?? [];
        if (questionIds.length === 0) {
          fail('PLAN_REQUIRED_LENS_UNSCHEDULED', `${cell.scopeId}/${lens.id}`);
        }
        const semantic = {
          cellId: cell.cellId,
          anatomyLensId: lens.id,
          questionIds,
          factFamilyIds: [...lens.factFamilyIds].sort(),
          counterqueryRequired: true,
        };
        return { bindingId: `lens:${hashCanonicalJson(semantic).slice(7, 31)}`, ...semantic };
      })
    )
    .sort(compareBy((binding) => binding.bindingId));
  const factHarvestObligations = [...obligations.values()].sort(
    compareBy((row) => row.obligationId)
  );
  const factHarvestScheduleHash = hashCanonicalJson(factHarvestObligations);
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  return freezeDeep({
    schemaVersion: 1,
    factHarvestObligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  });
}

function buildSelection(
  universe: ColdStartCellUniverseV1,
  modules: readonly ModulePlanningFactsV1[],
  catalog: DimensionCatalogSnapshotV1,
  policy: CoveragePlanPolicyV1,
  config: ResolvedStrictColdStartConfigReceiptV1,
  sourceArtifactHash: string
): ColdStartPlanSelectionV2 {
  const caps = config.strictColdStart;
  return freezeDeep({
    schemaVersion: 2,
    kind: 'cold-start-upper-cap',
    generationStage: 'coldStart',
    moduleIds: modules.map((module) => module.moduleId),
    dimensionIds: catalog.dimensions.map((dimension) => dimension.id),
    eligibleCellIds: universe.cells
      .filter((cell) => cell.status === 'eligible')
      .map((cell) => cell.cellId),
    excludedCellIds: universe.cells
      .filter((cell) => cell.status === 'excluded')
      .map((cell) => cell.cellId),
    candidateAttemptCap: caps.candidateAttemptCap,
    maxAuthoredCandidatesPerCellPass: caps.maxAuthoredCandidatesPerCellPass,
    semanticRepairLimit: 2,
    batchBarrierVersion: policy.batchBarrierVersion,
    policyVersion: policy.policyVersion,
    policyHash: hashCanonicalJson(policy),
    modulePlanningFactsHash: hashCanonicalJson(modules),
    sourceArtifactHash,
    strictConfigReceiptHash: config.loadHash,
    authoringPolicy: STRICT_AUTHORING_POLICY_V1,
    deferredCells: [],
    resourceCaps: {
      providerRequestCap: caps.providerRequestCap,
      detailRequestCap: caps.detailRequestCap,
      tokenCap: caps.tokenCap,
      timeMsCap: caps.timeMsCap,
      costMicrousdCap: caps.costMicrousdCap,
      factQueryObligationCap: caps.factQueryObligationCap,
    },
  });
}

function buildExecution(
  facts: CertifiedPlanningFactsV1,
  modules: readonly ModulePlanningFactsV1[],
  universe: ColdStartCellUniverseV1,
  schedule: MiningWorkScheduleV1,
  requiredFactApplicability: RequiredFactApplicabilityUniverseV1,
  selection: ColdStartPlanSelectionV2,
  cognition: PlanCognitionReceiptV1,
  planCognitionHash: CanonicalSha256,
  queries: FactQueryCatalogSnapshotV1
): ColdStartExecutionProjectionV2 {
  const questions = new Map(
    (cognition.intent.investigationDecomposition?.questions ?? []).map((question) => [
      question.questionId,
      question,
    ])
  );
  const orderedInvestigationActions = cognition.intent.plannedNextActions
    .map((action) => {
      const question = questions.get(action.questionId ?? '');
      if (
        !question ||
        !action.capabilityId ||
        !action.queryFamilyId ||
        !action.priority ||
        !action.expectedSupport ||
        !action.expectedCounterevidence ||
        !action.synthesisTarget ||
        !action.uncertainty ||
        !action.stopCondition ||
        !action.escalationCondition ||
        !action.budget
      ) {
        fail('PLAN_ACTION_INCOMPLETE', action.questionId ?? '<missing>');
      }
      const semantic = {
        questionId: question.questionId,
        dependsOnQuestionIds: [...question.subquestionIds].sort(),
        anatomyLensIds: normalizeStrings(action.anatomyLensIds ?? question.anatomyLensIds),
        subjectRefs: normalizeStrings(action.subjectRefs ?? question.subjectRefs),
        analysisScales: [
          ...(action.analysisScales ?? question.analysisScales),
        ].sort() as AnalysisScale[],
        capabilityId: action.capabilityId,
        queryFamilyId: action.queryFamilyId,
        expectedSupport: normalizeStrings(action.expectedSupport),
        expectedCounterevidence: normalizeStrings(action.expectedCounterevidence),
        synthesisTarget: action.synthesisTarget,
        uncertainty: action.uncertainty,
        priority: action.priority,
        stopCondition: action.stopCondition,
        escalationCondition: action.escalationCondition,
        budget: action.budget,
      };
      return { actionId: `action:${hashCanonicalJson(semantic).slice(7, 31)}`, ...semantic };
    })
    .sort(
      (left, right) =>
        priorityRank(left.priority) - priorityRank(right.priority) ||
        left.questionId.localeCompare(right.questionId) ||
        left.actionId.localeCompare(right.actionId)
    );
  const synthesisPrerequisites = Object.fromEntries(
    universe.cells
      .filter((cell) => cell.synthesisPrerequisiteCellIds.length > 0)
      .map((cell) => [cell.cellId, cell.synthesisPrerequisiteCellIds])
  );
  return freezeDeep({
    schemaVersion: 2,
    factsBindingHash: facts.factsHash,
    sourceRevisionVectorHash: facts.sourceRevisionVectorHash,
    planCognitionHash,
    orderedDimensionIds: [...selection.dimensionIds],
    orderedCells: universe.cells
      .filter((cell) => cell.status === 'eligible')
      .sort(
        (left, right) =>
          priorityRank(left.criticality) - priorityRank(right.criticality) ||
          left.moduleId.localeCompare(right.moduleId) ||
          left.dimensionId.localeCompare(right.dimensionId)
      )
      .map((cell) => cell.cellId),
    orderedInvestigationActions,
    anatomyApplicabilityHash: requiredFactApplicability.universeHash,
    lensBindingsHash: schedule.lensBindingsHash,
    factHarvestScheduleHash: schedule.factHarvestScheduleHash,
    moduleScope: modules.map((module) => module.scopeId),
    synthesisPrerequisites,
    resourceCaps: selection.resourceCaps,
    factQueryCatalogHash: queries.catalogHash,
  });
}

function normalizePlanCognitionReceipt(receipt: PlanCognitionReceiptV1): PlanCognitionReceiptV1 {
  return freezeDeep({
    ...receipt,
    intent: normalizeStrictPlanIntent(receipt.intent),
    lineage: {
      ...receipt.lineage,
      initial: { ...receipt.lineage.initial },
      repairs: receipt.lineage.repairs.map((repair) => ({ ...repair })),
    },
  });
}

function normalizeStrictPlanIntent(intent: StrictPlanIntentV1): StrictPlanIntentV1 {
  const decomposition = intent.investigationDecomposition
    ? {
        ...intent.investigationDecomposition,
        questions: intent.investigationDecomposition.questions
          .map((question) => ({
            ...question,
            subquestionIds: normalizeStrings(question.subquestionIds),
            anatomyLensIds: normalizeStrings(question.anatomyLensIds),
            subjectRefs: normalizeStrings(question.subjectRefs),
            analysisScales: normalizeStrings(question.analysisScales) as AnalysisScale[],
            capabilityIds: normalizeStrings(question.capabilityIds),
            queryFamilyIds: normalizeStrings(question.queryFamilyIds),
            expectedSupport: normalizeStrings(question.expectedSupport),
            expectedCounterevidence: normalizeStrings(question.expectedCounterevidence),
            budget: { ...question.budget },
          }))
          .sort(compareBy((question) => question.questionId)),
      }
    : undefined;
  const synthesisPrerequisiteCellIds = intent.synthesisPrerequisiteCellIds
    ? Object.fromEntries(
        Object.entries(intent.synthesisPrerequisiteCellIds)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([cellId, prerequisites]) => [cellId, normalizeStrings(prerequisites)])
      )
    : undefined;
  return {
    ...intent,
    projectProfile: {
      ...intent.projectProfile,
      secondaryLanguages: intent.projectProfile.secondaryLanguages
        ? normalizeStrings(intent.projectProfile.secondaryLanguages)
        : undefined,
      frameworks: intent.projectProfile.frameworks
        ? normalizeStrings(intent.projectProfile.frameworks)
        : undefined,
      architectureHints: intent.projectProfile.architectureHints
        ? normalizeStrings(intent.projectProfile.architectureHints)
        : undefined,
    },
    dimensions: intent.dimensions
      .map((dimension) => ({ ...dimension }))
      .sort(compareBy((dimension) => dimension.dimensionId)),
    scale: {
      ...intent.scale,
      depthLevels: normalizeStrings(intent.scale.depthLevels),
    },
    moduleBindings: intent.moduleBindings
      .map((binding) => ({ ...binding, dimensions: normalizeStrings(binding.dimensions) }))
      .sort(
        (left, right) =>
          (left.moduleId ?? left.modulePath).localeCompare(right.moduleId ?? right.modulePath) ||
          left.modulePath.localeCompare(right.modulePath)
      ),
    plannedNextActions: intent.plannedNextActions
      .map((action) => ({
        ...action,
        dimensionIds: action.dimensionIds ? normalizeStrings(action.dimensionIds) : undefined,
        modulePaths: action.modulePaths ? normalizeStrings(action.modulePaths) : undefined,
        anatomyLensIds: action.anatomyLensIds ? normalizeStrings(action.anatomyLensIds) : undefined,
        subjectRefs: action.subjectRefs ? normalizeStrings(action.subjectRefs) : undefined,
        analysisScales: action.analysisScales
          ? (normalizeStrings(action.analysisScales) as AnalysisScale[])
          : undefined,
        expectedSupport: action.expectedSupport
          ? normalizeStrings(action.expectedSupport)
          : undefined,
        expectedCounterevidence: action.expectedCounterevidence
          ? normalizeStrings(action.expectedCounterevidence)
          : undefined,
        budget: action.budget ? { ...action.budget } : undefined,
      }))
      .sort(
        (left, right) =>
          left.order - right.order ||
          (left.questionId ?? '').localeCompare(right.questionId ?? '') ||
          left.tool.localeCompare(right.tool)
      ),
    evidenceRefs: intent.evidenceRefs
      .map((reference) => ({ ...reference }))
      .sort(
        compareBy(
          (reference) => `${reference.kind}\u0000${reference.ref}\u0000${reference.detail ?? ''}`
        )
      ),
    ...(decomposition ? { investigationDecomposition: decomposition } : {}),
    ...(intent.budgetStrategy ? { budgetStrategy: { ...intent.budgetStrategy } } : {}),
    ...(synthesisPrerequisiteCellIds ? { synthesisPrerequisiteCellIds } : {}),
  };
}

function normalizeFactQueryCatalog(
  catalog: FactQueryCatalogSnapshotV1
): FactQueryCatalogSnapshotV1 {
  const families = catalog.families
    .map((family) => ({ ...family, supportedScales: [...family.supportedScales].sort() }))
    .sort(compareBy((family) => family.id));
  const capabilities = normalizeStrings(catalog.capabilities);
  const semantic = { schemaVersion: 1 as const, capabilities, families };
  return freezeDeep({ ...semantic, catalogHash: hashCanonicalJson(semantic) });
}

function normalizeDimensionRow(
  dimension: UnifiedDimension,
  classification: DimensionClassification
): DimensionCatalogSnapshotRowV1 {
  return {
    id: dimension.id,
    classification,
    codeLayer: dimension.layer,
    conditions: {
      languages: normalizeStrings(dimension.conditions?.languages ?? []),
      frameworks: normalizeStrings(dimension.conditions?.frameworks ?? []),
    },
    relatedRoles: normalizeStrings(dimension.relatedRoles),
    tier: dimension.tierHint ?? null,
    outputMode: dimension.outputMode,
    evidenceMetadata: {
      allowedKnowledgeTypes: normalizeStrings(dimension.allowedKnowledgeTypes),
      matchTopics: normalizeStrings(dimension.matchTopics),
      matchCategories: normalizeStrings(dimension.matchCategories),
    },
    qualityMetadata: { description: dimension.qualityDescription, weight: dimension.weight },
  };
}

function classifyDimension(id: string): DimensionClassification {
  for (const classification of ['universal', 'language', 'framework', 'synthesis'] as const) {
    if (CLASSIFICATION_IDS[classification].includes(id)) {
      return classification;
    }
  }
  fail('DIMENSION_CATALOG_DRIFT', id);
}

function anatomy(
  id: AnatomyLensId,
  question: string,
  analysisScales: readonly AnalysisScale[],
  factFamilyIds: readonly string[],
  capabilityIds: readonly string[]
): AnatomyLensCatalogRowV1 {
  return { id, question, analysisScales, factFamilyIds, capabilityIds };
}

function assertAcyclic(questions: ReadonlyMap<string, PlanInvestigationQuestionV1>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      fail('PLAN_QUESTION_CYCLE', id);
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const child of questions.get(id)?.subquestionIds ?? []) {
      visit(child);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of questions.keys()) {
    visit(id);
  }
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const normalized = new Set(left.map(normalizeTechnologyToken));
  return right.some((value) => normalized.has(normalizeTechnologyToken(value)));
}

function normalizeTechnologyToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.js$/, '')
    .replace(/^nodejs$/, 'javascript')
    .replace(/^ts$/, 'typescript');
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function priorityRank(value: string): number {
  return value === 'critical' ? 0 : value === 'high' ? 1 : value === 'standard' ? 2 : 3;
}

function compareBy<T>(selector: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => selector(left).localeCompare(selector(right));
}

function requireText(value: string, code: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, field);
  }
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

const STRICT_CONFIG_FIELDS: readonly StrictColdStartConfigField[] = [
  'candidateAttemptCap',
  'maxAuthoredCandidatesPerCellPass',
  'providerRequestCap',
  'detailRequestCap',
  'tokenCap',
  'timeMsCap',
  'costMicrousdCap',
  'factQueryObligationCap',
  'moduleWireBound',
  'cellWireBound',
];

const STRICT_CONFIG_SCHEMA_BOUNDS: Readonly<
  Record<StrictColdStartConfigField, readonly [number, number]>
> = {
  candidateAttemptCap: [0, 10_000],
  maxAuthoredCandidatesPerCellPass: [0, 100],
  providerRequestCap: [1, 10_000],
  detailRequestCap: [1, 10_000],
  tokenCap: [1, 10_000_000],
  timeMsCap: [1, 3_600_000],
  costMicrousdCap: [0, 100_000_000],
  factQueryObligationCap: [1, 100_000],
  moduleWireBound: [1, 100_000],
  cellWireBound: [1, 1_000_000],
};

const ANALYSIS_SCALES = new Set<AnalysisScale>([
  'source-range',
  'symbol',
  'file',
  'module',
  'package',
  'repository',
  'project',
]);

const PLAN_PRIORITIES = new Set<PlanInvestigationQuestionV1['priority']>([
  'critical',
  'high',
  'standard',
  'support',
]);

function isCanonicalSha256(value: unknown): value is CanonicalSha256 {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

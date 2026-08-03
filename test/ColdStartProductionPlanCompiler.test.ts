import { describe, expect, it } from 'vitest';
import {
  ANATOMY_LENS_IDS,
  buildAnatomyLensCatalogSnapshot,
  buildDimensionCatalogSnapshot,
  buildFactQueryCatalogSnapshot,
  buildRequiredFactApplicabilityUniverseV1,
  type CertifiedPlanningFactsV1,
  type CoveragePlanPolicyV1,
  compileColdStartPlan,
  createPlanningRoleVocabularyV1,
  createResolvedStrictColdStartConfigReceiptV1,
  type FactQueryFamilyV1,
  hashStrictPlanIntentV1,
  type PlanCognitionReceiptV1,
  type ResolvedStrictColdStartConfigReceiptV1,
} from '../src/plans.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';

const MODULES: CertifiedPlanningFactsV1['modules'] = [
  {
    moduleId: 'core',
    scopeId: 'repo:core',
    relativePath: 'packages/core',
    moduleClass: 'production-library',
    ownedProductionFileCount: 24,
    languages: ['typescript'],
    frameworks: [],
    roles: ['library', 'public-api'],
    entrypointRefs: ['ref:core:index'],
    publicSurfaceRefs: ['ref:core:exports'],
    crossRepoEdgeRefs: ['ref:core:consumer'],
    boundaryRefs: ['ref:core:persistence'],
    ownership: { origin: 'project-context', confidence: 1, evidenceRefs: ['ref:core'] },
  },
  {
    moduleId: 'ui',
    scopeId: 'repo:ui',
    relativePath: 'packages/ui',
    moduleClass: 'production-application',
    ownedProductionFileCount: 16,
    languages: ['typescript'],
    frameworks: ['react'],
    roles: ['application', 'public-api'],
    entrypointRefs: ['ref:ui:index'],
    publicSurfaceRefs: ['ref:ui:routes'],
    crossRepoEdgeRefs: [],
    boundaryRefs: ['ref:ui:lifecycle'],
    ownership: { origin: 'project-context', confidence: 1, evidenceRefs: ['ref:ui'] },
  },
];

const FACTS: CertifiedPlanningFactsV1 = {
  schemaVersion: 1,
  factsHash: sha('facts'),
  sourceRevisionVectorHash: sha('revision'),
  sourceArtifactHash: sha('artifact'),
  modules: MODULES,
};

const POLICY: CoveragePlanPolicyV1 = {
  schemaVersion: 1,
  policyVersion: 'coverage-plan-policy-v1',
  batchBarrierVersion: 'candidate-batch-barrier-v1',
  semanticRepairLimit: 2,
  roleVocabulary: createPlanningRoleVocabularyV1(sha('role-vocabulary-source'), {
    'production-library': ['core', 'foundation', 'service', 'networking', 'storage', 'model'],
    'production-application': [
      'app',
      'ui',
      'feature',
      'service',
      'networking',
      'storage',
      'model',
      'core',
    ],
  }),
};

const CONFIG: ResolvedStrictColdStartConfigReceiptV1 = createResolvedStrictColdStartConfigReceiptV1(
  {
    sourceArtifactHash: sha('config-artifact'),
    strictColdStart: {
      candidateAttemptCap: 0,
      maxAuthoredCandidatesPerCellPass: 0,
      providerRequestCap: 200,
      detailRequestCap: 200,
      tokenCap: 2_000_000,
      timeMsCap: 600_000,
      costMicrousdCap: 5_000_000,
      factQueryObligationCap: 10_000,
      moduleWireBound: 5_000,
      cellWireBound: 100_000,
    },
    fieldSources: {
      candidateAttemptCap: 'resolved-production-config:candidate-attempt-cap',
      maxAuthoredCandidatesPerCellPass: 'resolved-production-config:candidate-pass-cap',
      providerRequestCap: 'resolved-production-config:provider-request-cap',
      detailRequestCap: 'resolved-production-config:detail-request-cap',
      tokenCap: 'resolved-production-config:token-cap',
      timeMsCap: 'resolved-production-config:time-cap',
      costMicrousdCap: 'resolved-production-config:cost-cap',
      factQueryObligationCap: 'resolved-production-config:fact-query-cap',
      moduleWireBound: 'strict-v2-wire:module-bound',
      cellWireBound: 'strict-v2-wire:cell-bound',
    },
  }
);

const LOADED_FACT_FAMILIES: readonly FactQueryFamilyV1[] = [
  family('syntax-idiom', 'tree-sitter-query', ['source-range', 'symbol', 'file']),
  family('architecture-dependency', 'certified-project-context', [
    'module',
    'package',
    'repository',
    'project',
  ]),
  family('api-protocol', 'accepted-semantic-relations', [
    'source-range',
    'symbol',
    'module',
    'repository',
  ]),
  family('lifecycle-error-invariant', 'accepted-static-invariants', [
    'source-range',
    'symbol',
    'module',
    'project',
  ]),
  family('config-build-test-migration', 'frozen-config-parsers', ['file', 'module', 'project']),
  family('history-fix-pattern', 'accepted-frozen-history', ['symbol', 'repository']),
  family('synthesis-cross-cutting', 'accepted-observation-aggregation', [
    'module',
    'repository',
    'project',
  ]),
];

function factCatalog() {
  return buildFactQueryCatalogSnapshot(LOADED_FACT_FAMILIES);
}

function cognition(overrides: Partial<PlanCognitionReceiptV1> = {}): PlanCognitionReceiptV1 {
  const question = {
    questionId: 'q-project',
    subquestionIds: [],
    anatomyLensIds: [...ANATOMY_LENS_IDS],
    subjectRefs: ['repo:core', 'repo:ui'],
    analysisScales: [
      'source-range',
      'symbol',
      'file',
      'module',
      'package',
      'repository',
      'project',
    ] as const,
    capabilityIds: [...new Set(LOADED_FACT_FAMILIES.map((family) => family.capabilityId))],
    queryFamilyIds: LOADED_FACT_FAMILIES.map((family) => family.id),
    expectedSupport: ['direct anchors and complete denominators'],
    expectedCounterevidence: ['negative and edge fixtures'],
    synthesisTarget: 'project-patterns',
    uncertainty: 'backend support is receipt-bound',
    stopCondition: 'all scheduled obligations are terminal',
    escalationCondition: 'required backend unavailable or cap insufficient',
    priority: 'critical' as const,
    budget: {
      initialBreadth: 40,
      expansionReserve: 20,
      counterqueryReserve: 20,
      starvationGuard: 1,
    },
  };
  const intent: PlanCognitionReceiptV1['intent'] = {
    generationStage: 'coldStart',
    projectProfile: { primaryLanguage: 'typescript', frameworks: ['react'], moduleCount: 2 },
    dimensions: [],
    scale: { totalRecipeBudget: 0, depthLevels: ['evidence-bounded-no-floor'] },
    moduleBindings: [],
    plannedNextActions: LOADED_FACT_FAMILIES.map((family, index) => ({
      tool: family.capabilityId,
      reason: 'execute accepted baseline',
      order: index + 1,
      questionId: question.questionId,
      anatomyLensIds: question.anatomyLensIds,
      subjectRefs: question.subjectRefs,
      analysisScales: question.analysisScales,
      capabilityId: family.capabilityId,
      queryFamilyId: family.id,
      expectedSupport: question.expectedSupport,
      expectedCounterevidence: question.expectedCounterevidence,
      synthesisTarget: question.synthesisTarget,
      uncertainty: question.uncertainty,
      priority: 'critical',
      stopCondition: question.stopCondition,
      escalationCondition: question.escalationCondition,
      budget: question.budget,
    })),
    evidenceRefs: [{ kind: 'project-context', ref: FACTS.factsHash }],
    investigationDecomposition: { schemaVersion: 1, questions: [question] },
    budgetStrategy: {
      schemaVersion: 1,
      providerRequests: 80,
      detailRequests: 80,
      tokens: 1_000_000,
      timeMs: 300_000,
      costMicrousd: 2_000_000,
    },
    synthesisPrerequisiteCellIds: {
      'core::cross-dimension-synthesis': ['core::architecture', 'core::coding-standards'],
      'ui::cross-dimension-synthesis': ['ui::architecture', 'ui::coding-standards'],
    },
  };
  return {
    schemaVersion: 1,
    receiptId: 'plan-cognition-1',
    factsHash: FACTS.factsHash,
    catalogHash: buildDimensionCatalogSnapshot().catalogHash,
    intent,
    lineage: {
      schemaVersion: 1,
      initial: {
        invocationId: 'plan-initial',
        inputHash: 'input-1',
        outputHash: hashStrictPlanIntentV1(intent),
        modelHash: 'model-1',
        promptHash: 'prompt-1',
      },
      repairs: [],
      transportRetryCount: 0,
    },
    validatorVerdict: 'accepted',
    ...overrides,
  };
}

describe('cold-start production Plan compiler', () => {
  it('derives the accepted immutable 26-dimension and 10-lens catalogs', () => {
    const dimensions = buildDimensionCatalogSnapshot();
    const lenses = buildAnatomyLensCatalogSnapshot();

    expect(dimensions.dimensions).toHaveLength(26);
    expect(
      dimensions.dimensions.reduce<Record<string, number>>((counts, row) => {
        counts[row.classification] = (counts[row.classification] ?? 0) + 1;
        return counts;
      }, {})
    ).toEqual({ universal: 13, language: 7, framework: 5, synthesis: 1 });
    expect(lenses.lenses.map((lens) => lens.id)).toEqual(ANATOMY_LENS_IDS);
    const applicability = buildRequiredFactApplicabilityUniverseV1(MODULES, lenses, factCatalog());
    expect(applicability.universeCount).toBe(MODULES.length * ANATOMY_LENS_IDS.length);
    expect(applicability.requiredCount).toBe(applicability.universeCount);
    expect(applicability.unsupportedBlockedCount).toBe(0);

    expect(() =>
      compileColdStartPlan(
        FACTS,
        { ...dimensions, dimensions: dimensions.dimensions.slice(0, 25) },
        POLICY,
        cognition(),
        CONFIG,
        factCatalog()
      )
    ).toThrow('DIMENSION_CATALOG_DRIFT');
  });

  it('compiles the complete module×dimension universe without a quantity floor or deferral', () => {
    const compiled = compileColdStartPlan(
      FACTS,
      buildDimensionCatalogSnapshot(),
      POLICY,
      cognition(),
      CONFIG,
      factCatalog()
    );

    expect(compiled.selection.schemaVersion).toBe(2);
    expect(compiled.selection.kind).toBe('cold-start-upper-cap');
    expect(compiled.selection.candidateAttemptCap).toBe(0);
    expect(compiled.selection.maxAuthoredCandidatesPerCellPass).toBe(0);
    expect(compiled.selection.authoringPolicy).toMatchObject({
      policy: 'evidence-bounded-no-floor',
      quantityFloor: null,
      batchFailureMode: 'whole-batch',
    });
    expect(compiled.selection.deferredCells).toEqual([]);
    expect(compiled.universe.universeCount).toBe(MODULES.length * 26);
    expect(compiled.universe.eligibleCount + compiled.universe.excludedCount).toBe(
      compiled.universe.universeCount
    );
    expect(new Set(compiled.universe.cells.map((cell) => cell.cellId)).size).toBe(
      compiled.universe.universeCount
    );
    expect(compiled.schedule.factHarvestObligations.every((row) => !('cellId' in row))).toBe(true);
    expect(compiled.schedule.factHarvestObligations.every((row) => !('dimensionId' in row))).toBe(
      true
    );
  });

  it('is enumeration-order independent', () => {
    const catalog = buildDimensionCatalogSnapshot();
    const queries = factCatalog();
    const left = compileColdStartPlan(FACTS, catalog, POLICY, cognition(), CONFIG, queries);
    const right = compileColdStartPlan(
      { ...FACTS, modules: [...FACTS.modules].reverse() },
      { ...catalog, dimensions: [...catalog.dimensions].reverse() },
      POLICY,
      cognition(),
      CONFIG,
      { ...queries, families: [...queries.families].reverse() }
    );

    expect(right.canonicalPlanHash).toBe(left.canonicalPlanHash);
    expect(right.universe.cellUniverseHash).toBe(left.universe.cellUniverseHash);
    expect(right.schedule.factHarvestScheduleHash).toBe(left.schedule.factHarvestScheduleHash);
    expect(right.execution).toEqual(left.execution);
  });

  it('normalizes cognition and action enumeration without changing the compiled plan', () => {
    const leftCognition = cognition();
    const left = compile(leftCognition);
    const question = leftCognition.intent.investigationDecomposition!.questions[0]!;
    const shuffledIntent = {
      ...leftCognition.intent,
      investigationDecomposition: {
        schemaVersion: 1 as const,
        questions: [
          {
            ...question,
            anatomyLensIds: [...question.anatomyLensIds].reverse(),
            subjectRefs: [...question.subjectRefs].reverse(),
            analysisScales: [...question.analysisScales].reverse(),
            capabilityIds: [...question.capabilityIds].reverse(),
            queryFamilyIds: [...question.queryFamilyIds].reverse(),
          },
        ],
      },
      plannedNextActions: [...leftCognition.intent.plannedNextActions].reverse().map((action) => ({
        ...action,
        anatomyLensIds: [...(action.anatomyLensIds ?? [])].reverse(),
        subjectRefs: [...(action.subjectRefs ?? [])].reverse(),
        analysisScales: [...(action.analysisScales ?? [])].reverse(),
      })),
      synthesisPrerequisiteCellIds: Object.fromEntries(
        Object.entries(leftCognition.intent.synthesisPrerequisiteCellIds ?? {}).map(
          ([cellId, prerequisites]) => [cellId, [...prerequisites].reverse()]
        )
      ),
    };
    const shuffled = {
      ...leftCognition,
      intent: shuffledIntent,
      lineage: {
        ...leftCognition.lineage,
        initial: {
          ...leftCognition.lineage.initial,
          outputHash: hashStrictPlanIntentV1(shuffledIntent),
        },
      },
    };

    expect(compile(shuffled).canonicalPlanHash).toBe(left.canonicalPlanHash);
  });

  it('rejects action scope injection, config receipt tampering, and invented synthesis prerequisites', () => {
    const base = cognition();
    const injectedIntent = {
      ...base.intent,
      plannedNextActions: base.intent.plannedNextActions.map((action, index) =>
        index === 0 ? { ...action, subjectRefs: ['repo:core'] } : action
      ),
    };
    expect(() =>
      compile({
        ...base,
        intent: injectedIntent,
        lineage: {
          ...base.lineage,
          initial: { ...base.lineage.initial, outputHash: hashStrictPlanIntentV1(injectedIntent) },
        },
      })
    ).toThrow('PLAN_ACTION_SCOPE_MISMATCH');

    expect(() =>
      compileColdStartPlan(
        FACTS,
        buildDimensionCatalogSnapshot(),
        POLICY,
        cognition(),
        {
          ...CONFIG,
          strictColdStart: {
            ...CONFIG.strictColdStart,
            tokenCap: CONFIG.strictColdStart.tokenCap + 1,
          },
        },
        factCatalog()
      )
    ).toThrow('CONFIG_UNSUPPORTED');

    const invalidSynthesisIntent = {
      ...base.intent,
      synthesisPrerequisiteCellIds: {
        ...base.intent.synthesisPrerequisiteCellIds,
        'core::cross-dimension-synthesis': ['core::not-a-cell'],
      },
    };
    expect(() =>
      compile({
        ...base,
        intent: invalidSynthesisIntent,
        lineage: {
          ...base.lineage,
          initial: {
            ...base.lineage.initial,
            outputHash: hashStrictPlanIntentV1(invalidSynthesisIntent),
          },
        },
      })
    ).toThrow('PLAN_SYNTHESIS_PREREQUISITES_INVALID');
  });

  it.each([
    [
      'unknown subject',
      () => cognitionWithQuestion({ subjectRefs: ['repo:missing'] }),
      'PLAN_UNKNOWN_SUBJECT',
    ],
    [
      'unknown capability',
      () => cognitionWithQuestion({ capabilityIds: ['missing'] }),
      'PLAN_UNKNOWN_CAPABILITY',
    ],
    [
      'unknown query',
      () => cognitionWithQuestion({ queryFamilyIds: ['missing'] }),
      'PLAN_UNKNOWN_QUERY_FAMILY',
    ],
    [
      'missing lens',
      () => cognitionWithQuestion({ anatomyLensIds: ANATOMY_LENS_IDS.slice(0, 9) }),
      'PLAN_REQUIRED_LENS_UNSCHEDULED',
    ],
  ])('fails closed for %s', (_label, build, code) => {
    expect(() =>
      compileColdStartPlan(
        FACTS,
        buildDimensionCatalogSnapshot(),
        POLICY,
        build(),
        CONFIG,
        factCatalog()
      )
    ).toThrow(code);
  });

  it('rejects cyclic question graphs, starvation, and cap overflow instead of first-N selection', () => {
    const cycle = cognitionWithQuestions([
      { ...baseQuestion('q-a'), subquestionIds: ['q-b'] },
      { ...baseQuestion('q-b'), subquestionIds: ['q-a'] },
    ]);
    expect(() => compile(cycle)).toThrow('PLAN_QUESTION_CYCLE');

    const starvation = cognitionWithQuestion({
      budget: {
        initialBreadth: 1,
        expansionReserve: 0,
        counterqueryReserve: 0,
        starvationGuard: 0,
      },
    });
    expect(() => compile(starvation)).toThrow('PLAN_REQUIRED_LENS_STARVED');

    const tooSmall = createResolvedStrictColdStartConfigReceiptV1({
      sourceArtifactHash: CONFIG.sourceArtifactHash,
      strictColdStart: { ...CONFIG.strictColdStart, cellWireBound: 10 },
      fieldSources: Object.fromEntries(
        Object.entries(CONFIG.provenance).map(([field, provenance]) => [field, provenance.source])
      ) as Parameters<typeof createResolvedStrictColdStartConfigReceiptV1>[0]['fieldSources'],
    });
    expect(() =>
      compileColdStartPlan(
        FACTS,
        buildDimensionCatalogSnapshot(),
        POLICY,
        cognition(),
        tooSmall,
        factCatalog()
      )
    ).toThrow('PLAN_SCALE_UNSUPPORTED');
  });

  it('blocks a required applicability row when its loaded backend is missing', () => {
    const catalog = factCatalog();
    const families = catalog.families.map((family, index) =>
      index === 0 ? { ...family, loadedProducer: '' } : family
    );
    const unavailable = {
      ...catalog,
      families,
      catalogHash: hashCanonicalJson({
        schemaVersion: 1,
        capabilities: catalog.capabilities,
        families,
      }),
    };
    expect(() =>
      compileColdStartPlan(
        FACTS,
        buildDimensionCatalogSnapshot(),
        POLICY,
        cognition(),
        CONFIG,
        unavailable
      )
    ).toThrow('FACT_QUERY_BACKEND_UNAVAILABLE');
  });
});

function compile(receipt: PlanCognitionReceiptV1) {
  return compileColdStartPlan(
    FACTS,
    buildDimensionCatalogSnapshot(),
    POLICY,
    receipt,
    CONFIG,
    factCatalog()
  );
}

function baseQuestion(questionId: string) {
  return cognition().intent.investigationDecomposition!.questions[0]
    ? { ...cognition().intent.investigationDecomposition!.questions[0], questionId }
    : neverQuestion();
}

function cognitionWithQuestion(
  override: Partial<
    NonNullable<PlanCognitionReceiptV1['intent']['investigationDecomposition']>['questions'][number]
  >
): PlanCognitionReceiptV1 {
  return cognitionWithQuestions([{ ...baseQuestion('q-project'), ...override }]);
}

function cognitionWithQuestions(
  questions: NonNullable<
    PlanCognitionReceiptV1['intent']['investigationDecomposition']
  >['questions']
): PlanCognitionReceiptV1 {
  const base = cognition();
  const intent = {
    ...base.intent,
    investigationDecomposition: { schemaVersion: 1 as const, questions },
    budgetStrategy: {
      ...base.intent.budgetStrategy!,
      providerRequests: questions.reduce(
        (total, question) => total + question.budget.initialBreadth,
        0
      ),
      detailRequests: questions.reduce(
        (total, question) =>
          total +
          question.budget.initialBreadth +
          question.budget.expansionReserve +
          question.budget.counterqueryReserve,
        0
      ),
    },
    plannedNextActions: questions.flatMap((question, questionIndex) =>
      base.intent.plannedNextActions.map((action, actionIndex) => ({
        ...action,
        order: questionIndex * base.intent.plannedNextActions.length + actionIndex + 1,
        questionId: question.questionId,
        anatomyLensIds: question.anatomyLensIds,
        subjectRefs: question.subjectRefs,
        analysisScales: question.analysisScales,
        expectedSupport: question.expectedSupport,
        expectedCounterevidence: question.expectedCounterevidence,
        synthesisTarget: question.synthesisTarget,
        uncertainty: question.uncertainty,
        priority: question.priority,
        stopCondition: question.stopCondition,
        escalationCondition: question.escalationCondition,
        budget: question.budget,
      }))
    ),
  };
  return {
    ...base,
    intent,
    lineage: {
      ...base.lineage,
      initial: { ...base.lineage.initial, outputHash: hashStrictPlanIntentV1(intent) },
    },
  };
}

function family(
  id: string,
  capabilityId: string,
  supportedScales: FactQueryFamilyV1['supportedScales']
): FactQueryFamilyV1 {
  return {
    id,
    capabilityId,
    supportedScales,
    loadedProducer: `loaded:${capabilityId}:test-v1`,
    producerManifestHash: sha(`${id}:producer`),
    loadReceiptHash: sha(`${id}:load`),
    positiveFixtureHash: sha(`${id}:positive`),
    negativeFixtureHash: sha(`${id}:negative`),
    edgeFixtureHash: sha(`${id}:edge`),
  };
}

function sha(value: string) {
  return hashCanonicalJson(value);
}

function neverQuestion(): never {
  throw new Error('fixture question missing');
}

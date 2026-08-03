import { describe, expect, it } from 'vitest';

import {
  assertStrictTestDimensionExecutionProjectionV1,
  assertStrictTestPrivateTerminalReceiptV1,
  assertStrictTestSelectionConfirmationV1,
  buildAnatomyLensCatalogSnapshot,
  buildDimensionCatalogSnapshot,
  buildFactQueryCatalogSnapshot,
  buildRequiredFactApplicabilityUniverseV1,
  type CompiledColdStartPlanV2,
  createStrictTestAuditReportV1,
  createStrictTestDimensionExecutionProjectionV1,
  createStrictTestPreflightPreviewV1,
  createStrictTestPrivateCompletionReceiptV1,
  createStrictTestPrivateFailureReceiptV1,
  createStrictTestSelectionConfirmationV1,
  type DimensionCatalogSnapshotV1,
  type FactQueryCatalogSnapshotV1,
  type FactQueryFamilyV1,
  hashStrictTestPreflightBindingsV1,
  type PlanCellV1,
  STRICT_TEST_DIMENSION_PROFILE_V1,
  type StrictTestPreflightBindingsV1,
  validateStrictTestPreflightV1,
} from '../src/plans.js';
import type {
  FinalCoverageBindingReceiptV1,
  ServingSnapshotManifestV1,
} from '../src/production.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';

const FACT_FAMILIES: readonly FactQueryFamilyV1[] = [
  family('syntax-idiom', 'tree-sitter-query'),
  family('architecture-dependency', 'certified-project-context'),
  family('api-protocol', 'accepted-semantic-relations'),
  family('lifecycle-error-invariant', 'accepted-static-invariants'),
  family('config-build-test-migration', 'frozen-config-parsers'),
  family('history-fix-pattern', 'accepted-frozen-history'),
  family('synthesis-cross-cutting', 'accepted-observation-aggregation'),
];

const FACT_QUERY_CATALOG: FactQueryCatalogSnapshotV1 = buildFactQueryCatalogSnapshot(FACT_FAMILIES);
const FIXTURE_MODULE = {
  moduleId: 'core',
  scopeId: 'repo:core',
  relativePath: 'src',
  moduleClass: 'production-library',
  ownedProductionFileCount: 24,
  languages: ['typescript'],
  frameworks: [],
  roles: ['library'],
  entrypointRefs: ['ref:core:index'],
  publicSurfaceRefs: ['ref:core:exports'],
  crossRepoEdgeRefs: [],
  boundaryRefs: ['ref:core:boundary'],
  ownership: { origin: 'project-context', confidence: 1, evidenceRefs: ['ref:core'] },
};

describe('strict-test-dimension profile foundation', () => {
  it('freezes the complete production universe before recommending one applicable dimension', () => {
    const plan = compiledPlan();
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(plan, bindings);
    const preview = createStrictTestPreflightPreviewV1(preflight);

    expect(preflight.profile).toBe(STRICT_TEST_DIMENSION_PROFILE_V1);
    expect(preflight.catalog.dimensions).toHaveLength(26);
    expect(preflight.catalog.catalogHash).toBe(plan.catalog.catalogHash);
    expect(preflight.fullCellUniverseHash).toBe(plan.universe.cellUniverseHash);
    expect(preflight.dimensionResults).toHaveLength(26);
    expect(preflight.unknownDimensionCount).toBe(0);
    expect(preflight.unknownApplicabilityCount).toBe(0);
    expect(preflight.recommendation.dimensionId).toBe('architecture');
    expect(preview.canConfirm).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preflight.bindingHash).toBe(hashStrictTestPreflightBindingsV1(bindings));
  });

  it('confirms exactly one dimension and projects every eligible cell without mutating the full universe', () => {
    const plan = compiledPlan();
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(plan, bindings);
    const confirmation = createStrictTestSelectionConfirmationV1({
      preflight,
      currentBindings: bindings,
      selectedDimensionIds: ['architecture'],
      confirmedBy: 'user:fixture',
      confirmedAt: '2026-07-30T06:01:00.000Z',
    });
    const projection = createStrictTestDimensionExecutionProjectionV1({
      preflight,
      confirmation,
      currentBindings: bindings,
    });

    expect(confirmation.selectedDimensionId).toBe('architecture');
    expect(confirmation.selectedEligibleCellIds).toEqual(['core::architecture']);
    expect(projection.executionCellIds).toEqual(confirmation.selectedEligibleCellIds);
    expect(projection.fullCellUniverseHash).toBe(preflight.fullCellUniverseHash);
    expect(projection.fullCatalogHash).toBe(preflight.catalog.catalogHash);
    expect(projection.fullApplicabilityUniverseHash).toBe(
      preflight.requiredFactApplicabilityUniverseHash
    );
    expect(projection.dimensionStates).toHaveLength(26);
    expect(
      projection.dimensionStates.find((state) => state.dimensionId === 'coding-standards')
        ?.disposition
    ).toBe('not-executed-by-strict-test-profile');
    expect(projection.productionFinalized).toBe(false);
    expect(projection.publicRouteChanged).toBe(false);
    expect(plan.selection.deferredCells).toEqual([]);
  });

  it('fails closed for zero/multiple dimensions, excluded dimensions, and binding drift', () => {
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(
      compiledPlan(new Set(['architecture'])),
      bindings
    );

    expect(() =>
      createStrictTestSelectionConfirmationV1({
        preflight,
        currentBindings: bindings,
        selectedDimensionIds: [],
        confirmedBy: 'user:fixture',
        confirmedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_SELECTION_EXACTLY_ONE_REQUIRED');
    expect(() =>
      createStrictTestSelectionConfirmationV1({
        preflight,
        currentBindings: bindings,
        selectedDimensionIds: ['architecture', 'coding-standards'],
        confirmedBy: 'user:fixture',
        confirmedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_SELECTION_EXACTLY_ONE_REQUIRED');
    expect(() =>
      createStrictTestSelectionConfirmationV1({
        preflight,
        currentBindings: bindings,
        selectedDimensionIds: ['architecture'],
        confirmedBy: 'user:fixture',
        confirmedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_SELECTION_DIMENSION_NOT_APPLICABLE');

    const drifted = {
      ...bindings,
      strictConfigReceiptHash: sha('different-config'),
    };
    expect(() =>
      createStrictTestSelectionConfirmationV1({
        preflight,
        currentBindings: drifted,
        selectedDimensionIds: ['coding-standards'],
        confirmedBy: 'user:fixture',
        confirmedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_PREFLIGHT_DRIFT');
  });

  it('rejects missing catalog rows, duplicate cells, unsupported backends, and facts lineage drift', () => {
    const base = compiledPlan();
    const missingCatalogPlan = rehashPlan(base, {
      catalog: {
        ...base.catalog,
        dimensions: base.catalog.dimensions.slice(0, 25),
      },
    });
    expect(() => validateStrictTestPreflightV1(missingCatalogPlan, preflightBindings())).toThrow(
      'STRICT_TEST_DIMENSION_CATALOG_DRIFT'
    );

    const duplicateCells = [...base.universe.cells, base.universe.cells[0]];
    const duplicateUniverse = {
      ...base.universe,
      cells: duplicateCells,
      universeCount: duplicateCells.length,
      cellUniverseHash: hashCanonicalJson(duplicateCells),
    };
    expect(() =>
      validateStrictTestPreflightV1(
        rehashPlan(base, { universe: duplicateUniverse }),
        preflightBindings()
      )
    ).toThrow('STRICT_TEST_CELL_UNIVERSE_INVALID');

    const firstFamily = base.factQueryCatalog.families[0];
    if (!firstFamily) {
      throw new Error('fixture family missing');
    }
    const unsupportedCatalogSemantic = {
      schemaVersion: 1 as const,
      capabilities: base.factQueryCatalog.capabilities,
      families: [
        { ...firstFamily, queryPackHash: undefined },
        ...base.factQueryCatalog.families.slice(1),
      ],
    };
    const unsupportedCatalog = {
      ...unsupportedCatalogSemantic,
      catalogHash: hashCanonicalJson(unsupportedCatalogSemantic),
    };
    expect(() =>
      validateStrictTestPreflightV1(
        rehashPlan(base, {
          factQueryCatalog: unsupportedCatalog,
          execution: {
            ...base.execution,
            factQueryCatalogHash: unsupportedCatalog.catalogHash,
          },
        }),
        preflightBindings()
      )
    ).toThrow('STRICT_TEST_FACT_QUERY_BACKEND_UNSUPPORTED');

    expect(() =>
      validateStrictTestPreflightV1(base, {
        ...preflightBindings(),
        certifiedProjectFactsContentHash: sha('wrong-facts-content'),
      })
    ).toThrow('STRICT_TEST_FACTS_LINEAGE_MISMATCH');
  });

  it('does not recommend architecture when its complete dimension slice is excluded', () => {
    const preflight = validateStrictTestPreflightV1(
      compiledPlan(new Set(['architecture'])),
      preflightBindings()
    );

    expect(
      preflight.dimensionResults.find((row) => row.dimensionId === 'architecture')
    ).toMatchObject({
      status: 'excluded',
      eligibleCellCount: 0,
      excludedCellCount: 1,
    });
    expect(preflight.recommendation.dimensionId).not.toBe('architecture');
    expect(preflight.recommendation.alternativeDimensionIds).not.toContain('architecture');
  });

  it('binds private final coverage, G4, serving validation, non-mutation, and audit terminal', () => {
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(compiledPlan(), bindings);
    const confirmation = createStrictTestSelectionConfirmationV1({
      preflight,
      currentBindings: bindings,
      selectedDimensionIds: ['architecture'],
      confirmedBy: 'user:fixture',
      confirmedAt: '2026-07-30T06:01:00.000Z',
    });
    const projection = createStrictTestDimensionExecutionProjectionV1({
      preflight,
      confirmation,
      currentBindings: bindings,
    });
    const privateG4ReceiptHash = sha('private-g4');
    const candidateDataManifestHash = sha('candidate-data-manifest');
    const finalCoverageSemantic = {
      schemaVersion: 1 as const,
      candidateCoverageReceiptHash: sha('candidate-coverage'),
      candidateCellSetHash: hashCanonicalJson(projection.executionCellIds),
      g4ReceiptHash: privateG4ReceiptHash,
      candidateDataManifestHash,
      cells: projection.executionCellIds.map((cellId) => ({
        cellId,
        finalDisposition: 'investigated-empty' as const,
        finalRecipeIds: [],
        finalRecipeFingerprints: [],
      })),
    };
    const finalCoverageBinding: FinalCoverageBindingReceiptV1 = {
      ...finalCoverageSemantic,
      receiptHash: hashCanonicalJson(finalCoverageSemantic),
    };
    const privateServingValidationHash = sha('private-serving-validation');
    const servingSemantic = {
      schemaVersion: 1 as const,
      sessionId: 'private-session-1',
      snapshotId: `snapshot-${candidateDataManifestHash.slice('sha256:'.length)}`,
      candidateDataManifestHash,
      finalCoverageBindingHash: finalCoverageBinding.receiptHash,
      servingSnapshotValidationHash: privateServingValidationHash,
      vectorGenerationId: 'private-vector-1',
      vectorManifestHash: sha('private-vector-manifest'),
      certifiedProjectFactsHash: preflight.certifiedProjectFactsContentHash,
      sourceRevisionVectorHash: preflight.sourceRevisionVectorHash,
      analysisFixpointHash: sha('analysis-fixpoint'),
    };
    const servingSnapshotManifest: ServingSnapshotManifestV1 = {
      ...servingSemantic,
      manifestHash: hashCanonicalJson(servingSemantic),
    };
    const terminal = createStrictTestPrivateCompletionReceiptV1({
      preflight,
      confirmation,
      projection,
      currentBindings: bindings,
      finalCoverageBinding,
      servingSnapshotManifest,
      privateG4ReceiptHash,
      privateServingValidationHash,
      productionAfterStateHash: preflight.productionBeforeStateHash,
      publicRouteAfterStateHash: preflight.publicRouteBeforeStateHash,
      privateEvidenceRefs: ['private:coverage', 'private:serving'],
      completedAt: '2026-07-30T06:30:00.000Z',
    });
    const report = createStrictTestAuditReportV1({
      preflight,
      confirmation,
      projection,
      terminal,
      verificationCommands: ['strict-test status --run strict-test-fixture-1'],
      privateArtifactRefs: ['private:report'],
    });

    expect(terminal.terminalState).toBe('STRICT_TEST_COMPLETED_PRIVATE');
    expect(terminal.productionFinalized).toBe(false);
    expect(terminal.publicRouteChanged).toBe(false);
    expect(report.fullUniverse.dimensionCount).toBe(26);
    expect(report.executedProjection.cellCount).toBe(1);
    expect(report.unexecutedDimensionIds).toHaveLength(25);
    expect(report.forbiddenConclusions).toContain('full-production-coverage');

    expect(() =>
      createStrictTestPrivateFailureReceiptV1({
        preflight,
        currentBindings: bindings,
        confirmationHash: confirmation.confirmationHash,
        projectionHash: projection.projectionHash,
        failedStage: 'PRIVATE_G4_READY',
        errorCode: 'PRIVATE_G4_REJECTED',
        privateEvidenceRefs: ['private:g4:error'],
        productionAfterStateHash: sha('mutated-production'),
        publicRouteAfterStateHash: preflight.publicRouteBeforeStateHash,
        failedAt: '2026-07-30T06:20:00.000Z',
      })
    ).toThrow('STRICT_TEST_PRODUCTION_MUTATION_DETECTED');
  });

  it('rejects a rehashed projection that omits 25 dimension states', () => {
    const { preflight, confirmation, projection } = privateCompletionChain();
    const selectedState = projection.dimensionStates.find(
      (state) => state.dimensionId === projection.selectedDimensionId
    );
    if (!selectedState) {
      throw new Error('fixture selected state missing');
    }
    const forged = rehashProjection(projection, {
      dimensionStates: [selectedState],
    });

    expect(() =>
      assertStrictTestDimensionExecutionProjectionV1(forged, preflight, confirmation)
    ).toThrow('STRICT_TEST_PROJECTION_INVALID');
  });

  it('rejects a rehashed projection with forged full-universe lineage', () => {
    const { preflight, confirmation, projection } = privateCompletionChain();
    const forged = rehashProjection(projection, {
      fullEligibleCellsHash: sha('forged-full-eligible-cells'),
    });

    expect(() =>
      assertStrictTestDimensionExecutionProjectionV1(forged, preflight, confirmation)
    ).toThrow('STRICT_TEST_PROJECTION_LINEAGE_MISMATCH');
  });

  it('rejects a rehashed confirmation moved to another demand and run', () => {
    const { preflight, confirmation } = privateCompletionChain();
    const { confirmationHash: _confirmationHash, ...confirmationSemantic } = confirmation;
    const forgedSemantic = {
      ...confirmationSemantic,
      demandKey: 'forged-demand',
      runId: 'forged-run',
    };
    const forged = {
      ...forgedSemantic,
      confirmationHash: hashCanonicalJson(forgedSemantic),
    };

    expect(() => assertStrictTestSelectionConfirmationV1(forged, preflight)).toThrow(
      'STRICT_TEST_CONFIRMATION_PREFLIGHT_MISMATCH'
    );
  });

  it('rejects a rehashed terminal with forged serving facts, source, and snapshot identity', () => {
    const { preflight, confirmation, projection, terminal } = privateCompletionChain();
    const forged = forgePrivateCompletionTerminal(terminal);
    const forgedLineageOnly = forgePrivateCompletionTerminal(terminal, false);

    expect(() =>
      assertStrictTestPrivateTerminalReceiptV1(forged, preflight, confirmation, projection)
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
    expect(() =>
      assertStrictTestPrivateTerminalReceiptV1(
        forgedLineageOnly,
        preflight,
        confirmation,
        projection
      )
    ).toThrow('STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID');
  });

  it('refuses to mint an audit report from a rehashed forged terminal', () => {
    const { preflight, confirmation, projection, terminal } = privateCompletionChain();
    const forged = forgePrivateCompletionTerminal(terminal);

    expect(() =>
      createStrictTestAuditReportV1({
        preflight,
        confirmation,
        projection,
        terminal: forged,
        verificationCommands: ['strict-test status --run strict-test-fixture-1'],
        privateArtifactRefs: ['private:report'],
      })
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
  });

  it('exports the same executable contract from plans and production facades', async () => {
    const plans = await import('../src/plans.js');
    const production = await import('../src/production.js');

    expect(plans.validateStrictTestPreflightV1).toBeInstanceOf(Function);
    expect(production.validateStrictTestPreflightV1).toBe(plans.validateStrictTestPreflightV1);
    expect(production.createStrictTestSelectionConfirmationV1).toBeInstanceOf(Function);
    expect(production.createStrictTestDimensionExecutionProjectionV1).toBeInstanceOf(Function);
  });
});

function compiledPlan(excludedDimensions = new Set<string>()): CompiledColdStartPlanV2 {
  const catalog = buildDimensionCatalogSnapshot();
  const anatomy = buildAnatomyLensCatalogSnapshot();
  const requiredFactApplicability = buildRequiredFactApplicabilityUniverseV1(
    [FIXTURE_MODULE],
    anatomy,
    FACT_QUERY_CATALOG
  );
  const cells = fixtureCells(catalog, excludedDimensions);
  const eligible = cells.filter((cell) => cell.status === 'eligible');
  const excluded = cells.filter((cell) => cell.status === 'excluded');
  const universe = {
    cells,
    universeCount: cells.length,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    cellUniverseHash: hashCanonicalJson(cells),
    eligibleCellsHash: hashCanonicalJson(eligible),
    excludedCellsHash: hashCanonicalJson(excluded),
  };
  const selection = {
    schemaVersion: 2 as const,
    kind: 'cold-start-upper-cap' as const,
    generationStage: 'coldStart' as const,
    moduleIds: ['core'],
    dimensionIds: catalog.dimensions.map((dimension) => dimension.id),
    eligibleCellIds: eligible.map((cell) => cell.cellId),
    excludedCellIds: excluded.map((cell) => cell.cellId),
    candidateAttemptCap: 0,
    maxAuthoredCandidatesPerCellPass: 0,
    semanticRepairLimit: 2 as const,
    batchBarrierVersion: 'candidate-batch-barrier-v1',
    policyVersion: 'coverage-plan-policy-v1',
    policyHash: sha('policy'),
    modulePlanningFactsHash: sha('module-facts'),
    sourceArtifactHash: sha('source-artifact'),
    strictConfigReceiptHash: sha('strict-config'),
    authoringPolicy: {
      policy: 'evidence-bounded-no-floor' as const,
      candidateAttempts: 'upper-bound-only' as const,
      authoredCandidates: 'zero-to-many' as const,
      quantityFloor: null,
      semanticRepairLimit: 2 as const,
      batchFailureMode: 'whole-batch' as const,
    },
    deferredCells: [] as const,
    resourceCaps: {
      providerRequestCap: 100,
      detailRequestCap: 100,
      tokenCap: 1_000_000,
      timeMsCap: 300_000,
      costMicrousdCap: 2_000_000,
      factQueryObligationCap: 1_000,
    },
  };
  const schedule = {
    schemaVersion: 1 as const,
    factHarvestObligations: [],
    lensBindings: [],
    factHarvestScheduleHash: hashCanonicalJson([]),
    lensBindingsHash: hashCanonicalJson([]),
    baselineScheduleHash: hashCanonicalJson({
      factHarvestScheduleHash: hashCanonicalJson([]),
      lensBindingsHash: hashCanonicalJson([]),
    }),
  };
  const execution = {
    schemaVersion: 2 as const,
    factsBindingHash: sha('facts-content'),
    sourceRevisionVectorHash: sha('source-revision'),
    planCognitionHash: sha('plan-cognition'),
    orderedDimensionIds: catalog.dimensions.map((dimension) => dimension.id),
    orderedCells: eligible.map((cell) => cell.cellId),
    orderedInvestigationActions: [],
    anatomyApplicabilityHash: requiredFactApplicability.universeHash,
    lensBindingsHash: schedule.lensBindingsHash,
    factHarvestScheduleHash: schedule.factHarvestScheduleHash,
    factQueryCatalogHash: FACT_QUERY_CATALOG.catalogHash,
    moduleScope: ['core'],
    synthesisPrerequisites: {},
    resourceCaps: selection.resourceCaps,
  };
  const semantic = {
    schemaVersion: 2 as const,
    compilerVersion: 'cold-start-plan-compiler-v2' as const,
    catalog,
    anatomy,
    requiredFactApplicability,
    factQueryCatalog: FACT_QUERY_CATALOG,
    universe,
    schedule,
    selection,
    execution,
  };
  return {
    ...semantic,
    canonicalPlanHash: hashCanonicalJson(semantic),
  };
}

function fixtureCells(
  catalog: DimensionCatalogSnapshotV1,
  excludedDimensions: ReadonlySet<string>
): PlanCellV1[] {
  return catalog.dimensions.map((dimension) =>
    excludedDimensions.has(dimension.id)
      ? {
          cellId: `core::${dimension.id}`,
          moduleId: 'core',
          scopeId: 'repo:core',
          dimensionId: dimension.id,
          criticality: 'standard',
          status: 'excluded',
          exclusionReason: 'ROLE_NOT_APPLICABLE',
          evidenceRefs: ['ref:core', `ref:excluded:${dimension.id}`],
          synthesisPrerequisiteCellIds: [],
        }
      : {
          cellId: `core::${dimension.id}`,
          moduleId: 'core',
          scopeId: 'repo:core',
          dimensionId: dimension.id,
          criticality: 'standard',
          status: 'eligible',
          evidenceRefs: ['ref:core'],
          synthesisPrerequisiteCellIds: [],
        }
  );
}

function preflightBindings(): StrictTestPreflightBindingsV1 {
  return {
    schemaVersion: 1,
    profile: STRICT_TEST_DIMENSION_PROFILE_V1,
    demandKey: 'recipe-coldstart-production-quality-2026-07-15',
    runId: 'strict-test-fixture-1',
    projectRootIdentity: 'project-root:BiliDili',
    controlRootIdentity: 'control-root:AlembicWorkspace',
    sourceRootIdentity: 'source-root:BiliDili',
    canonicalProjectIdentityHash: sha('project-identity'),
    sourceRevisionVectorHash: sha('source-revision'),
    sourceInventoryHash: sha('source-inventory'),
    sourceFileCount: 24,
    moduleCount: 1,
    languageCount: 1,
    parserCount: 1,
    backendCount: 7,
    certifiedProjectFactsArtifactHash: sha('facts-artifact'),
    certifiedProjectFactsContentHash: sha('facts-content'),
    certifiedProjectFactsSourceArtifactHash: sha('source-artifact'),
    certifiedProjectFactsSourceVectorHash: sha('source-revision'),
    certifiedProjectFactsConsumerReceiptHash: sha('facts-consumer'),
    strictConfigReceiptHash: sha('strict-config'),
    providerModelHash: sha('provider-model'),
    promptSopHash: sha('prompt-sop'),
    factQueryBackendHash: sha('fact-query-backend'),
    parserBackendHash: sha('parser-backend'),
    embeddingVectorHash: sha('embedding-vector'),
    runtimeArtifactManifestHash: sha('runtime-manifest'),
    runtimeArtifactBindingHash: sha('runtime-binding'),
    productionBeforeStateHash: sha('production-before'),
    productionAfterReadStateHash: sha('production-before'),
    publicRouteBeforeStateHash: sha('public-route-before'),
    officialRecipeBeforeStateHash: sha('official-recipe-before'),
    privateWorkspacePolicyHash: sha('private-workspace-policy'),
    generatedAt: '2026-07-30T06:00:00.000Z',
    validUntil: '2026-07-30T07:00:00.000Z',
  };
}

function privateCompletionChain() {
  const bindings = preflightBindings();
  const preflight = validateStrictTestPreflightV1(compiledPlan(), bindings);
  const confirmation = createStrictTestSelectionConfirmationV1({
    preflight,
    currentBindings: bindings,
    selectedDimensionIds: ['architecture'],
    confirmedBy: 'user:fixture',
    confirmedAt: '2026-07-30T06:01:00.000Z',
  });
  const projection = createStrictTestDimensionExecutionProjectionV1({
    preflight,
    confirmation,
    currentBindings: bindings,
  });
  const privateG4ReceiptHash = sha('private-g4');
  const candidateDataManifestHash = sha('candidate-data-manifest');
  const finalCoverageSemantic = {
    schemaVersion: 1 as const,
    candidateCoverageReceiptHash: sha('candidate-coverage'),
    candidateCellSetHash: hashCanonicalJson(projection.executionCellIds),
    g4ReceiptHash: privateG4ReceiptHash,
    candidateDataManifestHash,
    cells: projection.executionCellIds.map((cellId) => ({
      cellId,
      finalDisposition: 'investigated-empty' as const,
      finalRecipeIds: [],
      finalRecipeFingerprints: [],
    })),
  };
  const finalCoverageBinding: FinalCoverageBindingReceiptV1 = {
    ...finalCoverageSemantic,
    receiptHash: hashCanonicalJson(finalCoverageSemantic),
  };
  const privateServingValidationHash = sha('private-serving-validation');
  const servingSemantic = {
    schemaVersion: 1 as const,
    sessionId: 'private-session-1',
    snapshotId: `snapshot-${candidateDataManifestHash.slice('sha256:'.length)}`,
    candidateDataManifestHash,
    finalCoverageBindingHash: finalCoverageBinding.receiptHash,
    servingSnapshotValidationHash: privateServingValidationHash,
    vectorGenerationId: 'private-vector-1',
    vectorManifestHash: sha('private-vector-manifest'),
    certifiedProjectFactsHash: preflight.certifiedProjectFactsContentHash,
    sourceRevisionVectorHash: preflight.sourceRevisionVectorHash,
    analysisFixpointHash: sha('analysis-fixpoint'),
  };
  const servingSnapshotManifest: ServingSnapshotManifestV1 = {
    ...servingSemantic,
    manifestHash: hashCanonicalJson(servingSemantic),
  };
  const terminal = createStrictTestPrivateCompletionReceiptV1({
    preflight,
    confirmation,
    projection,
    currentBindings: bindings,
    finalCoverageBinding,
    servingSnapshotManifest,
    privateG4ReceiptHash,
    privateServingValidationHash,
    productionAfterStateHash: preflight.productionBeforeStateHash,
    publicRouteAfterStateHash: preflight.publicRouteBeforeStateHash,
    privateEvidenceRefs: ['private:coverage', 'private:serving'],
    completedAt: '2026-07-30T06:30:00.000Z',
  });
  return { bindings, preflight, confirmation, projection, terminal };
}

function rehashProjection(
  projection: ReturnType<typeof createStrictTestDimensionExecutionProjectionV1>,
  overrides: Partial<
    Omit<ReturnType<typeof createStrictTestDimensionExecutionProjectionV1>, 'projectionHash'>
  >
) {
  const { projectionHash: _projectionHash, ...semantic } = projection;
  const forgedSemantic = { ...semantic, ...overrides };
  return {
    ...forgedSemantic,
    projectionHash: hashCanonicalJson(forgedSemantic),
  };
}

function forgePrivateCompletionTerminal(
  terminal: ReturnType<typeof createStrictTestPrivateCompletionReceiptV1>,
  emptySnapshot = true
) {
  const { manifestHash: _manifestHash, ...servingSemantic } = terminal.servingSnapshotManifest;
  const forgedServingSemantic = {
    ...servingSemantic,
    snapshotId: emptySnapshot ? '' : servingSemantic.snapshotId,
    certifiedProjectFactsHash: sha('forged-certified-facts'),
    sourceRevisionVectorHash: sha('forged-source-revision'),
  };
  const forgedServing = {
    ...forgedServingSemantic,
    manifestHash: hashCanonicalJson(forgedServingSemantic),
  };
  const { terminalHash: _terminalHash, ...terminalSemantic } = terminal;
  const forgedTerminalSemantic = {
    ...terminalSemantic,
    servingSnapshotManifest: forgedServing,
  };
  return {
    ...forgedTerminalSemantic,
    terminalHash: hashCanonicalJson(forgedTerminalSemantic),
  };
}

function rehashPlan(
  plan: CompiledColdStartPlanV2,
  overrides: Partial<Omit<CompiledColdStartPlanV2, 'canonicalPlanHash'>>
): CompiledColdStartPlanV2 {
  const { canonicalPlanHash: _canonicalPlanHash, ...semantic } = plan;
  const next = { ...semantic, ...overrides };
  return { ...next, canonicalPlanHash: hashCanonicalJson(next) };
}

function family(id: string, capabilityId: string): FactQueryFamilyV1 {
  return {
    id,
    capabilityId,
    supportedScales: [
      'source-range',
      'symbol',
      'file',
      'module',
      'package',
      'repository',
      'project',
    ],
    queryPackHash: sha(`${id}:query-pack`),
    loadedProducer: `loaded:${capabilityId}:fixture-v1`,
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

import { describe, expect, it } from 'vitest';

import {
  assertStrictTestAutomaticSelectionReceiptV1,
  assertStrictTestDimensionExecutionProjectionV1,
  assertStrictTestPrivateTerminalReceiptV1,
  buildAnatomyLensCatalogSnapshot,
  buildDimensionCatalogSnapshot,
  buildFactQueryCatalogSnapshot,
  buildRequiredFactApplicabilityUniverseV1,
  type CompiledColdStartPlanV2,
  createStrictTestAuditReportV1,
  createStrictTestAutomaticSelectionReceiptV1,
  createStrictTestDimensionExecutionProjectionV1,
  createStrictTestPreflightPreviewV1,
  createStrictTestPrivateCompletionReceiptV1,
  createStrictTestPrivateFailureReceiptV1,
  type DimensionCatalogSnapshotV1,
  type FactQueryCatalogSnapshotV1,
  type FactQueryFamilyV1,
  hashStrictTestPreflightBindingsV1,
  type PlanCellV1,
  resolveStrictTestFailureStageAuthorityV1,
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
const FAILURE_STAGE_AUTHORITY_CASES = [
  {
    failedStage: 'PREFLIGHT_REQUESTED',
    preflight: 'forbidden',
    automaticSelection: 'forbidden',
    projection: 'forbidden',
  },
  {
    failedStage: 'PREFLIGHT_FACTS_FROZEN',
    preflight: 'forbidden',
    automaticSelection: 'forbidden',
    projection: 'forbidden',
  },
  {
    failedStage: 'PREFLIGHT_UNIVERSE_VALIDATED',
    preflight: 'forbidden',
    automaticSelection: 'forbidden',
    projection: 'forbidden',
  },
  {
    failedStage: 'AUTOMATIC_SELECTION_READY',
    preflight: 'required',
    automaticSelection: 'forbidden',
    projection: 'forbidden',
  },
  {
    failedStage: 'SELECTION_AUTO_SELECTED',
    preflight: 'required',
    automaticSelection: 'required',
    projection: 'forbidden',
  },
  ...[
    'PRIVATE_WORKSPACE_READY',
    'PLAN_COMPILED',
    'FACT_SCHEDULE_FROZEN',
    'ANALYSIS_FIXPOINT_CLOSED',
    'EXPRESSION_SETS_REVIEWED',
    'PRIVATE_CORPUS_SEALED',
    'PRIVATE_INDEXES_VERIFIED',
    'PRIVATE_G4_READY',
    'PRIVATE_SERVING_VALIDATED',
  ].map((failedStage) => ({
    failedStage,
    preflight: 'required',
    automaticSelection: 'required',
    projection: 'required',
  })),
] as const;
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
    expect(preview.canAutoSelect).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preflight.bindingHash).toBe(hashStrictTestPreflightBindingsV1(bindings));
  });

  it('automatically selects the recommendation and projects its complete eligible-cell set', () => {
    const plan = compiledPlan();
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(plan, bindings);
    const automaticSelection = createStrictTestAutomaticSelectionReceiptV1({
      preflight,
      currentBindings: bindings,
      selectedAt: '2026-07-30T06:01:00.000Z',
    });
    const projection = createStrictTestDimensionExecutionProjectionV1({
      preflight,
      automaticSelection,
      currentBindings: bindings,
      projectedAt: '2026-07-30T06:02:00.000Z',
    });

    expect(automaticSelection.selectedDimensionId).toBe('architecture');
    expect(automaticSelection.selectedEligibleCellIds).toEqual(['core::architecture']);
    expect(automaticSelection.algorithmVersion).toBe('strict-test-preflight-recommendation-v1');
    expect(automaticSelection.recommendationReasonCode).toBe(preflight.recommendation.reasonCode);
    expect(automaticSelection.recommendationEvidenceRefs).toEqual(
      preflight.recommendation.evidenceRefs
    );
    expect(projection.executionCellIds).toEqual(automaticSelection.selectedEligibleCellIds);
    expect(projection.fullCellUniverseHash).toBe(preflight.fullCellUniverseHash);
    expect(projection.fullCatalogHash).toBe(preflight.catalog.catalogHash);
    expect(projection.fullCatalogSourceArtifactHash).toBe(preflight.catalog.sourceArtifactHash);
    expect(projection.fullEligibleCellsHash).toBe(preflight.cellUniverse.eligibleCellsHash);
    expect(projection.fullExcludedCellsHash).toBe(preflight.cellUniverse.excludedCellsHash);
    expect(projection.fullApplicabilityUniverseHash).toBe(
      preflight.requiredFactApplicabilityUniverseHash
    );
    expect(projection.fullFactQueryCatalogHash).toBe(preflight.factQueryCatalogHash);
    expect(projection.fullBaselineScheduleHash).toBe(preflight.baselineScheduleHash);
    expect(projection.automaticSelectionHash).toBe(automaticSelection.automaticSelectionHash);
    expect(projection.dimensionStates).toHaveLength(26);
    expect(
      projection.dimensionStates.filter((state) => state.disposition === 'selected-for-execution')
    ).toHaveLength(1);
    expect(
      projection.dimensionStates.find((state) => state.dimensionId === 'coding-standards')
        ?.disposition
    ).toBe('not-executed-by-strict-test-profile');
    expect(projection.productionFinalized).toBe(false);
    expect(projection.publicRouteChanged).toBe(false);
    expect(plan.selection.deferredCells).toEqual([]);
  });

  it('rejects caller selection/manual hints and fails closed for binding drift', () => {
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(
      compiledPlan(new Set(['architecture'])),
      bindings
    );

    for (const forbiddenField of [
      ['selectedDimensionId', 'architecture'],
      ['selectedDimensionIds', ['architecture']],
      ['confirmedBy', 'user:fixture'],
      ['dimensions', ['architecture']],
      ['testMode', true],
      ['pluginHint', 'architecture'],
      ['dashboardHint', 'architecture'],
    ] as const) {
      expect(() =>
        createStrictTestAutomaticSelectionReceiptV1({
          preflight,
          currentBindings: bindings,
          selectedAt: '2026-07-30T06:01:00.000Z',
          [forbiddenField[0]]: forbiddenField[1],
        } as never)
      ).toThrow('STRICT_TEST_AUTOMATIC_SELECTION_FIELDS_INVALID');
    }

    const automaticSelection = createStrictTestAutomaticSelectionReceiptV1({
      preflight,
      currentBindings: bindings,
      selectedAt: '2026-07-30T06:01:00.000Z',
    });
    expect(automaticSelection.selectedDimensionId).toBe(preflight.recommendation.dimensionId);
    expect(automaticSelection.selectedDimensionId).not.toBe('architecture');

    const drifted = {
      ...bindings,
      strictConfigReceiptHash: sha('different-config'),
    };
    expect(() =>
      createStrictTestAutomaticSelectionReceiptV1({
        preflight,
        currentBindings: drifted,
        selectedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_PREFLIGHT_DRIFT');

    expect(() =>
      createStrictTestAutomaticSelectionReceiptV1({
        preflight,
        currentBindings: bindings,
        selectedAt: '2026-07-30T05:59:59.000Z',
      })
    ).toThrow('STRICT_TEST_PREFLIGHT_TIME_INVALID');
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
    const automaticSelection = createStrictTestAutomaticSelectionReceiptV1({
      preflight,
      currentBindings: preflightBindings(),
      selectedAt: '2026-07-30T06:01:00.000Z',
    });

    expect(
      preflight.dimensionResults.find((row) => row.dimensionId === 'architecture')
    ).toMatchObject({
      status: 'excluded',
      eligibleCellCount: 0,
      excludedCellCount: 1,
    });
    expect(preflight.recommendation.dimensionId).not.toBe('architecture');
    expect(preflight.recommendation.alternativeDimensionIds).not.toContain('architecture');
    expect(automaticSelection.selectedDimensionId).toBe(preflight.recommendation.dimensionId);
    expect(automaticSelection.recommendationReasonCode).toBe(
      'FIRST_EVIDENCE_SUPPORTED_APPLICABLE_DIMENSION'
    );
  });

  it('fails before selection for zero, unknown, unsupported, empty, or forged recommendations', () => {
    const allDimensions = buildDimensionCatalogSnapshot().dimensions.map(
      (dimension) => dimension.id
    );
    expect(() =>
      validateStrictTestPreflightV1(compiledPlan(new Set(allDimensions)), preflightBindings())
    ).toThrow('STRICT_TEST_PREFLIGHT_EMPTY_APPLICABLE_UNIVERSE');

    const preflight = validateStrictTestPreflightV1(compiledPlan(), preflightBindings());
    const recommendationSemantic = {
      ...preflight.recommendation,
      dimensionId: 'unknown-dimension',
      recommendationHash: undefined,
    };
    const { recommendationHash: _recommendationHash, ...recommendationWithoutHash } =
      recommendationSemantic;
    const forgedRecommendation = {
      ...recommendationWithoutHash,
      recommendationHash: hashCanonicalJson(recommendationWithoutHash),
    };
    const { preflightHash: _preflightHash, ...preflightSemantic } = preflight;
    const forgedPreflightSemantic = {
      ...preflightSemantic,
      recommendation: forgedRecommendation,
    };
    const forgedPreflight = {
      ...forgedPreflightSemantic,
      preflightHash: hashCanonicalJson(forgedPreflightSemantic),
    };

    expect(() =>
      createStrictTestAutomaticSelectionReceiptV1({
        preflight: forgedPreflight,
        currentBindings: preflightBindings(),
        selectedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_PREFLIGHT_RECOMMENDATION_INVALID');

    const selectedIndex = preflight.dimensionResults.findIndex(
      (row) => row.dimensionId === preflight.recommendation.dimensionId
    );
    for (const selectedPatch of [
      { status: 'unknown' as const },
      { requiredFactsSupported: false },
      { eligibleCellIds: [] as readonly string[], eligibleCellCount: 0 },
    ]) {
      const dimensionResults = preflight.dimensionResults.map((row, index) =>
        index === selectedIndex ? { ...row, ...selectedPatch } : row
      );
      const forgedSemantic = {
        ...preflightSemantic,
        dimensionResults,
      };
      const forged = {
        ...forgedSemantic,
        preflightHash: hashCanonicalJson(forgedSemantic),
      };
      expect(() =>
        createStrictTestAutomaticSelectionReceiptV1({
          preflight: forged,
          currentBindings: preflightBindings(),
          selectedAt: '2026-07-30T06:01:00.000Z',
        })
      ).toThrow('STRICT_TEST_PREFLIGHT_RECEIPT_INVALID');
    }
  });

  it('binds private final coverage, G4, serving validation, non-mutation, and audit terminal', () => {
    const bindings = preflightBindings();
    const preflight = validateStrictTestPreflightV1(compiledPlan(), bindings);
    const automaticSelection = createStrictTestAutomaticSelectionReceiptV1({
      preflight,
      currentBindings: bindings,
      selectedAt: '2026-07-30T06:01:00.000Z',
    });
    const projection = createStrictTestDimensionExecutionProjectionV1({
      preflight,
      automaticSelection,
      currentBindings: bindings,
      projectedAt: '2026-07-30T06:02:00.000Z',
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
      automaticSelection,
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
      context: { currentBindings: bindings, preflight, automaticSelection, projection },
      terminal,
      verificationCommands: ['strict-test status --run strict-test-fixture-1'],
      privateArtifactRefs: ['private:report'],
    });

    expect(terminal.terminalState).toBe('STRICT_TEST_COMPLETED_PRIVATE');
    expect(terminal.productionFinalized).toBe(false);
    expect(terminal.publicRouteChanged).toBe(false);
    expect(report.fullUniverse?.dimensionCount).toBe(26);
    expect(report.executedProjection?.cellCount).toBe(1);
    expect(report.unexecutedDimensionIds).toHaveLength(25);
    expect(report.failure).toBeNull();
    expect(report.forbiddenConclusions).toContain('full-production-coverage');

    expect(() =>
      createStrictTestPrivateFailureReceiptV1({
        context: { currentBindings: bindings, preflight, automaticSelection, projection },
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
    const { preflight, automaticSelection, projection } = privateCompletionChain();
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
      assertStrictTestDimensionExecutionProjectionV1(forged, preflight, automaticSelection)
    ).toThrow('STRICT_TEST_PROJECTION_INVALID');
  });

  it('rejects a rehashed projection with forged full-universe lineage', () => {
    const { preflight, automaticSelection, projection } = privateCompletionChain();
    const forged = rehashProjection(projection, {
      fullEligibleCellsHash: sha('forged-full-eligible-cells'),
    });

    expect(() =>
      assertStrictTestDimensionExecutionProjectionV1(forged, preflight, automaticSelection)
    ).toThrow('STRICT_TEST_PROJECTION_LINEAGE_MISMATCH');
  });

  it('rejects stale, rehashed, cross-run, cross-demand, or tampered automatic selection', () => {
    const { preflight, automaticSelection } = privateCompletionChain();
    const { automaticSelectionHash: _automaticSelectionHash, ...automaticSelectionSemantic } =
      automaticSelection;
    const forgedSemantic = {
      ...automaticSelectionSemantic,
      demandKey: 'forged-demand',
      runId: 'forged-run',
    };
    const forged = {
      ...forgedSemantic,
      automaticSelectionHash: hashCanonicalJson(forgedSemantic),
    };

    expect(() => assertStrictTestAutomaticSelectionReceiptV1(forged, preflight)).toThrow(
      'STRICT_TEST_AUTOMATIC_SELECTION_PREFLIGHT_MISMATCH'
    );

    expect(() =>
      assertStrictTestAutomaticSelectionReceiptV1(
        {
          ...automaticSelection,
          selectedDimensionId: 'coding-standards',
        },
        preflight
      )
    ).toThrow('STRICT_TEST_AUTOMATIC_SELECTION_HASH_MISMATCH');

    const invalidTimeSemantic = {
      ...automaticSelectionSemantic,
      selectedAt: 'not-a-timestamp',
    };
    const invalidTime = {
      ...invalidTimeSemantic,
      automaticSelectionHash: hashCanonicalJson(invalidTimeSemantic),
    };
    expect(() => assertStrictTestAutomaticSelectionReceiptV1(invalidTime, preflight)).toThrow(
      'STRICT_TEST_AUTOMATIC_SELECTION_TIME_INVALID'
    );

    const replacedCellsSemantic = {
      ...automaticSelectionSemantic,
      selectedEligibleCellIds: ['forged::cell'],
      selectedEligibleCellsHash: hashCanonicalJson(['forged::cell']),
    };
    const replacedCells = {
      ...replacedCellsSemantic,
      automaticSelectionHash: hashCanonicalJson(replacedCellsSemantic),
    };
    expect(() => assertStrictTestAutomaticSelectionReceiptV1(replacedCells, preflight)).toThrow(
      'STRICT_TEST_AUTOMATIC_SELECTION_PREFLIGHT_MISMATCH'
    );

    const expiredBindings = {
      ...preflightBindings(),
      validUntil: '2026-07-30T06:00:30.000Z',
    };
    const expiredPreflight = validateStrictTestPreflightV1(compiledPlan(), expiredBindings);
    expect(() =>
      createStrictTestAutomaticSelectionReceiptV1({
        preflight: expiredPreflight,
        currentBindings: expiredBindings,
        selectedAt: '2026-07-30T06:01:00.000Z',
      })
    ).toThrow('STRICT_TEST_PREFLIGHT_EXPIRED');
  });

  it('rejects a rehashed terminal with forged serving facts, source, and snapshot identity', () => {
    const { preflight, automaticSelection, projection, terminal } = privateCompletionChain();
    const forged = forgePrivateCompletionTerminal(terminal);
    const forgedLineageOnly = forgePrivateCompletionTerminal(terminal, false);

    expect(() =>
      assertStrictTestPrivateTerminalReceiptV1(forged, {
        currentBindings: preflightBindings(),
        preflight,
        automaticSelection,
        projection,
      })
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
    expect(() =>
      assertStrictTestPrivateTerminalReceiptV1(forgedLineageOnly, {
        currentBindings: preflightBindings(),
        preflight,
        automaticSelection,
        projection,
      })
    ).toThrow('STRICT_TEST_PRIVATE_SERVING_LINEAGE_INVALID');
  });

  it('refuses to mint an audit report from a rehashed forged terminal', () => {
    const { preflight, automaticSelection, projection, terminal } = privateCompletionChain();
    const forged = forgePrivateCompletionTerminal(terminal);

    expect(() =>
      createStrictTestAuditReportV1({
        context: {
          currentBindings: preflightBindings(),
          preflight,
          automaticSelection,
          projection,
        },
        terminal: forged,
        verificationCommands: ['strict-test status --run strict-test-fixture-1'],
        privateArtifactRefs: ['private:report'],
      })
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
  });

  it('applies the exact failure authority matrix to all 14 non-completed stages', () => {
    const chain = privateCompletionChain();

    for (const row of FAILURE_STAGE_AUTHORITY_CASES) {
      const context = failureAuthorityContext(chain, row);
      const terminal = createFailureReceipt(context, row.failedStage);

      expect(() => assertStrictTestPrivateTerminalReceiptV1(terminal, context)).not.toThrow();
      expect(terminal.observedBindingsHash).toBe(
        hashStrictTestPreflightBindingsV1(context.currentBindings)
      );
      expect(terminal.preflightHash).toBe(context.preflight?.preflightHash ?? null);
      expect(terminal.automaticSelectionHash).toBe(
        context.automaticSelection?.automaticSelectionHash ?? null
      );
      expect(terminal.projectionHash).toBe(context.projection?.projectionHash ?? null);

      const report = createStrictTestAuditReportV1({
        context,
        terminal,
        verificationCommands: ['strict-test status --run strict-test-fixture-1'],
        privateArtifactRefs: ['private:report'],
      });
      expect(report.preflightHash).toBe(terminal.preflightHash);
      expect(report.automaticSelectionHash).toBe(terminal.automaticSelectionHash);
      expect(report.projectionHash).toBe(terminal.projectionHash);
      expect(report.fullUniverse === null).toBe(context.preflight === null);
      expect(report.executedProjection === null).toBe(context.projection === null);
      expect(report.unexecutedDimensionIds === null).toBe(context.projection === null);
      expect(report.failure).toEqual({
        failedStage: row.failedStage,
        errorCode: `${row.failedStage}_REJECTED`,
      });
      expect(report.privateArtifactRefs).toEqual([
        `private:failure:${row.failedStage}`,
        'private:report',
      ]);
    }
  });

  it('rejects every missing required authority and every forbidden extra authority', () => {
    const chain = privateCompletionChain();

    for (const row of FAILURE_STAGE_AUTHORITY_CASES) {
      const exact = failureAuthorityContext(chain, row);
      const missingKey = (['projection', 'automaticSelection', 'preflight'] as const).find(
        (key) => row[key] === 'required'
      );
      if (missingKey) {
        expect(() =>
          createFailureReceipt({ ...exact, [missingKey]: null }, row.failedStage)
        ).toThrow('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH');
      }

      const extraKey = (['preflight', 'automaticSelection', 'projection'] as const).find(
        (key) => row[key] === 'forbidden'
      );
      if (extraKey) {
        expect(() =>
          createFailureReceipt({ ...exact, [extraKey]: chain[extraKey] }, row.failedStage)
        ).toThrow('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH');
      }
    }

    const awaiting = failureAuthorityContext(
      chain,
      FAILURE_STAGE_AUTHORITY_CASES.find((row) => row.failedStage === 'AUTOMATIC_SELECTION_READY')!
    );
    expect(() =>
      createFailureReceipt(
        { ...awaiting, preflight: undefined } as never,
        'AUTOMATIC_SELECTION_READY'
      )
    ).toThrow('STRICT_TEST_FAILURE_AUTHORITY_MISMATCH');
    expect(() => resolveStrictTestFailureStageAuthorityV1('STRICT_TEST_COMPLETED_PRIVATE')).toThrow(
      'STRICT_TEST_FAILURE_FIELDS_INVALID'
    );
  });

  it('rejects rehashed authority predecessors and terminal hash substitutions', () => {
    const chain = privateCompletionChain();
    const context = failureAuthorityContext(
      chain,
      FAILURE_STAGE_AUTHORITY_CASES.find((row) => row.failedStage === 'PRIVATE_G4_READY')!
    );
    const terminal = createFailureReceipt(context, 'PRIVATE_G4_READY');

    for (const field of [
      'observedBindingsHash',
      'preflightHash',
      'automaticSelectionHash',
      'projectionHash',
    ] as const) {
      const { terminalHash: _terminalHash, ...semantic } = terminal;
      const forgedSemantic = { ...semantic, [field]: sha(`mismatched-${field}`) };
      const forged = {
        ...forgedSemantic,
        terminalHash: hashCanonicalJson(forgedSemantic),
      };
      expect(() => assertStrictTestPrivateTerminalReceiptV1(forged, context)).toThrow(
        'STRICT_TEST_FAILURE_AUTHORITY_MISMATCH'
      );
    }

    const { automaticSelectionHash: _automaticSelectionHash, ...automaticSelectionSemantic } =
      chain.automaticSelection;
    const forgedAutomaticSelectionSemantic = {
      ...automaticSelectionSemantic,
      preflightHash: sha('mismatched-automaticSelection-preflight'),
    };
    const forgedAutomaticSelection = {
      ...forgedAutomaticSelectionSemantic,
      automaticSelectionHash: hashCanonicalJson(forgedAutomaticSelectionSemantic),
    };
    expect(() =>
      createFailureReceipt(
        { ...context, automaticSelection: forgedAutomaticSelection },
        'PRIVATE_G4_READY'
      )
    ).toThrow('STRICT_TEST_AUTOMATIC_SELECTION_PREFLIGHT_MISMATCH');

    const { projectionHash: _projectionHash, ...projectionSemantic } = chain.projection;
    const forgedProjectionSemantic = {
      ...projectionSemantic,
      automaticSelectionHash: sha('mismatched-projection-automaticSelection'),
    };
    const forgedProjection = {
      ...forgedProjectionSemantic,
      projectionHash: hashCanonicalJson(forgedProjectionSemantic),
    };
    expect(() =>
      createFailureReceipt({ ...context, projection: forgedProjection }, 'PRIVATE_G4_READY')
    ).toThrow('STRICT_TEST_PROJECTION_LINEAGE_MISMATCH');
  });

  it('rejects each authority timestamp that occurs after failedAt', () => {
    const currentBindingsAfterFailure = {
      ...preflightBindings(),
      generatedAt: '2026-07-30T06:10:00.000Z',
      validUntil: '2026-07-30T07:10:00.000Z',
    };
    expect(() =>
      createFailureReceipt(
        {
          currentBindings: currentBindingsAfterFailure,
          preflight: null,
          automaticSelection: null,
          projection: null,
        },
        'PREFLIGHT_REQUESTED',
        '2026-07-30T06:05:00.000Z'
      )
    ).toThrow('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE');

    const futurePreflightBindings = {
      ...preflightBindings(),
      generatedAt: '2026-07-30T06:10:00.000Z',
      validUntil: '2026-07-30T07:10:00.000Z',
    };
    const futurePreflight = validateStrictTestPreflightV1(compiledPlan(), futurePreflightBindings);
    expect(() =>
      createFailureReceipt(
        {
          currentBindings: futurePreflightBindings,
          preflight: futurePreflight,
          automaticSelection: null,
          projection: null,
        },
        'AUTOMATIC_SELECTION_READY',
        '2026-07-30T06:05:00.000Z'
      )
    ).toThrow('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE');

    const automaticSelectionAfterFailure = privateCompletionChain({
      selectedAt: '2026-07-30T06:10:00.000Z',
      projectedAt: '2026-07-30T06:11:00.000Z',
    });
    expect(() =>
      createFailureReceipt(
        {
          currentBindings: automaticSelectionAfterFailure.bindings,
          preflight: automaticSelectionAfterFailure.preflight,
          automaticSelection: automaticSelectionAfterFailure.automaticSelection,
          projection: null,
        },
        'SELECTION_AUTO_SELECTED',
        '2026-07-30T06:05:00.000Z'
      )
    ).toThrow('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE');

    const projectionAfterFailure = privateCompletionChain({
      selectedAt: '2026-07-30T06:01:00.000Z',
      projectedAt: '2026-07-30T06:10:00.000Z',
    });
    expect(() =>
      createFailureReceipt(
        {
          currentBindings: projectionAfterFailure.bindings,
          preflight: projectionAfterFailure.preflight,
          automaticSelection: projectionAfterFailure.automaticSelection,
          projection: projectionAfterFailure.projection,
        },
        'PRIVATE_WORKSPACE_READY',
        '2026-07-30T06:05:00.000Z'
      )
    ).toThrow('STRICT_TEST_FAILURE_CONTEXT_AFTER_FAILURE');
  });

  it('records expired or drifted preflight evidence instead of applying success currency gates', () => {
    const expiredBindings = {
      ...preflightBindings(),
      validUntil: '2026-07-30T06:05:00.000Z',
    };
    const expiredPreflight = validateStrictTestPreflightV1(compiledPlan(), expiredBindings);
    const expiredContext = {
      currentBindings: expiredBindings,
      preflight: expiredPreflight,
      automaticSelection: null,
      projection: null,
    };
    const expiredTerminal = createFailureReceipt(
      expiredContext,
      'AUTOMATIC_SELECTION_READY',
      '2026-07-30T06:20:00.000Z'
    );
    expect(() =>
      assertStrictTestPrivateTerminalReceiptV1(expiredTerminal, expiredContext)
    ).not.toThrow();

    const chain = privateCompletionChain();
    const observedBindings = {
      ...chain.bindings,
      strictConfigReceiptHash: sha('drifted-strict-config'),
      generatedAt: '2026-07-30T06:15:00.000Z',
      validUntil: '2026-07-30T07:15:00.000Z',
    };
    const context = {
      currentBindings: observedBindings,
      preflight: chain.preflight,
      automaticSelection: null,
      projection: null,
    };

    const terminal = createFailureReceipt(
      context,
      'AUTOMATIC_SELECTION_READY',
      '2026-07-30T06:20:00.000Z'
    );
    expect(terminal.observedBindingsHash).toBe(hashStrictTestPreflightBindingsV1(observedBindings));
    expect(() => assertStrictTestPrivateTerminalReceiptV1(terminal, context)).not.toThrow();
  });

  it('rejects the retired raw-hash failure input instead of providing an overload or fallback', () => {
    const { bindings, preflight, automaticSelection, projection } = privateCompletionChain();
    const legacyInput = {
      preflight,
      currentBindings: bindings,
      automaticSelectionHash: automaticSelection.automaticSelectionHash,
      projectionHash: projection.projectionHash,
      failedStage: 'PRIVATE_G4_READY',
      errorCode: 'PRIVATE_G4_REJECTED',
      privateEvidenceRefs: ['private:g4:error'],
      productionAfterStateHash: bindings.productionBeforeStateHash,
      publicRouteAfterStateHash: bindings.publicRouteBeforeStateHash,
      failedAt: '2026-07-30T06:20:00.000Z',
    };

    expect(() => createStrictTestPrivateFailureReceiptV1(legacyInput as never)).toThrow(
      'STRICT_TEST_FAILURE_FIELDS_INVALID'
    );
  });

  it('hash-binds projectedAt and rejects projection before automaticSelection', () => {
    const { bindings, preflight, automaticSelection, projection } = privateCompletionChain();

    expect(() =>
      assertStrictTestDimensionExecutionProjectionV1(
        {
          ...projection,
          projectedAt: '2026-07-30T06:03:00.000Z',
        },
        preflight,
        automaticSelection
      )
    ).toThrow('STRICT_TEST_PROJECTION_HASH_MISMATCH');

    expect(() =>
      createStrictTestDimensionExecutionProjectionV1({
        preflight,
        automaticSelection,
        currentBindings: bindings,
        projectedAt: '2026-07-30T06:00:30.000Z',
      })
    ).toThrow('STRICT_TEST_PROJECTION_TIME_INVALID');
  });

  it('emits deterministic automatic-selection runtime lineage JSON on demand', () => {
    const chain = privateCompletionChain();
    const automaticReadyRow = FAILURE_STAGE_AUTHORITY_CASES.find(
      (row) => row.failedStage === 'AUTOMATIC_SELECTION_READY'
    );
    if (!automaticReadyRow) {
      throw new Error('automatic-selection-ready authority fixture missing');
    }
    const failure = createFailureReceipt(
      failureAuthorityContext(chain, automaticReadyRow),
      'AUTOMATIC_SELECTION_READY'
    );
    const runtimeProbe = {
      recommendation: chain.preflight.recommendation.dimensionId,
      selectedDimension: chain.automaticSelection.selectedDimensionId,
      selectedCells: chain.automaticSelection.selectedEligibleCellIds,
      automaticSelectionHash: chain.automaticSelection.automaticSelectionHash,
      projectionHash: chain.projection.projectionHash,
      fullUniverseHashes: {
        catalog: chain.automaticSelection.fullCatalogHash,
        catalogSourceArtifact: chain.automaticSelection.fullCatalogSourceArtifactHash,
        cellUniverse: chain.automaticSelection.fullCellUniverseHash,
        eligibleCells: chain.automaticSelection.fullEligibleCellsHash,
        excludedCells: chain.automaticSelection.fullExcludedCellsHash,
        applicability: chain.automaticSelection.fullApplicabilityUniverseHash,
        factQueryCatalog: chain.automaticSelection.fullFactQueryCatalogHash,
        baselineSchedule: chain.automaticSelection.fullBaselineScheduleHash,
      },
      completion: {
        terminalState: chain.terminal.terminalState,
        automaticSelectionHash: chain.terminal.automaticSelectionHash,
        projectionHash: chain.terminal.projectionHash,
      },
      failure: {
        failedStage: failure.failedStage,
        preflightHash: failure.preflightHash,
        automaticSelectionHash: failure.automaticSelectionHash,
        projectionHash: failure.projectionHash,
        observedBindingsHash: failure.observedBindingsHash,
      },
    };

    expect(runtimeProbe.recommendation).toBe(runtimeProbe.selectedDimension);
    expect(runtimeProbe.selectedCells).toEqual(['core::architecture']);
    expect(runtimeProbe.completion.automaticSelectionHash).toBe(
      runtimeProbe.automaticSelectionHash
    );
    expect(runtimeProbe.failure).toMatchObject({
      failedStage: 'AUTOMATIC_SELECTION_READY',
      automaticSelectionHash: null,
      projectionHash: null,
    });
    if (process.env.STRICT_TEST_RUNTIME_PROBE === '1') {
      process.stdout.write(`${JSON.stringify(runtimeProbe)}\n`);
    }
  });

  it('exports the same executable contract from plans and production facades', async () => {
    const plans = await import('../src/plans.js');
    const production = await import('../src/production.js');

    expect(plans.validateStrictTestPreflightV1).toBeInstanceOf(Function);
    expect(production.validateStrictTestPreflightV1).toBe(plans.validateStrictTestPreflightV1);
    expect(production.createStrictTestAutomaticSelectionReceiptV1).toBeInstanceOf(Function);
    expect(production.assertStrictTestAutomaticSelectionReceiptV1).toBeInstanceOf(Function);
    expect(Object.hasOwn(plans, 'createStrictTestSelectionConfirmationV1')).toBe(false);
    expect(Object.hasOwn(plans, 'assertStrictTestSelectionConfirmationV1')).toBe(false);
    expect(Object.hasOwn(production, 'createStrictTestSelectionConfirmationV1')).toBe(false);
    expect(Object.hasOwn(production, 'assertStrictTestSelectionConfirmationV1')).toBe(false);
    expect(production.createStrictTestDimensionExecutionProjectionV1).toBeInstanceOf(Function);
    expect(production.STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1).toBe(
      plans.STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1
    );
    expect(production.resolveStrictTestFailureStageAuthorityV1).toBe(
      plans.resolveStrictTestFailureStageAuthorityV1
    );
    expect(plans.STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1).toEqual(
      Object.fromEntries(
        FAILURE_STAGE_AUTHORITY_CASES.map((row) => [
          row.failedStage,
          {
            preflight: row.preflight,
            automaticSelection: row.automaticSelection,
            projection: row.projection,
          },
        ])
      )
    );
    expect(Object.isFrozen(plans.STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1)).toBe(true);
    for (const row of FAILURE_STAGE_AUTHORITY_CASES) {
      expect(plans.resolveStrictTestFailureStageAuthorityV1(row.failedStage)).toEqual({
        preflight: row.preflight,
        automaticSelection: row.automaticSelection,
        projection: row.projection,
      });
      expect(Object.isFrozen(plans.STRICT_TEST_FAILURE_STAGE_AUTHORITY_V1[row.failedStage])).toBe(
        true
      );
    }
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

function failureAuthorityContext(
  chain: ReturnType<typeof privateCompletionChain>,
  row: (typeof FAILURE_STAGE_AUTHORITY_CASES)[number]
) {
  return {
    currentBindings: chain.bindings,
    preflight: row.preflight === 'required' ? chain.preflight : null,
    automaticSelection: row.automaticSelection === 'required' ? chain.automaticSelection : null,
    projection: row.projection === 'required' ? chain.projection : null,
  };
}

function createFailureReceipt(
  context: ReturnType<typeof failureAuthorityContext>,
  failedStage: (typeof FAILURE_STAGE_AUTHORITY_CASES)[number]['failedStage'],
  failedAt = '2026-07-30T06:20:00.000Z'
) {
  return createStrictTestPrivateFailureReceiptV1({
    context,
    failedStage,
    errorCode: `${failedStage}_REJECTED`,
    privateEvidenceRefs: [`private:failure:${failedStage}`],
    productionAfterStateHash:
      context.preflight?.productionBeforeStateHash ??
      context.currentBindings.productionBeforeStateHash,
    publicRouteAfterStateHash:
      context.preflight?.publicRouteBeforeStateHash ??
      context.currentBindings.publicRouteBeforeStateHash,
    failedAt,
  });
}

function privateCompletionChain(
  timestamps: { readonly selectedAt: string; readonly projectedAt: string } = {
    selectedAt: '2026-07-30T06:01:00.000Z',
    projectedAt: '2026-07-30T06:02:00.000Z',
  }
) {
  const bindings = preflightBindings();
  const preflight = validateStrictTestPreflightV1(compiledPlan(), bindings);
  const automaticSelection = createStrictTestAutomaticSelectionReceiptV1({
    preflight,
    currentBindings: bindings,
    selectedAt: timestamps.selectedAt,
  });
  const projection = createStrictTestDimensionExecutionProjectionV1({
    preflight,
    automaticSelection,
    currentBindings: bindings,
    projectedAt: timestamps.projectedAt,
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
    automaticSelection,
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
  return { bindings, preflight, automaticSelection, projection, terminal };
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

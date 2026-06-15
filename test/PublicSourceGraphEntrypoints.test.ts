import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createSourceFileNode,
  createSourceGraphAffectedTestsResult,
  createSourceGraphDiagnostic,
  createSourceGraphEdge,
  createSourceGraphQueryResult,
  createSourceGraphSearchResult,
  createSourceGraphSnapshot,
  createSourceGraphStatusResult,
  createSourceGraphValidationPlanResult,
  createSourceSection,
  createSourceSymbolNode,
  isSourceGraphSnapshot,
  SOURCE_GRAPH_EDGE_KINDS,
  SOURCE_GRAPH_FRESHNESS_STATES,
  SOURCE_GRAPH_VALIDATION_PLAN_BUCKETS,
  validateSourceGraphDiagnostic,
  validateSourceGraphEdge,
  validateSourceGraphSearchResult,
  validateSourceGraphValidationPlanResult,
  validateSourceSymbolNode,
} from '../src/domain/source-graph/index.js';
import { SourceGraphRepositoryImpl } from '../src/repository/source-graph/index.js';
import {
  SourceGraphFreshnessService,
  SourceGraphIndexer,
  SourceGraphLifecycleService,
  SourceGraphQueryService,
  SourceGraphService,
} from '../src/service/source-graph/index.js';

describe('internal source graph boundary', () => {
  it('withdraws the public source graph facade from package exports', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, unknown> };

    expect(packageJson.exports['./source-graph']).toBeUndefined();
    expect(fs.existsSync(new URL('../src/source-graph.ts', import.meta.url))).toBe(false);
  });

  it('keeps deterministic source graph DTO creators and validators internal', () => {
    const snapshot = createSourceGraphSnapshot({
      generationId: 'internal-source-graph',
      projectRoot: '/tmp/alembic-core',
      repoId: 'AlembicCore',
      graphRoot: '/tmp/alembic-core',
      status: 'indexed',
      languageCoverage: ['typescript', 'typescript'],
      fileCount: 1,
      symbolCount: 1,
      edgeCount: 1,
      freshness: {
        status: 'fresh',
        checkedAt: 100,
      },
    });
    const file = createSourceFileNode({
      generationId: snapshot.generationId,
      projectRoot: snapshot.projectRoot,
      repoRelativePath: 'src/service/source-graph/SourceGraphService.ts',
      language: 'typescript',
      contentHash: 'sha256-internal',
    });
    const symbol = createSourceSymbolNode({
      generationId: snapshot.generationId,
      symbolId: 'sourceGraphInternalService',
      displayName: 'SourceGraphService',
      kind: 'class',
      filePath: file.repoRelativePath,
      range: { startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 },
      exported: true,
    });
    const edge = createSourceGraphEdge({
      generationId: snapshot.generationId,
      edgeId: 'service->repository',
      kind: 'imports',
      fromFilePath: 'src/service/source-graph/SourceGraphService.ts',
      toFilePath: 'src/repository/source-graph/SourceGraphRepository.ts',
      provenance: 'deterministic',
    });
    const section = createSourceSection({
      filePath: symbol.filePath,
      startLine: symbol.range.startLine,
      endLine: symbol.range.endLine,
      reason: 'internal-boundary-test',
      freshness: snapshot.freshness,
      symbolIds: [symbol.symbolId],
    });
    const result = createSourceGraphQueryResult({
      generationId: snapshot.generationId,
      projectRoot: snapshot.projectRoot,
      query: 'SourceGraphService',
      freshness: snapshot.freshness,
      sourceSections: [section],
      symbols: [symbol],
      edges: [edge],
      impactedFiles: [file.repoRelativePath],
    });

    expect(isSourceGraphSnapshot(snapshot)).toBe(true);
    expect(snapshot.languageCoverage).toStrictEqual(['typescript']);
    expect(SOURCE_GRAPH_EDGE_KINDS).toContain('route_to_handler');
    expect(result.sourceSections[0]?.redaction.state).toBe('none');
    expect(
      validateSourceGraphEdge({ generationId: 'g', edgeId: 'bad', kind: 'calls' })
    ).toHaveLength(1);
    expect(
      validateSourceSymbolNode({
        generationId: 'g',
        symbolId: 'bad',
        displayName: 'bad',
        kind: 'function',
        filePath: 'src/bad.ts',
        range: { startLine: 3, startColumn: 0, endLine: 2, endColumn: 0 },
      })
    ).toHaveLength(1);
  });

  it('keeps the internal source graph repository and service available', () => {
    expect(SourceGraphIndexer).toBeDefined();
    expect(SourceGraphFreshnessService).toBeDefined();
    expect(SourceGraphLifecycleService).toBeDefined();
    expect(SourceGraphQueryService).toBeDefined();
    expect(SourceGraphRepositoryImpl).toBeDefined();
    expect(SourceGraphService).toBeDefined();
    expect(SourceGraphService.prototype.buildFullIndex).toBeDefined();
    expect(SourceGraphService.prototype.buildIncrementalIndex).toBeDefined();
    expect(SourceGraphService.prototype.inspectFreshness).toBeDefined();
    expect(SourceGraphService.prototype.searchSourceGraph).toBeDefined();
    expect(SourceGraphService.prototype.exploreSourceGraph).toBeDefined();
    expect(SourceGraphService.prototype.getSourceGraphImpact).toBeDefined();
    expect(SourceGraphService.prototype.getSourceGraphValidationPlan).toBeDefined();
  });

  it('keeps source graph boundary states and diagnostic ownership internal', () => {
    expect(SOURCE_GRAPH_FRESHNESS_STATES).toEqual(
      expect.arrayContaining([
        'uninitialized',
        'opening',
        'catching-up',
        'fresh',
        'pending',
        'stale',
        'partial',
        'degraded',
        'unavailable',
        'wrong-scope',
      ])
    );

    const diagnostic = createSourceGraphDiagnostic({
      code: 'worktree-index-mismatch',
      message: 'The open worktree does not match the indexed graph.',
    });

    expect(diagnostic).toMatchObject({
      code: 'worktree-index-mismatch',
      owner: 'core-plugin',
      nextAction: 'rebuild_source_graph_for_current_worktree',
      invalidConclusion: 'indexed source facts match the current worktree',
      blocksReady: true,
    });
    expect(
      validateSourceGraphDiagnostic({
        code: 'unknown-diagnostic-code',
      } as Parameters<typeof validateSourceGraphDiagnostic>[0])
    ).toHaveLength(1);
  });

  it('keeps operation-specific outputs without generic or unrelated fields', () => {
    const freshness = {
      status: 'fresh',
      checkedAt: 1000,
    } as const;
    const statusResult = createSourceGraphStatusResult({
      projectRoot: '/tmp/alembic-core',
      repoId: 'AlembicCore',
      freshness,
      diagnostics: [
        {
          code: 'source-ref-unproven',
          message: 'The requested source reference has no source graph proof.',
        },
      ],
      residentMetadata: { pid: 1234 },
      telemetry: { durationMs: 5 },
      legacyRefs: ['sourceRef:old'],
    } as unknown as Parameters<typeof createSourceGraphStatusResult>[0]);

    expect(statusResult.operation).toBe('status');
    expect(statusResult.ready).toBe(false);
    expect(statusResult.nextActions).toContain('verify_source_ref_before_citing');
    expect('residentMetadata' in statusResult).toBe(false);
    expect('telemetry' in statusResult).toBe(false);
    expect('legacyRefs' in statusResult).toBe(false);
    expect('data' in statusResult).toBe(false);
    expect('metadata' in statusResult).toBe(false);

    const searchResult = createSourceGraphSearchResult({
      projectRoot: '/tmp/alembic-core',
      query: 'SourceGraphRepositoryImpl',
      freshness,
      symbols: [
        createSourceSymbolNode({
          generationId: 'g-search',
          symbolId: 'repo',
          displayName: 'SourceGraphRepositoryImpl',
          kind: 'class',
          filePath: 'src/repository/source-graph/SourceGraphRepository.ts',
          range: { startLine: 1, startColumn: 0, endLine: 20, endColumn: 1 },
        }),
      ],
      sourceSections: [
        createSourceSection({
          filePath: 'src/repository/source-graph/SourceGraphRepository.ts',
          startLine: 1,
          endLine: 20,
          freshness,
          reason: 'search-result',
        }),
      ],
    });

    expect(searchResult).toMatchObject({
      operation: 'search',
      query: 'SourceGraphRepositoryImpl',
      ready: true,
    });
    expect(searchResult.symbols).toHaveLength(1);
    expect('data' in searchResult).toBe(false);
    expect('metadata' in searchResult).toBe(false);
    expect(
      validateSourceGraphSearchResult({
        projectRoot: '/tmp/alembic-core',
        query: '',
        freshness,
      })
    ).toHaveLength(1);

    const affectedTestsResult = createSourceGraphAffectedTestsResult({
      projectRoot: '/tmp/alembic-core',
      freshness,
      changedFiles: ['src/service/source-graph/SourceGraphService.ts'],
      diagnostics: [
        {
          code: 'affected-tests-unknown',
          message: 'No deterministic source graph test edge exists for this change.',
        },
      ],
    });

    expect(affectedTestsResult.operation).toBe('affected-tests');
    expect(affectedTestsResult.ready).toBe(false);
    expect(affectedTestsResult.nextActions).toContain('run_broader_validation_or_add_test_edges');

    const validationPlan = createSourceGraphValidationPlanResult({
      projectRoot: '/tmp/alembic-core',
      freshness,
      changedFiles: ['src/service/source-graph/SourceGraphService.ts'],
      seedSymbols: ['src/service/source-graph/SourceGraphService.ts#SourceGraphService'],
      impactedFiles: [
        'src/service/source-graph/SourceGraphService.ts',
        'test/source-graph.test.ts',
      ],
      mustRun: [
        {
          kind: 'test-file',
          label: 'Run affected source graph test',
          filePath: 'test/source-graph.test.ts',
          command: 'npm run test -- test/source-graph.test.ts',
          reason: 'The source graph maps the changed symbol to this test file.',
          evidence: [
            {
              kind: 'changed-file',
              ref: 'src/service/source-graph/SourceGraphService.ts',
              filePath: 'src/service/source-graph/SourceGraphService.ts',
              reason: 'Changed file seed.',
            },
          ],
        },
      ],
      recommended: [
        {
          kind: 'repo-command',
          label: 'Run build check',
          command: 'npm run build:check',
          reason: 'Repository metadata exposes build:check.',
        },
      ],
      manualReview: [
        {
          kind: 'manual-review',
          label: 'Review validation boundary',
          reason: 'Source graph recommendations are not acceptance.',
        },
      ],
      unknown: [
        {
          kind: 'unknown',
          label: 'No broader scenario proof',
          diagnosticCode: 'affected-tests-unknown',
          reason: 'Real scenario acceptance still belongs to controller/Test routing.',
        },
      ],
    });

    expect(SOURCE_GRAPH_VALIDATION_PLAN_BUCKETS).toStrictEqual([
      'mustRun',
      'recommended',
      'manualReview',
      'unknown',
    ]);
    expect(validationPlan.operation).toBe('validation-plan');
    expect(validationPlan.mustRun[0]?.bucket).toBe('mustRun');
    expect(validationPlan.recommended[0]?.bucket).toBe('recommended');
    expect(validationPlan.manualReview[0]?.bucket).toBe('manualReview');
    expect(validationPlan.unknown[0]?.bucket).toBe('unknown');
    expect(validationPlan.acceptanceBoundary).toContain('do not replace controller acceptance');
    expect(
      validateSourceGraphValidationPlanResult({
        projectRoot: '/tmp/alembic-core',
        freshness,
        mustRun: [
          {
            bucket: 'unknown',
            kind: 'test-file',
            label: 'Wrong bucket',
            reason: 'The bucket does not match the property.',
          },
        ],
      })
    ).toHaveLength(1);
  });
});

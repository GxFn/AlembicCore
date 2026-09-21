import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { SourceGraphService } from '../src/service/source-graph/index.js';

describe('SourceGraphQueryService', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-query-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ranks exact source symbols above generated/test matches and returns fresh source sections', async () => {
    const service = await buildFixtureGraph();

    const result = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'AppController',
      limit: 5,
    });

    expect(result.ready).toBe(true);
    expect(result.symbols[0]).toMatchObject({
      displayName: 'AppController',
      filePath: 'src/app.ts',
    });
    expect(result.symbols.find((symbol) => symbol.filePath.includes('generated'))).toBeDefined();
    expect(result.sourceSections[0]).toMatchObject({
      filePath: 'src/app.ts',
      reason: 'ranked-symbol:class',
      freshness: { status: 'fresh' },
    });
    expect(result.sourceSections[0]?.text).toContain('export class AppController');
    expect(result.sourceSections[0]?.metadata).toMatchObject({
      overflow: false,
    });
  });

  it('shares one source-line budget across symbol ranking and text recall', async () => {
    const service = await buildFixtureGraph();
    const result = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'AppController',
      limit: 5,
      sourceSectionLineBudget: 1,
      maxSectionLines: 1,
      contextLines: 0,
    });
    expect(result.symbols[0]?.displayName).toBe('AppController');
    expect(result.sourceSections.length).toBeGreaterThan(0);
    expect(
      result.sourceSections.reduce(
        (total, section) => total + section.endLine - section.startLine + 1,
        0
      )
    ).toBeLessThanOrEqual(1);
  });

  it('does not read outside source scope when an indexed file is replaced by a symlink', async () => {
    const service = await buildFixtureGraph();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-outside-source-'));
    try {
      const externalFile = path.join(outside, 'external.ts');
      fs.writeFileSync(externalFile, 'outside-source-only-content\n');
      fs.unlinkSync(path.join(tmpDir, 'src/app.ts'));
      fs.symlinkSync(externalFile, path.join(tmpDir, 'src/app.ts'));
      const result = await service.getSourceGraphNode({
        generationId: 'gen-query',
        nodeId: 'src/app.ts#AppController',
        includeText: true,
      });
      expect(result.sourceSections).toHaveLength(1);
      expect(result.sourceSections[0].text).toBeUndefined();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('supports path and text recall with explicit low-confidence and ambiguity diagnostics', async () => {
    const service = await buildFixtureGraph();

    const textResult = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'clean output projection',
      limit: 3,
    });
    expect(textResult.ready).toBe(true);
    expect(textResult.symbols[0]?.filePath).toBe('src/dashboard.ts');
    expect(
      textResult.sourceSections.some((section) => section.text?.includes('clean output'))
    ).toBe(true);

    const pathResult = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'src/pluginRuntime.ts',
      limit: 3,
    });
    expect(pathResult.ready).toBe(true);
    expect(pathResult.symbols[0]?.filePath).toBe('src/pluginRuntime.ts');

    const ambiguous = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'renderDashboard',
      limit: 5,
    });
    expect(ambiguous.ready).toBe(false);
    expect(ambiguous.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'ambiguous-symbol'
    );

    const weak = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'zzzz no real source match',
    });
    expect(weak.ready).toBe(false);
    expect(weak.diagnostics.map((diagnostic) => diagnostic.code)).toContain('low-confidence-query');
  });

  it('returns operation-specific source node, callers, callees, impact, and affected-test outputs', async () => {
    const service = await buildFixtureGraph();

    const node = await service.getSourceGraphNode({
      generationId: 'gen-query',
      nodeId: 'src/app.ts#AppController',
    });
    expect(node.ready).toBe(true);
    expect(node.operation).toBe('node');
    expect(node.sourceSections[0]?.text).toContain('export class AppController');

    const callees = await service.getSourceGraphCallees({
      generationId: 'gen-query',
      symbolId: 'src/app.ts#AppController',
    });
    expect(callees.operation).toBe('callees');
    expect(callees.callees.map((symbol) => symbol.symbolId)).toContain(
      'src/dashboard.ts#renderDashboard'
    );

    const callers = await service.getSourceGraphCallers({
      generationId: 'gen-query',
      symbolId: 'src/dashboard.ts#renderDashboard',
    });
    expect(callers.operation).toBe('callers');
    expect(callers.callers.map((symbol) => symbol.symbolId)).toContain('src/app.ts#AppController');

    const impact = await service.getSourceGraphImpact({
      generationId: 'gen-query',
      changedFiles: ['src/app.ts'],
    });
    expect(impact.operation).toBe('impact');
    expect(impact.ready).toBe(true);
    expect(impact.impactedFiles).toEqual(
      expect.arrayContaining(['src/app.ts', 'src/dashboard.ts', 'test/app.test.ts'])
    );
    expect(impact.affectedValidations).toContain('test:test/app.test.ts');

    const affected = await service.getSourceGraphAffectedTests({
      generationId: 'gen-query',
      changedFiles: ['src/app.ts'],
    });
    expect(affected.operation).toBe('affected-tests');
    expect(affected.ready).toBe(true);
    expect(affected.testFiles).toStrictEqual(['test/app.test.ts']);

    const unknown = await service.getSourceGraphAffectedTests({
      generationId: 'gen-query',
      changedFiles: ['src/dashboard.ts'],
    });
    expect(unknown.ready).toBe(false);
    expect(unknown.unknownReason).toContain('No source_graph symbol_to_test edge');
    expect(unknown.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'affected-tests-unknown'
    );
  });

  it.each([
    'node-symbol',
    'node-file',
    'callers',
    'callees',
    'impact',
    'affected-tests',
    'validation-plan',
  ] as const)('locates %s edges before applying the target query budget', async (operation) => {
    const repo = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const service = new SourceGraphService(repo);
    const generationId = 'crowded-generation';
    const target = 'src/target.ts#target';
    const caller = 'src/caller.ts#caller';
    const testSymbol = 'test/target.test.ts#testTarget';
    await repo.replaceGeneration({
      snapshot: { generationId, projectRoot: tmpDir, status: 'indexed' },
      files: ['src/target.ts', 'src/caller.ts', 'test/target.test.ts'].map((filePath) => ({
        generationId,
        projectRoot: tmpDir,
        repoRelativePath: filePath,
        contentHash: 'fixture-hash',
        classification: filePath.startsWith('test/') ? 'test' : 'source',
        lineCount: 1,
      })),
      symbols: [target, caller, testSymbol].map((symbolId) => ({
        generationId,
        symbolId,
        displayName: symbolId.split('#')[1],
        filePath: symbolId.split('#')[0],
        kind: 'function',
        range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
      })),
      edges: [
        ...Array.from({ length: 501 }, (_, index) => ({
          generationId,
          edgeId: `unrelated-${index}`,
          kind: 'imports',
          fromFilePath: 'src/unrelated.ts',
          toFilePath: 'src/dependency.ts',
        })),
        {
          generationId,
          edgeId: 'a-target-test',
          kind: 'symbol_to_test',
          fromSymbolId: target,
          toSymbolId: testSymbol,
          fromFilePath: 'src/target.ts',
          toFilePath: 'test/target.test.ts',
        },
        {
          generationId,
          edgeId: 'b-target-call',
          kind: 'calls',
          fromSymbolId: caller,
          toSymbolId: target,
          fromFilePath: 'src/caller.ts',
          toFilePath: 'src/target.ts',
        },
      ],
    });
    const input = { generationId, edgeLimit: 1, includeText: false };
    const expectedEdge =
      operation === 'callers' || operation === 'callees' ? 'b-target-call' : 'a-target-test';

    if (operation === 'affected-tests') {
      const result = await service.getSourceGraphAffectedTests({
        ...input,
        changedFiles: ['src/target.ts'],
      });
      expect(result.testFiles).toEqual(['test/target.test.ts']);
      expect(result.unknownReason).toBeUndefined();
      return;
    }

    const result =
      operation === 'node-symbol' || operation === 'node-file'
        ? await service.getSourceGraphNode({
            ...input,
            nodeId: operation === 'node-symbol' ? target : 'src/target.ts',
          })
        : operation === 'callers'
          ? await service.getSourceGraphCallers({ ...input, symbolId: target })
          : operation === 'callees'
            ? await service.getSourceGraphCallees({ ...input, symbolId: caller })
            : operation === 'impact'
              ? await service.getSourceGraphImpact({ ...input, changedFiles: ['src/target.ts'] })
              : await service.getSourceGraphValidationPlan({ ...input, symbolIds: [target] });

    expect(result.edges.map((edge) => edge.edgeId)).toEqual([expectedEdge]);
    if (result.operation === 'callers') {
      expect(result.callers.map((symbol) => symbol.symbolId)).toEqual([caller]);
    } else if (result.operation === 'callees') {
      expect(result.callees.map((symbol) => symbol.symbolId)).toEqual([target]);
    } else if (result.operation === 'impact') {
      expect(result.impactedFiles).toEqual(['src/target.ts', 'test/target.test.ts']);
      expect(result.affectedValidations).toEqual(['test:test/target.test.ts']);
    } else if (result.operation === 'validation-plan') {
      expect(result.mustRun.map((recommendation) => recommendation.filePath)).toEqual([
        'test/target.test.ts',
      ]);
    }
  });

  it('builds validation plans from changed source files with tests, commands, and evidence', async () => {
    const service = await buildFixtureGraph();

    const plan = await service.getSourceGraphValidationPlan({
      generationId: 'gen-query',
      changedFiles: ['src/app.ts'],
    });

    expect(plan.operation).toBe('validation-plan');
    expect(plan.ready).toBe(true);
    expect(plan.changedFiles).toStrictEqual(['src/app.ts']);
    expect(plan.impactedFiles).toEqual(
      expect.arrayContaining(['src/app.ts', 'src/dashboard.ts', 'test/app.test.ts'])
    );
    expect(plan.impactedSymbols.map((symbol) => symbol.symbolId)).toEqual(
      expect.arrayContaining(['src/app.ts#AppController', 'src/dashboard.ts#renderDashboard'])
    );
    expect(plan.mustRun[0]).toMatchObject({
      bucket: 'mustRun',
      kind: 'test-file',
      filePath: 'test/app.test.ts',
      command: 'npm run test -- test/app.test.ts',
    });
    expect(plan.mustRun[0]?.evidence.map((evidence) => evidence.kind)).toEqual(
      expect.arrayContaining(['changed-file', 'impacted-file', 'symbol', 'edge', 'test-file'])
    );
    expect(plan.recommended.map((recommendation) => recommendation.command)).toEqual(
      expect.arrayContaining(['npm run build:check', 'npm run lint', 'npm run check'])
    );
    expect(plan.acceptanceBoundary).toContain('do not replace controller acceptance');

    const symbolSeedPlan = await service.getSourceGraphValidationPlan({
      generationId: 'gen-query',
      symbolIds: ['src/app.ts#bootstrapApp'],
    });
    expect(symbolSeedPlan.seedSymbols).toStrictEqual(['src/app.ts#bootstrapApp']);
    expect(symbolSeedPlan.mustRun[0]?.filePath).toBe('test/app.test.ts');
  });

  it('routes config changes to manual review and keeps affected-test uncertainty explicit', async () => {
    const service = await buildFixtureGraph();

    const plan = await service.getSourceGraphValidationPlan({
      generationId: 'gen-query',
      changedFiles: ['package.json'],
    });

    expect(plan.ready).toBe(false);
    expect(plan.manualReview[0]).toMatchObject({
      bucket: 'manualReview',
      kind: 'manual-review',
      filePath: 'package.json',
    });
    expect(plan.unknown[0]).toMatchObject({
      bucket: 'unknown',
      kind: 'unknown',
      diagnosticCode: 'affected-tests-unknown',
    });
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'affected-tests-unknown'
    );
  });

  it('marks validation plans unknown when no deterministic test edge exists', async () => {
    const service = await buildFixtureGraph();

    const plan = await service.getSourceGraphValidationPlan({
      generationId: 'gen-query',
      changedFiles: ['src/dashboard.ts'],
    });

    expect(plan.ready).toBe(false);
    expect(plan.mustRun).toHaveLength(0);
    expect(plan.unknown[0]).toMatchObject({
      label: 'Affected tests unknown',
      command: 'npm run test',
      diagnosticCode: 'affected-tests-unknown',
    });
    expect(plan.recommended.map((recommendation) => recommendation.command)).toContain(
      'npm run build:check'
    );
  });

  it('gates source text when freshness is not fresh', async () => {
    const { service, sourceGraphRepository } = await buildFixtureGraphWithRepository();
    await sourceGraphRepository.completeGeneration('gen-query', {
      freshness: {
        status: 'stale',
        reason: 'Fixture changed after indexing.',
        nextAction: 'run_incremental_source_graph_index',
        pendingFileCount: 1,
      },
    });

    const result = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'AppController',
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'pending-file-in-response'
    );
    expect(result.sourceSections[0]).toMatchObject({
      filePath: 'src/app.ts',
      freshness: { status: 'stale' },
    });
    expect(result.sourceSections[0]?.text).toBeUndefined();
  });

  it.each([
    'node',
    'search',
    'querySymbols',
  ] as const)('marks %s source text stale when the live bytes no longer match the indexed hash', async (operation) => {
    const { service, sourceGraphRepository } = await buildFixtureGraphWithRepository();
    const filePath = 'src/app.ts';
    const absolutePath = path.join(tmpDir, filePath);
    const indexed = await sourceGraphRepository.findFile('gen-query', filePath);
    const before = fs.statSync(absolutePath);
    const original = fs.readFileSync(absolutePath, 'utf8');
    fs.writeFileSync(absolutePath, original.replaceAll('AppController', 'NewController'));
    fs.utimesSync(absolutePath, before.atime, before.mtime);
    expect(fs.statSync(absolutePath).size).toBe(before.size);

    const result =
      operation === 'node'
        ? await service.getSourceGraphNode({
            generationId: 'gen-query',
            nodeId: 'src/app.ts#AppController',
          })
        : operation === 'search'
          ? await service.searchSourceGraph({
              generationId: 'gen-query',
              query: 'AppController',
              limit: 1,
            })
          : await service.querySymbols('gen-query', 'AppController', { limit: 1 });

    expect(result.freshness.status).toBe('stale');
    const diagnostic = result.diagnostics.find((entry) => entry.filePath === filePath);
    expect(diagnostic).toMatchObject({
      code: 'pending-file-in-response',
      blocksReady: true,
      metadata: {
        expectedContentHash: indexed?.contentHash,
        actualContentHash: expect.any(String),
      },
    });
    expect(diagnostic?.metadata.actualContentHash).not.toBe(indexed?.contentHash);
    expect(result.sourceSections.length).toBeGreaterThan(0);
    for (const section of result.sourceSections) {
      expect(section.text).toBeUndefined();
      expect(section.freshness.status).toBe('stale');
    }
    // 查询只报告漂移，不写状态或偷偷重建；原 generation 仍可供显式 catch-up 使用。
    expect((await sourceGraphRepository.getSnapshot('gen-query'))?.freshness.status).toBe('fresh');
    expect((await sourceGraphRepository.findFile('gen-query', filePath))?.contentHash).toBe(
      indexed?.contentHash
    );
  });

  it('removes earlier fresh sections when later text recall discovers source drift', async () => {
    const service = await buildFixtureGraph();
    writeFixture(
      'src/pluginRuntime.ts',
      "export function changedAfterIndex() { return 'unindexed'; }\n"
    );
    const result = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'AppController',
      limit: 1,
    });
    expect(result.freshness.status).toBe('stale');
    expect(result.ready).toBe(false);
    expect(result.sourceSections.some((section) => section.filePath === 'src/app.ts')).toBe(true);
    expect(result.sourceSections.every((section) => section.text === undefined)).toBe(true);
    expect(result.sourceSections.every((section) => section.freshness.status === 'stale')).toBe(
      true
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.filePath === 'src/pluginRuntime.ts')
    ).toBe(true);
  });

  it('keeps source unavailability when a later file also has a hash mismatch', async () => {
    const service = await buildFixtureGraph();
    fs.unlinkSync(path.join(tmpDir, 'src/alternate.ts'));
    writeFixture('src/dashboard.ts', 'export function changedDashboard() {}\n');
    const result = await service.searchSourceGraph({
      generationId: 'gen-query',
      query: 'AppController',
      limit: 1,
    });
    expect(result.freshness.status).toBe('unavailable');
    expect(result.freshness.nextAction).toBe('verify_source_ref_before_citing');
    expect(result.ready).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'source-ref-unproven', filePath: 'src/alternate.ts' }),
        expect.objectContaining({ code: 'pending-file-in-response', filePath: 'src/dashboard.ts' }),
      ])
    );
    expect(result.sourceSections.every((section) => section.text === undefined)).toBe(true);
  });

  it.each([
    'missing-file',
    'missing-indexed-hash',
  ] as const)('does not claim fresh source sections when verification fails with %s', async (failure) => {
    const { service, sourceGraphRepository } = await buildFixtureGraphWithRepository();
    const filePath = failure === 'missing-file' ? 'src/app.ts' : 'src/unindexed.ts';
    const nodeId =
      failure === 'missing-file' ? 'src/app.ts#AppController' : 'src/unindexed.ts#Unindexed';
    if (failure === 'missing-file') {
      fs.unlinkSync(path.join(tmpDir, filePath));
    } else {
      writeFixture(filePath, 'export class Unindexed {}\n');
      await sourceGraphRepository.upsertSymbol({
        generationId: 'gen-query',
        symbolId: nodeId,
        displayName: 'Unindexed',
        kind: 'class',
        filePath,
        range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
      });
    }
    const result = await service.getSourceGraphNode({ generationId: 'gen-query', nodeId });
    expect(result.ready).toBe(false);
    expect(result.freshness.status).not.toBe('fresh');
    expect(result.sourceSections).toHaveLength(1);
    expect(result.sourceSections[0].text).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.filePath === filePath)).toBe(true);
  });

  async function buildFixtureGraph(): Promise<SourceGraphService> {
    return (await buildFixtureGraphWithRepository()).service;
  }

  async function buildFixtureGraphWithRepository() {
    writeFixture(
      'package.json',
      JSON.stringify(
        {
          scripts: {
            'build:check': 'tsc --noEmit',
            test: 'vitest run',
            lint: 'biome check',
            check: 'npm run build:check && npm run test && npm run lint',
          },
        },
        null,
        2
      )
    );
    writeFixture(
      'src/app.ts',
      [
        "import { renderDashboard } from './dashboard';",
        'export class AppController {',
        '  start() {',
        '    return renderDashboard();',
        '  }',
        '}',
        'export function bootstrapApp() {',
        '  return new AppController().start();',
        '}',
        '',
      ].join('\n')
    );
    writeFixture(
      'src/dashboard.ts',
      [
        "export function renderDashboard() { return 'clean output projection'; }",
        "export const cleanOutputProjection = 'operation-specific clean output projection';",
        '',
      ].join('\n')
    );
    writeFixture(
      'src/alternate.ts',
      ["export function renderDashboard() { return 'alternate dashboard'; }", ''].join('\n')
    );
    writeFixture(
      'src/pluginRuntime.ts',
      ["export function openMcpStartup() { return 'cold mcp startup'; }", ''].join('\n')
    );
    writeFixture(
      'src/generated/AppController.ts',
      ['export class AppController {', '  generated = true;', '}', ''].join('\n')
    );
    writeFixture(
      'test/app.test.ts',
      [
        "import { bootstrapApp } from '../src/app';",
        "test('bootstrap app', () => bootstrapApp());",
        '',
      ].join('\n')
    );

    const repositories = createAlembicRepositories(runtime.connection);
    const sourceGraphRepository = repositories.sourceGraphRepository;
    const service = new SourceGraphService(sourceGraphRepository);
    await service.buildFullIndex({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: '.',
      generationId: 'gen-query',
      now: 1000,
      includeExtensions: ['.ts'],
    });
    await sourceGraphRepository.upsertEdge({
      generationId: 'gen-query',
      edgeId: 'src/app.ts#AppController->src/dashboard.ts#renderDashboard',
      kind: 'calls',
      fromSymbolId: 'src/app.ts#AppController',
      toSymbolId: 'src/dashboard.ts#renderDashboard',
      fromFilePath: 'src/app.ts',
      toFilePath: 'src/dashboard.ts',
      siteFilePath: 'src/app.ts',
      site: { startLine: 4, startColumn: 11, endLine: 4, endColumn: 28 },
      provenance: 'deterministic',
      confidence: 1,
    });
    await sourceGraphRepository.upsertEdge({
      generationId: 'gen-query',
      edgeId: 'src/app.ts#bootstrapApp->test/app.test.ts#module',
      kind: 'symbol_to_test',
      fromSymbolId: 'src/app.ts#bootstrapApp',
      toSymbolId: 'test/app.test.ts#module',
      fromFilePath: 'src/app.ts',
      toFilePath: 'test/app.test.ts',
      siteFilePath: 'test/app.test.ts',
      site: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 47 },
      provenance: 'deterministic',
      confidence: 1,
    });
    return { service, sourceGraphRepository };
  }

  function writeFixture(repoRelativePath: string, content: string): void {
    const absolutePath = path.join(tmpDir, repoRelativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
});

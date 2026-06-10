import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { SourceGraphService } from '../src/source-graph.js';

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

  async function buildFixtureGraph(): Promise<SourceGraphService> {
    return (await buildFixtureGraphWithRepository()).service;
  }

  async function buildFixtureGraphWithRepository() {
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

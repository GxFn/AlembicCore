import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { SourceGraphService } from '../src/source-graph.js';

describe('SourceGraphRepository', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-'));
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

  it('stores, queries, rebuilds, and clears dedicated source graph generations', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const sourceGraphRepository = repositories.sourceGraphRepository;
    const repositoryFile = 'src/repository/source-graph/SourceGraphRepository.ts';
    const serviceFile = 'src/service/source-graph/SourceGraphService.ts';

    const snapshot = await sourceGraphRepository.replaceGeneration({
      snapshot: {
        generationId: 'source-graph-gen-1',
        projectRoot: tmpDir,
        repoId: 'AlembicCore',
        graphRoot: tmpDir,
        projectScope: 'src',
        status: 'indexed',
        startedAt: 100,
        indexedAt: 200,
        freshness: {
          status: 'fresh',
          checkedAt: 300,
        },
      },
      files: [
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          repoRelativePath: repositoryFile,
          language: 'typescript',
          contentHash: 'sha256-repository',
          sizeBytes: 1200,
          mtimeMs: 1000,
          indexedAt: 200,
          classification: 'source',
          parseStatus: 'parsed',
          lineCount: 220,
        },
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          repoRelativePath: serviceFile,
          language: 'typescript',
          contentHash: 'sha256-service',
          sizeBytes: 800,
          mtimeMs: 1001,
          indexedAt: 201,
          classification: 'source',
          parseStatus: 'partial',
          parseErrors: [{ message: 'fixture parse warning', severity: 'warning', line: 12 }],
          lineCount: 120,
        },
      ],
      symbols: [
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          symbolId: 'sourceGraphRepository',
          displayName: 'SourceGraphRepositoryImpl',
          qualifiedName: 'SourceGraphRepositoryImpl',
          kind: 'class',
          filePath: repositoryFile,
          range: { startLine: 80, startColumn: 0, endLine: 620, endColumn: 1 },
          exported: true,
        },
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          symbolId: 'sourceGraphService',
          displayName: 'SourceGraphService',
          qualifiedName: 'SourceGraphService',
          kind: 'class',
          filePath: serviceFile,
          range: { startLine: 20, startColumn: 0, endLine: 84, endColumn: 1 },
          exported: true,
        },
      ],
      edges: [
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          edgeId: 'sourceGraphRepository->sourceGraphService',
          kind: 'calls',
          fromSymbolId: 'sourceGraphRepository',
          toSymbolId: 'sourceGraphService',
          fromFilePath: repositoryFile,
          toFilePath: serviceFile,
          siteFilePath: repositoryFile,
          site: { startLine: 180, startColumn: 4, endLine: 180, endColumn: 52 },
          provenance: 'deterministic',
          confidence: 1,
          metadata: { caller: 'querySymbols' },
        },
      ],
    });

    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.symbolCount).toBe(2);
    expect(snapshot.edgeCount).toBe(1);
    expect(snapshot.parseErrorCount).toBe(1);
    expect(snapshot.languageCoverage).toStrictEqual(['typescript']);

    const repositoryNode = await sourceGraphRepository.findFile(
      'source-graph-gen-1',
      repositoryFile
    );
    const serviceSymbols = await sourceGraphRepository.searchSymbols(
      'source-graph-gen-1',
      'Service'
    );
    const outgoingEdges = await sourceGraphRepository.findEdgesForSymbol(
      'source-graph-gen-1',
      'sourceGraphRepository',
      'outgoing'
    );

    expect(repositoryNode?.contentHash).toBe('sha256-repository');
    expect(serviceSymbols.map((symbol) => symbol.symbolId)).toStrictEqual(['sourceGraphService']);
    expect(outgoingEdges[0]?.kind).toBe('calls');
    expect(outgoingEdges[0]?.provenance).toBe('deterministic');

    const service = new SourceGraphService(sourceGraphRepository);
    const queryResult = await service.querySymbols('source-graph-gen-1', 'SourceGraph', {
      includeEdges: true,
    });

    expect(queryResult.sourceSections).toHaveLength(2);
    expect(queryResult.edges).toHaveLength(1);
    expect(queryResult.impactedFiles).toStrictEqual([repositoryFile, serviceFile]);
    expect(queryResult.diagnostics).toStrictEqual([]);

    await expect(
      sourceGraphRepository.replaceGeneration({
        snapshot: {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          repoId: 'AlembicCore',
          graphRoot: tmpDir,
          status: 'indexed',
        },
        edges: [
          {
            generationId: 'source-graph-gen-1',
            edgeId: 'invalid-rebuild-edge',
            kind: 'calls',
            fromFilePath: repositoryFile,
          },
        ],
      })
    ).rejects.toThrow('edge requires toSymbolId or toFilePath.');
    expect(
      await sourceGraphRepository.findFile('source-graph-gen-1', repositoryFile)
    ).not.toBeNull();
    expect(
      await sourceGraphRepository.getSymbol('source-graph-gen-1', 'sourceGraphService')
    ).not.toBeNull();
    expect(
      await sourceGraphRepository.findEdgesForSymbol(
        'source-graph-gen-1',
        'sourceGraphRepository',
        'outgoing'
      )
    ).toHaveLength(1);

    const rebuilt = await sourceGraphRepository.replaceGeneration({
      snapshot: {
        generationId: 'source-graph-gen-1',
        projectRoot: tmpDir,
        repoId: 'AlembicCore',
        graphRoot: tmpDir,
        projectScope: 'src',
        status: 'indexed',
      },
      files: [
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          repoRelativePath: serviceFile,
          language: 'typescript',
          contentHash: 'sha256-service-v2',
          sizeBytes: 880,
          mtimeMs: 2002,
          indexedAt: 400,
          classification: 'source',
          parseStatus: 'parsed',
          lineCount: 121,
        },
      ],
    });

    expect(rebuilt.fileCount).toBe(1);
    expect(rebuilt.symbolCount).toBe(0);
    expect(await sourceGraphRepository.findFile('source-graph-gen-1', repositoryFile)).toBeNull();
    expect(
      (await sourceGraphRepository.findFile('source-graph-gen-1', serviceFile))?.contentHash
    ).toBe('sha256-service-v2');

    const cleared = await sourceGraphRepository.clearGeneration('source-graph-gen-1');
    expect(cleared).toMatchObject({ generations: 1, files: 1, symbols: 0, edges: 0 });
    expect(await sourceGraphRepository.getSnapshot('source-graph-gen-1')).toBeNull();
  });
});

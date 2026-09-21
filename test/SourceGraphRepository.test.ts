import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { SourceGraphService } from '../src/service/source-graph/index.js';

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

  it('does not report an ignored generation insertion as a persisted empty graph', async () => {
    const repo = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    runtime.connection
      .getDb()
      .exec(`CREATE TRIGGER ignore_generation BEFORE INSERT ON source_graph_generations
      BEGIN SELECT RAISE(IGNORE); END;`);

    await expect(
      new SourceGraphService(repo).replaceSnapshot({
        snapshot: {
          generationId: 'ignored-generation',
          projectRoot: tmpDir,
          status: 'indexed',
        },
      })
    ).rejects.toThrow('Source graph generation not found: ignored-generation');
    expect(await repo.getSnapshot('ignored-generation')).toBeNull();
  });

  it('separates complete generation edges from bounded query results without crossing generations', async () => {
    const repo = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const generationId = 'complete-edge-read';
    const edgeIds = Array.from({ length: 501 }, (_, index) => `edge-${index}`);
    await repo.replaceGeneration({
      snapshot: { generationId, projectRoot: tmpDir },
      edges: edgeIds.map((edgeId) => ({
        generationId,
        edgeId,
        kind: 'imports',
        fromFilePath: `${edgeId}.ts`,
        toFilePath: 'target.ts',
      })),
    });
    await repo.replaceGeneration({
      snapshot: { generationId: 'other-generation', projectRoot: tmpDir },
      edges: [
        {
          generationId: 'other-generation',
          edgeId: 'other-edge',
          kind: 'imports',
          fromFilePath: 'other.ts',
          toFilePath: 'target.ts',
        },
      ],
    });

    expect(await repo.listEdges(generationId)).toHaveLength(50);
    expect(await repo.listEdges(generationId, { limit: 2 })).toHaveLength(2);
    expect(await repo.listEdges(generationId, { limit: 1000 })).toHaveLength(500);
    expect(
      (await repo.listGenerationEdges(generationId)).map((edge) => edge.edgeId).sort()
    ).toEqual([...edgeIds].sort());
  });

  it.each([
    'second-file',
    'stats-refresh',
  ] as const)('retains the complete previous generation when replacement fails at %s', async (fault) => {
    const repo = createAlembicRepositories(runtime.connection).sourceGraphRepository;
    const service = new SourceGraphService(repo);
    const snapshot = {
      generationId: 'atomic-replace',
      projectRoot: tmpDir,
      status: 'indexed' as const,
      indexedAt: 100,
      metadata: { version: 'original' },
    };
    const file = (repoRelativePath: string) => ({
      generationId: snapshot.generationId,
      projectRoot: tmpDir,
      repoRelativePath,
      language: 'typescript',
      contentHash: 'original',
      sizeBytes: 50,
      mtimeMs: 1,
      indexedAt: 100,
      classification: 'source' as const,
      parseStatus: 'parsed' as const,
    });
    const symbol = {
      generationId: snapshot.generationId,
      symbolId: 'original-symbol',
      displayName: 'Original',
      kind: 'function',
      filePath: 'src/original.ts',
      range: { startLine: 1, startColumn: 0, endLine: 2, endColumn: 1 },
    };
    const edge = {
      generationId: snapshot.generationId,
      edgeId: 'original-edge',
      kind: 'calls',
      fromSymbolId: symbol.symbolId,
      toSymbolId: symbol.symbolId,
    };
    const originalSnapshot = await service.replaceSnapshot({
      snapshot,
      files: [file('src/original.ts')],
      symbols: [symbol],
      edges: [edge],
    });
    const originalFiles = await repo.listFiles(snapshot.generationId);
    const originalSymbols = await repo.listSymbols(snapshot.generationId);
    const originalEdges = await repo.listEdges(snapshot.generationId);
    runtime.connection.getDb().exec(
      fault === 'second-file'
        ? `CREATE TRIGGER reject_replacement BEFORE INSERT ON source_graph_files
           WHEN NEW.repo_relative_path = 'src/second.ts'
           BEGIN SELECT RAISE(ABORT, 'replacement fault'); END;`
        : `CREATE TRIGGER reject_stats BEFORE UPDATE ON source_graph_generations
           WHEN NEW.file_count = 2
           BEGIN SELECT RAISE(ABORT, 'replacement fault'); END;`
    );

    await expect(
      service.replaceSnapshot({
        snapshot: { ...snapshot, indexedAt: 200, metadata: { version: 'replacement' } },
        files: [file('src/first.ts'), file('src/second.ts')],
        symbols: [],
        edges: [],
      })
    ).rejects.toThrow('replacement fault');

    expect(await repo.getSnapshot(snapshot.generationId)).toEqual(originalSnapshot);
    expect(await repo.listFiles(snapshot.generationId)).toEqual(originalFiles);
    expect(await repo.listSymbols(snapshot.generationId)).toEqual(originalSymbols);
    expect(await repo.listEdges(snapshot.generationId)).toEqual(originalEdges);
  });

  it('stores, queries, rebuilds, and clears dedicated source graph generations', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const sourceGraphRepository = repositories.sourceGraphRepository;
    const repositoryFile = 'src/repository/source-graph/SourceGraphRepository.ts';
    const serviceFile = 'src/service/source-graph/SourceGraphService.ts';
    const repositorySource = Array.from({ length: 620 }, (_, index) =>
      index === 79
        ? 'export class SourceGraphRepositoryImpl {'
        : index === 619
          ? '}'
          : '// repository fixture'
    ).join('\n');
    const serviceSource = Array.from({ length: 120 }, (_, index) =>
      index === 19 ? 'export class SourceGraphService {' : index === 83 ? '}' : '// service fixture'
    ).join('\n');
    for (const [filePath, content] of [
      [repositoryFile, repositorySource],
      [serviceFile, serviceSource],
    ]) {
      const absolutePath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
    }
    const repositoryHash = createHash('sha256').update(repositorySource).digest('hex');
    const serviceHash = createHash('sha256').update(serviceSource).digest('hex');

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
          contentHash: repositoryHash,
          sizeBytes: Buffer.byteLength(repositorySource),
          mtimeMs: 1000,
          indexedAt: 200,
          classification: 'source',
          parseStatus: 'parsed',
          lineCount: 620,
        },
        {
          generationId: 'source-graph-gen-1',
          projectRoot: tmpDir,
          repoRelativePath: serviceFile,
          language: 'typescript',
          contentHash: serviceHash,
          sizeBytes: Buffer.byteLength(serviceSource),
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

    expect(repositoryNode?.contentHash).toBe(repositoryHash);
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
    expect(queryResult.sourceSections.every((section) => typeof section.text === 'string')).toBe(
      true
    );

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

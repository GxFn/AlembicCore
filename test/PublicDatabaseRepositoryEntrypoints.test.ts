import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { KnowledgeEntry } from '../src/knowledge.js';
import {
  ALEMBIC_REPOSITORY_KEYS,
  CodeEntityRepositoryImpl,
  createAlembicRepositories,
  GitDiffCheckpointRepository,
  isAlembicRepositoryKey,
  KnowledgeEdgeRepositoryImpl,
  KnowledgeRepositoryImpl,
  ProposalRepository,
  RawDbSyncAdapter,
  RecipeSourceRefRepositoryImpl,
  SourceGraphRepositoryImpl,
  TokenUsageStore,
  WarningRepository,
} from '../src/repositories.js';

describe('public database and repository entrypoints', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-public-db-'));
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

  it('opens a migrated SQLite and Drizzle runtime from the stable database facade', () => {
    expect(runtime.migrated).toBe(true);
    expect(runtime.sqlite.open).toBe(true);
    expect(runtime.drizzle).toBe(runtime.connection.getDrizzle());

    const applied = runtime.sqlite
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: string }).version);

    expect(applied).toContain('001_initial_schema');
    expect(applied).toContain('009_knowledge_dimension_id');
    expect(applied).toContain('010_source_graph');
  });

  it('creates core repositories without exposing schema tables or implementation paths', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const entry = new KnowledgeEntry({
      title: 'Stable repository factory',
      description: 'Repository bundle should hide Drizzle schema details from outer repos.',
      lifecycle: 'active',
      language: 'typescript',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      content: {
        pattern: 'createAlembicRepositories(database).knowledgeRepository',
        rationale: 'Outer repositories should not assemble core stores from schema tables.',
      },
      reasoning: {
        whyStandard: 'Phase 4 keeps repository assembly in Core.',
        sources: ['test/PublicDatabaseRepositoryEntrypoints.test.ts'],
        confidence: 0.9,
      },
    });

    await repositories.knowledgeRepository.create(entry);
    await repositories.memoryRepository.create({
      id: 'memory-repository-factory',
      content: 'Repository bundle should expose semantic memory without schema imports.',
      source: 'public-db-test',
      tags: ['repository-bundle'],
    });
    repositories.recipeSourceRefRepository.upsert({
      recipeId: entry.id,
      sourcePath: 'src/example.ts',
      verifiedAt: Date.now(),
    });
    await repositories.sourceGraphRepository.createGeneration({
      generationId: 'public-repository-source-graph',
      projectRoot: tmpDir,
      repoId: 'AlembicCore',
      graphRoot: tmpDir,
      status: 'indexed',
    });

    const fetched = await repositories.knowledgeRepository.findById(entry.id);
    const memories = await repositories.memoryRepository.getAllActive({ source: 'public-db-test' });
    const sourceRefs = repositories.recipeSourceRefRepository.findByRecipeId(entry.id);
    const sourceGraph = await repositories.sourceGraphRepository.getSnapshot(
      'public-repository-source-graph'
    );

    expect(fetched?.title).toBe('Stable repository factory');
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe(
      'Repository bundle should expose semantic memory without schema imports.'
    );
    expect(sourceRefs).toHaveLength(1);
    expect(sourceRefs[0].sourcePath).toBe('src/example.ts');
    expect(sourceGraph?.repoId).toBe('AlembicCore');
  });

  it('publishes stable repository keys for outer DI registration', () => {
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('knowledgeRepository');
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('memoryRepository');
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('recipeSourceRefRepository');
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('sourceGraphRepository');
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('gitDiffCheckpointRepository');
    expect(isAlembicRepositoryKey('proposalRepository')).toBe(true);
    expect(isAlembicRepositoryKey('planRepository')).toBe(false);
    expect(isAlembicRepositoryKey('gitDiffCheckpointRepository')).toBe(true);
    expect(isAlembicRepositoryKey('sourceGraphRepository')).toBe(true);
    expect(isAlembicRepositoryKey('tokenUsageStore')).toBe(false);
  });

  it('round-trips opaque custom dimension ids without inheriting Object prototype entries', async () => {
    const { generateRepository } = createAlembicRepositories(runtime.connection);
    await generateRepository.create({
      id: 'custom-dimension-snapshot',
      projectRoot: tmpDir,
      createdAt: new Date().toISOString(),
      fileHashes: {},
      dimensionMeta: {},
    });
    await generateRepository.saveDimFiles(
      ['constructor', '__proto__', 'architecture'].map((dimId) => ({
        snapshotId: 'custom-dimension-snapshot',
        dimId,
        filePath: `${dimId}.ts`,
      }))
    );
    const dimensions = await generateRepository.getDimFileMap('custom-dimension-snapshot');
    for (const dimId of ['constructor', '__proto__', 'architecture']) {
      expect(Object.hasOwn(dimensions, dimId)).toBe(true);
      expect([...dimensions[dimId]]).toEqual([`${dimId}.ts`]);
    }
  });

  it('exposes high-reference repository implementations and adapters through the stable facade', () => {
    expect(KnowledgeRepositoryImpl).toBeDefined();
    expect(KnowledgeEdgeRepositoryImpl).toBeDefined();
    expect(CodeEntityRepositoryImpl).toBeDefined();
    expect(RecipeSourceRefRepositoryImpl).toBeDefined();
    expect(SourceGraphRepositoryImpl).toBeDefined();
    expect(GitDiffCheckpointRepository).toBeDefined();
    expect(ProposalRepository).toBeDefined();
    expect(WarningRepository).toBeDefined();
    expect(RawDbSyncAdapter).toBeDefined();
    expect(TokenUsageStore).toBeDefined();
  });

  it('clears every snapshot for one project without a hidden row limit', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const insert = runtime.sqlite.prepare(
      'INSERT INTO bootstrap_snapshots (id, project_root, created_at) VALUES (?, ?, ?)'
    );
    runtime.sqlite.transaction(() => {
      for (let index = 0; index < 10_001; index++) {
        insert.run(`snapshot-${index}`, tmpDir, '2026-01-01T00:00:00Z');
      }
      insert.run('other-project', '/other-project', '2026-01-01T00:00:00Z');
    })();
    expect(await repositories.generateRepository.clearProject(tmpDir)).toBe(10_001);
    expect(await repositories.generateRepository.getSnapshotCount(tmpDir)).toBe(0);
    expect(await repositories.generateRepository.getSnapshotCount('/other-project')).toBe(1);
  });

  it('preserves snapshot fields through both public creation routes', async () => {
    const repo = createAlembicRepositories(runtime.connection).generateRepository;
    const fields = {
      projectRoot: tmpDir,
      createdAt: '2026-01-01T00:00:00Z',
      sessionId: 'snapshot-session',
      primaryLang: 'typescript',
      fileHashes: { 'src/main.ts': 'content-hash' },
      dimensionMeta: {
        architecture: { candidateCount: 1, analysisChars: 12, referencedFiles: 1, durationMs: 2 },
      },
      episodicData: { findings: ['boundary verified'] },
      isIncremental: true,
      changedFiles: ['src/main.ts'],
      affectedDims: ['architecture'],
    };
    const direct = await repo.create({ ...fields, id: 'direct-snapshot' });
    const atomic = await repo.saveWithDimFiles({ ...fields, id: 'atomic-snapshot' }, [
      { snapshotId: 'atomic-snapshot', dimId: 'architecture', filePath: 'src/main.ts' },
    ]);
    expect(direct).toMatchObject(fields);
    expect({ ...direct, id: atomic.id }).toEqual(atomic);
    expect(await repo.getDimFiles(atomic.id)).toEqual([
      { dimId: 'architecture', filePath: 'src/main.ts' },
    ]);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { KnowledgeEntry } from '../src/knowledge.js';
import {
  ALEMBIC_REPOSITORY_KEYS,
  createAlembicRepositories,
  isAlembicRepositoryKey,
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
    repositories.recipeSourceRefRepository.upsert({
      recipeId: entry.id,
      sourcePath: 'src/example.ts',
      verifiedAt: Date.now(),
    });

    const fetched = await repositories.knowledgeRepository.findById(entry.id);
    const sourceRefs = repositories.recipeSourceRefRepository.findByRecipeId(entry.id);

    expect(fetched?.title).toBe('Stable repository factory');
    expect(sourceRefs).toHaveLength(1);
    expect(sourceRefs[0].sourcePath).toBe('src/example.ts');
  });

  it('publishes stable repository keys for outer DI registration', () => {
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('knowledgeRepository');
    expect(ALEMBIC_REPOSITORY_KEYS).toContain('recipeSourceRefRepository');
    expect(isAlembicRepositoryKey('proposalRepository')).toBe(true);
    expect(isAlembicRepositoryKey('tokenUsageStore')).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepository.impl.js';
import pathGuard from '../src/shared/PathGuard.js';

describe('DatabaseConnection and repository migration integration', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-db-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs all active migrations against a real SQLite file', () => {
    const db = connection.getDb();
    const applied = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: string }).version);

    expect(applied).toEqual([
      '001_initial_schema',
      '004_evolution_proposals',
      '005_recipe_source_refs',
      '006_lifecycle_transition_events',
      '007_evolution_type_simplification',
      '008_recipe_warnings',
      '009_knowledge_dimension_id',
    ]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain('knowledge_entries');
    expect(tables).toContain('recipe_source_refs');
    expect(tables).toContain('evolution_proposals');
    expect(tables).not.toContain('remote_commands');
    expect(tables).not.toContain('remote_state');
  });

  it('persists and reads a KnowledgeEntry through KnowledgeRepositoryImpl', async () => {
    const repo = new KnowledgeRepositoryImpl(connection);
    const entry = new KnowledgeEntry({
      title: 'Repository persistence pattern',
      description: 'Repository storage smoke test',
      lifecycle: 'active',
      language: 'typescript',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      content: {
        pattern: 'const repo = new KnowledgeRepositoryImpl(connection);',
        rationale: 'Repository should round-trip domain entries through SQLite.',
      },
      reasoning: {
        whyStandard: 'Verifies migrated database and repository code together.',
        sources: ['test/DatabaseRepository.test.ts'],
        confidence: 0.9,
      },
    });

    const created = await repo.create(entry);
    expect(created?.id).toBe(entry.id);

    const fetched = await repo.findById(entry.id);
    expect(fetched?.title).toBe('Repository persistence pattern');
    expect(fetched?.content.pattern).toContain('KnowledgeRepositoryImpl');
  });
});

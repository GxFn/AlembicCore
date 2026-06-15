import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import {
  SourceGraphLifecycleService,
  SourceGraphService,
} from '../src/service/source-graph/index.js';
import { runAllPhases } from '../src/workflows/capabilities/project-intelligence/ProjectIntelligenceRunner.js';
import { getGhostWorkspaceDir, ProjectRegistry, WorkspaceResolver } from '../src/workspace.js';

describe('SourceGraphLifecycleService', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;
  const originalAlembicHome = process.env.ALEMBIC_HOME;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-lifecycle-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    pathGuard._reset();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    if (originalAlembicHome === undefined) {
      delete process.env.ALEMBIC_HOME;
    } else {
      process.env.ALEMBIC_HOME = originalAlembicHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds durable cold-start source graph tables and catches up stale files on startup', async () => {
    writeFixture('src/index.ts', "import { helper } from './util';\nexport class App {}\n");
    writeFixture('src/util.ts', 'export function helper() { return 1; }\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(repositories.sourceGraphRepository);
    const service = new SourceGraphService(repositories.sourceGraphRepository);

    const missing = await service.searchSourceGraph({ projectRoot: tmpDir, query: 'App' });
    expect(missing.ready).toBe(false);
    expect(missing.freshness.status).toBe('uninitialized');
    expect(missing.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'source-ref-unproven'
    );

    const coldStart = await lifecycle.buildColdStartIndex({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-cold-start',
      now: 1000,
      includeExtensions: ['.ts'],
    });

    expect(coldStart).toMatchObject({
      operation: 'source-graph-lifecycle',
      reason: 'cold-start',
      action: 'built-full',
      freshness: { status: 'fresh' },
    });
    expect(coldStart.durableTables.source_graph_files).toBe(2);
    expect(coldStart.durableTables.source_graph_symbols).toBeGreaterThanOrEqual(4);
    expect(countTable('source_graph_generations')).toBe(1);
    expect(countTable('source_graph_files')).toBe(2);
    expect(countTable('source_graph_symbols')).toBeGreaterThanOrEqual(4);
    expect(countTable('source_graph_edges')).toBe(1);

    writeFixture(
      'src/util.ts',
      'export function helper() { return 2; }\nexport const changed = true;\n'
    );

    const catchUp = await lifecycle.catchUpOnStartup({
      projectRoot: tmpDir,
      repoId: 'fixture',
      projectScope: 'src',
      generationId: 'gen-startup-catch-up',
      now: 2000,
      includeExtensions: ['.ts'],
    });

    expect(catchUp).toMatchObject({
      reason: 'startup-catch-up',
      action: 'built-incremental',
      freshness: { status: 'fresh' },
    });
    expect(catchUp.changedFiles).toStrictEqual(['src/util.ts']);
    expect(catchUp.deletedFiles).toStrictEqual([]);
    expect(countTable('source_graph_generations')).toBe(2);
  });

  it('materializes source graph during project intelligence cold start', async () => {
    writeFixture('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFixture('src/index.ts', 'export function bootstrapApp() { return true; }\n');

    const repositories = createAlembicRepositories(runtime.connection);
    const container = {
      get(name: string) {
        return name === 'sourceGraphRepository' ? repositories.sourceGraphRepository : null;
      },
    };
    const logger = { info() {}, warn() {} };

    const result = await runAllPhases(
      tmpDir,
      { container, logger },
      {
        generateReport: true,
        maxFiles: 20,
        skipGuard: true,
        materialize: {
          codeEntityGraph: false,
          callGraph: false,
          sourceGraph: true,
          dependencyEdges: false,
          moduleEntities: false,
          guardViolations: false,
          panorama: false,
        },
        sourceGraph: {
          repoId: 'fixture',
          includeExtensions: ['.ts'],
        },
      }
    );

    expect(result.sourceGraphResult).toMatchObject({
      reason: 'cold-start',
      action: 'built-full',
      freshness: { status: 'fresh' },
    });
    expect(result.report?.phases.sourceGraph).toMatchObject({
      action: 'built-full',
      freshness: 'fresh',
    });
    expect(countTable('source_graph_generations')).toBe(1);
    expect(countTable('source_graph_files')).toBeGreaterThanOrEqual(1);
  });

  it('opens Ghost-mode source graph storage through resolver dataRoot when PathGuard is configured to the source root', async () => {
    runtime.close();
    fs.rmSync(path.join(tmpDir, '.asd'), { recursive: true, force: true });
    const tempAlembicHome = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-ghost-home-'));
    process.env.ALEMBIC_HOME = tempAlembicHome;
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    const entry = ProjectRegistry.register(tmpDir, true);
    const ghostDataRoot = getGhostWorkspaceDir(entry.id);
    fs.mkdirSync(ghostDataRoot, { recursive: true });
    const resolver = WorkspaceResolver.fromProject(tmpDir);

    runtime = await openAlembicDatabase(
      { path: '.asd/alembic.db' },
      { workspaceResolver: resolver }
    );
    writeFixture('src/index.ts', 'export const ghost = true;\n');
    const repositories = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(repositories.sourceGraphRepository);

    const result = await lifecycle.buildColdStartIndex({
      projectRoot: tmpDir,
      repoId: 'ghost-fixture',
      projectScope: 'src',
      generationId: 'gen-ghost',
      now: 3000,
      includeExtensions: ['.ts'],
    });

    expect(result.action).toBe('built-full');
    expect(fs.existsSync(path.join(ghostDataRoot, '.asd', 'alembic.db'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.asd', 'alembic.db'))).toBe(false);
    expect(result.durableTables.source_graph_files).toBe(1);
  });

  function writeFixture(repoRelativePath: string, content: string): void {
    const absolutePath = path.join(tmpDir, repoRelativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }

  function countTable(tableName: string): number {
    const row = runtime.sqlite.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
      count: number;
    };
    return row.count;
  }
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  analyzeProject,
  analyzeSourceFile,
  buildProjectSnapshot,
  CallGraphAnalyzer,
  CORE_GRAMMAR_RESOURCE_FILES,
  ensureProjectGrammarResources,
  getDiscovererRegistry,
  getProjectDiscovererRegistry,
  isProjectAstAvailable,
  LanguageService,
  listCoreGrammarResources,
  loadProjectAstPlugins,
  PanoramaService,
  ProjectGraph,
  ProjectIntelligenceCapability,
  parseCMakeProject,
  parseGradleProject,
  resetDiscovererRegistry,
  resetProjectDiscovererRegistry,
  tryBuildProjectGraph,
} from '../src/project-intelligence.js';

describe('stable project intelligence entrypoint', () => {
  it('exposes language, grammar resource, and AST analysis contracts', async () => {
    const resources = listCoreGrammarResources();
    const grammarResult = await ensureProjectGrammarResources({ ts: 1, py: 1, swift: 1 });
    const summary = analyzeSourceFile(
      `
        export class UserService {
          findUser(id: string) {
            return id;
          }
        }
      `,
      'typescript'
    );

    expect(LanguageService.inferLang('src/app.ts')).toBe('typescript');
    expect(resources).toHaveLength(CORE_GRAMMAR_RESOURCE_FILES.length);
    expect(resources.every((resource) => resource.available)).toBe(true);
    expect(grammarResult.failed).toEqual([]);
    expect(grammarResult.alreadyAvailable).toEqual(
      expect.arrayContaining(['typescript', 'python', 'swift'])
    );
    expect(grammarResult.reloaded).toBe(true);
    expect(summary?.classes.some((item) => item.name === 'UserService')).toBe(true);
  });

  it('exposes discovery and config parser contracts through one facade', () => {
    resetDiscovererRegistry();
    const directRegistry = getDiscovererRegistry();
    const directDiscovererIds = directRegistry.getAll().map((discoverer) => discoverer.id);
    resetProjectDiscovererRegistry();
    const registry = getProjectDiscovererRegistry();
    const discovererIds = registry.getAll().map((discoverer) => discoverer.id);
    const cmake = parseCMakeProject(
      'project(Core VERSION 1.0)\nadd_library(core STATIC src/a.cpp)'
    );
    const gradle = parseGradleProject('rootProject.name = "demo"\ninclude(":app", ":core")');

    expect(directDiscovererIds).toEqual(discovererIds);
    expect(discovererIds).toEqual(expect.arrayContaining(['node', 'spm', 'generic']));
    expect(cmake.projectName).toBe('Core');
    expect(cmake.targets[0]?.name).toBe('core');
    expect(gradle.rootProjectName).toBe('demo');
    expect(gradle.includedModules.map((module) => module.path)).toEqual([':app', ':core']);
  });

  it('exposes project graph, call graph, panorama, and snapshot contracts', () => {
    const snapshot = buildProjectSnapshot({
      projectRoot: '/project',
      allFiles: [],
      allTargets: [],
      discoverer: { id: 'generic', displayName: 'Generic' },
      langStats: { ts: 2 },
      primaryLang: 'typescript',
      astProjectSummary: null,
      astContext: null,
      codeEntityResult: null,
      callGraphResult: null,
      panoramaResult: null,
      depGraphData: null,
      guardAudit: null,
      activeDimensions: [],
      warnings: [],
    });

    expect(ProjectGraph).toBeDefined();
    expect(analyzeProject).toBeInstanceOf(Function);
    expect(isProjectAstAvailable).toBeInstanceOf(Function);
    expect(loadProjectAstPlugins).toBeInstanceOf(Function);
    expect(new CallGraphAnalyzer('/project')).toBeDefined();
    expect(PanoramaService).toBeDefined();
    expect(ProjectIntelligenceCapability.run).toBeInstanceOf(Function);
    expect(snapshot.projectRoot).toBe('/project');
    expect(snapshot.language.primaryLang).toBe('typescript');
  });

  it('uses workspace.config repoNames as the default ProjectGraph boundary', async () => {
    const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-graph-workspace-config-'));
    try {
      writeFixture(
        controlRoot,
        'workspace.config.json',
        JSON.stringify({
          repoNames: ['Alembic', 'AlembicCore'],
          repositories: [
            { name: 'Alembic', mode: 'external', path: 'Alembic' },
            { name: 'AlembicCore', mode: 'external', path: 'AlembicCore' },
            { name: 'Test', mode: 'internal', path: 'Test' },
          ],
        })
      );
      writeFixture(controlRoot, 'Alembic/src/index.ts', 'export class AlembicApp {}\n');
      writeFixture(controlRoot, 'AlembicCore/src/index.ts', 'export class CoreApp {}\n');
      writeFixture(controlRoot, 'Test/src/index.ts', 'export class TestApp {}\n');
      writeFixture(controlRoot, 'wakeflow-ledger/src/index.ts', 'export class LedgerApp {}\n');

      const result = await tryBuildProjectGraph(controlRoot, {
        extensions: ['.ts'],
        maxFiles: 20,
        reloadAstPlugins: true,
      });
      if (!result.available) {
        throw new Error(`ProjectGraph unavailable: ${result.reason}`);
      }

      expect(result.graph.getAllFilePaths().sort()).toEqual([
        'Alembic/src/index.ts',
        'AlembicCore/src/index.ts',
      ]);
    } finally {
      fs.rmSync(controlRoot, { recursive: true, force: true });
    }
  });
});

function writeFixture(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

import { describe, expect, it } from 'vitest';

import {
  analyzeSourceFile,
  buildProjectSnapshot,
  CallGraphAnalyzer,
  CORE_GRAMMAR_RESOURCE_FILES,
  ensureProjectGrammarResources,
  getProjectDiscovererRegistry,
  LanguageService,
  listCoreGrammarResources,
  PanoramaService,
  ProjectGraph,
  ProjectIntelligenceCapability,
  parseCMakeProject,
  parseGradleProject,
  resetProjectDiscovererRegistry,
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
    resetProjectDiscovererRegistry();
    const registry = getProjectDiscovererRegistry();
    const discovererIds = registry.getAll().map((discoverer) => discoverer.id);
    const cmake = parseCMakeProject(
      'project(Core VERSION 1.0)\nadd_library(core STATIC src/a.cpp)'
    );
    const gradle = parseGradleProject('rootProject.name = "demo"\ninclude(":app", ":core")');

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
    expect(new CallGraphAnalyzer('/project')).toBeDefined();
    expect(PanoramaService).toBeDefined();
    expect(ProjectIntelligenceCapability.run).toBeInstanceOf(Function);
    expect(snapshot.projectRoot).toBe('/project');
    expect(snapshot.language.primaryLang).toBe('typescript');
  });
});

import { describe, expect, it } from 'vitest';
import { ProjectContext } from '../src/project-context.js';
import {
  analyzeSourceFile,
  CORE_GRAMMAR_RESOURCE_FILES,
  ensureProjectGrammarResources,
  getDiscovererRegistry,
  getProjectDiscovererRegistry,
  isProjectAstAvailable,
  LanguageService,
  listCoreGrammarResources,
  parseCMakeProject,
  parseGradleProject,
  resetDiscovererRegistry,
  resetProjectDiscovererRegistry,
} from '../src/project-intelligence.js';

describe('stable project intelligence entrypoint', () => {
  it('exposes language, grammar resource, and file-level AST contracts', async () => {
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
    expect(isProjectAstAvailable).toBeInstanceOf(Function);
    expect(summary?.classes.some((item) => item.name === 'UserService')).toBe(true);
  });

  it('exposes discovery parser contracts without returning project-information answers', () => {
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

  it('withdraws project-information outputs in favor of ProjectContext', async () => {
    const projectIntelligenceModule = (await import('../src/project-intelligence.js')) as Record<
      string,
      unknown
    >;

    expect(ProjectContext.execute).toBeInstanceOf(Function);
    expect(Object.hasOwn(projectIntelligenceModule, 'ProjectGraph')).toBe(false);
    expect(Object.hasOwn(projectIntelligenceModule, 'tryBuildProjectGraph')).toBe(false);
    expect(Object.hasOwn(projectIntelligenceModule, 'PanoramaService')).toBe(false);
    expect(Object.hasOwn(projectIntelligenceModule, 'ProjectIntelligenceCapability')).toBe(false);
    expect(Object.hasOwn(projectIntelligenceModule, 'buildProjectSnapshot')).toBe(false);
    expect(Object.hasOwn(projectIntelligenceModule, 'runAllPhases')).toBe(false);
  });
});

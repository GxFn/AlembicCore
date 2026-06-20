import { beforeAll, describe, expect, it } from 'vitest';
import {
  AST_LANGUAGE_TEST_PLUGINS,
  analyzeFile,
  analyzeProject,
  CallGraphAnalyzer,
  getAstLanguageTestPlugin,
  getDiscovererRegistry,
  goAstPlugin,
  ImportRecord,
  isAvailable,
  LanguageService,
  parseBoxfile,
  parseGradleProject,
  prepareProjectAnalysisTestFixtures,
  RULE_TO_LANGUAGE,
  resetDiscovererRegistry,
  typeScriptAstPlugin,
} from '../src/test-fixtures.js';

describe('public test-fixtures migration surface', () => {
  beforeAll(async () => {
    const prepared = await prepareProjectAnalysisTestFixtures({
      languages: { go: 1, ts: 1 },
      resetDiscoveryRegistry: true,
    });

    expect(prepared.failed).toEqual([]);
  });

  it('exposes real AST project helpers through test-fixtures', () => {
    const fileSummary = analyzeFile(
      `
        export class FixtureService {
          run() {
            return 'ok';
          }
        }
      `,
      'typescript'
    );
    const projectSummary = analyzeProject(
      [
        {
          content: 'export class ProjectFixture { handle() { return 1; } }',
          name: 'ProjectFixture.ts',
          relativePath: 'src/ProjectFixture.ts',
        },
      ],
      'typescript',
      {}
    );

    expect(isAvailable()).toBe(true);
    expect(fileSummary?.classes.some((item) => item.name === 'FixtureService')).toBe(true);
    expect(projectSummary.fileCount).toBe(1);
    expect(projectSummary.classes.some((item) => item.name === 'ProjectFixture')).toBe(true);
  });

  it('exposes discovery registry and parser helpers through test-fixtures', () => {
    resetDiscovererRegistry();
    const registry = getDiscovererRegistry();
    const gradle = parseGradleProject('rootProject.name = "demo"\ninclude(":app", ":core")');
    const boxfile = parseBoxfile("host_app 'FixtureApp', '1.0.0'\nlayer 'Domain' do\nend");

    expect(registry.getAll().map((discoverer) => discoverer.id)).toEqual(
      expect.arrayContaining(['node', 'spm', 'generic'])
    );
    expect(gradle.rootProjectName).toBe('demo');
    expect(gradle.includedModules.map((module) => module.path)).toEqual([':app', ':core']);
    expect(boxfile.hostApp).toEqual({ name: 'FixtureApp', version: '1.0.0' });
    expect(RULE_TO_LANGUAGE.go_library).toBe('go');
  });

  it('exposes analysis classes and language plugin fixtures without deep core imports', () => {
    const importRecord = new ImportRecord('./service/UserService', {
      kind: 'named',
      symbols: ['UserService'],
    });
    const analyzer = new CallGraphAnalyzer('/project');

    expect(importRecord.hasSymbol('UserService')).toBe(true);
    expect(analyzer).toBeInstanceOf(CallGraphAnalyzer);
    expect(typeScriptAstPlugin.extractCallSites).toBeInstanceOf(Function);
    expect(getAstLanguageTestPlugin('typescript')).toBe(typeScriptAstPlugin);
    expect(AST_LANGUAGE_TEST_PLUGINS.go).toBe(goAstPlugin);
  });

  it('keeps project-intelligence residual helpers available from the test fixture path', () => {
    expect(LanguageService.detectProjectLanguages('/project', { discovererIds: ['go'] })).toEqual([
      'go',
    ]);
  });
});

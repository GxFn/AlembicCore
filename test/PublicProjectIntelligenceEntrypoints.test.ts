import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeFile, isAvailable } from '../src/core/AstAnalyzer.js';
import {
  ensureGrammars,
  inferLanguagesFromStats,
  reloadPlugins,
} from '../src/core/ast/ensureGrammars.js';
import {
  analyzeSourceFile,
  CORE_GRAMMAR_RESOURCE_FILES,
  ensureProjectGrammarResources,
  isParserReady,
  listCoreGrammarResources,
} from '../src/core/ast/index.js';
import {
  getDiscovererRegistry,
  parseCMakeProject,
  parseGradleProject,
  resetDiscovererRegistry,
} from '../src/core/discovery/index.js';
import { ProjectContext } from '../src/project-context.js';
import LanguageService from '../src/shared/LanguageService.js';

describe('retired project intelligence public entrypoint', () => {
  it('routes language, grammar resource, and file-level AST contracts through generic core/shared routes', async () => {
    const resources = listCoreGrammarResources();
    const grammarResult = await ensureProjectGrammarResources({ ts: 1, py: 1, swift: 1 });
    const source = `
        export class UserService {
          findUser(id: string) {
            return id;
          }
        }
      `;
    const summary = analyzeSourceFile(source, 'typescript');

    // 合并旧AstGrammar测试的独有legacy入口门禁；不能以函数存在代替真实WASM可用与解析。
    const languages = inferLanguagesFromStats({ ts: 1, py: 1, swift: 1 });
    const legacyResult = await ensureGrammars(languages);
    await reloadPlugins();
    const legacySummary = analyzeFile(source, 'typescript');

    expect(LanguageService.inferLang('src/app.ts')).toBe('typescript');
    expect(resources).toHaveLength(CORE_GRAMMAR_RESOURCE_FILES.length);
    expect(resources.every((resource) => resource.available)).toBe(true);
    expect(grammarResult.failed).toEqual([]);
    expect(grammarResult.alreadyAvailable).toEqual(
      expect.arrayContaining(['typescript', 'python', 'swift'])
    );
    expect(grammarResult.reloaded).toBe(true);
    expect(isParserReady).toBeInstanceOf(Function);
    expect(languages).toEqual(expect.arrayContaining(['typescript', 'python', 'swift']));
    expect(legacyResult.failed).toEqual([]);
    expect(legacyResult.alreadyAvailable).toEqual(expect.arrayContaining(languages));
    expect(isAvailable()).toBe(true);
    expect(summary?.classes.some((item) => item.name === 'UserService')).toBe(true);
    expect(legacySummary?.classes.some((item) => item.name === 'UserService')).toBe(true);
  });

  it('keeps discovery parser contracts on core/discovery instead of the retired facade', () => {
    resetDiscovererRegistry();
    const registry = getDiscovererRegistry();
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

  it('withdraws the public project-information routes in favor of ProjectContext', async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, unknown> };
    const rootModule = (await import('../src/index.js')) as Record<string, unknown>;
    const hostAgentModule = (await import('../src/host-agent-workflows.js')) as Record<
      string,
      unknown
    >;
    const capabilitiesModule = (await import('../src/workflows/surfaces/index.js')) as Record<
      string,
      unknown
    >;

    expect(ProjectContext.execute).toBeInstanceOf(Function);
    expect(packageJson.exports['./project-intelligence']).toBeUndefined();
    expect(packageJson.exports['./service/panorama']).toBeUndefined();
    expect(packageJson.exports['./workflows/capabilities/project-intelligence']).toBeUndefined();
    expect(Object.hasOwn(rootModule, 'ProjectIntelligenceCapability')).toBe(false);
    expect(Object.hasOwn(rootModule, 'buildIDEAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(rootModule, 'buildIDEAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(Object.hasOwn(rootModule, 'ProjectSnapshot')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildIDEAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildIDEAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(Object.hasOwn(capabilitiesModule, 'ProjectIntelligenceCapability')).toBe(false);
    expect(Object.hasOwn(capabilitiesModule, 'runAllPhases')).toBe(false);
  });
});

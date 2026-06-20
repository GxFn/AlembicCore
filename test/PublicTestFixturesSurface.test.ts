import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AST_LANGUAGE_TEST_PLUGINS,
  analyzeFile,
  analyzeProject,
  buildEntityGraphInput,
  CallGraphAnalyzer,
  detectConflict,
  getAstLanguageTestPlugin,
  getDiscovererRegistry,
  goAstPlugin,
  ImportRecord,
  isAvailable,
  LanguageService,
  loadPreference,
  materializeCallGraph,
  parseBoxfile,
  parseGradleProject,
  prepareProjectAnalysisTestFixtures,
  RULE_TO_LANGUAGE,
  resetDiscovererRegistry,
  resolveProjectAnalysisMaterialization,
  runPhase1_7_CallGraph,
  runPhase2_DependencyGraph,
  savePreference,
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

  it('exposes materialization and phase-runner helpers with Core behavior intact', async () => {
    expect(resolveProjectAnalysisMaterialization(undefined)).toEqual({
      codeEntityGraph: true,
      callGraph: true,
      dependencyEdges: true,
      moduleEntities: true,
      guardViolations: true,
      panorama: true,
      sourceGraph: true,
    });
    expect(resolveProjectAnalysisMaterialization(false)).toEqual({
      codeEntityGraph: false,
      callGraph: false,
      dependencyEdges: false,
      moduleEntities: false,
      guardViolations: false,
      panorama: false,
      sourceGraph: false,
    });
    expect(resolveProjectAnalysisMaterialization({ dependencyEdges: false })).toMatchObject({
      codeEntityGraph: true,
      dependencyEdges: false,
      panorama: true,
    });

    const astProjectSummary = createAstSummaryWithCallSite();
    expect(buildEntityGraphInput(null, '/project')).toBeNull();
    expect(buildEntityGraphInput(astProjectSummary, '/project')).toEqual({
      astProjectSummary,
      projectRoot: '/project',
    });

    const skippedContainer = { get: vi.fn() };
    const logger = createLogger();
    const analyzed = await runPhase1_7_CallGraph(
      astProjectSummary,
      '/project',
      skippedContainer,
      logger,
      {
        materialize: false,
      }
    );

    expect(analyzed.callGraphAnalysis?.callEdges).toHaveLength(1);
    expect(analyzed.callGraphAnalysis?.dataFlowEdges).toHaveLength(1);
    expect(analyzed.callGraphResult).toBeNull();
    expect(skippedContainer.get).not.toHaveBeenCalled();

    const clearCallGraphForFiles = vi.fn().mockResolvedValue({ deletedEdges: 1 });
    const populateCallGraph = vi
      .fn()
      .mockResolvedValue({ entitiesUpserted: 2, edgesCreated: 1, durationMs: 4 });
    const getCodeEntityGraphClass = vi.fn().mockResolvedValue(
      class FakeCodeEntityGraph {
        clearCallGraphForFiles = clearCallGraphForFiles;
        populateCallGraph = populateCallGraph;
      }
    );
    const materializeContainer = {
      get: vi.fn((name: string) =>
        name === 'codeEntityRepository' || name === 'knowledgeEdgeRepository' ? {} : undefined
      ),
    };
    const callGraphAnalysis = createCallGraphAnalysis({ incremental: true });

    const materialized = await materializeCallGraph({
      callGraphAnalysis,
      projectRoot: '/project',
      container: materializeContainer,
      logger,
      changedFiles: ['src/service/UserService.ts'],
      getCodeEntityGraphClass,
    });

    expect(getCodeEntityGraphClass).toHaveBeenCalledOnce();
    expect(clearCallGraphForFiles).toHaveBeenCalledWith(['src/service/UserService.ts']);
    expect(populateCallGraph).toHaveBeenCalledWith(
      callGraphAnalysis.callEdges,
      callGraphAnalysis.dataFlowEdges
    );
    expect(materialized.callGraphResult).toEqual({
      entitiesUpserted: 2,
      edgesCreated: 1,
      durationMs: 4,
    });

    const addEdge = vi.fn().mockResolvedValue({ success: true });
    const discoverer = createDiscoverer();
    const dependencyContainer = {
      get: vi.fn((name: string) => (name === 'knowledgeGraphService' ? { addEdge } : undefined)),
    };

    const collectedOnly = await runPhase2_DependencyGraph(
      discoverer,
      dependencyContainer,
      logger,
      'rescan',
      { materializeEdges: false }
    );
    expect(collectedOnly.depGraphData?.edges).toHaveLength(1);
    expect(collectedOnly.depEdgesWritten).toBe(0);
    expect(addEdge).not.toHaveBeenCalled();

    const written = await runPhase2_DependencyGraph(
      discoverer,
      dependencyContainer,
      logger,
      'rescan'
    );
    expect(written.depEdgesWritten).toBe(1);
    expect(addEdge).toHaveBeenCalledWith('app', 'module', 'core', 'module', 'depends_on', {
      weight: 1.0,
      source: 'demo-rescan',
    });
  });

  it('exposes discovery preference helpers without deep discovery imports', () => {
    const result = detectConflict([
      { discovererId: 'spm', displayName: 'SPM', confidence: 0.85 },
      { discovererId: 'custom', displayName: 'Custom', confidence: 0.8 },
    ]);
    expect(result.ambiguous).toBe(true);
    expect(result.reason).toContain('similar confidence');

    const testDir = join(tmpdir(), `core-test-fixture-pref-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      expect(loadPreference(testDir)).toBeNull();
      savePreference(testDir, 'custom-config', ['spm', 'cocoapods'], true);

      const preference = loadPreference(testDir);
      expect(preference).toMatchObject({
        selectedDiscoverer: 'custom-config',
        alternatives: ['spm', 'cocoapods'],
        userConfirmed: true,
      });

      writeFileSync(join(testDir, '.asd', 'discoverer-preference.json'), 'NOT VALID JSON', 'utf8');
      expect(loadPreference(testDir)).toBeNull();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

function createDiscoverer(): Parameters<typeof runPhase2_DependencyGraph>[0] {
  return {
    id: 'demo',
    displayName: 'Demo',
    load: vi.fn(),
    listTargets: vi.fn(),
    getTargetFiles: vi.fn(),
    getDependencyGraph: vi.fn().mockResolvedValue({
      nodes: [{ id: 'app' }, { id: 'core' }],
      edges: [{ from: 'app', to: 'core' }],
    }),
  };
}

function createAstSummaryWithCallSite(): Parameters<typeof runPhase1_7_CallGraph>[0] {
  return {
    lang: 'typescript',
    fileCount: 1,
    classes: [{ name: 'UserService', kind: 'class', line: 1 }],
    protocols: [],
    categories: [],
    inheritanceGraph: [],
    patternStats: {},
    projectMetrics: {},
    fileSummaries: [
      {
        file: 'src/service/UserService.ts',
        classes: [{ name: 'UserService', kind: 'class', line: 1 }],
        protocols: [],
        methods: [
          { name: 'getUser', className: 'UserService', line: 5, kind: 'definition' },
          { name: 'listUsers', className: 'UserService', line: 15, kind: 'definition' },
        ],
        imports: [],
        exports: [],
        callSites: [
          {
            callee: 'listUsers',
            callerMethod: 'getUser',
            callerClass: 'UserService',
            callType: 'method',
            receiver: 'this',
            receiverType: 'UserService',
            argCount: 0,
            line: 8,
            isAwait: false,
          },
        ],
      },
    ],
  } as Parameters<typeof runPhase1_7_CallGraph>[0];
}

function createCallGraphAnalysis({
  incremental,
}: {
  incremental: boolean;
}): NonNullable<Parameters<typeof materializeCallGraph>[0]['callGraphAnalysis']> {
  return {
    callEdges: [
      {
        caller: 'src/service/UserService.ts::UserService.getUser',
        callee: 'src/service/UserService.ts::UserService.listUsers',
        callType: 'method',
        resolveMethod: 'direct',
        line: 8,
        file: 'src/service/UserService.ts',
        isAwait: false,
        argCount: 0,
      },
    ],
    dataFlowEdges: [],
    stats: {
      totalCallSites: 1,
      resolvedCallSites: 1,
      resolvedRate: 1,
      totalEdges: 1,
      filesProcessed: 1,
      symbolCount: 2,
      durationMs: 3,
      incremental,
    },
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

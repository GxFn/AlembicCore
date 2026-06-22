import { describe, expect, it } from 'vitest';
import {
  aggregateDynamicPlanningSignals,
  buildDimensionPlanningAids,
  queryPerModuleCoverage,
  resolveActiveDimensions,
  resolvePlanDimensionDefinitions,
  resolveSignalAwareActiveDimensions,
} from '../src/dimensions.js';
import type {
  ProjectContextPresenterInput,
  ProjectContextRef,
  ProjectContextRefKind,
} from '../src/project-context.js';
import {
  analyzeArchitectureIntelligence,
  createProjectContextCapabilities,
} from '../src/project-context-capabilities.js';

function ref(kind: ProjectContextRefKind, id: string, filePath?: string): ProjectContextRef {
  return {
    id,
    kind,
    label: id.split(':').at(-1),
    scope: {
      projectRoot: '/fixture/bilidili',
      filePath,
    },
  };
}

const swiftFiles = {
  app: file('Sources/BiliDiliApp/BiliDiliApp.swift', 140),
  feed: file('Sources/BiliDiliApp/Feed/VideoFeedView.swift', 420),
  network: file('Sources/BiliDiliApp/Networking/VideoAPIClient.swift', 310),
  player: file('Sources/BiliDiliApp/Player/VideoPlaybackActor.swift', 260),
  test: file('Tests/BiliDiliAppTests/VideoFeedTests.swift', 180),
};

function file(filePath: string, lineCount: number) {
  return {
    filePath,
    language: 'swift',
    lineCount,
    ref: ref('file', `file:${filePath}`, filePath),
  };
}

function moduleContext(
  id: string,
  name: string,
  ownedFile: (typeof swiftFiles)[keyof typeof swiftFiles],
  role?: string,
  configLayer?: string
) {
  return {
    module: {
      id,
      name,
      role,
      configLayer,
      ownedFileCount: 1,
      ref: ref('module', `module:${id}`),
    },
    ownedFiles: [ownedFile],
    publicSurfaces: [],
    inflow: [],
    outflow: [],
    nextRefs: [],
  };
}

function fileFlow(fileInfo: (typeof swiftFiles)[keyof typeof swiftFiles], imports: string[]) {
  return {
    file: fileInfo,
    imports: imports.map((name) => ({
      kind: 'imports',
      label: name,
      to: { label: name },
      filePath: fileInfo.filePath,
      ref: ref('relation-site', `import:${fileInfo.filePath}:${name}`, fileInfo.filePath),
    })),
    exports: [],
    callers: [],
    callees: [],
    inflow: [],
    outflow: [],
    nextRefs: [],
  };
}

function fileSymbols(fileInfo: (typeof swiftFiles)[keyof typeof swiftFiles], names: string[]) {
  return {
    file: fileInfo,
    symbols: names.map((name) => ({
      name,
      kind: name.endsWith('Tests') ? 'test' : 'class',
      filePath: fileInfo.filePath,
      ref: ref('symbol', `symbol:${name}`, fileInfo.filePath),
    })),
    naming: { warnings: [] },
    nextRefs: [],
  };
}

function bilidiliProjectContext(): ProjectContextPresenterInput {
  const app = moduleContext('app', 'BiliDiliApp', swiftFiles.app, 'app', 'Application');
  const feed = moduleContext('feed', 'VideoFeedView', swiftFiles.feed, 'ui', 'Application');
  const network = moduleContext(
    'network',
    'VideoAPIClient',
    swiftFiles.network,
    'networking',
    'Services'
  );
  const player = moduleContext(
    'player',
    'VideoPlaybackActor',
    swiftFiles.player,
    'service',
    'Services'
  );
  const tests = moduleContext('tests', 'VideoFeedTests', swiftFiles.test, 'test', 'Tests');

  return {
    project: {
      projectRoot: '/fixture/bilidili',
      displayName: 'BiliDili',
    },
    envelopes: [],
    refs: [],
    files: Object.values(swiftFiles),
    warnings: [],
    unavailable: [],
    repo: {
      repo: { id: 'bilidili', name: 'bilidili', root: '/fixture/bilidili' },
      languages: [{ language: 'swift', fileCount: 5 }],
      buildSystems: [{ kind: 'spm', configRefs: [ref('path', 'Package.swift')] }],
      packageSystems: [{ kind: 'spm', manifestRefs: [ref('path', 'Package.swift')] }],
      targets: [
        { name: 'BiliDiliApp', kind: 'ios-app', refs: [ref('path', 'Package.swift')] },
        { name: 'BiliDiliAppTests', kind: 'test', refs: [ref('path', 'Package.swift')] },
      ],
      localPackages: [],
      sourceRoots: [{ path: 'Sources' }, { path: 'Tests' }],
      entrypoints: [
        {
          name: 'BiliDiliApp',
          kind: 'ios-app',
          refs: [ref('file', 'entry:BiliDiliApp', swiftFiles.app.filePath)],
        },
      ],
      commands: [{ name: 'test', command: 'swift test', sourceRef: ref('path', 'Package.swift') }],
      topAreas: [{ path: 'Sources/BiliDiliApp' }, { path: 'Tests' }],
      configFiles: [{ path: 'Package.swift', kind: 'spm', ref: ref('path', 'Package.swift') }],
      nextRefs: [],
    },
    map: {
      repo: { id: 'bilidili', name: 'bilidili', root: '/fixture/bilidili' },
      modules: [
        {
          id: 'app',
          name: 'BiliDiliApp',
          role: 'app',
          configLayer: 'Application',
          ownedFileCount: 1,
        },
        {
          id: 'feed',
          name: 'VideoFeedView',
          role: 'ui',
          configLayer: 'Application',
          ownedFileCount: 1,
        },
        {
          id: 'network',
          name: 'VideoAPIClient',
          role: 'networking',
          configLayer: 'Services',
          ownedFileCount: 1,
        },
        {
          id: 'player',
          name: 'VideoPlaybackActor',
          role: 'service',
          configLayer: 'Services',
          ownedFileCount: 1,
        },
        {
          id: 'tests',
          name: 'VideoFeedTests',
          role: 'test',
          configLayer: 'Tests',
          ownedFileCount: 1,
        },
      ],
      layers: [
        { id: 'services', name: 'Services', order: 0 },
        { id: 'application', name: 'Application', order: 1 },
        { id: 'tests', name: 'Tests', order: 2 },
      ],
      dependencySummary: { edgeCount: 5, notes: [] },
      cycles: [],
      hotspots: [
        {
          ref: ref('module', 'module:network'),
          score: 82,
          reason: 'network fan-out and retry paths',
        },
      ],
      majorFlows: [
        {
          refs: [ref('file-flow', 'flow:feed')],
          summary: 'feed loads videos through API and playback actor',
        },
      ],
      externalDependencyHotspots: [
        { name: 'URLSession', category: 'Networking', refs: [ref('path', 'dep:URLSession')] },
      ],
      nextRefs: [],
    },
    modules: [app, feed, network, player, tests],
    moduleLayers: [],
    fileFlows: [
      fileFlow(swiftFiles.feed, ['SwiftUI', 'Combine']),
      fileFlow(swiftFiles.network, ['Foundation', 'URLSession']),
      fileFlow(swiftFiles.player, ['Foundation', 'Combine']),
      fileFlow(swiftFiles.test, ['XCTest']),
    ],
    fileSymbols: [
      fileSymbols(swiftFiles.feed, ['VideoFeedView', 'AsyncImageCell', 'NavigationStack']),
      fileSymbols(swiftFiles.network, [
        'VideoAPIClient',
        'URLSessionVideoClient',
        'RequestRetryPolicy',
      ]),
      fileSymbols(swiftFiles.player, ['VideoPlaybackActor', 'AsyncPlaybackTask']),
      fileSymbols(swiftFiles.test, ['VideoFeedTests', 'MockVideoAPIClient']),
    ],
    sourceSlices: [],
    anchorRanges: [],
  };
}

function plainSwiftProjectContext(): ProjectContextPresenterInput {
  const plainFile = file('Sources/PlainCore/CoreModel.swift', 60);
  return {
    project: { projectRoot: '/fixture/plain-swift', displayName: 'PlainSwift' },
    envelopes: [],
    refs: [],
    files: [plainFile],
    warnings: [],
    unavailable: [],
    repo: {
      repo: { id: 'plain', name: 'plain-swift', root: '/fixture/plain-swift' },
      languages: [{ language: 'swift', fileCount: 1 }],
      buildSystems: [],
      packageSystems: [],
      targets: [],
      localPackages: [],
      sourceRoots: [{ path: 'Sources' }],
      entrypoints: [],
      commands: [],
      topAreas: [{ path: 'Sources/PlainCore' }],
      configFiles: [],
      nextRefs: [],
    },
    map: {
      repo: { id: 'plain', name: 'plain-swift', root: '/fixture/plain-swift' },
      modules: [{ id: 'core', name: 'PlainCore', role: 'core', ownedFileCount: 1 }],
      layers: [],
      dependencySummary: { edgeCount: 0, notes: [] },
      cycles: [],
      hotspots: [],
      majorFlows: [],
      externalDependencyHotspots: [],
      nextRefs: [],
    },
    modules: [moduleContext('core', 'PlainCore', plainFile, 'core')],
    moduleLayers: [],
    fileFlows: [],
    fileSymbols: [],
    sourceSlices: [],
    anchorRanges: [],
  };
}

function dynamicSignals() {
  return aggregateDynamicPlanningSignals({
    architectureIntelligence: analyzeArchitectureIntelligence({
      projectContext: bilidiliProjectContext(),
      graph: {
        manifestDependencies: [{ name: 'SwiftUI' }, { name: 'URLSession' }, { name: 'XCTest' }],
      },
    }),
    proposals: [
      {
        id: 'p-network-retry',
        type: 'update',
        status: 'observing',
        targetRecipeId: 'recipe-network',
        confidence: 0.86,
        description: 'networking-api retry and timeout recipe needs update',
      },
    ],
    decaySignals: [
      {
        id: 'w-test-decay',
        targetRecipeId: 'recipe-testing',
        status: 'open',
        confidence: 0.72,
        description: 'testing-quality fixture recipe is stale',
      },
    ],
    dimensionCoverage: [
      { dimensionId: 'ui-interaction', existingCount: 0, targetCount: 2 },
      {
        dimensionId: 'testing-quality',
        existingCount: 1,
        targetCount: 2,
        decayingRecipeIds: ['recipe-testing'],
      },
    ],
    moduleCoverage: {
      targetPerModuleDimension: 2,
      moduleIds: ['network2', 'player'],
      dimensionIds: ['networking-api', 'testing-quality'],
      records: [
        {
          moduleId: 'network2',
          moduleName: 'VideoAPIClient',
          dimensionId: 'networking-api',
          recipeId: 'recipe-network',
          status: 'active',
          sourceRefs: ['Sources/BiliDiliApp/Networking/VideoAPIClient.swift'],
        },
        {
          moduleId: 'player',
          moduleName: 'VideoPlaybackActor',
          dimensionId: 'testing-quality',
          recipeId: 'recipe-player-test',
          status: 'decaying',
        },
      ],
    },
    moduleDelta: {
      previousModules: [
        {
          moduleId: 'network',
          moduleName: 'VideoNetwork',
          files: ['Sources/BiliDiliApp/Networking/VideoAPIClient.swift'],
        },
        {
          moduleId: 'feed',
          moduleName: 'VideoFeedView',
          files: ['Sources/BiliDiliApp/Feed/VideoFeedView.swift'],
          fingerprint: 'old-feed',
        },
      ],
      currentModules: [
        {
          moduleId: 'network2',
          moduleName: 'VideoNetworkLayer',
          files: ['Sources/BiliDiliApp/Networking/VideoAPIClient.swift'],
        },
        {
          moduleId: 'feed',
          moduleName: 'VideoFeedView',
          files: ['Sources/BiliDiliApp/Feed/VideoFeedView.swift'],
          fingerprint: 'new-feed',
        },
        {
          moduleId: 'player',
          moduleName: 'VideoPlaybackActor',
          files: ['Sources/BiliDiliApp/Player/VideoPlaybackActor.swift'],
        },
      ],
      changedFiles: ['Sources/BiliDiliApp/Feed/VideoFeedView.swift'],
    },
  });
}

describe('dimension planning dynamic signals', () => {
  it('selects SwiftUI/network/concurrency/testing dimensions from evidence, not language alone', () => {
    const bilidiliReport = analyzeArchitectureIntelligence({
      projectContext: bilidiliProjectContext(),
      graph: {
        manifestDependencies: [
          { name: 'SwiftUI' },
          { name: 'URLSession' },
          { name: 'XCTest' },
          { name: 'Combine' },
        ],
      },
    });
    const signalAware = resolveSignalAwareActiveDimensions({
      primaryLanguage: 'swift',
      architectureIntelligence: bilidiliReport,
    });
    const plainSignalAware = resolveSignalAwareActiveDimensions({
      primaryLanguage: 'swift',
      architectureIntelligence: analyzeArchitectureIntelligence({
        projectContext: plainSwiftProjectContext(),
      }),
    });
    const legacySwiftIds = resolveActiveDimensions('swift').map((dimension) => dimension.id);

    expect(legacySwiftIds).toEqual(expect.arrayContaining(['networking-api', 'ui-interaction']));
    expect(signalAware.activeDimensions.map((dimension) => dimension.id)).toEqual(
      expect.arrayContaining([
        'networking-api',
        'ui-interaction',
        'concurrency-async',
        'testing-quality',
        'swiftui-patterns',
      ])
    );
    expect(
      signalAware.decisions.find((decision) => decision.dimension.id === 'networking-api')?.evidence
        .length
    ).toBeGreaterThan(0);
    expect(plainSignalAware.activeDimensions.map((dimension) => dimension.id)).not.toEqual(
      expect.arrayContaining([
        'networking-api',
        'ui-interaction',
        'testing-quality',
        'swiftui-patterns',
      ])
    );
    expect(plainSignalAware.activeDimensions.map((dimension) => dimension.id)).toContain(
      'swift-objc-idiom'
    );
  });

  it('resolves confirmed Plan dimension ids without legacy language/framework recomputation', () => {
    const legacySwiftIds = resolveActiveDimensions('swift').map((dimension) => dimension.id);
    const resolution = resolvePlanDimensionDefinitions([
      'swiftui-patterns',
      'networking-api',
      'swiftui-patterns',
      'missing-plan-dimension',
    ]);

    expect(legacySwiftIds).not.toContain('swiftui-patterns');
    expect(resolution.dimensions.map((dimension) => dimension.id)).toEqual([
      'swiftui-patterns',
      'networking-api',
    ]);
    expect(resolution.missingDimensionIds).toEqual(['missing-plan-dimension']);
  });

  it('builds planning aids with ordered dimensions, tool steps, scale, and constraints', () => {
    const architecture = analyzeArchitectureIntelligence({
      projectContext: bilidiliProjectContext(),
      graph: {
        manifestDependencies: [{ name: 'SwiftUI' }, { name: 'URLSession' }, { name: 'XCTest' }],
      },
    });
    const aids = buildDimensionPlanningAids({
      primaryLanguage: 'swift',
      architectureIntelligence: architecture,
      dynamicSignals: dynamicSignals(),
    });

    expect(aids.dimensionOrder).toEqual(
      expect.arrayContaining(['networking-api', 'ui-interaction', 'testing-quality'])
    );
    expect(aids.informationGatheringSteps.map((step) => step.tool)).toEqual(
      expect.arrayContaining([
        'project-context.map',
        'project-context.file-flow',
        'project-context.file-symbols',
        'recipe-context.coverage',
      ])
    );
    expect(aids.scaleDecision.scale).toBe('medium');
    expect(aids.crossDimensionConstraints.map((constraint) => constraint.id)).toContain(
      'coverage-before-production'
    );
    expect(aids.unavailableSignals).toEqual([]);
  });

  it('aggregates proposals, decay, coverage gaps, module delta, rename candidates, and hotspots', () => {
    const report = dynamicSignals();

    expect(report.proposals.activeCount).toBe(1);
    expect(report.decay.affectedRecipeIds).toEqual(['recipe-testing']);
    expect(report.coverage.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: 'network2',
          dimensionId: 'networking-api',
          status: 'weak',
        }),
        expect.objectContaining({
          moduleId: 'player',
          dimensionId: 'testing-quality',
          status: 'missing',
        }),
      ])
    );
    expect(report.moduleDelta.added.map((change) => change.moduleId)).toEqual(
      expect.arrayContaining(['network2', 'player'])
    );
    expect(report.moduleDelta.changed.map((change) => change.moduleId)).toEqual(['feed']);
    expect(report.moduleDelta.renameCandidates[0]).toEqual(
      expect.objectContaining({
        previousModuleId: 'network',
        currentModuleId: 'network2',
        similarity: 1,
      })
    );
    expect(report.planSignals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        'proposal',
        'decay',
        'coverage-gap',
        'new-module',
        'changed-module',
        'hotspot',
      ])
    );
  });

  it('exposes RG-2 helpers through stable facades', () => {
    const capabilities = createProjectContextCapabilities({
      execute: async () => {
        throw new Error('dimension planning test supplies deterministic inputs directly');
      },
    });
    const coverage = queryPerModuleCoverage({
      moduleIds: ['core'],
      dimensionIds: ['architecture'],
      targetPerModuleDimension: 1,
      records: [
        {
          moduleId: 'core',
          dimensionId: 'architecture',
          recipeId: 'recipe-architecture',
          status: 'active',
        },
      ],
    });

    expect(capabilities.resolveSignalAwareActiveDimensions).toBeInstanceOf(Function);
    expect(capabilities.buildDimensionPlanningAids).toBeInstanceOf(Function);
    expect(capabilities.aggregateDynamicPlanningSignals).toBeInstanceOf(Function);
    expect(coverage.gaps).toEqual([]);
  });
});

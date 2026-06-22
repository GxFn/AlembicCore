import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ProjectContextPresenterInput,
  ProjectContextRef,
  ProjectContextRefKind,
} from '../src/project-context.js';
import {
  type ArchitectureDomain,
  type ArchitectureIntelligenceInput,
  analyzeArchitectureIntelligence,
  createProjectContextCapabilities,
  DomainSignalDetector,
  ProjectInformationSupplementAnalyzer,
} from '../src/project-context-capabilities.js';

function ref(kind: ProjectContextRefKind, id: string, filePath?: string): ProjectContextRef {
  return {
    id,
    kind,
    label: id.split(':').at(-1),
    scope: {
      projectRoot: '/fixture/rg1-app',
      filePath,
    },
  };
}

const files = {
  api: {
    filePath: 'src/api/server.ts',
    language: 'typescript',
    lineCount: 180,
    ref: ref('file', 'file:api', 'src/api/server.ts'),
  },
  auth: {
    filePath: 'src/auth/token.ts',
    language: 'typescript',
    lineCount: 130,
    ref: ref('file', 'file:auth', 'src/auth/token.ts'),
  },
  ui: {
    filePath: 'src/ui/App.tsx',
    language: 'typescript',
    lineCount: 220,
    ref: ref('file', 'file:ui', 'src/ui/App.tsx'),
  },
  db: {
    filePath: 'src/db/userRepository.ts',
    language: 'typescript',
    lineCount: 170,
    ref: ref('file', 'file:db', 'src/db/userRepository.ts'),
  },
  worker: {
    filePath: 'src/worker/jobQueue.ts',
    language: 'typescript',
    lineCount: 120,
    ref: ref('file', 'file:worker', 'src/worker/jobQueue.ts'),
  },
  test: {
    filePath: 'test/app.test.ts',
    language: 'typescript',
    lineCount: 90,
    ref: ref('file', 'file:test', 'test/app.test.ts'),
  },
};

function moduleContext(id: string, name: string, ownedFile: (typeof files)[keyof typeof files]) {
  return {
    module: {
      id,
      name,
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

function fixtureProjectContext(): ProjectContextPresenterInput {
  const api = moduleContext('api', 'ApiServer', files.api);
  const auth = moduleContext('auth', 'AuthTokenService', files.auth);
  const ui = moduleContext('ui', 'ReactAppView', files.ui);
  const db = moduleContext('db', 'UserRepository', files.db);
  const worker = moduleContext('worker', 'JobQueueWorker', files.worker);
  const tests = moduleContext('tests', 'VitestSuite', files.test);

  return {
    project: {
      projectRoot: '/fixture/rg1-app',
      displayName: 'RG1 Fixture',
    },
    envelopes: [],
    refs: [],
    files: Object.values(files),
    warnings: [],
    unavailable: [],
    repo: {
      repo: {
        id: 'fixture',
        name: 'rg1-app',
        root: '/fixture/rg1-app',
        ref: ref('repo' as ProjectContextRefKind, 'repo:fixture'),
      },
      languages: [{ language: 'typescript', fileCount: 6 }],
      buildSystems: [{ kind: 'vite', configRefs: [ref('path', 'config:vite')] }],
      packageSystems: [{ kind: 'npm', manifestRefs: [ref('path', 'manifest:package.json')] }],
      targets: [{ name: 'web', kind: 'frontend', refs: [ref('path', 'target:web')] }],
      localPackages: [{ name: '@fixture/api', path: 'packages/api' }],
      sourceRoots: [{ path: 'src' }],
      entrypoints: [
        {
          name: 'server',
          kind: 'http-server',
          refs: [ref('file', 'entry:server', 'src/api/server.ts')],
        },
      ],
      commands: [{ name: 'test', command: 'vitest run', sourceRef: ref('path', 'package:test') }],
      topAreas: [{ path: 'src/api' }, { path: 'src/ui' }, { path: 'src/db' }],
      configFiles: [
        { path: 'vite.config.ts', kind: 'vite', ref: ref('path', 'config:vite') },
        { path: 'vitest.config.ts', kind: 'vitest', ref: ref('path', 'config:vitest') },
        { path: 'docker-compose.yml', kind: 'docker-compose', ref: ref('path', 'config:docker') },
        { path: 'drizzle.config.ts', kind: 'drizzle', ref: ref('path', 'config:drizzle') },
        { path: 'sentry.client.config.ts', kind: 'sentry', ref: ref('path', 'config:sentry') },
      ],
      nextRefs: [],
    },
    map: {
      repo: {
        id: 'fixture',
        name: 'rg1-app',
        root: '/fixture/rg1-app',
        ref: ref('repo' as ProjectContextRefKind, 'repo:fixture'),
      },
      modules: [
        {
          id: 'api',
          name: 'ApiServer',
          role: 'service',
          configLayer: 'Services',
          ownedFileCount: 1,
          ref: ref('module', 'module:api'),
        },
        {
          id: 'auth',
          name: 'AuthTokenService',
          role: 'auth',
          configLayer: 'Services',
          ownedFileCount: 1,
          ref: ref('module', 'module:auth'),
        },
        {
          id: 'ui',
          name: 'ReactAppView',
          role: 'ui',
          configLayer: 'Application',
          ownedFileCount: 1,
          ref: ref('module', 'module:ui'),
        },
        {
          id: 'db',
          name: 'UserRepository',
          role: 'storage',
          configLayer: 'Data',
          ownedFileCount: 1,
          ref: ref('module', 'module:db'),
        },
        {
          id: 'worker',
          name: 'JobQueueWorker',
          role: 'service',
          configLayer: 'Services',
          ownedFileCount: 1,
          ref: ref('module', 'module:worker'),
        },
        {
          id: 'tests',
          name: 'VitestSuite',
          role: 'test',
          configLayer: 'Tests',
          ownedFileCount: 1,
          ref: ref('module', 'module:tests'),
        },
      ],
      layers: [
        { id: 'data', name: 'Data', order: 0, ref: ref('module-layer', 'layer:data') },
        { id: 'services', name: 'Services', order: 1, ref: ref('module-layer', 'layer:services') },
        {
          id: 'application',
          name: 'Application',
          order: 2,
          ref: ref('module-layer', 'layer:application'),
        },
        { id: 'tests', name: 'Tests', order: 3, ref: ref('module-layer', 'layer:tests') },
      ],
      dependencySummary: { edgeCount: 6, notes: [] },
      cycles: [],
      hotspots: [
        { ref: ref('module', 'module:api'), score: 85, reason: 'api fan-out and entrypoint' },
      ],
      majorFlows: [
        { refs: [ref('file-flow', 'flow:api')], summary: 'HTTP request flows through auth and db' },
      ],
      externalDependencyHotspots: [
        { name: 'express', category: 'Networking', refs: [ref('path', 'dep:express')] },
      ],
      nextRefs: [],
    },
    modules: [api, auth, ui, db, worker, tests],
    moduleLayers: [],
    fileFlows: [
      fileFlow(files.api, ['express', 'jsonwebtoken', 'pino']),
      fileFlow(files.auth, ['bcrypt', 'jsonwebtoken']),
      fileFlow(files.ui, ['react', '@tanstack/react-query']),
      fileFlow(files.db, ['pg', 'drizzle-orm']),
      fileFlow(files.worker, ['bullmq']),
      fileFlow(files.test, ['vitest']),
    ],
    fileSymbols: [
      fileSymbols(files.api, ['ApiServer', 'UserController', 'RequestHandler']),
      fileSymbols(files.auth, ['AuthTokenService', 'JwtSessionVerifier', 'CryptoPasswordHasher']),
      fileSymbols(files.ui, ['ReactAppView', 'ErrorBoundary']),
      fileSymbols(files.db, ['UserRepository', 'DrizzleUserEntity']),
      fileSymbols(files.worker, ['JobQueueWorker', 'AsyncTaskProcessor']),
      fileSymbols(files.test, ['ApiServerSpec', 'MockAuthFixture']),
    ],
    sourceSlices: [],
    anchorRanges: [],
  };
}

function fileFlow(file: (typeof files)[keyof typeof files], imports: string[]) {
  return {
    file,
    imports: imports.map((name) => ({
      kind: 'imports',
      label: name,
      to: { label: name },
      filePath: file.filePath,
      ref: ref('relation-site', `import:${file.filePath}:${name}`, file.filePath),
    })),
    exports: [],
    callers: [],
    callees: [],
    inflow: [],
    outflow: [],
    nextRefs: [],
  };
}

function fileSymbols(file: (typeof files)[keyof typeof files], names: string[]) {
  return {
    file,
    symbols: names.map((name) => ({
      name,
      kind: name.endsWith('Spec') ? 'test' : 'class',
      filePath: file.filePath,
      ref: ref('symbol', `symbol:${name}`, file.filePath),
    })),
    naming: { warnings: [] },
    nextRefs: [],
  };
}

function fixtureInput(): ArchitectureIntelligenceInput {
  return {
    projectContext: fixtureProjectContext(),
    graph: {
      modules: [
        {
          moduleId: 'api',
          name: 'ApiServer',
          files: [files.api.filePath],
          role: 'service',
          configLayer: 'Services',
        },
        {
          moduleId: 'auth',
          name: 'AuthTokenService',
          files: [files.auth.filePath],
          role: 'auth',
          configLayer: 'Services',
        },
        {
          moduleId: 'ui',
          name: 'ReactAppView',
          files: [files.ui.filePath],
          role: 'ui',
          configLayer: 'Application',
        },
        {
          moduleId: 'db',
          name: 'UserRepository',
          files: [files.db.filePath],
          role: 'storage',
          configLayer: 'Data',
        },
        {
          moduleId: 'worker',
          name: 'JobQueueWorker',
          files: [files.worker.filePath],
          role: 'service',
          configLayer: 'Services',
        },
      ],
      entities: [
        {
          entityId: 'ApiServer',
          entityType: 'class',
          name: 'ApiServer',
          filePath: files.api.filePath,
        },
        {
          entityId: 'AuthTokenService',
          entityType: 'class',
          name: 'AuthTokenService',
          filePath: files.auth.filePath,
        },
        {
          entityId: 'UserRepository',
          entityType: 'class',
          name: 'UserRepository',
          filePath: files.db.filePath,
        },
        {
          entityId: 'ErrorBoundary',
          entityType: 'class',
          name: 'ErrorBoundary',
          filePath: files.ui.filePath,
        },
        {
          entityId: 'JobQueueWorker',
          entityType: 'class',
          name: 'JobQueueWorker',
          filePath: files.worker.filePath,
        },
        {
          entityId: 'PinoLogger',
          entityType: 'class',
          name: 'PinoLogger',
          filePath: files.api.filePath,
        },
      ],
      edges: [
        {
          fromId: 'api',
          fromType: 'module',
          toId: 'auth',
          toType: 'module',
          relation: 'depends_on',
        },
        { fromId: 'api', fromType: 'module', toId: 'db', toType: 'module', relation: 'depends_on' },
        { fromId: 'ui', fromType: 'module', toId: 'api', toType: 'module', relation: 'depends_on' },
        {
          fromId: 'worker',
          fromType: 'module',
          toId: 'db',
          toType: 'module',
          relation: 'data_flow',
        },
        {
          fromId: 'ApiServer',
          fromType: 'class',
          toId: 'AuthTokenService',
          toType: 'class',
          relation: 'calls',
        },
        {
          fromId: 'AuthTokenService',
          fromType: 'class',
          toId: 'UserRepository',
          toType: 'class',
          relation: 'calls',
        },
        {
          fromId: 'ApiServer',
          fromType: 'class',
          toId: 'PinoLogger',
          toType: 'class',
          relation: 'logs',
        },
        {
          fromId: 'ErrorBoundary',
          fromType: 'class',
          toId: 'ApiServer',
          toType: 'class',
          relation: 'handles_error',
        },
      ],
      manifestDependencies: [
        { name: 'express' },
        { name: 'react' },
        { name: 'pg' },
        { name: 'jsonwebtoken' },
        { name: 'bcrypt' },
        { name: 'pino' },
        { name: 'bullmq' },
        { name: 'vitest' },
      ],
      dimensionCoverage: [
        {
          id: 'security',
          name: 'Security',
          recipeCount: 0,
          status: 'missing',
          weight: 0.95,
          relatedRoles: ['service', 'auth'],
          suggestedTopics: ['token rotation'],
        },
        {
          id: 'testing',
          name: 'Testing',
          recipeCount: 1,
          status: 'weak',
          weight: 0.8,
          relatedRoles: ['test'],
          suggestedTopics: ['fixture isolation'],
        },
      ],
    },
  };
}

function domain(report: ReturnType<DomainSignalDetector['detect']>, id: ArchitectureDomain) {
  const found = report.domains.find((item) => item.domain === id);
  expect(found).toBeDefined();
  return found!;
}

describe('architecture intelligence capabilities', () => {
  it('grounds domain/style/complexity signals in ProjectContext and shared graph evidence', () => {
    const report = analyzeArchitectureIntelligence(fixtureInput());

    for (const id of [
      'auth',
      'api',
      'ui',
      'database',
      'concurrency',
      'security',
      'observability',
      'error-handling',
      'testing',
    ] as const) {
      const signal = domain(report.domains, id);
      expect(signal.present, id).toBe(true);
      expect(signal.evidence.map((item) => item.source)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^project-context-|^shared-graph-/)])
      );
    }

    expect(
      domain(report.domains, 'auth').moduleSignals.some(
        (item) => item.moduleId === 'auth' && item.present
      )
    ).toBe(true);
    expect(report.styles.styles.find((item) => item.style === 'layered')?.present).toBe(true);
    expect(report.styles.styles.find((item) => item.style === 'frontend')?.present).toBe(true);
    expect(report.styles.styles.find((item) => item.style === 'backend')?.present).toBe(true);
    expect(report.complexity.project.moduleCount).toBeGreaterThanOrEqual(5);
    expect(report.complexity.hotspots[0]?.moduleId).toBe('api');
  });

  it('does not infer domains from language alone', () => {
    const detector = new DomainSignalDetector();
    const plainProjectContext: ProjectContextPresenterInput = {
      project: { projectRoot: '/fixture/plain-typescript' },
      envelopes: [],
      refs: [],
      files: [{ filePath: 'src/main.ts', language: 'typescript', lineCount: 40 }],
      warnings: [],
      unavailable: [],
      repo: {
        repo: { id: 'plain', name: 'plain', root: '/fixture/plain-typescript' },
        languages: [{ language: 'typescript', fileCount: 1 }],
        buildSystems: [],
        packageSystems: [],
        targets: [],
        localPackages: [],
        sourceRoots: [{ path: 'src' }],
        entrypoints: [],
        commands: [],
        topAreas: [{ path: 'src' }],
        configFiles: [],
        nextRefs: [],
      },
      map: {
        repo: { id: 'plain', name: 'plain', root: '/fixture/plain-typescript' },
        modules: [{ id: 'core', name: 'Core', ownedFileCount: 1 }],
        layers: [],
        dependencySummary: { edgeCount: 0, notes: [] },
        cycles: [],
        hotspots: [],
        majorFlows: [],
        externalDependencyHotspots: [],
        nextRefs: [],
      },
      modules: [
        moduleContext('core', 'Core', {
          filePath: 'src/main.ts',
          language: 'typescript',
          lineCount: 40,
        }),
      ],
      moduleLayers: [],
      fileFlows: [],
      fileSymbols: [],
      sourceSlices: [],
      anchorRanges: [],
    };
    const report = detector.detect({
      projectContext: plainProjectContext,
      graph: {},
    });

    expect(report.projectPresentDomains).toEqual([]);
    expect(report.evidenceCount).toBe(0);
    expect(
      analyzeArchitectureIntelligence({
        projectContext: plainProjectContext,
        graph: {},
      }).styles.primary
    ).toBe('unknown');
  });

  it('retains only the Panorama-free supplement marker', () => {
    const supplements = new ProjectInformationSupplementAnalyzer().analyze(fixtureInput());

    expect(supplements).toEqual({ panoramaServiceFree: true });

    const source = readFileSync(
      new URL(
        '../src/service/project-context/architectureIntelligence/architectureIntelligence.ts',
        import.meta.url
      ),
      'utf8'
    );
    expect(source).not.toContain('PanoramaService');
    expect(source).not.toContain('service/panorama');
    expect(source).not.toContain('coupling:');
    expect(source).not.toContain('roles:');
    expect(source).not.toContain('callFlow:');
  });

  it('exposes architecture intelligence through the ProjectContext capabilities facade', () => {
    const capabilities = createProjectContextCapabilities({
      execute: async () => {
        throw new Error('architecture intelligence consumes supplied ProjectContext results');
      },
    });

    const report = capabilities.analyzeArchitectureIntelligence(fixtureInput());

    expect(report.domains.projectPresentDomains).toContain('api');
    expect(report.supplements.panoramaServiceFree).toBe(true);
  });
});

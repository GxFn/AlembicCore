import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DiscovererRegistry,
  getDiscovererRegistry,
  NodeDiscoverer,
  ProjectDiscoverer,
  resetDiscovererRegistry,
} from '../src/core/discovery/index.js';
import type { DiscoveredTarget } from '../src/core/discovery/ProjectDiscoverer.js';
import type {
  ProjectContextUnavailableData,
  RepoContext,
} from '../src/domain/project-context/index.js';
import {
  RecordingProjectSourceReader,
  ReplayProjectSourceReader,
} from '../src/infrastructure/io/ProjectInputSnapshot.js';
import { ProjectContext } from '../src/project-context.js';
import { ProjectContextCapabilities } from '../src/project-context-capabilities.js';
import type { ProjectContextHandlerExecutionContext } from '../src/service/project-context/interface/contracts.js';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  PROJECT_SCOPE_REGISTRY_FILENAME,
} from '../src/shared/ProjectScope.js';

describe('ProjectContext PCQ-7 repo context', () => {
  beforeEach(() => {
    resetDiscovererRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDiscovererRegistry();
  });

  it.each([
    'folder',
    'control-root',
  ] as const)('replays repo facts and %s scope from captured inputs after the source tree is removed', async (scopeKind) => {
    const files = createRepoFixture();
    await withFixture(
      {
        ...files,
        ...Object.fromEntries(
          Object.entries(files).map(([file, content]) => [`RepoA/${file}`, content])
        ),
      },
      async (projectRoot) => {
        const previousHome = process.env.ALEMBIC_HOME;
        try {
          process.env.ALEMBIC_HOME = projectRoot;
          await fs.mkdir(path.join(projectRoot, '.asd'));
          await fs.mkdir(path.join(projectRoot, 'RepoA', 'tests'));
          await fs.mkdir(path.join(projectRoot, 'node_modules'));
          const projectScope = createProjectDescriptor({
            controlRoot: projectRoot,
            dataRoot: path.join(projectRoot, '.asd', 'workspaces', 'fixture'),
            displayName: 'CapturedScope',
            folders: [
              {
                id: 'folder-a',
                displayName: 'ScopeRepoA',
                path: path.join(projectRoot, 'RepoA'),
                repositoryId: 'repo-a',
                role: 'primary-source',
              },
            ],
            projectId: 'fixture',
            projectScopeId: 'scope-fixture',
          });
          await fs.writeFile(
            path.join(projectRoot, '.asd', PROJECT_SCOPE_REGISTRY_FILENAME),
            JSON.stringify(createProjectScopeRegistryDocument([projectScope]))
          );
          const request = {
            kind: 'repo' as const,
            payload: { includeMapSummary: false, repoRoot: scopeKind === 'folder' ? 'RepoA' : '.' },
            scope: { projectRoot },
          };
          const roots = [{ id: 'workspace', path: projectRoot }];
          const recorder = new RecordingProjectSourceReader(roots);
          const recordingContext: ProjectContextHandlerExecutionContext = {
            sourceReader: recorder,
          };
          const recorded = await ProjectContext.execute(request, recordingContext);
          recorder.assertComplete();
          expect(await ProjectContext.execute(request)).toEqual(recorded);
          expect(JSON.stringify(recorded)).not.toContain('"sourceReader"');
          const data = recorded.data as RepoContext;
          expect(data.commands.map((command) => command.name)).toEqual(['build', 'test']);
          expect(data.configFiles.map((file) => file.path)).toContain('package.json');
          if (scopeKind === 'folder') {
            expect(data.repo).toMatchObject({ id: 'repo-a', name: 'ScopeRepoA', root: 'RepoA' });
            expect(data.sourceRoots.map((root) => root.path)).toContain('tests');
          }
          const snapshot = JSON.parse(JSON.stringify(await recorder.snapshot()));
          await fs.rm(projectRoot, { recursive: true, force: true });
          const replay = new ReplayProjectSourceReader(snapshot, roots);
          const replayContext: ProjectContextHandlerExecutionContext = { sourceReader: replay };
          expect(await ProjectContext.execute(request, replayContext)).toEqual(recorded);
          replay.assertComplete();
          expect(snapshot.observations).toContainEqual(
            expect.objectContaining({
              operation: scopeKind === 'folder' ? 'scope-for-folder' : 'scope-for-control-root',
            })
          );
        } finally {
          if (previousHome === undefined) {
            delete process.env.ALEMBIC_HOME;
          } else {
            process.env.ALEMBIC_HOME = previousHome;
          }
        }
      }
    );
  });

  it('isolates targets, dependency facts, and files when two repo requests interleave', async () => {
    await withFixture(
      {
        'package.json': JSON.stringify({ name: 'project-a', dependencies: { 'dep-a': '1.0.0' } }),
        'src/a.ts': 'export const a = 1;',
      },
      async (firstRoot) => {
        await withFixture(
          {
            'package.json': JSON.stringify({
              name: 'project-b',
              dependencies: { 'dep-b': '1.0.0' },
            }),
            'src/b.js': 'export const b = 2;',
          },
          async (secondRoot) => {
            const a = await fs.realpath(firstRoot);
            const b = await fs.realpath(secondRoot);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const load = NodeDiscoverer.prototype.load;
            // 只控制交错时机；解析清单、枚举源码和 repo 投影仍经过真实入口。
            vi.spyOn(NodeDiscoverer.prototype, 'load').mockImplementation(async function (
              this: NodeDiscoverer,
              root
            ) {
              await load.call(this, root);
              if (root === a) {
                entered.resolve();
                await release.promise;
              }
            });
            const first = ProjectContext.execute({
              kind: 'repo',
              payload: { includeMapSummary: false },
              scope: { projectRoot: a },
            });
            await entered.promise;
            try {
              const second = await ProjectContext.execute({
                kind: 'repo',
                payload: { includeMapSummary: false },
                scope: { projectRoot: b },
              });
              expect((second.data as RepoContext).targets.map((target) => target.name)).toEqual([
                'project-b',
              ]);
            } finally {
              release.resolve();
            }
            const result = await first;
            const data = result.data as RepoContext;

            expect(result.errors).toBeUndefined();
            expect(data.targets.map((target) => target.name)).toEqual(['project-a']);
            expect(data.dependencyGraph?.edges).toEqual([
              { from: 'project-a', to: 'dep-a', type: 'depends_on' },
            ]);
            expect(data.languages).toEqual([{ fileCount: 1, language: 'typescript' }]);
            expect(JSON.stringify(data)).not.toContain('project-b');
          }
        );
      }
    );
  });

  it('preserves a configured legacy instance until its mutable targets are projected', async () => {
    await withFixture(createLegacyDiscoveryFixture('a'), async (firstRoot) => {
      await withFixture(createLegacyDiscoveryFixture('b'), async (secondRoot) => {
        const a = await fs.realpath(firstRoot);
        const b = await fs.realpath(secondRoot);
        const custom = new ConfiguredLegacyDiscoverer('configured');
        const registry = getDiscovererRegistry().register(custom);
        const load = vi.spyOn(custom, 'load');
        const projected = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const stat = fs.stat;
        let paused = false;
        // discoverer 已完成所有读取后暂停 repo 投影，验证锁没有过早释放。
        vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
          if (!paused && String(args[0]) === path.join(a, 'src')) {
            paused = true;
            projected.resolve();
            await release.promise;
          }
          return stat(...args);
        });
        const first = ProjectContext.execute({
          kind: 'repo',
          payload: { includeMapSummary: false },
          scope: { projectRoot: a },
        });
        await projected.promise;
        const sessions = vi.spyOn(registry, 'withSession');
        const second = ProjectContext.execute({
          kind: 'repo',
          payload: { includeMapSummary: false },
          scope: { projectRoot: b },
        });
        try {
          await vi.waitFor(() => expect(sessions).toHaveBeenCalledTimes(1));
          expect(load).toHaveBeenCalledTimes(1);
        } finally {
          release.resolve();
          await Promise.allSettled([first, second]);
        }

        const [left, right] = await Promise.all([first, second]);
        expect((left.data as RepoContext).targets.map((target) => target.name)).toEqual([
          'configured:a',
        ]);
        expect((right.data as RepoContext).targets.map((target) => target.name)).toEqual([
          'configured:b',
        ]);
        expect((left.data as RepoContext).dependencyGraph?.nodes).toEqual([{ id: 'configured:a' }]);
        expect((left.data as RepoContext).languages).toEqual([
          { fileCount: 1, language: 'typescript' },
        ]);
        expect(registry.getAll()).toContain(custom);
        expect(await registry.detect(a)).toBe(custom);
      });
    });
  });

  it('keeps a shared legacy instance fenced when a queued session is cancelled', async () => {
    await withFixture(createLegacyDiscoveryFixture('a'), async (a) => {
      await withFixture(createLegacyDiscoveryFixture('b'), async (b) => {
        const custom = new ConfiguredLegacyDiscoverer('configured');
        const firstRegistry = new DiscovererRegistry().register(custom);
        const secondRegistry = new DiscovererRegistry().register(custom);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const controller = new AbortController();
        const first = firstRegistry.withSession(async (session) => {
          const discoverer = await session.detect(a);
          await discoverer.load(a);
          entered.resolve();
          await release.promise;
          return (await discoverer.listTargets()).map((target) => target.name);
        });
        await entered.promise;
        const cancelledRead = vi.fn(async () => []);
        const cancelled = secondRegistry.withSession(cancelledRead, {
          signal: controller.signal,
        });
        let nextStarted = false;
        const next = secondRegistry.withSession(async (session) => {
          nextStarted = true;
          const discoverer = await session.detect(b);
          await discoverer.load(b);
          return (await discoverer.listTargets()).map((target) => target.name);
        });
        try {
          controller.abort('cancel queued repo');
          await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
          expect(cancelledRead).not.toHaveBeenCalled();
          expect(nextStarted).toBe(false);
        } finally {
          release.resolve();
          await Promise.allSettled([first, cancelled, next]);
        }
        await expect(first).resolves.toEqual(['configured:a']);
        await expect(next).resolves.toEqual(['configured:b']);

        // 回调失败也释放原对象，不让一次失败永久阻塞后续请求。
        await expect(
          firstRegistry.withSession(async () => {
            throw new Error('legacy read failed');
          })
        ).rejects.toThrow('legacy read failed');
        await expect(
          secondRegistry.withSession(async (session) => {
            const discoverer = await session.detect(a);
            await discoverer.load(a);
            return (await discoverer.listTargets()).map((target) => target.name);
          })
        ).resolves.toEqual(['configured:a']);
      });
    });
  });

  it('waits for every in-flight legacy detector before releasing a cancelled session', async () => {
    await withFixture(createLegacyDiscoveryFixture('a'), async (root) => {
      const slow = new ConfiguredLegacyDiscoverer('slow');
      const cancellable = new ConfiguredLegacyDiscoverer('cancellable');
      const registry = new DiscovererRegistry().register(slow).register(cancellable);
      const otherRegistry = new DiscovererRegistry().register(slow);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const controller = new AbortController();
      const detect = slow.detect;
      vi.spyOn(slow, 'detect').mockImplementation(async (projectRoot) => {
        const result = await detect.call(slow, projectRoot);
        entered.resolve();
        // 旧扩展可以忽略 AbortSignal；其异步状态修改结束前不能交给下一请求。
        await release.promise;
        return result;
      });
      vi.spyOn(cancellable, 'detect').mockImplementation(async (_root, context) => {
        return new Promise((_resolve, reject) => {
          context?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('detector cancelled'), { name: 'AbortError' })),
            { once: true }
          );
        });
      });
      const first = registry.withSession(
        (session) => session.analyzeConflict(root, { signal: controller.signal }),
        { signal: controller.signal }
      );
      const firstOutcome = first.catch((error: unknown) => error);
      await entered.promise;
      controller.abort('cancel detection');
      let nextStarted = false;
      const next = otherRegistry.withSession(async () => {
        nextStarted = true;
      });
      try {
        // 排空当前任务的 promise continuations，第二请求仍应被活动 detect 阻挡。
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(nextStarted).toBe(false);
      } finally {
        release.resolve();
        await Promise.allSettled([firstOutcome, next]);
      }
      await expect(firstOutcome).resolves.toMatchObject({ name: 'AbortError' });
      expect(nextStarted).toBe(true);
    });
  });

  it('returns repo identity, package/build facts, entrypoints, mapRef, and drill-down refs', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });
      const data = envelope.data as RepoContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.repo).toMatchObject({ id: 'fixture', name: 'fixture-core', root: '.' });
      expect(data.languages).toEqual(
        expect.arrayContaining([expect.objectContaining({ language: 'typescript' })])
      );
      expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
      expect(data.buildSystems.map((system) => system.kind)).toEqual(
        expect.arrayContaining(['node-scripts', 'typescript', 'vitest'])
      );
      expect(data.targets).toEqual([
        expect.objectContaining({
          kind: 'executable',
          name: '@fixture/core',
        }),
      ]);
      expect(data.localPackages).toEqual([
        expect.objectContaining({ name: '@fixture/core', path: '.' }),
      ]);
      expect(data.sourceRoots.map((root) => root.path)).toEqual(
        expect.arrayContaining(['bin', 'src'])
      );
      expect(data.entrypoints.map((entrypoint) => entrypoint.name)).toEqual(
        expect.arrayContaining(['main', 'types', 'bin:fixture', 'exports:.', 'exports:./feature'])
      );
      expect(data.commands.map((command) => command.name)).toEqual(['build', 'test']);
      expect(data.topAreas.map((area) => area.path)).toEqual(expect.arrayContaining(['src']));
      expect(data.configFiles.map((file) => file.path)).toEqual(
        expect.arrayContaining(['package.json', 'tsconfig.json', 'vitest.config.ts'])
      );
      expect(data.mapRef).toMatchObject({ kind: 'map' });
      expect(data.mapSummary).toMatchObject({
        dependencyEdgeCount: 1,
        layerCount: 2,
        moduleCount: 2,
      });
      expect(data.nextRefs.some((ref) => ref.kind === 'map')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'path')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'file')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'module')).toBe(false);
      expect(data.nextRefs.some((ref) => ref.kind === 'file-flow')).toBe(false);
      expect(JSON.stringify(data)).not.toMatch(
        /majorFlows|externalDependencyHotspots|dependencySummary/
      );
    });
  });

  it('preserves declared SwiftPM target paths in BiliDili-shaped repo refs', async () => {
    await withFixture(createBiliDiliSwiftPmFixture(), async (projectRoot) => {
      const envelope = await ProjectContextCapabilities.execute({
        kind: 'repo',
        payload: { includeMapSummary: false },
        scope: { projectRoot, repoId: 'bilidili' },
      });
      const data = envelope.data as RepoContext;
      const targets = new Map(data.targets.map((target) => [target.name, target]));

      expect(targets.get('Home')?.refs[0]).toMatchObject({
        label: 'Sources/Features/Home',
        metadata: { role: 'target' },
        scope: {
          filePath: 'Sources/Features/Home',
          projectRoot,
          repoId: 'bilidili',
        },
      });
      expect(targets.get('VideoPlay')?.refs[0]).toMatchObject({
        label: 'Sources/Features/VideoPlay',
        metadata: { role: 'target' },
        scope: {
          filePath: 'Sources/Features/VideoPlay',
          projectRoot,
          repoId: 'bilidili',
        },
      });
      expect(targets.get('BiliDiliTests')?.refs[0]).toMatchObject({
        label: 'Tests/BiliDiliTests',
        scope: { filePath: 'Tests/BiliDiliTests' },
      });
      expect(targets.get('Shared')?.refs[0]).toMatchObject({
        label: '.',
        scope: { filePath: '.' },
      });
      expect(targets.get('AOXFoundationKit')?.refs[0]).toMatchObject({
        label: 'Packages/AOXFoundationKit',
        scope: { filePath: 'Packages/AOXFoundationKit' },
      });
      expect(targets.get('AOXPlayer')?.refs[0]).toMatchObject({
        label: 'Packages/AOXPlayer',
        scope: { filePath: 'Packages/AOXPlayer' },
      });
      expect(data.targets.map((target) => target.name)).toEqual(
        expect.arrayContaining([
          'AOXFoundationKit',
          'AOXNetworkKit',
          'AOXPlayer',
          'BiliDiliTests',
          'Home',
          'Shared',
          'VideoPlay',
        ])
      );
      expect(data.localPackages.map((pkg) => `${pkg.name}@${pkg.path}`)).toEqual(
        expect.arrayContaining([
          'AOXFoundationKit@Packages/AOXFoundationKit',
          'AOXNetworkKit@Packages/AOXNetworkKit',
          'AOXPlayer@Packages/AOXPlayer',
          'BiliDili@.',
        ])
      );
      expect(data.packageSystems.map((system) => system.kind)).toContain('swift-package-manager');
      expect(JSON.stringify(envelope)).not.toContain('no package manifest was found');
      expect(data.sourceRoots.map((root) => root.path)).toEqual(
        expect.arrayContaining([
          'Packages/AOXFoundationKit',
          'Packages/AOXNetworkKit',
          'Packages/AOXPlayer',
          'Sources',
          'Sources/Features/Home',
          'Sources/Features/VideoPlay',
          'Tests/BiliDiliTests',
        ])
      );
      expect(data.entrypoints).toEqual([]);
    });
  });

  it('keeps repo output deterministic regardless of module seed order', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });
      const right = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createSharedSeed(), createFeatureSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });

      expect(left).toStrictEqual(right);
    });
  });

  it('returns repo facts and an ordinary error when map facts are unavailable', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        scope: { projectRoot, repoId: 'fixture' },
      });
      const data = envelope.data as RepoContext;

      expect(data.repo.id).toBe('fixture');
      expect(data.mapRef).toBeUndefined();
      expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
      expect(envelope.errors).toContainEqual(
        expect.objectContaining({
          code: 'query-unavailable',
          message:
            'repo map facts are unavailable because payload.moduleSeeds or payload.modules is missing.',
          severity: 'warning',
        })
      );
    });
  });

  it('reports unreadable manifests without turning repo into a thin unavailable shell', async () => {
    await withFixture(
      {
        'package.json': '{',
        'src/index.ts': 'export const value = 1;',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'repo',
          payload: { includeMapSummary: false },
          scope: { projectRoot, repoId: 'fixture' },
        });
        const data = envelope.data as RepoContext;

        expect(data.repo.id).toBe('fixture');
        expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
        expect(envelope.errors).toContainEqual(
          expect.objectContaining({
            code: 'query-unavailable',
            path: 'package.json',
          })
        );
      }
    );
  });

  it('rejects repo roots outside the project scope as ordinary query errors', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        payload: { repoRoot: '../outside' },
        scope: { projectRoot },
      });

      expect(envelope.errors?.[0]?.code).toBe('outside-scope');
      expect((envelope.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });
});

function createFeatureSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'feature',
    modulePath: 'src/feature',
    ownedFiles: ['src/feature/index.ts'],
  };
}

function createLegacyDiscoveryFixture(name: string): Record<string, string> {
  return {
    'discovery.json': JSON.stringify({ name }),
    [`src/${name}.ts`]: `export const ${name} = 1;`,
  };
}

/** 模拟现有扩展：必需构造配置、原生私有字段、重复使用同一 target 对象。 */
class ConfiguredLegacyDiscoverer extends ProjectDiscoverer {
  #prefix: string;
  #root = '';
  #targets: DiscoveredTarget[] = [{ name: '', path: '', type: 'library' }];

  constructor(prefix: string) {
    super();
    this.#prefix = prefix;
  }

  override get id() {
    return 'configured-legacy';
  }

  override get displayName() {
    return this.#prefix;
  }

  override async detect(root: string, _context?: { signal?: AbortSignal }) {
    await fs.access(path.join(root, 'discovery.json'));
    return { match: true, confidence: 1, reason: 'discovery.json exists' };
  }

  override async load(root: string) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'discovery.json'), 'utf8'));
    this.#root = root;
    Object.assign(this.#targets[0], {
      name: `${this.#prefix}:${manifest.name}`,
      path: root,
      language: 'typescript',
    });
  }

  override async listTargets() {
    return this.#targets;
  }

  override async getTargetFiles() {
    return (await fs.readdir(path.join(this.#root, 'src'))).map((name) => ({
      name,
      path: path.join(this.#root, 'src', name),
      relativePath: path.join('src', name),
      language: 'typescript',
    }));
  }

  override async getDependencyGraph() {
    return { nodes: this.#targets.map((target) => target.name), edges: [] };
  }
}

function createSharedSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'shared',
    modulePath: 'src/shared',
    ownedFiles: ['src/shared/index.ts'],
  };
}

function createRepoFixture(): Record<string, string> {
  return {
    'bin/fixture.js': '#!/usr/bin/env node\nconsole.log("fixture");\n',
    'package.json': JSON.stringify(
      {
        name: '@fixture/core',
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        bin: { fixture: 'bin/fixture.js' },
        exports: {
          '.': './dist/index.js',
          './feature': './src/feature/index.ts',
        },
        scripts: {
          build: 'tsc -p tsconfig.json',
          test: 'vitest run',
        },
        dependencies: {
          '@fixture/shared': 'workspace:*',
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^3.0.0',
        },
      },
      null,
      2
    ),
    'src/feature/index.ts': [
      "import { sharedValue } from '../shared/index';",
      '',
      'export function runFeature(): string {',
      '  return sharedValue;',
      '}',
    ].join('\n'),
    'src/shared/index.ts': "export const sharedValue = 'shared';\n",
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    'vitest.config.ts': 'export default { test: { globals: true } };\n',
  };
}

function createBiliDiliSwiftPmFixture(): Record<string, string> {
  const rootPackage = [
    '// swift-tools-version: 5.9',
    'import PackageDescription',
    'let package = Package(',
    '  name: "BiliDili",',
    '  dependencies: [',
    '    .package(path: "Packages/AOXFoundationKit"),',
    '    .package(path: "Packages/AOXNetworkKit"),',
    '    .package(path: "Packages/AOXPlayer"),',
    '  ],',
    '  targets: [',
    '    .target(name: "Home", path: "./Sources/Features/Home"),',
    '    .target(name: "VideoPlay", path: "Sources/Features/VideoPlay"),',
    '    .target(name: "Shared"),',
    '    .testTarget(name: "BiliDiliTests", path: "Tests/BiliDiliTests"),',
    '  ]',
    ')',
  ].join('\n');
  const localPackage = (name: string) =>
    [
      '// swift-tools-version: 5.9',
      'import PackageDescription',
      `let package = Package(name: "${name}", targets: [.target(name: "${name}", path: "Sources/${name}")])`,
    ].join('\n');

  return {
    'Package.swift': rootPackage,
    'Packages/AOXFoundationKit/Package.swift': localPackage('AOXFoundationKit'),
    'Packages/AOXFoundationKit/Sources/AOXFoundationKit/Foundation.swift':
      'public struct FoundationValue {}\n',
    'Packages/AOXNetworkKit/Package.swift': localPackage('AOXNetworkKit'),
    'Packages/AOXNetworkKit/Sources/AOXNetworkKit/Network.swift': 'struct Network {}\n',
    'Packages/AOXPlayer/Package.swift': localPackage('AOXPlayer'),
    'Packages/AOXPlayer/Sources/AOXPlayer/Decoder.swift': 'struct Decoder {}\n',
    'Packages/AOXPlayer/Sources/AOXPlayer/Player.swift': 'struct Player {}\n',
    'Packages/AOXPlayer/Sources/AOXPlayer/RenderLoop.swift': 'struct RenderLoop {}\n',
    'Sources/Features/Home/HomeFeature.swift': 'struct HomeFeature {}\n',
    'Sources/Features/Home/HomeView.swift': 'struct HomeView {}\n',
    'Sources/Features/VideoPlay/VideoPlayer.swift': 'struct VideoPlayer {}\n',
    'Sources/Features/VideoPlay/VideoView.swift': 'struct VideoView {}\n',
    'Sources/Shared/Shared.swift': 'struct Shared {}\n',
    'Tests/BiliDiliTests/BiliDiliTests.swift': 'struct BiliDiliTests {}\n',
  };
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-repo-'));
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, { force: true, recursive: true });
  }
}

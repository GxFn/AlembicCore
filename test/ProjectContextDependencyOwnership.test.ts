import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProjectContextDependencyOwnershipV1,
  buildProjectContextRequestMatrixV2,
  buildProjectScopeManifestV1,
  captureCertifiedProjectFactsV2,
  createProjectContextRequestAuditPlansV2,
  hashBytes,
  NodeProjectContextFoundationHostPorts,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextInventoryPolicyV1,
} from '../src/projectContextFoundation.js';

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function createTree(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pc-ownership-')));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

/** 生成器只看清单行与读文件端口；这里用内存里的一个仓库喂它。 */
function memoryRepository(
  repoId: string,
  files: Record<string, string>,
  options: { inventory?: string[]; owners?: Record<string, string[]> } = {}
) {
  const inventory = options.inventory ?? Object.keys(files);
  const descriptors: ProjectContextFoundationFileDescriptor[] = inventory.map((relativePath) => ({
    relativePath,
    language: relativePath.endsWith('.swift') ? 'swift' : 'typescript',
    mode: '100644',
    ownerModuleIds:
      options.owners?.[relativePath] ?? (relativePath.startsWith('src/') ? ['module:src'] : []),
  }));
  return {
    source: {
      repository: {
        repoId,
        relativeRoot: repoId,
        scopeId: 'scope',
        sourceRoot: `/virtual/${repoId}`,
      },
      files: descriptors,
    },
    read: (relativePath: string) => {
      const content = files[relativePath];
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: ${relativePath}`), { code: 'ENOENT' });
      }
      return Buffer.from(content);
    },
  };
}

async function build(repositories: ReturnType<typeof memoryRepository>[]) {
  const byRepo = new Map(repositories.map((entry) => [entry.source.repository.repoId, entry]));
  return buildProjectContextDependencyOwnershipV1({
    repositories: repositories.map((entry) => entry.source),
    readFile: async ({ repository, relativePath }) =>
      byRepo.get(repository.repoId)!.read(relativePath),
  });
}

describe('依赖归属目录的生成', () => {
  it('package.json：包名、写出来的子路径、指向仓库内的私有别名', async () => {
    const packageJson = JSON.stringify({
      name: '@fixture/core',
      exports: {
        '.': './dist/index.js',
        './project-context': './dist/pc.js',
        './tools/*': './dist/tools/*.js',
      },
      imports: {
        '#shared/*': './src/shared/*.js',
        '#native': { node: './src/native.js', default: './src/fallback.js' },
        '#external': 'some-other-package',
      },
    });
    const result = await build([
      memoryRepository('core', { 'package.json': packageJson, 'src/index.ts': 'export {};\n' }),
    ]);
    const provenance = {
      relativePath: 'package.json',
      contentHash: hashBytes(Buffer.from(packageJson)),
    };

    expect(
      result.ownership.entries.map(({ source, pattern, targetPatterns }) => ({
        source,
        pattern,
        targetPatterns,
      }))
    ).toEqual([
      {
        source: 'package-export',
        pattern: '@fixture/core/project-context',
        targetPatterns: undefined,
      },
      { source: 'package-export', pattern: '@fixture/core/tools/*', targetPatterns: undefined },
      {
        source: 'package-import',
        pattern: '#native',
        targetPatterns: ['src/fallback.js', 'src/native.js'],
      },
      { source: 'package-import', pattern: '#shared/*', targetPatterns: ['src/shared/*.js'] },
      { source: 'package-name', pattern: '@fixture/core', targetPatterns: undefined },
    ]);
    expect(
      result.ownership.entries.every(
        (entry) =>
          entry.repoId === 'core' &&
          entry.ownerModuleId === 'module:src' &&
          entry.ownerPackageName === '@fixture/core' &&
          entry.provenance.relativePath === provenance.relativePath &&
          entry.provenance.contentHash === provenance.contentHash
      )
    ).toBe(true);
    // 映射到另一个包名的别名不是本仓库的文件：不产生条目，但说明原因。
    expect(result.gaps).toEqual([
      {
        repoId: 'core',
        manifest: 'package.json',
        declaration: '#external',
        reason: 'import-target-outside-repository',
      },
    ]);
  });

  it('没有 exports 字段的包，任何子路径都算它导出的', async () => {
    const result = await build([
      memoryRepository('lib', {
        'package.json': '{"name":"plain-lib"}',
        'src/index.ts': 'export {};\n',
      }),
    ]);
    expect(result.ownership.entries.map((entry) => `${entry.source}:${entry.pattern}`)).toEqual([
      'package-export:plain-lib/*',
      'package-name:plain-lib',
    ]);
  });

  it('只有条件键的 exports 只导出包本身，不放开子路径', async () => {
    const result = await build([
      memoryRepository('lib', {
        'package.json': '{"name":"conditional","exports":{"import":"./a.mjs","require":"./a.cjs"}}',
        'src/index.ts': 'export {};\n',
      }),
    ]);
    expect(result.ownership.entries.map((entry) => `${entry.source}:${entry.pattern}`)).toEqual([
      'package-name:conditional',
    ]);
  });

  it('Package.swift：非测试的 target 名是模块名，归到同名目录的模块', async () => {
    const manifest = [
      '// swift-tools-version:5.9',
      'import PackageDescription',
      'let package = Package(',
      '  name: "Kit",',
      '  products: [.library(name: "KitProduct", targets: ["NetworkKit"])],',
      '  targets: [',
      '    .target(name: "NetworkKit"),',
      '    .target(name: "FoundationKit", dependencies: []),',
      '    .executableTarget(name: "kit-cli"),',
      '    .testTarget(name: "NetworkKitTests", dependencies: ["NetworkKit"]),',
      '  ]',
      ')',
      '',
    ].join('\n');
    const result = await build([
      memoryRepository(
        'kit',
        {
          'Package.swift': manifest,
          'Sources/NetworkKit/Client.swift': 'struct Client {}\n',
          'Sources/FoundationKit/Log.swift': 'struct Log {}\n',
          'Sources/FoundationKit/Clock.swift': 'struct Clock {}\n',
        },
        {
          owners: {
            'Sources/NetworkKit/Client.swift': ['module:Sources/NetworkKit'],
            'Sources/FoundationKit/Log.swift': ['module:Sources/FoundationKit'],
            'Sources/FoundationKit/Clock.swift': ['module:Sources/FoundationKit'],
          },
        }
      ),
    ]);

    expect(
      result.ownership.entries.map(({ source, pattern, ownerModuleId, provenance }) => ({
        source,
        pattern,
        ownerModuleId,
        provenancePath: provenance.relativePath,
      }))
    ).toEqual([
      {
        source: 'module-alias',
        pattern: 'FoundationKit',
        ownerModuleId: 'module:Sources/FoundationKit',
        provenancePath: 'Package.swift',
      },
      {
        source: 'module-alias',
        pattern: 'NetworkKit',
        ownerModuleId: 'module:Sources/NetworkKit',
        provenancePath: 'Package.swift',
      },
    ]);
    expect(result.gaps).toEqual([]);
  });

  it('清单文件不在认证清单里时不出条目，并说明缺口', async () => {
    // 宿主的清单策略不含 .json：package.json 的字节不会被认证，不能当归属证据。
    const result = await build([
      memoryRepository(
        'core',
        { 'package.json': '{"name":"@fixture/core"}', 'src/index.ts': 'export {};\n' },
        { inventory: ['src/index.ts'] }
      ),
    ]);
    expect(result.ownership.entries).toEqual([]);
    expect(result.gaps).toEqual([
      { repoId: 'core', manifest: 'package.json', reason: 'manifest-not-in-certified-inventory' },
    ]);
  });

  it('读不懂、没有名字、没有可归属模块的清单各自记为缺口，不抛错', async () => {
    const result = await build([
      memoryRepository('broken', { 'package.json': '{ not json', 'src/a.ts': '' }),
      memoryRepository('nameless', { 'package.json': '{"private":true}', 'src/a.ts': '' }),
      memoryRepository('docs-only', { 'package.json': '{"name":"docs"}', 'README.ts': '' }),
    ]);
    expect(result.ownership.entries).toEqual([]);
    expect(result.gaps).toEqual([
      { repoId: 'broken', manifest: 'package.json', reason: 'manifest-unparseable' },
      {
        repoId: 'docs-only',
        manifest: 'package.json',
        declaration: 'docs',
        reason: 'no-certified-owner-module',
      },
      { repoId: 'nameless', manifest: 'package.json', reason: 'package-has-no-name' },
    ]);
  });

  it('两个仓库声明同一个名字时照实保留并报告，同名的私有别名不算冲突', async () => {
    const result = await build([
      memoryRepository('a', {
        'package.json': '{"name":"shared","imports":{"#util":"./src/util.js"}}',
        'src/index.ts': '',
      }),
      memoryRepository('b', {
        'package.json': '{"name":"shared","imports":{"#util":"./src/util.js"}}',
        'src/index.ts': '',
      }),
    ]);
    expect(result.ambiguousPatterns).toEqual([
      { pattern: 'shared', owners: ['a/module:src', 'b/module:src'] },
      { pattern: 'shared/*', owners: ['a/module:src', 'b/module:src'] },
    ]);
    expect(result.ownership.entries.filter((entry) => entry.pattern === 'shared')).toHaveLength(2);
  });

  it('同一份输入得到同一个目录哈希', async () => {
    const files = { 'package.json': '{"name":"stable"}', 'src/index.ts': 'export {};\n' };
    const first = await build([memoryRepository('one', files)]);
    const second = await build([memoryRepository('one', files)]);
    expect(second.ownership.ownershipHash).toBe(first.ownership.ownershipHash);
  });
});

describe('带归属目录的真实捕获', () => {
  async function captureScope(input: {
    controlRoot: string;
    repositories: Array<{ repoId: string; relativeRoot: string }>;
    includeExtensions: string[];
  }) {
    const projectScope = buildProjectScopeManifestV1({
      acceptedScope: {
        projectMode: 'ownership-fixture',
        projectIdentity: { projectId: 'ownership', scopeId: 'ownership' },
        repositories: input.repositories,
      },
      controlRoot: input.controlRoot,
      sourceRoots: input.repositories.map((repository) => ({
        repoId: repository.repoId,
        sourceRoot: path.join(input.controlRoot, repository.relativeRoot),
      })),
    });
    const inventoryPolicy: ProjectContextInventoryPolicyV1 = {
      version: 'ownership-fixture',
      includeExtensions: input.includeExtensions,
      excludeDirectories: ['.git', 'node_modules'],
    };
    const portableRoots = projectScope.repositories.map((repository) => ({
      portableId: repository.repoId,
      sourceRoot: repository.sourceRoot,
    }));
    // 与宿主相同的顺序：先枚举清单，据此生成目录，再用带目录的端口捕获。
    const inventoryPorts = new NodeProjectContextFoundationHostPorts(undefined, { portableRoots });
    const built = await buildProjectContextDependencyOwnershipV1({
      repositories: await Promise.all(
        projectScope.repositories.map(async (repository) => ({
          repository,
          files: await inventoryPorts.enumerateEligibleFiles({
            repository,
            policy: inventoryPolicy,
          }),
        }))
      ),
      readFile: (request) => inventoryPorts.readFile(request),
    });
    const ports = new NodeProjectContextFoundationHostPorts(undefined, {
      portableRoots,
      dependencyOwnership: built.ownership,
    });
    const plans = (
      await Promise.all(
        projectScope.repositories.map(async (repository) =>
          createProjectContextRequestAuditPlansV2({
            repository,
            eligibleFiles: await ports.enumerateEligibleFiles({
              repository,
              policy: inventoryPolicy,
            }),
            projectScopeManifest: projectScope.manifest,
          })
        )
      )
    ).flat();
    const artifact = await captureCertifiedProjectFactsV2(
      {
        certification: {
          acceptedConfigHash: hashBytes(Buffer.from('config')),
          acceptedRuntimeHash: hashBytes(Buffer.from('runtime')),
          capabilityHash: hashBytes(Buffer.from('capability')),
          parserHash: hashBytes(Buffer.from('parser')),
          scopeIdentityHash: projectScope.manifest.canonicalScopeHash,
        },
        detailPolicy: {
          chunkBytes: 64 * 1024,
          maxPreviewBytes: 1024,
          maxSelectedFiles: 1,
          selectedFiles: [],
        },
        inventoryPolicy,
        legacyEntries: [],
        projectMode: projectScope.manifest.projectMode,
        projectScope,
        projections: {} as never,
        repositories: projectScope.repositories,
        requestMatrix: buildProjectContextRequestMatrixV2(projectScope.manifest, plans),
        requestPlans: plans,
      },
      ports
    );
    return { artifact, built };
  }

  it('Swift：应用仓库导入兄弟包的模块，被认成兄弟仓库的依赖并带归属证据', async () => {
    const packageSwift = [
      '// swift-tools-version:5.9',
      'import PackageDescription',
      'let package = Package(name: "SharedKit", targets: [.target(name: "SharedKit")])',
      '',
    ].join('\n');
    const controlRoot = await createTree({
      'App/Sources/App/Main.swift': [
        'import Foundation',
        'import SharedKit',
        '',
        'struct Main {',
        '    let greeter = Greeter()',
        '}',
        '',
      ].join('\n'),
      'SharedKit/Package.swift': packageSwift,
      'SharedKit/Sources/SharedKit/Greeter.swift':
        'public struct Greeter {\n    public init() {}\n}\n',
    });
    const { artifact, built } = await captureScope({
      controlRoot,
      repositories: [
        { repoId: 'app', relativeRoot: 'App' },
        { repoId: 'shared-kit', relativeRoot: 'SharedKit' },
      ],
      includeExtensions: ['.swift'],
    });

    expect(built.ownership.entries.map((entry) => `${entry.repoId}:${entry.pattern}`)).toEqual([
      'shared-kit:SharedKit',
    ]);
    const map = artifact.facts.requestOutcomes.find(
      (row) => row.repoId === 'app' && row.kind === 'map'
    )!;
    expect(map.dependencyResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'approved-sibling',
          dependencyName: 'SharedKit',
          ownerRepoId: 'shared-kit',
          ownershipSource: 'module-alias',
          ownershipProvenancePath: 'Package.swift',
          ownershipEvidenceHash: hashBytes(Buffer.from(packageSwift)),
        }),
        expect.objectContaining({
          classification: 'expected-external',
          dependencyName: 'Foundation',
        }),
      ])
    );
    expect(map.dependencyResolutions).toHaveLength(map.dependencyObservationCount!);
    expect(artifact.readiness).toMatchObject({ verdict: 'passed', errors: [] });
    // 兄弟包里被目录绑定的模块，归属证据从"路径形状"升为"包声明"。
    const greeter = artifact.facts.inventory.files.find(
      (file) => file.relativePath === 'Sources/SharedKit/Greeter.swift'
    );
    expect(greeter?.ownersV2).toEqual([
      expect.objectContaining({ origin: 'package-build-declaration', confidence: 'high' }),
    ]);
  }, 60_000);

  it('本仓库自己的模块名没被分析解析上时，记为内部依赖而不是让捕获失败', async () => {
    // target 名是 Core，文件却按子目录归到 Sources/Core/Networking：模块种子里没有叫 Core 的模块，
    // `import Core` 被 map 报成外部依赖。目录知道 Core 是本仓库声明的模块。
    const controlRoot = await createTree({
      'Kit/Package.swift': [
        '// swift-tools-version:5.9',
        'import PackageDescription',
        'let package = Package(',
        '  name: "Kit",',
        '  targets: [.target(name: "Core"), .target(name: "App", dependencies: ["Core"])]',
        ')',
        '',
      ].join('\n'),
      'Kit/Sources/Core/Networking/Client.swift':
        'public struct Client {\n    public init() {}\n}\n',
      'Kit/Sources/Core/Networking/Request.swift': 'public struct Request {}\n',
      'Kit/Sources/App/Main.swift': 'import Core\n\nstruct Main {\n    let client = Client()\n}\n',
    });
    const { artifact, built } = await captureScope({
      controlRoot,
      repositories: [{ repoId: 'kit', relativeRoot: 'Kit' }],
      includeExtensions: ['.swift'],
    });

    expect(built.ownership.entries.map((entry) => entry.pattern)).toEqual(['App', 'Core']);
    const map = artifact.facts.requestOutcomes.find((row) => row.kind === 'map')!;
    const core = map.dependencyResolutions?.find((row) => row.dependencyName === 'Core');
    expect(core).toMatchObject({
      classification: 'internal-resolved',
      ownerRepoId: 'kit',
      ownershipSource: 'module-alias',
      ownershipProvenancePath: 'Package.swift',
    });
    // 模块级的归属没有"那一个文件"可绑；只有私有别名的决议才带目标文件。
    expect(core?.resolvedTargets).toBeUndefined();
    expect(map.dependencyGraphReconciliation).toMatchObject({
      internalResolvedDependencyNames: ['Core'],
      remainingExternalDependencyNames: [],
    });
    expect(artifact.readiness).toMatchObject({ verdict: 'passed', errors: [] });
  }, 60_000);

  it('JS：清单含 package.json 时认出兄弟包；不含时只是少了这类条目，捕获照常通过', async () => {
    const files = {
      'app/package.json': '{"name":"@fixture/app","type":"module"}\n',
      'app/src/index.ts': [
        "import { helper } from '@fixture/shared/helpers';",
        "import { readFileSync } from 'node:fs';",
        '',
        'export const value = helper(readFileSync);',
        '',
      ].join('\n'),
      'shared/package.json':
        '{"name":"@fixture/shared","type":"module","exports":{".":"./src/index.ts","./helpers":"./src/helpers.ts"}}\n',
      'shared/src/index.ts': "export * from './helpers';\n",
      'shared/src/helpers.ts': 'export function helper<T>(value: T): T {\n  return value;\n}\n',
    };
    const repositories = [
      { repoId: 'app', relativeRoot: 'app' },
      { repoId: 'shared', relativeRoot: 'shared' },
    ];

    const withManifests = await captureScope({
      controlRoot: await createTree(files),
      repositories,
      includeExtensions: ['.ts', '.json'],
    });
    const map = withManifests.artifact.facts.requestOutcomes.find(
      (row) => row.repoId === 'app' && row.kind === 'map'
    )!;
    expect(map.dependencyResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'approved-sibling',
          dependencyName: '@fixture/shared/helpers',
          ownerRepoId: 'shared',
          ownershipSource: 'package-export',
        }),
        expect.objectContaining({ classification: 'expected-external', dependencyName: 'node:fs' }),
      ])
    );
    expect(withManifests.artifact.readiness).toMatchObject({ verdict: 'passed', errors: [] });

    const sourcesOnly = await captureScope({
      controlRoot: await createTree(files),
      repositories,
      includeExtensions: ['.ts'],
    });
    expect(sourcesOnly.built.ownership.entries).toEqual([]);
    expect(sourcesOnly.built.gaps.map((gap) => `${gap.repoId}:${gap.reason}`)).toEqual([
      'app:manifest-not-in-certified-inventory',
      'shared:manifest-not-in-certified-inventory',
    ]);
    const plain = sourcesOnly.artifact.facts.requestOutcomes.find(
      (row) => row.repoId === 'app' && row.kind === 'map'
    )!;
    // 没有证据就不认：兄弟包按名字被记成外部，与没有目录时一样。
    expect(plain.dependencyResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'expected-external',
          dependencyName: '@fixture/shared/helpers',
        }),
      ])
    );
    expect(sourcesOnly.artifact.readiness).toMatchObject({ verdict: 'passed', errors: [] });
  }, 60_000);
});

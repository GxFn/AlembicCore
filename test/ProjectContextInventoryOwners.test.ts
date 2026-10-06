import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProjectContextDependencyOwnershipV1,
  createProjectContextDependencyOwnershipV1,
  createProjectContextRequestAuditPlans,
  hashBytes,
  NodeProjectContextFoundationHostPorts,
  type ProjectContextInventoryPolicyV1,
} from '../src/projectContextFoundation.js';

/**
 * 认证清单的归属来自仓库的模块划分之后，模块种子与归属目录要跟着它走：
 * 种子按划分给出的名字取名；一份包清单为它目录下的每个模块作证。
 */

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function createTree(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pc-owners-')));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

const POLICY: ProjectContextInventoryPolicyV1 = {
  version: 'owners-fixture',
  includeExtensions: ['.ts', '.json'],
  excludeDirectories: ['.git', 'node_modules', 'dist'],
};

describe('inventory owners from the repository partition', () => {
  it('names module seeds after the partition, not after the last path segment of the owner id', () => {
    const repository = { relativeRoot: '.', repoId: 'kit', scopeId: 'kit', sourceRoot: '/virtual' };
    const plans = createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: [
        {
          relativePath: 'Packages/Kit/Extra.swift',
          language: 'swift',
          mode: '100644',
          ownerModuleIds: ['module:Packages/Kit'],
          // 包目录下直接放着的文件：划分给这个目录模块起的名字是路径，免得与同名 target 撞名。
          ownerModules: [
            {
              ownerModuleId: 'module:Packages/Kit',
              moduleName: 'Packages/Kit',
              modulePath: 'Packages/Kit',
            },
          ],
        },
        {
          relativePath: 'Packages/Kit/Sources/Kit/Kit.swift',
          language: 'swift',
          mode: '100644',
          ownerModuleIds: ['module:Packages/Kit/Sources/Kit'],
          ownerModules: [
            {
              ownerModuleId: 'module:Packages/Kit/Sources/Kit',
              moduleName: 'Kit',
              modulePath: 'Packages/Kit/Sources/Kit',
            },
          ],
        },
        // 旧端口不给名字：仍从 id 推。
        {
          relativePath: 'src/index.ts',
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['module:src'],
        },
      ],
    });

    expect(
      plans
        .filter((plan) => plan.kind === 'module')
        .map((plan) => plan.selector as { moduleName: string; modulePath?: string })
        .map((selector) => `${selector.moduleName} @ ${selector.modulePath}`)
    ).toEqual(['Packages/Kit @ Packages/Kit', 'Kit @ Packages/Kit/Sources/Kit', 'src @ src']);
  });

  it('lets a package manifest vouch for every module under its directory, nearest manifest first', async () => {
    const rootManifest = '{"name":"@fixture/root","version":"1.0.0"}\n';
    const nestedManifest = '{"name":"@fixture/nested","version":"1.0.0"}\n';
    const root = await createTree({
      'package.json': rootManifest,
      'src/index.ts': "export * from './core/a.js';\n",
      'src/core/a.ts': 'export const a = 1;\n',
      'test/a.test.ts': "import { a } from '../src/core/a.js';\nexport const t = a;\n",
      'packages/nested/package.json': nestedManifest,
      'packages/nested/src/index.ts': 'export const nested = 1;\n',
    });
    const repository = { relativeRoot: '.', repoId: 'root', scopeId: 'root', sourceRoot: root };
    const inventoryPorts = new NodeProjectContextFoundationHostPorts();
    const files = await inventoryPorts.enumerateEligibleFiles({ repository, policy: POLICY });
    // 仓库根的 package.json 由目录生成器读出；嵌套包的清单不在它的视野里，这里照它的样子补一条。
    const built = await buildProjectContextDependencyOwnershipV1({
      repositories: [{ repository, files }],
      readFile: (request) => inventoryPorts.readFile(request),
    });
    expect(
      built.ownership.entries.map((entry) => `${entry.pattern}->${entry.ownerModuleId}`)
    ).toEqual(['@fixture/root/*->module:src', '@fixture/root->module:src']);
    const ownership = createProjectContextDependencyOwnershipV1([
      ...built.ownership.entries,
      {
        repoId: 'root',
        ownerModuleId: 'module:packages/nested/src',
        ownerPackageName: '@fixture/nested',
        source: 'package-name',
        pattern: '@fixture/nested',
        provenance: {
          relativePath: 'packages/nested/package.json',
          contentHash: hashBytes(Buffer.from(nestedManifest)),
        },
      },
    ]);
    const ports = new NodeProjectContextFoundationHostPorts(undefined, {
      dependencyOwnership: ownership,
    });
    const bound = await ports.enumerateEligibleFiles({ repository, policy: POLICY });
    const evidenceOf = (relativePath: string) =>
      bound
        .find((file) => file.relativePath === relativePath)
        ?.ownersV2?.map(
          (owner) =>
            `${owner.origin}:${owner.evidence.map((evidence) => evidence.relativePath ?? evidence.kind).join(',')}`
        );

    // 根 package.json 声明的是整个包：src 下的区域、test 都由它作证，不只是生成目录时挑出的 module:src。
    expect(evidenceOf('src/index.ts')).toEqual(['package-build-declaration:package.json']);
    expect(evidenceOf('src/core/a.ts')).toEqual(['package-build-declaration:package.json']);
    expect(evidenceOf('test/a.test.ts')).toEqual(['package-build-declaration:package.json']);
    // 嵌套包的文件以离它最近的清单为准。
    expect(evidenceOf('packages/nested/src/index.ts')).toEqual([
      'package-build-declaration:packages/nested/package.json',
    ]);
    // 清单文件本身没有所属模块。
    expect(bound.find((file) => file.relativePath === 'package.json')?.ownerModuleIds).toEqual([]);
  });
});

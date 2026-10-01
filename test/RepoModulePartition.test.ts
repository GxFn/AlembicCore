import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/core/ast/index.js';
import type { ProjectMap, RepoContext } from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import {
  ownerOfPath,
  partitionRepoModules,
} from '../src/service/project-context/shared/map-repo/index.js';
import { materializeBenchmarkFixture } from './fixtures/analysis-benchmark/index.js';
import { tsMonorepoFixture } from './fixtures/analysis-benchmark/tsMonorepo.js';

const describeModules = (modules: ReturnType<typeof partitionRepoModules>) =>
  modules.map(
    (module) => `${module.kind} ${module.name} @ ${module.path} (${module.files.length})`
  );

describe('repository module partition', () => {
  it('makes every build target a module when discovery reports several', () => {
    const modules = partitionRepoModules({
      targets: [
        { name: 'Core', kind: 'target' },
        { name: 'CoreTests', kind: 'testTarget' },
        { name: 'App', kind: 'executableTarget' },
      ],
      sourceRoots: ['Sources', 'Tests'],
      files: [
        { filePath: 'Sources/Core/Model/User.swift', targetName: 'Core' },
        { filePath: 'Sources/Core/Store.swift', targetName: 'Core' },
        { filePath: 'Sources/App/main.swift', targetName: 'App' },
        { filePath: 'Tests/CoreTests/StoreTests.swift', targetName: 'CoreTests' },
        // 不属于任何目标的文件按目录归属。
        { filePath: 'Scripts/gen/build.swift' },
        { filePath: 'Package.swift' },
      ],
    });

    expect(describeModules(modules)).toEqual([
      'root root @ . (1)',
      'area Scripts @ Scripts (1)',
      'target App @ Sources/App (1)',
      'target Core @ Sources/Core (2)',
      'target CoreTests @ Tests/CoreTests (1)',
    ]);
    expect(modules.find((module) => module.name === 'CoreTests')).toMatchObject({
      targetName: 'CoreTests',
      targetKind: 'testTarget',
    });
    // 一个文件属于路径前缀最长的那个模块。
    expect(ownerOfPath(modules, 'Sources/Core/Model/User.swift')?.name).toBe('Core');
    expect(ownerOfPath(modules, 'Sources/Other/New.swift')?.name).toBe('root');
    expect(ownerOfPath(modules, 'README.md')?.name).toBe('root');
  });

  it('splits a single-target repository by the first directory under its source roots', () => {
    const modules = partitionRepoModules({
      targets: [{ name: 'app', kind: 'package' }],
      sourceRoots: ['src', 'test'],
      files: [
        'src/index.ts',
        'src/core/a.ts',
        'src/core/deep/b.ts',
        'src/service/c.ts',
        'test/core.test.ts',
        'scripts/release.mjs',
        'vitest.config.ts',
      ].map((filePath) => ({ filePath, targetName: 'app' })),
    });

    expect(describeModules(modules)).toEqual([
      'root root @ . (1)',
      'area scripts @ scripts (1)',
      'root src @ src (1)',
      'area core @ src/core (2)',
      'area service @ src/service (1)',
      'root test @ test (1)',
    ]);
    expect(ownerOfPath(modules, 'src/core/deep/b.ts')?.path).toBe('src/core');
    expect(ownerOfPath(modules, 'src/index.ts')?.path).toBe('src');
    expect(ownerOfPath([{ path: 'src/core' }], 'lib/x.ts')).toBeUndefined();
  });
});

describe('repo query module seeds', () => {
  const roots: string[] = [];
  beforeAll(async () => {
    await loadPlugins();
  });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function materialize(files: Record<string, string>): Promise<string> {
    const projectRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-modules-'))
    );
    roots.push(projectRoot);
    await materializeBenchmarkFixture({ files } as typeof tsMonorepoFixture, projectRoot);
    return projectRoot;
  }

  it('reports workspace packages as modules whose refs work as map seeds unchanged', async () => {
    const projectRoot = await materialize(tsMonorepoFixture.files);

    const repo = await ProjectContext.execute({
      kind: 'repo',
      scope: { projectRoot },
      payload: { includeMapSummary: false },
    });
    const modules = (repo.data as RepoContext).modules ?? [];
    expect(modules.map((module) => `${module.kind} ${module.name} @ ${module.path}`)).toEqual(
      expect.arrayContaining([
        'target @bench/app @ packages/app/src',
        'target @bench/core @ packages/core/src',
        'target @bench/tools @ packages/tools/lib-src',
        'target @bench/ui @ packages/ui/src',
      ])
    );
    for (const module of modules) {
      expect(module.ref).toMatchObject({ kind: 'module', level: 'module' });
      expect(module.ref.metadata).toMatchObject({ ownedFileCount: module.fileCount });
    }

    // 宿主不需要自己推种子：把 repo 给的模块引用原样交给 map。
    const map = await ProjectContext.execute({
      kind: 'map',
      scope: { projectRoot },
      payload: { moduleSeeds: modules.map((module) => ({ ref: module.ref })) },
    });
    const projectMap = map.data as ProjectMap;
    expect(projectMap.modules.map((module) => module.name).sort()).toEqual(
      modules.map((module) => module.name).sort()
    );
    expect(projectMap.modules.find((module) => module.name === '@bench/core')).toMatchObject({
      ownedFileCount: 3,
    });
  });

  it('partitions a single-package repository into source areas', async () => {
    const projectRoot = await materialize({
      'package.json': '{ "name": "single" }\n',
      'src/index.ts': "export { run } from './core/run.js';\n",
      'src/core/run.ts':
        "import { format } from '../shared/format.js';\nexport function run() { return format(); }\n",
      'src/shared/format.ts': 'export function format() { return 1; }\n',
    });

    const repo = await ProjectContext.execute({
      kind: 'repo',
      scope: { projectRoot },
      payload: { includeMapSummary: false },
    });
    const modules = (repo.data as RepoContext).modules ?? [];
    expect(modules.map((module) => `${module.kind} ${module.name} @ ${module.path}`)).toEqual([
      'root src @ src',
      'area core @ src/core',
      'area shared @ src/shared',
    ]);
    // 源码根自己的散落文件在引用里逐个列出，目录扫描才不会把子目录的模块算进来。
    expect(modules[0].ref.metadata?.ownedFiles).toEqual(['src/index.ts']);
    const map = await ProjectContext.execute({
      kind: 'map',
      scope: { projectRoot },
      payload: { moduleSeeds: modules.map((module) => ({ ref: module.ref })) },
    });
    expect(
      (map.data as ProjectMap).modules.map((module) => `${module.name}:${module.ownedFileCount}`)
    ).toEqual(expect.arrayContaining(['src:1', 'core:1', 'shared:1']));
  });
});

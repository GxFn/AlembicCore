import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import type { ModuleContext, SpaceContext } from '../src/domain/project-context/index.js';
import { collectPlanProjectContext } from '../src/service/plan/facts/collectProjectContext.js';

// F6：三个宿主共用的采集器。种子只来自 repo 的模块划分；上限、范围、来源标签都是参数。
const fixtureRoots: string[] = [];

beforeAll(async () => {
  await reloadPlugins();
});

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

describe('collectPlanProjectContext (F6 shared collector)', () => {
  it('seeds map and module queries from the repository module partition', async () => {
    const fixtureRoot = createNodeAreasFixture();

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined);

    // 划分：src 下的两个一级目录各一个区域模块，直接放在 src / test / scripts 下的文件归各自的源码根；
    // 顶层的配置文件、README 与入口文件不再是"模块"。
    expect(analysis.modules?.map((module) => `${module.kind} ${module.moduleName}`)).toEqual([
      'root scripts',
      'root src',
      'area api',
      'area core',
      'root test',
    ]);
    expect(analysis.moduleSeeds.map((seed) => seed.moduleName)).toEqual([
      'scripts',
      'src',
      'api',
      'core',
      'test',
    ]);
    for (const seed of analysis.moduleSeeds) {
      expect(seed.ref?.kind).toBe('module');
      expect(seed.moduleId).toBe(seed.ref?.id);
      expect(seed.fileCount).toBeGreaterThan(0);
    }
    expect(analysis.moduleSeeds.find((seed) => seed.moduleName === 'core')?.ownedFiles).toEqual([
      'src/core/engine.ts',
      'src/core/util.ts',
    ]);
    expect(analysis.collection).toMatchObject({
      droppedModuleSeeds: [],
      filteredModuleSeeds: [],
      scopeSource: 'project-root',
      seedSource: 'repo-modules',
      source: 'codex-host-plan',
      sourceScanTruncated: false,
    });
    // Plan 路径的默认上限：全部模块取明细、不取文件明细。
    expect(analysis.requestKinds).toEqual(['space', 'repo', 'map', 'module', 'module-layers']);
    expect(analysis.envelopes.filter((envelope) => envelope.queryLevel === 'module')).toHaveLength(
      5
    );
    const mapModuleNames = analysis.presenterInput.map?.modules.map((module) => module.name).sort();
    expect(mapModuleNames).toEqual(['api', 'core', 'scripts', 'src', 'test']);
    expect(analysis.moduleCount).toBe(5);
    expect(analysis.primaryLanguage).toBe('typescript');
    expect(analysis.languageStats).toEqual({ typescript: 6 });
    expect(analysis.isEmpty).toBe(false);
    expect(analysis.isMultiLang).toBe(false);
    expect(analysis.contextStatus).toBe('complete');
  });

  it('applies the module and file detail limits and reports what was dropped', async () => {
    const fixtureRoot = createNodeAreasFixture();

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined, {
      limits: { maxFileDetails: 2, maxModuleDetails: 1, maxModuleSeeds: 2, sourceSliceLines: 3 },
      source: 'alembic-main-bootstrap',
    });

    // 上限按文件数留大的（core 两个文件、其余各一个；同为一个时按名字），输出仍按划分顺序。
    expect(analysis.moduleSeeds.map((seed) => seed.moduleName)).toEqual(['api', 'core']);
    expect(analysis.collection?.droppedModuleSeeds).toEqual(['scripts', 'src', 'test']);
    // 过滤与截断之前的全部模块仍在 modules 里。
    expect(analysis.modules).toHaveLength(5);
    // 明细同样按文件数取：两个种子里 core 有两个文件，拿到唯一的一份明细。
    const detailed = analysis.envelopes.filter((envelope) => envelope.queryLevel === 'module');
    expect(detailed).toHaveLength(1);
    expect((detailed[0]?.data as ModuleContext).module.name).toBe('core');
    expect(analysis.requestKinds).toEqual([
      'space',
      'repo',
      'map',
      'module',
      'module-layers',
      'file-flow',
      'file-symbols',
      'source-slice',
      'anchor-range',
    ]);
    expect(analysis.collection?.detailFiles).toHaveLength(2);
    expect(analysis.presenterInput.sourceSlices.map((slice) => slice.file.filePath)).toEqual(
      analysis.collection?.detailFiles
    );
    expect(
      analysis.presenterInput.sourceSlices.every((slice) => typeof slice.text === 'string')
    ).toBe(true);
    expect(analysis.collection?.source).toBe('alembic-main-bootstrap');
    expect(analysis.collection?.limits).toEqual({
      maxFileDetails: 2,
      maxModuleDetails: 1,
      maxModuleSeeds: 2,
      sourceSliceLines: 3,
    });
  });

  it('skips source text when sourceSliceLines is 0 and never picks manifests or docs as detail files', async () => {
    const fixtureRoot = createSwiftPackageFixture();

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined, {
      limits: { maxFileDetails: 8, maxModuleDetails: 8 },
      source: 'codex-host-rescan',
    });

    expect(analysis.requestKinds).toEqual([
      'space',
      'repo',
      'map',
      'module',
      'module-layers',
      'file-flow',
      'file-symbols',
      'anchor-range',
    ]);
    expect(analysis.collection?.detailFiles.every((filePath) => filePath.endsWith('.swift'))).toBe(
      true
    );
    expect(analysis.collection?.detailFiles).not.toContain('Package.swift');
    // SPM：每个 target 一个模块，应用壳目录是目录模块。
    expect(analysis.moduleSeeds.map((seed) => `${seed.kind} ${seed.moduleName}`)).toEqual([
      'area App',
      'target Core',
      'target CoreTests',
    ]);
    expect(analysis.moduleSeeds.find((seed) => seed.moduleName === 'Core')).toMatchObject({
      modulePath: 'Sources/Core',
      ownedFiles: ['Sources/Core/Engine.swift', 'Sources/Core/Model.swift'],
      role: 'target',
    });
    expect(analysis.primaryLanguage).toBe('swift');
    expect(analysis.projectType).toBe('swift-package-manager');
  });

  it('threads an explicit scope: folder objects reach space, the primary folder is the repo, other folders become seeds', async () => {
    const controlRoot = createWorkspaceFixture();

    const analysis = await collectPlanProjectContext(controlRoot, undefined, {
      limits: { maxModuleDetails: 0 },
      scope: {
        displayName: 'Workspace',
        sourceFolders: [
          { displayName: 'Main', path: 'Main', role: 'primary-source' },
          'Kit',
          { displayName: 'Docs', path: 'Docs' },
        ],
      },
      source: 'alembic-main-rescan',
    });

    const space = analysis.presenterInput.space as SpaceContext;
    expect(space.sourceFolders.map((folder) => folder.path)).toEqual(['Main', 'Kit', 'Docs']);
    expect(space.sourceFolders.map((folder) => folder.displayName)).toEqual([
      'Main',
      'Kit',
      'Docs',
    ]);
    // 主仓库的划分带着仓库目录前缀；范围里别的文件夹各一个整体种子；只有文档的文件夹没有种子。
    expect(
      analysis.moduleSeeds.map((seed) => `${seed.kind} ${seed.moduleName} @ ${seed.modulePath}`)
    ).toEqual(['root lib @ Main/lib', 'project-scope-folder Kit @ Kit']);
    expect(analysis.moduleSeeds[1]?.ownedFiles).toEqual(['Kit/src/index.ts']);
    expect(analysis.presenterInput.map?.modules.map((module) => module.name).sort()).toEqual([
      'Kit',
      'lib',
    ]);
    expect(analysis.collection).toMatchObject({
      scopeSource: 'explicit',
      seedSource: 'repo-modules',
    });
    // 源码清单照旧收文档与配置（语言表认得它们），但它们不算代码：语言统计与模块文件都不计。
    expect(analysis.sourceFileFacts.map((fact) => fact.filePath)).toEqual([
      'Docs/guide.md',
      'Kit/package.json',
      'Kit/src/index.ts',
      'Main/lib/index.ts',
      'Main/package.json',
    ]);
    expect(analysis.languageStats).toEqual({ typescript: 2 });
  });

  it('keeps only modules inside moduleScope and records the rest as filtered', async () => {
    const fixtureRoot = createNodeAreasFixture();

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined, {
      scope: { moduleScope: ['src/core/engine.ts', 'test'] },
    });

    expect(analysis.moduleSeeds.map((seed) => seed.moduleName)).toEqual(['core', 'test']);
    expect(analysis.collection?.filteredModuleSeeds).toEqual(['scripts', 'src', 'api']);
    expect(analysis.modules).toHaveLength(5);
    const moduleEnvelopes = analysis.envelopes.filter(
      (envelope) => envelope.queryLevel === 'module'
    );
    expect(
      moduleEnvelopes.map((envelope) => (envelope.data as ModuleContext).module.name).sort()
    ).toEqual(['core', 'test']);
  });

  it('keeps the module partition whole when maxFiles only budgets the source inventory', async () => {
    const fixtureRoot = createNodeAreasFixture();

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined, {
      limits: { maxFiles: 2, maxModuleDetails: 0 },
    });

    // 预算只截断源码清单（6 个代码文件只收 2 个）；划分照旧 5 个模块，种子一个不少。
    expect(analysis.sourceFileFacts).toHaveLength(2);
    expect(analysis.collection?.sourceScanTruncated).toBe(true);
    expect(analysis.collection?.partitionTruncated).toBe(false);
    expect(analysis.modules).toHaveLength(5);
    expect(analysis.moduleSeeds.map((seed) => seed.moduleName)).toEqual([
      'scripts',
      'src',
      'api',
      'core',
      'test',
    ]);
    expect(analysis.presenterInput.map?.modules).toHaveLength(5);
  });

  it('reports a missing partition as a gap instead of inventing seeds', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'plan-facts-collect-empty-'));
    fixtureRoots.push(fixtureRoot);
    writeFileSync(join(fixtureRoot, 'README.md'), '# docs only\n');

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined);

    expect(analysis.moduleSeeds).toEqual([]);
    expect(analysis.requestKinds).toEqual(['space', 'repo']);
    expect(analysis.collection?.seedSource).toBe('none');
    expect(analysis.isEmpty).toBe(false);
    expect(analysis.contextStatus).toBe('complete');
    expect(analysis.understandingGaps).toEqual([]);
  });
});

function createNodeAreasFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'plan-facts-collect-node-'));
  fixtureRoots.push(fixtureRoot);
  writeFixtureFile(
    fixtureRoot,
    'package.json',
    JSON.stringify({ name: 'plan-facts-collect', version: '1.0.0', type: 'module' })
  );
  writeFixtureFile(fixtureRoot, 'README.md', '# fixture\n');
  writeFixtureFile(fixtureRoot, 'tsconfig.json', '{}\n');
  writeFixtureFile(fixtureRoot, 'src/index.ts', "export { Engine } from './core/engine.js';\n");
  writeFixtureFile(
    fixtureRoot,
    'src/core/engine.ts',
    "import { helper } from './util.js';\nexport class Engine { run() { return helper(); } }\n"
  );
  writeFixtureFile(fixtureRoot, 'src/core/util.ts', 'export function helper() { return 1; }\n');
  writeFixtureFile(
    fixtureRoot,
    'src/api/server.ts',
    "import { Engine } from '../core/engine.js';\nexport const server = new Engine();\n"
  );
  writeFixtureFile(
    fixtureRoot,
    'test/engine.test.ts',
    "import { Engine } from '../src/core/engine.js';\nexport const checked = new Engine().run();\n"
  );
  writeFixtureFile(fixtureRoot, 'scripts/build.ts', 'export const build = true;\n');
  return fixtureRoot;
}

function createSwiftPackageFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'plan-facts-collect-swift-'));
  fixtureRoots.push(fixtureRoot);
  writeFixtureFile(
    fixtureRoot,
    'Package.swift',
    [
      '// swift-tools-version: 5.9',
      'import PackageDescription',
      'let package = Package(',
      '  name: "Fixture",',
      '  targets: [',
      '    .target(name: "Core", path: "Sources/Core"),',
      '    .testTarget(name: "CoreTests", dependencies: ["Core"], path: "Tests/CoreTests"),',
      '  ]',
      ')',
      '',
    ].join('\n')
  );
  writeFixtureFile(fixtureRoot, 'README.md', '# swift fixture\n');
  writeFixtureFile(
    fixtureRoot,
    'Sources/Core/Engine.swift',
    'public struct Engine { public init() {} }\n'
  );
  writeFixtureFile(fixtureRoot, 'Sources/Core/Model.swift', 'public struct Model {}\n');
  writeFixtureFile(
    fixtureRoot,
    'Tests/CoreTests/EngineTests.swift',
    'import Core\nfinal class EngineTests { let engine = Engine() }\n'
  );
  writeFixtureFile(
    fixtureRoot,
    'App/AppDelegate.swift',
    'import Core\nfinal class AppDelegate {}\n'
  );
  return fixtureRoot;
}

function createWorkspaceFixture(): string {
  const controlRoot = mkdtempSync(join(tmpdir(), 'plan-facts-collect-scope-'));
  fixtureRoots.push(controlRoot);
  writeFixtureFile(
    controlRoot,
    'Main/package.json',
    JSON.stringify({ name: 'main', type: 'module' })
  );
  writeFixtureFile(controlRoot, 'Main/lib/index.ts', 'export const main = true;\n');
  writeFixtureFile(
    controlRoot,
    'Kit/package.json',
    JSON.stringify({ name: 'kit', type: 'module' })
  );
  writeFixtureFile(controlRoot, 'Kit/src/index.ts', 'export const kit = true;\n');
  writeFixtureFile(controlRoot, 'Docs/guide.md', '# guide\n');
  return controlRoot;
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

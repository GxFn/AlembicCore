// RIC-4b — Core ownership of the multi-file-AST + project-discovery test coverage
// that previously flowed through Alembic's ProjectIntelligenceCompatibility shim
// (RealProjectAst / RealProjectBootstrap / RealProjectDiscovery / GoSupport).
//
// These are Core-INTERNAL tests, so they import core/ast + core/discovery directly
// and use synthetic in-memory files / temp-dir build files instead of real cloned
// projects (the import-boundary forbids Alembic tests from importing
// @alembic/core/core). With this coverage in Core, Alembic can delete the shim
// (RIC-4c) without a coverage gap. Additive — no Core production change.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeFile, analyzeProject, isAvailable } from '../src/core/AstAnalyzer.js';
import { CallGraphAnalyzer } from '../src/core/analysis/CallGraphAnalyzer.js';
import { ImportPathResolver } from '../src/core/analysis/ImportPathResolver.js';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import ProjectGraph from '../src/core/ast/ProjectGraph.js';
import { GenericDiscoverer } from '../src/core/discovery/GenericDiscoverer.js';
import { getDiscovererRegistry, resetDiscovererRegistry } from '../src/core/discovery/index.js';
import { NodeDiscoverer } from '../src/core/discovery/NodeDiscoverer.js';
import type { ProjectDiscoverer } from '../src/core/discovery/ProjectDiscoverer.js';
import { SpmDiscoverer } from '../src/core/discovery/SpmDiscoverer.js';
import {
  RecordingProjectSourceReader,
  ReplayProjectSourceReader,
} from '../src/infrastructure/io/ProjectInputSnapshot.js';
import { nodeProjectSourceReader } from '../src/infrastructure/io/ProjectSourceReader.js';
import type { ProjectSourceReader } from '../src/types/projectSourceReader.js';

beforeAll(async () => {
  // Load the packaged tree-sitter WASM grammars before AST analysis (mirrors the
  // shim's loadProjectAstPlugins() beforeAll in the Alembic RealProjectAst tests).
  await reloadPlugins();
});

describe('multi-file analyzeProject aggregation (RIC-4b — was RealProjectAst/GoSupport)', () => {
  it('keeps Python module paths and aliases for comma-separated and aliased imports', () => {
    const result = analyzeFile(
      'import os as operating, sys, xml.sax\nfrom os import path as p, sep\n',
      'python'
    );
    expect(result?.imports).toMatchObject([
      { path: 'os', symbols: ['*'], alias: 'operating', kind: 'namespace' },
      { path: 'sys', symbols: ['*'], alias: 'sys', kind: 'namespace' },
      { path: 'xml.sax', symbols: ['*'], alias: 'xml', kind: 'namespace' },
      { path: 'os', symbols: ['path'], alias: 'p', kind: 'named' },
      { path: 'os', symbols: ['sep'], alias: null, kind: 'named' },
    ]);
    expect(analyzeFile('from os import path, sep\n', 'python')?.imports).toMatchObject([
      { path: 'os', symbols: ['path', 'sep'], alias: null, kind: 'named' },
    ]);
  });

  it.each(
    [
      {
        language: 'python',
        source: (name: string) =>
          `class ${name}:\n    def __enter__(self):\n        return self\n    def __exit__(self, *args):\n        pass\n`,
      },
      {
        language: 'java',
        source: (name: string) => `class ${name} { static ${name} getInstance() { return null; } }`,
      },
      {
        language: 'go',
        source: (name: string) =>
          `package sample\ntype ${name} struct {}\nfunc (x ${name}) Read() {}\nfunc (x ${name}) Write() {}\nfunc (x ${name}) Close() {}`,
      },
      {
        language: 'rust',
        source: (name: string) => `struct ${name}; impl ${name} { fn build(&self) {} }`,
      },
      {
        language: 'dart',
        source: (name: string) => `class ${name} extends StatelessWidget { void run() {} }`,
      },
    ].flatMap((fixture) =>
      ['constructor', '__proto__', 'toString'].map((name) => ({ ...fixture, name }))
    )
  )('analyzes the legal $language type name $name without changing ordinary patterns', ({
    language,
    source,
    name,
  }) => {
    const content = source(name);
    const result = analyzeFile(content, language);
    const ordinary = analyzeFile(source('PlainSample'), language);
    expect(result?.classes).toContainEqual(expect.objectContaining({ name }));
    expect(
      result?.patterns.map((pattern) => ({
        ...pattern,
        className: pattern.className === name ? 'PlainSample' : pattern.className,
      }))
    ).toEqual(ordinary?.patterns);
    const project = analyzeProject([{ name: 'module', relativePath: 'module', content }], language);
    expect(project?.projectMetrics.avgMethodsPerClass).toBe(result?.methods.length);
  });

  it('rebuilds ProjectGraph conformance after deletion and keeps facts when parsing is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-graph-relations-'));
    try {
      writeFileSync(join(root, 'P.swift'), 'protocol P { func work() }');
      writeFileSync(join(root, 'A.swift'), 'class A: P { func work() {} }');
      writeFileSync(join(root, 'B.swift'), 'class B: P { func work() {} }');
      const graph = await ProjectGraph.build(root, { extensions: ['.swift'] });
      expect(graph.getProtocolInfo('P').conformers).toEqual(['A', 'B']);
      rmSync(join(root, 'A.swift'));
      await graph.incrementalUpdate([], ['A.swift']);
      expect(graph.getProtocolInfo('P').conformers).toEqual(['B']);
      await graph.incrementalUpdate([join(root, 'B.swift')], [], {
        extensionToLang: { '.swift': 'not-a-registered-language' },
      });
      expect(graph.getClassInfo('B')).not.toBeNull();
      expect(graph.getProtocolInfo('P').conformers).toEqual(['B']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes only the changed ProjectGraph file contributions to shared categories and methods', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-graph-sources-'));
    try {
      writeFileSync(join(root, 'FooOne.h'), '@interface Foo (One)\n- (void)one;\n@end');
      writeFileSync(join(root, 'FooTwo.h'), '@interface Foo (Two)\n- (void)two;\n@end');
      writeFileSync(join(root, 'Foo.m'), '@implementation Foo\n- (void)oldMethod {}\n@end');
      const graph = await ProjectGraph.build(root, { extensions: ['.h', '.m'] });
      rmSync(join(root, 'FooOne.h'));
      await graph.incrementalUpdate([], ['FooOne.h']);
      expect(graph.getCategoryExtensions('Foo').map((item) => item.categoryName)).toEqual(['Two']);
      writeFileSync(join(root, 'Foo.m'), '@implementation Foo\n- (void)newMethod {}\n@end');
      await graph.incrementalUpdate([join(root, 'Foo.m')]);
      expect(
        graph
          .getClassMethods('Foo')
          .map((item) => item.name)
          .sort()
      ).toEqual(['newMethod', 'two']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['typescript', 'javascript'])('keeps expression-arrow call sites for %s', (language) => {
    const block = analyzeFile('export const run = () => { return helper(); };', language);
    const expression = analyzeFile('export const run = () => helper();', language);
    expect(block?.callSites).toContainEqual(
      expect.objectContaining({ callee: 'helper', callerMethod: 'run' })
    );
    expect(expression?.callSites).toEqual(block?.callSites);
  });

  it('resolves NodeNext JavaScript specifiers to TypeScript without overriding real JavaScript', async () => {
    const summary = analyzeProject(
      [
        {
          content: "import { helper } from './util.js'; export function run() { return helper(); }",
          name: 'main.ts',
          relativePath: 'src/main.ts',
        },
        {
          content: 'export function helper() { return 1; }',
          name: 'util.ts',
          relativePath: 'src/util.ts',
        },
        {
          // 同名函数使全局唯一匹配无法掩盖 import 解析失败。
          content: 'export function helper() { return 2; }',
          name: 'other.ts',
          relativePath: 'src/other.ts',
        },
      ],
      'typescript'
    );
    const result = await new CallGraphAnalyzer('/project').analyze(summary);
    expect(result.callEdges).toContainEqual(
      expect.objectContaining({
        caller: 'src/main.ts::run',
        callee: 'src/util.ts::helper',
        resolveMethod: 'direct',
      })
    );
    const sourceFirst = new ImportPathResolver('/project', ['src/util.tsx', 'src/util.ts']);
    expect(sourceFirst.resolve('./util.js', 'src/main.ts')).toBe('src/util.tsx');
    const withJavaScript = new ImportPathResolver('/project', ['src/util.ts', 'src/util.js']);
    expect(withJavaScript.resolve('./util.js', 'src/main.ts')).toBe('src/util.js');
    expect(withJavaScript.resolve('./util', 'src/main.ts')).toBe('src/util.ts');
  });

  it('aggregates classes, cross-file inheritance, and metrics across TypeScript files', () => {
    expect(isAvailable()).toBe(true);

    const result = analyzeProject(
      [
        {
          content: 'export class Base { foo(): void {} }',
          name: 'Base.ts',
          relativePath: 'src/Base.ts',
        },
        {
          content:
            'import { Base } from "./Base";\nexport class Derived extends Base { bar(): void {} baz(): void {} }',
          name: 'Derived.ts',
          relativePath: 'src/Derived.ts',
        },
      ],
      'typescript'
    );

    expect(result.fileCount).toBe(2);
    // Classes from BOTH files are aggregated.
    expect(result.classes.map((cls) => cls.name).sort()).toEqual(['Base', 'Derived']);
    expect(result.classes.find((cls) => cls.name === 'Derived')?.superclass).toBe('Base');
    // Inheritance edge spans the two files.
    expect(result.inheritanceGraph).toContainEqual({
      from: 'Derived',
      to: 'Base',
      type: 'inherits',
    });
    // Aggregated project metrics.
    expect(result.projectMetrics.totalClasses).toBe(2);
    expect(result.projectMetrics.totalMethods).toBe(3);
    expect(result.fileSummaries).toHaveLength(2);
    expect(typeof result.patternStats).toBe('object');
  });

  it('prioritizes root-relative source directories when call analysis is sampled', async () => {
    const files = Array.from({ length: 500 }, (_, i) => ({
      content: 'function helper() {} export function run() { helper(); }',
      name: `fixture-${i}.ts`,
      relativePath: `test/fixture-${i}.ts`,
    }));
    files.push({
      content: 'function critical() {} export function run() { critical(); }',
      name: 'critical.ts',
      relativePath: 'src/critical.ts',
    });
    const summary = analyzeProject(files, 'typescript');
    const result = await new CallGraphAnalyzer('/project').analyze(summary);
    expect(result.stats.tier).toBe('sampled');
    expect(result.stats.filesProcessed).toBe(500);
    expect(result.callEdges.some((edge) => edge.file === 'src/critical.ts')).toBe(true);
  });

  it('aggregates structs and interfaces across Go files', () => {
    const result = analyzeProject(
      [
        {
          content:
            'package demo\n\ntype Engine struct { addr string }\n\nfunc (e *Engine) Run() {}\n',
          name: 'engine.go',
          relativePath: 'engine.go',
        },
        {
          content:
            'package demo\n\ntype Handler interface { Serve() }\n\ntype Router struct {}\n\nfunc (r *Router) Add() {}\n',
          name: 'router.go',
          relativePath: 'router.go',
        },
      ],
      'go'
    );

    expect(result.fileCount).toBe(2);
    expect(result.classes.map((cls) => cls.name).sort()).toEqual(['Engine', 'Router']);
    expect(result.protocols.map((proto) => proto.name)).toContain('Handler');
    expect(result.projectMetrics.totalClasses).toBe(2);
    expect(result.fileSummaries).toHaveLength(2);
  });

  it('degrades gracefully for a language with no AST plugin (was the Ruby case)', () => {
    // Single-file analysis returns null (no plugin) rather than throwing.
    expect(analyzeFile('puts "hi"', 'ruby')).toBeNull();
    // Multi-file analysis skips unsupported files and yields an empty aggregation.
    const result = analyzeProject(
      [{ content: 'puts "hi"', name: 'app.rb', relativePath: 'app.rb' }],
      'ruby'
    );
    expect(result.fileCount).toBe(0);
    expect(result.classes).toEqual([]);
    expect(result.fileSummaries).toEqual([]);
  });
});

describe('built-in project discoverers (RIC-4b — was RealProjectDiscovery/Bootstrap/GoSupport)', () => {
  const tmpDirs: string[] = [];

  afterAll(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
    resetDiscovererRegistry();
  });

  function makeProject(prefix: string, files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), `ric4b-${prefix}-`));
    tmpDirs.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
      const absolute = join(root, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    return root;
  }

  async function inspectDiscovery(discoverer: ProjectDiscoverer, root: string) {
    const detection = await discoverer.detect(root);
    await discoverer.load(root);
    const targets = await discoverer.listTargets();
    const files = [];
    for (const target of targets) {
      files.push({ target: target.name, files: await discoverer.getTargetFiles(target) });
    }
    return { detection, targets, files, graph: await discoverer.getDependencyGraph() };
  }

  async function captureAndReplayDiscovery(
    root: string,
    create: (reader: ProjectSourceReader) => ProjectDiscoverer
  ) {
    const roots = [{ id: 'fixture', path: root }];
    const recorder = new RecordingProjectSourceReader(roots);
    const discoverer = create(recorder);
    expect(discoverer.supportsSourceReader).toBe(true);
    const result = await inspectDiscovery(discoverer, root);
    recorder.assertComplete();
    const snapshot = await recorder.snapshot();
    // 真目录删除后必须仅靠输入记录完成同一流程，不能把捕获缺口当成空结果。
    rmSync(root, { recursive: true, force: true });
    const replay = new ReplayProjectSourceReader(snapshot, roots);
    expect(await inspectDiscovery(create(replay), root)).toEqual(result);
    replay.assertComplete();
    return { result, snapshot };
  }

  it.each([
    'npm',
    'pnpm',
    'lerna',
  ] as const)('reads %s workspace manifests, empty directories and marker existence through its reader', async (workspaceKind) => {
    const root = makeProject(`node-reader-${workspaceKind}`, {
      'package.json': JSON.stringify({
        name: 'workspace',
        ...(workspaceKind === 'npm' ? { workspaces: { packages: ['packages/*'] } } : {}),
      }),
      'tsconfig.json': '{}',
      ...(workspaceKind === 'pnpm'
        ? { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" }
        : {}),
      ...(workspaceKind === 'lerna' ? { 'lerna.json': '{"packages":["packages/*"]}' } : {}),
      'packages/app/package.json': '{"name":"app","dependencies":{"lib":"workspace:*"}}',
      'packages/app/src/index.ts': 'export const app = 1;',
      'packages/lib/package.json': '{"name":"lib"}',
      'packages/lib/lib.ts': 'export const lib = 1;',
    });
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 'packages/empty'));
    const { result, snapshot } = await captureAndReplayDiscovery(
      root,
      (reader) => new NodeDiscoverer(reader)
    );
    const reads = new Set(
      snapshot.observations.map((entry) => `${entry.operation}:${entry.path.relativePath}`)
    );
    expect(result.detection.confidence).toBe(1);
    expect(result.targets.map((target) => target.name).sort()).toEqual(['app', 'empty', 'lib']);
    expect(result.files.find((entry) => entry.target === 'empty')?.files).toEqual([]);
    expect(result.files.find((entry) => entry.target === 'app')?.files).toMatchObject([
      { relativePath: 'src/index.ts', language: 'typescript' },
    ]);
    expect(result.graph.edges).toEqual([{ from: 'app', to: 'lib', type: 'depends_on' }]);
    expect([...reads]).toEqual(
      expect.arrayContaining([
        'file:package.json',
        'file:packages/app/package.json',
        'file:packages/lib/package.json',
        'stat:node_modules',
        'stat:packages/empty',
        'directory:packages',
        'directory:packages/empty',
      ])
    );
    if (workspaceKind !== 'npm') {
      expect(
        reads.has(`file:${workspaceKind === 'pnpm' ? 'pnpm-workspace.yaml' : 'lerna.json'}`)
      ).toBe(true);
    }
  });

  it('reads SPM packages, explicit target paths and local dependency names through its reader', async () => {
    const root = makeProject('spm-reader', {
      'Package.swift':
        'import PackageDescription\nlet package = Package(name: "AppPackage", dependencies: [.package(path: "Local")], targets: [.target(name: "App", dependencies: ["Shared"], path: "CustomSources")])',
      'CustomSources/App.swift': 'public struct App {}',
      'Local/Package.swift':
        'import PackageDescription\nlet package = Package(name: "LocalPackage", targets: [.target(name: "Shared")])',
      'Local/Sources/Shared/Shared.swift': 'public struct Shared {}',
    });
    const { result, snapshot } = await captureAndReplayDiscovery(
      root,
      (reader) => new SpmDiscoverer(reader)
    );
    expect(result.detection.confidence).toBe(0.95);
    expect(result.files.find((entry) => entry.target === 'App')?.files).toMatchObject([
      { relativePath: 'App.swift', language: 'swift' },
    ]);
    expect(result.files.find((entry) => entry.target === 'Shared')?.files).toMatchObject([
      { relativePath: 'Shared.swift', language: 'swift' },
    ]);
    expect(result.graph.edges).toContainEqual({
      from: 'AppPackage',
      to: 'LocalPackage',
      type: 'depends_on',
    });
    expect(
      snapshot.observations
        .filter((entry) => entry.operation === 'file')
        .map((entry) => entry.path.relativePath)
    ).toEqual(expect.arrayContaining(['Package.swift', 'Local/Package.swift']));
  });

  it('reads Generic source and empty target directories through its reader', async () => {
    const root = makeProject('generic-reader', {
      'src/main.ts': 'export const value = 1;',
      'node_modules/ignored/main.py': 'print("ignored")',
    });
    mkdirSync(join(root, 'tests'));
    const { result, snapshot } = await captureAndReplayDiscovery(
      root,
      (reader) => new GenericDiscoverer(reader)
    );
    expect(result.targets).toMatchObject([
      { name: 'src', language: 'typescript' },
      { name: 'tests', language: 'typescript', type: 'test' },
    ]);
    expect(result.files).toMatchObject([
      { target: 'src', files: [{ relativePath: 'main.ts' }] },
      { target: 'tests', files: [] },
    ]);
    expect(
      snapshot.observations
        .filter((entry) => entry.operation === 'directory')
        .map((entry) => entry.path.relativePath)
    ).toEqual(['.', 'src', 'tests']);
  });

  it('keeps Node marker probes sequential and stops after the first Ruby marker', async () => {
    const root = makeProject('node-marker-order', {
      'package.json': '{"name":"tools"}',
      Gemfile: '',
      Rakefile: '',
      'Cargo.toml': '',
    });
    const probes: string[] = [];
    const reader: ProjectSourceReader = {
      ...nodeProjectSourceReader,
      async stat(file, options) {
        probes.push(relative(root, file));
        return nodeProjectSourceReader.stat(file, options);
      },
    };
    const result = await new NodeDiscoverer(reader).detect(root);
    expect(result.confidence).toBeCloseTo(0.045);
    expect(probes).toEqual(['package.json', 'tsconfig.json', 'node_modules', 'Gemfile']);
  });

  it('keeps the SPM file count and size budgets when replaying stat observations', async () => {
    const root = makeProject('spm-file-budget', {
      'Package.swift':
        'import PackageDescription\nlet package = Package(name: "Budget", targets: [.target(name: "Budget")])',
      'Sources/Budget/000-too-large.swift': 'x'.repeat(512 * 1024 + 1),
      'Sources/Budget/.hidden.swift': 'struct Hidden {}',
      'Sources/Budget/build/Ignored.swift': 'struct Ignored {}',
      ...Object.fromEntries(
        Array.from({ length: 301 }, (_, index) => [
          `Sources/Budget/File${String(index).padStart(3, '0')}.swift`,
          `struct File${index} {}`,
        ])
      ),
    });
    const { result } = await captureAndReplayDiscovery(root, (reader) => new SpmDiscoverer(reader));
    expect(result.files[0].files.map((file) => file.name)).toEqual(
      Array.from({ length: 300 }, (_, index) => `File${String(index).padStart(3, '0')}.swift`)
    );
  });

  it('preserves Generic cancellation after an awaited directory read', async () => {
    const root = makeProject('generic-reader-cancel', { 'src/main.ts': 'export const value = 1;' });
    const controller = new AbortController();
    const reader: ProjectSourceReader = {
      ...nodeProjectSourceReader,
      async readDirectory(directory, options) {
        const entries = await nodeProjectSourceReader.readDirectory(directory, options);
        controller.abort(new Error('cancel directory scan'));
        return entries;
      },
    };
    await expect(
      new GenericDiscoverer(reader).load(root, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'cancel directory scan' });
  });

  interface DiscovererCase {
    id: string;
    language: string;
    files: Record<string, string>;
  }

  const cases: DiscovererCase[] = [
    {
      files: {
        'Package.swift':
          '// swift-tools-version:5.7\nimport PackageDescription\nlet package = Package(name: "Demo", targets: [.target(name: "Demo")])\n',
        'Sources/Demo/Demo.swift': 'public struct Demo {}\n',
      },
      id: 'spm',
      language: 'swift',
    },
    {
      files: {
        'package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
        'src/index.ts': 'export const x = 1;\n',
      },
      id: 'node',
      language: 'typescript',
    },
    {
      files: {
        'app/main.py': 'def f():\n    pass\n',
        'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
      },
      id: 'python',
      language: 'python',
    },
    {
      files: {
        'app/build.gradle': 'plugins { id "java" }\n',
        'app/src/main/java/App.java': 'public class App {}\n',
        'build.gradle': 'plugins { id "java" }\n',
        'settings.gradle': "rootProject.name = 'demo'\ninclude ':app'\n",
      },
      id: 'jvm',
      language: 'java',
    },
    {
      files: {
        'go.mod': 'module demo\n\ngo 1.21\n',
        'main.go': 'package main\n\nfunc main() {}\n',
      },
      id: 'go',
      language: 'go',
    },
    {
      files: {
        'Cargo.toml': '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n',
        'src/main.rs': 'fn main() {}\n',
      },
      id: 'rust',
      language: 'rust',
    },
    {
      files: {
        'README.md': '# demo\n',
        'src/util.ts': 'export const u = 1;\n',
      },
      id: 'generic',
      language: 'typescript',
    },
  ];

  it('resets the fallback language when a discoverer instance loads another project', async () => {
    resetDiscovererRegistry();
    const generic = getDiscovererRegistry()
      .getAll()
      .find((item) => item.id === 'generic')!;
    await generic.load(makeProject('typed-project', { 'main.ts': 'export class Main {}' }));
    expect((await generic.listTargets())[0].language).toBe('typescript');
    await generic.load(makeProject('empty-project', {}));
    expect((await generic.listTargets())[0].language).toBe('unknown');
  });

  it.each([
    "include ':a', ':b', ':c'",
    'include(":a", ":b", ":c")',
  ])('keeps every JVM module declared by %s', async (settings) => {
    resetDiscovererRegistry();
    const root = makeProject('jvm-three', {
      'build.gradle': 'plugins { id "java" }',
      'settings.gradle': settings,
      'a/build.gradle': '',
      'b/build.gradle': '',
      'c/build.gradle': '',
    });
    const discoverer = await getDiscovererRegistry().detect(root);
    await discoverer.load(root);
    expect((await discoverer.listTargets()).map((target) => target.name)).toEqual(['a', 'b', 'c']);
  });

  it('reads standard SPM test sources and projects literal target dependencies', async () => {
    resetDiscovererRegistry();
    const root = makeProject('spm-standard', {
      'Package.swift':
        'import PackageDescription\nlet package = Package(name: "Demo", targets: [.target(name: "Core"), .target(name: "App", dependencies: ["Core", .product(name: "Remote", package: "RemotePackage"), makeDependency("ghost-first", "ghost-middle", "ghost-last")]), .testTarget(name: "AppTests", dependencies: ["App"])])',
      'Sources/Core/A.swift': 'class A {}',
      'Sources/App/B.swift': 'class B {}',
      'Tests/AppTests/T.swift': 'class T {}',
    });
    const discoverer = await getDiscovererRegistry().detect(root);
    await discoverer.load(root);
    const testTarget = (await discoverer.listTargets()).find(
      (target) => target.name === 'AppTests'
    )!;
    expect((await discoverer.getTargetFiles(testTarget)).map((file) => file.name)).toEqual([
      'T.swift',
    ]);
    const dependencies = (await discoverer.getDependencyGraph()).edges.filter(
      (edge) => edge.type === 'depends_on'
    );
    expect(dependencies).toEqual([
      { from: 'App', to: 'Core', type: 'depends_on' },
      { from: 'App', to: 'Remote', type: 'depends_on' },
      { from: 'AppTests', to: 'App', type: 'depends_on' },
    ]);
  });

  it.each([
    {
      system: 'bazel',
      target: 'app',
      source: 'app.cc',
      files: {
        'MODULE.bazel': '',
        'BUILD.bazel':
          'cc_library(\n name = "core",\n srcs = ["core.cc"],\n)\ncc_binary(\n name = "app",\n srcs = ["app.cc"],\n deps = [":core", "//missing:unknown"],\n)',
        'core.cc': 'void f() {}',
        'app.cc': 'int main() {}',
      },
      edges: [{ from: 'app', to: 'core', type: 'depends_on' }],
    },
    {
      system: 'gradle-convention',
      target: ':app',
      source: 'App.kt',
      files: {
        'build-logic/convention/marker.txt': '',
        'settings.gradle.kts': 'include(":app", ":core")',
        'app/build.gradle.kts':
          'dependencies { implementation(project(":core")); implementation(project(":missing")) }',
        'app/App.kt': 'class App',
        'core/build.gradle.kts': '',
      },
      edges: [{ from: ':app', to: ':core', type: 'depends_on', configuration: 'implementation' }],
    },
    {
      system: 'cmake',
      target: 'app',
      source: 'app.cc',
      files: {
        'CMakeLists.txt':
          'project(Demo)\nadd_library(core STATIC core.cc)\nadd_library(extra STATIC extra.cc)\nadd_executable(app app.cc)\ntarget_link_libraries(app PUBLIC core)\ntarget_link_libraries(app PRIVATE extra)\ntarget_link_libraries(core PRIVATE missing)',
        'core.cc': '',
        'extra.cc': '',
        'app.cc': 'int main() {}',
      },
      edges: [
        { from: 'app', to: 'core', type: 'depends_on', scope: 'PUBLIC' },
        { from: 'app', to: 'extra', type: 'depends_on', scope: 'PRIVATE' },
      ],
    },
  ])('projects declared $system source paths and known dependencies through the real loader', async (fixture) => {
    resetDiscovererRegistry();
    const root = makeProject(fixture.system, fixture.files);
    const discoverer = getDiscovererRegistry()
      .getAll()
      .find((item) => item.id === 'customConfig')!;
    expect((await discoverer.detect(root)).match).toBe(true);
    await discoverer.load(root);
    const target = (await discoverer.listTargets()).find((item) => item.name === fixture.target)!;
    expect((await discoverer.getTargetFiles(target)).map((file) => file.name)).toContain(
      fixture.source
    );
    expect((await discoverer.getDependencyGraph()).edges).toEqual(fixture.edges);
    await discoverer.load(makeProject(`${fixture.system}-empty`, {}));
    expect((await discoverer.getDependencyGraph()).edges).toEqual([]);
  });

  for (const testCase of cases) {
    it(`detects, enumerates, and graphs a ${testCase.id} project`, async () => {
      resetDiscovererRegistry();
      const root = makeProject(testCase.id, testCase.files);
      const registry = getDiscovererRegistry();

      // detect() auto-selects the right discoverer for the project layout.
      const discoverer = await registry.detect(root);
      expect(discoverer.id).toBe(testCase.id);

      await discoverer.load(root);

      const targets = await discoverer.listTargets();
      expect(targets.length).toBeGreaterThanOrEqual(1);
      const [target] = targets;
      if (!target) {
        throw new Error(`${testCase.id}: expected at least one target`);
      }

      // getTargetFiles() enumerates source files with correct language tagging.
      const targetFiles = await discoverer.getTargetFiles(target);
      expect(targetFiles.length).toBeGreaterThanOrEqual(1);
      expect(targetFiles.some((file) => file.language === testCase.language)).toBe(true);

      // getDependencyGraph() returns a structurally valid graph (no throw).
      const graph = await discoverer.getDependencyGraph();
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(graph.edges)).toBe(true);
    });
  }
});

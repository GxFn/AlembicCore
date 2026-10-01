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
import { analyzeFile, isAvailable, parseToTree } from '../src/core/AstAnalyzer.js';
import { ImportPathResolver } from '../src/core/analysis/ImportPathResolver.js';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import {
  type CallSiteInfo,
  extractCallSitesTS,
} from '../src/core/ast/extract/CallSiteExtractor.js';
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

describe('multi-file AST analysis (RIC-4b — was RealProjectAst/GoSupport)', () => {
  it('assigns nested named function calls to the actual inner owner', () => {
    const source =
      'function outer() { function inner() { target(); } inner(); register(() => later()); }';
    const { callSites } = callEvidence(source);
    expect(callSites.find((call) => call.callee === 'target')).toMatchObject({
      callerMethod: 'inner',
      callerClass: null,
      callerQualifiedName: 'outer.inner',
      callerRange: {
        startLine: 1,
        startColumn: source.indexOf('function inner'),
        endLine: 1,
        endColumn: source.indexOf('} inner') + 1,
      },
    });
    expect(callSites.find((call) => call.callee === 'inner')).toMatchObject({
      callerMethod: 'outer',
      callerQualifiedName: 'outer',
    });
    expect(callSites.find((call) => call.callee === 'later')).toMatchObject({
      callerMethod: '<anonymous>',
      callerQualifiedName: 'outer.<anonymous>',
    });
  });

  it('walks callee chains and arguments exactly once with actual expression ranges', () => {
    const source = 'function run() { factory().send(inner()); foo().foo(); }';
    const { callSites } = callEvidence(source);
    expect(callSites.map((call) => call.calleeExpression)).toEqual([
      'factory().send',
      'factory',
      'inner',
      'foo().foo',
      'foo',
    ]);
    expect(callSites).toHaveLength(5);
    const callsAtFactory = callSites.filter(
      (call) => call.matchingRange?.startColumn === source.indexOf('factory')
    );
    expect(callsAtFactory.map((call) => call.matchingRange?.endColumn)).toEqual([
      source.indexOf(';'),
      source.indexOf('factory') + 'factory()'.length,
    ]);
    expect(callSites.filter((call) => call.calleeExpression === 'factory')).toHaveLength(1);
  });

  it('keeps await through parentheses and counts syntax arguments without comments', () => {
    const { callSites } = callEvidence(
      'async function run() { await (send(/* note */ inner(), ...rest)); }'
    );
    expect(callSites.find((call) => call.callee === 'send')).toMatchObject({
      isAwait: true,
      argCount: 2,
    });
    expect(callSites.find((call) => call.callee === 'inner')).toMatchObject({
      isAwait: false,
      argCount: 0,
    });
  });

  it.each([
    { expression: '(helper)', callee: 'helper', receiver: null, callType: 'function' },
    { expression: '(client.send)', callee: 'send', receiver: 'client', callType: 'method' },
  ])('unwraps the actual parenthesized callee $expression without rewriting its expression evidence', ({
    expression,
    callee,
    receiver,
    callType,
  }) => {
    const source = `function run() { ${expression}(1); }`;
    const { callSites } = callEvidence(source);
    expect(callSites).toHaveLength(1);
    expect(callSites[0]).toMatchObject({
      callee,
      receiver,
      callType,
      calleeExpression: expression,
      argCount: 1,
    });
  });

  it('records receiver syntax from literal AST nodes without claiming a project target', () => {
    const { callSites } = callEvidence('function run() { ["x"].includes("x"); /x/.test("x"); }');
    expect(callSites).toMatchObject([
      { callee: 'includes', receiver: '["x"]', receiverSyntax: 'array' },
      { callee: 'test', receiver: '/x/', receiverSyntax: 'regex' },
    ]);
    expect(callSites.every((call) => call.calleeQualifiedName === undefined)).toBe(true);
  });

  it('records top-level and class-arrow calls with real program and declaration owners', () => {
    const source =
      'bootstrap();\nconst run = () => top();\nclass Service { field = () => member(); run() { inside(); } }\n';
    const { callSites } = callEvidence(source);
    expect(callSites.map((call) => call.callee)).toEqual(['bootstrap', 'top', 'member', 'inside']);
    expect(callSites[0]).toMatchObject({
      callerMethod: '<module>',
      callerClass: null,
      callerQualifiedName: '<module>',
      callerRange: { startLine: 1, startColumn: 0, endLine: 4, endColumn: 0 },
    });
    expect(callSites.find((call) => call.callee === 'member')).toMatchObject({
      callerMethod: 'field',
      callerClass: 'Service',
      callerQualifiedName: 'Service.field',
      callerRange: { startLine: 3, startColumn: 16 },
    });
  });

  it('keeps same-line owners and UTF16 positions distinct across CRLF text', () => {
    const source = '/* 汉😀 */ class A { run() { first(); } } class B { run() { second(); } }\r\n';
    const { callSites } = callEvidence(source);
    expect(callSites.map((call) => call.callerQualifiedName)).toEqual(['A.run', 'B.run']);
    for (const [index, callee] of ['first', 'second'].entries()) {
      const startColumn = source.indexOf(`${callee}()`);
      expect(callSites[index]).toMatchObject({
        callee,
        callerMethod: 'run',
        argCount: 0,
        isAwait: false,
        syntaxKind: 'call',
        matchingRange: {
          startLine: 1,
          startColumn,
          endLine: 1,
          endColumn: startColumn + callee.length + 2,
        },
      });
      expect(startColumn).not.toBe(Buffer.byteLength(source.slice(0, startColumn)));
    }
  });

  it('retains noise and JSX syntax evidence while keeping the existing filtered call list', () => {
    const source = 'function View() { console.log(1); return <Widget value={load()} />; }';
    const result = callEvidence(source, 'tsx');
    expect(result.callSites.map((call) => call.callee)).toEqual(['Widget', 'load']);
    expect(result.legacyCallSites.map((call) => call.callee)).toEqual(['Widget', 'load']);
    expect(Object.keys(result.legacyCallSites[0]).sort()).toEqual([
      'argCount',
      'callType',
      'callee',
      'callerClass',
      'callerMethod',
      'isAwait',
      'line',
      'receiver',
      'receiverType',
    ]);
    expect(result.callSiteEvidence).toHaveLength(3);
    expect(result.callSiteEvidence[0]).toMatchObject({
      callee: 'log',
      receiver: 'console',
      syntaxKind: 'call',
      omissionReason: 'noise-receiver',
    });
    expect(result.callSiteEvidence[1]).toMatchObject({
      callee: 'Widget',
      syntaxKind: 'jsx',
      callType: 'constructor',
      argCount: 1,
      calleeExpression: 'Widget',
    });
    expect(result.callSiteEvidence[1].matchingRange?.startColumn).toBe(source.indexOf('<Widget'));
  });

  it('proves parameter shadowing and exact nested lexical function bindings', () => {
    const source =
      'function target() {} function run(target) { target(); } function outer() { function target() {} target(); }';
    const { callSites } = callEvidence(source);
    expect(callSites.find((call) => call.callerMethod === 'run')).toMatchObject({
      callee: 'target',
      calleeShadowed: true,
    });
    expect(
      callSites.find((call) => call.callerMethod === 'run')?.calleeQualifiedName
    ).toBeUndefined();
    expect(callSites.find((call) => call.callerMethod === 'outer')).toMatchObject({
      callee: 'target',
      calleeQualifiedName: 'outer.target',
      calleeBindingRange: { startLine: 1, startColumn: source.lastIndexOf('function target') },
    });
  });

  it('keeps block bindings local and does not resolve a parameter receiver as a global class', () => {
    const source =
      'class Service { static run() {} }\nfunction use(Service) { Service.run(); }\nfunction local() { { let target; target(); } target(); }\nfunction target() {}';
    const { callSites } = callEvidence(source);
    expect(callSites.find((call) => call.callerMethod === 'use')).toMatchObject({
      callee: 'run',
      receiver: 'Service',
      calleeShadowed: true,
    });
    const targets = callSites.filter((call) => call.callee === 'target');
    expect(targets[0]).toMatchObject({ calleeShadowed: true });
    expect(targets[1]).toMatchObject({ calleeQualifiedName: 'target' });
  });

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
  });

  it.each(['typescript', 'javascript'])('keeps expression-arrow call sites for %s', (language) => {
    const block = analyzeFile('export const run = () => { return helper(); };', language);
    const expression = analyzeFile('export const run = () => helper();', language);
    expect(block?.callSites).toContainEqual(
      expect.objectContaining({ callee: 'helper', callerMethod: 'run' })
    );
    expect(expression?.callSites).toEqual(block?.callSites);
  });

  it('resolves NodeNext JavaScript specifiers to TypeScript without overriding real JavaScript', () => {
    const sourceFirst = new ImportPathResolver('/project', ['src/util.tsx', 'src/util.ts']);
    expect(sourceFirst.resolve('./util.js', 'src/main.ts')).toBe('src/util.tsx');
    const withJavaScript = new ImportPathResolver('/project', ['src/util.ts', 'src/util.js']);
    expect(withJavaScript.resolve('./util.js', 'src/main.ts')).toBe('src/util.js');
    expect(withJavaScript.resolve('./util', 'src/main.ts')).toBe('src/util.ts');
  });

  it('keeps per-file classes, inheritance edges, and metrics across TypeScript files', () => {
    expect(isAvailable()).toBe(true);

    const base = analyzeFile('export class Base { foo(): void {} }', 'typescript');
    const derived = analyzeFile(
      'import { Base } from "./Base";\nexport class Derived extends Base { bar(): void {} baz(): void {} }',
      'typescript'
    );

    expect(base?.classes.map((cls) => cls.name)).toEqual(['Base']);
    expect(derived?.classes.map((cls) => cls.name)).toEqual(['Derived']);
    expect(derived?.classes[0]?.superclass).toBe('Base');
    // 继承边由声明所在文件给出；跨文件汇总属于索引层，不再由 AST 层聚合。
    expect(derived?.inheritanceGraph).toContainEqual({
      from: 'Derived',
      to: 'Base',
      type: 'inherits',
    });
    expect(base?.metrics.methodCount).toBe(1);
    expect(derived?.metrics.methodCount).toBe(2);
  });

  it('extracts structs and interfaces from each Go file', () => {
    const engine = analyzeFile(
      'package demo\n\ntype Engine struct { addr string }\n\nfunc (e *Engine) Run() {}\n',
      'go'
    );
    const router = analyzeFile(
      'package demo\n\ntype Handler interface { Serve() }\n\ntype Router struct {}\n\nfunc (r *Router) Add() {}\n',
      'go'
    );

    expect(engine?.classes.map((cls) => cls.name)).toEqual(['Engine']);
    expect(router?.classes.map((cls) => cls.name)).toEqual(['Router']);
    expect(router?.protocols.map((proto) => proto.name)).toContain('Handler');
  });

  it('degrades gracefully for a language with no AST plugin (was the Ruby case)', () => {
    // Single-file analysis returns null (no plugin) rather than throwing.
    expect(analyzeFile('puts "hi"', 'ruby')).toBeNull();
  });
});

function callEvidence(source: string, language = 'typescript') {
  const parsed = parseToTree(source, language);
  if (!parsed) {
    throw new Error(`grammar unavailable: ${language}`);
  }
  const context: { callSites: CallSiteInfo[]; callSiteEvidence: CallSiteInfo[] } = {
    callSites: [],
    callSiteEvidence: [],
  };
  try {
    extractCallSitesTS(parsed.rootNode, context, language);
    return {
      callSites: context.callSiteEvidence.filter((call) => !call.omissionReason),
      callSiteEvidence: context.callSiteEvidence,
      legacyCallSites: context.callSites,
    };
  } finally {
    parsed.tree.delete();
  }
}

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

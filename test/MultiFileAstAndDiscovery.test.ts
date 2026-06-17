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
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeFile, analyzeProject, isAvailable } from '../src/core/AstAnalyzer.js';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import { getDiscovererRegistry, resetDiscovererRegistry } from '../src/core/discovery/index.js';

beforeAll(async () => {
  // Load the packaged tree-sitter WASM grammars before AST analysis (mirrors the
  // shim's loadProjectAstPlugins() beforeAll in the Alembic RealProjectAst tests).
  await reloadPlugins();
});

describe('multi-file analyzeProject aggregation (RIC-4b — was RealProjectAst/GoSupport)', () => {
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

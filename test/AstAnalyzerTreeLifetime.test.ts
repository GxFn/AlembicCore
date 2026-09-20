import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Parser, Tree } from 'web-tree-sitter';
import {
  _resetAstParserCacheForTesting,
  analyzeFile,
  findCallExpressions,
  findPatternInContext,
  parseToTree,
  registerLanguage,
} from '../src/core/AstAnalyzer.js';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import { plugin as typescriptPlugin } from '../src/core/ast/lang-typescript.js';
import { chunkByAST, ensureParser } from '../src/infrastructure/vector/ASTChunker.js';

beforeAll(async () => {
  await reloadPlugins();
  await ensureParser();
});

afterEach(async () => {
  vi.restoreAllMocks();
  _resetAstParserCacheForTesting();
  await reloadPlugins();
});

describe('AstAnalyzer web-tree-sitter Tree lifetime', () => {
  it('releases replaced and reset parsers while returned Trees remain owned by their callers', () => {
    _resetAstParserCacheForTesting();
    const bind = vi.spyOn(Parser.prototype, 'setLanguage');
    const dispose = vi.spyOn(Parser.prototype, 'delete');
    const source = 'export class Held { run(): void {} }';
    const held = parseToTree(source, 'typescript');
    expect(held).not.toBeNull();
    const originalParser = bind.mock.contexts[0];
    analyzeFile('export class JavaScript {}', 'javascript');
    const otherParser = bind.mock.contexts[1];
    try {
      registerLanguage('typescript', {
        ...typescriptPlugin,
        walk: (root, ctx) => {
          typescriptPlugin.walk(root, ctx);
          ctx.classes.push({ name: 'ReplacementPlugin' });
        },
      });
      expect(dispose.mock.contexts).toEqual([originalParser]);
      expect(held?.rootNode.text).toBe(source);
      expect(analyzeFile('export class Updated {}', 'typescript')?.classes).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'ReplacementPlugin' })])
      );
      const replacementParser = bind.mock.contexts[2];
      _resetAstParserCacheForTesting();
      expect(dispose.mock.contexts).toEqual([originalParser, otherParser, replacementParser]);
      _resetAstParserCacheForTesting();
      expect(dispose).toHaveBeenCalledTimes(3);
      expect(held?.rootNode.text).toBe(source);
    } finally {
      held?.tree.delete();
      _resetAstParserCacheForTesting();
    }
  });

  it('releases a constructed parser if grammar binding fails and can retry after repair', () => {
    _resetAstParserCacheForTesting();
    const dispose = vi.spyOn(Parser.prototype, 'delete');
    registerLanguage('typescript', { ...typescriptPlugin, getGrammar: () => ({ invalid: true }) });
    expect(analyzeFile('export class Invalid {}', 'typescript')).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    registerLanguage('typescript', typescriptPlugin);
    expect(analyzeFile('export class Repaired {}', 'typescript')?.classes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Repaired' })])
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves declarations across repeated production grammar reloads', async () => {
    // 严格生产每个 AST family 都会重载；持续重载不能耗尽 WASM 后把真实声明降级为 null。
    _resetAstParserCacheForTesting();
    const created = vi.spyOn(Parser.prototype, 'setLanguage');
    const deleted = vi.spyOn(Parser.prototype, 'delete');
    for (let iteration = 0; iteration < 140; iteration++) {
      await reloadPlugins();
      const summary = analyzeFile('export class FixtureClass { run(): void {} }', 'typescript');
      expect(
        summary?.classes.map((item) => item.name),
        `reload ${iteration}`
      ).toContain('FixtureClass');
      expect(created.mock.calls.length - deleted.mock.calls.length).toBe(1);
    }
  });

  it('makes a newly registered language available without reinitializing the runtime', () => {
    registerLanguage('fixture-new-language', typescriptPlugin);
    expect(analyzeFile('export class Added {}', 'fixture-new-language')?.classes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Added' })])
    );
  });

  it('deletes the analyzeFile Tree exactly once after every root consumer succeeds', () => {
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');

    const summary = analyzeFile('export class Stable {}', 'typescript');

    expect(summary?.classes.map((item) => item.name)).toContain('Stable');
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });

  it('deletes the analyzeFile Tree exactly once when a language walker throws', () => {
    registerLanguage('typescript', {
      ...typescriptPlugin,
      walk: () => {
        throw new Error('intentional walker failure');
      },
    });
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');

    expect(() => analyzeFile('export class Broken {}', 'typescript')).toThrow(
      'intentional walker failure'
    );
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });

  it('keeps the Tree alive through a tolerated extractor failure, then deletes it once', () => {
    registerLanguage('typescript', {
      ...typescriptPlugin,
      extractCallSites: () => {
        throw new Error('intentional extractor failure');
      },
    });
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');

    const summary = analyzeFile('export function stable() {}', 'typescript');

    expect(summary).not.toBeNull();
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });

  it('deletes Trees owned by the two Guard query helpers', () => {
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');
    const source = 'function run() { service.execute(); }';

    expect(findCallExpressions(source, 'typescript', 'service.execute')).toHaveLength(1);
    expect(findPatternInContext(source, 'typescript', 'execute')).toBeInstanceOf(Array);
    expect(deleteTree).toHaveBeenCalledTimes(2);
  });

  it('deletes a parsed Tree if reading its root fails before ownership transfer', () => {
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');
    vi.spyOn(Tree.prototype, 'rootNode', 'get').mockImplementation(() => {
      throw new Error('intentional root failure');
    });

    expect(parseToTree('export const value = 1;', 'typescript')).toBeNull();
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });

  it('preserves each public fallback when web-tree-sitter returns no Tree', () => {
    vi.spyOn(Parser.prototype, 'parse').mockReturnValue(null);

    expect(analyzeFile('export const value = 1;', 'typescript')).toBeNull();
    expect(parseToTree('export const value = 1;', 'typescript')).toBeNull();
    expect(findCallExpressions('run()', 'typescript', 'run')).toEqual([]);
    expect(findPatternInContext('run()', 'typescript', 'run')).toEqual([]);
  });

  it('lets ASTChunker consume the root before deleting the transferred Tree once', () => {
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');

    const chunks = chunkByAST('export function stable() { return 1; }', 'typescript');

    expect(chunks).not.toBeNull();
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });

  it('deletes the transferred Tree when ASTChunker traversal throws', () => {
    const deleteTree = vi.spyOn(Tree.prototype, 'delete');
    vi.spyOn(Tree.prototype, 'rootNode', 'get').mockReturnValue({
      childCount: 1,
      child: () => {
        throw new Error('intentional chunk traversal failure');
      },
    } as never);

    expect(() => chunkByAST('export function unstable() {}', 'typescript')).toThrow(
      'intentional chunk traversal failure'
    );
    expect(deleteTree).toHaveBeenCalledTimes(1);
  });
});

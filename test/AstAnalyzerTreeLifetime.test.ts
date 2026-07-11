import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Parser, Tree } from 'web-tree-sitter';
import {
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
  await reloadPlugins();
});

describe('AstAnalyzer web-tree-sitter Tree lifetime', () => {
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

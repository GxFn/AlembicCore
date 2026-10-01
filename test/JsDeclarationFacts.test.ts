import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/core/AstAnalyzer.js';
import { loadPlugins } from '../src/core/ast/index.js';
import { extractFileSymbolsFromSource } from '../src/core/facts/fileSymbols.js';

/** 文件符号按"种类 限定名"列出；exported 的在后面带 *。 */
function symbolsOf(filePath: string, text: string): string[] {
  const result = extractFileSymbolsFromSource({
    text,
    filePath,
    lineCount: text.split('\n').length,
  });
  expect(result.unavailableReason).toBeUndefined();
  return result.symbols
    .map(
      (symbol) =>
        `${symbol.kind} ${symbol.qualifiedName ?? symbol.name}${symbol.exported ? ' *' : ''}`
    )
    .sort();
}

describe('JS/TS declaration facts', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  it('lists module-scope variable bindings with their real keyword and export state', () => {
    const source = [
      'export const limit = 10, { first, second: renamed } = pair;',
      'let counter;',
      'var legacy = {};',
      'const local = createStore((set) => ({ run() {} }));',
      'export { local };',
    ].join('\n');

    expect(symbolsOf('src/state.ts', source)).toEqual([
      'variable counter',
      'variable first *',
      'variable legacy',
      'variable limit *',
      'variable local *',
      'variable renamed *',
    ]);
    const result = extractFileSymbolsFromSource({
      text: source,
      filePath: 'src/state.ts',
      lineCount: 5,
    });
    expect(
      Object.fromEntries(result.symbols.map((symbol) => [symbol.name, symbol.declarationKind]))
    ).toEqual({
      limit: 'const',
      first: 'const',
      renamed: 'const',
      counter: 'let',
      legacy: 'var',
      local: 'const',
    });
  });

  it('leaves out bindings that are not declarations of this module', () => {
    const source = [
      "const fs = require('node:fs');",
      'declare const ambient: number;',
      'for (let index = 0; index < 1; index++) {}',
      'function outer() { const inner = 1; return inner; }',
      'if (flag) { const scoped = 1; }',
    ].join('\n');

    // require 绑定是导入；declare、循环变量、函数体与块内的绑定都不在模块作用域。
    expect(symbolsOf('src/scope.ts', source)).toEqual(['function outer']);
  });

  it('treats every function-valued binding as a function, not a variable', () => {
    const source = [
      'export const arrow = () => 1;',
      'const expression = function () {};',
      'const generator = function* () {};',
    ].join('\n');

    for (const filePath of ['src/fn.ts', 'src/fn.js']) {
      expect(symbolsOf(filePath, source)).toEqual([
        'function arrow *',
        'function expression',
        'function generator',
      ]);
    }
  });

  it('lists interface method signatures under the interface, without data-shape properties', () => {
    const source = [
      'export interface Repository extends Base {',
      '  find(id: string): Entity;',
      '  readonly name: string;',
      "  'quoted-key'?: number;",
      '  (): void;',
      '  [key: string]: unknown;',
      '}',
    ].join('\n');

    expect(symbolsOf('src/repo.ts', source)).toEqual([
      'interface Repository *',
      'method Repository.find',
    ]);
  });

  it('names private members by their real #name in TypeScript and JavaScript', () => {
    const source = 'class Cache { #store = 1; #read() { return this.#store; } unknown() {} }';

    for (const filePath of ['src/cache.ts', 'src/cache.js']) {
      expect(symbolsOf(filePath, source)).toEqual([
        'class Cache',
        'method Cache.#read',
        'method Cache.unknown',
        'property Cache.#store',
      ]);
    }
  });

  it('keeps the language summary free of module-level variables', () => {
    const summary = analyzeFile(
      'export const delegate = 1;\nexport class A { b = 2; }',
      'typescript'
    );

    // 摘要里的属性仍然只属于类；顶层变量走独立的声明事实，不触发按属性名的模式检测。
    expect(summary?.properties.map((property) => property.name)).toEqual(['b']);
    expect(summary?.patterns).toEqual([]);
  });

  it('accepts type-level syntax the grammar does not know and still rejects broken structure', () => {
    const valid = (text: string) =>
      extractFileSymbolsFromSource({
        text,
        filePath: 'src/a.ts',
        lineCount: text.split('\n').length,
      }).syntaxValid;

    // `export type * from` 与类型实参里的 import() 类型是合法 TypeScript，只是语法包不认识。
    expect(valid("export type * from './contracts.js';\nexport const a = 1;")).toBe(true);
    expect(valid("export type * as ns from './contracts.js';")).toBe(true);
    expect(valid("export function f(x: Array<import('./types').Item>) { return x; }")).toBe(true);
    // 结构性损坏仍然是语法错误。
    expect(valid('export class Broken {')).toBe(false);
    expect(valid('export function ok() {}\nconst x = ;')).toBe(false);
    expect(valid('export const fine = 1;')).toBe(true);
  });
});

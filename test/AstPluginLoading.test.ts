import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Language, Parser } from 'web-tree-sitter';
import { RESOURCES_DIR } from '../src/shared/packageRoot.js';

const roots: string[] = [];
const grammarRoot = path.join(RESOURCES_DIR, 'grammars');

beforeEach(() => vi.resetModules());
afterEach(async () => {
  vi.restoreAllMocks();
  const { _resetAstParserCacheForTesting } = await import('../src/core/AstAnalyzer.js');
  _resetAstParserCacheForTesting();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function grammarFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ast-grammar-loading-'));
  roots.push(root);
  const file = path.join(root, 'grammar.wasm');
  return { file, relative: path.relative(grammarRoot, file) };
}

describe('AST runtime and plugin loading', () => {
  it('coalesces initialization retries without publishing a constructor before readiness', async () => {
    const runtime = await import('../src/core/ast/parserInit.js');
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const initialize = Parser.init;
    const init = vi
      .spyOn(Parser, 'init')
      .mockRejectedValueOnce(new Error('temporary WASM initialization failure'))
      .mockImplementationOnce(async (...args) => {
        started.resolve();
        await release.promise;
        await initialize.apply(Parser, args);
      });
    await runtime.initParser();
    expect(runtime.isParserReady()).toBe(false);
    expect(runtime.getParserClass()).toBeNull();
    const first = runtime.initParser();
    await started.promise;
    const second = runtime.initParser();
    try {
      await setImmediate();
      expect(init).toHaveBeenCalledTimes(2); // 一次失败，一次由两个调用者共享的重试。
      expect(runtime.isParserReady()).toBe(false);
      expect(runtime.getParserClass()).toBeNull();
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
    expect(runtime.isParserReady()).toBe(true);
    expect(runtime.getParserClass()).toBe(Parser);
  });

  it('waits for registration in every caller and retries an incomplete plugin pass', async () => {
    const ast = await import('../src/core/ast/index.js');
    const runtime = await import('../src/core/ast/parserInit.js');
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const load = vi.spyOn(runtime, 'loadLanguageWasm').mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return null; // 本轮某个 grammar 暂不可用；其它资源仍走真实 loader。
    });
    ast._resetForReload();
    const first = ast.loadPlugins();
    await started.promise;
    let secondCompleted = false;
    const second = ast.loadPlugins().then(() => {
      secondCompleted = true;
    });
    try {
      await setImmediate();
      expect(secondCompleted).toBe(false);
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
    expect(load).toHaveBeenCalledTimes(ast.CORE_GRAMMAR_RESOURCE_FILES.length);
    await ast.loadPlugins();
    expect(load).toHaveBeenCalledTimes(ast.CORE_GRAMMAR_RESOURCE_FILES.length * 2);
    expect(ast.analyzeSourceFile('export class Ready {}', 'typescript')?.classes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Ready' })])
    );
  });

  it('observes a grammar update requested while a previous reload is still registering', async () => {
    const ast = await import('../src/core/ast/index.js');
    const runtime = await import('../src/core/ast/parserInit.js');
    // 先构造旧 grammar 的缓存 parser，后续同一 plugin 对象的 grammar 更新必须使它失效。
    expect(
      ast.analyzeSourceFile('export interface Before {}', 'typescript')?.protocols
    ).toHaveLength(1);
    const fixture = await grammarFixture();
    await writeFile(
      fixture.file,
      await readFile(path.join(grammarRoot, 'tree-sitter-typescript.wasm'))
    );
    const readFinished = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const realLoad = runtime.loadLanguageWasm;
    let paused = false;
    const load = vi.spyOn(runtime, 'loadLanguageWasm').mockImplementation(async (name) => {
      const language = await realLoad(
        name === 'tree-sitter-typescript.wasm' ? fixture.relative : name
      );
      if (name === 'tree-sitter-rust.wasm' && !paused) {
        paused = true;
        readFinished.resolve();
        await release.promise;
      }
      return language;
    });
    const first = ast.reloadProjectAstPlugins();
    await readFinished.promise;
    await writeFile(
      fixture.file,
      await readFile(path.join(grammarRoot, 'tree-sitter-javascript.wasm'))
    );
    const second = ast.reloadProjectAstPlugins();
    try {
      await setImmediate();
      // 新请求应排在当前 pass 完成之后，避免较旧的注册覆盖新 grammar。
      expect(load).toHaveBeenCalledTimes(ast.CORE_GRAMMAR_RESOURCE_FILES.length);
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
    expect(load).toHaveBeenCalledTimes(ast.CORE_GRAMMAR_RESOURCE_FILES.length * 2);
    expect(
      ast.analyzeSourceFile('export interface Contract { run(): void }', 'typescript')?.protocols
    ).toEqual([]);
  });

  it('shares unchanged grammar loads and observes repair, retry, and changed bytes', async () => {
    const runtime = await import('../src/core/ast/parserInit.js');
    await runtime.initParser();
    const fixture = await grammarFixture();
    await writeFile(fixture.file, 'invalid wasm');
    expect(await runtime.loadLanguageWasm(fixture.relative)).toBeNull();
    await writeFile(
      fixture.file,
      await readFile(path.join(grammarRoot, 'tree-sitter-typescript.wasm'))
    );
    const load = vi
      .spyOn(Language, 'load')
      .mockRejectedValueOnce(new Error('temporary load failure'));
    expect(await runtime.loadLanguageWasm(fixture.relative)).toBeNull();
    const [first, second] = await Promise.all([
      runtime.loadLanguageWasm(fixture.relative),
      runtime.loadLanguageWasm(fixture.relative),
    ]);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(2); // 失败一次，同内容并发重试只创建一个 Language。
    const parser = new Parser();
    try {
      parser.setLanguage(first);
      const initial = parser.parse('export interface Contract { run(): void }');
      try {
        expect(initial?.rootNode.hasError).toBe(false);
      } finally {
        initial?.delete();
      }
      await writeFile(
        fixture.file,
        await readFile(path.join(grammarRoot, 'tree-sitter-javascript.wasm'))
      );
      parser.setLanguage(await runtime.loadLanguageWasm(fixture.relative));
      const changed = parser.parse('export interface Contract { run(): void }');
      try {
        expect(changed?.rootNode.hasError).toBe(true);
      } finally {
        changed?.delete();
      }
    } finally {
      parser.delete();
    }
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerLanguage } from '../src/core/AstAnalyzer.js';
import { loadPlugins } from '../src/core/ast/index.js';
import { plugin as typescriptPlugin } from '../src/core/ast/lang-typescript.js';
import type { FileFlowContext, FileSymbolContext } from '../src/domain/project-context/index.js';
import {
  getCodeGraphProjectContextIdentity,
  ProjectContext,
  withCodeGraphProjectContextSession,
} from '../src/project-context.js';
import { NodeProjectContextFoundationHostPorts } from '../src/projectContextFoundation.js';
import { hashCanonicalJson } from '../src/shared/canonicalJson.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(text: string | Record<string, string> = 'export class Input {}') {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-strict-session-'))
  );
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  const files = typeof text === 'string' ? { 'sample.ts': text } : text;
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(projectRoot, file)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, file), source);
  }
  return { root, projectRoot, dataRoot };
}

const symbolsRequest = (projectRoot: string, filePath = 'sample.ts') => ({
  kind: 'file-symbols' as const,
  scope: { projectRoot },
  payload: { filePath },
});
const flowRequest = (projectRoot: string, filePath = 'sample.ts') => ({
  kind: 'file-flow' as const,
  scope: { projectRoot, repoId: 'repo' },
  payload: { filePath },
});

describe('strict analysis session', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  it('answers from the own file facts with the same refs as a plain query', async () => {
    const input = await fixture(
      [
        'export const limit = 10;',
        'export interface Port { run(): void }',
        'export class Cache {',
        '  #read() { return 1; }',
        '  get(): number { return this.#read(); }',
        '}',
        'export const load = () => new Cache().get();',
      ].join('\n')
    );

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const plain = await ProjectContext.execute(symbolsRequest(input.projectRoot));
      const strict = await context.execute(symbolsRequest(input.projectRoot));

      expect(strict.errors).toBeUndefined();
      expect(strict).toEqual(plain);
      expect(
        (strict.data as FileSymbolContext).symbols.map(
          (symbol) => `${symbol.kind} ${symbol.qualifiedName}`
        )
      ).toEqual([
        'variable limit',
        'interface Port',
        'method Port.run',
        'class Cache',
        'method Cache.#read',
        'method Cache.get',
        'function load',
      ]);
      // 内部证据字段不进入公开结果。
      const serialized = JSON.stringify(strict);
      for (const internal of ['declarationKind', 'declarationRange', 'matchingRange']) {
        expect(serialized).not.toContain(internal);
      }
    });
  });

  it('refuses malformed JavaScript and TypeScript instead of certifying an empty result', async () => {
    const input = await fixture('export function broken( {\nconst survivor = 1;');

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute(symbolsRequest(input.projectRoot));
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'query-unavailable',
            message: expect.stringContaining('Syntax verification failed'),
          }),
        ])
      );
      // 普通查询对同一个文件仍给出能提取到的部分；严格会话不给部分结果。
      const plain = await ProjectContext.execute(symbolsRequest(input.projectRoot));
      expect(plain.errors).toBeUndefined();
    });
  });

  it.each([
    ['anonymous default class', 'export default class { run() {} }'],
    ['anonymous default function', 'export default function (value: string) { return value; }'],
    ['namespace', 'export namespace Models { export class Box {} }'],
  ])('reports explicit coverage unavailability for %s', async (_shape, text) => {
    const input = await fixture(text);

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute(symbolsRequest(input.projectRoot));
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'query-unavailable',
            message: expect.stringContaining('Declaration coverage unavailable'),
          }),
        ])
      );
      const flow = await context.execute(flowRequest(input.projectRoot));
      expect(flow.errors?.length).toBeGreaterThan(0);
    });
  });

  it('refuses a call list when call-site extraction did not complete, keeping the symbols', async () => {
    const input = await fixture('function helper() {}\nexport function run() { helper(); }\n');
    registerLanguage('typescript', {
      ...typescriptPlugin,
      extractCallSites() {
        throw new Error('controlled call evidence failure');
      },
    });
    try {
      await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
        const symbols = await context.execute(symbolsRequest(input.projectRoot));
        expect(symbols.errors).toBeUndefined();
        expect((symbols.data as FileSymbolContext).symbols.map((symbol) => symbol.name)).toEqual([
          'helper',
          'run',
        ]);
        const flow = await context.execute(flowRequest(input.projectRoot));
        expect(flow.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'query-unavailable',
              message: expect.stringContaining('Call coverage unavailable'),
            }),
          ])
        );
      });
      // 普通查询保持宽容：不报错，只是没有调用点。
      const plain = await ProjectContext.execute(flowRequest(input.projectRoot));
      expect(plain.errors).toBeUndefined();
    } finally {
      registerLanguage('typescript', typescriptPlugin);
    }
  });

  it('accepts type-level syntax the grammar does not know and leaves other languages alone', async () => {
    const input = await fixture({
      'sample.ts': "export type * from './types.js';\nexport function run() {}\n",
      'types.ts': 'export interface Shape { area(): number }\n',
      // Swift 语法包对合法源码也会报错；严格会话不据此判不可用。
      'App.swift':
        'final class App {\n#if DEBUG\n    func debug() {}\n#endif\n    func run() {}\n}\n',
    });

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const typescript = await context.execute(symbolsRequest(input.projectRoot));
      expect(typescript.errors).toBeUndefined();
      expect((typescript.data as FileSymbolContext).symbols.map((symbol) => symbol.name)).toEqual([
        'run',
      ]);
      const swift = await context.execute(symbolsRequest(input.projectRoot, 'App.swift'));
      expect(swift.errors).toBeUndefined();
    });
  });

  it('keeps same-line accessors and overloads distinct without touching other refs', async () => {
    const text =
      '/* 汉😀 */ export class Box { get value() { return 1; } set value(input: number) {} ordinary() {} }\r\n';
    const input = await fixture(text);

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute(symbolsRequest(input.projectRoot));
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols;
      const accessors = symbols.filter((symbol) => symbol.qualifiedName === 'Box.value');
      // 只有真正撞在同一行的一组声明带列范围（UTF-16 列）。
      expect(accessors.map((symbol) => symbol.range)).toEqual([
        {
          startLine: 1,
          endLine: 1,
          startColumn: text.indexOf('get value'),
          endColumn: text.indexOf('} set') + 1,
        },
        {
          startLine: 1,
          endLine: 1,
          startColumn: text.indexOf('set value'),
          endColumn: text.indexOf('{} ordinary') + 2,
        },
      ]);
      expect(accessors.map((symbol) => symbol.signature)).toEqual([
        'get value()',
        'set value(input: number)',
      ]);
      expect(new Set(symbols.map((symbol) => symbol.ref?.id)).size).toBe(symbols.length);
      for (const qualifiedName of ['Box', 'Box.ordinary']) {
        const symbol = symbols.find((candidate) => candidate.qualifiedName === qualifiedName);
        expect(symbol?.range).toEqual({ startLine: 1, endLine: 1 });
      }
    });
  });

  it('gives every call site its own ref, whether or not it links to a declaration', async () => {
    // 与宿主安装包自检用的是同一个形态：同一行上两次相同的调用，加一次未知接收者的调用。
    const input = await fixture(
      [
        'export const installedSymbol = 1;',
        'function target() {}',
        'export function run(client) { target(); target(); client.target(); }',
      ].join('\n')
    );

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const symbols = await context.execute(symbolsRequest(input.projectRoot));
      expect(symbols.errors ?? []).toEqual([]);
      expect(
        (symbols.data as FileSymbolContext).symbols.some(
          (symbol) => symbol.name === 'installedSymbol'
        )
      ).toBe(true);

      const flow = await context.execute(flowRequest(input.projectRoot));
      expect(flow.errors ?? []).toEqual([]);
      const calls = (flow.data as FileFlowContext).callers;
      expect(calls).toHaveLength(3);
      expect(new Set(calls.map((call) => call.ref?.id)).size).toBe(3);
      expect(calls.filter((call) => call.to?.ref && !call.unresolved)).toHaveLength(2);
      expect(calls.filter((call) => call.unresolved && !call.to?.ref)).toHaveLength(1);
    });
  });

  it('links relative and aliased imports, and proves a default import by its declaration', async () => {
    const input = await fixture({
      'tsconfig.json':
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["lib/*"] } } }',
      'sample.ts': [
        "import actual, { helper } from './dep.js';",
        "import { aliased } from '@lib/aliased';",
        "import { external } from 'some-package';",
        'export function run(helper2: () => void) {',
        '  actual(); helper(); aliased(); external(); helper2();',
        '}',
      ].join('\n'),
      // default 导入指向真正的 default 声明，不是文件里第一个导出的函数。
      'dep.ts': 'export function helper() {}\nexport default function real() {}\n',
      'lib/aliased.ts': 'export function aliased() {}\n',
    });

    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const flow = (await context.execute(flowRequest(input.projectRoot))).data as FileFlowContext;
      expect(
        flow.callees.map(
          (relation) =>
            `${relation.label ?? relation.to?.label} -> ${relation.unresolved ? 'unresolved' : `${relation.to?.filePath}#${relation.to?.symbol}`}`
        )
      ).toEqual([
        // 关系按目标名排序；default 导入落在真正的 default 声明 real 上。
        'run calls aliased -> lib/aliased.ts#aliased',
        'run calls external -> unresolved',
        'run calls helper -> dep.ts#helper',
        'run calls helper2 -> unresolved',
        'run calls actual -> dep.ts#real',
      ]);
    });
  });

  it('records the module config it read and replays it offline with identical results', async () => {
    const files = {
      'sample.ts': "import { target as alias } from '@barrel';\nexport function run() { alias(); }",
      'barrel.ts': "export { target } from './dep';",
      'dep.ts': 'export function target() { return 1; }',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    // 配置继承：一份不存在（负向事实也要记录），一份在子目录里给出 baseUrl 与 paths。
    await fs.mkdir(path.join(projectRoot, 'config'));
    await fs.writeFile(
      path.join(projectRoot, 'tsconfig.json'),
      '{"extends":["./missing-base.json","./config/base.json"]}'
    );
    await fs.writeFile(
      path.join(projectRoot, 'config/base.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@barrel': ['barrel.ts'] } } })
    );

    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const request = flowRequest(projectRoot);
      const live = await context.execute(request);
      const capture = await new NodeProjectContextFoundationHostPorts(context).createInputCapture({
        repositories: [
          { repoId: 'repo', scopeId: 'repo', relativeRoot: '.', sourceRoot: projectRoot },
        ],
        files: Object.entries(files).map(([relativePath, source]) => ({
          repoId: 'repo',
          relativePath,
          content: Buffer.from(source),
        })),
      });
      if (!capture) {
        throw new Error('Expected native capture');
      }
      const recorded = await context.execute(request, { sourceReader: capture.reader });
      expect(recorded.errors ?? []).toEqual([]);
      const call = (recorded.data as FileFlowContext).callers[0];
      // 别名经 tsconfig 的继承链解析到 barrel，再沿 re-export 到声明。
      expect(call).toMatchObject({
        unresolved: false,
        to: { filePath: 'dep.ts', symbol: 'target', ref: { kind: 'file-symbol' } },
      });
      // 实时查询与捕获查询看到同一个调用点引用。
      expect(call.ref?.id).toBe((live.data as FileFlowContext).callers[0].ref?.id);

      const snapshot = await capture.snapshot();
      const negatives = snapshot.observations.filter(
        (row) => row.path.relativePath === 'missing-base.json'
      );
      expect(negatives.length).toBeGreaterThan(0);
      expect(negatives.every((row) => !row.outcome.ok)).toBe(true);
      await capture.verify();

      // 离线重放：源码目录已经不存在，结果必须逐字节相同。
      await fs.rm(projectRoot, { recursive: true });
      const replay = capture.createReplay(snapshot);
      expect(await context.execute(request, { sourceReader: replay })).toEqual(recorded);
      replay.assertComplete();

      // 去掉"某份配置不存在"这条负向事实：重放不能把它当成"没有配置"悄悄继续。
      const incomplete = structuredClone(snapshot);
      incomplete.observations = incomplete.observations.filter(
        (row) =>
          !negatives.some(
            (negative) =>
              negative.operation === row.operation &&
              negative.path.relativePath === row.path.relativePath
          )
      );
      const { snapshotHash: _hash, ...semantic } = incomplete;
      incomplete.snapshotHash = hashCanonicalJson({
        ...semantic,
        blobs: incomplete.blobs.map(({ hash, byteLength }) => ({ hash, byteLength })),
      });
      const missing = capture.createReplay(incomplete);
      await expect(
        withCodeGraphProjectContextSession({ dataRoot }, (offline) =>
          offline.execute(request, { sourceReader: missing })
        )
      ).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_UNCAPTURED' });
      expect(() => missing.assertComplete()).toThrow();
    });
  });

  it('links calls into another workspace package only when its entry is backed by configuration', async () => {
    const manifest = (value: object) => JSON.stringify(value);
    const files = {
      'package.json': manifest({ name: 'root', private: true, workspaces: ['packages/*'] }),
      'packages/app/package.json': manifest({ name: '@demo/app' }),
      'packages/app/src/main.ts': [
        "import { createStore } from '@demo/core';",
        "import { render } from '@demo/ui';",
        'export function main() { createStore(); render(); }',
      ].join('\n'),
      'packages/core/package.json': manifest({ name: '@demo/core', exports: './src/index.ts' }),
      'packages/core/src/index.ts': 'export function createStore() {}\n',
      // 入口指向构建产物且没有编译配置：协议不按目录惯例猜，调用保持未解析。
      'packages/ui/package.json': manifest({ name: '@demo/ui', main: 'dist/index.js' }),
      'packages/ui/src/index.ts': 'export function render() {}\n',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    const request = flowRequest(projectRoot, 'packages/app/src/main.ts');
    const describeCalls = (flow: FileFlowContext) =>
      flow.callers.map((call) =>
        call.unresolved ? `${call.label} -> unresolved` : `${call.label} -> ${call.to?.filePath}`
      );

    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const live = await context.execute(request);
      expect(live.errors ?? []).toEqual([]);
      expect(describeCalls(live.data as FileFlowContext)).toEqual([
        'main calls createStore -> packages/core/src/index.ts',
        'main calls render -> unresolved',
      ]);

      // 捕获记下读过的清单与目录；重放在源码目录消失后得到逐字节相同的结果。
      const capture = await new NodeProjectContextFoundationHostPorts(context).createInputCapture({
        repositories: [
          { repoId: 'repo', scopeId: 'repo', relativeRoot: '.', sourceRoot: projectRoot },
        ],
        files: Object.entries(files)
          .filter(([relativePath]) => relativePath.endsWith('.ts'))
          .map(([relativePath, source]) => ({
            repoId: 'repo',
            relativePath,
            content: Buffer.from(source),
          })),
      });
      if (!capture) {
        throw new Error('Expected native capture');
      }
      const recorded = await context.execute(request, { sourceReader: capture.reader });
      expect(describeCalls(recorded.data as FileFlowContext)).toEqual(
        describeCalls(live.data as FileFlowContext)
      );
      const snapshot = await capture.snapshot();
      const observed = new Set(snapshot.observations.map((row) => row.path.relativePath));
      for (const consulted of ['package.json', 'packages/core/package.json', 'packages']) {
        expect(observed.has(consulted)).toBe(true);
      }
      await capture.verify();
      await fs.rm(projectRoot, { recursive: true });
      const replay = capture.createReplay(snapshot);
      expect(await context.execute(request, { sourceReader: replay })).toEqual(recorded);
      replay.assertComplete();
    });
  });

  it('exposes a stable engine identity and a private runtime directory, and starts no process', async () => {
    const input = await fixture();
    const identity = await getCodeGraphProjectContextIdentity();

    const runtime = await withCodeGraphProjectContextSession(
      { dataRoot: input.dataRoot },
      async (context, current) => {
        await context.execute(symbolsRequest(input.projectRoot));
        return current;
      }
    );

    expect(runtime.engineHash).toBe(identity.engineHash);
    expect(runtime.engineHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await getCodeGraphProjectContextIdentity()).toEqual(identity);
    expect(identity.engine.languages).toEqual(
      expect.arrayContaining(['swift', 'objc', 'typescript'])
    );
    // 私有运行目录固定在宿主数据目录下，会话结束后是空的；项目目录里什么都没写。
    expect(runtime.runtimeRoot).toBe(path.join(input.dataRoot, '.asd/codegraph-sessions'));
    expect(await fs.readdir(runtime.runtimeRoot)).toEqual([]);
    expect(await fs.readdir(input.projectRoot)).toEqual(['sample.ts']);
  });

  it('rejects an invalid data root and propagates cancellation without publishing a result', async () => {
    const input = await fixture();

    await expect(
      withCodeGraphProjectContextSession({ dataRoot: 'relative/data' }, async () => 'unreachable')
    ).rejects.toThrow('absolute');

    const aborted = new AbortController();
    aborted.abort(new DOMException('Cancelled before start', 'AbortError'));
    await expect(
      withCodeGraphProjectContextSession(
        { dataRoot: input.dataRoot, signal: aborted.signal },
        async () => 'unreachable'
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    // 开始之前就取消：不创建任何目录。
    await expect(fs.stat(input.dataRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    // 回调本身成功，但期间 owner 取消了：不能当作成功返回。
    const owner = new AbortController();
    const reason = new DOMException('Owner cancelled during the callback', 'AbortError');
    await expect(
      withCodeGraphProjectContextSession(
        { dataRoot: input.dataRoot, signal: owner.signal },
        async () => {
          owner.abort(reason);
          return 'completed';
        }
      )
    ).rejects.toMatchObject({ message: reason.message });

    // 回调抛错原样传出，会话之后不可再用。
    let escaped: { execute: (typeof ProjectContext)['execute'] } | undefined;
    await expect(
      withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
        escaped = context;
        throw new Error('callback failed');
      })
    ).rejects.toThrow('callback failed');
    await expect(escaped?.execute(symbolsRequest(input.projectRoot))).rejects.toThrow('closed');
  });
});

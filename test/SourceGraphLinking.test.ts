import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import type { SourceGraphEdge } from '../src/domain/source-graph/index.js';
import type { SourceGraphIndexBuildResult } from '../src/domain/source-graph/SourceGraphContracts.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import type { SourceGraphRepositoryImpl } from '../src/repository/source-graph/SourceGraphRepository.js';
import { SourceGraphIndexer, SourceGraphService } from '../src/service/source-graph/index.js';

describe('source graph linking', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let repository: SourceGraphRepositoryImpl;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-linking-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
    repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(files: Record<string, string | null>): void {
    for (const [repoRelativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(tmpDir, repoRelativePath);
      if (content === null) {
        fs.rmSync(absolutePath, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
    }
  }

  const input = { projectRoot: '', projectScope: 'src' };
  const full = (generationId: string, repoId = 'default') =>
    new SourceGraphIndexer(repository).buildFull({
      ...input,
      projectRoot: tmpDir,
      generationId,
      repoId,
    });
  const incremental = (generationId: string) =>
    new SourceGraphIndexer(repository).buildIncremental({
      ...input,
      projectRoot: tmpDir,
      generationId,
    });

  /** 调用边写成"调用方 -> 被调 [策略 / 归属]"，便于按集合比较。 */
  function calls(edges: readonly SourceGraphEdge[]): string[] {
    return edges
      .filter((edge) => edge.kind === 'calls')
      .map((edge) => {
        const resolution = edge.metadata.resolution as { strategy: string };
        return `${edge.fromSymbolId} -> ${edge.toSymbolId} [${resolution.strategy} / ${edge.metadata.callerAttribution}]`;
      })
      .sort();
  }

  /** 一代索引里与代际编号无关的全部事实。 */
  function facts(result: SourceGraphIndexBuildResult) {
    const strip = <T extends { generationId: string }>({ generationId: _, ...rest }: T) => rest;
    return {
      files: result.files
        .map(({ generationId: _g, indexedAt: _i, mtimeMs: _m, ...file }) => file)
        .sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath)),
      symbols: result.symbols
        .map(strip)
        .sort((left, right) => left.symbolId.localeCompare(right.symbolId)),
      edges: result.edges.map(strip).sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
    };
  }

  it('links calls through imports, barrels and same-file declarations with the right owner', async () => {
    write({
      'src/app.ts': [
        "import run, { helper as aliased, Service } from './barrel.js';",
        "import * as tools from './tools.js';",
        'function local() {}',
        'export function main() {',
        '  aliased();',
        '  run();',
        '  tools.format();',
        '  local();',
        '  return new Service().start();',
        '}',
        'export class Controller {',
        '  handler = () => aliased();',
        '  #secret() { local(); }',
        '  open() { this.#secret(); [1].forEach(() => tools.format()); }',
        '}',
        'export const routes = { index() { return Service.create(); } };',
        'aliased();',
      ].join('\n'),
      'src/barrel.ts': [
        "export { helper, default } from './lib.js';",
        "export * from './service.js';",
      ].join('\n'),
      'src/lib.ts': 'export function helper() {}\nexport default function actual() {}\n',
      'src/service.ts':
        'export class Service { static create() { return new Service(); } start() {} }\n',
      'src/tools.ts': 'export const format = () => 1;\n',
    });

    const result = await full('linking');

    expect(calls(result.edges)).toEqual([
      // 成员：类字段里的箭头函数、私有方法、方法体里的匿名回调。
      'src/app.ts#Controller.#secret -> src/app.ts#local [same-file-declaration / declaration]',
      'src/app.ts#Controller.handler -> src/lib.ts#helper [named-import+re-export / declaration]',
      'src/app.ts#Controller.open -> src/app.ts#Controller.#secret [same-file-declaration / declaration]',
      'src/app.ts#Controller.open -> src/tools.ts#format [namespace-member / enclosing]',
      // 具名函数：别名导入、default 导入、命名空间成员、同文件声明、经 `export *` 的类。
      'src/app.ts#main -> src/app.ts#local [same-file-declaration / declaration]',
      'src/app.ts#main -> src/lib.ts#actual [default-import+re-export / declaration]',
      'src/app.ts#main -> src/lib.ts#helper [named-import+re-export / declaration]',
      'src/app.ts#main -> src/service.ts#Service [named-import+re-export / declaration]',
      'src/app.ts#main -> src/tools.ts#format [namespace-member / declaration]',
      // 模块顶层的调用归文件自身；对象字面量方法里的调用归到包住它的声明。
      'src/app.ts#module -> src/lib.ts#helper [named-import+re-export / module]',
      'src/app.ts#routes -> src/service.ts#Service.create [imported-member+re-export / enclosing]',
      'src/service.ts#Service.create -> src/service.ts#Service [same-file-declaration / declaration]',
    ]);
    // 实例化与普通调用用同一种边，靠 callKind 区分。
    expect(
      result.edges
        .filter((edge) => edge.metadata.callKind === 'new')
        .map((edge) => `${edge.fromSymbolId} -> ${edge.toSymbolId}`)
        .sort()
    ).toEqual([
      'src/app.ts#main -> src/service.ts#Service',
      'src/service.ts#Service.create -> src/service.ts#Service',
    ]);
    // 文件依赖：barrel 的两条都是 re-export，增量构建据此把变化继续传给它的导入方。
    expect(
      result.edges
        .filter((edge) => edge.kind === 'imports')
        .map(
          (edge) =>
            `${edge.fromFilePath} -> ${edge.toFilePath}${edge.metadata.reexport ? ' (re-export)' : ''}`
        )
    ).toEqual([
      'src/app.ts -> src/barrel.ts',
      'src/app.ts -> src/tools.ts',
      'src/barrel.ts -> src/lib.ts (re-export)',
      'src/barrel.ts -> src/service.ts (re-export)',
    ]);
    expect(result.status.ready).toBe(true);
  });

  it('links class and interface hierarchy through same-file declarations and imports', async () => {
    write({
      'src/base.ts': 'export class Base {}\nexport interface Port {}\nexport interface Extra {}\n',
      'src/barrel.ts': "export * from './base.js';\n",
      'src/shapes.ts': [
        "import * as base from './base.js';",
        "import type { Port, Extra } from './barrel.js';",
        "import { External } from 'some-package';",
        'interface Local extends Port {}',
        'export class Impl extends base.Base implements Local, Extra<string> {}',
        'export class Outside extends External {}',
        'export class Mixed extends mixin(Impl) {}',
        'export interface Wide extends Port, Local {}',
      ].join('\n'),
      'src/legacy.js': 'class Parent {}\nexport class Child extends Parent {}\n',
    });

    const result = await full('hierarchy');

    expect(
      result.edges
        .filter((edge) => edge.kind === 'extends' || edge.kind === 'implements')
        .map((edge) => {
          const resolution = edge.metadata.resolution as { strategy: string };
          return `${edge.fromSymbolId} ${edge.kind} ${edge.toSymbolId} [${resolution.strategy}]`;
        })
        .sort()
    ).toEqual([
      'src/legacy.js#Child extends src/legacy.js#Parent [same-file-declaration]',
      'src/shapes.ts#Impl extends src/base.ts#Base [namespace-member]',
      'src/shapes.ts#Impl implements src/base.ts#Extra [named-import+re-export]',
      'src/shapes.ts#Impl implements src/shapes.ts#Local [same-file-declaration]',
      'src/shapes.ts#Local extends src/base.ts#Port [named-import+re-export]',
      'src/shapes.ts#Wide extends src/base.ts#Port [named-import+re-export]',
      'src/shapes.ts#Wide extends src/shapes.ts#Local [same-file-declaration]',
    ]);
    // 包里的父类没有边，但源码写出的名字留在符号上；表达式形式的父类连名字也没有。
    expect(
      result.symbols.find((symbol) => symbol.symbolId === 'src/shapes.ts#Outside')?.metadata
        .heritage
    ).toEqual({ extends: ['External'], implements: [] });
    expect(
      result.symbols.find((symbol) => symbol.symbolId === 'src/shapes.ts#Mixed')?.metadata.heritage
    ).toBeUndefined();

    // "谁继承它、谁实现它"就是指向它的层级边。
    const service = new SourceGraphService(repository);
    const subtypes = await service.getSourceGraphCallers({
      generationId: 'hierarchy',
      symbolId: 'src/base.ts#Port',
    });
    expect(subtypes.callers.map((symbol) => symbol.symbolId).sort()).toEqual([
      'src/shapes.ts#Local',
      'src/shapes.ts#Wide',
    ]);
  });

  it('answers callers and callees from the stored call edges', async () => {
    write({
      'src/app.ts': [
        "import { helper } from './lib.js';",
        'export function first() { helper(); }',
        'export function second() { helper(); first(); }',
      ].join('\n'),
      'src/lib.ts': 'export function helper() {}\n',
    });
    await full('queries');
    const service = new SourceGraphService(repository);

    const callers = await service.getSourceGraphCallers({
      generationId: 'queries',
      symbolId: 'src/lib.ts#helper',
    });
    expect(callers.callers.map((symbol) => symbol.symbolId).sort()).toEqual([
      'src/app.ts#first',
      'src/app.ts#second',
    ]);
    // 每条关系都带调用点位置。
    expect(callers.edges.map((edge) => [edge.siteFilePath, edge.site?.startLine]).sort()).toEqual([
      ['src/app.ts', 2],
      ['src/app.ts', 3],
    ]);

    const callees = await service.getSourceGraphCallees({
      generationId: 'queries',
      symbolId: 'src/app.ts#second',
    });
    expect(callees.callees.map((symbol) => symbol.symbolId).sort()).toEqual([
      'src/app.ts#first',
      'src/lib.ts#helper',
    ]);
  });

  it('never invents a target for shadowed, ambiguous or non-relative callees', async () => {
    write({
      'src/app.ts': [
        "import { helper } from './lib.js';",
        "import { external } from 'some-package';",
        "import { aliased } from '@/lib';",
        "import type { helper as typeOnly } from './lib.js';",
        "import { twice } from './barrel.js';",
        'export function shadowed(helper: () => void) { helper(); }',
        'export function main(input: { helper(): void }) {',
        '  external();',
        '  aliased();',
        '  typeOnly();',
        '  twice();',
        '  input.helper();',
        '  missing();',
        '}',
      ].join('\n'),
      'src/lib.ts': 'export function helper() {}\nexport function aliased() {}\n',
      'src/barrel.ts': "export * from './a.js';\nexport * from './b.js';\n",
      'src/a.ts': 'export function twice() {}\n',
      'src/b.ts': 'export function twice() {}\n',
    });

    const result = await full('negative');

    expect(calls(result.edges)).toEqual([]);
    expect(
      result.files.find((file) => file.repoRelativePath === 'src/app.ts')?.metadata.callSites
    ).toEqual({ total: 7, linked: 0 });
  });

  it('links Swift calls to members declared in the same file', async () => {
    write({
      'src/Worker.swift': [
        'func prepare() {}',
        'final class Worker {',
        '    private let queue = Queue.make()',
        '    func run() {',
        '        prepare()',
        '        self.finish()',
        '        items.forEach { _ in finish() }',
        '        other.finish()',
        '    }',
        '    func prepare() {}',
        '    func finish() {}',
        '}',
        'struct Queue {',
        '    static func make() -> Queue { Queue() }',
        '}',
      ].join('\n'),
    });

    const result = await full('swift');

    expect(calls(result.edges)).toEqual([
      'src/Worker.swift#Queue.make -> src/Worker.swift#Queue [same-file-declaration / declaration]',
      // 隐式与显式 self、闭包里的调用都归到所在方法；其他接收者不猜。
      // 同一个调用方对同一个目标的多次调用是多条边，各有自己的位置。
      'src/Worker.swift#Worker.run -> src/Worker.swift#Worker.finish [same-file-declaration / declaration]',
      'src/Worker.swift#Worker.run -> src/Worker.swift#Worker.finish [same-file-declaration / declaration]',
      'src/Worker.swift#Worker.run -> src/Worker.swift#Worker.prepare [same-file-declaration / declaration]',
    ]);
    expect(
      result.edges
        .filter((edge) => edge.toSymbolId === 'src/Worker.swift#Worker.finish')
        .map((edge) => edge.site?.startLine)
        .sort()
    ).toEqual([6, 7]);
    expect(
      result.edges.find((edge) => edge.toSymbolId === 'src/Worker.swift#Queue')?.metadata.callKind
    ).toBe('new');
  });

  it('indexes Objective-C headers and implementations with their declarations', async () => {
    write({
      'src/User.h': [
        '@interface User : NSObject',
        '@property (nonatomic, copy) NSString *name;',
        '- (BOOL)isValid;',
        '@end',
      ].join('\n'),
      'src/User.m': [
        '#import "User.h"',
        '@implementation User',
        '- (BOOL)isValid { return self.name.length > 0; }',
        '@end',
      ].join('\n'),
    });

    const result = await full('objc');

    expect(
      result.files.map((file) => [file.repoRelativePath, file.language, file.parseStatus])
    ).toEqual([
      ['src/User.h', 'objectivec', 'parsed'],
      ['src/User.m', 'objectivec', 'parsed'],
    ]);
    expect(result.symbols.map((symbol) => symbol.symbolId)).toEqual(
      expect.arrayContaining([
        'src/User.h#User',
        'src/User.h#User.isValid',
        'src/User.m#User.isValid',
      ])
    );
    expect(result.status.ready).toBe(true);
  });

  it('produces the same facts incrementally as a full rebuild after declarations move', async () => {
    write({
      'src/app.ts': [
        "import { helper, removed } from './barrel.js';",
        'export function main() { helper(); removed(); }',
      ].join('\n'),
      'src/barrel.ts': "export * from './lib.js';\n",
      'src/lib.ts': 'export function helper() {}\nexport function removed() {}\n',
      'src/other.ts': "import { main } from './app.js';\nexport const start = () => main();\n",
      'src/untouched.ts': 'export function alone() { return 1; }\n',
    });
    await full('base');

    // 只改 lib.ts：removed 消失、helper 换成同名 const。app.ts 没改，但它经 barrel 拿到这些声明。
    write({ 'src/lib.ts': 'export const helper = () => 2;\nexport function added() {}\n' });
    const next = await incremental('next');

    expect(next.snapshot.metadata.mode).toBe('incremental');
    expect(next.changedFiles).toEqual(['src/lib.ts']);
    expect(calls(next.edges)).toEqual([
      'src/app.ts#main -> src/lib.ts#helper [named-import+re-export / declaration]',
      'src/other.ts#start -> src/app.ts#main [named-import / declaration]',
    ]);
    expect(facts(next)).toEqual(facts(await full('rebuilt', 'rebuilt')));

    // 文件集合变化（新增同名更优先的入口、删除旧目标）之后同样一致。
    write({
      'src/lib.js': 'export function helper() {}\n',
      'src/untouched.ts': null,
    });
    const moved = await incremental('moved');
    expect(moved.deletedFiles).toEqual(['src/untouched.ts']);
    expect(calls(moved.edges)).toEqual([
      'src/app.ts#main -> src/lib.js#helper [named-import+re-export / declaration]',
      'src/other.ts#start -> src/app.ts#main [named-import / declaration]',
    ]);
    expect(facts(moved)).toEqual(facts(await full('rebuilt-again', 'rebuilt-again')));
  });

  it('re-links only the importers that can see a changed declaration', async () => {
    write({
      'src/leaf.ts': 'export function leaf() {}\n',
      'src/direct.ts': "import { leaf } from './leaf.js';\nexport function direct() { leaf(); }\n",
      'src/barrel.ts': "export { leaf } from './leaf.js';\n",
      'src/viaBarrel.ts':
        "import { leaf } from './barrel.js';\nexport function via() { leaf(); }\n",
      // 只导入 direct，不经 re-export 看到 leaf：leaf 变化不需要重连它。
      'src/far.ts': "import { direct } from './direct.js';\nexport function far() { direct(); }\n",
    });
    await full('base');
    const analyzed: string[] = [];
    const read = fs.promises.readFile.bind(fs.promises);
    const original = fs.promises.readFile;
    // 记录这次增量构建实际读了哪些文件正文（含变化检测与分析）。
    fs.promises.readFile = (async (...args: Parameters<typeof read>) => {
      analyzed.push(path.relative(tmpDir, String(args[0])).split(path.sep).join('/'));
      return read(...args);
    }) as typeof original;
    try {
      write({ 'src/leaf.ts': 'export function leaf() { return 1; }\n' });
      const next = await incremental('next');
      expect(next.changedFiles).toEqual(['src/leaf.ts']);
      // 每个文件为变化检测读一次；被分析的文件再读一次。
      const analyzedTwice = [
        ...new Set(analyzed.filter((file, index) => analyzed.indexOf(file) !== index)),
      ];
      expect(analyzedTwice.sort()).toEqual([
        'src/barrel.ts',
        'src/direct.ts',
        'src/leaf.ts',
        'src/viaBarrel.ts',
      ]);
      expect(facts(next)).toEqual(facts(await full('rebuilt', 'rebuilt')));
    } finally {
      fs.promises.readFile = original;
    }
  });
});

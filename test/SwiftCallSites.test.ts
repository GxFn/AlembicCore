import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { analyzeFile } from '../src/core/AstAnalyzer.js';
import { loadPlugins } from '../src/core/ast/index.js';
import type { FileFlowContext } from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';

const SERVICE = `final class Service {
    private let cache = Cache.build()
    var title: String { format() }

    init(repo: Repo) {
        configure()
    }

    deinit {
        teardown()
    }

    subscript(index: Int) -> String { lookup(index) }

    func greet() -> Int {
        factory().send(inner())
        if !other.isReady() { return 0 }
        return other.load().count + helper()
    }
}

extension Service {
    func extended() { configure() }
}

extension Outer.Inner {
    func nested() { run() }
}
`;

/** 调用点按"拥有者 -> 被调"列出，接收者写在被调前面。 */
function callSitesOf(source: string): string[] {
  const summary = analyzeFile(source, 'swift');
  if (!summary) {
    throw new Error('swift grammar unavailable');
  }
  return summary.callSites
    .map((site) => {
      const owner = site.callerClass
        ? `${site.callerClass}.${site.callerMethod}`
        : site.callerMethod;
      return `${owner} -> ${site.receiver ? `${site.receiver}.` : ''}${site.callee}`;
    })
    .sort();
}

describe('Swift call-site extraction', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  it('collects calls from every scope that executes code, under the right owner', () => {
    expect(callSitesOf(SERVICE)).toEqual(
      expect.arrayContaining([
        // 属性初始值与计算属性：拥有者是属性本身。
        'Service.cache -> Cache.build',
        'Service.title -> format',
        // init / deinit / subscript 体。
        'Service.init -> configure',
        'Service.deinit -> teardown',
        'Service.subscript -> lookup',
        // 扩展里的调用归到被扩展的类型，嵌套类型保留完整名字。
        'Service.extended -> configure',
        'Outer.Inner.nested -> run',
      ])
    );
  });

  it('reads the real callee out of operator and chained expressions', () => {
    const sites = callSitesOf(SERVICE);
    // `a.load().count + helper()`：被调是 helper，不是整个加法表达式；链上的 load 也是一个调用点。
    expect(sites).toEqual(
      expect.arrayContaining(['Service.greet -> helper', 'Service.greet -> other.load'])
    );
    // `factory().send(inner())`：send、factory、inner 各一个调用点。
    expect(sites).toEqual(
      expect.arrayContaining([
        'Service.greet -> factory().send',
        'Service.greet -> factory',
        'Service.greet -> inner',
      ])
    );
    // `!other.isReady()`：前缀运算符不属于接收者。
    expect(sites).toContain('Service.greet -> other.isReady');
    expect(sites.some((site) => site.includes('+') || site.includes('!'))).toBe(false);
  });

  it('exposes init, deinit and subscript as members without counting them as methods', () => {
    const summary = analyzeFile(SERVICE, 'swift');
    const members = (summary?.methods ?? [])
      .filter((method) => method.className === 'Service')
      .map((method) => method.name)
      .sort();
    expect(members).toEqual(['deinit', 'extended', 'greet', 'init', 'subscript']);
    // 方法数量口径不变：只算具名方法（greet、extended、nested）。
    expect(summary?.metrics.methodCount).toBe(3);
  });
});

describe('same-file member resolution for languages with implicit self', () => {
  const roots: string[] = [];
  beforeAll(async () => {
    await loadPlugins();
  });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function resolvedCalls(fileName: string, source: string): Promise<string[]> {
    const projectRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-implicit-member-'))
    );
    roots.push(projectRoot);
    await fs.writeFile(path.join(projectRoot, fileName), source);
    const response = await ProjectContext.execute({
      kind: 'file-flow',
      scope: { projectRoot },
      payload: { filePath: fileName },
    });
    return ((response.data as FileFlowContext).callees ?? [])
      .filter((relation) => !relation.unresolved)
      .map((relation) => `${relation.from?.label} -> ${relation.to?.label}`)
      .sort();
  }

  it('resolves implicit and explicit self calls to members declared in the same file', async () => {
    const calls = await resolvedCalls(
      'Worker.swift',
      [
        'func prepare() {}',
        'final class Worker {',
        '    func run() {',
        '        prepare()',
        '        self.finish()',
        '        validate()',
        '    }',
        '    func prepare() {}',
        '    func finish() {}',
        '}',
        'extension Worker {',
        '    func validate() { finish() }',
        '}',
      ].join('\n')
    );

    expect(calls).toEqual([
      // 成员优先于模块级同名函数。
      'Worker.run -> Worker.finish',
      'Worker.run -> Worker.prepare',
      'Worker.run -> Worker.validate',
      'Worker.validate -> Worker.finish',
    ]);
  });

  it('keeps calls on other receivers unresolved', async () => {
    const calls = await resolvedCalls(
      'Worker.swift',
      [
        'final class Worker {',
        '    func run(other: Worker, names: [String]) {',
        '        other.finish()',
        '        names.joined()',
        '    }',
        '    func finish() {}',
        '}',
      ].join('\n')
    );

    expect(calls).toEqual([]);
  });

  it('does not treat a bare call as a member where the language requires a receiver', async () => {
    const calls = await resolvedCalls(
      'worker.py',
      [
        'def prepare():',
        '    pass',
        '',
        'class Worker:',
        '    def run(self):',
        '        prepare()',
        '        cleanup()',
        '',
        '    def prepare(self):',
        '        pass',
        '',
        '    def cleanup(self):',
        '        pass',
      ].join('\n')
    );

    // Python 的裸调用指向模块级函数；类里的同名方法必须写 self 才是成员调用。
    expect(calls).toEqual(['Worker.run -> prepare']);
  });
});

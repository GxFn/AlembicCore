import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import type { SourceGraphEdge, SourceSymbolNode } from '../src/domain/source-graph/index.js';
import type {
  CodeGraphNativeEdge,
  CodeGraphNativeResult,
} from '../src/infrastructure/analysis/CodeGraphNativeIndex.js';
import * as nativeIndex from '../src/infrastructure/analysis/CodeGraphNativeIndex.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import type { SourceGraphRepositoryImpl } from '../src/repository/source-graph/SourceGraphRepository.js';
import { SourceGraphIndexer, SourceGraphService } from '../src/service/source-graph/index.js';
import { importExternalEdges } from '../src/service/source-graph/SourceGraphExternalEdges.js';

/** 自有符号的最小形态：文件、限定名、种类、起止行。 */
function symbol(
  filePath: string,
  qualifiedName: string,
  kind: string,
  startLine: number,
  endLine = startLine
): SourceSymbolNode {
  return {
    generationId: 'g',
    symbolId: `${filePath}#${qualifiedName}`,
    displayName: qualifiedName.split('.').at(-1) as string,
    qualifiedName,
    kind,
    filePath,
    range: { startLine, startColumn: 0, endLine, endColumn: 0 },
    exported: false,
    imported: false,
    metadata: {},
    provenance: {},
  };
}

/** CodeGraph 交回的一条边；默认是 Swift 里按唯一名解析的调用。 */
function external(
  overrides: Partial<Omit<CodeGraphNativeEdge, 'from' | 'to'>> & {
    from: [file: string, name: string, startLine: number];
    to: [file: string, qualifiedName: string, kind: string, startLine: number];
  }
): CodeGraphNativeEdge {
  const [fromFile, fromName, fromLine] = overrides.from;
  const [toFile, toQualified, toKind, toLine] = overrides.to;
  return {
    kind: 'calls',
    line: fromLine + 1,
    column: 4,
    language: 'swift',
    resolvedBy: 'exact-match',
    confidence: 0.9,
    selfEdge: false,
    ...overrides,
    from: {
      filePath: fromFile,
      name: fromName.split('::').at(-1) as string,
      qualifiedName: fromName,
      kind: 'method',
      startLine: fromLine,
    },
    to: {
      filePath: toFile,
      name: toQualified.split('::').at(-1) as string,
      qualifiedName: toQualified,
      kind: toKind,
      startLine: toLine,
    },
  };
}

const SYMBOLS = [
  symbol('App.swift', 'App', 'class', 1, 20),
  symbol('App.swift', 'App.run', 'method', 2, 10),
  symbol('App.swift', 'App.helper', 'method', 11, 12),
  symbol('App+More.swift', 'App.extra', 'method', 2, 4),
  symbol('Service.swift', 'Service', 'class', 1, 30),
  symbol('Service.swift', 'Service.load', 'method', 3, 5),
  symbol('Service.swift', 'Service.shared', 'property', 2),
  symbol('Service.swift', 'makeService', 'function', 40, 42),
  symbol('Service.swift', 'Loading', 'interface', 50, 52),
];
const FILES = ['App.swift', 'App+More.swift', 'Service.swift', 'Service+Ext.swift'];

function importEdges(
  edges: CodeGraphNativeEdge[],
  options: {
    ownEdges?: SourceGraphEdge[];
    staleFile?: string;
    importStatements?: CodeGraphNativeResult['importStatements'];
  } = {}
) {
  const result: CodeGraphNativeResult = {
    engine: { sdkVersion: '1.6.0', nodeVersion: process.version },
    files: FILES.map((file) => ({
      path: file,
      contentHash: file === options.staleFile ? 'changed' : `hash-${file}`,
      language: 'swift',
    })),
    edges,
    importStatements: options.importStatements ?? [],
    stats: {
      filesIndexed: FILES.length,
      filesErrored: 0,
      unresolvedCalls: 0,
      indexMs: 0,
      totalMs: 0,
    },
  };
  const imported = importExternalEdges({
    generationId: 'g',
    result,
    symbols: SYMBOLS,
    contentHashes: new Map(FILES.map((file) => [file, `hash-${file}`])),
    ownEdges: options.ownEdges ?? [],
  });
  return {
    summary: imported.summary,
    edges: imported.edges.map((edge) => {
      const resolution = edge.metadata?.resolution as { strategy: string; tier: string };
      return `${edge.kind} ${edge.fromSymbolId} -> ${edge.toSymbolId ?? edge.toFilePath} [${resolution.strategy} / ${resolution.tier}]`;
    }),
  };
}

describe('external edge import', () => {
  it('trusts strategies with real evidence and keeps name-only matches as candidates', () => {
    const { edges } = importEdges([
      // 已知类型的成员访问。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service::load', 'method', 3],
        resolvedBy: 'instance-method',
        confidence: 0.9,
        referenceName: 'service.load',
      }),
      // 低置信度的成员访问：只凭方法名唯一。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service::load', 'method', 3],
        line: 5,
        resolvedBy: 'instance-method',
        confidence: 0.7,
        referenceName: 'other.load',
      }),
      // `Type.member`：接收者就是目标所属的类型。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service::load', 'method', 3],
        line: 6,
        resolvedBy: 'instance-method',
        confidence: 0.7,
        referenceName: 'Service.load',
      }),
      // 不带接收者、跨文件撞上别的类型的同名方法。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service::load', 'method', 3],
        line: 7,
        referenceName: 'load',
      }),
      // 不带接收者、连到自由函数。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'makeService', 'function', 40],
        line: 8,
        referenceName: 'makeService',
      }),
      // 隐式 self：extension 文件里调用类型主体的成员。
      external({
        from: ['App+More.swift', 'App::extra', 2],
        to: ['App.swift', 'App::helper', 'method', 11],
        referenceName: 'helper',
      }),
      // 合成的协议分发边没有策略。
      external({
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service::load', 'method', 3],
        line: 9,
        resolvedBy: undefined,
        confidence: undefined,
      }),
    ]);

    expect(edges).toEqual([
      'calls App.swift#App.run -> Service.swift#Service.load [instance-method / trusted]',
      'calls App.swift#App.run -> Service.swift#Service.load [instance-method / candidate]',
      'calls App.swift#App.run -> Service.swift#Service.load [instance-method+type-qualified / trusted]',
      'calls App.swift#App.run -> Service.swift#Service.load [exact-match / candidate]',
      'calls App.swift#App.run -> Service.swift#makeService [exact-match+free-function / trusted]',
      'calls App+More.swift#App.extra -> App.swift#App.helper [exact-match+same-type-member / trusted]',
      'calls App.swift#App.run -> Service.swift#Service.load [synthesized / candidate]',
    ]);
  });

  it('accepts type references only between real declarations of the project', () => {
    const { edges, summary } = importEdges([
      // 实例化项目里的类型。
      external({
        kind: 'instantiates',
        from: ['App.swift', 'App::run', 2],
        to: ['Service.swift', 'Service', 'class', 1],
        referenceName: 'Service',
      }),
      // CodeGraph 连到了 extension 节点：被扩展的类型在项目里有唯一声明，改指向它。
      external({
        kind: 'instantiates',
        from: ['App.swift', 'App::run', 2],
        to: ['Service+Ext.swift', 'Service', 'class', 1],
        line: 4,
        confidence: 0.7,
        referenceName: 'Service',
      }),
      // `Logger(...)` 连到 `extension Logger`：项目里没有 Logger 的声明。
      external({
        kind: 'instantiates',
        from: ['App.swift', 'App::run', 2],
        to: ['Service+Ext.swift', 'Logger', 'class', 9],
        line: 5,
        referenceName: 'Logger',
      }),
      // 继承与协议。
      external({
        kind: 'implements',
        from: ['Service.swift', 'Service', 1],
        to: ['Service.swift', 'Loading', 'protocol', 50],
        line: 1,
        referenceName: 'Loading',
      }),
      // `extension App: Loading` 写在别的文件里：主语是被扩展的 App。
      external({
        kind: 'implements',
        from: ['App+More.swift', 'App', 1],
        to: ['Service.swift', 'Loading', 'protocol', 50],
        line: 1,
        referenceName: 'Loading',
      }),
      // `extension UIView: Loading`：主语是框架类型。
      external({
        kind: 'implements',
        from: ['App+More.swift', 'UIView', 8],
        to: ['Service.swift', 'Loading', 'protocol', 50],
        line: 8,
        referenceName: 'Loading',
      }),
    ]);

    expect(edges).toEqual([
      'calls App.swift#App.run -> Service.swift#Service [exact-match / trusted]',
      'calls App.swift#App.run -> Service.swift#Service [exact-match+extended-type+unique-type / trusted]',
      'implements Service.swift#Service -> Service.swift#Loading [exact-match / trusted]',
      'implements App.swift#App -> Service.swift#Loading [exact-match / trusted]',
    ]);
    expect(summary.dropped).toEqual({
      'type-target-is-not-a-declaration': 1,
      'subject-type-outside-project': 1,
    });
  });

  it('drops what cannot be a fact and defers to edges the own linkers already wrote', () => {
    const own = (line: number, toSymbolId: string, source: string): SourceGraphEdge => ({
      generationId: 'g',
      edgeId: `own-${line}`,
      kind: 'calls',
      fromSymbolId: 'App.swift#App.run',
      toSymbolId,
      fromFilePath: 'App.swift',
      toFilePath: 'App.swift',
      siteFilePath: 'App.swift',
      site: { startLine: line, startColumn: 0, endLine: line, endColumn: 0 },
      provenance: 'deterministic',
      confidence: 1,
      source,
      metadata: {},
    });
    const { edges, summary } = importEdges(
      [
        // `super.run()` 被解析成方法自身。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['App.swift', 'App::run', 'method', 2],
          selfEdge: true,
        }),
        // 类型在自己的属性初始值里创建实例：不是"调用自身"。
        external({
          kind: 'instantiates',
          from: ['Service.swift', 'Service', 1],
          to: ['Service.swift', 'Service', 'class', 1],
          line: 2,
          selfEdge: true,
          referenceName: 'Service',
        }),
        // 自有链接器在同一行已经连到同一个目标。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['App.swift', 'App::helper', 'method', 11],
          line: 4,
          referenceName: 'helper',
        }),
        // 同一行、同一个被调名字，自有链接器给了别的目标：以自有结果为准。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'Service::load', 'method', 3],
          line: 5,
          resolvedBy: 'instance-method',
          confidence: 0.9,
          referenceName: 'thing.helper',
        }),
        // 目标在同文件里却对不上任何声明。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['App.swift', 'App::run::local', 'function', 6],
          line: 6,
        }),
        // 目标在别的文件里对不上声明：留文件级的候选边。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'Service::hidden', 'method', 22],
          line: 7,
          resolvedBy: 'qualified-name',
          confidence: 0.85,
          referenceName: 'Service.hidden',
        }),
        // CodeGraph 读到的内容与索引的不是同一份。
        external({
          from: ['App+More.swift', 'App::extra', 2],
          to: ['App.swift', 'App::helper', 'method', 11],
          referenceName: 'helper',
        }),
        // 目标是框架里的占位节点。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['UIKit/UIKit.h', 'UIKit/UIKit.h', 'import', 1],
          kind: 'imports',
        }),
        // 没核对过准确率的语言。
        external({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'Service::load', 'method', 3],
          language: 'python',
        }),
      ],
      {
        ownEdges: [
          own(4, 'App.swift#App.helper', 'helper'),
          own(5, 'App.swift#App.helper', 'helper'),
        ],
        staleFile: 'App+More.swift',
      }
    );

    expect(edges).toEqual([
      'calls Service.swift#Service.shared -> Service.swift#Service [exact-match / trusted]',
      'calls App.swift#App.run -> Service.swift [qualified-name+unaligned / candidate]',
    ]);
    expect(summary.dropped).toEqual({
      'call-resolved-to-its-own-caller': 1,
      'duplicate-of-own-edge': 1,
      'conflicts-with-own-edge': 1,
      'unaligned-same-file-target': 1,
      'content-changed-since-indexing': 1,
      'target-outside-project': 1,
      'language-not-evaluated': 1,
    });
  });
});

describe('external edges for JavaScript and TypeScript', () => {
  const ts = (overrides: Parameters<typeof external>[0]) =>
    external({ language: 'typescript', ...overrides });
  const statements = [
    {
      filePath: 'App.swift',
      specifier: './local',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
    },
    {
      filePath: 'App.swift',
      specifier: '@/aliased',
      startLine: 2,
      endLine: 2,
      language: 'typescript',
    },
  ];
  // 导入绑定：CodeGraph 为每个导入的名字建一条指向目标声明的 imports 边。
  const bindings = [
    ts({
      kind: 'imports',
      from: ['App.swift', 'App.swift', 1],
      to: ['Service.swift', 'makeService', 'function', 40],
      line: 1,
      resolvedBy: 'import',
      referenceName: 'relative',
    }),
    ts({
      kind: 'imports',
      from: ['App.swift', 'App.swift', 1],
      to: ['Service.swift', 'makeService', 'function', 40],
      line: 2,
      resolvedBy: 'import',
      referenceName: 'aliased',
    }),
  ];

  it('uses the engine only where the own linker has no authority', () => {
    const { edges, summary } = importEdges(
      [
        ...bindings,
        // 相对导入的名字：自有链接器的地盘，它没连就是有理由不连。
        ts({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'makeService', 'function', 40],
          line: 5,
          resolvedBy: 'import',
          referenceName: 'relative',
        }),
        // 路径别名导入的名字：自有链接器解析不了说明符，采用外部结果。
        ts({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'makeService', 'function', 40],
          line: 6,
          resolvedBy: 'import',
          referenceName: 'aliased',
        }),
        // 找不到来源语句的导入名字（default 导入）：无法确认不是相对导入。
        ts({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'makeService', 'function', 40],
          line: 7,
          resolvedBy: 'import',
          referenceName: 'unknownDefault',
        }),
        // 已知类型的局部变量上的成员调用。
        ts({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'Service::load', 'method', 3],
          line: 8,
          resolvedBy: 'instance-method',
          confidence: 0.9,
          referenceName: 'service.load',
        }),
        // 按名字唯一撞上的目标：JS/TS 里不采信，也不留作候选。
        ts({
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'makeService', 'function', 40],
          line: 9,
          referenceName: 'makeService',
        }),
        ts({
          kind: 'instantiates',
          from: ['App.swift', 'App::run', 2],
          to: ['Service.swift', 'Service', 'class', 1],
          line: 10,
          referenceName: 'Service',
        }),
      ],
      { importStatements: statements }
    );

    expect(edges).toEqual([
      // 别名导入本身也是一条文件依赖。
      'imports App.swift#module -> Service.swift [import / trusted]',
      'calls App.swift#App.run -> Service.swift#makeService [import / trusted]',
      'calls App.swift#App.run -> Service.swift#Service.load [instance-method / trusted]',
    ]);
    expect(summary.dropped).toEqual({
      'relative-import-owned-by-own-linker': 2,
      'unconfirmed-import-binding': 1,
      'unproven-js-reference': 2,
    });
    expect(summary.candidate).toBe(0);
  });
});

describe('source graph with the external engine', () => {
  let tmpDir: string;
  let dataRoot: string;
  let runtime: AlembicDatabaseRuntime;
  let repository: SourceGraphRepositoryImpl;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-external-'))
    );
    dataRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-external-data-'))
    );
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: dataRoot, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
    repository = createAlembicRepositories(runtime.connection).sourceGraphRepository;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  function write(files: Record<string, string>): void {
    for (const [repoRelativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(tmpDir, repoRelativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
    }
  }

  const SWIFT_PROJECT = {
    'Sources/Service.swift': [
      'final class Service {',
      '    static func make() -> Service { Service() }',
      '    func load() { prepare() }',
      '    func prepare() {}',
      '}',
    ].join('\n'),
    'Sources/Service+More.swift': ['extension Service {', '    func reload() { load() }', '}'].join(
      '\n'
    ),
    'Sources/App.swift': [
      'final class App {',
      '    func start() {',
      '        let service = Service.make()',
      '        service.load()',
      '        let worker = lookup()',
      '        worker.load()',
      '    }',
      '}',
    ].join('\n'),
  };

  function describeEdges(edges: readonly SourceGraphEdge[]): string[] {
    return edges
      .map((edge) => {
        const resolution = edge.metadata.resolution as { linker: string; tier: string };
        return `${edge.kind} ${edge.fromSymbolId} -> ${edge.toSymbolId} [${resolution.linker} / ${resolution.tier}]`;
      })
      .sort();
  }

  it('adds cross-file Swift relations from the engine next to the own same-file edges', async () => {
    write(SWIFT_PROJECT);
    const input = { projectRoot: tmpDir, codeGraph: { dataRoot } };

    const result = await new SourceGraphIndexer(repository).buildFull({
      ...input,
      generationId: 'external',
    });

    expect(result.snapshot.metadata.externalLinker).toMatchObject({
      engine: 'codegraph',
      status: 'linked',
    });
    expect(describeEdges(result.edges)).toEqual([
      'calls Sources/App.swift#App.start -> Sources/Service.swift#Service.load [codegraph / candidate]',
      'calls Sources/App.swift#App.start -> Sources/Service.swift#Service.load [codegraph / trusted]',
      'calls Sources/App.swift#App.start -> Sources/Service.swift#Service.make [codegraph / trusted]',
      'calls Sources/Service+More.swift#Service.reload -> Sources/Service.swift#Service.load [codegraph / trusted]',
      'calls Sources/Service.swift#Service.load -> Sources/Service.swift#Service.prepare [lexical / certain]',
      'calls Sources/Service.swift#Service.make -> Sources/Service.swift#Service [lexical / certain]',
    ]);
    // 镜像与外部索引库只存在于宿主的私有运行目录，用完即清；目标项目里什么都没写。
    expect(fs.readdirSync(path.join(dataRoot, '.asd/codegraph-sessions'))).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.codegraph'))).toBe(false);

    // 候选边入库，但默认不出现在查询结果里。
    const service = new SourceGraphService(repository);
    const callers = await service.getSourceGraphCallers({
      generationId: 'external',
      symbolId: 'Sources/Service.swift#Service.load',
    });
    expect(callers.edges.map((edge) => [edge.site?.startLine, edge.fromSymbolId]).sort()).toEqual([
      [2, 'Sources/Service+More.swift#Service.reload'],
      [4, 'Sources/App.swift#App.start'],
    ]);
    const withCandidates = await service.getSourceGraphCallers({
      generationId: 'external',
      symbolId: 'Sources/Service.swift#Service.load',
      includeCandidates: true,
    });
    expect(withCandidates.edges).toHaveLength(3);

    // 外部边每一代整体重新导入：内容没变的增量构建得到同样的边。
    fs.writeFileSync(path.join(tmpDir, 'Sources/Other.swift'), 'struct Other {}\n');
    const next = await new SourceGraphIndexer(repository).buildIncremental({
      ...input,
      generationId: 'external-next',
    });
    expect(next.snapshot.metadata.mode).toBe('incremental');
    expect(describeEdges(next.edges)).toEqual(describeEdges(result.edges));
  }, 60_000);

  it('publishes the generation with own edges only when the engine is unavailable', async () => {
    write(SWIFT_PROJECT);
    vi.spyOn(nativeIndex, 'indexWithCodeGraphNative').mockRejectedValue(
      Object.assign(new Error('CodeGraph native worker exited (1).'), { code: 'CODEGRAPH_EXITED' })
    );

    const result = await new SourceGraphIndexer(repository).buildFull({
      projectRoot: tmpDir,
      generationId: 'degraded',
      codeGraph: { dataRoot },
    });

    // 引擎不可用只是少一部分边：这一代照常发布、照常就绪，原因写在代际元数据里。
    expect(result.status.ready).toBe(true);
    expect(result.snapshot.metadata.externalLinker).toEqual({
      engine: 'codegraph',
      rulesVersion: expect.any(String),
      status: 'unavailable',
      reason: 'CodeGraph native worker exited (1).',
    });
    expect(describeEdges(result.edges)).toEqual([
      'calls Sources/Service.swift#Service.load -> Sources/Service.swift#Service.prepare [lexical / certain]',
      'calls Sources/Service.swift#Service.make -> Sources/Service.swift#Service [lexical / certain]',
    ]);
  });

  it('propagates cancellation instead of treating it as an unavailable engine', async () => {
    write(SWIFT_PROJECT);
    const controller = new AbortController();
    const reason = new DOMException('Cancelled while the engine was indexing', 'AbortError');
    vi.spyOn(nativeIndex, 'indexWithCodeGraphNative').mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });

    await expect(
      new SourceGraphIndexer(repository).buildFull({
        projectRoot: tmpDir,
        generationId: 'cancelled',
        codeGraph: { dataRoot },
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ message: reason.message });
    expect(await repository.getSnapshot('cancelled')).toBeNull();
  });
});

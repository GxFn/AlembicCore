// CodeGraph 原生索引子进程：对宿主给出的一个私有目录建索引，把解析出的关系读出来交回。
//
// 这个进程只读它被指向的目录（宿主准备的镜像），索引库也落在那个目录里。它不认识 Alembic 的
// 符号标识，只报告 CodeGraph 自己的节点位置与解析策略；身份、分级和对齐都在宿主一侧完成。
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** 交回的关系种类。contains / references 等结构边由 Alembic 自己的文件事实承担，不取。 */
const EDGE_KINDS = ['calls', 'instantiates', 'extends', 'implements', 'imports'];

const send = (message) =>
  new Promise((resolve, reject) => {
    if (!process.connected) {
      reject(new Error('CodeGraph IPC disconnected.'));
      return;
    }
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });

let sdk;
let tail = Promise.resolve();

async function indexDirectory(root) {
  const started = performance.now();
  const graph = await sdk.CodeGraph.init(root, { index: false });
  try {
    const indexed = await graph.indexAll({});
    if (graph.getPendingReferenceCount() > 0) {
      await graph.resolveReferencesBatched();
    }
    const indexMs = Math.round(performance.now() - started);
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(path.join(root, '.codegraph', 'codegraph.db'), {
      readOnly: true,
    });
    try {
      const files = database
        .prepare('select path, content_hash as contentHash, language from files order by path')
        .all();
      const placeholders = EDGE_KINDS.map(() => '?').join(', ');
      const edges = database
        .prepare(
          `select e.kind as kind, e.line as line, e.col as col, e.metadata as metadata,
                  s.file_path as fromFile, s.name as fromName, s.qualified_name as fromQualifiedName,
                  s.kind as fromKind, s.start_line as fromStartLine, s.language as language,
                  t.id as toId, t.file_path as toFile, t.name as toName,
                  t.qualified_name as toQualifiedName, t.kind as toKind,
                  t.start_line as toStartLine, t.end_line as toEndLine,
                  s.id = t.id as selfEdge
           from edges e join nodes s on s.id = e.source join nodes t on t.id = e.target
           where e.kind in (${placeholders})
           order by s.file_path, e.line, e.col, e.kind, t.file_path, t.start_line, t.qualified_name`
        )
        .all(...EDGE_KINDS)
        .map((row) => {
          let metadata = {};
          try {
            metadata = row.metadata ? JSON.parse(row.metadata) : {};
          } catch {
            metadata = {};
          }
          return {
            kind: row.kind,
            line: row.line ?? undefined,
            column: row.col ?? undefined,
            language: row.language,
            resolvedBy: typeof metadata.resolvedBy === 'string' ? metadata.resolvedBy : undefined,
            confidence: typeof metadata.confidence === 'number' ? metadata.confidence : undefined,
            referenceName: typeof metadata.refName === 'string' ? metadata.refName : undefined,
            selfEdge: row.selfEdge === 1,
            from: {
              filePath: row.fromFile,
              name: row.fromName,
              qualifiedName: row.fromQualifiedName,
              kind: row.fromKind,
              startLine: row.fromStartLine,
            },
            to: {
              filePath: row.toFile,
              name: row.toName,
              qualifiedName: row.toQualifiedName,
              kind: row.toKind,
              startLine: row.toStartLine,
              endLine: row.toEndLine,
            },
          };
        });
      // import 语句本身：说明符与整条语句的行范围。解析成功的导入不一定留有指向占位节点的边，
      // 所以直接读节点。
      const importStatements = database
        .prepare(
          `select file_path as filePath, name as specifier, start_line as startLine,
                  end_line as endLine, language
           from nodes where kind = 'import' order by file_path, start_line`
        )
        .all();
      const unresolved = database
        .prepare(
          `select count(*) as count from unresolved_refs where reference_kind in ('calls', 'instantiates')`
        )
        .get();
      return {
        files,
        edges,
        importStatements,
        stats: {
          filesIndexed: Number(indexed?.filesIndexed ?? files.length),
          filesErrored: Number(indexed?.filesErrored ?? 0),
          unresolvedCalls: Number(unresolved?.count ?? 0),
          indexMs,
          totalMs: Math.round(performance.now() - started),
        },
      };
    } finally {
      database.close();
    }
  } finally {
    graph.close();
  }
}

process.on('message', (message) => {
  tail = tail
    .then(async () => {
      if (message.kind === 'init') {
        sdk = require('@colbymchenry/codegraph');
        sdk.setLogger?.(sdk.silentLogger);
        await send({
          kind: 'ready',
          engine: {
            sdkVersion: require('@colbymchenry/codegraph/package.json').version,
            nodeVersion: process.version,
          },
        });
      } else if (message.kind === 'index') {
        if (!sdk) {
          throw new Error('CodeGraph native worker is not initialized.');
        }
        await send({ kind: 'result', id: message.id, result: await indexDirectory(message.root) });
      } else if (message.kind === 'close') {
        process.disconnect();
      } else {
        throw new Error('Unknown CodeGraph native worker operation.');
      }
    })
    .catch(async (error) => {
      await send({
        kind: 'failure',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    });
});

process.on('disconnect', () => process.exit(0));

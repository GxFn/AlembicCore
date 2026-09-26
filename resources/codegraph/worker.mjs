// 独立进程只接收已绑定版本的文本；SDK索引仅在宿主给出的私有scratch目录初始化。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let graph;
let sdk;
let tail = Promise.resolve();
// 等待IPC写入完成，close不能抢在大结果仍在缓冲时exit并丢失已接受请求的响应。
const send = (message) =>
  new Promise((resolve, reject) => {
    if (!process.connected) {
      reject(new Error('CodeGraph IPC disconnected.'));
      return;
    }
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });

process.on('message', (message) => {
  tail = tail
    .then(async () => {
      if (message.kind === 'init') {
        if (graph) {
          throw new Error('CodeGraph worker was already initialized.');
        }
        // 官方kill switch限定在child环境，不能修改共享宿主process.env。
        if (process.env.CODEGRAPH_KERNEL !== '0') {
          throw new Error('CodeGraph WASM route is not fixed.');
        }
        sdk = require('@colbymchenry/codegraph');
        sdk.setLogger(sdk.silentLogger);
        await sdk.initGrammars();
        await sdk.loadGrammarsForLanguages(['typescript', 'tsx', 'javascript', 'jsx']);
        if (
          ['typescript', 'tsx', 'javascript', 'jsx'].some(
            (language) => !sdk.isGrammarLoaded(language)
          )
        ) {
          throw new Error('CodeGraph required grammar initialization is incomplete.');
        }
        graph = await sdk.CodeGraph.init(message.directory, { index: false });
        await send({
          kind: 'ready',
          engine: {
            sdkVersion: require('@colbymchenry/codegraph/package.json').version,
            platformVersion: require(
              `@colbymchenry/codegraph-${process.platform}-${process.arch}/package.json`
            ).version,
            nodeVersion: process.version,
            processFlags: process.execArgv,
            route: 'wasm',
            workerHash: `sha256:${createHash('sha256')
              .update(await readFile(new URL(import.meta.url)))
              .digest('hex')}`,
          },
        });
      } else if (message.kind === 'extract') {
        if (!graph) {
          throw new Error('CodeGraph worker is not initialized.');
        }
        const language = sdk.detectLanguage(message.filePath, message.source);
        if (!['typescript', 'tsx', 'javascript', 'jsx'].includes(language)) {
          throw new Error(`CodeGraph symbol route does not support ${language ?? 'unknown'}.`);
        }
        const result = graph.extractFromSource(message.filePath, message.source);
        await send({
          kind: 'result',
          id: message.id,
          sourceHash: `sha256:${createHash('sha256').update(message.source).digest('hex')}`,
          result: {
            // 不传updatedAt/duration/私有SDK对象，也不把SDK id当Alembic ref。
            nodes: result.nodes.map((node) => ({
              id: node.id,
              kind: node.kind,
              name: node.name,
              qualifiedName: node.qualifiedName,
              startLine: node.startLine,
              endLine: node.endLine,
              startColumn: node.startColumn,
              endColumn: node.endColumn,
              isExported: node.isExported,
            })),
            errors: result.errors.map((error) =>
              typeof error === 'string' ? error : String(error.message ?? error)
            ),
          },
        });
      } else if (message.kind === 'close') {
        graph?.close();
        graph = undefined;
        process.disconnect();
      } else {
        throw new Error('Unknown CodeGraph worker operation.');
      }
    })
    .catch(async (error) => {
      await send({
        kind: 'failure',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
});

process.on('disconnect', () => {
  try {
    graph?.close();
  } finally {
    process.exit(0);
  }
});

import { fork } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hashBytes } from '../../shared/canonicalJson.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';
import { throwIfSourceReadAborted } from '../io/ProjectSourceReader.js';
import Logger from '../logging/Logger.js';

const workerFile = path.join(RESOURCES_DIR, 'codegraph', 'native-worker.mjs');
const require = createRequire(import.meta.url);

export type CodeGraphNativeEdgeKind =
  | 'calls'
  | 'instantiates'
  | 'extends'
  | 'implements'
  | 'imports';

/** CodeGraph 自己的节点位置；名字与限定名是它的写法（成员用 `Type::member`）。 */
export interface CodeGraphNativeEndpoint {
  filePath: string;
  name: string;
  qualifiedName: string;
  kind: string;
  startLine: number;
  endLine?: number;
}

export interface CodeGraphNativeEdge {
  kind: CodeGraphNativeEdgeKind;
  /** 引用出现的位置：行从 1 起，列从 0 起。 */
  line?: number;
  column?: number;
  language: string;
  /** 解析策略与置信度；没有策略的边是 CodeGraph 合成的分发边。 */
  resolvedBy?: string;
  confidence?: number;
  referenceName?: string;
  selfEdge: boolean;
  from: CodeGraphNativeEndpoint;
  to: CodeGraphNativeEndpoint;
}

export interface CodeGraphNativeResult {
  engine: { sdkVersion: string; nodeVersion: string };
  /** CodeGraph 实际读到的文件与内容哈希（sha256 十六进制），用于核对它分析的是不是同一份内容。 */
  files: { path: string; contentHash: string; language: string }[];
  edges: CodeGraphNativeEdge[];
  /** 每条 import 语句的说明符与行范围（CodeGraph 的 import 节点）。 */
  importStatements: {
    filePath: string;
    specifier: string;
    startLine: number;
    endLine: number;
    language: string;
  }[];
  stats: {
    filesIndexed: number;
    filesErrored: number;
    unresolvedCalls: number;
    indexMs: number;
    totalMs: number;
  };
}

export interface CodeGraphNativeIndexInput {
  /** 宿主的私有数据目录；镜像与索引库建在它下面的固定运行目录里，用完即删。 */
  dataRoot: string;
  /** 要交给 CodeGraph 的文件：镜像内的相对路径 → 真实文件。 */
  files: readonly { relativePath: string; absolutePath: string }[];
  signal?: AbortSignal;
  /** 启动、建索引各自的等待上限；超时后终止子进程。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** 只读取已安装依赖的版本，不启动进程。CodeGraph 没装时抛错，调用方据此降级。 */
export function readCodeGraphNativeVersion(): string {
  const version: unknown = require('@colbymchenry/codegraph/package.json').version;
  if (typeof version !== 'string' || version.length === 0) {
    throw engineError('CODEGRAPH_VERSION', 'CodeGraph SDK version is unavailable.');
  }
  return version;
}

/**
 * 原生路线的身份：SDK 版本与子进程脚本的内容。结果依赖这两者，
 * 任何一个变化都要让依赖它的缓存（索引代际）失效。
 */
export async function readCodeGraphNativeIdentity(): Promise<{
  sdkVersion: string;
  workerHash: `sha256:${string}`;
}> {
  return {
    sdkVersion: readCodeGraphNativeVersion(),
    workerHash: hashBytes(await readFile(workerFile)),
  };
}

/** 宿主私有运行目录：镜像会话建在这里，清单遍历始终跳过它。 */
export function codeGraphRuntimeRoot(dataRoot: string): string {
  return path.resolve(dataRoot, '.asd', 'codegraph-sessions');
}

/**
 * 用 CodeGraph 的原生模式分析一组文件，返回它解析出的关系。
 *
 * 文件以符号链接镜像到私有目录：CodeGraph 看到的项目只包含调用方给出的文件，索引库也落在镜像里，
 * 目标项目目录不会被写入任何东西。一次调用一个子进程，结束（成功、失败、取消）后镜像整体删除。
 */
export async function indexWithCodeGraphNative(
  input: CodeGraphNativeIndexInput
): Promise<CodeGraphNativeResult> {
  throwIfSourceReadAborted(input);
  if (typeof input.dataRoot !== 'string' || !path.isAbsolute(input.dataRoot)) {
    throw new TypeError('CodeGraph dataRoot must be an absolute runtime directory.');
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('CodeGraph timeoutMs must be positive.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw engineError('CODEGRAPH_NODE_VERSION', 'CodeGraph SDK requires Node.js 22.5 or newer.');
  }
  readCodeGraphNativeVersion();

  const requestedRoot = codeGraphRuntimeRoot(input.dataRoot);
  await mkdir(requestedRoot, { recursive: true });
  const runtimeRoot = await realpath(requestedRoot);
  const directory = await mkdtemp(path.join(runtimeRoot, 'native-'));
  try {
    await materializeMirror(directory, input.files, input.signal);
    return await runWorker(directory, timeoutMs, input.signal, major, minor);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function materializeMirror(
  directory: string,
  files: CodeGraphNativeIndexInput['files'],
  signal: AbortSignal | undefined
): Promise<void> {
  const created = new Set<string>();
  let copied = 0;
  for (const file of files) {
    throwIfSourceReadAborted({ signal });
    const target = path.resolve(directory, file.relativePath);
    const relative = path.relative(directory, target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw engineError(
        'CODEGRAPH_MIRROR',
        `Mirror path escapes its directory: ${file.relativePath}`
      );
    }
    const parent = path.dirname(target);
    if (!created.has(parent)) {
      await mkdir(parent, { recursive: true });
      created.add(parent);
    }
    try {
      await symlink(file.absolutePath, target);
    } catch (error) {
      // 没有符号链接权限的平台退回复制；内容哈希核对对两种方式同样有效。
      if (
        !(error && typeof error === 'object' && 'code' in error) ||
        !['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(String(error.code))
      ) {
        throw error;
      }
      await copyFile(file.absolutePath, target);
      copied += 1;
    }
  }
  if (copied > 0) {
    Logger.debug('CodeGraph mirror copied files where symbolic links are unavailable', {
      copied,
      files: files.length,
      reason: 'symlink-not-permitted',
    });
  }
}

function runWorker(
  directory: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  major: number,
  minor: number
): Promise<CodeGraphNativeResult> {
  return new Promise((resolve, reject) => {
    const execArgv =
      (major === 22 && minor < 13) || (major === 23 && minor < 4) ? ['--experimental-sqlite'] : [];
    const child = fork(workerFile, [], {
      cwd: directory,
      // 不继承用户全局的 CodeGraph 开关与 Node 调试/覆盖率选项；遥测关闭。
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !key.toUpperCase().startsWith('CODEGRAPH_') &&
              ![
                'NODE_OPTIONS',
                'NODE_PATH',
                'NODE_DEBUG',
                'NODE_DEBUG_NATIVE',
                'NODE_V8_COVERAGE',
                'NODE_COMPILE_CACHE',
              ].includes(key.toUpperCase())
          )
        ),
        CODEGRAPH_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
      execArgv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    let engine: CodeGraphNativeResult['engine'] | undefined;
    let settled = false;
    let exited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (phase: string) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => finish(engineError('CODEGRAPH_TIMEOUT', `CodeGraph native ${phase} timed out.`)),
        timeoutMs
      );
    };
    const abort = () => {
      const error = new Error(
        signal?.reason instanceof Error ? signal.reason.message : 'CodeGraph analysis cancelled.'
      );
      error.name = 'AbortError';
      finish(error);
    };
    // 结果只在子进程真正退出之后交付：镜像目录随后会被删除，不能留一个仍在写库的进程。
    const finish = (outcome: Error | CodeGraphNativeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const deliver = () => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
      if (exited) {
        deliver();
        return;
      }
      child.once('exit', deliver);
      if (outcome instanceof Error || !child.connected) {
        child.kill('SIGTERM');
      } else {
        child.send({ kind: 'close' }, () => {});
      }
      setTimeout(() => {
        if (!exited) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref();
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8').on('data', (text: string) => {
        Logger.debug('CodeGraph native worker diagnostic', { text: text.slice(0, 2048) });
      });
    }
    child.once('error', (error) => {
      exited = true;
      finish(engineError('CODEGRAPH_PROCESS', error.message));
    });
    child.once('exit', (code, exitSignal) => {
      exited = true;
      finish(
        engineError(
          'CODEGRAPH_EXITED',
          `CodeGraph native worker exited (${code ?? exitSignal ?? 'unknown'}).`
        )
      );
    });
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object' || !('kind' in message)) {
        finish(engineError('CODEGRAPH_PROTOCOL', 'Invalid CodeGraph native worker response.'));
        return;
      }
      if (message.kind === 'ready' && 'engine' in message && isEngine(message.engine)) {
        engine = message.engine;
        arm('indexing');
        child.send({ kind: 'index', id: 1, root: directory });
        return;
      }
      if (message.kind === 'failure') {
        finish(
          engineError(
            'CODEGRAPH_INDEX',
            'message' in message ? String(message.message) : 'CodeGraph native worker failed.'
          )
        );
        return;
      }
      if (message.kind === 'result' && 'result' in message && engine && isResult(message.result)) {
        finish({ engine, ...message.result });
        return;
      }
      finish(engineError('CODEGRAPH_PROTOCOL', 'Unknown CodeGraph native worker response.'));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    arm('startup');
    child.send({ kind: 'init' });
  });
}

function isEngine(value: unknown): value is CodeGraphNativeResult['engine'] {
  return (
    !!value &&
    typeof value === 'object' &&
    'sdkVersion' in value &&
    typeof value.sdkVersion === 'string' &&
    'nodeVersion' in value &&
    typeof value.nodeVersion === 'string'
  );
}

function isEndpoint(value: unknown): value is CodeGraphNativeEndpoint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    ['filePath', 'name', 'qualifiedName', 'kind'].every((key) => typeof record[key] === 'string') &&
    Number.isInteger(record.startLine)
  );
}

function isResult(value: unknown): value is Omit<CodeGraphNativeResult, 'engine'> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.files) &&
    record.files.every(
      (file: unknown) =>
        !!file &&
        typeof file === 'object' &&
        typeof (file as Record<string, unknown>).path === 'string' &&
        typeof (file as Record<string, unknown>).contentHash === 'string'
    ) &&
    Array.isArray(record.importStatements) &&
    record.importStatements.every(
      (statement: unknown) =>
        !!statement &&
        typeof statement === 'object' &&
        typeof (statement as Record<string, unknown>).filePath === 'string' &&
        typeof (statement as Record<string, unknown>).specifier === 'string' &&
        Number.isInteger((statement as Record<string, unknown>).startLine)
    ) &&
    Array.isArray(record.edges) &&
    record.edges.every(
      (edge: unknown) =>
        !!edge &&
        typeof edge === 'object' &&
        typeof (edge as Record<string, unknown>).kind === 'string' &&
        isEndpoint((edge as Record<string, unknown>).from) &&
        isEndpoint((edge as Record<string, unknown>).to)
    ) &&
    !!record.stats &&
    typeof record.stats === 'object'
  );
}

function engineError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

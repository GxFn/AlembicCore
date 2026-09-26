import { type ChildProcess, fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hashBytes, hashCanonicalJson } from '../../shared/canonicalJson.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';
import { throwIfSourceReadAborted } from '../io/ProjectSourceReader.js';
import Logger from '../logging/Logger.js';

const workerFile = path.join(RESOURCES_DIR, 'codegraph', 'worker.mjs');
const require = createRequire(import.meta.url);
const NORMALIZER_VERSION = 'alembic-codegraph-file-analysis-v2';

export interface CodeGraphNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  isExported?: boolean;
}
export interface CodeGraphExtraction {
  nodes: CodeGraphNode[];
  errors: string[];
  references?: CodeGraphCallReference[];
}
export interface CodeGraphCallReference {
  fromNodeId: string;
  referenceName: string;
  referenceKind: 'calls' | 'instantiates';
  line: number;
  column: number;
  /** 完整SDK参考记录的序列化hash；同点位等价组不能忽略未投影的候选信息。 */
  evidenceHash: `sha256:${string}`;
}
export interface CodeGraphIdentity {
  engineHash: `sha256:${string}`;
  engine: {
    sdkVersion: string;
    platformVersion: string;
    nodeVersion: string;
    route: 'wasm';
    workerHash: `sha256:${string}`;
    normalizerVersion: string;
    platform: string;
    languages: string[];
    processFlags: string[];
  };
}
export interface CodeGraphProcessOptions {
  dataRoot: string;
  signal?: AbortSignal;
  /** 限制真实进程启动/提取等待，超时后终止并等待退出，不能继续复用未知状态。 */
  timeoutMs?: number;
}

/** 只读取已安装依赖与worker身份，不启动进程；供共享build在acquire前绑定cache key。 */
export async function getCodeGraphProjectContextIdentity(): Promise<CodeGraphIdentity> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw engineError('CODEGRAPH_NODE_VERSION', 'CodeGraph SDK requires Node.js 22.5 or newer.');
  }
  const sdkVersion: unknown = require('@colbymchenry/codegraph/package.json').version;
  const platformVersion: unknown = require(
    `@colbymchenry/codegraph-${process.platform}-${process.arch}/package.json`
  ).version;
  if (sdkVersion !== '1.6.0' || platformVersion !== sdkVersion) {
    throw engineError(
      'CODEGRAPH_VERSION',
      'CodeGraph SDK and platform package must both be 1.6.0.'
    );
  }
  // SDK官方嵌入说明建议Liftoff-only，避免WASM优化器Zone-OOM；老22/23分支须显式开放node:sqlite。
  const processFlags = ['--max-old-space-size=512', '--liftoff-only'];
  if ((major === 22 && minor < 13) || (major === 23 && minor < 4)) {
    processFlags.push('--experimental-sqlite');
  }
  const engine = {
    sdkVersion,
    platformVersion,
    nodeVersion: process.version,
    route: 'wasm' as const,
    workerHash: hashBytes(await readFile(workerFile)),
    normalizerVersion: NORMALIZER_VERSION,
    platform: `${process.platform}-${process.arch}`,
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    processFlags,
  };
  return { engine, engineHash: hashCanonicalJson(engine) };
}

interface Pending {
  resolve: (result: CodeGraphExtraction) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  sourceHash: string;
}

/** 一个宿主分析作用域拥有一个子进程；关闭与取消均等待真实exit后清理私有目录。 */
export class CodeGraphProcess {
  readonly #child: ChildProcess;
  readonly #ready = Promise.withResolvers<void>();
  readonly #exit = Promise.withResolvers<void>();
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #failure?: Error;
  #closing?: Promise<void>;
  #accepting = true;
  #tail = Promise.resolve();
  #exited = false;
  #removeOwnerSignal = () => {};
  readonly #timeoutMs: number;

  private constructor(
    readonly identity: CodeGraphIdentity,
    readonly runtimeRoot: string,
    private readonly directory: string,
    options: CodeGraphProcessOptions
  ) {
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#child = fork(workerFile, [], {
      cwd: directory,
      // 不继承用户全局CodeGraph开关/索引目录；本worker的提取路由与私有scratch是显式配置。
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('CODEGRAPH_'))
        ),
        CODEGRAPH_KERNEL: '0',
      },
      execArgv: identity.engine.processFlags,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    for (const stream of [this.#child.stdout, this.#child.stderr]) {
      stream?.setEncoding('utf8').on('data', (text: string) => {
        Logger.debug('CodeGraph worker diagnostic', { text: text.slice(0, 2048) });
      });
    }
    this.#child.on('message', (message: unknown) => this.receive(message));
    this.#child.once('error', (error) => {
      this.fail(engineError('CODEGRAPH_PROCESS', error.message));
      this.#exited = true;
      this.#exit.resolve();
    });
    this.#child.once('exit', (code, signal) => {
      this.#exited = true;
      this.fail(
        engineError('CODEGRAPH_EXITED', `CodeGraph worker exited (${code ?? signal ?? 'unknown'}).`)
      );
      this.#exit.resolve();
    });
    const abort = () => {
      const error = abortError(options.signal);
      this.fail(error);
      void this.close(true).catch((error: unknown) => this.logCleanupFailure(error));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    this.#removeOwnerSignal = () => options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) {
      abort();
    }
    this.send({ kind: 'init', directory });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  static async open(options: CodeGraphProcessOptions): Promise<CodeGraphProcess> {
    throwIfSourceReadAborted(options);
    if (typeof options.dataRoot !== 'string' || !path.isAbsolute(options.dataRoot)) {
      throw new TypeError('CodeGraph dataRoot must be an absolute runtime directory.');
    }
    if (!Number.isFinite(options.timeoutMs ?? 30_000) || (options.timeoutMs ?? 30_000) <= 0) {
      throw new TypeError('CodeGraph timeoutMs must be positive.');
    }
    const identity = await getCodeGraphProjectContextIdentity();
    const runtimeRoot = path.resolve(options.dataRoot, '.asd', 'codegraph-sessions');
    await mkdir(runtimeRoot, { recursive: true });
    const directory = await mkdtemp(path.join(runtimeRoot, 'session-'));
    let instance: CodeGraphProcess | undefined;
    try {
      throwIfSourceReadAborted(options);
      instance = new CodeGraphProcess(identity, runtimeRoot, directory, options);
      const current = instance;
      const timer = setTimeout(() => {
        current.fail(
          engineError('CODEGRAPH_TIMEOUT', 'CodeGraph worker initialization timed out.')
        );
        void current.close(true).catch((error: unknown) => current.logCleanupFailure(error));
      }, current.#timeoutMs);
      try {
        await current.#ready.promise;
      } finally {
        clearTimeout(timer);
      }
      throwIfSourceReadAborted(options);
      return current;
    } catch (error) {
      if (instance) {
        await instance.close(true);
      } else {
        await rm(directory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async extract(
    filePath: string,
    source: string,
    signal?: AbortSignal
  ): Promise<CodeGraphExtraction> {
    throwIfSourceReadAborted({ signal });
    if (this.#failure) {
      throw this.#failure;
    }
    if (!this.#accepting) {
      throw engineError('CODEGRAPH_CLOSED', 'CodeGraph worker is closing.');
    }
    // SDK同步解析本来就是串行的；只保持一个在途IPC，避免目录聚合把所有源码再复制进child队列。
    const pending = this.#tail.then(() => this.extractAccepted(filePath, source, signal));
    this.#tail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private extractAccepted(
    filePath: string,
    source: string,
    signal?: AbortSignal
  ): Promise<CodeGraphExtraction> {
    throwIfSourceReadAborted({ signal });
    if (this.#failure) {
      throw this.#failure;
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const stop = (error: Error) => {
        this.fail(error);
        void this.close(true).catch((error: unknown) => this.logCleanupFailure(error));
      };
      const abort = () => stop(abortError(signal));
      const timer = setTimeout(
        () =>
          stop(engineError('CODEGRAPH_TIMEOUT', `CodeGraph extraction timed out for ${filePath}.`)),
        this.#timeoutMs
      );
      signal?.addEventListener('abort', abort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        sourceHash: hashBytes(Buffer.from(source)),
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        },
      });
      this.send({ kind: 'extract', id, filePath, source });
    });
  }

  close(force = false): Promise<void> {
    this.#accepting = false;
    if (force && !this.#exited) {
      this.#child.kill('SIGTERM');
    }
    this.#closing ??= this.finishClose();
    return this.#closing;
  }

  private async finishClose(): Promise<void> {
    // 先停止接单，再排空调用方已经收到Promise的任务；force/timeout会中止当前解析并解除排空。
    await this.#tail;
    if (!this.#exited) {
      this.send({ kind: 'close' });
    }
    const timer = setTimeout(() => {
      if (!this.#exited) {
        this.#child.kill('SIGKILL');
      }
    }, 2_000);
    try {
      await this.#exit.promise;
    } finally {
      this.#removeOwnerSignal();
      clearTimeout(timer);
      await rm(this.directory, { force: true, recursive: true });
    }
  }

  private send(message: object): void {
    if (!this.#child.connected) {
      this.fail(engineError('CODEGRAPH_CHANNEL', 'CodeGraph worker channel is closed.'));
      return;
    }
    this.#child.send(message, (error) => {
      if (error) {
        this.fail(engineError('CODEGRAPH_CHANNEL', error.message));
      }
    });
  }

  private fail(error: Error): void {
    if (!this.#failure) {
      Logger.debug('CodeGraph worker became unavailable', {
        code: 'code' in error ? String(error.code) : error.name,
        reason: error.message,
        closing: Boolean(this.#closing),
        pendingRequests: this.#pending.size,
      });
    }
    this.#failure ??= error;
    this.#ready.reject(this.#failure);
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(this.#failure);
    }
    this.#pending.clear();
  }

  private logCleanupFailure(error: unknown): void {
    Logger.warn('CodeGraph cancellation cleanup failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  private receive(message: unknown): void {
    if (!message || typeof message !== 'object' || !('kind' in message)) {
      this.fail(engineError('CODEGRAPH_PROTOCOL', 'Invalid CodeGraph worker response.'));
      return;
    }
    if (message.kind === 'ready' && 'engine' in message) {
      const { sdkVersion, platformVersion, nodeVersion, route, workerHash, processFlags } =
        this.identity.engine;
      if (
        hashCanonicalJson(message.engine) !==
        hashCanonicalJson({
          sdkVersion,
          platformVersion,
          nodeVersion,
          route,
          workerHash,
          processFlags,
        })
      ) {
        this.fail(
          engineError(
            'CODEGRAPH_IDENTITY',
            'CodeGraph worker identity does not match the accepted runtime.'
          )
        );
      } else {
        this.#ready.resolve();
      }
      return;
    }
    if (message.kind === 'failure') {
      this.fail(
        engineError(
          'CODEGRAPH_EXTRACTION',
          'message' in message ? String(message.message) : 'CodeGraph worker failed.'
        )
      );
      return;
    }
    if (message.kind === 'result' && 'id' in message && typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }
      if (
        !('sourceHash' in message) ||
        message.sourceHash !== pending.sourceHash ||
        !('result' in message) ||
        !isExtraction(message.result)
      ) {
        this.fail(
          engineError('CODEGRAPH_PROTOCOL', 'CodeGraph result does not match its requested source.')
        );
        return;
      }
      this.#pending.delete(message.id);
      pending.cleanup();
      pending.resolve(message.result);
      return;
    }
    this.fail(engineError('CODEGRAPH_PROTOCOL', 'Unknown CodeGraph worker response.'));
  }
}

function isExtraction(value: unknown): value is CodeGraphExtraction {
  if (
    !value ||
    typeof value !== 'object' ||
    !('nodes' in value) ||
    !Array.isArray(value.nodes) ||
    !('errors' in value) ||
    !Array.isArray(value.errors) ||
    !('references' in value) ||
    !Array.isArray(value.references)
  ) {
    return false;
  }
  return (
    value.errors.every((error) => typeof error === 'string') &&
    value.references.every((reference: unknown) => {
      if (!reference || typeof reference !== 'object') {
        return false;
      }
      const ref = reference as Record<string, unknown>;
      return (
        typeof ref.fromNodeId === 'string' &&
        typeof ref.referenceName === 'string' &&
        ['calls', 'instantiates'].includes(String(ref.referenceKind)) &&
        Number.isInteger(ref.line) &&
        Number(ref.line) > 0 &&
        Number.isInteger(ref.column) &&
        Number(ref.column) >= 0 &&
        typeof ref.evidenceHash === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(ref.evidenceHash)
      );
    }) &&
    value.nodes.every((node: unknown) => {
      if (!node || typeof node !== 'object') {
        return false;
      }
      return (
        ['id', 'kind', 'name', 'qualifiedName'].every(
          (key) => key in node && typeof (node as Record<string, unknown>)[key] === 'string'
        ) &&
        'startLine' in node &&
        Number.isInteger(node.startLine) &&
        Number(node.startLine) > 0 &&
        'endLine' in node &&
        Number.isInteger(node.endLine) &&
        Number(node.endLine) >= Number(node.startLine)
      );
    })
  );
}

function engineError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
function abortError(signal?: AbortSignal): Error {
  const error = new Error(
    signal?.reason instanceof Error ? signal.reason.message : 'CodeGraph analysis cancelled.'
  );
  error.name = 'AbortError';
  return error;
}

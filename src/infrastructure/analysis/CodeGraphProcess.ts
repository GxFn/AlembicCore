import { type ChildProcess, fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { hashBytes, hashCanonicalJson } from '../../shared/canonicalJson.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';
import { throwIfSourceReadAborted } from '../io/ProjectSourceReader.js';
import Logger from '../logging/Logger.js';
import { CodeGraphInputChannel, type CodeGraphInputFrame } from './CodeGraphInputChannel.js';
import {
  CODEGRAPH_MAX_SUPPORT_INPUTS,
  type CodeGraphInputReader,
  type CodeGraphProjectInput,
  type CodeGraphProjectResult,
  isCodeGraphProjectResult,
} from './CodeGraphProjectContract.js';

const workerFile = path.join(RESOURCES_DIR, 'codegraph', 'worker.mjs');
const require = createRequire(import.meta.url);
const NORMALIZER_VERSION = 'alembic-codegraph-file-analysis-v8';

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
    projectWorkerHash: `sha256:${string}`;
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
    projectWorkerHash: hashBytes(
      Buffer.concat(
        await Promise.all(
          ['frozen-io.mjs', 'project-analysis.mjs', 'input-bridge.mjs'].map((name) =>
            readFile(path.join(RESOURCES_DIR, 'codegraph', name))
          )
        )
      )
    ),
    normalizerVersion: NORMALIZER_VERSION,
    platform: `${process.platform}-${process.arch}`,
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    processFlags,
  };
  return { engine, engineHash: hashCanonicalJson(engine) };
}

interface Pending {
  resolve: (result: unknown) => void;
  validate: (result: unknown) => boolean;
  reject: (error: Error) => void;
  cleanup: () => void;
  sourceHash: string;
  input?: {
    read: CodeGraphInputReader;
    controller: AbortController;
    active: boolean;
    sequence: number;
    seen: Set<string>;
    pause: () => void;
    resume: () => void;
  };
}

/** 一个宿主分析作用域拥有一个子进程；关闭与取消均等待真实exit后清理私有目录。 */
export class CodeGraphProcess {
  readonly #child: ChildProcess;
  readonly #inputs: CodeGraphInputChannel;
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
        CODEGRAPH_KERNEL: '0',
        CODEGRAPH_PARSE_WORKERS: '1',
        CODEGRAPH_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
      execArgv: identity.engine.processFlags,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
      serialization: 'advanced',
    });
    // Node额外pipe是双向通道；不要复用Node自己管理的IPC fd。
    this.#inputs = new CodeGraphInputChannel(
      this.#child.stdio[4] as Duplex,
      (frame) => {
        void this.receiveInput(frame);
      },
      (error) => {
        if (!this.#exited && (!this.#closing || this.#pending.size > 0)) {
          this.stop(engineError('CODEGRAPH_INPUT_CHANNEL', error.message));
        }
      }
    );
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
    const requestedRoot = path.resolve(options.dataRoot, '.asd', 'codegraph-sessions');
    await mkdir(requestedRoot, { recursive: true });
    // SDK输入使用canonical根；/var与/private/var不能使私有目录防线失效。
    const runtimeRoot = await realpath(requestedRoot);
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
    return this.request(
      { kind: 'extract', filePath, source },
      hashBytes(Buffer.from(source)),
      isExtraction,
      signal
    );
  }

  async analyzeProject(
    input: CodeGraphProjectInput,
    signal?: AbortSignal,
    readInput?: CodeGraphInputReader
  ): Promise<CodeGraphProjectResult> {
    throwIfSourceReadAborted({ signal });
    if (!this.#accepting) {
      throw engineError('CODEGRAPH_CLOSED', 'CodeGraph worker is closing.');
    }
    const pending = this.#tail.then(() =>
      this.request(
        { kind: 'project', input },
        hashBytes(Buffer.from(JSON.stringify(input))),
        isCodeGraphProjectResult,
        signal,
        readInput
      )
    );
    this.#tail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private request<T>(
    message: object,
    sourceHash: string,
    validate: (result: unknown) => result is T,
    signal?: AbortSignal,
    readInput?: CodeGraphInputReader
  ): Promise<T> {
    throwIfSourceReadAborted({ signal });
    if (this.#failure) {
      throw this.#failure;
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const stop = (error: Error) => this.stop(error);
      const abort = () => stop(abortError(signal));
      const controller = new AbortController();
      let remaining = this.#timeoutMs;
      let started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const resume = () => {
        started = performance.now();
        timer = setTimeout(
          () => stop(engineError('CODEGRAPH_TIMEOUT', 'CodeGraph analysis request timed out.')),
          Math.max(0, remaining)
        );
      };
      const pause = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
          remaining -= performance.now() - started;
        }
      };
      resume();
      signal?.addEventListener('abort', abort, { once: true });
      this.#pending.set(id, {
        // receive只在对应validator成功后调用；泛型只存在于本请求闭包，不跨IPC作类型断言。
        resolve: (result) => resolve(result as T),
        validate,
        reject,
        sourceHash,
        ...(readInput
          ? {
              input: {
                read: readInput,
                controller,
                active: false,
                sequence: 0,
                seen: new Set<string>(),
                pause,
                resume,
              },
            }
          : {}),
        cleanup: () => {
          clearTimeout(timer);
          controller.abort();
          signal?.removeEventListener('abort', abort);
        },
      });
      this.send({ ...message, id });
    });
  }

  close(force = false): Promise<void> {
    this.#accepting = false;
    if (force && !this.#exited) {
      this.#inputs.close();
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
      this.#inputs.close();
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

  private stop(error: Error): void {
    this.fail(error);
    void this.close(true).catch((failure: unknown) => this.logCleanupFailure(failure));
  }

  private async receiveInput(frame: CodeGraphInputFrame): Promise<void> {
    const pending = this.#pending.get(frame.projectId);
    const input = pending?.input;
    if (!input || input.active || frame.sequence !== input.sequence + 1) {
      this.stop(
        engineError('CODEGRAPH_PROTOCOL', 'CodeGraph input request has no matching active project.')
      );
      return;
    }
    const key = JSON.stringify(frame.request);
    input.seen.add(key);
    if (input.seen.size > CODEGRAPH_MAX_SUPPORT_INPUTS) {
      this.stop(engineError('CODEGRAPH_INPUT_LIMIT', 'CodeGraph support input budget exceeded.'));
      return;
    }
    input.sequence = frame.sequence;
    input.active = true;
    // 旧路线的reader补齐在SDK尝试外；暂停而不重置SDK的剩余计算时间。
    input.pause();
    try {
      const outcome = await input.read(frame.request, input.controller.signal);
      if (this.#pending.get(frame.projectId) !== pending || input.controller.signal.aborted) {
        Logger.debug('CodeGraph discarded a late input after project cancellation', {
          projectId: frame.projectId,
          sequence: frame.sequence,
        });
        return;
      }
      input.active = false;
      input.resume();
      this.#inputs.reply(frame, outcome, (error) =>
        this.stop(engineError('CODEGRAPH_INPUT_CHANNEL', error.message))
      );
    } catch (error) {
      if (this.#pending.get(frame.projectId) === pending) {
        // Replay缺口/取消/权限错误保留原异常；不让SDK catch把控制失败当模块不存在。
        this.stop(error instanceof Error ? error : new Error(String(error)));
      }
    }
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
      const {
        sdkVersion,
        platformVersion,
        nodeVersion,
        route,
        workerHash,
        projectWorkerHash,
        processFlags,
      } = this.identity.engine;
      if (
        hashCanonicalJson(message.engine) !==
        hashCanonicalJson({
          sdkVersion,
          platformVersion,
          nodeVersion,
          route,
          workerHash,
          projectWorkerHash,
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
        !pending.validate(message.result) ||
        pending.input?.active
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

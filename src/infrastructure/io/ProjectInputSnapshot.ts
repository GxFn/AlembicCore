import path from 'node:path';
import {
  type CanonicalJsonValue,
  hashBytes,
  hashCanonicalJson,
  toCanonicalJson,
} from '../../shared/canonicalJson.js';
import type {
  ProjectSourceConfigurationKind,
  ProjectSourceDirectoryEntry,
  ProjectSourceReader,
  ProjectSourceReadOptions,
  ProjectSourceStat,
} from '../../types/projectSourceReader.js';
import { nodeProjectSourceReader, throwIfSourceReadAborted } from './ProjectSourceReader.js';

export interface ProjectInputRootBinding {
  id: string;
  path: string;
}
export interface ProjectInputPath {
  rootId: string;
  relativePath: string;
}
type InputOperation = 'file' | 'directory' | 'stat' | 'realpath' | ProjectSourceConfigurationKind;
type EntryKind = 'file' | 'directory' | 'symlink' | 'other';
type PortableValue =
  | null
  | boolean
  | number
  | string
  | { text: string }
  | { path: ProjectInputPath }
  | { array: PortableValue[] }
  | { object: [string, PortableValue][] };
type ObservationOutcome = { ok: true; value: CanonicalJsonValue } | { ok: false; code: string };

export interface ProjectInputObservation {
  operation: InputOperation;
  path: ProjectInputPath;
  outcome: ObservationOutcome;
}

/** 只记录事实的输入；源码 inventory 与该支持输入集合相互独立。 */
export interface ProjectInputSnapshot {
  version: 1;
  roots: { id: string; label: string }[];
  observations: ProjectInputObservation[];
  blobs: { hash: `sha256:${string}`; byteLength: number; dataBase64: string }[];
  snapshotHash: `sha256:${string}`;
}

export class ProjectSourceInputUncapturedError extends Error {
  readonly code = 'PROJECT_SOURCE_INPUT_UNCAPTURED';
  constructor(operation: string, target: string) {
    super(`Project source input was not captured: ${operation} ${target}`);
    this.name = 'ProjectSourceInputUncapturedError';
  }
}

export class ProjectSourceInputDriftError extends Error {
  readonly code = 'PROJECT_SOURCE_INPUT_DRIFT';
  constructor(operation: string, target: string) {
    super(`Project source input changed during capture: ${operation} ${target}`);
    this.name = 'ProjectSourceInputDriftError';
  }
}

interface RecordedInput {
  operation: InputOperation;
  absolutePath: string;
  outcome: ObservationOutcome;
  verify: (options?: ProjectSourceReadOptions) => Promise<ObservationOutcome>;
}

/**
 * 每个实际输入只取一次，记录明确的失败/不存在；查目录不施加源码extension/exclude策略。
 * 重放数据只含root标识与相对位置，不携带宿主绝对根。只读支持路径可以位于源码root之外，
 * 但不被提升为源码inventory或可写路径，也绝不能按这些路径物化/写回文件。
 */
export class RecordingProjectSourceReader implements ProjectSourceReader {
  readonly mode = 'record' as const;
  readonly #roots: ProjectInputRootBinding[];
  readonly #records = new Map<string, Promise<RecordedInput>>();
  readonly #blobs = new Map<`sha256:${string}`, Uint8Array>();
  readonly #failures = new Map<string, Error>();

  constructor(
    roots: readonly ProjectInputRootBinding[],
    private readonly delegate: ProjectSourceReader = nodeProjectSourceReader
  ) {
    this.#roots = normalizeRoots(roots);
  }

  async readFile(absolutePath: string, options?: ProjectSourceReadOptions): Promise<Uint8Array> {
    const value = await this.record(
      'file',
      absolutePath,
      async (readOptions) => {
        const bytes = Uint8Array.from(await this.delegate.readFile(absolutePath, readOptions));
        const hash = hashBytes(bytes);
        if (!this.#blobs.has(hash)) {
          this.#blobs.set(hash, bytes);
        }
        return hash;
      },
      options,
      async (verifyOptions) => hashBytes(await this.delegate.readFile(absolutePath, verifyOptions))
    );
    const bytes = this.#blobs.get(value as `sha256:${string}`);
    if (!bytes) {
      throw new TypeError('Captured input file has no byte blob.');
    }
    return Uint8Array.from(bytes);
  }

  async readDirectory(
    absolutePath: string,
    options?: ProjectSourceReadOptions
  ): Promise<ProjectSourceDirectoryEntry[]> {
    const value = await this.record(
      'directory',
      absolutePath,
      async (readOptions) =>
        (await this.delegate.readDirectory(absolutePath, readOptions)).map((entry) => ({
          name: entry.name,
          kind: entryKind(entry),
        })),
      options
    );
    return decodeDirectory(value);
  }

  async stat(absolutePath: string, options?: ProjectSourceReadOptions): Promise<ProjectSourceStat> {
    const value = await this.record(
      'stat',
      absolutePath,
      async (readOptions) => {
        const stat = await this.delegate.stat(absolutePath, readOptions);
        // mtime 是展示信息，不能把一次无内容变化的touch变成事实的新身份。
        return { kind: entryKind(stat), mode: stat.mode, size: stat.size };
      },
      options
    );
    return decodeStat(value);
  }

  async realpath(absolutePath: string, options?: ProjectSourceReadOptions): Promise<string> {
    const value = await this.record(
      'realpath',
      absolutePath,
      async (readOptions) => this.location(await this.delegate.realpath(absolutePath, readOptions)),
      options
    );
    return resolveLocation(value as unknown as ProjectInputPath, this.#roots);
  }

  async readConfiguration<T>(
    kind: ProjectSourceConfigurationKind,
    absolutePath: string,
    load: () => T | Promise<T>
  ): Promise<T> {
    const value = await this.record(kind, absolutePath, async () =>
      this.encode(await this.delegate.readConfiguration(kind, absolutePath, load), kind)
    );
    return decodeValue(value as PortableValue, this.#roots) as T;
  }

  /** 初始源码已由Foundation捕获，分析须复用这些字节，而非再次读取可能变化的live版本。 */
  async seedFile(absolutePath: string, bytes: Uint8Array): Promise<void> {
    const normalized = path.resolve(absolutePath);
    const hash = hashBytes(bytes);
    const key = inputKey('file', normalized);
    const pending = this.#records.get(key);
    if (pending) {
      const recorded = await pending;
      if (recorded.outcome.ok && recorded.outcome.value === hash) {
        return;
      }
      const error = new ProjectSourceInputDriftError('seed-file', normalized);
      this.invalidate(error);
      throw error;
    }
    this.#blobs.set(hash, Uint8Array.from(bytes));
    this.#records.set(
      key,
      Promise.resolve({
        operation: 'file',
        absolutePath: normalized,
        outcome: { ok: true, value: hash },
        verify: (options) =>
          captureOutcome(async () => hashBytes(await this.delegate.readFile(normalized, options))),
      })
    );
    try {
      await this.stat(normalized);
      await this.realpath(normalized);
    } catch (error) {
      this.invalidate(new ProjectSourceInputDriftError('seed-file-metadata', normalized));
      throw error;
    }
  }

  async snapshot(): Promise<ProjectInputSnapshot> {
    const records = await Promise.all(this.#records.values());
    const semantic = {
      version: 1 as const,
      roots: this.#roots.map((root) => ({
        id: root.id,
        label: path.basename(root.path) || root.id,
      })),
      observations: records
        .map((record) => ({
          operation: record.operation,
          path: this.location(record.absolutePath),
          outcome: record.outcome,
        }))
        .sort((left, right) => observationKey(left).localeCompare(observationKey(right))),
      blobs: [...this.#blobs]
        .map(([hash, bytes]) => ({
          hash,
          byteLength: bytes.byteLength,
          dataBase64: Buffer.from(bytes).toString('base64'),
        }))
        .sort((left, right) => left.hash.localeCompare(right.hash)),
    };
    return structuredClone({ ...semantic, snapshotHash: snapshotHash(semantic) });
  }

  async verify(options?: ProjectSourceReadOptions): Promise<void> {
    this.assertComplete();
    for (const record of await Promise.all(this.#records.values())) {
      throwIfSourceReadAborted(options);
      if (hashCanonicalJson(await record.verify(options)) !== hashCanonicalJson(record.outcome)) {
        const error = new ProjectSourceInputDriftError(record.operation, record.absolutePath);
        this.invalidate(error);
        throw error;
      }
    }
    throwIfSourceReadAborted(options);
  }

  assertComplete(): void {
    const failure = this.#failures.values().next().value;
    if (failure) {
      throw failure;
    }
  }

  invalidate(error: Error): void {
    this.#failures.set(`control:${this.#failures.size}`, error);
  }

  private async record(
    operation: InputOperation,
    absolutePath: string,
    load: (options?: ProjectSourceReadOptions) => Promise<unknown>,
    options?: ProjectSourceReadOptions,
    verify = load
  ): Promise<CanonicalJsonValue> {
    throwIfSourceReadAborted(options);
    const normalized = path.resolve(absolutePath);
    const key = inputKey(operation, normalized);
    let pending = this.#records.get(key);
    if (!pending) {
      pending = captureOutcome(() => load(options)).then((outcome) => {
        if (!outcome.ok && !['ENOENT', 'ENOTDIR'].includes(outcome.code)) {
          this.#failures.set(key, inputError(outcome.code, operation, normalized));
        }
        return {
          operation,
          absolutePath: normalized,
          outcome,
          verify: (verifyOptions?: ProjectSourceReadOptions) =>
            captureOutcome(() => verify(verifyOptions)),
        };
      });
      this.#records.set(key, pending);
      void pending.catch(() => {
        if (this.#records.get(key) === pending) {
          this.#records.delete(key);
        }
      });
    }
    const record = await pending;
    throwIfSourceReadAborted(options);
    if (!record.outcome.ok) {
      throw inputError(record.outcome.code, operation, normalized);
    }
    return structuredClone(record.outcome.value);
  }

  private location(absolutePath: string): ProjectInputPath {
    const candidates = this.#roots
      .map((root) => ({
        root,
        relativePath: path.relative(root.path, path.resolve(absolutePath)) || '.',
      }))
      .filter(({ relativePath }) => !path.isAbsolute(relativePath))
      .sort(
        (a, b) =>
          a.relativePath.split(path.sep).filter((part) => part === '..').length -
            b.relativePath.split(path.sep).filter((part) => part === '..').length ||
          a.relativePath.length - b.relativePath.length ||
          a.root.id.localeCompare(b.root.id)
      );
    const best = candidates[0];
    if (!best) {
      throw new ProjectSourceInputUncapturedError('root-binding', absolutePath);
    }
    return { rootId: best.root.id, relativePath: best.relativePath.split(path.sep).join('/') };
  }

  private encode(
    value: unknown,
    kind: ProjectSourceConfigurationKind,
    keys: readonly (string | number)[] = []
  ): PortableValue {
    if (typeof value === 'string') {
      if (
        path.isAbsolute(value) &&
        kind !== 'discoverer-preference' &&
        (isScopeConfigurationPath(keys) ||
          this.#roots.some((root) => isWithinRoot(value, root.path)))
      ) {
        return { path: this.location(value) };
      }
      // /api、Windows形式文本等业务值不是源码路径。以 text 标签保留原字节，
      // 使外层 portability 校验不会误判；旧快照的普通 string 仍然可读。
      return path.isAbsolute(value) || path.win32.isAbsolute(value) ? { text: value } : value;
    }
    if (Array.isArray(value)) {
      return { array: value.map((entry, index) => this.encode(entry, kind, [...keys, index])) };
    }
    // entries 数组有意保留枚举顺序：消费者可以用 Object.keys 决定优先级，
    // canonical JSON 只能规范 wrapper 的键，不能重排作为数据保存的 entries。
    if (value !== null && typeof value === 'object') {
      return {
        object: Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, this.encode(entry, kind, [...keys, key])]),
      };
    }
    const scalar = toCanonicalJson(value);
    if (scalar !== null && typeof scalar === 'object') {
      throw new TypeError('Configuration is not a JSON scalar.');
    }
    return scalar;
  }
}

/** 重放只访问已捕获数据；捕获缺口锁存，即使discoverer的旧catch吞错也无法宣称完整。 */
export class ReplayProjectSourceReader implements ProjectSourceReader {
  readonly mode = 'replay' as const;
  readonly #roots: ProjectInputRootBinding[];
  readonly #records = new Map<string, ProjectInputObservation>();
  readonly #blobs = new Map<string, Uint8Array>();
  #failure?: Error;

  constructor(snapshot: ProjectInputSnapshot, roots: readonly ProjectInputRootBinding[]) {
    this.#roots = normalizeRoots(roots);
    if (
      !Array.isArray(snapshot.roots) ||
      snapshot.roots.some(
        (root) => !root || !isNonEmptyString(root.id) || !isNonEmptyString(root.label)
      )
    ) {
      throw new TypeError('Project input snapshot roots require non-empty string ids and labels.');
    }
    if (snapshot.version !== 1 || snapshotHash(snapshot) !== snapshot.snapshotHash) {
      throw new TypeError('Project input snapshot hash mismatch.');
    }
    const snapshotRootIds = snapshot.roots.map((root) => root.id).sort();
    const bindingRootIds = this.#roots.map((root) => root.id).sort();
    if (
      snapshotRootIds.length !== bindingRootIds.length ||
      snapshotRootIds.some((id, index) => id !== bindingRootIds[index])
    ) {
      throw new TypeError('Project input root bindings do not match snapshot.');
    }
    for (const blob of snapshot.blobs) {
      if (this.#blobs.has(blob.hash)) {
        throw new TypeError('Duplicate project input blob reference.');
      }
      const bytes = Buffer.from(blob.dataBase64, 'base64');
      if (bytes.byteLength !== blob.byteLength || hashBytes(bytes) !== blob.hash) {
        throw new TypeError('Project input byte blob hash mismatch.');
      }
      this.#blobs.set(blob.hash, bytes);
    }
    for (const observation of snapshot.observations) {
      const absolutePath = resolveLocation(observation.path, this.#roots);
      const key = inputKey(observation.operation, absolutePath);
      if (this.#records.has(key)) {
        throw new TypeError('Duplicate project input observation.');
      }
      this.#records.set(key, structuredClone(observation));
      validateOutcome(observation, this.#blobs, this.#roots);
    }
  }

  async readFile(absolutePath: string, options?: ProjectSourceReadOptions): Promise<Uint8Array> {
    const hash = this.read('file', absolutePath, options);
    return Uint8Array.from(this.#blobs.get(String(hash))!);
  }
  async readDirectory(
    absolutePath: string,
    options?: ProjectSourceReadOptions
  ): Promise<ProjectSourceDirectoryEntry[]> {
    return decodeDirectory(this.read('directory', absolutePath, options));
  }
  async stat(absolutePath: string, options?: ProjectSourceReadOptions): Promise<ProjectSourceStat> {
    return decodeStat(this.read('stat', absolutePath, options));
  }
  async realpath(absolutePath: string, options?: ProjectSourceReadOptions): Promise<string> {
    return resolveLocation(
      this.read('realpath', absolutePath, options) as unknown as ProjectInputPath,
      this.#roots
    );
  }
  async readConfiguration<T>(
    kind: ProjectSourceConfigurationKind,
    absolutePath: string,
    _load: () => T | Promise<T>
  ): Promise<T> {
    return decodeValue(this.read(kind, absolutePath) as PortableValue, this.#roots) as T;
  }
  assertComplete(): void {
    if (this.#failure) {
      throw this.#failure;
    }
  }
  invalidate(error: Error): void {
    this.#failure ??= error;
  }

  private read(
    operation: InputOperation,
    absolutePath: string,
    options?: ProjectSourceReadOptions
  ): CanonicalJsonValue {
    throwIfSourceReadAborted(options);
    const record = this.#records.get(inputKey(operation, absolutePath));
    if (!record) {
      const error = new ProjectSourceInputUncapturedError(operation, absolutePath);
      this.#failure ??= error;
      throw error;
    }
    if (!record.outcome.ok) {
      const error = inputError(record.outcome.code, operation, absolutePath);
      if (!['ENOENT', 'ENOTDIR'].includes(record.outcome.code)) {
        this.invalidate(error);
      }
      throw error;
    }
    return structuredClone(record.outcome.value);
  }
}

function normalizeRoots(roots: readonly ProjectInputRootBinding[]): ProjectInputRootBinding[] {
  if (
    !roots.length ||
    roots.some(
      (root) =>
        !root ||
        !isNonEmptyString(root.id) ||
        typeof root.path !== 'string' ||
        !path.isAbsolute(root.path)
    ) ||
    new Set(roots.map((root) => root.id)).size !== roots.length
  ) {
    throw new TypeError('Project input roots require unique ids and absolute runtime paths.');
  }
  return roots
    .map((root) => ({ id: root.id, path: path.resolve(root.path) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function inputKey(operation: InputOperation, absolutePath: string): string {
  return `${operation}\0${path.resolve(absolutePath)}`;
}
function observationKey(observation: ProjectInputObservation): string {
  return `${observation.operation}\0${observation.path.rootId}\0${observation.path.relativePath}`;
}
function snapshotHash(
  snapshot: Omit<ProjectInputSnapshot, 'snapshotHash'> | ProjectInputSnapshot
): `sha256:${string}` {
  return hashCanonicalJson({
    version: snapshot.version,
    roots: snapshot.roots,
    observations: snapshot.observations,
    blobs: snapshot.blobs.map(({ hash, byteLength }) => ({ hash, byteLength })),
  });
}
function resolveLocation(
  location: ProjectInputPath,
  roots: readonly ProjectInputRootBinding[]
): string {
  const root = roots.find((entry) => entry.id === location?.rootId);
  if (
    !root ||
    typeof location.relativePath !== 'string' ||
    path.posix.isAbsolute(location.relativePath) ||
    /^[A-Za-z]:/.test(location.relativePath)
  ) {
    throw new TypeError('Invalid portable project input path.');
  }
  return path.resolve(root.path, ...location.relativePath.split('/'));
}
async function captureOutcome(load: () => Promise<unknown>): Promise<ObservationOutcome> {
  try {
    return { ok: true, value: toCanonicalJson(await load()) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      ok: false,
      code: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
    };
  }
}
function inputError(code: string, operation: string, absolutePath: string): Error {
  return Object.assign(new Error(`${code}: project input ${operation} ${absolutePath}`), {
    code,
    path: absolutePath,
  });
}
function entryKind(
  entry: Pick<ProjectSourceDirectoryEntry, 'isFile' | 'isDirectory' | 'isSymbolicLink'>
): EntryKind {
  return entry.isFile()
    ? 'file'
    : entry.isDirectory()
      ? 'directory'
      : entry.isSymbolicLink()
        ? 'symlink'
        : 'other';
}
function kindMethods(kind: EntryKind) {
  return {
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
  };
}
function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid project input record.');
  }
  return value as Record<string, unknown>;
}
function readKind(value: unknown): EntryKind {
  if (!['file', 'directory', 'symlink', 'other'].includes(String(value))) {
    throw new TypeError('Invalid project input kind.');
  }
  return value as EntryKind;
}
function decodeDirectory(value: unknown): ProjectSourceDirectoryEntry[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid project directory observation.');
  }
  return value.map((item) => {
    const record = readRecord(item);
    if (
      typeof record.name !== 'string' ||
      !record.name ||
      ['.', '..'].includes(record.name) ||
      record.name.includes('/') ||
      record.name.includes('\0')
    ) {
      throw new TypeError('Invalid captured directory entry.');
    }
    return { name: record.name, ...kindMethods(readKind(record.kind)) };
  });
}
function decodeStat(value: unknown): ProjectSourceStat {
  const record = readRecord(value);
  if (
    typeof record.mode !== 'number' ||
    !Number.isInteger(record.mode) ||
    typeof record.size !== 'number' ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0
  ) {
    throw new TypeError('Invalid project stat observation.');
  }
  return { mode: record.mode, size: record.size, ...kindMethods(readKind(record.kind)) };
}
function decodeValue(value: PortableValue, roots: readonly ProjectInputRootBinding[]): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if ('text' in value) {
    if (typeof value.text !== 'string') {
      throw new TypeError('Invalid project configuration text.');
    }
    return value.text;
  }
  if ('path' in value) {
    return resolveLocation(value.path, roots);
  }
  if ('array' in value) {
    return value.array.map((entry) => decodeValue(entry, roots));
  }
  if ('object' in value) {
    return Object.fromEntries(value.object.map(([key, entry]) => [key, decodeValue(entry, roots)]));
  }
  throw new TypeError('Invalid project configuration observation.');
}
function validateOutcome(
  observation: ProjectInputObservation,
  blobs: ReadonlyMap<string, Uint8Array>,
  roots: readonly ProjectInputRootBinding[]
): void {
  // 输入来自 JSON 时不能依赖 TS 联合类型，更不能把 "false" 等 truthy 值当成功。
  if (typeof readRecord(observation.outcome).ok !== 'boolean') {
    throw new TypeError('Project input outcome.ok must be boolean.');
  }
  const value = observation.outcome.ok ? observation.outcome.value : undefined;
  let validateValue: () => void;
  // 单一operation分派先确认协议成员；失败读取也不能借ENOENT跳过合法性校验。
  switch (observation.operation) {
    case 'file':
      validateValue = () => {
        if (typeof value !== 'string' || !blobs.has(value)) {
          throw new TypeError('Missing project input blob.');
        }
      };
      break;
    case 'directory':
      validateValue = () => decodeDirectory(value);
      break;
    case 'stat':
      validateValue = () => decodeStat(value);
      break;
    case 'realpath':
      validateValue = () => resolveLocation(value as unknown as ProjectInputPath, roots);
      break;
    case 'scope-for-folder':
    case 'scope-for-control-root':
    case 'discoverer-preference':
      validateValue = () => decodeValue(value as PortableValue, roots);
      break;
    default:
      throw new TypeError('Unsupported project input operation.');
  }
  if (!observation.outcome.ok) {
    if (!isNonEmptyString(observation.outcome.code)) {
      throw new TypeError('Invalid project input error observation.');
    }
    return;
  }
  validateValue();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isWithinRoot(absolutePath: string, root: string): boolean {
  const relative = path.relative(root, absolutePath);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** scope 路径槽可指向 root 外的支持目录；metadata 仅名为 path 不足以认定为路径。 */
function isScopeConfigurationPath(keys: readonly (string | number)[]): boolean {
  return (
    (keys.length === 1 && keys[0] === 'dataRoot') ||
    (keys.length === 2 &&
      ((keys[0] === 'controlRoot' && keys[1] === 'path') ||
        (keys[0] === 'storage' && keys[1] === 'dataRoot'))) ||
    (keys.length === 3 &&
      keys[0] === 'folders' &&
      typeof keys[1] === 'number' &&
      (keys[2] === 'path' || keys[2] === 'realpath'))
  );
}

import fs from 'node:fs/promises';
import type {
  ProjectSourceDirectoryEntry,
  ProjectSourceReader,
  ProjectSourceReadOptions,
} from '../../types/projectSourceReader.js';

// 仅关联显式signal/发现view facade与原读取器，不保存当前项目或文件事实。
const boundReaderOrigins = new WeakMap<ProjectSourceReader, ProjectSourceReader>();

export function projectSourceReaderIdentity(reader: ProjectSourceReader): ProjectSourceReader {
  return boundReaderOrigins.get(reader) ?? reader;
}

/** 无项目状态的本机默认读取器；记录与重放实例由分析会话拥有。 */
export const nodeProjectSourceReader: ProjectSourceReader = Object.freeze<ProjectSourceReader>({
  mode: 'live' as const,
  async readFile(absolutePath, options) {
    throwIfSourceReadAborted(options);
    return fs.readFile(absolutePath, { signal: options?.signal });
  },
  async readDirectory(absolutePath, options) {
    throwIfSourceReadAborted(options);
    const result = await fs.readdir(absolutePath, { withFileTypes: true });
    throwIfSourceReadAborted(options);
    return result;
  },
  async stat(absolutePath, options) {
    throwIfSourceReadAborted(options);
    const result = await fs.stat(absolutePath);
    throwIfSourceReadAborted(options);
    return result;
  },
  async realpath(absolutePath, options) {
    throwIfSourceReadAborted(options);
    const result = await fs.realpath(absolutePath);
    throwIfSourceReadAborted(options);
    return result;
  },
  async readConfiguration(_kind, _absolutePath, load, options) {
    throwIfSourceReadAborted(options);
    const result = await load(options);
    throwIfSourceReadAborted(options);
    return result;
  },
  assertComplete() {},
  invalidate() {},
});

export async function readSourceText(
  reader: ProjectSourceReader,
  absolutePath: string
): Promise<string> {
  return Buffer.from(await reader.readFile(absolutePath)).toString('utf8');
}

/** 保留既有存在性探测语义；无法重放和取消属于控制错误，不能冒充不存在。 */
export async function sourceExists(
  reader: ProjectSourceReader,
  absolutePath: string
): Promise<boolean> {
  try {
    await reader.stat(absolutePath);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        ('code' in error && error.code === 'PROJECT_SOURCE_INPUT_UNCAPTURED'))
    ) {
      throw error;
    }
    return false;
  }
}

/** 按原同步 some/every 的顺序短路，不能改成 some(async ...) 或额外探测所有路径。 */
export async function someSourceExists(
  reader: ProjectSourceReader,
  absolutePaths: readonly string[]
): Promise<boolean> {
  for (const absolutePath of absolutePaths) {
    if (await sourceExists(reader, absolutePath)) {
      return true;
    }
  }
  return false;
}

export async function everySourceExists(
  reader: ProjectSourceReader,
  absolutePaths: readonly string[]
): Promise<boolean> {
  for (const absolutePath of absolutePaths) {
    if (!(await sourceExists(reader, absolutePath))) {
      return false;
    }
  }
  return true;
}

export function bindProjectSourceReader(
  reader: ProjectSourceReader,
  signal?: AbortSignal
): ProjectSourceReader {
  if (!signal) {
    return reader;
  }
  const readOptions = (options?: ProjectSourceReadOptions): ProjectSourceReadOptions => ({
    ...options,
    // 绑定signal是父级约束；调用方只能收紧取消范围，不能用undefined或新signal解除它。
    signal:
      options?.signal && options.signal !== signal
        ? AbortSignal.any([signal, options.signal])
        : signal,
  });
  const bound: ProjectSourceReader = {
    mode: reader.mode,
    readFile: (file, options) => reader.readFile(file, readOptions(options)),
    readDirectory: (file, options) => reader.readDirectory(file, readOptions(options)),
    stat: (file, options) => reader.stat(file, readOptions(options)),
    realpath: (file, options) => reader.realpath(file, readOptions(options)),
    async readConfiguration(kind, file, load, options) {
      const initialOptions = readOptions(options);
      throwIfSourceReadAborted(initialOptions);
      let active = true;
      try {
        const value = await reader.readConfiguration(
          kind,
          file,
          async (currentOptions) => {
            // 在途请求受父signal约束；后续verify使用它自己的signal，不复活旧请求。
            const effective = active ? readOptions(currentOptions) : currentOptions;
            throwIfSourceReadAborted(effective);
            const result = await load(effective);
            throwIfSourceReadAborted(effective);
            return result;
          },
          initialOptions
        );
        throwIfSourceReadAborted(initialOptions);
        return value;
      } finally {
        // 记录器会保留load用于终态verify；已完成请求的signal不能绑住后续验证。
        active = false;
      }
    },
    assertComplete() {
      // 旧leaf可能把realpath错误降级为invalid-scope，服务出口仍须保留取消语义。
      throwIfSourceReadAborted({ signal });
      reader.assertComplete();
    },
    invalidate: (error) => reader.invalidate(error),
  };
  boundReaderOrigins.set(bound, projectSourceReaderIdentity(reader));
  return bound;
}

/** 发现层过滤在原始记录器之外；snapshot能力、文件版本和失败锁存仍归同一底层reader。 */
export function bindProjectSourceDirectoryView(
  reader: ProjectSourceReader,
  project: (
    directory: string,
    entries: ProjectSourceDirectoryEntry[]
  ) => ProjectSourceDirectoryEntry[]
): ProjectSourceReader {
  const view: ProjectSourceReader = {
    mode: reader.mode,
    readFile: reader.readFile.bind(reader),
    async readDirectory(directory, options) {
      return project(directory, await reader.readDirectory(directory, options));
    },
    stat: reader.stat.bind(reader),
    realpath: reader.realpath.bind(reader),
    readConfiguration: reader.readConfiguration.bind(reader),
    assertComplete: reader.assertComplete.bind(reader),
    invalidate: reader.invalidate.bind(reader),
  };
  boundReaderOrigins.set(view, projectSourceReaderIdentity(reader));
  return view;
}

export function throwIfSourceReadAborted(options?: ProjectSourceReadOptions): void {
  if (!options?.signal?.aborted) {
    return;
  }
  const reason = options.signal.reason;
  const error = new Error(
    reason instanceof Error ? reason.message : 'Project source read cancelled.'
  );
  error.name = 'AbortError';
  throw error;
}

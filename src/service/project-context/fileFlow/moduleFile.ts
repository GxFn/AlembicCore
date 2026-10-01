import path from 'node:path';
import {
  type ModuleResolutionAccess,
  resolveModuleSpecifier,
} from '../../../core/linking/moduleResolver.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import type { FileAnalysisSession } from '../analysis/FileAnalysisSession.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';

export type ModuleFile =
  | { status: 'found'; filePath: string; via: 'relative' | 'alias' | 'package' }
  | { status: 'not-relative' | 'outside-scope' | 'not-found' };

export interface ModuleFileInput {
  importerFile: string;
  projectRoot: string;
  specifier: string;
  extensions: readonly string[];
  reader: ProjectSourceReader;
  signal?: AbortSignal;
  /** 有会话时，配置与 workspace 成员表在会话内只读一次；没有会话的单次调用每次都读。 */
  analysis?: FileAnalysisSession;
}

/**
 * 模块说明符 → 项目内文件。规则只有链接层的那一份（相对路径、路径别名、项目内的包）；
 * 这里提供的是读取通道：配置与候选的存在性都经输入读取器观察，所以 import 关系投影与调用链接
 * 看到的是同一个目标。live 查询读当前文件；认证捕获把读过的配置、探测过的候选（含"不存在"）
 * 记入输入闭包，重放得到同一个结果。
 *
 * 协议只给有语言规则或配置为证的目标：包入口指向构建产物、又没有编译配置能把它换回源码时，
 * 这里不按目录惯例猜，调用保持未解析（索引会把这类目标记为可信档）。
 */
export async function findModuleFile(input: ModuleFileInput): Promise<ModuleFile> {
  throwIfProjectContextAborted(input);
  const resolution = await resolveModuleSpecifier(
    createReaderModuleAccess(input),
    input.importerFile,
    input.specifier,
    { extensions: input.extensions, conventions: false }
  );
  throwIfProjectContextAborted(input);
  if (resolution.status === 'found') {
    return {
      status: 'found',
      filePath: resolution.filePath,
      via:
        resolution.via === 'relative'
          ? 'relative'
          : resolution.via === 'path-alias'
            ? 'alias'
            : 'package',
    };
  }
  return { status: resolution.status === 'external' ? 'not-relative' : resolution.status };
}

/** 经输入读取器实现的解析通道。路径都是项目相对路径；逃出项目根的一律当作不存在。 */
function createReaderModuleAccess(input: {
  projectRoot: string;
  reader: ProjectSourceReader;
  signal?: AbortSignal;
  analysis?: FileAnalysisSession;
}): ModuleResolutionAccess {
  const options = { signal: input.signal };
  const local = new Map<string, Promise<unknown>>();
  const absolute = (relativePath: string): string | undefined => {
    const resolved = path.resolve(input.projectRoot, relativePath);
    const back = path.relative(input.projectRoot, resolved);
    return back.startsWith('..') || path.isAbsolute(back) ? undefined : resolved;
  };
  const isFile = async (relativePath: string): Promise<string | undefined> => {
    throwIfProjectContextAborted(input);
    const target = relativePath ? absolute(relativePath) : undefined;
    if (!target) {
      return undefined;
    }
    try {
      return (await input.reader.stat(target, options)).isFile() ? target : undefined;
    } catch {
      // 读取器已经记下"不存在"；取消不能被当成不存在。
      throwIfProjectContextAborted(input);
      return undefined;
    }
  };
  return {
    async readText(filePath) {
      const target = await isFile(filePath);
      return target
        ? new TextDecoder().decode(await input.reader.readFile(target, options))
        : undefined;
    },
    async hasFile(filePath) {
      return (await isFile(filePath)) !== undefined;
    },
    async listDirectories(directory) {
      throwIfProjectContextAborted(input);
      const target = absolute(directory);
      if (!target) {
        return [];
      }
      try {
        return (await input.reader.readDirectory(target, options))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
      } catch {
        throwIfProjectContextAborted(input);
        return [];
      }
    },
    memo<T>(key: string, create: () => Promise<T>): Promise<T> {
      const scoped = `module-resolution:${input.projectRoot}:${key}`;
      if (input.analysis) {
        return input.analysis.shared(input.reader, scoped, create);
      }
      let pending = local.get(scoped) as Promise<T> | undefined;
      if (!pending) {
        pending = create();
        local.set(scoped, pending);
      }
      return pending;
    },
    note(event, details) {
      Logger.debug('ProjectContext module resolution', { event, ...details });
    },
  };
}

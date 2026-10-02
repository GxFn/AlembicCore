import path from 'node:path';
import {
  type ModuleResolutionAccess,
  resolveModuleSpecifier,
} from '../../../core/linking/moduleResolver.js';
import { isDeclaredProjectSourceFile } from '../../../infrastructure/io/ProjectInputSnapshot.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import { isSourceScanExcludedPath } from '../../../shared/SourceScanExclusions.js';
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

/**
 * 一个已经解析到的模块文件，其内容能不能被这次分析读取。不能时返回原因。
 *
 * 找到文件只需要看它存不存在；顺着它继续读内容（导出表、声明）则要求它是这次分析的源码：
 * - 认证捕获的读取器带着源码清单，清单之外的文件不是这次分析的输入——读了它，
 *   捕获会因为"读到清单外的源码"而整体作废。
 * - 被共享扫描策略排除的目录（构建产物、依赖、coverage 等）里的文件，发现层与索引都不把它
 *   当作项目源码；按内容得出的结论与它们保持同一个范围。
 */
export function moduleFileOutsideAnalysisScope(
  input: Pick<ModuleFileInput, 'projectRoot' | 'reader'>,
  filePath: string
): 'not-in-source-catalog' | 'scan-excluded-directory' | undefined {
  if (
    isDeclaredProjectSourceFile(input.reader, path.resolve(input.projectRoot, filePath)) === false
  ) {
    return 'not-in-source-catalog';
  }
  return isSourceScanExcludedPath(filePath) ? 'scan-excluded-directory' : undefined;
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

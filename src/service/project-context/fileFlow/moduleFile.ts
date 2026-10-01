import path from 'node:path';
import { aliasModuleBases, type ModuleAliasConfig } from '../../../core/linking/moduleAliases.js';
import { moduleSourceCandidates } from '../../../core/linking/moduleTargets.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';

export type ModuleFile =
  | { status: 'found'; filePath: string; via: 'relative' | 'alias' }
  | { status: 'not-relative' | 'outside-scope' | 'not-found' };

/**
 * 模块说明符 → 项目内文件。相对说明符按导入方所在目录解析；非相对说明符只有在别名配置
 * （tsconfig / jsconfig 的 paths、baseUrl）能把它映射到项目内文件时才有目标，否则是包名。
 * 候选顺序来自链接层的唯一规则，存在性经输入读取器观察，因此 import 关系投影与调用链接
 * 看到的是同一个目标，认证捕获也只记录这一组观察。
 */
export async function findModuleFile(input: {
  importerFile: string;
  projectRoot: string;
  specifier: string;
  extensions: readonly string[];
  reader: ProjectSourceReader;
  signal?: AbortSignal;
  /** 导入方适用的别名配置；只在遇到非相对说明符时才会被调用。 */
  aliases?: () => Promise<ModuleAliasConfig | undefined>;
}): Promise<ModuleFile> {
  const relative = input.specifier.startsWith('./') || input.specifier.startsWith('../');
  if (!relative) {
    const config = await input.aliases?.();
    for (const base of config ? aliasModuleBases(config, input.specifier) : []) {
      const filePath = await firstExistingCandidate(base, input);
      if (filePath) {
        return { status: 'found', filePath, via: 'alias' };
      }
    }
    return { status: 'not-relative' };
  }
  const candidateBase = path.posix.normalize(
    path.posix.join(path.posix.dirname(input.importerFile), input.specifier)
  );
  if (!isContainedProjectPath(candidateBase)) {
    return { status: 'outside-scope' };
  }
  const filePath = await firstExistingCandidate(candidateBase, input);
  return filePath ? { status: 'found', filePath, via: 'relative' } : { status: 'not-found' };
}

async function firstExistingCandidate(
  candidateBase: string,
  input: {
    projectRoot: string;
    extensions: readonly string[];
    reader: ProjectSourceReader;
    signal?: AbortSignal;
  }
): Promise<string | undefined> {
  for (const candidate of moduleSourceCandidates(candidateBase, input.extensions)) {
    throwIfProjectContextAborted({ signal: input.signal });
    if (!isContainedProjectPath(candidate)) {
      continue;
    }
    const absolutePath = path.resolve(input.projectRoot, candidate);
    const relativePath = path.relative(input.projectRoot, absolutePath);
    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue;
    }
    if (await isFile(absolutePath, input.reader, input.signal)) {
      throwIfProjectContextAborted({ signal: input.signal });
      return relativePath.split(path.sep).join('/');
    }
  }
  return undefined;
}

function isContainedProjectPath(value: string): boolean {
  return (
    value !== '' && !value.startsWith('../') && value !== '..' && !path.posix.isAbsolute(value)
  );
}

async function isFile(
  filePath: string,
  reader: ProjectSourceReader,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const stat = await reader.stat(filePath, { signal });
    return stat.isFile();
  } catch {
    return false;
  }
}

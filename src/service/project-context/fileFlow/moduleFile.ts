import path from 'node:path';
import { moduleSourceCandidates } from '../../../core/linking/moduleTargets.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';

export type RelativeModuleFile =
  | { status: 'found'; filePath: string }
  | { status: 'not-relative' | 'outside-scope' | 'not-found' };

/**
 * 相对说明符 → 项目内文件。候选顺序来自链接层的唯一规则，存在性经输入读取器观察，
 * 因此 import 关系投影与调用链接看到的是同一个目标，认证捕获也只记录这一组观察。
 */
export async function findRelativeModuleFile(input: {
  importerFile: string;
  projectRoot: string;
  specifier: string;
  extensions: readonly string[];
  reader: ProjectSourceReader;
  signal?: AbortSignal;
}): Promise<RelativeModuleFile> {
  if (!input.specifier.startsWith('./') && !input.specifier.startsWith('../')) {
    return { status: 'not-relative' };
  }
  const candidateBase = path.posix.normalize(
    path.posix.join(path.posix.dirname(input.importerFile), input.specifier)
  );
  if (!isContainedProjectPath(candidateBase)) {
    return { status: 'outside-scope' };
  }
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
      return { status: 'found', filePath: relativePath.split(path.sep).join('/') };
    }
  }
  return { status: 'not-found' };
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

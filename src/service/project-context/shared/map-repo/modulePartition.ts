import path from 'node:path';

/** 划分出的一个模块。路径都是仓库相对路径，仓库根写作 `.`。 */
export interface RepoModulePartition {
  name: string;
  /** 模块目录。一个文件属于路径前缀最长的那个模块。 */
  path: string;
  /**
   * target：发现层给出的构建目标（SPM target、workspace 包…）；
   * area：只有一个目标的仓库里，源码根下的一级目录；
   * root：直接放在源码根或仓库根下、不属于任何一级目录的文件。
   */
  kind: 'target' | 'area' | 'root';
  targetName?: string;
  targetKind?: string;
  files: string[];
}

/**
 * 把仓库的源码文件划分成模块。这是"模块是什么"的唯一规则：
 *
 * - 发现层给出多个有文件的构建目标时，每个目标是一个模块，目录取它的文件的公共目录。
 * - 只有一个目标（或没有）时，目标本身就是整个仓库，按目录再分：源码根下的每个一级目录是一个模块。
 * - 没被目标或一级目录收下的文件归到所在的源码根（或仓库根）。
 *
 * 输出按路径排序；同一个目录不会出现两次，所以"最长路径前缀"能把每个文件唯一地归到一个模块。
 */
export function partitionRepoModules(input: {
  files: readonly { filePath: string; targetName?: string }[];
  targets: readonly { name: string; kind?: string }[];
  /** 源码根目录（如 `src`、`Sources`、`packages/app/src`）。 */
  sourceRoots: readonly string[];
}): RepoModulePartition[] {
  const byTarget = new Map<string, string[]>();
  const untargeted: string[] = [];
  for (const file of input.files) {
    if (file.targetName) {
      byTarget.set(file.targetName, [...(byTarget.get(file.targetName) ?? []), file.filePath]);
    } else {
      untargeted.push(file.filePath);
    }
  }
  const modules = new Map<string, RepoModulePartition>();
  const add = (module: RepoModulePartition) => {
    const existing = modules.get(module.path);
    if (existing) {
      // 两个来源落在同一个目录上：目录只能有一个归属，文件合并，先到的命名保留。
      existing.files.push(...module.files);
      return;
    }
    modules.set(module.path, module);
  };

  if (byTarget.size > 1) {
    const kinds = new Map(input.targets.map((target) => [target.name, target.kind]));
    for (const [targetName, files] of [...byTarget].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const targetKind = kinds.get(targetName);
      add({
        name: targetName,
        path: commonDirectory(files),
        kind: 'target',
        targetName,
        ...(targetKind ? { targetKind } : {}),
        files: [...files],
      });
    }
    for (const module of areasOf(untargeted, input.sourceRoots)) {
      add(module);
    }
  } else {
    for (const module of areasOf(
      input.files.map((file) => file.filePath),
      input.sourceRoots
    )) {
      add(module);
    }
  }
  return [...modules.values()]
    .map((module) => ({ ...module, files: [...new Set(module.files)].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** 文件所属的模块：路径前缀最长的那个；没有任何模块的目录包住它时返回 undefined。 */
export function ownerOfPath<T extends { path: string }>(
  modules: readonly T[],
  filePath: string
): T | undefined {
  let owner: T | undefined;
  let ownerLength = -1;
  for (const module of modules) {
    const root = module.path === '.';
    const inside = root || filePath === module.path || filePath.startsWith(`${module.path}/`);
    const length = root ? 0 : module.path.length;
    if (inside && length > ownerLength) {
      owner = module;
      ownerLength = length;
    }
  }
  return owner;
}

function areasOf(files: readonly string[], sourceRoots: readonly string[]): RepoModulePartition[] {
  // 最长的源码根优先：`packages/app/src` 先于 `packages`。
  const roots = [...new Set(sourceRoots.filter((root) => root && root !== '.'))].sort(
    (left, right) => right.length - left.length
  );
  const modules = new Map<string, RepoModulePartition>();
  for (const filePath of files) {
    const root = roots.find((candidate) => filePath.startsWith(`${candidate}/`));
    const rest = root ? filePath.slice(root.length + 1) : filePath;
    const first = rest.split('/')[0];
    const nested = rest.includes('/');
    const modulePath = nested ? (root ? `${root}/${first}` : first) : (root ?? '.');
    let module = modules.get(modulePath);
    if (!module) {
      module = {
        name: nested ? first : root ? path.posix.basename(root) : 'root',
        path: modulePath,
        kind: nested ? 'area' : 'root',
        files: [],
      };
      modules.set(modulePath, module);
    }
    module.files.push(filePath);
  }
  return [...modules.values()];
}

function commonDirectory(files: readonly string[]): string {
  const [first, ...rest] = files.map((file) => path.posix.dirname(file));
  if (first === undefined) {
    return '.';
  }
  let parts = first === '.' ? [] : first.split('/');
  for (const directory of rest) {
    const current = directory === '.' ? [] : directory.split('/');
    let shared = 0;
    while (shared < parts.length && shared < current.length && parts[shared] === current[shared]) {
      shared += 1;
    }
    parts = parts.slice(0, shared);
  }
  return parts.length > 0 ? parts.join('/') : '.';
}

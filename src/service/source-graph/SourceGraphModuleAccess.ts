import type { ModuleResolutionAccess } from '../../core/linking/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * 索引的模块解析通道：目标与配置都只认本代清单里的文件。
 *
 * 解析读过的每一份配置（tsconfig / jsconfig 及其继承链、package.json、workspace 清单）登记在
 * `consulted` 里——它们的内容决定了链接结果，增量构建据此判断没改内容的源码要不要重新链接。
 * 读不出内容的配置也登记：它被修好之后，解析结果会不一样。
 */
export function createInventoryModuleAccess(input: {
  knownPaths: ReadonlySet<string>;
  readText(filePath: string): Promise<string | undefined>;
  consulted: Set<string>;
}): ModuleResolutionAccess {
  const memo = new Map<string, Promise<unknown>>();
  let childDirectories: Map<string, string[]> | undefined;
  return {
    async readText(filePath) {
      if (!input.knownPaths.has(filePath)) {
        return undefined;
      }
      input.consulted.add(filePath);
      return input.readText(filePath);
    },
    async hasFile(filePath) {
      return input.knownPaths.has(filePath);
    },
    async listDirectories(directory) {
      // 清单里只有文件；目录树从文件路径推出来，整代只算一次。
      childDirectories ??= indexChildDirectories(input.knownPaths);
      return childDirectories.get(directory) ?? [];
    },
    memo<T>(key: string, create: () => Promise<T>): Promise<T> {
      let pending = memo.get(key) as Promise<T> | undefined;
      if (!pending) {
        pending = create();
        memo.set(key, pending);
      }
      return pending;
    },
    note(event, details) {
      Logger.debug('Source graph module resolution', { event, ...details });
    },
  };
}

/** 目录 → 直接子目录名（已排序）。项目根是空串。 */
function indexChildDirectories(knownPaths: ReadonlySet<string>): Map<string, string[]> {
  const children = new Map<string, Set<string>>();
  for (const filePath of knownPaths) {
    const segments = filePath.split('/');
    let parent = '';
    for (const segment of segments.slice(0, -1)) {
      let names = children.get(parent);
      if (!names) {
        names = new Set();
        children.set(parent, names);
      }
      names.add(segment);
      parent = parent ? `${parent}/${segment}` : segment;
    }
  }
  return new Map([...children].map(([directory, names]) => [directory, [...names].sort()]));
}

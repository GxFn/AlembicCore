import path from 'node:path';

/**
 * 用源码语言写的构建清单。它们声明模块（SPM 的 target、Gradle 的子项目、Python 的包），
 * 自己不是哪个模块的源码：repo 的源码文件清单不把它们算作模块源码，认证清单里它们没有所属模块，
 * 读清单归属的宿主也不把"没有归属"当成缺口。清单文件作为归属证据照常进认证清单。
 */
const BUILD_MANIFEST_FILE_NAMES: ReadonlySet<string> = new Set([
  'Package.swift',
  'build.gradle.kts',
  'settings.gradle.kts',
  'setup.py',
]);

/** 仓库相对路径（或文件名）是不是一份构建清单。 */
export function isBuildManifestPath(relativePath: string): boolean {
  return BUILD_MANIFEST_FILE_NAMES.has(path.posix.basename(relativePath));
}

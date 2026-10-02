/**
 * ProjectScope cold-start 的源码扫描共享排除策略。
 *
 * 这些目录代表依赖、构建产物、缓存或 release snapshot，不属于日常
 * ProjectScope source folder 的真实源码输入。各语言 discoverer 可以追加
 * 自己的生态目录，但不能漏掉这里的共享集合。
 */
export const COMMON_SOURCE_SCAN_EXCLUDE_DIRS = [
  '.git',
  '.cursor',
  '.idea',
  '.vscode',
  'node_modules',
  '.venv',
  'venv',
  'Pods',
  'Carthage',
  'dist',
  'build',
  'out',
  '.build',
  'target',
  'DerivedData',
  '.cache',
  '.turbo',
  '.next',
  '.nuxt',
  '__pycache__',
  'coverage',
  'vendor',
] as const;

export function createSourceScanExcludeDirs(
  extraDirs: readonly string[] = []
): ReadonlySet<string> {
  return new Set([...COMMON_SOURCE_SCAN_EXCLUDE_DIRS, ...extraDirs]);
}

export function isSourceScanExcludedDir(
  dirName: string,
  extraDirs: readonly string[] = []
): boolean {
  return createSourceScanExcludeDirs(extraDirs).has(dirName);
}

/**
 * 一个项目相对路径是否落在被共享排除策略排除的目录里。
 * 发现层不会把这样的文件算作源码；顺着 import 找到它的分析也不应该把它当成项目内的目标。
 */
export function isSourceScanExcludedPath(relativePath: string): boolean {
  const directories = relativePath.replaceAll('\\', '/').split('/').slice(0, -1);
  return directories.some((directory) => isSourceScanExcludedDir(directory));
}

import path from 'node:path';

const SOURCE_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/** JS/TS 模块说明符可落到的源码扩展名；顺序即候选优先级。 */
export const MODULE_SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
];

/**
 * 导入目标解析的唯一候选规则。这里只处理已标准化的相对路径，
 * 范围、存在性和输入记录由调用方的 reader/knownPaths 负责，不暗读 tsconfig 或磁盘。
 */
export function moduleSourceCandidates(
  requestedPath: string,
  extensions: readonly string[]
): string[] {
  const extension = path.posix.extname(requestedPath);
  if (extensions.includes(extension) || extension in SOURCE_SUBSTITUTIONS) {
    const stem = requestedPath.slice(0, -extension.length);
    // 真实输出文件优先；带扩展名的specifier不能降成同名目录/index或拼成foo.js.ts。
    return [
      requestedPath,
      ...(SOURCE_SUBSTITUTIONS[extension] ?? [])
        .filter((candidate) => extensions.includes(candidate))
        .map((candidate) => `${stem}${candidate}`),
    ];
  }
  return [
    // feature.v2是合法目录名；未知后缀保留精确文件及目录约定，不把所有点号都当输出扩展。
    ...(extension ? [requestedPath] : []),
    ...extensions.map((candidate) => `${requestedPath}${candidate}`),
    ...extensions.map((candidate) => path.posix.join(requestedPath, `index${candidate}`)),
  ];
}

/**
 * 相对说明符相对导入方文件的标准化基路径。
 * 非相对说明符（包名、别名）和逃出项目根的路径返回 undefined：它们不属于相对导入解析。
 */
export function relativeModuleBase(importerFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && specifier !== '.') {
    return undefined;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerFile), specifier));
  return base === '..' || base.startsWith('../') || path.posix.isAbsolute(base) ? undefined : base;
}

import path from 'node:path';

const SOURCE_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/**
 * 文件观察与SDK索引共用的源码候选顺序。这里只处理已标准化的相对路径，
 * 范围、存在性和输入记录由调用方的reader/knownPaths负责，不暗读tsconfig或磁盘。
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

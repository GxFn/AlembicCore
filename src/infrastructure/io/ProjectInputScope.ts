import path from 'node:path';

/** 宿主拥有目录的声明是作用域输入；复制、去重，避免调用方改数组导致同一会话换策略。 */
export function normalizePrivateDirectories(directories: readonly string[] = []): string[] {
  if (
    directories.some((directory) => typeof directory !== 'string' || !path.isAbsolute(directory))
  ) {
    throw new TypeError('Private input directories must be canonical absolute paths.');
  }
  return [...new Set(directories.map((directory) => path.resolve(directory)))].sort();
}

/** 给只读Git命令声明真实pathspec；不事后裁剪stdout，未声明私有目录时保留原命令语义。 */
export function scopeGitInput(args: string[], cwd: string, privateDirectories: readonly string[]) {
  const excluded = privateDirectories
    .map((directory) => path.relative(cwd, directory))
    .filter(
      (relative) =>
        !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    );
  if (excluded.includes('')) {
    throw new TypeError('A private directory must not replace the source repository.');
  }
  return {
    args: excluded.length
      ? [
          ...args,
          '--',
          '.',
          ...excluded.map((relative) => `:(exclude,literal)${relative.split(path.sep).join('/')}`),
        ]
      : args,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !(
            excluded.length &&
            [
              'GIT_LITERAL_PATHSPECS',
              'GIT_GLOB_PATHSPECS',
              'GIT_NOGLOB_PATHSPECS',
              'GIT_ICASE_PATHSPECS',
            ].includes(key)
          )
      )
    ),
  };
}

import { execFile } from 'node:child_process';
import path from 'node:path';
import { hashCanonicalJson } from '../../shared/canonicalJson.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import { throwIfSourceReadAborted } from './ProjectSourceReader.js';

export interface CodeGraphGitRequest {
  cwd: string;
  args: string[];
  /** 固定分析视图的目录排除；随request重绑定，freshness仍执行真实Git。 */
  excludedDirectories?: string[];
}
export interface CodeGraphGitObservation {
  request: CodeGraphGitRequest;
  status: number;
  stdout: string;
  stderr: string;
  /** rev-parse输出是路径，需按RootBinding重绑定，不能把宿主路径冻结成普通文本。 */
  root?: string;
}

const READ_ONLY_COMMANDS = new Set(
  [
    ['rev-parse', '--show-toplevel'],
    ['rev-parse', '--git-dir'],
    ['ls-files', '-z', '-s', '--recurse-submodules'],
    ['ls-files', '-z', '-o', '--exclude-standard'],
    ['ls-files', '-z', '-o', '--exclude-standard', '--directory'],
    ['ls-files', '-z', '-o', '-i', '--exclude-standard', '--directory'],
  ].map((args) => JSON.stringify(args))
);

/** SDK唯一受支持的子进程输入；源码不作为命令执行，未知Git操作也不能走宿主兜底。 */
export async function readCodeGraphGitInput(
  reader: ProjectSourceReader,
  request: CodeGraphGitRequest,
  options?: { signal?: AbortSignal }
): Promise<CodeGraphGitObservation> {
  throwIfSourceReadAborted(options);
  const checkIgnore =
    request.args.length === 3 &&
    request.args[0] === 'check-ignore' &&
    request.args[1] === '-q' &&
    path.resolve(request.args[2]) === path.resolve(request.cwd);
  if (!READ_ONLY_COMMANDS.has(JSON.stringify(request.args)) && !checkIgnore) {
    throw new Error(`Unsupported CodeGraph Git input: ${request.args.join(' ')}`);
  }
  const relativeArgs = request.args.map((arg) =>
    path.isAbsolute(arg) ? { relative: path.relative(request.cwd, arg) } : arg
  );
  const key = path.join(
    request.cwd,
    '.alembic-codegraph-git-input',
    hashCanonicalJson(
      request.excludedDirectories?.length
        ? {
            args: relativeArgs,
            excludedDirectories: request.excludedDirectories.map((directory) =>
              path.relative(request.cwd, directory).split(path.sep).join('/')
            ),
          }
        : relativeArgs
    ).slice(7)
  );
  // Recorder验证时传入当前verify signal，不能捕获首次调用的旧signal。
  return reader.readConfiguration(
    'codegraph-git',
    key,
    (currentOptions) => observeGit(request, currentOptions),
    options
  );
}

function observeGit(
  request: CodeGraphGitRequest,
  options?: { signal?: AbortSignal }
): Promise<CodeGraphGitObservation> {
  // 用Git自己的literal pathspec约束结果，不伪造stdout，也不把临时数据库列入捕获读集。
  const excludes =
    request.args[0] === 'ls-files'
      ? (request.excludedDirectories ?? [])
          .map((directory) => path.relative(request.cwd, directory))
          .filter(
            (relative) =>
              !path.isAbsolute(relative) &&
              relative !== '..' &&
              !relative.startsWith(`..${path.sep}`)
          )
      : [];
  const args = excludes.length
    ? [
        ...request.args,
        '--',
        '.',
        ...excludes.map(
          (relative) => `:(exclude,literal)${relative.split(path.sep).join('/') || '.'}`
        ),
      ]
    : request.args;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: request.cwd,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        signal: options?.signal,
        // 调用者设置的Git目录不能把当前源码仓库偷偷切到另一个工作树。
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].includes(key) &&
                // 注入literal排除规则时固定Git语义，宿主环境不能把magic变成普通文件名。
                !(
                  excludes.length &&
                  [
                    'GIT_LITERAL_PATHSPECS',
                    'GIT_GLOB_PATHSPECS',
                    'GIT_NOGLOB_PATHSPECS',
                    'GIT_ICASE_PATHSPECS',
                  ].includes(key)
                )
            )
          ),
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
      (error, stdout, stderr) => {
        if (options?.signal?.aborted) {
          try {
            throwIfSourceReadAborted(options);
          } catch (aborted) {
            reject(aborted);
          }
          return;
        }
        if (error && (typeof error.code !== 'number' || error.killed)) {
          reject(error);
          return;
        }
        const status = typeof error?.code === 'number' ? error.code : 0;
        const value: CodeGraphGitObservation = {
          request: structuredClone(request),
          status,
          stdout,
          stderr,
        };
        if (status === 0 && request.args[0] === 'rev-parse' && path.isAbsolute(stdout.trim())) {
          value.root = stdout.trim();
          value.stdout = '';
        }
        resolve(value);
      }
    );
  });
}

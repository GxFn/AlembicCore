/**
 * gitBlob — 读取指定 commit 下某文件的逐字内容(G-C P3:漂移前后区间对比的地基)。
 *
 * 为什么需要它:源锚漂移判定(SourceRefReconciler)只读工作树,能算"现在的区间指纹变了",
 * 但答不出"是行号漂移(内容还在、只是位置动了,可自动修 range)还是内容实变(需重挖)"。
 * 后者需要拿到【漂移前】的文件版本做区间对比——工作树里没有,只能从 git 历史取。
 *
 * 与事故教训一致:execFileSync 同步阻塞事件循环,故带硬超时(git show 在损坏仓/巨仓上可能
 * 长挂);任何失败(非 git 仓/commit 不存在/path 不存在/超时)一律安静返回 null,由调用方
 * 保守处理(拿不到旧版本时不做精判、维持粗粒度 drifted,绝不误判)。
 */
import { execFileSync } from 'node:child_process';

export interface ReadFileAtCommitOptions {
  gitBinary?: string;
  /** 硬超时(ms)。默认 5000——git show 富余,超时即降级 null。 */
  timeoutMs?: number;
  /** 单文件读取上限(字节),超限视为病态返回 null(与 fileFlow 抗病态同哲学)。 */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * `git -C <root> show <commit>:<relPath>` 的安全封装。
 * relPath 必须是 repo 相对、正斜杠路径(git 的 pathspec 口径)。
 * 返回文件在该 commit 的逐字内容;任何失败返回 null。
 */
export function readFileAtCommit(
  projectRoot: string,
  commit: string,
  relPath: string,
  options: ReadFileAtCommitOptions = {}
): string | null {
  const trimmedCommit = commit.trim();
  const normalizedPath = relPath.replaceAll('\\', '/').trim();
  // 基本形态防御:空 commit/path、path 逃逸(..)、绝对路径都不喂给 git。
  if (
    trimmedCommit.length === 0 ||
    normalizedPath.length === 0 ||
    normalizedPath.startsWith('/') ||
    normalizedPath.split('/').includes('..')
  ) {
    return null;
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    const content = execFileSync(
      options.gitBinary ?? 'git',
      ['-C', projectRoot, 'show', `${trimmedCommit}:${normalizedPath}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: maxBytes,
      }
    );
    return content;
  } catch {
    // 非 git 仓 / commit 或 path 不存在 / 超时 / 超 maxBuffer → 保守降级。
    return null;
  }
}

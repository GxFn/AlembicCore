/**
 * CapabilityProbe - 子仓库写入能力探针
 *
 * 通过本地目录/remote 状态和 `git push --dry-run` 探测当前工作区的写入范围。
 * 探测结果被缓存（默认 24h）以避免重复执行。
 *
 * 子仓库默认指向 `Alembic/recipes/`（可通过 config 或 options 自定义）。
 * 探测路径解析优先级：
 *   1. 构造函数 options.subRepoPath（显式指定）
 *   2. `.asd/config.json` 中 `core.subRepoDir`
 *   3. 默认 `Alembic/recipes`
 *
 * 三种探测结果只描述写入范围，不表达产品职责角色：
 *   'local-write'  — 本地项目或无 remote 且策略允许本地写入
 *   'remote-write' — remote dry-run 表明当前 checkout 可推送
 *   'read-only'    — 严格无 remote、dry-run 被拒绝或探测不确定
 *
 * 当没有 remote 时根据 noRemote 策略决定：
 *   'allow' (默认) — 本地开发，返回 local-write
 *   'deny'          — 严格模式，返回 read-only
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import Logger from '../../infrastructure/logging/Logger.js';
import { readSubRepoUrlFromConfig, resolveSubRepoPath } from '../../shared/ProjectMarkers.js';
import { resolveProjectRoot } from '../../shared/resolveProjectRoot.js';

export type CapabilityProbeResult = 'local-write' | 'remote-write' | 'read-only';

export type CapabilityProbeReason =
  | 'no-sub-repo'
  | 'not-git-repo'
  | 'no-remote-allowed'
  | 'no-remote-denied'
  | 'push-dry-run-ok'
  | 'push-denied'
  | 'push-inconclusive'
  | 'probe-error';

export interface CapabilityProbeStatus {
  result: CapabilityProbeResult;
  canWrite: boolean;
  reason: CapabilityProbeReason;
  detail: string;
}

export interface ProbeCache {
  status: CapabilityProbeStatus;
  cachedAt: number;
  expiresAt: number;
}

export interface CapabilityProbeOptions {
  subRepoPath?: string;
  cacheTTL?: number;
  noRemote?: 'allow' | 'deny';
}

export class CapabilityProbe {
  subRepoPath: string | null;
  _cache: ProbeCache | null;
  cacheTTL: number;
  logger;
  noRemote: 'allow' | 'deny';
  /**
   * @param [options.subRepoPath] 子仓库根路径（默认 cwd/Alembic）
   * @param [options.cacheTTL] 缓存 TTL（秒），默认 86400
   * @param [options.noRemote] 无 remote 策略: 'allow' | 'deny'
   */
  constructor(options: CapabilityProbeOptions = {}) {
    this.logger = Logger.getInstance();
    this.subRepoPath = options.subRepoPath || this._detectSubRepo();
    this.cacheTTL = (options.cacheTTL ?? 86400) * 1000; // 转为 ms
    this.noRemote = options.noRemote || 'allow';

    this._cache = null;
  }

  // ═══════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════

  /** 执行探测，返回当前 checkout 的写入范围。 */
  probe(): CapabilityProbeResult {
    return this.probeStatus().result;
  }

  /** 执行探测，返回写入范围和判定原因。 */
  probeStatus(): CapabilityProbeStatus {
    // 命中缓存
    if (this._cache && Date.now() < this._cache.expiresAt) {
      this.logger.debug('CapabilityProbe: cache hit', { result: this._cache.status.result });
      return this._cache.status;
    }

    const status = this._runProbe();
    this._cache = {
      status,
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.cacheTTL,
    };

    this.logger.info('CapabilityProbe: probed', {
      subRepoPath: this.subRepoPath,
      result: status.result,
      reason: status.reason,
      canWrite: status.canWrite,
    });

    return status;
  }

  /** 获取当前缓存状态（for dashboard display） */
  getCacheStatus() {
    if (!this._cache) {
      return { cached: false };
    }
    return {
      cached: true,
      result: this._cache.status.result,
      canWrite: this._cache.status.canWrite,
      reason: this._cache.status.reason,
      detail: this._cache.status.detail,
      cachedAt: this._cache.cachedAt,
      expiresAt: this._cache.expiresAt,
      expired: Date.now() >= this._cache.expiresAt,
    };
  }

  /** 清除缓存（强制下次重新探测） */
  invalidate() {
    this._cache = null;
  }

  // ═══════════════════════════════════════════════════
  //  Internal
  // ═══════════════════════════════════════════════════

  /**
   * 自动检测子仓库路径
   * 优先级：config.json > 默认 Alembic/recipes
   */
  _detectSubRepo(): string | null {
    const effectiveRoot = resolveProjectRoot();
    const resolved = resolveSubRepoPath(effectiveRoot);

    // 检查目标路径是否存在
    if (fs.existsSync(resolved)) {
      return resolved;
    }

    return null;
  }

  /** 执行实际探测 */
  _runProbe(): CapabilityProbeStatus {
    // Case 1: 子仓库路径不存在 → 本地项目可继续写入本地工作区
    if (!this.subRepoPath || !fs.existsSync(this.subRepoPath)) {
      this.logger.debug('CapabilityProbe: no sub-repo - using local write scope');
      return this._status('local-write', 'no-sub-repo', 'Sub-repository path is absent.');
    }

    // Case 2: 检查是否是 git 仓库
    const isGitRepo = this._isGitRepo(this.subRepoPath);
    if (!isGitRepo) {
      // 有目录但不是 git 仓库 → 本地项目（alembic setup 创建），可继续写入本地工作区
      this.logger.debug('CapabilityProbe: directory exists but not a git repo - local write scope');
      return this._status('local-write', 'not-git-repo', 'Sub-repository path is not a git repo.');
    }

    // Case 3: 检查是否有 remote
    const hasRemote = this._hasRemote(this.subRepoPath);
    if (!hasRemote) {
      // 无 remote，根据策略决定
      this.logger.debug('CapabilityProbe: no remote', { noRemote: this.noRemote });
      return this.noRemote === 'allow'
        ? this._status('local-write', 'no-remote-allowed', 'No remote is configured.')
        : this._status('read-only', 'no-remote-denied', 'No remote is configured in strict mode.');
    }

    // Case 4: 有 remote → 执行 git push --dry-run 探测写权限
    try {
      return this._probePush(this.subRepoPath);
    } catch (err: unknown) {
      this.logger.warn('CapabilityProbe: push probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this._status('read-only', 'probe-error', 'Push dry-run probe failed.');
    }
  }

  _status(
    result: CapabilityProbeResult,
    reason: CapabilityProbeReason,
    detail: string
  ): CapabilityProbeStatus {
    return {
      result,
      canWrite: result !== 'read-only',
      reason,
      detail,
    };
  }

  _isGitRepo(repoPath: string): boolean {
    // 检查是否是独立的 git 仓库（有自己的 .git 目录/文件），
    // 而非仅仅位于父项目 git 仓库内
    return fs.existsSync(`${repoPath}/.git`);
  }

  _hasRemote(repoPath: string): boolean {
    // 快速路径：config 有 subRepoUrl 即认为有 remote
    try {
      const effectiveRoot = resolveProjectRoot();
      const url = readSubRepoUrlFromConfig(effectiveRoot);
      if (url) {
        return true;
      }
    } catch {
      /* 读取失败走原有逻辑 */
    }

    try {
      const output = execSync('git remote', {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: 5000,
        encoding: 'utf8',
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** git push --dry-run 探测 */
  _probePush(repoPath: string): CapabilityProbeStatus {
    try {
      execSync('git push --dry-run 2>&1', {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: 15000,
        encoding: 'utf8',
      });
      // 成功 → remote 写入探测通过
      return this._status('remote-write', 'push-dry-run-ok', 'Push dry-run completed.');
    } catch (err: unknown) {
      const execErr = err as {
        stderr?: string | Buffer;
        stdout?: string | Buffer;
        message?: string;
      };
      const stderr = (execErr.stderr || execErr.stdout || execErr.message || '').toString();
      // "Everything up-to-date" 也算成功
      if (stderr.includes('Everything up-to-date') || stderr.includes('up to date')) {
        return this._status('remote-write', 'push-dry-run-ok', 'Push dry-run is up to date.');
      }
      // 明确被拒绝
      if (
        stderr.includes('permission') ||
        stderr.includes('denied') ||
        stderr.includes('403') ||
        stderr.includes('401')
      ) {
        return this._status('read-only', 'push-denied', 'Push dry-run was denied.');
      }
      // 网络错误等 → 降级为只读，避免把不确定状态解释成可写。
      this.logger.debug('CapabilityProbe: push dry-run inconclusive', {
        stderr: stderr.slice(0, 200),
      });
      return this._status('read-only', 'push-inconclusive', 'Push dry-run was inconclusive.');
    }
  }
}

export default CapabilityProbe;

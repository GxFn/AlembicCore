import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PACKAGE_ROOT } from '../shared/packageRoot.js';
import { WorkspaceResolver } from '../shared/WorkspaceResolver.js';

export const DAEMON_STATE_SCHEMA_VERSION = 1;

export interface DaemonPaths {
  dataRoot: string;
  jobsDir: string;
  lockDir: string;
  logPath: string;
  pidPath: string;
  projectId: string | null;
  projectRoot: string;
  runtimeDir: string;
  statePath: string;
}

export interface DaemonState {
  schemaVersion: number;
  projectRoot: string;
  dataRoot: string;
  projectId: string | null;
  pid: number;
  host: string;
  port: number;
  url: string;
  dashboardUrl: string;
  token: string;
  version: string;
  mode: 'daemon';
  startedAt: string;
  lastReadyAt: string;
  databasePath: string;
  schemaMigrationVersion: string | null;
  /**
   * daemon 自注册的入口脚本绝对路径（daemon-server 启动时写入）。
   * 供外部（如插件 MCP 的 ensure-on-use 自启）在 daemon 退出后按同款入口重新拉起；
   * 仅插件形态（无主体安装）没有该入口，消费方必须容缺降级。旧状态文件无此字段。
   */
  entrypoint?: string | null;
  /**
   * 启动 daemon 的 Node 可执行绝对路径。nvm/多版本场景下 PATH 不可靠，
   * 重新拉起时优先复用同一 Node；容缺（老状态文件/异常写入）。
   */
  execPath?: string | null;
}

export function getPackageVersion(): string {
  try {
    const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function resolveDaemonPaths(projectRoot: string): DaemonPaths {
  // @scope-singleroot(permanent) — daemon state is per-runtime-instance, not project-space data.
  const resolver = WorkspaceResolver.fromProject(projectRoot);
  return {
    projectRoot: resolver.projectRoot,
    dataRoot: resolver.dataRoot,
    projectId: resolver.projectId,
    runtimeDir: resolver.runtimeDir,
    statePath: join(resolver.runtimeDir, 'daemon.json'),
    pidPath: join(resolver.runtimeDir, 'daemon.pid'),
    lockDir: join(resolver.runtimeDir, 'daemon.lock'),
    logPath: join(resolver.runtimeDir, 'daemon.log'),
    jobsDir: join(resolver.runtimeDir, 'jobs'),
  };
}

export function ensureDaemonDirs(paths: DaemonPaths): void {
  mkdirSync(paths.runtimeDir, { recursive: true });
  mkdirSync(paths.jobsDir, { recursive: true });
}

export function readDaemonState(statePath: string): DaemonState | null {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<DaemonState>;
    if (
      parsed.schemaVersion !== DAEMON_STATE_SCHEMA_VERSION ||
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0
    ) {
      return null;
    }
    return parsed as DaemonState;
  } catch {
    return null;
  }
}

export function writeDaemonState(statePath: string, state: DaemonState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, statePath);
}

export function removeDaemonState(
  paths: Pick<DaemonPaths, 'statePath' | 'pidPath' | 'lockDir'>,
  options: { includeLock?: boolean } = {}
) {
  rmSync(paths.statePath, { force: true });
  rmSync(paths.pidPath, { force: true });
  if (options.includeLock !== false) {
    rmSync(paths.lockDir, { recursive: true, force: true });
  }
}

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

/**
 * daemon 入口注册表（daemon-entrypoint.json）——与运行状态 daemon.json 分离的
 * "最后已知入口"持久层。daemon 优雅退出会清理 daemon.json（连同其中的
 * entrypoint 自注册字段），导致外部 ensure-on-use 自启在 graceful kill 后失忆；
 * 注册表只在 daemon 启动时覆盖写、退出**不**清理，专供自启解析 fallback。
 */
export interface DaemonEntrypointRegistry {
  /** daemon 入口脚本绝对路径 */
  entrypoint: string;
  /** 启动该 daemon 的 Node 可执行绝对路径（nvm 多版本场景 PATH 不可靠） */
  execPath: string;
  /** 最近一次注册（daemon 启动）时刻 ISO */
  registeredAt: string;
  /** 注册时的 daemon 版本（诊断用） */
  version: string;
}

export function resolveDaemonEntrypointRegistryPath(runtimeDir: string): string {
  return join(runtimeDir, 'daemon-entrypoint.json');
}

export function writeDaemonEntrypointRegistry(
  runtimeDir: string,
  registry: DaemonEntrypointRegistry
): void {
  const registryPath = resolveDaemonEntrypointRegistryPath(runtimeDir);
  mkdirSync(dirname(registryPath), { recursive: true });
  const tmpPath = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmpPath, registryPath);
}

export function readDaemonEntrypointRegistry(runtimeDir: string): DaemonEntrypointRegistry | null {
  const registryPath = resolveDaemonEntrypointRegistryPath(runtimeDir);
  if (!existsSync(registryPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, unknown>;
    if (
      typeof parsed.entrypoint !== 'string' ||
      parsed.entrypoint.length === 0 ||
      typeof parsed.execPath !== 'string' ||
      parsed.execPath.length === 0
    ) {
      return null;
    }
    return {
      entrypoint: parsed.entrypoint,
      execPath: parsed.execPath,
      registeredAt: typeof parsed.registeredAt === 'string' ? parsed.registeredAt : '',
      version: typeof parsed.version === 'string' ? parsed.version : '',
    };
  } catch {
    return null;
  }
}

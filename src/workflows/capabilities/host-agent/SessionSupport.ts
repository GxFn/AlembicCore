/**
 * SessionSupport — SessionManager 单例获取与项目分析 Session 缓存
 *
 * 为冷启动和增量扫描提供 BootstrapSessionManager 的单例解析，
 * 以及 Phase 1-4 分析结果的缓存，供后续维度执行复用。
 */

import path from 'node:path';
import { resolveDataRoot } from '../../../shared/resolveProjectRoot.js';
import type { DimensionDef, ProjectSnapshot } from '../../../types/ProjectSnapshot.js';
import { toSessionCache } from '../../../types/SnapshotViews.js';
import { BootstrapSessionManager } from './BootstrapSession.js';

// ═══════════════════════════════════════════════════════════
// §1 — WorkflowSessionManagerProvider
// ═══════════════════════════════════════════════════════════

interface SessionManagerContainer {
  get(name: string): unknown;
  register?: (name: string, factory: () => unknown) => void;
}

// Blessed lazy lifecycle (AD4 'bootstrap-session-manager'): one manager per
// dataRoot so host-agent sessions survive MCP/Core process restarts without
// mixing project leases.
const sessionManagers = new Map<string, BootstrapSessionManager>();

export function getOrCreateSessionManager(
  container: SessionManagerContainer
): BootstrapSessionManager {
  try {
    const manager = container.get('bootstrapSessionManager');
    if (manager) {
      return manager as BootstrapSessionManager;
    }
  } catch {
    // Not registered yet.
  }

  const dataRoot = resolveSessionDataRoot(container);
  const managerKey = dataRoot ?? '__memory__';
  let sessionManager = sessionManagers.get(managerKey);
  if (!sessionManager) {
    sessionManager = new BootstrapSessionManager({ dataRoot });
    sessionManagers.set(managerKey, sessionManager);
  }

  try {
    container.register?.('bootstrapSessionManager', () => sessionManager);
  } catch {
    // Already registered or container does not support registration.
  }

  return sessionManager;
}

export function _resetBootstrapSessionManagersForTesting(): void {
  sessionManagers.clear();
}

function resolveSessionDataRoot(container: SessionManagerContainer): string | null {
  try {
    return resolveDataRoot(container as never);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// §2 — WorkflowSessionCache
// ═══════════════════════════════════════════════════════════

export type WorkflowSessionContainer = Parameters<typeof getOrCreateSessionManager>[0];

interface WorkflowSessionLogger {
  warn(message: string): void;
}

export function cacheProjectAnalysisSession(opts: {
  container: WorkflowSessionContainer;
  projectRoot: string;
  dimensions: DimensionDef[];
  snapshot: ProjectSnapshot;
  primaryLang: string | null;
  fileCount: number;
  moduleCount: number;
  logger: WorkflowSessionLogger;
  logPrefix: string;
}): string | null {
  try {
    const sessionManager = getOrCreateSessionManager(opts.container);
    const session = sessionManager.createSession({
      projectRoot: opts.projectRoot,
      dimensions: opts.dimensions.map((dimension) => ({
        ...dimension,
        skillMeta: dimension.skillMeta ?? undefined,
      })),
      projectContext: {
        projectName: path.basename(opts.projectRoot),
        primaryLang: opts.primaryLang,
        fileCount: opts.fileCount,
        modules: opts.moduleCount,
      },
    });
    session.setSnapshotCache(toSessionCache(opts.snapshot));
    return session.id;
  } catch (err: unknown) {
    opts.logger.warn(
      `[${opts.logPrefix}] BootstrapSessionManager setup failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

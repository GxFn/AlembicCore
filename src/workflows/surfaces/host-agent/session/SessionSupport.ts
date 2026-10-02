/**
 * SessionSupport — SessionManager 单例获取
 *
 * 为冷启动和增量扫描提供 GenerateSessionManager 的单例解析。
 */

import { resolveDataRoot } from '../../../../shared/resolveProjectRoot.js';
import { GenerateSessionManager } from './GenerateSession.js';

interface SessionManagerContainer {
  get(name: string): unknown;
  register?: (name: string, factory: () => unknown) => void;
}

// Blessed lazy lifecycle (AD4 'bootstrap-session-manager'): one manager per
// dataRoot so host-agent sessions survive MCP/Core process restarts without
// mixing project leases.
const sessionManagers = new Map<string, GenerateSessionManager>();

export function getOrCreateSessionManager(
  container: SessionManagerContainer
): GenerateSessionManager {
  try {
    const manager = container.get('generateSessionManager');
    if (manager) {
      return manager as GenerateSessionManager;
    }
  } catch {
    // Not registered yet.
  }

  const dataRoot = resolveSessionDataRoot(container);
  const managerKey = dataRoot ?? '__memory__';
  let sessionManager = sessionManagers.get(managerKey);
  if (!sessionManager) {
    sessionManager = new GenerateSessionManager({ dataRoot });
    sessionManagers.set(managerKey, sessionManager);
  }

  try {
    container.register?.('generateSessionManager', () => sessionManager);
  } catch {
    // Already registered or container does not support registration.
  }

  return sessionManager;
}

export function _resetGenerateSessionManagersForTesting(): void {
  sessionManagers.clear();
}

function resolveSessionDataRoot(container: SessionManagerContainer): string | null {
  try {
    return resolveDataRoot(container as never);
  } catch {
    return null;
  }
}

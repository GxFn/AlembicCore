import { getOrCreateSessionManager } from './SessionSupport.js';

/**
 * 宿主交给会话入口的容器形状。宿主的会话构造代码以它为参数类型
 * （Plugin 的 project-context-analysis），所以保持原样。
 */
export interface HostAgentSessionContainer {
  get(name: string): unknown;
  services?: Record<string, unknown>;
  singletons?: Record<string, unknown>;
}

export type HostAgentMissionSessionContainer = Parameters<typeof getOrCreateSessionManager>[0];
export type HostAgentMissionWorkflowSession = ReturnType<
  ReturnType<typeof getOrCreateSessionManager>['createSession']
>;

export function getActiveHostAgentWorkflowSession(
  container: HostAgentMissionSessionContainer,
  sessionId?: string
): HostAgentMissionWorkflowSession | null {
  const sessionManager = getOrCreateSessionManager(container);
  const session = sessionManager.getSession(sessionId);
  if (session) {
    return session;
  }

  if (sessionId) {
    const anySession = sessionManager.getAnySession();
    if (anySession && anySession.id === sessionId) {
      return anySession;
    }
  }

  return null;
}

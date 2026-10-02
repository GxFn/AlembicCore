import { getOrCreateSessionManager } from './SessionSupport.js';

export type HostAgentSessionContainer = Parameters<typeof getOrCreateSessionManager>[0];
export type HostAgentWorkflowSession = ReturnType<
  ReturnType<typeof getOrCreateSessionManager>['createSession']
>;

export function getActiveHostAgentWorkflowSession(
  container: HostAgentSessionContainer,
  sessionId?: string
): HostAgentWorkflowSession | null {
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

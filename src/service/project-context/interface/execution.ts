import type { ProjectContextExecutionContext } from '../../../domain/project-context/index.js';

export function throwIfProjectContextAborted(context?: ProjectContextExecutionContext): void {
  if (!context?.signal?.aborted) {
    return;
  }
  const reason = context.signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') {
    throw reason;
  }
  const error = new Error(reason instanceof Error ? reason.message : 'ProjectContext cancelled.');
  error.name = 'AbortError';
  throw error;
}

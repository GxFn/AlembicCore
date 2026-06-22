import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DimensionDef } from '../src/types/ProjectSnapshot.js';
import {
  BootstrapSessionLeaseError,
  BootstrapSessionManager,
} from '../src/workflows/capabilities/host-agent/BootstrapSession.js';
import { runHostAgentDimensionCompletionWorkflow } from '../src/workflows/capabilities/host-agent/HostAgentDimensionCompletionWorkflow.js';

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Map architecture decisions' },
  { id: 'quality', label: 'Quality', guide: 'Find quality standards' },
];

describe('BootstrapSessionManager durable lease lifecycle', () => {
  it('restores session progress and submission evidence after manager restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-session-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const session = manager.createSession({
        projectRoot,
        dimensions,
        projectContext: { projectName: 'repo', primaryLang: 'typescript' },
      });

      session.submissionTracker.recordSubmission(
        'architecture',
        {
          title: 'Architecture Boundary',
          knowledgeType: 'architecture',
          kind: 'rule',
          category: 'architecture',
          trigger: '@architecture-boundary',
          coreCode: 'export class Service {}',
          content: { markdown: '## Boundary\n\n```ts\nexport class Service {}\n```' },
          reasoning: { sources: ['src/service.ts:1'], confidence: 0.9 },
        },
        'recipe-1'
      );
      session.markDimensionComplete('architecture', {
        analysisText: '## Architecture\n\nService modules define the durable boundary.',
        keyFindings: ['Service modules define the architecture boundary'],
        referencedFiles: ['src/service.ts'],
        recipeIds: ['recipe-1'],
        candidateCount: 1,
      });

      const restartedManager = new BootstrapSessionManager({ dataRoot });
      const restored = restartedManager.getSession(session.id);
      expect(restored?.id).toBe(session.id);
      expect(restored?.getProgress()).toMatchObject({
        completed: 1,
        completedDimIds: ['architecture'],
        remainingDimIds: ['quality'],
      });
      expect(restored?.submissionTracker.getSubmissions('architecture')).toHaveLength(1);
      expect(restored?.sessionStore.getDimensionReport('architecture')?.referencedFiles).toEqual([
        'src/service.ts',
      ]);

      const storeFile = JSON.parse(
        await readFile(join(dataRoot, '.asd', 'bootstrap-sessions', 'active-sessions.json'), 'utf8')
      ) as { sessions: Array<{ id: string; projectRoot: string }> };
      expect(storeFile.sessions).toContainEqual(
        expect.objectContaining({ id: session.id, projectRoot })
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('refuses concurrent bootstrap for the same project with public lease taxonomy', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-lease-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const first = manager.createSession({ projectRoot, dimensions });

      expect(() => manager.createSession({ projectRoot, dimensions })).toThrow(
        BootstrapSessionLeaseError
      );

      try {
        manager.createSession({ projectRoot, dimensions });
        throw new Error('expected lease refusal');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BootstrapSessionLeaseError);
        expect((err as BootstrapSessionLeaseError).toJSON()).toMatchObject({
          state: 'bootstrap_in_progress',
          reason: 'bootstrap_in_progress',
          activeSessionId: first.id,
          activeProjectRoot: projectRoot,
          errorCode: 'BOOTSTRAP_IN_PROGRESS',
          failureKind: 'core.failure.conflict',
          httpStatus: 409,
          mcpErrorCode: 'core.failure.conflict',
          problemClass: 'state-conflict',
          reasonCode: 'conflict',
          retryable: true,
          statusCode: 409,
        });
      }

      const otherProject = join(dataRoot, 'other-repo');
      expect(manager.createSession({ projectRoot: otherProject, dimensions }).projectRoot).toBe(
        otherProject
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('allows a new same-project session after expiry or explicit release', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-expiry-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const expired = manager.createSession({
        projectRoot,
        dimensions,
        expiresAt: Date.now() - 1,
        startedAt: Date.now() - 10_000,
      });
      expect(manager.getSession(expired.id)).toBeNull();
      expect(manager.getAnySession(expired.id)?.id).toBe(expired.id);

      const replacement = manager.createSession({ projectRoot, dimensions });
      expect(replacement.id).not.toBe(expired.id);
      expect(manager.clearSession(replacement.id)).toBeUndefined();
      expect(manager.getSession(replacement.id)).toBeNull();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('does not block a new same-project session after bootstrap completion and restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-completed-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const completed = manager.createSession({ projectRoot, dimensions: [dimensions[0]] });

      completed.markDimensionComplete('architecture', {
        analysisText: '## Architecture\n\nA complete bootstrap session should not keep the lease.',
        keyFindings: ['Completed bootstrap sessions release their project lease'],
        referencedFiles: ['src/service.ts'],
        recipeIds: ['recipe-1'],
        candidateCount: 1,
      });

      expect(manager.getSessionStatus(completed.id, { projectRoot })).toMatchObject({
        reason: 'session_complete',
        state: 'complete',
      });

      const restartedManager = new BootstrapSessionManager({ dataRoot });
      expect(restartedManager.getSessionStatus(completed.id, { projectRoot })).toMatchObject({
        reason: 'session_complete',
        state: 'complete',
      });

      const next = restartedManager.createSession({ projectRoot, dimensions });
      expect(next.id).not.toBe(completed.id);
      expect(restartedManager.getSessionStatus(next.id, { projectRoot })).toMatchObject({
        reason: 'session_active',
        state: 'active',
      });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('reports wrong-project session mismatch without returning the session', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-mismatch-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const otherProject = join(dataRoot, 'other-repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const session = manager.createSession({ projectRoot, dimensions });

      expect(manager.getSession(session.id, { projectRoot: otherProject })).toBeNull();
      expect(manager.getSessionStatus(session.id, { projectRoot: otherProject })).toMatchObject({
        state: 'session_project_mismatch',
        reason: 'session_project_mismatch',
        sessionId: session.id,
        projectRoot: otherProject,
        activeProjectRoot: projectRoot,
        errorCode: 'BOOTSTRAP_SESSION_PROJECT_MISMATCH',
      });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('keeps dimension completion workflow compatible with the durable manager', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-complete-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new BootstrapSessionManager({ dataRoot });
      const session = manager.createSession({ projectRoot, dimensions: [dimensions[0]] });

      const response = await runHostAgentDimensionCompletionWorkflow(
        {
          dataRoot,
          container: {
            singletons: { _projectRoot: projectRoot },
            get(name: string) {
              if (name === 'bootstrapSessionManager') {
                return manager;
              }
              return null;
            },
          },
        },
        {
          sessionId: session.id,
          dimensionId: 'architecture',
          analysisText:
            '## Architecture analysis\nService modules define the durable workflow boundary.',
          keyFindings: ['Service modules define the workflow boundary'],
          referencedFiles: ['src/service.ts'],
        }
      );

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        dimensionId: 'architecture',
        progress: '1/1',
        completedDimensions: ['architecture'],
        isBootstrapComplete: true,
      });

      const restartedManager = new BootstrapSessionManager({ dataRoot });
      expect(restartedManager.getSession(session.id)?.isDimensionComplete('architecture')).toBe(
        true
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

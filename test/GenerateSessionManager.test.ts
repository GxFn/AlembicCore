import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { DimensionDef } from '../src/types/ProjectSnapshot.js';
import {
  GenerateSessionLeaseError,
  GenerateSessionManager,
} from '../src/workflows/surfaces/host-agent/session/GenerateSession.js';
import { runHostAgentDimensionCompletionWorkflow } from '../src/workflows/surfaces/host-agent/session/HostAgentDimensionCompletionWorkflow.js';

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Map architecture decisions' },
  { id: 'quality', label: 'Quality', guide: 'Find quality standards' },
];

describe('GenerateSessionManager durable lease lifecycle', () => {
  it('persists progressive project context updates on the same session lineage', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-session-context-update-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new GenerateSessionManager({ dataRoot });
      const session = manager.createSession({
        projectRoot,
        dimensions,
        projectContext: {
          certifiedProjectFacts: {
            artifactId: 'cpf-v1:fixture',
            receipts: {
              plan: { receiptHash: 'plan' },
              'recipe-generation': { receiptHash: 'recipe' },
            },
          },
        },
      });
      session.markDimensionComplete('architecture', {
        analysisText: '## Architecture\n\nPreserve existing progress across context updates.',
        keyFindings: ['Session progress is independent of receipt persistence'],
        referencedFiles: ['src/service.ts'],
      });
      const identityBeforeUpdate = session.toSnapshot();

      session.replaceProjectContext({
        certifiedProjectFacts: {
          artifactId: 'cpf-v1:fixture',
          receipts: {
            plan: { receiptHash: 'plan' },
            'recipe-generation': { receiptHash: 'recipe' },
            'dependency-graph': { receiptHash: 'dependency' },
          },
        },
      });

      const dependencyReload = new GenerateSessionManager({ dataRoot })
        .getAnySession(session.id, { projectRoot })
        ?.toSnapshot();
      expect(
        (
          dependencyReload?.projectContext.certifiedProjectFacts as {
            receipts: Record<string, unknown>;
          }
        ).receipts
      ).toEqual({
        plan: { receiptHash: 'plan' },
        'recipe-generation': { receiptHash: 'recipe' },
        'dependency-graph': { receiptHash: 'dependency' },
      });

      session.replaceProjectContext({
        certifiedProjectFacts: {
          artifactId: 'cpf-v1:fixture',
          receipts: {
            plan: { receiptHash: 'plan' },
            'recipe-generation': { receiptHash: 'recipe' },
            'dependency-graph': { receiptHash: 'dependency' },
            'module-coverage': { receiptHash: 'module' },
          },
        },
      });

      const freshSnapshot = new GenerateSessionManager({ dataRoot })
        .getAnySession(session.id, { projectRoot })
        ?.toSnapshot();
      expect(freshSnapshot).toMatchObject({
        id: identityBeforeUpdate.id,
        projectRoot: identityBeforeUpdate.projectRoot,
        dimensions: identityBeforeUpdate.dimensions,
        startedAt: identityBeforeUpdate.startedAt,
        expiresAt: identityBeforeUpdate.expiresAt,
        completedDimensions: identityBeforeUpdate.completedDimensions,
      });
      expect(
        (
          freshSnapshot?.projectContext.certifiedProjectFacts as {
            receipts: Record<string, unknown>;
          }
        ).receipts
      ).toEqual({
        plan: { receiptHash: 'plan' },
        'recipe-generation': { receiptHash: 'recipe' },
        'dependency-graph': { receiptHash: 'dependency' },
        'module-coverage': { receiptHash: 'module' },
      });
      expect(freshSnapshot?.completedDimensions.architecture).toBeDefined();
      expect(
        new GenerateSessionManager({ dataRoot }).getSessionStatus(session.id, { projectRoot })
      ).toMatchObject({ state: 'active', reason: 'session_active' });

      const storeFile = JSON.parse(
        await readFile(join(dataRoot, '.asd', 'bootstrap-sessions', 'active-sessions.json'), 'utf8')
      ) as { sessions: Array<{ id: string; projectContext: Record<string, unknown> }> };
      expect(storeFile.sessions.find((entry) => entry.id === session.id)?.projectContext).toEqual(
        freshSnapshot?.projectContext
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('isolates persisted project context from update inputs and snapshot outputs', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-session-context-isolation-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new GenerateSessionManager({ dataRoot });
      let projectNameReads = 0;
      const constructorInput = {
        get projectName() {
          projectNameReads += 1;
          return projectNameReads === 1 ? 'repo' : 'inconsistent-second-read';
        },
        modules: [{ name: 'initial-module' }],
      };
      const session = manager.createSession({
        projectRoot,
        dimensions,
        projectContext: constructorInput,
      });
      expect(projectNameReads).toBe(1);
      constructorInput.modules[0]!.name = 'mutated-constructor-input';
      expect(session.toSnapshot()).toMatchObject({
        projectContext: {
          modules: [{ name: 'initial-module' }],
          projectName: 'repo',
        },
        sessionStore: {
          projectContext: {
            modules: [{ name: 'initial-module' }],
            projectName: 'repo',
          },
        },
      });
      const updateInput = {
        projectName: 'repo',
        modules: [{ name: 'updated-module' }],
        certifiedProjectFacts: {
          artifactId: 'cpf-v1:fixture',
          receipts: {
            plan: { receiptHash: 'plan' },
            'dependency-graph': { receiptHash: 'dependency' },
          },
        },
      };
      const expectedProjectContext = structuredClone(updateInput);

      session.replaceProjectContext(updateInput);
      updateInput.certifiedProjectFacts.receipts.plan.receiptHash = 'mutated-input';
      Object.assign(updateInput.certifiedProjectFacts.receipts, {
        'module-coverage': { receiptHash: 'unpersisted-input' },
      });
      updateInput.modules[0]!.name = 'mutated-update-input';
      expect(session.toSnapshot().projectContext).toEqual(expectedProjectContext);

      const storePath = join(dataRoot, '.asd', 'bootstrap-sessions', 'active-sessions.json');
      const diskBeforeFailedUpdate = await readFile(storePath, 'utf8');
      const writeFailure = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('fixture persistence failure');
      });
      try {
        expect(() =>
          session.replaceProjectContext({
            projectName: 'must-not-stick',
            modules: [{ name: 'must-not-stick' }],
          })
        ).toThrow('fixture persistence failure');
      } finally {
        writeFailure.mockRestore();
      }
      expect(session.toSnapshot().projectContext).toEqual(expectedProjectContext);
      expect(await readFile(storePath, 'utf8')).toBe(diskBeforeFailedUpdate);

      const readSnapshot = session.toSnapshot();
      const readCarrier = readSnapshot.projectContext.certifiedProjectFacts as {
        receipts: Record<string, { receiptHash: string }>;
      };
      readCarrier.receipts.plan!.receiptHash = 'mutated-output';
      readCarrier.receipts['module-coverage'] = { receiptHash: 'unpersisted-output' };
      const readStoreModules = readSnapshot.sessionStore.projectContext.modules as Array<{
        name: string;
      }>;
      readStoreModules[0]!.name = 'mutated-store-output';

      expect(session.toSnapshot()).toMatchObject({
        projectContext: expectedProjectContext,
        sessionStore: {
          projectContext: {
            modules: [{ name: 'updated-module' }],
            projectName: 'repo',
          },
        },
      });
      expect(
        new GenerateSessionManager({ dataRoot })
          .getAnySession(session.id, { projectRoot })
          ?.toSnapshot()
      ).toMatchObject({
        projectContext: expectedProjectContext,
        sessionStore: {
          projectContext: {
            modules: [{ name: 'updated-module' }],
            projectName: 'repo',
          },
        },
      });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('restores session progress and submission evidence after manager restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'alembic-core-bootstrap-session-'));
    try {
      const projectRoot = join(dataRoot, 'repo');
      const manager = new GenerateSessionManager({ dataRoot });
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

      const restartedManager = new GenerateSessionManager({ dataRoot });
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
      const manager = new GenerateSessionManager({ dataRoot });
      const first = manager.createSession({ projectRoot, dimensions });

      expect(() => manager.createSession({ projectRoot, dimensions })).toThrow(
        GenerateSessionLeaseError
      );

      try {
        manager.createSession({ projectRoot, dimensions });
        throw new Error('expected lease refusal');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GenerateSessionLeaseError);
        expect((err as GenerateSessionLeaseError).toJSON()).toMatchObject({
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
      const manager = new GenerateSessionManager({ dataRoot });
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
      const manager = new GenerateSessionManager({ dataRoot });
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

      const restartedManager = new GenerateSessionManager({ dataRoot });
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
      const manager = new GenerateSessionManager({ dataRoot });
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
      const manager = new GenerateSessionManager({ dataRoot });
      const session = manager.createSession({ projectRoot, dimensions: [dimensions[0]] });

      const response = await runHostAgentDimensionCompletionWorkflow(
        {
          dataRoot,
          container: {
            singletons: { _projectRoot: projectRoot },
            get(name: string) {
              if (name === 'generateSessionManager') {
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

      const restartedManager = new GenerateSessionManager({ dataRoot });
      expect(restartedManager.getSession(session.id)?.isDimensionComplete('architecture')).toBe(
        true
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

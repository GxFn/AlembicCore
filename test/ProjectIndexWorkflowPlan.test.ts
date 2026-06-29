import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildColdStartWorkflowPlan,
  buildKnowledgeRescanWorkflowPlan,
  buildProjectIndexFullPlan,
  buildProjectIndexIncrementalPlan,
  createHostAgentColdStartIntent,
  createInternalColdStartIntent,
  createInternalKnowledgeRescanIntent,
  type ProjectIndexMode,
} from '../src/host-agent-workflows.js';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  PROJECT_SCOPE_REGISTRY_FILENAME,
} from '../src/shared/ProjectScope.js';
import {
  buildColdStartWorkflowPlan as buildColdStartWorkflowPlanFromProjectIndex,
  buildKnowledgeRescanWorkflowPlan as buildKnowledgeRescanWorkflowPlanFromProjectIndex,
} from '../src/workflows/project-index/index.js';

const ORIGINAL_ALEMBIC_HOME = process.env.ALEMBIC_HOME;
const tempRoots: string[] = [];

afterEach(() => {
  if (ORIGINAL_ALEMBIC_HOME === undefined) {
    delete process.env.ALEMBIC_HOME;
  } else {
    process.env.ALEMBIC_HOME = ORIGINAL_ALEMBIC_HOME;
  }
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

const PROJECT_SCOPE_MEMBERS = [
  'Alembic',
  'AlembicCore',
  'AlembicPlugin',
  'AlembicDashboard',
  'AlembicAgent',
] as const;

describe('project-index workflow plan collapse', () => {
  it('keeps full-index/coldStart plan byte shape and the R-2 cleanup root ternary', () => {
    const internalIntent = createInternalColdStartIntent({
      contentMaxLines: 77,
      dimensions: ['architecture'],
      incremental: true,
      maxFiles: 123,
      skipGuard: true,
    });
    const hostIntent = createHostAgentColdStartIntent();

    const internalPlan = buildColdStartWorkflowPlan({
      intent: internalIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });
    const hostPlan = buildColdStartWorkflowPlanFromProjectIndex({
      intent: hostIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });

    expect(buildProjectIndexFullPlan).toBe(buildColdStartWorkflowPlan);
    expect(internalPlan).toMatchObject({
      cleanup: {
        policy: 'full-reset',
        projectRoot: '/workspace/project',
        dataRoot: '/workspace/data',
      },
      projectAnalysis: {
        prepare: { clearOldData: true },
        scan: {
          maxFiles: 123,
          contentMaxLines: 77,
          skipGuard: true,
          sourceTag: 'bootstrap',
          generateReport: true,
          generateAstContext: true,
          incremental: false,
          logPrefix: 'Bootstrap',
        },
        materialize: {
          sourceGraph: true,
          dependencyEdges: true,
          moduleEntities: true,
          guardViolations: true,
        },
      },
      response: { tool: 'alembic_bootstrap' },
    });
    expect(hostPlan.cleanup).toEqual({
      policy: 'full-reset',
      projectRoot: '/workspace/data',
      dataRoot: '/workspace/data',
    });
    expect(hostPlan.projectAnalysis.prepare).toEqual({
      clearOldData: true,
      dataRoot: '/workspace/data',
    });
    expect(hostPlan.projectAnalysis.scan).toMatchObject({
      sourceTag: 'bootstrap-host-agent',
      generateAstContext: false,
      incremental: false,
      logPrefix: 'Bootstrap',
    });
  });

  it('keeps incremental-index/rescan plan byte shape and dataRoot cleanup semantics', () => {
    const incrementalIntent = createInternalKnowledgeRescanIntent({
      contentMaxLines: 80,
      maxFiles: 200,
      reason: 'incremental',
    });
    const forceIntent = createInternalKnowledgeRescanIntent({
      force: true,
      reason: 'force',
    });

    const incrementalPlan = buildKnowledgeRescanWorkflowPlan({
      intent: incrementalIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });
    const forcePlan = buildKnowledgeRescanWorkflowPlanFromProjectIndex({
      intent: forceIntent,
      projectRoot: '/workspace/project',
      dataRoot: '/workspace/data',
    });

    expect(buildProjectIndexIncrementalPlan).toBe(buildKnowledgeRescanWorkflowPlan);
    expect(incrementalPlan).toMatchObject({
      cleanup: {
        policy: 'rescan-clean',
        projectRoot: '/workspace/data',
      },
      projectAnalysis: {
        prepare: {},
        scan: {
          maxFiles: 200,
          contentMaxLines: 80,
          sourceTag: 'rescan-internal',
          summaryPrefix: 'Rescan-Internal scan',
          generateReport: true,
          generateAstContext: true,
          incremental: true,
          logPrefix: 'Rescan',
        },
        materialize: {
          sourceGraph: true,
          dependencyEdges: true,
          moduleEntities: true,
          guardViolations: true,
        },
      },
      response: { tool: 'alembic_rescan' },
    });
    expect(forcePlan.cleanup).toEqual({ policy: 'force-rescan', projectRoot: '/workspace/data' });
    expect(forcePlan.projectAnalysis.scan.incremental).toBe(false);
  });

  it('exposes explicit project-index mode vocabulary without renaming frozen stage ids', () => {
    const modes: ProjectIndexMode[] = ['full', 'incremental'];

    expect(modes).toEqual(['full', 'incremental']);
  });

  it('threads native ProjectScope member folders into full-mode scan roots', () => {
    const fixture = createNativeProjectScopeFixture();
    const intent = createHostAgentColdStartIntent();

    const plan = buildColdStartWorkflowPlan({
      intent,
      projectRoot: fixture.controlRoot,
      dataRoot: fixture.dataRoot,
    });

    expect(plan.projectAnalysis.projectRoot).toBe(fixture.controlRoot);
    expect(plan.projectAnalysis.scan.sourceFolders).toEqual([...PROJECT_SCOPE_MEMBERS]);
    expect(plan.intent.projectAnalysis.sourceFolders).toEqual([...PROJECT_SCOPE_MEMBERS]);
    expect(plan.projectAnalysis.scan.sourceFolders).not.toEqual(
      expect.arrayContaining(['Test', 'wakeflow-ledger', 'legacy'])
    );
    expect(plan.cleanup).toEqual({
      policy: 'full-reset',
      projectRoot: fixture.dataRoot,
      dataRoot: fixture.dataRoot,
    });
  });

  it('normalizes member-root host-agent full-mode generation to the control root scan domain', () => {
    const fixture = createNativeProjectScopeFixture();

    const plan = buildColdStartWorkflowPlan({
      intent: createHostAgentColdStartIntent(),
      projectRoot: path.join(fixture.controlRoot, 'AlembicCore'),
      dataRoot: fixture.dataRoot,
    });

    expect(plan.projectAnalysis.projectRoot).toBe(fixture.controlRoot);
    expect(plan.projectAnalysis.scan.sourceFolders).toEqual([...PROJECT_SCOPE_MEMBERS]);
    expect(plan.cleanup.projectRoot).toBe(fixture.dataRoot);
  });

  it('refuses internal full-reset cleanup rooted at a native ProjectScope member', () => {
    const fixture = createNativeProjectScopeFixture();

    expect(() =>
      buildColdStartWorkflowPlan({
        intent: createInternalColdStartIntent(),
        projectRoot: path.join(fixture.controlRoot, 'AlembicCore'),
        dataRoot: fixture.dataRoot,
      })
    ).toThrow(/full-reset cleanup root must not point at a ProjectScope member folder/);
  });

  it('keeps single-repository full-mode fallback unchanged when no native scope exists', () => {
    const singleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-index-single-'));
    tempRoots.push(singleRoot);
    process.env.ALEMBIC_HOME = singleRoot;
    const projectRoot = path.join(singleRoot, 'StandaloneRepo');
    const dataRoot = path.join(singleRoot, '.asd', 'workspaces', 'standalone');

    const plan = buildColdStartWorkflowPlan({
      intent: createInternalColdStartIntent({
        contentMaxLines: 77,
        maxFiles: 123,
        skipGuard: true,
      }),
      projectRoot,
      dataRoot,
    });

    expect(plan.cleanup.projectRoot).toBe(projectRoot);
    expect(plan.projectAnalysis.projectRoot).toBe(projectRoot);
    expect(plan.projectAnalysis.scan).toMatchObject({
      maxFiles: 123,
      contentMaxLines: 77,
      skipGuard: true,
    });
    expect(plan.projectAnalysis.scan.sourceFolders).toBeUndefined();
    expect(plan.intent.projectAnalysis.sourceFolders).toBeUndefined();
  });

  it('keeps explicit ColdStartWorkflowIntent sourceFolders as the scan contract', () => {
    const intent = createHostAgentColdStartIntent({
      sourceFolders: ['AlembicCore', 'AlembicCore', '../outside', '/tmp/outside', 'packages\\ui'],
    });

    expect(intent.projectAnalysis.sourceFolders).toEqual(['AlembicCore', 'packages/ui']);
  });
});

function createNativeProjectScopeFixture(): { controlRoot: string; dataRoot: string } {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-index-scope-'));
  tempRoots.push(controlRoot);
  process.env.ALEMBIC_HOME = controlRoot;
  const registryDir = path.join(controlRoot, '.asd');
  const dataRoot = path.join(registryDir, 'workspaces', 'ecf32806');
  fs.mkdirSync(registryDir, { recursive: true });
  for (const folder of [...PROJECT_SCOPE_MEMBERS, 'Test', 'wakeflow-ledger', 'legacy']) {
    fs.mkdirSync(path.join(controlRoot, folder), { recursive: true });
  }
  const projectScope = createProjectDescriptor({
    controlRoot,
    dataRoot,
    displayName: 'Alembic Workspace',
    folders: PROJECT_SCOPE_MEMBERS.map((folder, index) => ({
      displayName: folder,
      id: `folder-${folder.toLowerCase()}`,
      path: path.join(controlRoot, folder),
      repositoryId: `repo-${folder.toLowerCase()}`,
      role: index === 0 ? ('primary-source' as const) : ('source' as const),
    })),
    projectId: 'ecf32806',
    projectScopeId: 'project-scope-a8083fdb335c',
  });
  fs.writeFileSync(
    path.join(registryDir, PROJECT_SCOPE_REGISTRY_FILENAME),
    JSON.stringify(createProjectScopeRegistryDocument([projectScope]), null, 2)
  );
  return { controlRoot, dataRoot };
}

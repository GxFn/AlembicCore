import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SpaceContext } from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  PROJECT_SCOPE_REGISTRY_FILENAME,
} from '../src/shared/ProjectScope.js';

interface NativeScopeFolderFixture {
  displayName: string;
  path?: string;
  repositoryId?: string;
}

interface NativeScopeFixture {
  displayName?: string;
  folders: readonly NativeScopeFolderFixture[];
  projectId?: string;
  projectScopeId?: string;
}

describe('ProjectContext PCQ-8 project space', () => {
  it('returns project identity, repos, source folders, active repo, tree, hotspots, and refs', async () => {
    await withFixture(
      createWorkspaceFixture(),
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'space',
          payload: { sourceRefs: ['RepoB/src/index.ts'] },
          scope: { activeFile: 'RepoB/src/index.ts', projectRoot },
        });
        const data = envelope.data as SpaceContext;

        expect(envelope.errors).toBeUndefined();
        expect(data.space).toMatchObject({
          displayName: 'FixtureSpace',
          root: '.',
        });
        expect(data.repos.map((repo) => `${repo.id}:${repo.root}`)).toEqual([
          'repo-a:RepoA',
          'repo-b:RepoB',
        ]);
        expect(data.sourceFolders.map((folder) => `${folder.repositoryId}:${folder.path}`)).toEqual(
          ['repo-a:RepoA', 'repo-b:RepoB']
        );
        expect(data.activeRepo).toMatchObject({ kind: 'repo', scope: { repoId: 'repo-b' } });
        expect(data.boundaries).toHaveLength(2);
        expect(data.projectTree?.roots.map((root) => root.path)).toEqual([
          'RepoA',
          'RepoB',
          'RepoB/src/index.ts',
        ]);
        expect(data.projectTree?.roots[0]?.ref?.metadata).toMatchObject({
          nodeType: 'repo',
          source: 'project-context-space-tree',
        });
        const activeNode = data.projectTree?.roots.find((root) => root.role === 'active-file');
        expect(activeNode?.ref).toMatchObject({
          kind: 'path',
          metadata: expect.objectContaining({
            activeFile: true,
            nodeType: 'file',
            partOf: 'RepoB',
            source: 'project-context-space-active-file',
            treeSource: 'project-context-space-tree',
          }),
          scope: expect.objectContaining({
            filePath: 'RepoB/src/index.ts',
            repoId: 'repo-b',
            sourceFolder: 'RepoB',
          }),
        });
        expect(data.structuralHotspots.length).toBeGreaterThan(0);
        expect(data.nextRefs.some((ref) => ref.kind === 'space')).toBe(true);
        expect(data.nextRefs.some((ref) => ref.kind === 'repo')).toBe(true);
        expect(data.nextRefs.some((ref) => ref.kind === 'path')).toBe(true);
        expect(data.nextRefs.some((ref) => ref.kind === 'map')).toBe(false);
        expect(data.nextRefs.some((ref) => ref.kind === 'module')).toBe(false);
        expect(JSON.stringify(data)).not.toMatch(
          /packageSystems|buildSystems|entrypoints|mapSummary|dependencySummary|export const/
        );
      },
      createRepoABScope()
    );
  });

  it('returns active-file tree and drill-down refs from every active file input surface', async () => {
    await withFixture(
      createWorkspaceFixture(),
      async (projectRoot) => {
        const cases = [
          {
            payload: {},
            scope: { activeFile: 'RepoA/src/index.ts', projectRoot },
          },
          {
            payload: { activeFile: 'RepoA/src/index.ts' },
            scope: { projectRoot },
          },
          {
            payload: {
              ref: {
                id: 'path:repo-a:RepoA%2Fsrc%2Findex.ts',
                kind: 'path',
                scope: {
                  filePath: 'RepoA/src/index.ts',
                  projectRoot,
                  repoId: 'repo-a',
                  sourceFolder: 'RepoA',
                },
              },
            },
            scope: { projectRoot },
          },
        ];

        for (const item of cases) {
          const envelope = await ProjectContext.execute({
            kind: 'space',
            payload: item.payload,
            scope: item.scope,
          });
          const data = envelope.data as SpaceContext;
          const activeNode = data.projectTree?.roots.find((root) => root.role === 'active-file');
          const activeRef = data.nextRefs.find(
            (ref) => ref.kind === 'path' && ref.metadata?.activeFile === true
          );

          expect(envelope.errors).toBeUndefined();
          expect(data.activeRepo).toMatchObject({ kind: 'repo', scope: { repoId: 'repo-a' } });
          expect(activeNode).toMatchObject({
            exists: true,
            path: 'RepoA/src/index.ts',
            role: 'active-file',
          });
          expect(activeRef).toMatchObject({
            kind: 'path',
            metadata: expect.objectContaining({
              activeFile: true,
              nodeType: 'file',
              partOf: 'RepoA',
              source: 'project-context-space-active-file',
              treeSource: 'project-context-space-tree',
            }),
            scope: expect.objectContaining({
              filePath: 'RepoA/src/index.ts',
              repoId: 'repo-a',
              sourceFolder: 'RepoA',
            }),
          });
        }
      },
      createRepoABScope()
    );
  });

  it('keeps project-space output deterministic for the same workspace request', async () => {
    await withFixture(
      createWorkspaceFixture(),
      async (projectRoot) => {
        const left = await ProjectContext.execute({
          kind: 'space',
          scope: { activeFile: 'RepoA/src/index.ts', projectRoot },
        });
        const right = await ProjectContext.execute({
          kind: 'space',
          scope: { activeFile: 'RepoA/src/index.ts', projectRoot },
        });

        expect(left).toStrictEqual(right);
      },
      createRepoABScope()
    );
  });

  it('falls back to a single-folder project space when workspace config is absent', async () => {
    await withFixture({ 'src/index.ts': 'export const value = 1;\n' }, async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'space',
        scope: { activeFile: 'src/index.ts', projectRoot, repoId: 'single' },
      });
      const data = envelope.data as SpaceContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.repos).toEqual([
        expect.objectContaining({
          id: 'single',
          root: '.',
        }),
      ]);
      expect(data.sourceFolders).toEqual([
        expect.objectContaining({
          path: '.',
          repositoryId: 'single',
        }),
      ]);
      expect(data.activeRepo).toMatchObject({ kind: 'repo', scope: { repoId: 'single' } });
    });
  });

  it('keeps remaining repos and returns an ordinary error for missing native folders', async () => {
    await withFixture(
      {
        'Existing/src/index.ts': 'export const existing = true;\n',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'space',
          scope: { projectRoot },
        });
        const data = envelope.data as SpaceContext;

        expect(data.repos.map((repo) => repo.root)).toEqual(['Existing']);
        expect(data.sourceFolders).toContainEqual(
          expect.objectContaining({
            missing: true,
            path: 'Missing',
            repositoryId: 'repo-missing',
          })
        );
        expect(envelope.errors).toContainEqual(
          expect.objectContaining({
            code: 'not-found',
            path: 'Missing',
          })
        );
      },
      {
        displayName: 'FixtureSpace',
        folders: [
          { displayName: 'Existing', repositoryId: 'repo-existing' },
          { displayName: 'Missing', repositoryId: 'repo-missing' },
        ],
      }
    );
  });

  it('reports duplicate repo ids and active files outside the configured project space', async () => {
    await withFixture(
      {
        'A/src/index.ts': 'export const a = true;\n',
        'B/src/index.ts': 'export const b = true;\n',
        'Outside/file.ts': 'export const outside = true;\n',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'space',
          scope: { activeFile: 'Outside/file.ts', projectRoot },
        });
        const data = envelope.data as SpaceContext;

        expect(data.activeRepo).toBeUndefined();
        expect(data.nextRefs).not.toContainEqual(
          expect.objectContaining({
            kind: 'path',
            scope: expect.objectContaining({
              filePath: 'Outside/file.ts',
            }),
          })
        );
        expect(data.projectTree?.roots.some((root) => root.path === 'Outside/file.ts')).toBe(false);
        expect(envelope.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'ambiguous',
              message: expect.stringContaining('duplicated'),
            }),
            expect.objectContaining({
              code: 'outside-scope',
              message: expect.stringContaining('outside configured project space'),
            }),
          ])
        );
      },
      {
        displayName: 'DuplicateSpace',
        folders: [
          { displayName: 'A', repositoryId: 'dup' },
          { displayName: 'B', repositoryId: 'dup' },
        ],
      }
    );
  });

  it('requires repo-qualified source refs when short source refs are ambiguous', async () => {
    await withFixture(
      createWorkspaceFixture(),
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'space',
          payload: { sourceRefs: ['src/index.ts', 'RepoB/src/index.ts'] },
          scope: { projectRoot },
        });
        const data = envelope.data as SpaceContext;

        expect(envelope.errors).toContainEqual(
          expect.objectContaining({
            code: 'ambiguous',
            path: 'src/index.ts',
          })
        );
        expect(data.nextRefs).toContainEqual(
          expect.objectContaining({
            kind: 'path',
            scope: expect.objectContaining({
              filePath: 'RepoB/src/index.ts',
              repoId: 'repo-b',
              sourceFolder: 'RepoB',
            }),
          })
        );
      },
      createRepoABScope()
    );
  });
});

function createWorkspaceFixture(): Record<string, string> {
  return {
    'RepoA/package.json': JSON.stringify({ name: '@fixture/repo-a' }, null, 2),
    'RepoA/src/index.ts': 'export const a = true;\n',
    'RepoA/src/shared.ts': 'export const shared = true;\n',
    'RepoB/docs/readme.md': '# Repo B\n',
    'RepoB/package.json': JSON.stringify({ name: '@fixture/repo-b' }, null, 2),
    'RepoB/src/index.ts': 'export const b = true;\n',
  };
}

function createRepoABScope(): NativeScopeFixture {
  return {
    displayName: 'FixtureSpace',
    folders: [
      { displayName: 'RepoA', repositoryId: 'repo-a' },
      { displayName: 'RepoB', repositoryId: 'repo-b' },
    ],
  };
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>,
  nativeScope?: NativeScopeFixture
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-space-'));
  const previousAlembicHome = process.env.ALEMBIC_HOME;
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    if (nativeScope) {
      await writeNativeProjectScope(projectRoot, nativeScope);
    }
    await callback(projectRoot);
  } finally {
    if (previousAlembicHome === undefined) {
      delete process.env.ALEMBIC_HOME;
    } else {
      process.env.ALEMBIC_HOME = previousAlembicHome;
    }
    await fs.rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeNativeProjectScope(
  projectRoot: string,
  nativeScope: NativeScopeFixture
): Promise<void> {
  process.env.ALEMBIC_HOME = projectRoot;
  const registryDir = path.join(projectRoot, '.asd');
  await fs.mkdir(registryDir, { recursive: true });
  const projectScope = createProjectDescriptor({
    controlRoot: projectRoot,
    dataRoot: path.join(projectRoot, '.asd', 'workspaces', nativeScope.projectId ?? 'fixture'),
    displayName: nativeScope.displayName ?? 'FixtureSpace',
    folders: nativeScope.folders.map((folder, index) => ({
      displayName: folder.displayName,
      id: `folder-${folder.displayName.toLowerCase()}`,
      path: path.join(projectRoot, folder.path ?? folder.displayName),
      repositoryId: folder.repositoryId ?? `repo-${folder.displayName.toLowerCase()}`,
      role: index === 0 ? ('primary-source' as const) : ('source' as const),
    })),
    projectId: nativeScope.projectId ?? 'fixture',
    projectScopeId: nativeScope.projectScopeId ?? 'scope-fixture',
  });
  await fs.writeFile(
    path.join(registryDir, PROJECT_SCOPE_REGISTRY_FILENAME),
    JSON.stringify(createProjectScopeRegistryDocument([projectScope]), null, 2),
    'utf8'
  );
}

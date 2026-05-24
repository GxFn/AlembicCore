import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addProjectScopeFolder,
  createProjectDescriptor,
  createProjectScopeEndpointCapability,
  createProjectScopeRegistryDocument,
  createProjectScopeSourceRef,
  listProjectScopeFolders,
  PROJECT_SCOPE_CONTRACT_VERSION,
  PROJECT_SCOPE_OPERATIONS,
  PROJECT_SCOPE_STORAGE_KINDS,
  resolveProjectScopeForFolder,
  resolveProjectScopeRegistryFolder,
  summarizeProjectScopeDescriptor,
} from '../src/shared/index.js';

describe('ProjectScope multi-root contracts', () => {
  it('models one abstract project with multiple physical folders and Ghost-only storage', () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    const dataRoot = path.join('/ghost', 'project-a');
    const scope = createProjectDescriptor({
      controlRoot,
      dataRoot,
      displayName: 'Alembic project',
      folders: [
        { displayName: 'Alembic', path: path.join(controlRoot, 'Alembic'), role: 'primary-source' },
        { displayName: 'AlembicCore', path: path.join(controlRoot, 'AlembicCore') },
      ],
      projectScopeId: 'scope-alembic',
    });

    expect(PROJECT_SCOPE_CONTRACT_VERSION).toBe(1);
    expect(PROJECT_SCOPE_STORAGE_KINDS).toEqual(['ghost']);
    expect(scope.storage).toMatchObject({
      dataRoot,
      dataRootSource: 'ghost-registry',
      kind: 'ghost',
      projectRootWriteAllowed: false,
      standardWriteAllowed: false,
    });
    expect(scope.controlRoot).toMatchObject({
      includedInFolders: false,
      kind: 'workspace-control-root',
      path: controlRoot,
    });
    expect(listProjectScopeFolders(scope).map((folder) => folder.displayName)).toEqual([
      'Alembic',
      'AlembicCore',
    ]);

    const resolution = resolveProjectScopeForFolder(
      scope,
      path.join(controlRoot, 'AlembicCore', 'src', 'index.ts')
    );
    expect(resolution).toMatchObject({
      dataRoot,
      matched: true,
      projectScopeId: 'scope-alembic',
      reason: 'matched-folder',
    });
    expect(resolution.currentFolder?.displayName).toBe('AlembicCore');

    const summary = summarizeProjectScopeDescriptor(scope, resolution.currentFolderId);
    expect(summary).toMatchObject({
      controlRoot,
      controlRootIncludedInFolders: false,
      currentFolderPath: path.join(controlRoot, 'AlembicCore'),
      dataRoot,
      dataRootSource: 'ghost-registry',
      folderCount: 2,
      projectScopeId: 'scope-alembic',
      standardWriteAllowed: false,
      storageKind: 'ghost',
    });
  });

  it('keeps folder add/list/resolve deterministic without introducing remove or standard mode', () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    const baseScope = createProjectDescriptor({
      controlRoot,
      dataRoot: path.join('/ghost', 'scope-b'),
      folders: [{ id: 'folder-core', path: path.join(controlRoot, 'AlembicCore') }],
      projectScopeId: 'scope-b',
    });
    const nextScope = addProjectScopeFolder(baseScope, {
      id: 'folder-plugin',
      path: path.join(controlRoot, 'AlembicPlugin'),
    });
    const registry = createProjectScopeRegistryDocument([nextScope]);

    expect(listProjectScopeFolders(nextScope).map((folder) => folder.id)).toEqual([
      'folder-core',
      'folder-plugin',
    ]);
    expect(
      resolveProjectScopeRegistryFolder(registry, path.join(controlRoot, 'AlembicPlugin'))
    ).toMatchObject({
      currentFolderId: 'folder-plugin',
      matched: true,
      projectScopeId: 'scope-b',
    });
    expect(createProjectScopeEndpointCapability({ available: true })).toMatchObject({
      available: true,
      projectRootWriteAllowed: false,
      storageKind: 'ghost',
      supportedOperations: [...PROJECT_SCOPE_OPERATIONS],
      supportsFolderDisable: false,
      supportsFolderRemove: false,
      supportsStandardStorage: false,
    });
  });

  it('rejects controlRoot as a source folder and bans standard/project-root storage for new entries', () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    expect(() =>
      createProjectDescriptor({
        controlRoot,
        dataRoot: path.join('/ghost', 'scope-c'),
        folders: [{ path: controlRoot }],
      })
    ).toThrow(/controlRoot cannot be included/);
    expect(() =>
      createProjectDescriptor({
        controlRoot,
        folders: [{ path: path.join(controlRoot, 'Alembic') }],
        storage: { dataRoot: controlRoot, kind: 'standard' },
      })
    ).toThrow(/Ghost-only/);
  });

  it('adds projectScopeId and folder metadata to source evidence refs', () => {
    expect(
      createProjectScopeSourceRef({
        folderId: 'folder-core',
        folderPath: '/workspace/AlembicCore',
        projectScopeId: 'scope-a',
        sourcePath: 'src/shared/ProjectScope.ts',
      })
    ).toEqual({
      absolutePath: null,
      folderId: 'folder-core',
      folderPath: '/workspace/AlembicCore',
      projectScopeId: 'scope-a',
      relativePath: 'src/shared/ProjectScope.ts',
      sourceKind: 'source-file',
    });
  });
});

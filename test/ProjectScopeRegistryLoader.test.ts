import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  loadProjectScopeForFolder,
  PROJECT_SCOPE_REGISTRY_FILENAME,
  readProjectScopeRegistryDocument,
  resolveProjectScopeRegistryFolder,
} from '../src/shared/ProjectScope.js';
import WorkspaceResolver from '../src/shared/WorkspaceResolver.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

function createRegistryFixture(options: { includeNested?: boolean } = {}) {
  const controlRoot = mkdtempSync(path.join(tmpdir(), 'alembic-scope-control-'));
  tempRoots.push(controlRoot);

  const dataRoot = path.join(controlRoot, '.asd-workspaces', 'ecf32806');
  const coreFolder = path.join(controlRoot, 'AlembicCore');
  const nestedFolder = path.join(coreFolder, 'packages', 'nested');
  const folders = [
    {
      displayName: 'Alembic',
      id: 'folder-alembic',
      path: path.join(controlRoot, 'Alembic'),
      repositoryId: 'alembic',
      role: 'primary-source' as const,
    },
    {
      displayName: 'AlembicCore',
      id: 'folder-core',
      path: coreFolder,
      repositoryId: 'alembic-core',
      role: 'source' as const,
    },
    {
      displayName: 'AlembicPlugin',
      id: 'folder-plugin',
      path: path.join(controlRoot, 'AlembicPlugin'),
      repositoryId: 'alembic-plugin',
      role: 'source' as const,
    },
    {
      displayName: 'AlembicDashboard',
      id: 'folder-dashboard',
      path: path.join(controlRoot, 'AlembicDashboard'),
      repositoryId: 'alembic-dashboard',
      role: 'source' as const,
    },
    {
      displayName: 'AlembicAgent',
      id: 'folder-agent',
      path: path.join(controlRoot, 'AlembicAgent'),
      repositoryId: 'alembic-agent',
      role: 'source' as const,
    },
  ];

  if (options.includeNested) {
    folders.push({
      displayName: 'Nested Core Package',
      id: 'folder-core-nested',
      path: nestedFolder,
      repositoryId: 'alembic-core-nested',
      role: 'source' as const,
    });
  }

  const projectScope = createProjectDescriptor({
    controlRoot,
    currentFolderId: 'folder-core',
    dataRoot,
    displayName: 'Alembic Workspace',
    folders,
    projectId: 'ecf32806',
    projectScopeId: 'scope-ecf32806',
  });
  const registryPath = path.join(controlRoot, PROJECT_SCOPE_REGISTRY_FILENAME);
  writeFileSync(registryPath, JSON.stringify(createProjectScopeRegistryDocument([projectScope])));

  return {
    controlRoot,
    coreFolder,
    dataRoot,
    nestedFolder,
    projectScope,
    registryPath,
  };
}

describe('ProjectScope registry loader', () => {
  test('returns an empty registry document for empty, missing, or damaged registry files', () => {
    const controlRoot = mkdtempSync(path.join(tmpdir(), 'alembic-scope-empty-'));
    tempRoots.push(controlRoot);
    const registryPath = path.join(controlRoot, PROJECT_SCOPE_REGISTRY_FILENAME);

    expect(existsSync(registryPath)).toBe(false);
    expect(readProjectScopeRegistryDocument(registryPath)).toEqual(
      createProjectScopeRegistryDocument()
    );
    expect(loadProjectScopeForFolder(path.join(controlRoot, 'AlembicCore'), { registryPath })).toBe(
      null
    );

    writeFileSync(registryPath, '{ damaged json');

    expect(readProjectScopeRegistryDocument(registryPath)).toEqual(
      createProjectScopeRegistryDocument()
    );
    expect(loadProjectScopeForFolder(path.join(controlRoot, 'AlembicCore'), { registryPath })).toBe(
      null
    );
  });

  test('loads the member project descriptor with five folders', () => {
    const { controlRoot, coreFolder, dataRoot, registryPath } = createRegistryFixture();

    const loaded = loadProjectScopeForFolder(path.join(coreFolder, 'src'), { registryPath });

    expect(loaded).toMatchObject({
      controlRoot: { includedInFolders: false, kind: 'workspace-control-root', path: controlRoot },
      dataRoot,
      projectId: 'ecf32806',
      projectScopeId: 'scope-ecf32806',
    });
    expect(loaded?.folders).toHaveLength(5);
  });

  test('uses the longest prefix when nested project folders overlap', () => {
    const { dataRoot, nestedFolder, registryPath } = createRegistryFixture({ includeNested: true });
    const nestedChildPath = path.join(nestedFolder, 'src', 'index.ts');
    const document = readProjectScopeRegistryDocument(registryPath);

    const resolution = resolveProjectScopeRegistryFolder(document, nestedChildPath);
    const resolver = WorkspaceResolver.fromProjectScopeRegistry(nestedChildPath, { registryPath });

    expect(resolution?.currentFolderId).toBe('folder-core-nested');
    expect(resolver.currentFolderId).toBe('folder-core-nested');
    expect(resolver.dataRoot).toBe(dataRoot);
  });

  test('keeps the control root outside registry folder loading', () => {
    const { controlRoot, registryPath } = createRegistryFixture();

    expect(loadProjectScopeForFolder(controlRoot, { registryPath })).toBe(null);
  });

  test('keeps singleRoot requests on the original fromProject semantics', () => {
    const { coreFolder, registryPath } = createRegistryFixture();
    const projectRoot = path.join(coreFolder, 'src');

    const resolver = WorkspaceResolver.fromProjectScopeRegistry(projectRoot, {
      registryPath,
      singleRoot: true,
    });

    expect(resolver.projectScope).toBe(null);
    expect(resolver.dataRoot).toBe(path.resolve(projectRoot));
  });
});

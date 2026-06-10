import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addProjectScopeFolder,
  buildProjectScopeSourceRefIndex,
  createCanonicalSourceIdentity,
  createProjectDescriptor,
  createProjectScopeEndpointCapability,
  createProjectScopeRegistryDocument,
  createProjectScopeSourceRef,
  listProjectScopeFolders,
  normalizeProjectScopeSourceRef,
  normalizeProjectScopeSourceRefs,
  PROJECT_SCOPE_CONTRACT_VERSION,
  PROJECT_SCOPE_OPERATIONS,
  PROJECT_SCOPE_STORAGE_KINDS,
  resolveProjectScopeForFolder,
  resolveProjectScopeRegistryFolder,
  resolveProjectScopeSourceRef,
  summarizeProjectScopeDescriptor,
} from '../src/shared/index.js';
import { auditRecipesForRescan } from '../src/workflows/capabilities/planning/knowledge/KnowledgeRescanPlanner.js';

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

  it('creates canonical source identities and rejects short sourceRefs', () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    const coreIdentity = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicCore',
      folderId: 'folder-core',
      folderPath: path.join(controlRoot, 'AlembicCore'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const pluginIdentity = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicPlugin',
      folderId: 'folder-plugin',
      folderPath: path.join(controlRoot, 'AlembicPlugin'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const index = buildProjectScopeSourceRefIndex([coreIdentity, pluginIdentity]);

    expect(coreIdentity).toMatchObject({
      folderRelativeRoot: 'AlembicCore',
      qualifiedPath: 'AlembicCore/lib/index.ts',
      relativePath: 'lib/index.ts',
    });
    expect(resolveProjectScopeSourceRef('AlembicCore/lib/index.ts', index)).toMatchObject({
      identity: coreIdentity,
      reason: 'qualified-path',
      status: 'resolved',
    });
    expect(resolveProjectScopeSourceRef('lib/index.ts', index)).toMatchObject({
      identity: null,
      reason: 'not-found',
      status: 'missing',
    });
  });

  it('normalizes only repo-qualified ProjectScope sourceRefs', () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    const coreIndex = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicCore',
      folderId: 'folder-core',
      folderPath: path.join(controlRoot, 'AlembicCore'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const pluginIndex = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicPlugin',
      folderId: 'folder-plugin',
      folderPath: path.join(controlRoot, 'AlembicPlugin'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const alembicServer = createCanonicalSourceIdentity({
      folderDisplayName: 'Alembic',
      folderId: 'folder-alembic',
      folderPath: path.join(controlRoot, 'Alembic'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'bin/api-server.ts',
    });
    const index = buildProjectScopeSourceRefIndex([coreIndex, pluginIndex, alembicServer]);

    expect(normalizeProjectScopeSourceRef('lib/index.ts', index)).toMatchObject({
      folderId: null,
      normalizedRef: null,
      reason: 'not-found',
      status: 'missing',
    });
    expect(normalizeProjectScopeSourceRef('index.ts', index)).toMatchObject({
      folderId: null,
      normalizedRef: null,
      reason: 'not-found',
      status: 'missing',
    });
    expect(normalizeProjectScopeSourceRef('bin/api-server.ts', index)).toMatchObject({
      folderId: null,
      normalizedRef: null,
      reason: 'not-found',
      status: 'missing',
    });
    expect(normalizeProjectScopeSourceRef('api-server.ts', index)).toMatchObject({
      folderId: null,
      normalizedRef: null,
      reason: 'not-found',
      status: 'missing',
    });
    expect(normalizeProjectScopeSourceRef('Alembic/bin/api-server.ts', index)).toMatchObject({
      folderId: 'folder-alembic',
      normalizedRef: 'Alembic/bin/api-server.ts',
      reason: 'qualified-path',
      status: 'active',
    });
    expect(normalizeProjectScopeSourceRef('AlembicCore/src/core/database.ts', index)).toMatchObject(
      {
        normalizedRef: null,
        reason: 'not-found',
        status: 'missing',
      }
    );

    const batch = normalizeProjectScopeSourceRefs(
      ['api-server.ts', 'lib/index.ts', 'Alembic/bin/api-server.ts'],
      index
    );
    expect(batch.activeSourceRefs).toEqual(['Alembic/bin/api-server.ts']);
    expect(batch.rejected.map((sourceRef) => sourceRef.reason)).toEqual(['not-found', 'not-found']);
  });

  it('lets rescan audit accept qualified refs but block ambiguous unqualified refs', async () => {
    const controlRoot = path.join('/workspace', 'AlembicWorkspace');
    const coreIdentity = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicCore',
      folderId: 'folder-core',
      folderPath: path.join(controlRoot, 'AlembicCore'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const pluginIdentity = createCanonicalSourceIdentity({
      folderDisplayName: 'AlembicPlugin',
      folderId: 'folder-plugin',
      folderPath: path.join(controlRoot, 'AlembicPlugin'),
      projectRoot: controlRoot,
      projectScopeId: 'scope-a',
      sourcePath: 'lib/index.ts',
    });
    const audit = await auditRecipesForRescan({
      allFiles: [
        { name: 'index.ts', relativePath: 'lib/index.ts', sourceIdentity: coreIdentity },
        { name: 'index.ts', relativePath: 'lib/index.ts', sourceIdentity: pluginIdentity },
      ],
      container: { get: () => null },
      logger: { info() {}, warn() {} },
      recipeEntries: [
        {
          id: 'ambiguous',
          title: 'Ambiguous legacy source',
          trigger: 'legacy',
          category: 'architecture',
          knowledgeType: 'pattern',
          doClause: 'Use explicit repo identity',
          lifecycle: 'active',
          sourceRefs: ['lib/index.ts'],
        },
        {
          id: 'qualified',
          title: 'Qualified source',
          trigger: 'qualified',
          category: 'architecture',
          knowledgeType: 'pattern',
          doClause: 'Use explicit repo identity',
          lifecycle: 'active',
          sourceRefs: ['AlembicCore/lib/index.ts'],
        },
      ],
    });

    expect(audit.results.find((result) => result.recipeId === 'ambiguous')).toMatchObject({
      evidence: { codeFilesExist: 0 },
      relevanceScore: 55,
    });
    expect(audit.results.find((result) => result.recipeId === 'qualified')).toMatchObject({
      evidence: { codeFilesExist: 1 },
      relevanceScore: 90,
    });
  });
});

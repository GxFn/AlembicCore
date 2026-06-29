import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WriteZone } from '../src/infrastructure/io/WriteZone.js';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  PROJECT_SCOPE_REGISTRY_FILENAME,
} from '../src/shared/ProjectScope.js';
import { resolveDataRoot, resolveKnowledgeScanDirs } from '../src/shared/resolveProjectRoot.js';

const ORIGINAL_ALEMBIC_HOME = process.env.ALEMBIC_HOME;
const tempRoots: string[] = [];

afterEach(() => {
  if (ORIGINAL_ALEMBIC_HOME === undefined) {
    delete process.env.ALEMBIC_HOME;
  } else {
    process.env.ALEMBIC_HOME = ORIGINAL_ALEMBIC_HOME;
  }
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

function createNativeProjectScopeFixture() {
  const alembicHome = mkdtempSync(path.join(tmpdir(), 'alembic-home-scope-resolution-'));
  const controlRoot = mkdtempSync(path.join(tmpdir(), 'alembic-control-scope-resolution-'));
  tempRoots.push(alembicHome, controlRoot);
  process.env.ALEMBIC_HOME = alembicHome;

  const memberRoot = path.join(controlRoot, 'AlembicCore');
  const dataRoot = path.join(alembicHome, '.asd', 'workspaces', 'ecf32806');
  mkdirSync(memberRoot, { recursive: true });
  mkdirSync(path.join(alembicHome, '.asd'), { recursive: true });

  const projectScope = createProjectDescriptor({
    controlRoot,
    dataRoot,
    folders: [
      {
        displayName: 'AlembicCore',
        id: 'folder-core',
        path: memberRoot,
        repositoryId: 'alembic-core',
        role: 'primary-source',
      },
    ],
    projectId: 'ecf32806',
    projectScopeId: 'scope-ecf32806',
  });
  writeFileSync(
    path.join(alembicHome, '.asd', PROJECT_SCOPE_REGISTRY_FILENAME),
    JSON.stringify(createProjectScopeRegistryDocument([projectScope]))
  );

  return { dataRoot, memberRoot };
}

describe('resolveKnowledgeScanDirs', () => {
  it('uses workspace dataRoot-relative knowledge paths in ghost mode', () => {
    const dirs = resolveKnowledgeScanDirs({
      singletons: {
        _workspaceResolver: {
          dataRoot: '/ghost/workspaces/abcd1234',
          recipesDir: '/ghost/workspaces/abcd1234/Alembic/recipes',
          candidatesDir: '/ghost/workspaces/abcd1234/Alembic/candidates',
        },
      },
    });

    expect(dirs).toContain('Alembic/recipes');
    expect(dirs).toContain('Alembic/candidates');
    expect(dirs).toContain('recipes');
    expect(dirs).toContain('candidates');
  });

  it('respects custom knowledge base directories from workspace resolver', () => {
    const dirs = resolveKnowledgeScanDirs({
      singletons: {
        _workspaceResolver: {
          dataRoot: '/ghost/workspaces/abcd1234',
          recipesDir: '/ghost/workspaces/abcd1234/Knowledge/recipes',
          candidatesDir: '/ghost/workspaces/abcd1234/Knowledge/candidates',
        },
      },
    });

    expect(dirs).toContain('Knowledge/recipes');
    expect(dirs).toContain('Knowledge/candidates');
    expect(dirs).not.toContain('Alembic/recipes');
    expect(dirs).not.toContain('Alembic/candidates');
  });

  it('uses the native ProjectScope registry when falling back from a projectRoot', () => {
    const { dataRoot, memberRoot } = createNativeProjectScopeFixture();

    expect(resolveDataRoot({ singletons: { _projectRoot: memberRoot } })).toBe(dataRoot);
    expect(resolveKnowledgeScanDirs({ singletons: { _projectRoot: memberRoot } })).toEqual(
      expect.arrayContaining(['recipes', 'candidates', 'Alembic/recipes', 'Alembic/candidates'])
    );
  });

  it('binds WriteZone Zone.Data paths to the native ProjectScope dataRoot', async () => {
    const { dataRoot, memberRoot } = createNativeProjectScopeFixture();

    const writeZone = await WriteZone.fromProjectRoot(memberRoot);

    expect(writeZone.dataRoot).toBe(dataRoot);
    expect(writeZone.data('.asd/alembic.db').absolute).toBe(
      path.join(dataRoot, '.asd', 'alembic.db')
    );
  });
});

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { createProjectDescriptor } from '../src/shared/ProjectScope.js';
import WorkspaceResolver from '../src/shared/WorkspaceResolver.js';

const tempRoots: string[] = [];

afterEach(() => {
  resetDrizzle();
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

function createExcludedCoreMemberRoot(controlRoot: string): string {
  const memberRoot = path.join(controlRoot, 'AlembicCore');
  mkdirSync(path.join(memberRoot, 'src'), { recursive: true });
  writeFileSync(path.join(memberRoot, 'AGENTS.md'), '# AlembicCore\n');
  writeFileSync(path.join(memberRoot, 'src', 'index.ts'), 'export {};\n');
  writeFileSync(
    path.join(memberRoot, 'package.json'),
    `${JSON.stringify({ name: '@alembic/core' }, null, 2)}\n`
  );
  return memberRoot;
}

describe('DatabaseConnection ProjectScope write guard', () => {
  it('throws instead of redirecting a project-scope member write to the dev tmp DB', async () => {
    const controlRoot = path.join(tmpdir(), `alembic-scope-db-guard-${process.pid}`);
    rmSync(controlRoot, { force: true, recursive: true });
    mkdirSync(controlRoot, { recursive: true });
    tempRoots.push(controlRoot);
    const memberRoot = createExcludedCoreMemberRoot(controlRoot);
    const projectScope = createProjectDescriptor({
      controlRoot,
      dataRoot: memberRoot,
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
    const resolver = new WorkspaceResolver({ projectRoot: memberRoot, projectScope });
    const connection = new DatabaseConnection({ path: '.asd/alembic.db' }, resolver);

    await expect(connection.connect()).rejects.toThrow(
      /in project-scope scope-ecf32806 but resolved to an excluded root/
    );
    expect(existsSync(path.join(memberRoot, '.asd', 'alembic.db'))).toBe(false);
    connection.close();
  });
});

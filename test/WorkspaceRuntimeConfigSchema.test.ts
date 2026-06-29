import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkspaceRuntimeConfigSchema } from '../src/config.js';
import {
  DEFAULT_SUB_REPO_DIR,
  RUNTIME_DIR,
  readSubRepoDirFromConfig,
  readSubRepoUrlFromConfig,
  resolveSubRepoPath,
} from '../src/shared/ProjectMarkers.js';
import { WorkspaceRuntimeConfigSchema as SharedWorkspaceRuntimeConfigSchema } from '../src/shared/schemas/config.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function createProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-runtime-config-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, RUNTIME_DIR), { recursive: true });
  return root;
}

function writeRuntimeConfig(projectRoot: string, config: unknown): void {
  fs.writeFileSync(
    path.join(projectRoot, RUNTIME_DIR, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8'
  );
}

describe('WorkspaceRuntimeConfigSchema', () => {
  test('accepts v2 project membership and sub-repository settings', () => {
    const result = WorkspaceRuntimeConfigSchema.safeParse({
      version: 2,
      projectName: 'Demo',
      database: '.asd/alembic.db',
      core: {
        subRepoDir: 'Knowledge/recipes',
        subRepoUrl: 'https://example.test/demo/recipes.git',
        owner: 'platform',
      },
      customRuntimeSetting: { enabled: true },
      guard: { disabledRules: [], codeLevelThresholds: {} },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.core.subRepoDir).toBe('Knowledge/recipes');
      expect(result.data.core.subRepoUrl).toBe('https://example.test/demo/recipes.git');
      expect(result.data.customRuntimeSetting).toEqual({ enabled: true });
    }
  });

  test('exports the same runtime schema from shared and config facades', () => {
    expect(WorkspaceRuntimeConfigSchema).toBe(SharedWorkspaceRuntimeConfigSchema);
  });

  test('rejects stale runtime config fields', () => {
    const result = WorkspaceRuntimeConfigSchema.safeParse({
      version: 2,
      projectName: 'Demo',
      database: '.asd/alembic.db',
      core: {
        subRepoDir: 'Knowledge/recipes',
        dir: 'Knowledge',
        constitution: 'constitution.yaml',
      },
      watch: { extensions: ['ts'] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(issuePaths).toEqual(
        expect.arrayContaining(['core.dir', 'core.constitution', 'watch'])
      );
    }
  });

  test('ProjectMarkers reads only valid v2 runtime config coordinates', () => {
    const projectRoot = createProjectRoot();
    writeRuntimeConfig(projectRoot, {
      version: 2,
      projectName: 'Demo',
      database: '.asd/alembic.db',
      core: {
        subRepoDir: 'Knowledge/recipes',
        subRepoUrl: 'https://example.test/demo/recipes.git',
      },
    });

    expect(readSubRepoDirFromConfig(projectRoot)).toBe('Knowledge/recipes');
    expect(readSubRepoUrlFromConfig(projectRoot)).toBe('https://example.test/demo/recipes.git');
    expect(resolveSubRepoPath(projectRoot)).toBe(path.join(projectRoot, 'Knowledge', 'recipes'));
  });

  test('ProjectMarkers falls back when runtime config carries stale fields', () => {
    const projectRoot = createProjectRoot();
    writeRuntimeConfig(projectRoot, {
      version: 2,
      projectName: 'Demo',
      database: '.asd/alembic.db',
      core: {
        subRepoDir: 'Knowledge/recipes',
        dir: 'Knowledge',
      },
    });

    expect(readSubRepoDirFromConfig(projectRoot)).toBeNull();
    expect(readSubRepoUrlFromConfig(projectRoot)).toBeNull();
    expect(resolveSubRepoPath(projectRoot)).toBe(path.join(projectRoot, DEFAULT_SUB_REPO_DIR));
  });
});

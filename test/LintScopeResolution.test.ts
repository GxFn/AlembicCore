import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/lint-scope-resolution.mjs', import.meta.url));
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

function createFixture(contents: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'alembic-scope-lint-'));
  tempRoots.push(root);
  const discoveryDir = path.join(root, 'src', 'core', 'discovery');
  mkdirSync(discoveryDir, { recursive: true });
  writeFileSync(path.join(discoveryDir, 'DiscovererRegistry.ts'), contents);
  return root;
}

function runLint(root: string) {
  return spawnSync(process.execPath, [SCRIPT_PATH, '--root', root], {
    encoding: 'utf8',
  });
}

describe('lint-scope-resolution', () => {
  it('rejects bare WorkspaceResolver.fromProject calls in scan/write paths', () => {
    const root = createFixture(`
      import { WorkspaceResolver } from '../../../shared/WorkspaceResolver.js';
      export const dataRoot = WorkspaceResolver.fromProject('/workspace/AlembicCore').dataRoot;
    `);

    const result = runLint(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scope-resolution lint failed');
    expect(result.stderr).toContain('DiscovererRegistry.ts:3');
  });

  it('accepts explicit single-root annotations for intentional exceptions', () => {
    const root = createFixture(`
      import { WorkspaceResolver } from '../../../shared/WorkspaceResolver.js';
      // @scope-singleroot(permanent) — fixture verifies intentional single-root escape.
      export const dataRoot = WorkspaceResolver.fromProject('/workspace/AlembicCore').dataRoot;
    `);

    const result = runLint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('scope-resolution lint passed');
  });
});

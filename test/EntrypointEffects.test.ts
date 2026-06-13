/**
 * P2 AD6 Core leg — no-undeclared-effects snapshot tests.
 *
 * Core's entrypoint families and their DECLARED effects
 * (docs/entrypoint-effects.md):
 *  - package facades: importing performs NO filesystem/network work
 *    (AD4: no import-time effects);
 *  - runtime persistence: only under the provided data root
 *    (PathGuard-checked .asd / knowledge-base paths);
 *  - shipped scripts tooling: read-only gates (verified by their own
 *    pipelines), no bin entries exist.
 * These snapshots prove the declarations on representative calls using
 * temp data roots only.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import pathGuard from '../src/shared/PathGuard.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listTree(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    out.push(path.relative(root, child));
    if (entry.isDirectory()) {
      out.push(...listTree(child).map((p) => path.join(entry.name, p)));
    }
  }
  return out.sort();
}

describe('Entrypoint effects (AD6 inflow/outflow audit)', () => {
  test('importing representative facades performs zero filesystem work in cwd', () => {
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ad6-import-fx-'));
    try {
      // Import the heaviest facade families in a clean child process whose
      // cwd is an empty temp dir; any import-time write would land there
      // (or throw on a guard) — both fail the snapshot.
      const distRoot = path.join(repoRoot, 'dist');
      const script = [
        path.join(distRoot, 'index.js'),
        path.join(distRoot, 'knowledge.js'),
        path.join(distRoot, 'search.js'),
        path.join(distRoot, 'guard.js'),
        path.join(distRoot, 'vector.js'),
        path.join(distRoot, 'project-intelligence.js'),
        path.join(distRoot, 'daemon/index.js'),
        path.join(distRoot, 'shared/index.js'),
      ]
        .map((modulePath) => `await import(${JSON.stringify(pathToFileURL(modulePath).href)});`)
        .concat(["console.log('imports-ok');"])
        .join('\n');
      const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: tmpCwd,
        encoding: 'utf8',
        env: { ...process.env, ALEMBIC_QUIET: '1' },
      });
      expect(stdout).toContain('imports-ok');
      expect(listTree(tmpCwd)).toEqual([]);
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('runtime persistence lands only under the provided data root', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ad6-runtime-fx-'));
    const outsideProbe = fs.mkdtempSync(path.join(os.tmpdir(), 'ad6-outside-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpRoot, knowledgeBaseDir: 'Alembic' });
    const connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    try {
      await connection.connect();
      await connection.runMigrations();

      const written = listTree(tmpRoot);
      // Everything written sits under .asd/ inside the provided root.
      expect(written.length).toBeGreaterThan(0);
      for (const file of written) {
        expect(file === '.asd' || file.startsWith('.asd'), file).toBe(true);
      }
      // Nothing leaked into an unrelated directory.
      expect(listTree(outsideProbe)).toEqual([]);
    } finally {
      connection.close();
      resetDrizzle();
      pathGuard._reset();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(outsideProbe, { recursive: true, force: true });
    }
  });

  test('the package ships no bin entries (CLI family is local gate tooling only)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.bin).toBeUndefined();
    // The shipped scripts are the read-only gate tools named in files[].
    const shippedScripts = (pkg.files as string[]).filter((entry) => entry.startsWith('scripts/'));
    expect(shippedScripts.length).toBeGreaterThan(0);
  });
});

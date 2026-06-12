/**
 * isOwnDevRepo — alembic-ai dev-repo marker detection.
 *
 * Final marker semantics (post SN bootstrap rename pair; the b1 transitional
 * dual-name arm was removed once the Alembic b2 rename landed): ONLY
 * lib/Bootstrap.ts + SOUL.md mark the alembic-ai dev repo. Case-insensitive
 * filesystem caveat: existsSync matches either spelling on such systems
 * (this macOS), so the old-name-alone branch only flips to false on
 * case-sensitive filesystems — the test probes the tmpdir and pins the
 * behavior each filesystem actually has.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { _resetDevRepoCache, isAlembicDevRepo } from '../src/shared/isOwnDevRepo.js';

const tmpRoots: string[] = [];

function makeAlembicRepo(bootstrapFileName: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'is-own-dev-repo-'));
  tmpRoots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alembic-ai' }));
  fs.writeFileSync(path.join(root, 'SOUL.md'), 'soul');
  if (bootstrapFileName) {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', bootstrapFileName), 'export class Bootstrap {}\n');
  }
  return root;
}

function tmpdirIsCaseInsensitive(): boolean {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'case-probe-'));
  tmpRoots.push(probeRoot);
  fs.writeFileSync(path.join(probeRoot, 'probe-lower.txt'), '');
  return fs.existsSync(path.join(probeRoot, 'PROBE-LOWER.TXT'));
}

describe('isAlembicDevRepo bootstrap marker (final: lib/Bootstrap.ts only)', () => {
  afterEach(() => {
    _resetDevRepoCache();
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop();
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('accepts the final marker lib/Bootstrap.ts', () => {
    const root = makeAlembicRepo('Bootstrap.ts');
    expect(isAlembicDevRepo(root)).toBe(true);
  });

  it('rejects the retired old-name marker lib/bootstrap.ts on case-sensitive filesystems', () => {
    // On case-insensitive filesystems existsSync('lib/Bootstrap.ts') matches
    // the lowercase file, so the retired spelling still passes there; the
    // branch flips to false exactly where the rename pair mattered.
    const expected = tmpdirIsCaseInsensitive();
    const root = makeAlembicRepo('bootstrap.ts');
    expect(isAlembicDevRepo(root)).toBe(expected);
  });

  it('rejects an alembic-ai package with no bootstrap marker', () => {
    const root = makeAlembicRepo(null);
    expect(isAlembicDevRepo(root)).toBe(false);
  });
});

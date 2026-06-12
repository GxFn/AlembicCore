/**
 * isOwnDevRepo — alembic-ai dev-repo marker detection.
 *
 * Pins the TRANSITIONAL dual-name bootstrap marker (Core half of the SN
 * bootstrap rename pair): lib/bootstrap.ts (pre-rename) and lib/Bootstrap.ts
 * (post-rename) must BOTH be accepted until the Alembic b2 leg lands and the
 * old-name branch is cleaned up. On case-insensitive filesystems the two
 * positive branches collapse (existsSync matches either spelling); they pin
 * distinct behavior on case-sensitive CI.
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

describe('isAlembicDevRepo bootstrap marker (transitional dual-name)', () => {
  afterEach(() => {
    _resetDevRepoCache();
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop();
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('accepts the pre-rename marker lib/bootstrap.ts', () => {
    const root = makeAlembicRepo('bootstrap.ts');
    expect(isAlembicDevRepo(root)).toBe(true);
  });

  it('accepts the post-rename marker lib/Bootstrap.ts', () => {
    const root = makeAlembicRepo('Bootstrap.ts');
    expect(isAlembicDevRepo(root)).toBe(true);
  });

  it('rejects an alembic-ai package with neither bootstrap marker', () => {
    const root = makeAlembicRepo(null);
    expect(isAlembicDevRepo(root)).toBe(false);
  });
});

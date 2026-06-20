import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CapabilityProbe } from '../src/capability.js';

const tempRoots: string[] = [];

function makeTempPath(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `alembic-core-capability-${name}-`));
  tempRoots.push(root);
  return root;
}

function makeRepoLikePath(name: string) {
  const root = makeTempPath(name);
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe('CapabilityProbe', () => {
  it('reports absent sub-repository paths as local write scope', () => {
    const missingPath = path.join(os.tmpdir(), `missing-capability-probe-${Date.now()}`);
    const probe = new CapabilityProbe({ subRepoPath: missingPath });

    expect(probe.probe()).toBe('local-write');
    expect(probe.probeStatus()).toMatchObject({
      canWrite: true,
      reason: 'no-sub-repo',
      result: 'local-write',
    });
  });

  it('reports repo-like paths without remote as read-only in strict mode', () => {
    const repoPath = makeRepoLikePath('strict-no-remote');
    const probe = new CapabilityProbe({ noRemote: 'deny', subRepoPath: repoPath });

    expect(probe.probeStatus()).toMatchObject({
      canWrite: false,
      reason: 'no-remote-denied',
      result: 'read-only',
    });
  });

  it('keeps cache status in write-scope terminology', () => {
    const localPath = makeTempPath('local-dir');
    const probe = new CapabilityProbe({ subRepoPath: localPath });

    expect(probe.getCacheStatus()).toEqual({ cached: false });
    expect(probe.probe()).toBe('local-write');
    expect(probe.getCacheStatus()).toMatchObject({
      cached: true,
      canWrite: true,
      reason: 'not-git-repo',
      result: 'local-write',
    });
  });

  it('does not expose legacy role mapping helpers', () => {
    const probe = new CapabilityProbe({ subRepoPath: '/tmp/nonexistent-capability-probe' });
    const probeShape = probe as unknown as Record<string, unknown>;

    expect(probeShape[`to${'Role'}`]).toBeUndefined();
    expect(probeShape[`probe${'Role'}`]).toBeUndefined();
  });
});

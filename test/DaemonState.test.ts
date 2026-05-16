import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  DAEMON_STATE_SCHEMA_VERSION,
  type DaemonPaths,
  type DaemonState,
  ensureDaemonDirs,
  getPackageVersion,
  readDaemonState,
  removeDaemonState,
  resolveDaemonPaths,
  writeDaemonState,
} from '../src/daemon/DaemonState.js';
import { getGhostWorkspaceDir, ProjectRegistry } from '../src/shared/ProjectRegistry.js';

const ORIGINAL_ALEMBIC_HOME = process.env.ALEMBIC_HOME;

function useTempAlembicHome(): void {
  process.env.ALEMBIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-daemon-home-'));
}

function makeProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-daemon-project-'));
}

function makeState(paths: DaemonPaths, overrides: Partial<DaemonState> = {}): DaemonState {
  return {
    schemaVersion: DAEMON_STATE_SCHEMA_VERSION,
    projectRoot: paths.projectRoot,
    dataRoot: paths.dataRoot,
    projectId: paths.projectId,
    pid: process.pid,
    host: '127.0.0.1',
    port: 39127,
    url: 'http://127.0.0.1:39127',
    dashboardUrl: 'http://127.0.0.1:39127',
    token: 'test-token',
    version: getPackageVersion(),
    mode: 'daemon',
    startedAt: '2026-05-08T00:00:00.000Z',
    lastReadyAt: '2026-05-08T00:00:01.000Z',
    databasePath: path.join(paths.runtimeDir, 'alembic.db'),
    schemaMigrationVersion: '001',
    ...overrides,
  };
}

afterEach(() => {
  if (ORIGINAL_ALEMBIC_HOME === undefined) {
    delete process.env.ALEMBIC_HOME;
  } else {
    process.env.ALEMBIC_HOME = ORIGINAL_ALEMBIC_HOME;
  }
});

describe('DaemonState', () => {
  test('resolves daemon files under the ghost runtime directory', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    const entry = ProjectRegistry.register(projectRoot, true);
    const dataRoot = getGhostWorkspaceDir(entry.id);

    const paths = resolveDaemonPaths(projectRoot);
    ensureDaemonDirs(paths);

    expect(paths.dataRoot).toBe(dataRoot);
    expect(paths.runtimeDir).toBe(path.join(dataRoot, '.asd'));
    expect(paths.statePath).toBe(path.join(dataRoot, '.asd', 'daemon.json'));
    expect(paths.pidPath).toBe(path.join(dataRoot, '.asd', 'daemon.pid'));
    expect(paths.lockDir).toBe(path.join(dataRoot, '.asd', 'daemon.lock'));
    expect(paths.jobsDir).toBe(path.join(dataRoot, '.asd', 'jobs'));
    expect(fs.existsSync(paths.jobsDir)).toBe(true);
  });

  test('round-trips state and can clear files without deleting an owned lock', () => {
    useTempAlembicHome();
    const paths = resolveDaemonPaths(makeProjectRoot());
    ensureDaemonDirs(paths);
    fs.mkdirSync(paths.lockDir, { recursive: true });
    fs.writeFileSync(paths.pidPath, '12345\n');

    writeDaemonState(paths.statePath, makeState(paths));

    expect(readDaemonState(paths.statePath)).toMatchObject({
      schemaVersion: DAEMON_STATE_SCHEMA_VERSION,
      projectRoot: paths.projectRoot,
      dataRoot: paths.dataRoot,
      pid: process.pid,
      mode: 'daemon',
    });

    removeDaemonState(paths, { includeLock: false });

    expect(fs.existsSync(paths.statePath)).toBe(false);
    expect(fs.existsSync(paths.pidPath)).toBe(false);
    expect(fs.existsSync(paths.lockDir)).toBe(true);
  });

  test('rejects daemon state files without a bridge token', () => {
    useTempAlembicHome();
    const paths = resolveDaemonPaths(makeProjectRoot());
    ensureDaemonDirs(paths);
    const stateWithoutToken: Partial<DaemonState> = makeState(paths);
    delete stateWithoutToken.token;
    fs.writeFileSync(paths.statePath, `${JSON.stringify(stateWithoutToken, null, 2)}\n`);

    expect(readDaemonState(paths.statePath)).toBeNull();
  });
});

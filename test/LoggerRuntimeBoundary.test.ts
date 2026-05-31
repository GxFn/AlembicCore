import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { Logger } from '../src/infrastructure/logging/Logger.js';
import pathGuard from '../src/shared/PathGuard.js';

function makeAlembicDevRepo(root: string) {
  mkdirSync(path.join(root, 'lib'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alembic-ai' }));
  writeFileSync(path.join(root, 'lib', 'bootstrap.ts'), '');
  writeFileSync(path.join(root, 'SOUL.md'), '');
}

describe('Logger runtime boundary', () => {
  afterEach(() => {
    Logger.instance?.close();
    Logger.instance = null;
    pathGuard._reset();
  });

  test('redirects file logs away from excluded Alembic source repositories', () => {
    const root = path.join(tmpdir(), `alembic-logger-boundary-${Date.now()}`);
    const devLogs = path.join(tmpdir(), 'alembic-dev', 'logs');
    rmSync(root, { recursive: true, force: true });
    rmSync(devLogs, { recursive: true, force: true });
    makeAlembicDevRepo(root);
    pathGuard.configure({ projectRoot: root });

    const logger = Logger.getInstance({
      console: false,
      file: { enabled: true, path: './.asd/logs' },
    });
    logger.info('boundary smoke');

    expect(existsSync(path.join(root, '.asd'))).toBe(false);
    expect(existsSync(devLogs)).toBe(true);
  });
});

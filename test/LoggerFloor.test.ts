/**
 * CO4 E2 — infrastructure/logging floor suite.
 *
 * Real-behavior tests for Logger: file-transport routing (error/combined/
 * audit), audit isolation, level filtering, ALEMBIC_LOG_LEVEL precedence,
 * ALEMBIC_QUIET console suppression, and singleton reconfiguration.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Logger from '../src/infrastructure/logging/Logger.js';
import pathGuard from '../src/shared/PathGuard.js';

function flush(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonLines(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

describe('Logger floor', () => {
  let tmpDir: string;
  let logDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co4-logger-'));
    // Must live under .asd/ — other project-relative prefixes are redirected
    // by the PathGuard write-safety net (covered by LoggerRuntimeBoundary).
    logDir = path.join(tmpDir, '.asd', 'logs');
    delete process.env.ALEMBIC_LOG_LEVEL;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    Logger.instance?.close();
    Logger.instance = null;
  });

  afterEach(() => {
    Logger.instance?.close();
    Logger.instance = null;
    pathGuard._reset();
    process.env.ALEMBIC_LOG_LEVEL = savedEnv.ALEMBIC_LOG_LEVEL;
    process.env.ALEMBIC_QUIET = savedEnv.ALEMBIC_QUIET;
    if (savedEnv.ALEMBIC_LOG_LEVEL === undefined) {
      delete process.env.ALEMBIC_LOG_LEVEL;
    }
    if (savedEnv.ALEMBIC_QUIET === undefined) {
      delete process.env.ALEMBIC_QUIET;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('errors route to error.log AND combined.log; info only to combined.log', async () => {
    Logger.getInstance({ file: { enabled: true, path: logDir } });
    Logger.error('boom happened', { code: 'X1' });
    Logger.info('plain info');
    await flush();

    const errorLines = readJsonLines(path.join(logDir, 'error.log'));
    const combinedLines = readJsonLines(path.join(logDir, 'combined.log'));
    expect(errorLines.some((line) => line.message === 'boom happened')).toBe(true);
    expect(errorLines.some((line) => line.message === 'plain info')).toBe(false);
    expect(combinedLines.some((line) => line.message === 'boom happened')).toBe(true);
    expect(combinedLines.some((line) => line.message === 'plain info')).toBe(true);
    // Structured meta survives JSON serialization.
    const errorEntry = combinedLines.find((line) => line.message === 'boom happened');
    expect(errorEntry?.code).toBe('X1');
  });

  test('audit events land in audit.log; plain info does not', async () => {
    Logger.getInstance({ file: { enabled: true, path: logDir } });
    Logger.audit('knowledge_published', { entryId: 'k1' });
    Logger.info('not an audit event');
    await flush();

    const auditLines = readJsonLines(path.join(logDir, 'audit.log'));
    expect(auditLines.some((line) => line.message === 'knowledge_published')).toBe(true);
    expect(auditLines.some((line) => line.message === 'not an audit event')).toBe(false);
    const audited = auditLines.find((line) => line.message === 'knowledge_published');
    expect(audited?.entryId).toBe('k1');
    expect(audited?.audit).toBe(true);
  });

  test('level filtering: at level=error, info/warn are suppressed in combined.log', async () => {
    Logger.getInstance({ level: 'error', file: { enabled: true, path: logDir } });
    Logger.info('filtered info');
    Logger.warn('filtered warn');
    Logger.error('kept error');
    await flush();

    const combinedLines = readJsonLines(path.join(logDir, 'combined.log'));
    expect(combinedLines.some((line) => line.message === 'kept error')).toBe(true);
    expect(combinedLines.some((line) => line.message === 'filtered info')).toBe(false);
    expect(combinedLines.some((line) => line.message === 'filtered warn')).toBe(false);
  });

  test('ALEMBIC_LOG_LEVEL env var overrides the configured level', () => {
    process.env.ALEMBIC_LOG_LEVEL = 'debug';
    const logger = Logger.getInstance({ level: 'error', file: { enabled: true, path: logDir } });
    expect(logger.level).toBe('debug');
  });

  test('ALEMBIC_QUIET=1 suppresses the console transport entirely', () => {
    const logger = Logger.getInstance({ file: { enabled: true, path: logDir } });
    const transportNames = logger.transports.map((transport) => transport.constructor.name);
    expect(transportNames).not.toContain('Console');
    // The three file transports are still attached.
    expect(transportNames.filter((name) => name === 'File')).toHaveLength(3);
  });

  test('getInstance reconfigures the existing singleton in place (same reference, new files)', async () => {
    const first = Logger.getInstance({ file: { enabled: true, path: logDir } });
    const otherDir = path.join(tmpDir, '.asd', 'logs-moved');
    const second = Logger.getInstance({ file: { enabled: true, path: otherDir } });

    expect(second).toBe(first);
    Logger.info('after reconfigure');
    await flush();
    const movedCombined = readJsonLines(path.join(otherDir, 'combined.log'));
    expect(movedCombined.some((line) => line.message === 'after reconfigure')).toBe(true);
  });
});

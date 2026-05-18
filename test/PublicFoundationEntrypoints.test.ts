import { describe, expect, it } from 'vitest';

import { ConfigLoader } from '../src/config.js';
import {
  ALEMBIC_RUNTIME_HEALTH_PATH,
  createAlembicRuntimeCapabilities,
  DAEMON_STATE_SCHEMA_VERSION,
  JobStore,
} from '../src/daemon/index.js';
import { EventBus, SignalBus, timerRegistry } from '../src/events.js';
import { pathGuard, WriteZone } from '../src/io.js';
import { Logger } from '../src/logging.js';
import { DEFAULT_FOLDER_NAMES, resolveProjectRoot, WorkspaceResolver } from '../src/workspace.js';

describe('stable foundation entrypoints', () => {
  it('exposes logging through the narrow logging entrypoint', () => {
    expect(Logger).toBeDefined();
    expect(Logger.getInstance({ console: false })).toBeDefined();
  });

  it('exposes workspace path contracts through the narrow workspace entrypoint', () => {
    expect(DEFAULT_FOLDER_NAMES.project.runtime).toBe('.asd');
    expect(resolveProjectRoot()).toBe(process.cwd());
    expect(WorkspaceResolver).toBeDefined();
  });

  it('exposes write-boundary contracts through the narrow io entrypoint', () => {
    expect(WriteZone).toBeDefined();
    expect(pathGuard).toBeDefined();
  });

  it('exposes event, signal, and timer contracts through the narrow events entrypoint', () => {
    const eventBus = new EventBus();
    const signalBus = new SignalBus();

    expect(eventBus.getStats().totalEvents).toBe(0);
    expect(signalBus.emitCount).toBe(0);
    expect(timerRegistry).toBeDefined();
  });

  it('keeps daemon job state available through the existing daemon entrypoint', () => {
    expect(DAEMON_STATE_SCHEMA_VERSION).toBe(1);
    expect(JobStore).toBeDefined();
  });

  it('exposes runtime capability contracts through the daemon entrypoint', () => {
    expect(ALEMBIC_RUNTIME_HEALTH_PATH).toBe('/api/v1/daemon/health');
    expect(createAlembicRuntimeCapabilities).toBeDefined();
  });

  it('exposes config as a provisional module-level entrypoint', () => {
    expect(ConfigLoader).toBeDefined();
  });
});

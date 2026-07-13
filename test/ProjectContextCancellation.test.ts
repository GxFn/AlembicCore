import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DiscovererRegistry } from '../src/core/discovery/DiscovererRegistry.js';
import { GenericDiscoverer } from '../src/core/discovery/GenericDiscoverer.js';
import { ProjectDiscoverer } from '../src/core/discovery/ProjectDiscoverer.js';
import { createProjectContextCapabilities } from '../src/service/project-context/capabilities.js';
import { createProjectContext } from '../src/service/project-context/interface/projectContext.js';
import { loadSourceSliceFile } from '../src/service/project-context/sourceSlice/fileAccess.js';

const REQUEST = {
  kind: 'repo' as const,
  payload: {},
  project: { projectRoot: process.cwd() },
  scope: { projectRoot: process.cwd() },
};

describe('ProjectContext cancellation', () => {
  it('keeps AbortSignal outside the serialized request and passes it separately to handlers', async () => {
    const controller = new AbortController();
    const handler = vi.fn(async (request, context) => ({
      data: {
        available: false as const,
        message: `${'signal' in request}:${context?.signal === controller.signal}`,
        nextRefs: [],
        queryLevel: 'repo' as const,
      },
    }));
    const projectContext = createProjectContext({ repo: handler });

    const result = await projectContext.execute(REQUEST, { signal: controller.signal });

    expect((result.data as { message: string }).message).toBe('false:true');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(REQUEST)).not.toContain('signal');
  });

  it('rejects a pre-aborted request before the handler starts with normalized AbortError', async () => {
    const controller = new AbortController();
    controller.abort('deadline');
    const handler = vi.fn();
    const projectContext = createProjectContext({ repo: handler });

    await expect(
      projectContext.execute(REQUEST, { signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('normalizes custom abort reasons on the real source-file access path', async () => {
    const controller = new AbortController();
    controller.abort('deadline');

    await expect(
      loadSourceSliceFile({
        filePath: 'package.json',
        projectRoot: process.cwd(),
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops an injected mid-run worker and settles its cleanup', async () => {
    const controller = new AbortController();
    let ticks = 0;
    let cleaned = false;
    const projectContext = createProjectContext({
      repo: async (_request, context) =>
        new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            ticks++;
            if (ticks > 100) {
              resolve({
                data: { available: false, message: 'unexpected', nextRefs: [], queryLevel: 'repo' },
              });
            }
          }, 1);
          const stop = () => {
            clearInterval(timer);
            context?.signal?.removeEventListener('abort', stop);
            cleaned = true;
            const error = new Error('cancelled');
            error.name = 'AbortError';
            reject(error);
          };
          context?.signal?.addEventListener('abort', stop, { once: true });
        }),
    });

    const pending = projectContext.execute(REQUEST, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 8));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const stoppedAt = ticks;
    await new Promise((resolve) => setTimeout(resolve, 8));

    expect(cleaned).toBe(true);
    expect(ticks).toBe(stoppedAt);
  });

  it('propagates cancellation into an in-flight project discoverer worker', async () => {
    const controller = new AbortController();
    let ticks = 0;
    class SlowDiscoverer extends ProjectDiscoverer {
      override get id() {
        return 'slow';
      }
      override get displayName() {
        return 'Slow';
      }
      override async detect(_root: string, context?: { signal?: AbortSignal }) {
        return new Promise<{ match: boolean; confidence: number; reason: string }>(
          (_resolve, reject) => {
            const timer = setInterval(() => ticks++, 1);
            context?.signal?.addEventListener(
              'abort',
              () => {
                clearInterval(timer);
                const error = new Error('cancelled');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true }
            );
          }
        );
      }
    }
    const registry = new DiscovererRegistry().register(new SlowDiscoverer());

    const pending = registry.analyzeConflict(process.cwd(), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 8));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const stoppedAt = ticks;
    await new Promise((resolve) => setTimeout(resolve, 8));
    expect(ticks).toBe(stoppedAt);
  });

  it('stops the real GenericDiscoverer asynchronous DFS after abort', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-discovery-cancel-'));
    try {
      for (let index = 0; index < 120; index++) {
        const directory = path.join(root, 'src', `feature-${index}`);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `file-${index}.ts`), 'export const value = 1;');
      }
      const controller = new AbortController();
      const discoverer = new GenericDiscoverer();
      const pending = discoverer.load(root, { signal: controller.signal });
      setTimeout(() => controller.abort('deadline'), 0);

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it('forwards execution context through typed capability helpers', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({
      contractVersion: 1 as const,
      data: { available: false as const, message: 'ok', nextRefs: [], queryLevel: 'repo' as const },
      project: { displayName: 'x', projectId: 'x', projectRoot: process.cwd(), source: 'x' },
      queryLevel: 'repo' as const,
      refs: [],
    }));
    const capabilities = createProjectContextCapabilities({ execute });

    await capabilities.executeRepoQuery(
      {
        payload: {},
        project: { projectRoot: process.cwd() },
        scope: { projectRoot: process.cwd() },
      },
      { signal: controller.signal }
    );

    expect(execute.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

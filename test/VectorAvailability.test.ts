import { describe, expect, it, vi } from 'vitest';

import { type EmbedProvider, type VectorAvailability, VectorService } from '../src/vector.js';

function createMockVectorStore() {
  return {
    batchUpsert: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    getStats: vi
      .fn()
      .mockResolvedValue({ count: 3, dimension: 768, indexSize: 10, quantized: false }),
    listIds: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    searchVector: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPipeline() {
  return {
    run: vi.fn(),
    setAiProvider: vi.fn(),
  };
}

function createService(embedProvider: EmbedProvider | null): VectorService {
  return new VectorService({
    autoSyncOnCrud: false,
    contextualEnricher: null,
    embedProvider,
    eventBus: null,
    hybridRetriever: null,
    indexingPipeline: createMockPipeline() as never,
    syncDebounceMs: 100,
    vectorStore: createMockVectorStore() as never,
  });
}

describe('VectorService availability surface', () => {
  it('reports a deterministic unavailable state when no embed provider is configured', async () => {
    const service = createService(null);

    const availability: VectorAvailability = await service.getAvailability();

    expect(await service.isAvailable()).toBe(false);
    expect(availability).toEqual({
      available: false,
      embedProviderConfigured: false,
      probeStatus: 'not-applicable',
      reason: 'embed-provider-missing',
      status: 'unavailable',
    });
    await expect(service.getStats()).resolves.toMatchObject({
      embedProviderAvailable: false,
    });
  });

  it('keeps provider-present stats compatible when a provider has no readiness probe', async () => {
    const service = createService({ embed: vi.fn(async () => [0.1, 0.2]) });

    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.getAvailability()).resolves.toEqual({
      available: true,
      embedProviderConfigured: true,
      probeStatus: 'not-supported',
      reason: 'embed-provider-configured',
      status: 'available',
    });
    await expect(service.getStats()).resolves.toMatchObject({
      embedProviderAvailable: true,
    });
  });

  it('uses a provider readiness probe for the standard boolean surface', async () => {
    const provider = {
      embed: vi.fn(async () => [0.1, 0.2]),
      isAvailable: vi.fn(async () => true),
    };
    const service = createService(provider);

    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.getAvailability()).resolves.toMatchObject({
      available: true,
      probeStatus: 'available',
      reason: 'embed-provider-ready',
      status: 'available',
    });
    expect(provider.isAvailable).toHaveBeenCalled();
  });

  it('reports provider probe degradation without changing legacy stats presence semantics', async () => {
    const service = createService({
      embed: vi.fn(async () => [0.1, 0.2]),
      isAvailable: vi.fn(async () => false),
    });

    await expect(service.isAvailable()).resolves.toBe(false);
    await expect(service.getAvailability()).resolves.toEqual({
      available: false,
      embedProviderConfigured: true,
      probeStatus: 'unavailable',
      reason: 'embed-provider-unavailable',
      status: 'degraded',
    });
    await expect(service.getStats()).resolves.toMatchObject({
      embedProviderAvailable: true,
    });
  });

  it('keeps probe failures observable as a stable degraded reason', async () => {
    const service = createService({
      embed: vi.fn(async () => [0.1, 0.2]),
      isAvailable: vi.fn(async () => {
        throw new Error('probe failed');
      }),
    });

    await expect(service.getAvailability()).resolves.toEqual({
      available: false,
      detail: 'probe failed',
      embedProviderConfigured: true,
      probeStatus: 'error',
      reason: 'embed-provider-probe-failed',
      status: 'degraded',
    });
  });
});

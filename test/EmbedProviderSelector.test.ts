// GMAP-L1 — local-first embed-lane selection + lane switching. Covers the
// degradation chain (ollama -> resident -> keyword) with honest diagnostics, the
// keyword baseline (null provider), and applyEmbedLane driving a REAL
// VectorService.migrateDimension (clear -> swap provider -> full rebuild).

import { describe, expect, it, vi } from 'vitest';
import {
  applyEmbedLane,
  buildLocalFirstEmbedLanes,
  type EmbedLane,
  embedLaneFromProvider,
  keywordEmbedLane,
  selectAndApplyEmbedLane,
  selectEmbedLane,
  VectorService,
} from '../src/vector.js';

const dummyProvider = { embed: async () => [] };

function lane(name: string, available: boolean): EmbedLane {
  return { isAvailable: async () => available, name, provider: dummyProvider };
}

describe('selectEmbedLane — local-first degradation', () => {
  it('selects the first available lane and reports honest per-lane diagnostics', async () => {
    const selection = await selectEmbedLane([
      lane('ollama', false),
      lane('resident', true),
      keywordEmbedLane(),
    ]);

    expect(selection.lane).toBe('resident');
    expect(selection.provider).toBe(dummyProvider);

    const byName = Object.fromEntries(selection.diagnostics.map((d) => [d.name, d]));
    expect(byName.ollama).toMatchObject({ available: false, probed: true, selected: false });
    expect(byName.resident).toMatchObject({ available: true, probed: true, selected: true });
    expect(byName.keyword).toMatchObject({ probed: false, selected: false });
  });

  it('falls back to the keyword baseline (null provider) when no embed lane is available', async () => {
    const selection = await selectEmbedLane([lane('ollama', false), keywordEmbedLane()]);
    expect(selection.lane).toBe('keyword');
    expect(selection.provider).toBeNull();
  });

  it('prefers ollama when available and does not probe later lanes', async () => {
    let residentProbed = false;
    const resident: EmbedLane = {
      isAvailable: async () => {
        residentProbed = true;
        return true;
      },
      name: 'resident',
      provider: dummyProvider,
    };
    const selection = await selectEmbedLane([lane('ollama', true), resident, keywordEmbedLane()]);
    expect(selection.lane).toBe('ollama');
    expect(residentProbed).toBe(false);
  });

  it('treats a throwing probe as unavailable and records the reason', async () => {
    const flaky: EmbedLane = {
      isAvailable: async () => {
        throw new Error('connect boom');
      },
      name: 'ollama',
      provider: dummyProvider,
    };
    const selection = await selectEmbedLane([flaky, keywordEmbedLane()]);
    expect(selection.lane).toBe('keyword');
    expect(selection.diagnostics.find((d) => d.name === 'ollama')?.reason).toMatch(/connect boom/);
  });
});

describe('buildLocalFirstEmbedLanes', () => {
  it('orders ollama -> resident -> keyword', () => {
    const lanes = buildLocalFirstEmbedLanes({
      ollama: { model: 'qwen3' },
      resident: embedLaneFromProvider('resident', dummyProvider),
    });
    expect(lanes.map((l) => l.name)).toEqual(['ollama', 'resident', 'keyword']);
  });

  it('always ends with the keyword baseline when optionals are omitted', () => {
    expect(buildLocalFirstEmbedLanes({}).map((l) => l.name)).toEqual(['keyword']);
  });
});

describe('applyEmbedLane', () => {
  it('calls migrateDimension with the selected provider', async () => {
    const migrateDimension = vi.fn(async () => ({
      chunked: 5,
      duration: 1,
      embedded: 5,
      enriched: 0,
      errors: [],
      scanned: 5,
      skipped: 0,
      upserted: 5,
    }));
    const provider = { embed: async () => [] };
    const result = await applyEmbedLane(
      { migrateDimension },
      { diagnostics: [], lane: 'ollama', provider }
    );
    expect(migrateDimension).toHaveBeenCalledWith(provider, {});
    expect(result.switched).toBe(true);
    expect(result.rebuild?.upserted).toBe(5);
  });

  it('is a no-op for the keyword baseline (null provider)', async () => {
    const migrateDimension = vi.fn();
    const result = await applyEmbedLane(
      { migrateDimension },
      { diagnostics: [], lane: 'keyword', provider: null }
    );
    expect(migrateDimension).not.toHaveBeenCalled();
    expect(result.switched).toBe(false);
    expect(result.reason).toMatch(/keyword baseline/);
  });
});

describe('applyEmbedLane over a real VectorService.migrateDimension', () => {
  function createMockVectorStore() {
    return {
      batchUpsert: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ count: 0, dimension: 2, indexSize: 0 }),
      listIds: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
      searchByFilter: vi.fn().mockResolvedValue([]),
      searchVector: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('clears the index, swaps the provider, and rebuilds', async () => {
    const store = createMockVectorStore();
    const pipeline = {
      run: vi.fn().mockResolvedValue({
        chunked: 2,
        embedded: 2,
        enriched: 0,
        errors: [],
        scanned: 2,
        skipped: 0,
        upserted: 2,
      }),
      setAiProvider: vi.fn(),
    };
    const providerA = { embed: vi.fn(async () => [0, 1]) };
    const providerB = { embed: vi.fn(async () => [1, 0]) };
    const vectorService = new VectorService({
      autoSyncOnCrud: false,
      contextualEnricher: null,
      embedProvider: providerA as never,
      eventBus: null,
      hybridRetriever: null,
      indexingPipeline: pipeline as never,
      syncDebounceMs: 100,
      vectorStore: store as never,
    });

    const result = await applyEmbedLane(vectorService, {
      diagnostics: [],
      lane: 'ollama',
      provider: providerB as never,
    });

    expect(result.switched).toBe(true);
    expect(result.rebuild?.upserted).toBe(2);
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(pipeline.setAiProvider).toHaveBeenCalledWith(providerB);
    expect(pipeline.run).toHaveBeenCalledTimes(1);

    // Provider really swapped: a subsequent semantic search uses B, not A.
    await vectorService.search('query');
    expect(providerB.embed).toHaveBeenCalled();
    expect(providerA.embed).not.toHaveBeenCalled();
  });
});

describe('selectAndApplyEmbedLane', () => {
  it('selects then applies in one call (keyword no-op)', async () => {
    const migrateDimension = vi.fn();
    const result = await selectAndApplyEmbedLane({ migrateDimension }, [
      lane('ollama', false),
      keywordEmbedLane(),
    ]);
    expect(result.lane).toBe('keyword');
    expect(result.switched).toBe(false);
    expect(migrateDimension).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  VectorIndexReaderAdapter,
  VectorIndexWriterAdapter,
} from '../src/service/vector/VectorIndexPorts.js';

describe('VectorIndex ports', () => {
  it('exposes read inventory without write methods', async () => {
    const store = {
      getById: vi.fn(async () => ({ id: 'a' })),
      getStats: vi.fn(async () => ({ count: 1, indexSize: 10 })),
      listIds: vi.fn(async () => ['a']),
      searchVector: vi.fn(async () => [{ item: { id: 'a' }, score: 0.8 }]),
    };
    const reader = new VectorIndexReaderAdapter(store);

    await expect(reader.searchVector([1], { topK: 1 })).resolves.toHaveLength(1);
    await expect(reader.getById('a')).resolves.toEqual({ id: 'a' });
    await expect(reader.listIds({ limit: 1 })).resolves.toEqual(['a']);
    expect('upsert' in reader).toBe(false);
    expect('clear' in reader).toBe(false);
  });

  it('keeps mutations on a separate writer adapter', async () => {
    const store = {
      batchUpsert: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
    };
    const writer = new VectorIndexWriterAdapter(store);
    const item = { content: 'x', id: 'a', metadata: {}, vector: [1] };

    await writer.upsert(item);
    await writer.batchUpsert([item]);
    await writer.remove('a');
    await writer.clear();

    expect(store.upsert).toHaveBeenCalledWith(item);
    expect(store.batchUpsert).toHaveBeenCalledWith([item]);
  });
});

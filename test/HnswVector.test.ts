// HNSW 图、量化、召回与 store 查询契约；pipeline、持久化和通用排名分别维护。
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { crc32, WAL_OP } from '../src/infrastructure/vector/AsyncPersistence.js';
import { BinaryPersistence } from '../src/infrastructure/vector/BinaryPersistence.js';
import {
  cosineDistance,
  HnswIndex,
  MaxHeap,
  MinHeap,
} from '../src/infrastructure/vector/HnswIndex.js';
import { HnswVectorAdapter } from '../src/infrastructure/vector/HnswVectorAdapter.js';
import { ScalarQuantizer } from '../src/infrastructure/vector/ScalarQuantizer.js';
import { VectorMigration } from '../src/infrastructure/vector/VectorMigration.js';

function randomVector(dim) {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() - 0.5;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    v[i] /= norm;
  }
  return v;
}

describe('HnswIndex', () => {
  it('should add and search points', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 32 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0.9, 0.1, 0]);
    index.addPoint('c', [0, 1, 0]);
    index.addPoint('d', [0, 0, 1]);

    const results = index.searchKnn([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a');
    expect(results[0].dist).toBeCloseTo(0, 3);
    expect(results[1].id).toBe('b');
  });

  it('should handle single point', () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('only', [1, 0]);
    const results = index.searchKnn([1, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
  });

  it('should return empty for empty index', () => {
    const index = new HnswIndex();
    const results = index.searchKnn([1, 0], 5);
    expect(results).toHaveLength(0);
  });

  it('should remove points', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 32 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0, 1, 0]);
    index.addPoint('c', [0, 0, 1]);

    index.removePoint('a');
    const results = index.searchKnn([1, 0, 0], 3);
    expect(results.every((r) => r.id !== 'a')).toBe(true);
  });

  it('should update point (addPoint with existing id)', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 32 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0, 1, 0]);

    // Update 'a' to point in opposite direction
    index.addPoint('a', [0, 0, 1]);

    const results = index.searchKnn([0, 0, 1], 1);
    expect(results[0].id).toBe('a');
  });

  it('should serialize and deserialize', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 32 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0, 1, 0]);
    index.addPoint('c', [0.5, 0.5, 0]);

    const data = index.serialize();
    const restored = HnswIndex.deserialize(data);

    const results = restored.searchKnn([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a');
  });

  it('should handle moderate scale (500 vectors, 32d)', () => {
    const dim = 32;
    const n = 500;
    const index = new HnswIndex({ M: 8, efConstruct: 64, efSearch: 50 });

    const vectors = [];
    for (let i = 0; i < n; i++) {
      const v = randomVector(dim);
      vectors.push({ id: `v${i}`, vector: v });
      index.addPoint(`v${i}`, v);
    }

    // 用第一个向量搜索, 应该返回自身
    const results = index.searchKnn(vectors[0].vector, 1);
    expect(results[0].id).toBe('v0');
    expect(results[0].dist).toBeCloseTo(0, 4);
  });

  it('should provide stats', () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('a', [1, 0]);
    index.addPoint('b', [0, 1]);
    index.addPoint('c', [1, 1]);

    const stats = index.getStats();
    expect(stats.totalNodes).toBe(3);
    expect(stats.deletedSlots).toBe(0);
  });

  it('addPoints batch should work', () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoints([
      { id: 'x', vector: [1, 0] },
      { id: 'y', vector: [0, 1] },
    ]);
    expect(index.size).toBe(2);
  });
});

describe('MinHeap', () => {
  it('should pop smallest first', () => {
    const heap = new MinHeap();
    heap.push(0, 5);
    heap.push(1, 2);
    heap.push(2, 8);
    heap.push(3, 1);

    expect(heap.pop().dist).toBe(1);
    expect(heap.pop().dist).toBe(2);
    expect(heap.pop().dist).toBe(5);
    expect(heap.pop().dist).toBe(8);
    expect(heap.size).toBe(0);
  });
});

describe('MaxHeap', () => {
  it('should pop largest first', () => {
    const heap = new MaxHeap();
    heap.push(0, 5);
    heap.push(1, 2);
    heap.push(2, 8);
    heap.push(3, 1);

    expect(heap.pop().dist).toBe(8);
    expect(heap.pop().dist).toBe(5);
    expect(heap.peek().dist).toBe(2);
  });

  it('toSortedArray returns ascending order', () => {
    const heap = new MaxHeap();
    heap.push(0, 3);
    heap.push(1, 1);
    heap.push(2, 2);
    const sorted = heap.toSortedArray();
    expect(sorted.map((s) => s.dist)).toEqual([1, 2, 3]);
  });
});

describe('cosineDistance', () => {
  it('identical vectors have distance 0', () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 5);
  });

  it('orthogonal vectors have distance 1', () => {
    expect(cosineDistance([1, 0, 0], [0, 1, 0])).toBeCloseTo(1, 5);
  });

  it('handles empty/null inputs', () => {
    expect(cosineDistance([], [1])).toBe(1);
    expect(cosineDistance(null, [1])).toBe(1);
  });
});

describe('ScalarQuantizer', () => {
  it('should train and encode/decode with low error', () => {
    const dim = 8;
    const sq = new ScalarQuantizer(dim);

    // 生成训练数据
    const vectors = Array.from({ length: 100 }, () => randomVector(dim));
    sq.train(vectors);
    expect(sq.trained).toBe(true);

    // 编码再解码, 误差应该很小
    const original = vectors[0];
    const encoded = sq.encode(original);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(dim);

    const decoded = sq.decode(encoded);
    expect(decoded).toBeInstanceOf(Float32Array);

    // 每维误差 < 2% of range
    for (let i = 0; i < dim; i++) {
      expect(Math.abs(decoded[i] - original[i])).toBeLessThan(0.1);
    }
  });

  it('should compute distance in quantized space', () => {
    const dim = 4;
    const sq = new ScalarQuantizer(dim);
    sq.train([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);

    const a = sq.encode([1, 0, 0, 0]);
    const b = sq.encode([1, 0, 0, 0]);
    const c = sq.encode([0, 1, 0, 0]);

    expect(sq.distance(a, b)).toBe(0);
    expect(sq.distance(a, c)).toBeGreaterThan(0);
  });

  it('should serialize and deserialize', () => {
    const sq = new ScalarQuantizer(4);
    sq.train([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);

    const data = sq.serialize();
    const restored = ScalarQuantizer.deserialize(data);
    expect(restored.trained).toBe(true);
    expect(restored.dimension).toBe(4);

    const encoded = restored.encode([3, 4, 5, 6]);
    expect(encoded).toBeInstanceOf(Uint8Array);
  });

  it('should throw if not trained', () => {
    const sq = new ScalarQuantizer(4);
    expect(() => sq.encode([1, 2, 3, 4])).toThrow('not trained');
  });

  it('encodeBatch should work', () => {
    const sq = new ScalarQuantizer(2);
    sq.train([
      [0, 0],
      [1, 1],
    ]);
    const batch = sq.encodeBatch([
      [0.5, 0.5],
      [0.2, 0.8],
    ]);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toBeInstanceOf(Uint8Array);
  });
});

describe('HnswVectorAdapter', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-hnsw-'));
  });
  afterEach(() => {
    if (store && typeof store.destroy === 'function') {
      store.destroy();
    }
    store = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should upsert and search', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    store.initSync();

    await store.upsert({
      id: 'doc-1',
      content: 'hello world',
      vector: [1, 0, 0],
      metadata: { type: 'test' },
    });
    await store.upsert({
      id: 'doc-2',
      content: 'foo bar',
      vector: [0, 1, 0],
      metadata: { type: 'test' },
    });

    const results = await store.searchVector([1, 0, 0], { topK: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].item.id).toBe('doc-1');
    expect(results[0].score).toBeCloseTo(1.0, 2);
  });

  it('should support getById', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();

    await store.upsert({
      id: 'x',
      content: 'test content',
      vector: [1, 0],
      metadata: { lang: 'js' },
    });

    const item = await store.getById('x');
    expect(item).not.toBeNull();
    expect(item.content).toBe('test content');
    expect(item.metadata.lang).toBe('js');

    const missing = await store.getById('nope');
    expect(missing).toBeNull();
  });

  it('should support remove', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();

    await store.upsert({ id: 'a', content: 'A', vector: [1, 0], metadata: {} });
    await store.upsert({ id: 'b', content: 'B', vector: [0, 1], metadata: {} });

    await store.remove('a');
    const item = await store.getById('a');
    expect(item).toBeNull();

    const ids = await store.listIds();
    expect(ids).toEqual(['b']);
  });

  it('should support batchUpsert', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();

    await store.batchUpsert([
      { id: 'a', content: 'alpha', vector: [1, 0, 0], metadata: { title: 'Alpha' } },
      { id: 'b', content: 'beta', vector: [0.9, 0.1, 0], metadata: { title: 'Beta' } },
      { id: 'c', content: 'gamma', vector: [0, 1, 0], metadata: { title: 'Gamma' } },
    ]);

    const results = await store.query([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a');
    expect(results[0].similarity).toBeCloseTo(1.0, 2);
  });

  it('should support hybridSearch', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    store.initSync();

    await store.batchUpsert([
      {
        id: 'x',
        content: 'singleton pattern for shared instance',
        vector: [1, 0, 0],
        metadata: {},
      },
      {
        id: 'y',
        content: 'factory method for object creation',
        vector: [0, 1, 0],
        metadata: {},
      },
    ]);

    const results = await store.hybridSearch([1, 0, 0], 'singleton shared', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.id).toBe('x');
  });

  it('should support clear', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();

    await store.upsert({ id: 'a', content: 'test', vector: [1, 0], metadata: {} });
    await store.clear();

    const ids = await store.listIds();
    expect(ids).toHaveLength(0);
  });

  it('should provide stats', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();

    await store.upsert({ id: 'v1', content: 'test', vector: [1, 2], metadata: {} });
    await store.upsert({ id: 'v2', content: 'test2', vector: [], metadata: {} });

    const stats = await store.getStats();
    expect(stats.count).toBe(2);
    expect(stats.hasVectors).toBe(1); // only v1 has non-empty vector
  });

  it.each([
    'upsert',
    'batchUpsert',
    'replay',
  ])('removes the old ANN vector when %s replaces an item with an empty vector', async (mode) => {
    store = new HnswVectorAdapter(tmpDir, { M: 4, flushIntervalMs: 60000 });
    store.initSync();
    await store.upsert({ id: 'a', content: 'old embedding', vector: [1, 0] });
    await store.flush();
    const replacement = {
      id: 'a',
      content: 'keyword only',
      vector: [],
      metadata: { stage: 'new' },
    };
    if (mode === 'replay') {
      store.destroy();
      const op = JSON.stringify({
        t: WAL_OP.UPSERT,
        id: 'a',
        c: replacement.content,
        v: [],
        m: replacement.metadata,
      });
      fs.writeFileSync(
        path.join(tmpDir, '.asd/context/index/vector_index.wal'),
        `${op}\t${crc32(op)}\n`
      );
      store = new HnswVectorAdapter(tmpDir, { M: 4 });
      await store.init();
    } else if (mode === 'batchUpsert') {
      await store.batchUpsert([replacement]);
    } else {
      await store.upsert(replacement);
    }

    expect(await store.getById('a')).toMatchObject(replacement);
    expect(await store.searchVector([1, 0], { topK: 5 })).toEqual([]);
    expect(await store.getStats()).toMatchObject({ count: 1, hasVectors: 0 });
    await store.flush();
    store.destroy();
    store = new HnswVectorAdapter(tmpDir, { M: 4 });
    store.initSync();
    expect(await store.getById('a')).toMatchObject(replacement);
    expect(await store.searchVector([1, 0], { topK: 5 })).toEqual([]);
  });

  it('should persist and reload via flush + initSync', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    store.initSync();

    await store.batchUpsert([
      { id: 'doc-1', content: 'hello', vector: [1, 0, 0], metadata: { type: 'test' } },
      { id: 'doc-2', content: 'world', vector: [0, 1, 0], metadata: { type: 'test' } },
    ]);
    await store.flush();
    store.destroy();

    // New instance
    store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    store.initSync();

    const item = await store.getById('doc-1');
    expect(item).not.toBeNull();
    expect(item.content).toBe('hello');

    const results = await store.searchVector([1, 0, 0], { topK: 1 });
    expect(results[0].item.id).toBe('doc-1');
  });

  it.each([
    'automatic',
    'explicit',
    'destroy',
  ])('persists writes made during a non-WAL snapshot with %s flush', async (mode) => {
    const seedIndex = new HnswIndex({ M: 4 });
    seedIndex.addPoint('obsolete', [1, 0]);
    BinaryPersistence.save(path.join(tmpDir, '.asd/context/index/vector_index.asvec'), {
      index: seedIndex,
      quantizer: null,
      metadata: new Map([['obsolete', {}]]),
      contents: new Map([['obsolete', 'remove during the next write']]),
    });
    store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      walEnabled: false,
      flushIntervalMs: 10,
      flushBatchSize: 1,
    });
    store.initSync();
    const releaseFirst = Promise.withResolvers<void>();
    let writes = 0;
    let firstSaved = false;
    const delayedWrite = vi
      .spyOn(BinaryPersistence, 'saveAsync')
      .mockImplementation(async (filePath, data) => {
        // 使用真实ASVEC编码并捕获本次快照，延迟的是编码后的文件写入阶段。
        const snapshot = BinaryPersistence.encode(data);
        writes++;
        const first = writes === 1;
        if (first) {
          await releaseFirst.promise;
        }
        fs.writeFileSync(filePath, snapshot);
        if (first) {
          firstSaved = true;
        }
      });
    try {
      await store.upsert({ id: 'a', content: 'first snapshot', vector: [1, 0] });
      await store.upsert({ id: 'b', content: 'arrived during write', vector: [0, 1] });
      await store.remove('obsolete');
      const explicitFlush = mode === 'explicit' ? store.flush() : null;
      if (mode === 'destroy') {
        store.destroy();
      }
      releaseFirst.resolve();
      await vi.waitFor(() => expect(firstSaved).toBe(true));
      if (mode === 'explicit') {
        await explicitFlush;
      } else if (mode === 'automatic') {
        await vi.waitFor(() => {
          const saved = BinaryPersistence.load(
            path.join(tmpDir, '.asd/context/index/vector_index.asvec')
          );
          expect([...saved.metadata.keys()].sort()).toEqual(['a', 'b']);
        });
      }
      const reopened = new HnswVectorAdapter(tmpDir, { M: 4, walEnabled: false });
      try {
        reopened.initSync();
        expect(await reopened.getById('b')).toMatchObject({
          content: 'arrived during write',
          vector: [0, 1],
        });
        expect(await reopened.getById('obsolete')).toBeNull();
      } finally {
        reopened.destroy();
      }
    } finally {
      releaseFirst.resolve();
      delayedWrite.mockRestore();
    }
  });

  it('should support filter in searchVector', async () => {
    store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    store.initSync();

    await store.batchUpsert([
      {
        id: 'a',
        content: 'test',
        vector: [1, 0, 0],
        metadata: { type: 'recipe', language: 'swift' },
      },
      {
        id: 'b',
        content: 'test',
        vector: [0.9, 0.1, 0],
        metadata: { type: 'code', language: 'python' },
      },
      {
        id: 'c',
        content: 'test',
        vector: [0.8, 0.2, 0],
        metadata: { type: 'recipe', language: 'python' },
      },
    ]);

    const results = await store.searchVector([1, 0, 0], { topK: 10, filter: { type: 'recipe' } });
    expect(results.every((r) => r.item.metadata.type === 'recipe')).toBe(true);
    expect(results).toHaveLength(2);
  });
});

describe('HnswVectorAdapter JSON migration recovery', () => {
  let root: string;
  let stores: HnswVectorAdapter[];

  const makeStore = () => {
    const store = new HnswVectorAdapter(root, {
      M: 4,
      walEnabled: false,
      flushIntervalMs: 60_000,
      flushBatchSize: 10_000,
    });
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-migration-recovery-'));
    stores = [];
  });

  afterEach(() => {
    for (const store of stores) {
      store.destroy();
    }
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['init', 'array'],
    ['init', 'object'],
    ['initSync', 'array'],
    ['initSync', 'object'],
  ] as const)('keeps legacy JSON until %s publishes its snapshot (%s)', async (method, shape) => {
    const indexDir = path.join(root, '.asd/context/index');
    const snapshotPath = path.join(indexDir, 'vector_index.asvec');
    const jsonPath = path.join(indexDir, 'vector_index.json');
    const entry = {
      content: 'recoverable legacy content',
      vector: [1, 0],
      metadata: { type: 'recipe' },
    };
    const json = JSON.stringify(
      shape === 'array' ? [{ id: 'legacy', ...entry }] : { legacy: entry }
    );
    // 真实目标目录阻止 snapshot 发布，不 mock BinaryPersistence 或文件写入边界。
    fs.mkdirSync(snapshotPath, { recursive: true });
    fs.writeFileSync(jsonPath, json);
    const failed = makeStore();
    await expect(Promise.resolve().then(() => failed[method]())).rejects.toMatchObject({
      code: 'EISDIR',
    });
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.readFileSync(jsonPath, 'utf8')).toBe(json);
    expect(fs.existsSync(`${jsonPath}.bak`)).toBe(false);
    failed.destroy();
    stores = stores.filter((store) => store !== failed);

    fs.rmSync(snapshotPath, { recursive: true });
    const retried = makeStore();
    const publish = vi.spyOn(BinaryPersistence, method === 'init' ? 'saveAsync' : 'save');
    await retried[method]();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await retried.getById('legacy')).toMatchObject(entry);
    expect((await retried.searchVector([1, 0], { topK: 1 }))[0]?.item.id).toBe('legacy');
    expect(BinaryPersistence.isValid(snapshotPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.readFileSync(`${jsonPath}.bak`, 'utf8')).toBe(json);
  });

  it.each(['[]', '{}', '{invalid'])('retains legacy %s on the new-index fallback', async (json) => {
    const indexDir = path.join(root, '.asd/context/index');
    const jsonPath = path.join(indexDir, 'vector_index.json');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(jsonPath, json);
    await expect(VectorMigration.migrate(indexDir, makeStore())).resolves.toBe('new');
    expect(fs.readFileSync(jsonPath, 'utf8')).toBe(json);
    expect(fs.existsSync(`${jsonPath}.bak`)).toBe(false);
  });

  it.each([
    'init',
    'initSync',
  ] as const)('keeps the published snapshot when %s cannot archive JSON', async (method) => {
    const indexDir = path.join(root, '.asd/context/index');
    const jsonPath = path.join(indexDir, 'vector_index.json');
    const entry = { id: 'legacy', content: 'retained snapshot', vector: [1, 0], metadata: {} };
    const json = JSON.stringify([entry]);
    fs.mkdirSync(`${jsonPath}.bak`, { recursive: true });
    fs.writeFileSync(jsonPath, json);
    const store = makeStore();
    await store[method]();
    expect(BinaryPersistence.isValid(path.join(indexDir, 'vector_index.asvec'))).toBe(true);
    expect(await store.getById('legacy')).toMatchObject(entry);
    expect(fs.readFileSync(jsonPath, 'utf8')).toBe(json);
  });
});

describe('HNSW Recall Quality', () => {
  it('Recall@10 should be > 0.9 for 200 vectors 32d', () => {
    const dim = 32;
    const n = 200;
    const k = 10;

    const vectors = Array.from({ length: n }, () => randomVector(dim));

    // Build HNSW index
    const index = new HnswIndex({ M: 16, efConstruct: 100, efSearch: 50 });
    for (let i = 0; i < n; i++) {
      index.addPoint(`v${i}`, vectors[i]);
    }

    // 测试 10 个随机 query 的平均 recall
    let totalRecall = 0;
    const numQueries = 10;

    for (let q = 0; q < numQueries; q++) {
      const query = randomVector(dim);

      // 暴力搜索: 真实 top-k
      const bruteForce = vectors
        .map((v, i) => ({ id: `v${i}`, dist: cosineDistance(query, v) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, k);
      const trueTopK = new Set(bruteForce.map((r) => r.id));

      // HNSW 搜索
      const hnswResults = index.searchKnn(query, k);
      const hnswTopK = new Set(hnswResults.map((r) => r.id));

      // 计算 recall
      let hits = 0;
      for (const id of trueTopK) {
        if (hnswTopK.has(id)) {
          hits++;
        }
      }
      totalRecall += hits / k;
    }

    const avgRecall = totalRecall / numQueries;
    expect(avgRecall).toBeGreaterThan(0.9);
  });
});

describe('HnswIndex randomLevel safety', () => {
  it('should not produce Infinity level after many insertions', () => {
    // This is a probabilistic test: inserting many points should not cause OOM/hang
    const index = new HnswIndex({ M: 8, efConstruct: 32 });
    // 100 insertions - if randomLevel can return Infinity, this would hang
    for (let i = 0; i < 100; i++) {
      index.addPoint(`p${i}`, randomVector(8));
    }
    expect(index.size).toBe(100);
    // Verify search still works
    const results = index.searchKnn(randomVector(8), 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('SQ8 2-pass search', () => {
  const DIM = 32;

  describe('adapter quantization restore', () => {
    let root: string;
    let items: Array<{
      id: string;
      content: string;
      vector: Float32Array;
      metadata: Record<string, unknown>;
    }>;
    let stores: HnswVectorAdapter[];
    let source: HnswVectorAdapter;
    let quantizedIndexes: HnswIndex[];

    const openStore = async (method: 'init' | 'initSync', quantize = 'sq8') => {
      const store = new HnswVectorAdapter(root, {
        M: 8,
        efConstruct: 40,
        efSearch: 16,
        quantize,
        quantizeThreshold: 64,
        walEnabled: false,
        flushIntervalMs: 60_000,
        flushBatchSize: 10_000,
      });
      stores.push(store);
      await store[method]();
      return store;
    };

    beforeEach(async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-quantization-'));
      stores = [];
      quantizedIndexes = [];
      const setQuantizedVectors = HnswIndex.prototype.setQuantizedVectors;
      // 观察真实训练/恢复后的节点，不替换量化编码或文件读取边界。
      vi.spyOn(HnswIndex.prototype, 'setQuantizedVectors').mockImplementation(function (
        this: HnswIndex,
        quantizer
      ) {
        setQuantizedVectors.call(this, quantizer);
        quantizedIndexes.push(this);
      });
      let seed = 12345;
      // 同一训练数据和图层种子，避免把 ANN 的随机差异当作恢复缺陷。
      vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      });
      items = Array.from({ length: 128 }, (_, index) => {
        const values = [
          Math.cos(index * 0.31),
          Math.sin(index * 0.31),
          Math.sin(index * 0.73),
          0.4 + Math.cos(index * 0.17),
        ];
        const norm = Math.hypot(...values);
        return {
          id: `v${index}`,
          content: `point ${index}`,
          vector: new Float32Array(values.map((value) => value / norm)),
          metadata: {},
        };
      });
      source = await openStore('initSync');
      await source.batchUpsert(items);
      await source.flush();
    });

    afterEach(() => {
      for (const store of stores) {
        store.destroy();
      }
      vi.restoreAllMocks();
      syncBuiltinESMExports();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
      'init',
      'initSync',
    ] as const)('respects quantize:none when %s reopens a trained snapshot', async (method) => {
      expect(await source.getStats()).toMatchObject({ quantized: true, dimension: 4 });
      source.destroy();
      const distance = vi.spyOn(ScalarQuantizer.prototype, 'distance');
      const reopened = await openStore(method, 'none');
      const results = await reopened.searchVector(items[31].vector, { topK: 1 });
      expect(results[0]?.item.id).toBe('v31');
      expect(distance).not.toHaveBeenCalled();
      expect(await reopened.getStats()).toMatchObject({ quantized: false, dimension: 4 });
    });

    it.each([
      'init',
      'initSync',
    ] as const)('reads a snapshot once through %s before restoring it', async (method) => {
      source.destroy();
      const read = vi.spyOn(fs, 'readFileSync');
      syncBuiltinESMExports();
      const reopened = await openStore(method);
      const snapshotPath = path.join(root, '.asd/context/index/vector_index.asvec');
      expect(read.mock.calls.filter(([file]) => file === snapshotPath)).toHaveLength(1);
      expect(await reopened.getById('v31')).toMatchObject({ content: 'point 31' });
    });

    it.each([
      'init',
      'initSync',
    ] as const)('restores actual SQ8 codes and search ordering after %s', async (method) => {
      const quantizedNodes = (index: HnswIndex) =>
        index.nodes
          .filter((node) => node !== null)
          .map((node) => ({
            id: node.id,
            codes: Array.from(node.qvector!),
          }));
      const beforeCodes = quantizedNodes(quantizedIndexes[0]);
      expect(beforeCodes).toHaveLength(128);
      expect(beforeCodes.every((node) => node.codes.length === 4)).toBe(true);
      const beforeHits = await source.searchVector(items[31].vector, { topK: 5 });
      source.destroy();

      const distance = vi.spyOn(ScalarQuantizer.prototype, 'distance');
      const reopened = await openStore(method);
      const afterHits = await reopened.searchVector(items[31].vector, { topK: 5 });
      expect(quantizedIndexes).toHaveLength(2);
      expect(quantizedNodes(quantizedIndexes[1])).toEqual(beforeCodes);
      expect(distance).toHaveBeenCalled();
      expect(afterHits.map((hit) => ({ id: hit.item.id, score: hit.score }))).toEqual(
        beforeHits.map((hit) => ({ id: hit.item.id, score: hit.score }))
      );
      expect(afterHits[0]?.item.id).toBe('v31');
    });

    it.each([
      ['init', false],
      ['initSync', false],
      ['init', true],
      ['initSync', true],
    ] as const)('rebuilds usable SQ8 after %s reopens an emptied snapshot (legacy=%s)', async (method, legacy) => {
      for (const item of items) {
        await source.remove(item.id);
      }
      await source.flush();
      source.destroy();
      if (legacy) {
        // 9e8d033 实际删除至空后生成的 ASVEC：HAS_QUANTIZER + dimension=0。
        // 固定旧字节，避免新 encoder 不再写该模型后掩盖恢复兼容性。
        fs.writeFileSync(
          path.join(root, '.asd/context/index/vector_index.asvec'),
          Buffer.from(
            'QVNWRUMBAwAAAAAAAAAIAAAA/////wAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAB0AAAB7Im1ldGFkYXRhIjp7fSwiY29udGVudHMiOnt9fQ==',
            'base64'
          )
        );
      }
      const reopened = await openStore(method);
      const restoredStats = await reopened.getStats();
      const distance = vi.spyOn(ScalarQuantizer.prototype, 'distance');
      await reopened.batchUpsert(items);
      const results = await reopened.searchVector(items[31].vector, { topK: 5 });
      expect(distance).toHaveBeenCalled();
      expect(
        distance.mock.results.every(
          (result) => result.type === 'return' && Number.isFinite(result.value)
        )
      ).toBe(true);
      expect(restoredStats).toMatchObject({ quantized: false, dimension: 0 });
      expect(await reopened.getStats()).toMatchObject({ quantized: true, dimension: 4 });
      expect(results[0]?.item.id).toBe('v31');
      expect(await reopened.getById('v31')).toMatchObject({ vector: Array.from(items[31].vector) });
    });
  });

  it('searchKnn should accept quantizedQuery + quantizer options', () => {
    const index = new HnswIndex({ M: 8, efConstruct: 64, efSearch: 64 });
    const vectors = [];
    for (let i = 0; i < 50; i++) {
      const v = randomVector(DIM);
      vectors.push(v);
      index.addPoint(`d${i}`, v);
    }

    // Train quantizer
    const q = new ScalarQuantizer(DIM);
    q.train(vectors);

    // Set quantized vectors on nodes
    index.setQuantizedVectors(q);

    // 2-pass search
    const query = randomVector(DIM);
    const quantizedQuery = q.encode(query);
    const results = index.searchKnn(query, 5, { quantizedQuery, quantizer: q });

    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
    // All results should have valid ids and distances
    for (const r of results) {
      expect(r.id).toBeDefined();
      expect(typeof r.dist).toBe('number');
      // Phase 3 re-ranking uses exact cosineDistance, distance should be in [0, 2]
      expect(r.dist).toBeGreaterThanOrEqual(0);
      expect(r.dist).toBeLessThanOrEqual(2);
    }
  });

  it('2-pass should produce same top-1 as exact search for similar vectors', () => {
    const index = new HnswIndex({ M: 8, efConstruct: 64, efSearch: 64 });
    const target = randomVector(DIM);
    const vectors = [];

    // Insert target + noise
    index.addPoint('target', target);
    vectors.push(target);
    for (let i = 0; i < 30; i++) {
      const v = randomVector(DIM);
      vectors.push(v);
      index.addPoint(`noise_${i}`, v);
    }

    const q = new ScalarQuantizer(DIM);
    q.train(vectors);
    index.setQuantizedVectors(q);

    // Search for the target itself
    const quantizedQuery = q.encode(target);
    const results2Pass = index.searchKnn(target, 1, { quantizedQuery, quantizer: q });
    const resultsExact = index.searchKnn(target, 1);

    // Both should find 'target' as closest
    expect(results2Pass[0].id).toBe('target');
    expect(resultsExact[0].id).toBe('target');
    // 2-pass result's dist should be re-ranked with exact cosineDistance
    expect(results2Pass[0].dist).toBeCloseTo(0, 5);
  });

  it('setQuantizedVectors should populate qvector on all nodes', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32 });
    for (let i = 0; i < 10; i++) {
      index.addPoint(`p${i}`, randomVector(DIM));
    }

    // Before: no qvectors
    for (const node of index.nodes) {
      if (node) {
        expect(node.qvector).toBeNull();
      }
    }

    const q = new ScalarQuantizer(DIM);
    q.train(index.nodes.filter((n) => n).map((n) => n.vector));
    index.setQuantizedVectors(q);

    // After: all active nodes should have qvectors
    for (const node of index.nodes) {
      if (node) {
        expect(node.qvector).toBeInstanceOf(Uint8Array);
        expect(node.qvector.length).toBe(DIM);
      }
    }
  });

  it('addPoint with qvector option should store it on the node', () => {
    const index = new HnswIndex({ M: 4 });
    const v = randomVector(DIM);
    const fakeQvec = new Uint8Array(DIM).fill(128);
    index.addPoint('test', v, { qvector: fakeQvec });

    const node = index.nodes[0];
    expect(node.qvector).toBe(fakeQvec);
  });

  it('serialize should NOT include qvector (reconstructed from quantizer)', () => {
    const index = new HnswIndex({ M: 4 });
    const v = randomVector(DIM);
    const q = new ScalarQuantizer(DIM);
    q.train([v]);
    index.addPoint('test', v, { qvector: q.encode(v) });

    const serialized = index.serialize();
    // Serialized nodes should not have qvector
    for (const node of serialized.nodes) {
      if (node) {
        expect(node.qvector).toBeUndefined();
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('vector');
        expect(node).toHaveProperty('level');
      }
    }
  });
});

describe('RRF hybridSearch', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-rrf-'));
    store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: false,
    });
    store.initSync();
  });

  afterEach(() => {
    store.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return results with RRF fusion scores', async () => {
    await store.batchUpsert([
      { id: 'a', content: 'machine learning deep neural network', vector: [1, 0, 0], metadata: {} },
      { id: 'b', content: 'web development frontend javascript', vector: [0, 1, 0], metadata: {} },
      {
        id: 'c',
        content: 'machine learning regression model',
        vector: [0.9, 0.1, 0],
        metadata: {},
      },
    ]);

    const results = await store.hybridSearch([1, 0, 0], 'machine learning', { topK: 3 });

    expect(results.length).toBeGreaterThan(0);
    // 'a' should rank highest: best vector match + best keyword match
    expect(results[0].item.id).toBe('a');
    // 保留默认 k=60 的原始 RRF 分数，不做页内最大值归一化。
    expect(results[0].score).toBeLessThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should work with only vector results (no keyword match)', async () => {
    await store.batchUpsert([
      { id: 'a', content: 'alpha', vector: [1, 0, 0], metadata: {} },
      { id: 'b', content: 'beta', vector: [0, 1, 0], metadata: {} },
    ]);

    const results = await store.hybridSearch([1, 0, 0], 'zzzzz_no_match', { topK: 2 });
    // Should still return vector results even if no keyword match
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.id).toBe('a');
  });

  it('should work with only keyword results (no vector)', async () => {
    await store.batchUpsert([
      { id: 'a', content: 'hello world', vector: [1, 0, 0], metadata: {} },
      { id: 'b', content: 'foo bar', vector: [0, 1, 0], metadata: {} },
    ]);

    const results = await store.hybridSearch(null, 'hello world', { topK: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.id).toBe('a');
  });

  it('should accept custom rrfK and alpha options', async () => {
    await store.batchUpsert([
      { id: 'a', content: 'test data', vector: [1, 0, 0], metadata: {} },
      { id: 'b', content: 'test data', vector: [0, 1, 0], metadata: {} },
    ]);

    // alpha=1 → only vector matters
    const resultsVectorOnly = await store.hybridSearch([0, 1, 0], 'test', { topK: 2, alpha: 1.0 });
    expect(resultsVectorOnly[0].item.id).toBe('b');

    // alpha=0 → only keyword matters (both match "test", order depends on keyword score)
    const resultsKeywordOnly = await store.hybridSearch([0, 1, 0], 'test', { topK: 2, alpha: 0.0 });
    expect(resultsKeywordOnly.length).toBeGreaterThan(0);
  });

  it('RRF score has vectorScore and keywordScore fields for compat', async () => {
    await store.batchUpsert([{ id: 'a', content: 'singleton', vector: [1, 0, 0], metadata: {} }]);

    const results = await store.hybridSearch([1, 0, 0], 'singleton', { topK: 1 });
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('vectorScore');
    expect(results[0]).toHaveProperty('keywordScore');
    expect(results[0]).toHaveProperty('item');
    const stored = await store.getById('a');
    const sparseOnly = await store.hybridSearch(null, 'singleton', { topK: 1, rrfK: 0 });
    expect(sparseOnly[0]).toStrictEqual({
      item: { id: 'a', content: 'singleton', vector: [], metadata: stored.metadata },
      score: 0.5,
      rrfContribution: { dense: 0, sparse: 0.5, total: 0.5 },
      denseRank: undefined,
      denseSimilarity: undefined,
      sparseRank: 1,
      sparseScore: 1,
      vectorScore: undefined,
      keywordScore: 1,
    });
  });
});

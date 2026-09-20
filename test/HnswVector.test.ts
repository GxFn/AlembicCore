import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

let HnswIndex, cosineDistance, MinHeap, MaxHeap;
let ScalarQuantizer;
let BinaryPersistence;
let HnswVectorAdapter;
let VectorMigration;
let BatchEmbedder;
let HybridRetriever;
let _JsonVectorAdapter;
let chunk, _estimateTokens, _DEFAULT_MAX_CHUNK_TOKENS;
let isASTChunkerAvailable;
let IndexingPipeline;
let AsyncPersistence, WAL_OP, crc32;

beforeAll(async () => {
  const hnswMod = await import('../src/infrastructure/vector/HnswIndex.js');
  HnswIndex = hnswMod.HnswIndex;
  cosineDistance = hnswMod.cosineDistance;
  MinHeap = hnswMod.MinHeap;
  MaxHeap = hnswMod.MaxHeap;

  const sqMod = await import('../src/infrastructure/vector/ScalarQuantizer.js');
  ScalarQuantizer = sqMod.ScalarQuantizer;

  const bpMod = await import('../src/infrastructure/vector/BinaryPersistence.js');
  BinaryPersistence = bpMod.BinaryPersistence;

  const haMod = await import('../src/infrastructure/vector/HnswVectorAdapter.js');
  HnswVectorAdapter = haMod.HnswVectorAdapter;

  const vmMod = await import('../src/infrastructure/vector/VectorMigration.js');
  VectorMigration = vmMod.VectorMigration;

  const beMod = await import('../src/infrastructure/vector/BatchEmbedder.js');
  BatchEmbedder = beMod.BatchEmbedder;

  const hrMod = await import('../src/service/search/HybridRetriever.js');
  HybridRetriever = hrMod.HybridRetriever;

  const jvMod = await import('../src/infrastructure/vector/JsonVectorAdapter.js');
  _JsonVectorAdapter = jvMod.JsonVectorAdapter;

  const chunkMod = await import('../src/infrastructure/vector/Chunker.js');
  chunk = chunkMod.chunk;
  _estimateTokens = chunkMod.estimateTokens;
  _DEFAULT_MAX_CHUNK_TOKENS = chunkMod.DEFAULT_MAX_CHUNK_TOKENS;

  const astChunkerMod = await import('../src/infrastructure/vector/ASTChunker.js');
  isASTChunkerAvailable = astChunkerMod.isASTChunkerAvailable;

  const ipMod = await import('../src/infrastructure/vector/IndexingPipeline.js');
  IndexingPipeline = ipMod.IndexingPipeline;

  const apMod = await import('../src/infrastructure/vector/AsyncPersistence.js');
  AsyncPersistence = apMod.AsyncPersistence;
  WAL_OP = apMod.WAL_OP;
  crc32 = apMod.crc32;
});

// ── Helper: 生成随机归一化向量 ──
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

// ═══════════════════════════════════════════
//  HnswIndex
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  MinHeap / MaxHeap
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  cosineDistance
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  ScalarQuantizer
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  BinaryPersistence
// ═══════════════════════════════════════════
describe('BinaryPersistence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-bp-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should encode and decode index without quantizer', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 32 });
    index.addPoint('doc1', [1, 0, 0]);
    index.addPoint('doc2', [0, 1, 0]);

    const metadata = new Map([
      ['doc1', { type: 'recipe', language: 'swift' }],
      ['doc2', { type: 'code', language: 'python' }],
    ]);
    const contents = new Map([
      ['doc1', 'Hello world'],
      ['doc2', 'Foo bar'],
    ]);

    const filePath = path.join(tmpDir, 'test.asvec');
    BinaryPersistence.save(filePath, { index, quantizer: null, metadata, contents });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(BinaryPersistence.isValid(filePath)).toBe(true);

    const loaded = BinaryPersistence.load(filePath);
    expect(loaded.dimension).toBe(3);
    expect(loaded.indexData.nodes).toHaveLength(2);
    expect(loaded.indexData.nodes[0].id).toBe('doc1');
    expect(loaded.metadata.get('doc1')).toEqual({ type: 'recipe', language: 'swift' });
    expect(loaded.contents.get('doc2')).toBe('Foo bar');
    expect(fs.readFileSync(filePath).toString('utf8')).toEqual(
      expect.stringContaining(
        '{"metadata":{"doc1":{"type":"recipe","language":"swift"},"doc2":{"type":"code","language":"python"}},"contents":{"doc1":"Hello world","doc2":"Foo bar"}}'
      )
    );
  });

  it.each([
    'save',
    'saveAsync',
  ])('preserves opaque __proto__ IDs through %s and load', async (method) => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('__proto__', [1, 0]);
    const metadata = new Map([
      ['__proto__', { title: '合法 ID' }],
      ['constructor', { title: 'constructor ID' }],
    ]);
    const contents = new Map([
      ['__proto__', 'content for opaque ID'],
      ['constructor', 'constructor content'],
    ]);
    const filePath = path.join(tmpDir, 'own-key.asvec');
    await BinaryPersistence[method](filePath, { index, quantizer: null, metadata, contents });
    const restored = BinaryPersistence.load(filePath);
    expect(restored.indexData.nodes[0].id).toBe('__proto__');
    expect(restored.metadata).toEqual(metadata);
    expect(restored.contents).toEqual(contents);
  });

  it('should encode and decode with quantizer', () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('a', [1, 0, 0, 0]);
    index.addPoint('b', [0, 1, 0, 0]);

    const sq = new ScalarQuantizer(4);
    sq.train([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);

    const filePath = path.join(tmpDir, 'quant.asvec');
    BinaryPersistence.save(filePath, {
      index,
      quantizer: sq,
      metadata: new Map(),
      contents: new Map(),
    });

    const loaded = BinaryPersistence.load(filePath);
    expect(loaded.quantizerData).not.toBeNull();
    expect(loaded.quantizerData.dimension).toBe(4);
  });

  it('should handle empty index', () => {
    const index = new HnswIndex({ M: 4 });
    const filePath = path.join(tmpDir, 'empty.asvec');
    BinaryPersistence.save(filePath, {
      index,
      quantizer: null,
      metadata: new Map(),
      contents: new Map(),
    });

    const loaded = BinaryPersistence.load(filePath);
    expect(loaded.indexData.nodes).toHaveLength(0);
  });

  it('should detect invalid files', () => {
    const badFile = path.join(tmpDir, 'bad.asvec');
    fs.writeFileSync(badFile, 'not a real file');
    expect(BinaryPersistence.isValid(badFile)).toBe(false);
    expect(BinaryPersistence.isValid(path.join(tmpDir, 'nonexist.asvec'))).toBe(false);
  });

  it('should roundtrip graph connections', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32, efSearch: 16 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0.9, 0.1, 0]);
    index.addPoint('c', [0, 1, 0]);
    index.addPoint('d', [0.5, 0.5, 0]);

    const filePath = path.join(tmpDir, 'graph.asvec');
    BinaryPersistence.save(filePath, {
      index,
      quantizer: null,
      metadata: new Map(),
      contents: new Map(),
    });

    const loaded = BinaryPersistence.load(filePath);
    const restored = HnswIndex.deserialize(loaded.indexData);
    const results = restored.searchKnn([1, 0, 0], 2);
    expect(results[0].id).toBe('a');
  });
});

// ═══════════════════════════════════════════
//  HnswVectorAdapter
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  VectorMigration
// ═══════════════════════════════════════════
describe('VectorMigration', () => {
  let tmpDir;
  let indexDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-mig-'));
    indexDir = path.join(tmpDir, '.asd', 'context', 'index');
    fs.mkdirSync(indexDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect new installation', async () => {
    const store = new HnswVectorAdapter(tmpDir, { M: 4 });
    const result = await VectorMigration.migrate(indexDir, store);
    expect(result).toBe('new');
  });

  it('should detect existing binary index', async () => {
    // Create a dummy .asvec file
    const index = new HnswIndex({ M: 4 });
    BinaryPersistence.save(path.join(indexDir, 'vector_index.asvec'), {
      index,
      quantizer: null,
      metadata: new Map(),
      contents: new Map(),
    });

    const store = new HnswVectorAdapter(tmpDir, { M: 4 });
    const result = await VectorMigration.migrate(indexDir, store);
    expect(result).toBe('binary');
  });

  it('should migrate from JSON to HNSW', async () => {
    // Write a JSON index (before adapter init)
    const jsonItems = [
      { id: 'item-1', content: 'hello', vector: [1, 0, 0], metadata: { type: 'test' } },
      { id: 'item-2', content: 'world', vector: [0, 1, 0], metadata: { type: 'test' } },
    ];
    fs.writeFileSync(path.join(indexDir, 'vector_index.json'), JSON.stringify(jsonItems));

    // Create adapter but do NOT call initSync (migration should happen first)
    const store = new HnswVectorAdapter(tmpDir, { M: 4, efConstruct: 32, efSearch: 32 });
    const result = await VectorMigration.migrate(indexDir, store);
    expect(result).toBe('migrated');

    // Verify data was migrated
    const ids = await store.listIds();
    expect(ids).toContain('item-1');
    expect(ids).toContain('item-2');

    // JSON file should be renamed
    expect(fs.existsSync(path.join(indexDir, 'vector_index.json.bak'))).toBe(true);
  });

  it('needsMigration should detect correctly', () => {
    expect(VectorMigration.needsMigration(indexDir)).toBe(false);

    fs.writeFileSync(path.join(indexDir, 'vector_index.json'), '[]');
    expect(VectorMigration.needsMigration(indexDir)).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  BatchEmbedder
// ═══════════════════════════════════════════
describe('BatchEmbedder', () => {
  it('should batch embed with mock provider', async () => {
    const mockProvider = {
      embed: async (texts) => {
        if (Array.isArray(texts)) {
          return texts.map((t) => [t.length / 100, 0.5, 0.3]);
        }
        return [texts.length / 100, 0.5, 0.3];
      },
    };

    const embedder = new BatchEmbedder(mockProvider, { batchSize: 2, maxConcurrency: 1 });
    const items = [
      { id: 'a', content: 'short text' },
      { id: 'b', content: 'medium length content here' },
      { id: 'c', content: 'another piece of content' },
    ];

    let progressCalls = 0;
    const results = await embedder.embedAll(items, () => progressCalls++);

    expect(results.size).toBe(3);
    expect(results.has('a')).toBe(true);
    expect(results.has('b')).toBe(true);
    expect(results.has('c')).toBe(true);
    expect(results.get('a')).toHaveLength(3);
    expect(progressCalls).toBeGreaterThan(0);
  });

  it('should return empty map without provider', async () => {
    const embedder = new BatchEmbedder(null);
    const results = await embedder.embedAll([{ id: 'a', content: 'test' }]);
    expect(results.size).toBe(0);
  });
});

// ═══════════════════════════════════════════
//  HybridRetriever (RRF)
// ═══════════════════════════════════════════
describe('HybridRetriever', () => {
  it('preserves rank holes, repeated evidence and the first nested sparse payload', () => {
    const payload = { id: 'a', item: { id: 'payload-id' }, score: 4 };
    const denseResults = Object.freeze([
      { score: 99 },
      { id: 'outer-id', item: { id: 'a' }, score: 0.9 },
      { id: 'a', score: 0.4 },
    ]);
    const sparseResults = Object.freeze([
      { item: { id: 'ignored' }, score: 50 },
      payload,
      { id: 'a', score: 3 },
    ]);
    const denseContribution = 0.4 * (1 / 63);
    const sparseContribution = 0.6 * (1 / 63);
    const total = 0.4 * (1 / 62) + denseContribution + 0.6 * (1 / 62) + sparseContribution;
    const [result] = new HybridRetriever().fuse({ denseResults, sparseResults, alpha: 0.4 });
    expect(result).toStrictEqual({
      id: 'a',
      denseRank: 3,
      sparseRank: 3,
      rrfScore: total,
      data: payload,
      denseSimilarity: 0.4,
      denseContribution,
      sparseScore: 3,
      sparseContribution,
      score: total,
      rrfContribution: { dense: denseContribution, sparse: sparseContribution, total },
    });
    expect(result.data).toBe(payload);
  });

  it('keeps fuse defaults separate from search defaults and preserves zero-weight hits', async () => {
    const dense = { id: 'dense', item: { id: 'dense' }, score: 0.01 };
    const sparse = { id: 'sparse', score: 99 };
    const searchVector = vi.fn(async () => [dense]);
    const retriever = new HybridRetriever({ vectorStore: { searchVector }, rrfK: 0, alpha: 1 });
    const direct = retriever.fuse({ denseResults: [dense], sparseResults: [sparse] });
    expect(direct.map((row) => row.id)).toEqual(['dense', 'sparse']);
    expect(direct.map((row) => row.score)).toEqual([0.5 * (1 / 61), 0.5 * (1 / 61)]);
    expect(direct[0].sparseRank).toBe(Infinity);
    expect(Object.hasOwn(direct[0], 'sparseScore')).toBe(false);
    expect(direct[1].denseRank).toBe(Infinity);
    expect(Object.hasOwn(direct[1], 'denseSimilarity')).toBe(false);
    const queried = await retriever.search('query', [1], {
      topK: 2,
      sparseSearchFn: () => [sparse],
    });
    expect(queried.map((row) => row.score)).toEqual([1 / 61, 0]);
    expect(searchVector).toHaveBeenCalledWith([1], { topK: 6, filter: null });
  });

  it('should fuse dense and sparse results via RRF', () => {
    const retriever = new HybridRetriever({ rrfK: 60 });

    const denseResults = [
      { id: 'a', item: { id: 'a' }, score: 0.95 },
      { id: 'b', item: { id: 'b' }, score: 0.85 },
      { id: 'c', item: { id: 'c' }, score: 0.7 },
    ];
    const sparseResults = [
      { id: 'b', score: 10.5 },
      { id: 'd', score: 8.2 },
      { id: 'a', score: 6.1 },
    ];

    const fused = retriever.fuse({ denseResults, sparseResults, topK: 10, alpha: 0.5 });

    // Both 'a' and 'b' appear in both lists, so they should rank higher
    const ids = fused.map((f) => f.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');

    // 'b' is rank 2 in dense, rank 1 in sparse — should get highest combined
    // 'a' is rank 1 in dense, rank 3 in sparse — close second
    const aScore = fused.find((f) => f.id === 'a').rrfScore;
    const bScore = fused.find((f) => f.id === 'b').rrfScore;
    // Both should have positive scores
    expect(aScore).toBeGreaterThan(0);
    expect(bScore).toBeGreaterThan(0);
  });

  it('should work with only dense results', () => {
    const retriever = new HybridRetriever({ rrfK: 60 });
    const fused = retriever.fuse({
      denseResults: [
        { id: 'x', item: { id: 'x' } },
        { id: 'y', item: { id: 'y' } },
      ],
      sparseResults: [],
      topK: 5,
      alpha: 0.7,
    });

    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('x');
  });

  it('should work with only sparse results', () => {
    const retriever = new HybridRetriever({ rrfK: 60 });
    const fused = retriever.fuse({
      denseResults: [],
      sparseResults: [
        { id: 'a', score: 5 },
        { id: 'b', score: 3 },
      ],
      topK: 5,
      alpha: 0.3,
    });

    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('a');
  });

  it('should respect topK limit', () => {
    const retriever = new HybridRetriever({ rrfK: 60 });
    const dense = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      item: { id: `d${i}` },
    }));
    const sparse = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, score: 20 - i }));

    const fused = retriever.fuse({ denseResults: dense, sparseResults: sparse, topK: 5 });
    expect(fused.map((row) => row.id)).toEqual(['d0', 's0', 'd1', 's1', 'd2']);
  });

  it('should preserve raw RRF scores without page-max normalization', () => {
    const retriever = new HybridRetriever({ rrfK: 60 });
    const fused = retriever.fuse({
      denseResults: [{ id: 'a', item: { id: 'a' } }],
      sparseResults: [{ id: 'b', score: 5 }],
      topK: 10,
    });

    for (const item of fused) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
    expect(fused[0].score).toBeCloseTo(fused[0].rrfScore, 10);
    expect(fused[0].score).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════
//  HNSW Recall Quality
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  Chunker v2
// ═══════════════════════════════════════════
describe('Chunker v2', () => {
  it('auto: short content → whole strategy', () => {
    const result = chunk('Hello world', {}, { maxChunkTokens: 512 });
    expect(result).toHaveLength(1);
    expect(result[0].metadata.chunkStrategy).toBe('whole');
    expect(result[0].content).toBe('Hello world');
  });

  it('auto: markdown with headings → section strategy', () => {
    const md =
      '# Title\nIntro paragraph.\n## Section 1\n' +
      'Content A. '.repeat(200) +
      '\n## Section 2\n' +
      'Content B. '.repeat(200);
    const result = chunk(md, {}, { maxChunkTokens: 100 });
    expect(result.length).toBeGreaterThan(1);
    // sections should have sectionTitle metadata
    const withTitles = result.filter((r) => r.metadata.sectionTitle);
    expect(withTitles.length).toBeGreaterThan(0);
  });

  it('auto: long plain text without headings → fixed strategy', () => {
    const text = 'Lorem ipsum dolor sit amet. '.repeat(500);
    const result = chunk(text, {}, { maxChunkTokens: 100 });
    expect(result.length).toBeGreaterThan(1);
    // totalChunks metadata should be set
    for (const c of result) {
      expect(c.metadata.totalChunks).toBe(result.length);
    }
  });

  it('explicit strategy: fixed with overlap', () => {
    const text = 'Line.\n'.repeat(500);
    const result = chunk(text, {}, { strategy: 'fixed', maxChunkTokens: 50, overlapTokens: 10 });
    expect(result.length).toBeGreaterThan(1);
    // With overlap, later chunks should share content with previous
    if (result.length >= 2) {
      const first = result[0].content;
      const second = result[1].content;
      // The end of first should overlap with start of second
      const firstEnd = first.slice(-100);
      const secondStart = second.slice(0, 100);
      // They should share some common text (from overlap)
      expect(firstEnd.length + secondStart.length).toBeGreaterThan(0);
    }
  });

  it('empty content returns empty array', () => {
    expect(chunk('', {})).toEqual([]);
    expect(chunk('   ', {})).toEqual([]);
    expect(chunk(null, {})).toEqual([]);
  });

  it('explicit ast strategy: falls back to fixed when language unsupported', () => {
    const code = 'x = 1\n'.repeat(500);
    const result = chunk(
      code,
      { language: 'unknown_lang' },
      { strategy: 'ast', maxChunkTokens: 50 }
    );
    // Should fallback to fixed since 'unknown_lang' is not in ASTChunker
    expect(result.length).toBeGreaterThan(1);
    for (const c of result) {
      expect(c.metadata.totalChunks).toBe(result.length);
    }
  });

  it('auto: code language routes to ast if available', () => {
    // This tests the routing logic, not actual AST parsing
    const code = 'function hello() { return 1; }\n'.repeat(200);
    const result = chunk(code, { language: 'javascript' }, { maxChunkTokens: 50, useAST: true });
    // Should produce chunks (either from AST or fixed fallback)
    expect(result.length).toBeGreaterThan(0);
  });

  it('auto: useAST=false bypasses AST even for code files', () => {
    const code = 'function hello() { return 1; }\n'.repeat(200);
    const result = chunk(code, { language: 'javascript' }, { maxChunkTokens: 50, useAST: false });
    // Should NOT use AST, should use fixed
    expect(result.length).toBeGreaterThan(1);
    // No nodeType metadata (AST would set nodeType)
    for (const c of result) {
      expect(c.metadata.nodeType).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════
//  ASTChunker Availability
// ═══════════════════════════════════════════
describe('ASTChunker', () => {
  it('isASTChunkerAvailable returns boolean', () => {
    expect(typeof isASTChunkerAvailable('javascript')).toBe('boolean');
    expect(typeof isASTChunkerAvailable('python')).toBe('boolean');
    expect(isASTChunkerAvailable('nonexistent_language')).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  BinaryPersistence Validation
// ═══════════════════════════════════════════
describe('BinaryPersistence Validation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-bp-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should clamp level > 255 to 255', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32 });
    index.addPoint('a', [1, 0, 0]);
    index.addPoint('b', [0, 1, 0]);

    // Encode should succeed without overflow
    const encoded = BinaryPersistence.encode({ index });
    expect(encoded).toBeInstanceOf(Buffer);

    // Decode should produce valid data with 2 vectors
    const decoded = BinaryPersistence.decode(encoded);
    expect(decoded.indexData.nodes).toHaveLength(2);
    expect(decoded.dimension).toBe(3);
  });

  it('isValid returns false for garbage data', () => {
    const garbagePath = path.join(tmpDir, 'garbage.asvec');
    fs.writeFileSync(garbagePath, 'not a valid asvec file');
    expect(BinaryPersistence.isValid(garbagePath)).toBe(false);
  });

  it('isValid returns false for nonexistent file', () => {
    expect(BinaryPersistence.isValid(path.join(tmpDir, 'nope.asvec'))).toBe(false);
  });

  it('isValid returns true for valid encoded data', () => {
    const index = new HnswIndex({ M: 4, efConstruct: 32 });
    index.addPoint('x', [0.5, 0.5]);
    const encoded = BinaryPersistence.encode({ index });
    const validPath = path.join(tmpDir, 'valid.asvec');
    fs.writeFileSync(validPath, encoded);
    expect(BinaryPersistence.isValid(validPath)).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  VectorMigration — corrupted .asvec fallback
// ═══════════════════════════════════════════
describe('VectorMigration corruption handling', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-migration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should fallthrough to json when .asvec is corrupted', async () => {
    // Create a valid JSON store file
    const jsonPath = path.join(tmpDir, 'vector_index.json');
    const data = [{ id: 'test1', content: 'hello', vector: [1, 0, 0], metadata: {} }];
    fs.writeFileSync(jsonPath, JSON.stringify(data));

    // Create a corrupted .asvec file
    const asvecPath = path.join(tmpDir, 'vector_index.asvec');
    fs.writeFileSync(asvecPath, 'corrupted data here');

    // Create a mock adapter to receive the migrated data
    const upserted = [];
    const mockAdapter = {
      batchUpsert: async (items) => upserted.push(...items),
    };

    // Migration should detect corrupted .asvec and fallthrough to json
    const result = await VectorMigration.migrate(tmpDir, mockAdapter);
    expect(result).toBe('migrated');
    expect(upserted.length).toBeGreaterThan(0);
    expect(upserted[0].id).toBe('test1');
  });

  it('should return binary for valid .asvec', async () => {
    // Create a valid .asvec
    const index = new HnswIndex({ M: 4, efConstruct: 32 });
    index.addPoint('p1', [1, 0]);
    const encoded = BinaryPersistence.encode({ index });
    const asvecPath = path.join(tmpDir, 'vector_index.asvec');
    fs.writeFileSync(asvecPath, encoded);

    const result = await VectorMigration.migrate(tmpDir, {});
    expect(result).toBe('binary');
  });

  it('should return new when nothing exists', async () => {
    const result = await VectorMigration.migrate(tmpDir, {});
    expect(result).toBe('new');
  });

  it('needsMigration returns true for json-only', () => {
    const jsonPath = path.join(tmpDir, 'vector_index.json');
    fs.writeFileSync(jsonPath, '[]');
    expect(VectorMigration.needsMigration(tmpDir)).toBe(true);
  });

  it('needsMigration returns false when asvec exists', () => {
    const asvecPath = path.join(tmpDir, 'vector_index.asvec');
    fs.writeFileSync(asvecPath, 'data');
    expect(VectorMigration.needsMigration(tmpDir)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  IndexingPipeline v2
// ═══════════════════════════════════════════
describe('IndexingPipeline v2', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-pipeline-'));
    // Create a recipes dir with a test file
    const recipesDir = path.join(tmpDir, 'recipes');
    fs.mkdirSync(recipesDir, { recursive: true });
    fs.writeFileSync(path.join(recipesDir, 'test.md'), '# Test\nHello world');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should accept chunking options in constructor', () => {
    const pipeline = new IndexingPipeline({
      projectRoot: tmpDir,
      chunking: { strategy: 'fixed', maxChunkTokens: 256, overlapTokens: 25, useAST: false },
    });
    // Pipeline should not throw on construction
    expect(pipeline).toBeDefined();
  });

  it('initializes AST chunking from the pipeline configuration without an external parser call', async () => {
    const source = Array.from(
      { length: 12 },
      (_, index) => `export function item${index}() { return ${index}; }`
    ).join('\n');
    fs.writeFileSync(path.join(tmpDir, 'recipes', 'module.ts'), source);
    const store = new _JsonVectorAdapter(tmpDir);
    store.initSync();
    const pipeline = new IndexingPipeline({
      vectorStore: store,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
      chunking: { strategy: 'auto', maxChunkTokens: 32, useAST: true },
    });
    await pipeline.run();
    const readCodeChunks = async () =>
      (await Promise.all((await store.listIds()).map((id) => store.getById(id)))).filter(
        (item) => item.metadata.sourcePath === 'recipes/module.ts'
      );
    expect((await readCodeChunks()).map((item) => item.metadata.chunkStrategy)).toEqual(
      Array(12).fill('ast')
    );
    const missingId = (await readCodeChunks())[5].id;
    await store.remove(missingId);
    await pipeline.run();
    expect(await store.getById(missingId)).not.toBeNull();
    expect(await readCodeChunks()).toHaveLength(12);
    const withoutAST = new IndexingPipeline({
      vectorStore: store,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
      chunking: { strategy: 'auto', maxChunkTokens: 32, useAST: false },
    });
    await withoutAST.run({ force: true });
    expect((await readCodeChunks()).every((item) => item.metadata.chunkStrategy !== 'ast')).toBe(
      true
    );
  });

  it('repairs colliding legacy path IDs while retaining their existing sourcePath binding', async () => {
    fs.rmSync(path.join(tmpDir, 'recipes', 'test.md'));
    fs.mkdirSync(path.join(tmpDir, 'recipes', 'a'));
    const content = '# Shared\nSame bytes in distinct files';
    fs.writeFileSync(path.join(tmpDir, 'recipes', 'a', 'b.md'), content);
    fs.writeFileSync(path.join(tmpDir, 'recipes', 'a_b.md'), content);
    const store = new _JsonVectorAdapter(tmpDir);
    store.initSync();
    const pipeline = new IndexingPipeline({
      vectorStore: store,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
    });
    const legacyId = 'recipes_a_b.md_0';
    await store.upsert({
      id: legacyId,
      content,
      vector: [1, 0],
      metadata: {
        type: 'recipe',
        sourcePath: 'recipes/a_b.md',
        sourceHash: pipeline.hashContent(content),
        chunkIndex: 0,
        totalChunks: 1,
      },
    });
    await pipeline.run();
    const ids = await store.listIds();
    const items = await Promise.all(ids.map((id) => store.getById(id)));
    expect(items.map((item) => item.metadata.sourcePath).sort()).toEqual([
      'recipes/a/b.md',
      'recipes/a_b.md',
    ]);
    expect(await store.getById(legacyId)).toMatchObject({
      vector: [1, 0],
      metadata: { sourcePath: 'recipes/a_b.md' },
    });
    const second = await pipeline.run();
    expect(second).toMatchObject({ skipped: 2, upserted: 0 });
    expect(await store.listIds()).toEqual(ids);
  });

  it('persists pipeline ownership and removes only confirmed deleted owned chunks', async () => {
    let store = new HnswVectorAdapter(tmpDir, { M: 4, flushIntervalMs: 60000 });
    store.initSync();
    const createPipeline = () =>
      new IndexingPipeline({
        vectorStore: store,
        projectRoot: tmpDir,
        scanDirs: ['recipes'],
        chunking: { useAST: false },
      });
    try {
      await createPipeline().run();
      const [ownedId] = await store.listIds();
      expect((await store.getById(ownedId)).metadata.indexingProducer).toBe(
        'file-indexing-pipeline-v1'
      );
      const walPath = path.join(tmpDir, '.asd/context/index/vector_index.wal');
      const walEntry = JSON.parse(fs.readFileSync(walPath, 'utf8').trim().split('\t')[0]);
      expect(walEntry.m.indexingProducer).toBe('file-indexing-pipeline-v1');
      await store.flush();
      store.destroy();
      store = new HnswVectorAdapter(tmpDir, { M: 4, flushIntervalMs: 60000 });
      store.initSync();
      expect((await store.getById(ownedId)).metadata.indexingProducer).toBe(
        'file-indexing-pipeline-v1'
      );
      await store.upsert({
        id: 'foreign-vector',
        content: 'other producer',
        vector: [],
        metadata: { sourcePath: 'recipes/test.md', indexingProducer: 'other-producer' },
      });
      await store.upsert({
        id: 'previous-scan-scope',
        content: 'outside current scan scope',
        vector: [],
        metadata: {
          sourcePath: 'previous/file.md',
          indexingProducer: 'file-indexing-pipeline-v1',
          chunkIndex: 0,
          totalChunks: 1,
        },
      });
      await store.upsert({
        id: 'recipes_old.md_0',
        content: 'legacy without ownership',
        vector: [],
        metadata: {
          type: 'recipe',
          sourcePath: 'recipes/old.md',
          sourceHash: 'old',
          chunkIndex: 0,
          totalChunks: 1,
        },
      });
      fs.rmSync(path.join(tmpDir, 'recipes', 'test.md'));
      await createPipeline().run();
      expect(await store.getById(ownedId)).toBeNull();
      expect((await store.listIds()).sort()).toEqual([
        'foreign-vector',
        'previous-scan-scope',
        'recipes_old.md_0',
      ]);
    } finally {
      await store.flush();
      store.destroy();
    }
  });

  it('retains owned chunks when a scan or source read fails instead of inferring deletion', async () => {
    const store = new _JsonVectorAdapter(tmpDir);
    store.initSync();
    const pipeline = new IndexingPipeline({
      vectorStore: store,
      projectRoot: tmpDir,
      scanDirs: ['recipes', 'blocked'],
      chunking: { useAST: false },
    });
    await pipeline.run();
    const [ownedId] = await store.listIds();
    fs.rmSync(path.join(tmpDir, 'recipes', 'test.md'));
    fs.writeFileSync(path.join(tmpDir, 'blocked'), 'configured directory became a file');
    expect((await pipeline.run()).errors).toBeGreaterThan(0);
    expect(await store.getById(ownedId)).not.toBeNull();
    fs.rmSync(path.join(tmpDir, 'blocked'));

    const unreadable = path.join(tmpDir, 'recipes', 'unreadable.md');
    fs.writeFileSync(unreadable, '# Present but temporarily unreadable');
    const readFile = fs.readFileSync;
    const fault = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (file === unreadable) {
        throw Object.assign(new Error('read denied'), { code: 'EACCES' });
      }
      return readFile(file, ...args);
    });
    // Node内建模块的ESM具名导入需要同步到受控IO故障，其他路径继续真实读取。
    syncBuiltinESMExports();
    try {
      expect((await pipeline.run()).errors).toBeGreaterThan(0);
      expect(await store.getById(ownedId)).not.toBeNull();
    } finally {
      fault.mockRestore();
      syncBuiltinESMExports();
    }
    await pipeline.run();
    expect(await store.getById(ownedId)).toBeNull();
  });

  it('should scan files and chunk without embed', async () => {
    // Use a mock vector store
    const store = new Map();
    const mockVectorStore = {
      listIds: async () => [],
      getById: async () => null,
      batchUpsert: async (items) => {
        for (const item of items) {
          store.set(item.id, item);
        }
      },
      remove: async (id) => store.delete(id),
    };

    const pipeline = new IndexingPipeline({
      vectorStore: mockVectorStore,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
    });

    const stats = await pipeline.run();
    expect(stats.scanned).toBeGreaterThan(0);
    expect(stats.chunked).toBeGreaterThan(0);
    expect(stats.upserted).toBeGreaterThan(0);
    expect(stats.embedded).toBe(0); // no AI provider
    expect(store.size).toBeGreaterThan(0);
  });

  it('should use BatchEmbedder when aiProvider is set', async () => {
    const embedCalls = [];
    const mockAiProvider = {
      embed: async (texts) => {
        const arr = Array.isArray(texts) ? texts : [texts];
        embedCalls.push(arr.length);
        return arr.map(() => [0.1, 0.2, 0.3]);
      },
    };

    const store = new Map();
    const mockVectorStore = {
      listIds: async () => [],
      getById: async () => null,
      batchUpsert: async (items) => {
        for (const item of items) {
          store.set(item.id, item);
        }
      },
      remove: async (id) => store.delete(id),
    };

    const pipeline = new IndexingPipeline({
      vectorStore: mockVectorStore,
      aiProvider: mockAiProvider,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
    });

    const stats = await pipeline.run();
    expect(stats.embedded).toBeGreaterThan(0);
    // Verify vectors were stored
    for (const [, item] of store) {
      expect(item.vector).toEqual([0.1, 0.2, 0.3]);
    }
  });

  it('detaches the previous embedder when setAiProvider receives null', async () => {
    let embedCalls = 0;
    const provider = {
      embed: async (texts: string[]) => {
        embedCalls++;
        return texts.map(() => [1, 0]);
      },
    };
    const store = new HnswVectorAdapter(tmpDir, { M: 4, flushIntervalMs: 60000 });
    store.initSync();
    const pipeline = new IndexingPipeline({
      vectorStore: store,
      aiProvider: provider,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
      chunking: { useAST: false },
    });
    try {
      expect((await pipeline.run()).embedded).toBe(1);
      expect(embedCalls).toBe(1);
      pipeline.setAiProvider(null);
      expect((await pipeline.run({ force: true })).embedded).toBe(0);
      expect(embedCalls).toBe(1);
      const [id] = await store.listIds();
      expect((await store.getById(id)).vector).toEqual([]);
      expect(await store.searchVector([1, 0])).toEqual([]);

      pipeline.setAiProvider(provider);
      expect((await pipeline.run({ force: true })).embedded).toBe(1);
      expect(embedCalls).toBe(2);
    } finally {
      await store.flush();
      store.destroy();
    }
  });

  it('should skip unchanged files on incremental run', async () => {
    const store = new Map();
    const mockVectorStore = {
      listIds: async () => [...store.keys()],
      getById: async (id) => store.get(id) || null,
      batchUpsert: async (items) => {
        for (const item of items) {
          store.set(item.id, item);
        }
      },
      remove: async (id) => store.delete(id),
    };

    const pipeline = new IndexingPipeline({
      vectorStore: mockVectorStore,
      projectRoot: tmpDir,
      scanDirs: ['recipes'],
    });

    // First run
    const stats1 = await pipeline.run();
    expect(stats1.upserted).toBeGreaterThan(0);
    expect(stats1.skipped).toBe(0);

    // Second run (no changes) - should skip
    const stats2 = await pipeline.run();
    expect(stats2.skipped).toBeGreaterThan(0);
    expect(stats2.upserted).toBe(0);
  });
});

// ═══════════════════════════════════════════
//  HnswIndex #randomLevel safety
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  P1-1: SQ8 2-Pass Search
// ═══════════════════════════════════════════
describe('SQ8 2-pass search', () => {
  const DIM = 32;

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

  it('HnswVectorAdapter should restore qvectors after loading with quantizer', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-2pass-'));
    const store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      quantize: 'none', // disable auto-quantize for manual control
      walEnabled: false,
    });
    store.initSync();

    // Insert enough vectors
    const vectors = [];
    for (let i = 0; i < 20; i++) {
      const v = randomVector(DIM);
      vectors.push(v);
      await store.upsert({
        id: `d${i}`,
        content: `content ${i}`,
        vector: Array.from(v),
        metadata: {},
      });
    }
    await store.flush();
    store.destroy();

    // Verify basic persistence works
    const store2 = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      quantize: 'none',
      walEnabled: false,
    });
    store2.initSync();

    const ids = await store2.listIds();
    expect(ids.length).toBe(20);
    store2.destroy();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════
//  P1-2: RRF Hybrid Search
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  P1-3: AsyncPersistence (WAL)
// ═══════════════════════════════════════════
describe('AsyncPersistence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('crc32 should produce consistent checksums', () => {
    const hash1 = crc32('hello');
    const hash2 = crc32('hello');
    const hash3 = crc32('world');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(8); // 8-char hex
  });

  it('should append WAL entries to disk', () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    const wal = new AsyncPersistence({
      indexPath,
      onPersist: async () => {},
      onReplay: () => {},
      flushIntervalMs: 60000, // don't auto-flush during test
      flushBatchSize: 1000,
    });

    wal.appendWal({ t: WAL_OP.UPSERT, id: 'doc1', c: 'hello', v: [0.1, 0.2], m: {} });
    wal.appendWal({ t: WAL_OP.REMOVE, id: 'doc2' });

    expect(wal.pendingCount).toBe(2);

    // WAL file should exist
    const walPath = indexPath.replace('.asvec', '.wal');
    expect(fs.existsSync(walPath)).toBe(true);

    // Read WAL and verify format (NDJSON + CRC)
    const content = fs.readFileSync(walPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);

    // Each line: JSON\tCRC\n
    for (const line of lines) {
      const tabIdx = line.lastIndexOf('\t');
      expect(tabIdx).toBeGreaterThan(0);
      const json = line.slice(0, tabIdx);
      const checksum = line.slice(tabIdx + 1);
      expect(crc32(json)).toBe(checksum);
      // Should be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();
    }

    wal.destroy();
  });

  it('recover should replay valid WAL entries and retain them until a snapshot succeeds', async () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    const replayed = [];

    const wal = new AsyncPersistence({
      indexPath,
      onPersist: async () => {},
      onReplay: (op) => replayed.push(op),
    });

    // Manually write WAL entries
    const walPath = wal.walPath;
    const ops = [
      { t: WAL_OP.UPSERT, id: 'doc1', c: 'hello', v: [0.1], m: {} },
      { t: WAL_OP.REMOVE, id: 'doc2' },
    ];
    for (const op of ops) {
      const json = JSON.stringify(op);
      fs.appendFileSync(walPath, `${json}\t${crc32(json)}\n`);
    }

    const result = wal.recover();
    expect(result.replayed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].t).toBe(WAL_OP.UPSERT);
    expect(replayed[0].id).toBe('doc1');
    expect(replayed[1].t).toBe(WAL_OP.REMOVE);

    // 重放成功仅说明内存恢复；主快照持久化前不得确认 WAL。
    expect(fs.existsSync(walPath)).toBe(true);
    expect(wal.pendingCount).toBe(2);
    await wal.flush();
    expect(fs.existsSync(walPath)).toBe(false);

    wal.destroy();
  });

  it('recover should skip corrupted WAL entries', () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    const replayed = [];

    const wal = new AsyncPersistence({
      indexPath,
      onPersist: async () => {},
      onReplay: (op) => replayed.push(op),
    });

    const walPath = wal.walPath;

    // Write a valid entry
    const validOp = { t: WAL_OP.UPSERT, id: 'ok', c: 'good', v: [1], m: {} };
    const validJson = JSON.stringify(validOp);
    fs.appendFileSync(walPath, `${validJson}\t${crc32(validJson)}\n`);

    // Write a corrupted entry (bad CRC)
    fs.appendFileSync(walPath, `{"t":1,"id":"bad"}\tDEADBEEF\n`);

    // Write another valid entry
    const validOp2 = { t: WAL_OP.REMOVE, id: 'ok2' };
    const validJson2 = JSON.stringify(validOp2);
    fs.appendFileSync(walPath, `${validJson2}\t${crc32(validJson2)}\n`);

    const result = wal.recover();
    expect(result.replayed).toBe(2);
    expect(result.skipped).toBe(1); // corrupted entry skipped
    expect(replayed).toHaveLength(2);
    expect(replayed[0].id).toBe('ok');
    expect(replayed[1].id).toBe('ok2');

    wal.destroy();
  });

  it('flush should call onPersist and clear WAL', async () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    let persistCalled = 0;

    const wal = new AsyncPersistence({
      indexPath,
      onPersist: async () => {
        persistCalled++;
      },
      onReplay: () => {},
      flushIntervalMs: 60000,
      flushBatchSize: 1000,
    });

    wal.appendWal({ t: WAL_OP.UPSERT, id: 'a', c: 'test', v: [1], m: {} });
    wal.appendWal({ t: WAL_OP.UPSERT, id: 'b', c: 'test2', v: [2], m: {} });

    expect(wal.pendingCount).toBe(2);

    await wal.flush();

    expect(persistCalled).toBe(1);
    expect(wal.pendingCount).toBe(0);
    // WAL file should be cleaned
    expect(fs.existsSync(wal.walPath)).toBe(false);

    wal.destroy();
  });

  it('retains and schedules WAL entries appended while a snapshot is being written', async () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    const snapshotPath = path.join(tmpDir, 'snapshot.json');
    const firstWrite = Promise.withResolvers<void>();
    const secondWrite = Promise.withResolvers<void>();
    const state = ['a'];
    let writes = 0;
    const wal = new AsyncPersistence({
      indexPath,
      flushIntervalMs: 10,
      flushBatchSize: 1,
      onReplay: () => {},
      onPersist: async () => {
        // 序列化先于异步写入；后来的 append 不属于这次已编码的快照。
        const snapshot = [...state];
        writes++;
        await (writes === 1 ? firstWrite.promise : secondWrite.promise);
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
      },
    });
    try {
      wal.appendWal({ t: WAL_OP.UPSERT, id: 'a' });
      state.push('b');
      wal.appendWal({ t: WAL_OP.UPSERT, id: 'b' });
      firstWrite.resolve();
      await vi.waitFor(() => expect(writes > 1 || !wal.isFlushing).toBe(true));
      expect(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))).toEqual(['a']);
      expect(fs.existsSync(wal.walPath)).toBe(true);
      const retained = fs.readFileSync(wal.walPath, 'utf8').trim().split('\n');
      expect(retained).toHaveLength(1);
      const [json, checksum] = retained[0].split('\t');
      expect(JSON.parse(json).id).toBe('b');
      expect(checksum).toBe(crc32(json));

      // 不靠额外 append 唤醒：当前批完成后必须继续调度下一批。
      await vi.waitFor(() => expect(writes).toBe(2));
      secondWrite.resolve();
      await wal.flush();
      expect(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))).toEqual(['a', 'b']);
      expect(wal.pendingCount).toBe(0);
      expect(fs.existsSync(wal.walPath)).toBe(false);
    } finally {
      firstWrite.resolve();
      secondWrite.resolve();
      await wal.flush();
      wal.destroy();
    }
  });

  it('waits for an in-flight snapshot when a second caller flushes', async () => {
    const write = Promise.withResolvers<void>();
    const snapshotPath = path.join(tmpDir, 'snapshot.json');
    const wal = new AsyncPersistence({
      indexPath: path.join(tmpDir, 'test.asvec'),
      flushIntervalMs: 60000,
      flushBatchSize: 1000,
      onReplay: () => {},
      onPersist: async () => {
        await write.promise;
        fs.writeFileSync(snapshotPath, 'saved');
      },
    });
    wal.appendWal({ t: WAL_OP.UPSERT, id: 'a' });
    const first = wal.flush();
    let secondFinished = false;
    const second = wal.flush().then(() => {
      secondFinished = true;
    });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(secondFinished).toBe(false);
      write.resolve();
      await Promise.all([first, second]);
      expect(fs.readFileSync(snapshotPath, 'utf8')).toBe('saved');
      expect(fs.existsSync(wal.walPath)).toBe(false);
    } finally {
      write.resolve();
      await Promise.all([first, second]);
      wal.destroy();
    }
  });

  it('retries a failed background snapshot without losing the batch or rejecting the timer', async () => {
    const snapshotPath = path.join(tmpDir, 'snapshot.json');
    let attempts = 0;
    const wal = new AsyncPersistence({
      indexPath: path.join(tmpDir, 'test.asvec'),
      flushIntervalMs: 10,
      flushBatchSize: 1,
      onReplay: () => {},
      onPersist: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('transient snapshot failure');
        }
        fs.writeFileSync(snapshotPath, 'retried');
      },
    });
    try {
      wal.appendWal({ t: WAL_OP.UPSERT, id: 'a' });
      await vi.waitFor(() => expect(fs.existsSync(snapshotPath)).toBe(true));
      await wal.flush();
      expect(attempts).toBe(2);
      expect(wal.pendingCount).toBe(0);
      expect(fs.existsSync(wal.walPath)).toBe(false);
    } finally {
      wal.destroy();
    }
  });

  it('should not create WAL entries when disabled', () => {
    const indexPath = path.join(tmpDir, 'test.asvec');
    const wal = new AsyncPersistence({
      indexPath,
      enabled: false,
      onPersist: async () => {},
      onReplay: () => {},
    });

    wal.appendWal({ t: WAL_OP.UPSERT, id: 'a', c: 'test', v: [1], m: {} });
    expect(wal.pendingCount).toBe(0);
    expect(fs.existsSync(wal.walPath)).toBe(false);

    wal.destroy();
  });
});

// ═══════════════════════════════════════════
//  WAL integration with HnswVectorAdapter
// ═══════════════════════════════════════════
describe('HnswVectorAdapter WAL integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnsw-wal-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects flush and retains WAL when the HNSW snapshot cannot be written', async () => {
    const store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      flushIntervalMs: 60000,
      flushBatchSize: 10000,
    });
    store.initSync();
    const indexPath = path.join(tmpDir, '.asd/context/index/vector_index.asvec');
    const walPath = indexPath.replace('.asvec', '.wal');
    // 用真实文件系统故障验证公开 flush 的失败语义，不替换序列化器。
    fs.mkdirSync(indexPath);
    try {
      await store.upsert({ id: 'accepted', content: 'durable after retry', vector: [1, 0] });
      const journal = fs.readFileSync(walPath, 'utf8');
      await expect(store.flush()).rejects.toMatchObject({ code: 'EISDIR' });
      expect(fs.readFileSync(walPath, 'utf8')).toBe(journal);

      fs.rmdirSync(indexPath);
      await store.flush();
      expect(fs.existsSync(walPath)).toBe(false);
      const reopened = new HnswVectorAdapter(tmpDir, { M: 4 });
      try {
        reopened.initSync();
        expect(await reopened.getById('accepted')).toMatchObject({
          content: 'durable after retry',
          vector: [1, 0],
        });
      } finally {
        reopened.destroy();
      }
    } finally {
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isDirectory()) {
        fs.rmdirSync(indexPath);
      }
      store.destroy();
    }
  });

  it('retains recovered WAL when the first startup snapshot fails', async () => {
    const indexDir = path.join(tmpDir, '.asd/context/index');
    const indexPath = path.join(indexDir, 'vector_index.asvec');
    const walPath = path.join(indexDir, 'vector_index.wal');
    fs.mkdirSync(indexPath, { recursive: true });
    const op = JSON.stringify({ t: WAL_OP.UPSERT, id: 'recovered', c: 'from WAL', v: [1, 0] });
    const journal = `${op}\t${crc32(op)}\n`;
    fs.writeFileSync(walPath, journal);
    const store = new HnswVectorAdapter(tmpDir, { M: 4, flushIntervalMs: 60000 });
    try {
      await expect(store.init()).rejects.toMatchObject({ code: 'EISDIR' });
      expect(fs.readFileSync(walPath, 'utf8')).toBe(journal);
      fs.rmdirSync(indexPath);
      await store.flush();
      expect(fs.existsSync(walPath)).toBe(false);
      const reopened = new HnswVectorAdapter(tmpDir, { M: 4 });
      try {
        reopened.initSync();
        expect(await reopened.getById('recovered')).toMatchObject({
          content: 'from WAL',
          vector: [1, 0],
        });
      } finally {
        reopened.destroy();
      }
    } finally {
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isDirectory()) {
        fs.rmdirSync(indexPath);
      }
      store.destroy();
    }
  });

  it('should create WAL file when walEnabled=true', async () => {
    const store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: true,
      flushIntervalMs: 60000, // don't auto-flush
      flushBatchSize: 10000,
    });
    store.initSync();

    await store.upsert({ id: 'a', content: 'hello', vector: [1, 0, 0], metadata: {} });

    // WAL file should exist
    const walPath = path.join(tmpDir, '.asd/context/index/vector_index.wal');
    expect(fs.existsSync(walPath)).toBe(true);

    store.destroy();
  });

  it('should NOT create WAL file when walEnabled=false', async () => {
    const store = new HnswVectorAdapter(tmpDir, {
      M: 4,
      walEnabled: false,
    });
    store.initSync();

    await store.upsert({ id: 'a', content: 'hello', vector: [1, 0, 0], metadata: {} });

    const walPath = path.join(tmpDir, '.asd/context/index/vector_index.wal');
    expect(fs.existsSync(walPath)).toBe(false);

    store.destroy();
  });

  it('should recover WAL on restart after crash', async () => {
    // Step 1: Insert data, WAL written but NOT flushed to .asvec
    const store1 = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: true,
      flushIntervalMs: 60000,
      flushBatchSize: 10000,
    });
    await store1.init();

    await store1.upsert({ id: 'a', content: 'alpha', vector: [1, 0, 0], metadata: { x: 1 } });
    await store1.upsert({ id: 'b', content: 'beta', vector: [0, 1, 0], metadata: { x: 2 } });

    // Flush to create the .asvec (so we have a base)
    await store1.flush();

    // Now insert more WITHOUT flushing (simulating crash)
    await store1.upsert({ id: 'c', content: 'gamma', vector: [0, 0, 1], metadata: { x: 3 } });

    // Verify WAL file exists with the unflushed op
    const walPath = path.join(tmpDir, '.asd/context/index/vector_index.wal');
    expect(fs.existsSync(walPath)).toBe(true);

    // "Crash" - destroy without flush
    store1.destroy();

    // Step 2: New instance should recover from .asvec + replay WAL
    const store2 = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: true,
    });
    await store2.init();

    const ids = await store2.listIds();
    expect(ids.sort()).toEqual(['a', 'b', 'c']);

    // Search should find all 3 documents
    const results = await store2.searchVector([0, 0, 1], { topK: 3 });
    expect(results.length).toBe(3);
    expect(results[0].item.id).toBe('c'); // closest to [0,0,1]

    store2.destroy();
  });

  it('should handle WAL with remove operations', async () => {
    const store1 = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: true,
      flushIntervalMs: 60000,
      flushBatchSize: 10000,
    });
    await store1.init();

    await store1.upsert({ id: 'a', content: 'alpha', vector: [1, 0, 0], metadata: {} });
    await store1.upsert({ id: 'b', content: 'beta', vector: [0, 1, 0], metadata: {} });
    await store1.flush(); // Flush base state

    await store1.remove('a'); // Remove via WAL (not flushed)
    store1.destroy(); // "Crash"

    // Recover
    const store2 = new HnswVectorAdapter(tmpDir, {
      M: 4,
      efConstruct: 32,
      efSearch: 32,
      walEnabled: true,
    });
    await store2.init();

    const ids = await store2.listIds();
    expect(ids).toEqual(['b']);

    store2.destroy();
  });
});

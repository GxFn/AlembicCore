// 二进制快照、迁移与 WAL 恢复的权威行为覆盖；宿主只维护接入契约。
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { WriteZone } from '../src/infrastructure/io/WriteZone.js';
import { AsyncPersistence, crc32, WAL_OP } from '../src/infrastructure/vector/AsyncPersistence.js';
import { BinaryPersistence } from '../src/infrastructure/vector/BinaryPersistence.js';
import { HnswIndex } from '../src/infrastructure/vector/HnswIndex.js';
import { HnswVectorAdapter } from '../src/infrastructure/vector/HnswVectorAdapter.js';
import { ScalarQuantizer } from '../src/infrastructure/vector/ScalarQuantizer.js';
import { VectorMigration } from '../src/infrastructure/vector/VectorMigration.js';
import { WorkspaceResolver } from '../src/shared/WorkspaceResolver.js';

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

  it.each([
    0, 2, 3,
  ])('writes a trained quantizer only when it matches positive dimension %s', (dimension) => {
    const index = new HnswIndex({ M: 4 });
    if (dimension > 0) {
      index.addPoint(
        'vector',
        Array.from({ length: dimension }, (_, i) => (i === 0 ? 1 : 0))
      );
    }
    const quantizer = new ScalarQuantizer(2);
    quantizer.train([
      [1, 0],
      [0, 1],
    ]);
    const encoded = BinaryPersistence.encode({
      index,
      quantizer,
      metadata: new Map([['keyword-only', { kind: 'fact' }]]),
      contents: new Map([['keyword-only', 'Retained without ANN data']]),
    });
    const expectedQuantizer = dimension === 2;
    expect(Boolean(encoded.readUInt16LE(6) & 1)).toBe(expectedQuantizer);
    const decoded = BinaryPersistence.decode(encoded);
    expect(decoded.quantizerData !== null).toBe(expectedQuantizer);
    expect(decoded.contents.get('keyword-only')).toBe('Retained without ANN data');
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

  it.each(
    ['save', 'saveAsync'].flatMap((method) =>
      [false, true].flatMap((zoned) =>
        ['write', 'rename'].map((failure) => ({ method, zoned, failure }))
      )
    )
  )('preserves the old snapshot on $failure failure ($method, WriteZone=$zoned)', async ({
    method,
    zoned,
    failure,
  }) => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('kept', [1, 0]);
    const data = {
      index,
      quantizer: null,
      metadata: new Map(),
      contents: new Map([['kept', 'old content']]),
    };
    const wz = zoned ? new WriteZone(WorkspaceResolver.fromProject(tmpDir)) : undefined;
    const filePath = path.join(tmpDir, '.asd/context/index/safe.asvec');
    BinaryPersistence.save(filePath, data, wz);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o666 & ~process.umask());
    fs.chmodSync(filePath, 0o600);
    const previous = fs.readFileSync(filePath);
    const directory = path.dirname(filePath);
    const originalSync = fs.writeFileSync;
    const originalAsync = fsPromises.writeFile;
    const originalRename = fs.renameSync;
    const code = failure === 'write' ? 'ENOSPC' : 'EACCES';
    const isSnapshotWrite = (file, buffer) =>
      typeof file === 'string' && path.dirname(file) === directory && Buffer.isBuffer(buffer);
    const fault = () => Object.assign(new Error('injected snapshot I/O failure'), { code });
    let partialWriteMode: number | undefined;
    const spies = [];
    if (failure === 'rename') {
      spies.push(
        vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
          if (to === filePath) {
            throw fault();
          }
          return originalRename(from, to);
        })
      );
    } else if (method === 'save') {
      spies.push(
        vi.spyOn(fs, 'writeFileSync').mockImplementation((file, buffer, ...options) => {
          if (isSnapshotWrite(file, buffer)) {
            originalSync(file, buffer.subarray(0, 20));
            partialWriteMode = fs.statSync(file).mode & 0o777;
            throw fault();
          }
          return originalSync(file, buffer, ...options);
        })
      );
    } else {
      spies.push(
        vi.spyOn(fsPromises, 'writeFile').mockImplementation(async (file, buffer, ...options) => {
          if (isSnapshotWrite(file, buffer)) {
            await originalAsync(file, buffer.subarray(0, 20));
            partialWriteMode = fs.statSync(file).mode & 0o777;
            throw fault();
          }
          return originalAsync(file, buffer, ...options);
        })
      );
    }
    syncBuiltinESMExports();
    const replacement = { ...data, contents: new Map([['kept', 'new content']]) };
    try {
      await expect(
        (async () => BinaryPersistence[method](filePath, replacement, wz))()
      ).rejects.toMatchObject({ code });
      expect(fs.readFileSync(filePath)).toEqual(previous);
      expect(BinaryPersistence.load(filePath).contents.get('kept')).toBe('old content');
      expect(fs.readdirSync(directory)).toEqual(['safe.asvec']);
      if (failure === 'write') {
        expect(partialWriteMode).toBe(0o600);
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
      syncBuiltinESMExports();
    }
    await BinaryPersistence[method](filePath, replacement, wz);
    expect(BinaryPersistence.load(filePath).contents.get('kept')).toBe('new content');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory)).toEqual(['safe.asvec']);
  });
});

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

    // 随机生成两个普通节点不能覆盖 UInt8 clamp；显式提供可序列化的高层级状态。
    for (const node of index.nodes) {
      if (node) {
        node.level = 300;
      }
    }
    index.entryPoint = 0;
    index.maxLevel = 300;
    while (index.graphs.length <= 300) {
      index.graphs.push(
        new Map([
          [0, new Set([1])],
          [1, new Set([0])],
        ])
      );
    }

    // Encode should succeed without overflow
    const encoded = BinaryPersistence.encode({ index });
    expect(encoded).toBeInstanceOf(Buffer);

    // Decode should produce valid data with 2 vectors
    const decoded = BinaryPersistence.decode(encoded);
    expect(decoded.indexData.nodes).toHaveLength(2);
    expect(decoded.dimension).toBe(3);
    expect(decoded.indexData.nodes.map((node) => node.level)).toEqual([255, 255]);
  });

  it.each([
    'entryPoint',
    'graph node',
    'graph neighbor',
    'future version',
  ] as const)('rejects an invalid %s in the shared decode/isValid boundary', (field) => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('a', [1, 0]);
    index.addPoint('b', [0, 1]);
    const encoded = BinaryPersistence.encode({ index });
    // v1 固定 fixture：32B header，两个 id='a'/'b'、2维向量，各占12B。
    const graphStart = 32 + 2 * 12;
    if (field === 'future version') {
      encoded.writeUInt8(2, 5);
    } else {
      const offset =
        field === 'entryPoint' ? 18 : graphStart + 2 + 4 + (field === 'graph neighbor' ? 6 : 0);
      encoded.writeUInt32LE(2, offset); // 两个节点的合法索引只有 0、1。
    }
    const filePath = path.join(tmpDir, 'invalid-reference.asvec');
    fs.writeFileSync(filePath, encoded);
    expect(BinaryPersistence.isValid(filePath)).toBe(false);
    expect(() => BinaryPersistence.decode(encoded)).toThrow();
  });

  it('rejects metadata length overrun while preserving optional metadata and legacy zero-dimensional quantizers', () => {
    const index = new HnswIndex({ M: 4 });
    const encoded = BinaryPersistence.encode({
      index,
      quantizer: null,
      metadata: new Map([['keyword-only', { kind: 'fact' }]]),
      contents: new Map([['keyword-only', 'No ANN node is required']]),
    });
    const metadataOffset = 32 + 2; // empty v1 index: header + graph level count
    const overrun = Buffer.from(encoded);
    overrun.writeUInt32LE(encoded.readUInt32LE(metadataOffset) + 1, metadataOffset);
    expect(() => BinaryPersistence.decode(overrun)).toThrow();

    const omitted = BinaryPersistence.decode(encoded.subarray(0, metadataOffset));
    expect(omitted.metadata.size).toBe(0);
    expect(omitted.contents.size).toBe(0);
    const malformedJson = Buffer.from(encoded);
    malformedJson.fill('x', metadataOffset + 4);
    expect(BinaryPersistence.decode(malformedJson).contents.size).toBe(0);

    // 旧 encoder 会输出 dimension=0 + HAS_QUANTIZER；不能因此丢掉正常 keyword-only 内容。
    const historical = Buffer.from(encoded);
    historical.writeUInt16LE(3, 6);
    const decoded = BinaryPersistence.decode(historical);
    expect(decoded.quantizerData).toEqual({ dimension: 0, mins: [], maxs: [] });
    expect(decoded.metadata.get('keyword-only')).toEqual({ kind: 'fact' });
    expect(decoded.contents.get('keyword-only')).toBe('No ANN node is required');
  });

  it('rejects a header referencing absent graph levels while retaining empty graph layers after deletion', () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('removed', [1, 0]);
    index.removePoint('removed');
    const encoded = BinaryPersistence.encode({ index });
    const storedLevels = encoded.readUInt16LE(32);
    expect(storedLevels).toBeGreaterThan(0);
    expect(encoded.readUInt16LE(16)).toBe(0);
    const decoded = BinaryPersistence.decode(encoded);
    expect(decoded.indexData.maxLevel).toBe(-1);
    expect(decoded.indexData.graphs).toHaveLength(storedLevels);

    const invalid = Buffer.from(encoded);
    invalid.writeUInt16LE(storedLevels + 1, 16);
    expect(() => BinaryPersistence.decode(invalid)).toThrow();
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

  it('recovers JSON when a truncated snapshot retains a complete valid-looking header', async () => {
    const index = new HnswIndex({ M: 4 });
    index.addPoint('partial', [1, 0]);
    const snapshotPath = path.join(tmpDir, 'vector_index.asvec');
    fs.writeFileSync(snapshotPath, BinaryPersistence.encode({ index }).subarray(0, 32));
    const items = [{ id: 'recoverable', content: 'from JSON', vector: [1, 0], metadata: {} }];
    fs.writeFileSync(path.join(tmpDir, 'vector_index.json'), JSON.stringify(items));
    const recovered = [];
    const result = await VectorMigration.migrate(tmpDir, {
      batchUpsert: async (batch) => {
        recovered.push(...batch);
      },
    });
    expect(result).toBe('migrated');
    expect(recovered).toEqual(items);
    expect(BinaryPersistence.isValid(snapshotPath)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'vector_index.json.bak'))).toBe(true);
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

  it('replays WAL entries newer than the persisted snapshot', async () => {
    // 先生成基准快照，再通过真实 upsert 产生比快照更新的 WAL。
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
    const indexPath = path.join(tmpDir, '.asd/context/index/vector_index.asvec');
    const baseSnapshot = fs.readFileSync(indexPath);

    // 新增 c 只属于待重放的日志，基准快照中没有它。
    await store1.upsert({ id: 'c', content: 'gamma', vector: [0, 0, 1], metadata: { x: 3 } });

    // Verify WAL file exists with the unflushed op
    const walPath = path.join(tmpDir, '.asd/context/index/vector_index.wal');
    expect(fs.existsSync(walPath)).toBe(true);

    // destroy 会同步保存，不能假称它等于进程崩溃；保留真实 WAL，再恢复旧快照来构造恢复输入。
    store1.destroy();
    fs.writeFileSync(indexPath, baseSnapshot);
    expect(BinaryPersistence.load(indexPath).contents.has('c')).toBe(false);

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

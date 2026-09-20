// 文件/chunk/embedding 到索引写入的行为归属；保持原有断言与真实存储。
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  chunkByAST,
  ensureParser,
  isASTChunkerAvailable,
} from '../src/infrastructure/vector/ASTChunker.js';
import { BatchEmbedder } from '../src/infrastructure/vector/BatchEmbedder.js';
import { chunk, estimateTokens } from '../src/infrastructure/vector/Chunker.js';
import { HnswVectorAdapter } from '../src/infrastructure/vector/HnswVectorAdapter.js';
import { IndexingPipeline } from '../src/infrastructure/vector/IndexingPipeline.js';
import { JsonVectorAdapter as _JsonVectorAdapter } from '../src/infrastructure/vector/JsonVectorAdapter.js';

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

  it('preserves overlap without emitting a redundant terminal suffix', () => {
    const result = chunk(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcd',
      {},
      {
        strategy: 'fixed',
        maxChunkTokens: 4,
        overlapTokens: 1,
      }
    );
    expect(result.map((item) => item.content)).toEqual([
      '0123456789ABCDEF',
      'CDEFGHIJKLMNOPQR',
      'OPQRSTUVWXYZabcd',
    ]);
    expect(result.map((item) => item.metadata)).toEqual([
      { chunkIndex: 0, totalChunks: 3 },
      { chunkIndex: 1, totalChunks: 3 },
      { chunkIndex: 2, totalChunks: 3 },
    ]);
  });

  it('keeps mixed text within the shared token estimate without losing code points', () => {
    const text = '中文🙂abc\n'.repeat(12);
    const result = chunk(text, {}, { strategy: 'fixed', maxChunkTokens: 4, overlapTokens: 0 });
    expect(result.map((item) => item.content).join('')).toBe(text);
    for (const item of result) {
      expect(estimateTokens(item.content)).toBeLessThanOrEqual(4);
      expect(item.content.isWellFormed()).toBe(true);
    }
  });

  it('rejects budgets that cannot produce a chunk and never skips text for negative overlap', () => {
    for (const maxChunkTokens of [0, -1, Number.NaN, 0.1]) {
      for (const strategy of ['fixed', 'auto', 'section']) {
        expect(() => chunk('# Title\nabcdef', {}, { strategy, maxChunkTokens })).toThrow(
          RangeError
        );
      }
    }
    expect(() => chunk('short', {}, { strategy: 'auto', overlapTokens: -1 })).toThrow(RangeError);
    expect(() =>
      chunkByAST('const x = 1;', 'javascript', {}, { maxChunkTokens: Number.NaN })
    ).toThrow(RangeError);
    expect(() => chunk('abcdef', {}, { strategy: 'fixed', overlapTokens: -1 })).toThrow(RangeError);
    expect(chunk('short', {}, { strategy: 'fixed', maxChunkTokens: Infinity })).toEqual([
      { content: 'short', metadata: { chunkIndex: 0, totalChunks: 1 } },
    ]);
    expect(
      chunk('12345678', {}, { strategy: 'fixed', maxChunkTokens: 1, overlapTokens: 1 }).map(
        (item) => item.content
      )
    ).toEqual(['1234', '5678']);
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

describe('ASTChunker', () => {
  it('bounds an oversized AST leaf while retaining its complete literal content', async () => {
    expect(await ensureParser()).toBe(true);
    const literal = 'x'.repeat(320);
    const source = `export const data = "${literal}";`;
    const result = chunkByAST(
      source,
      'javascript',
      {},
      {
        maxChunkTokens: 16,
      }
    );
    expect(result).not.toBeNull();
    expect(result!.map((item) => item.content).join('')).toContain(literal);
    for (const item of result!) {
      expect(estimateTokens(item.content)).toBeLessThanOrEqual(16);
      expect(item.metadata.chunkStrategy).toBe('ast');
      expect(source).toContain(item.content);
      expect(item.metadata).toMatchObject({ startLine: 1, endLine: 1 });
    }
  });

  it('isASTChunkerAvailable returns boolean', () => {
    expect(typeof isASTChunkerAvailable('javascript')).toBe('boolean');
    expect(typeof isASTChunkerAvailable('python')).toBe('boolean');
    expect(isASTChunkerAvailable('nonexistent_language')).toBe(false);
  });
});

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

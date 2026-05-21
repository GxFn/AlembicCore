import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGuardCheckEngine, detectLanguage, GuardCheckEngine } from '../src/guard.js';
import { pathGuard } from '../src/io.js';
import {
  buildSearchResponseMeta,
  createSearchEngine,
  FieldWeightedScorer,
  HybridRetriever,
  SearchEngine,
  tokenize,
} from '../src/search.js';
import { chunk, createLocalVectorStore, JsonVectorAdapter } from '../src/vector.js';

describe('stable search, vector, and guard entrypoints', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-public-svg-'));
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exposes search engine, tokenizer, ranker, and hybrid retriever contracts', async () => {
    const db = {
      prepare: () => ({
        all: () => [],
      }),
    };
    const engine = createSearchEngine(db);
    const scorer = new FieldWeightedScorer();
    const retriever = new HybridRetriever({ rrfK: 60 });

    scorer.addDocument('doc-1', 'guard search boundary', {
      title: 'Guard search boundary',
      trigger: 'guard search',
    });

    const fused = retriever.fuse({
      denseResults: [{ id: 'doc-2', score: 0.8 }],
      sparseResults: scorer.search('guard', 1),
      topK: 2,
    });

    expect(engine).toBeInstanceOf(SearchEngine);
    await expect(engine.search('empty')).resolves.toMatchObject({ total: 0 });
    expect(
      buildSearchResponseMeta({ requestedMode: 'semantic', actualMode: 'semantic' })
    ).toMatchObject({
      route: 'core-search-engine',
      semanticUsed: true,
      vectorUsed: true,
    });
    expect(tokenize('GuardSearchBoundary')).toContain('guard');
    expect(scorer.search('guard', 1)[0]?.id).toBe('doc-1');
    expect(fused.map((item) => item.id)).toContain('doc-1');
  });

  it('exposes local vector chunking and store contracts without owning providers', async () => {
    const chunks = chunk('# Title\n\nA stable local vector boundary.', {
      language: 'markdown',
      sourcePath: 'docs/example.md',
    });
    const store = await createLocalVectorStore(tmpDir, {
      json: { indexPath: path.join(tmpDir, '.asd/context/index/public-vector.json') },
    });

    await store.upsert({
      id: 'chunk-1',
      content: chunks[0].content,
      vector: [1, 0, 0],
      metadata: { kind: 'recipe', sourcePath: 'docs/example.md' },
    });

    const hits = await store.searchVector([1, 0, 0], { topK: 1 });

    expect(chunks).toHaveLength(1);
    expect(store).toBeInstanceOf(JsonVectorAdapter);
    expect(hits[0].item.id).toBe('chunk-1');
  });

  it('exposes guard engine and file audit contracts without MCP or CLI wrappers', () => {
    const guard = createGuardCheckEngine(null);
    const result = guard.auditFile(
      'ViewController.swift',
      'let data = try! Data(contentsOf: url)\nDispatchQueue.main.sync { }'
    );

    expect(guard).toBeInstanceOf(GuardCheckEngine);
    expect(detectLanguage('ViewController.swift')).toBe('swift');
    expect(result.summary.total).toBeGreaterThanOrEqual(2);
    expect(result.summary.errors).toBeGreaterThanOrEqual(1);
  });
});

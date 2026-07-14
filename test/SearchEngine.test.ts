import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import {
  buildSearchResponseMeta,
  FieldWeightedScorer,
  resolveSearchWorkspaceIdentity,
  SearchEngine,
  tokenize,
} from '../src/service/search/SearchEngine.js';

/* ────────────────────────────────────────────
 *  tokenize()
 * ──────────────────────────────────────────── */
describe('tokenize', () => {
  test('should return empty array for falsy input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  test('should lowercase and split by whitespace', () => {
    const result = tokenize('Hello World');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });

  test('should split camelCase at lower→upper boundary', () => {
    const result = tokenize('myFunction');
    expect(result).toContain('my');
    expect(result).toContain('function');
  });

  test('should split all-caps prefix from camelCase suffix', () => {
    // 'URLSession' → expanded 'URL Session' → lowered ['url', 'session']
    const result = tokenize('URLSession');
    expect(result).toContain('url');
    expect(result).toContain('session');
  });

  test('should split multi-hump camelCase', () => {
    const result = tokenize('getDataSource');
    expect(result).toContain('get');
    expect(result).toContain('data');
    expect(result).toContain('source');
  });

  test('should deduplicate tokens', () => {
    const result = tokenize('test test test');
    expect(result).toEqual(['test']);
  });

  test('should filter tokens shorter than 2 chars', () => {
    const result = tokenize('a b cd ef');
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
    expect(result).toContain('cd');
    expect(result).toContain('ef');
  });

  test('should handle Chinese text', () => {
    const result = tokenize('错误处理 网络请求');
    expect(result.length).toBeGreaterThan(0);
  });

  test('should strip punctuation', () => {
    const result = tokenize('hello, world! foo@bar');
    expect(result).toContain('hello');
    expect(result).toContain('world');
  });
});

/* ────────────────────────────────────────────
 *  FieldWeightedScorer
 * ──────────────────────────────────────────── */
describe('FieldWeightedScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new FieldWeightedScorer();
  });

  test('should start with 0 documents', () => {
    expect(scorer.totalDocs).toBe(0);
    expect(scorer.documents).toHaveLength(0);
  });

  test('addDocument should increment totals', () => {
    scorer.addDocument('doc1', 'hello world');
    expect(scorer.totalDocs).toBe(1);
    expect(scorer.avgLength).toBeGreaterThan(0);
  });

  test('addDocument should track doc frequency', () => {
    scorer.addDocument('doc1', 'swift networking');
    scorer.addDocument('doc2', 'swift ui');
    expect(scorer.docFreq.swift).toBe(2);
    expect(scorer.docFreq.networking).toBe(1);
  });

  test('search should return empty for empty query', () => {
    scorer.addDocument('doc1', 'hello world');
    const results = scorer.search('');
    expect(results).toEqual([]);
  });

  test('search should return matching documents', () => {
    scorer.addDocument('doc1', 'swift networking URLSession');
    scorer.addDocument('doc2', 'python requests HTTP');
    scorer.addDocument('doc3', 'swift UIKit interface');

    const results = scorer.search('swift');
    expect(results.length).toBe(2);
    expect(results.map((r) => r.id)).toContain('doc1');
    expect(results.map((r) => r.id)).toContain('doc3');
  });

  test('search should rank structured field matches higher', () => {
    scorer.addDocument('doc1', 'swift networking', {
      title: 'Swift Networking',
      trigger: 'swift-networking',
      tags: ['networking'],
    });
    scorer.addDocument('doc2', 'swift python java', { title: 'General Swift' });

    const results = scorer.search('swift networking');
    expect(results[0].id).toBe('doc1');
  });

  test('search should respect limit', () => {
    for (let i = 0; i < 30; i++) {
      scorer.addDocument(`doc${i}`, `swift document ${i}`);
    }
    const results = scorer.search('swift', 5);
    expect(results.length).toBe(5);
  });

  test('search should include meta in results', () => {
    scorer.addDocument('doc1', 'swift networking', { type: 'recipe', title: 'Net' });
    const results = scorer.search('swift');
    expect(results[0].meta).toEqual({ type: 'recipe', title: 'Net' });
  });

  test('clear should reset all state', () => {
    scorer.addDocument('doc1', 'hello world');
    scorer.clear();
    expect(scorer.totalDocs).toBe(0);
    expect(scorer.documents).toHaveLength(0);
    expect(scorer.avgLength).toBe(0);
    expect(Object.keys(scorer.docFreq)).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────
 *  SearchEngine
 * ──────────────────────────────────────────── */
describe('SearchEngine', () => {
  /** Create a mock DB compatible with better-sqlite3 style chained calls */
  function makeMockDb(rows = []) {
    return {
      prepare: vi.fn(() => ({
        all: vi.fn((..._args) => rows),
        run: vi.fn(),
        get: vi.fn(),
      })),
    };
  }

  function makeVectorTruthRepo(rows = []) {
    return {
      findNonDeprecatedSync: vi.fn(() => rows),
      keywordSearchSync: vi.fn(() => []),
      findByIdsDetailSync: vi.fn(() => rows),
      findUpdatedSinceSync: vi.fn(() => []),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  function makeSourceRefRepo() {
    return { findActiveByRecipeIds: vi.fn(() => []) };
  }

  test('constructor should accept plain db object', () => {
    const db = makeMockDb();
    const engine = new SearchEngine(db);
    expect(engine.db).toBe(db);
  });

  test('constructor should unwrap db via getDb()', () => {
    const innerDb = makeMockDb();
    const wrapper = { getDb: () => innerDb };
    const engine = new SearchEngine(wrapper);
    expect(engine.db).toBe(innerDb);
  });

  test('auto search acts as a compatibility facade over KnowledgeRetrievalPort', async () => {
    const retrieve = vi.fn(async () => ({
      candidates: [
        {
          denseLaneUsed: true,
          denseRank: 2,
          denseSimilarity: 0.83,
          diagnostics: {
            aggregatedRegionCount: 1,
            candidateBudgetReached: false,
            candidateWindow: 32,
            exhausted: true,
            filteredDeprecatedCount: 0,
            filteredOrphanCount: 4,
            refillRounds: 1,
          },
          recipe: { id: 'r1', kind: 'rule', lifecycle: 'active', title: 'Boundary' },
          recipeId: 'r1',
          regionEvidence: [],
          rrfContribution: { dense: 0.01, sparse: 0.008, total: 0.018 },
          score: 0.018,
          semanticUsed: true,
          sparseLaneUsed: true,
          sparseRank: 1,
          sparseScore: 12,
          vectorUsed: true,
        },
      ],
      diagnostics: {
        aggregatedRegionCount: 1,
        candidateBudgetReached: false,
        candidateWindow: 32,
        exhausted: true,
        filteredDeprecatedCount: 0,
        filteredOrphanCount: 4,
        refillRounds: 1,
      },
    }));
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRetrievalPort: { retrieve },
      knowledgeRepo: makeVectorTruthRepo([]),
      sourceRefRepo: makeSourceRefRepo(),
    });

    const response = await engine.search('architecture boundaries', {
      limit: 3,
      mode: 'auto',
      type: 'knowledge',
    });

    expect(response.items.map((item) => item.id)).toEqual(['r1']);
    expect(response.items[0]?.rrfContribution).toEqual({
      dense: 0.01,
      sparse: 0.008,
      total: 0.018,
    });
    expect(response.searchMeta?.filteredOrphanVectorCount).toBe(4);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0]?.[0]?.topK).toBe(3);
    expect(retrieve.mock.calls[0]?.[0]?.filter).toBeUndefined();
  });

  test('getStats should report initial state', () => {
    const engine = new SearchEngine(makeMockDb());
    const stats = engine.getStats();
    expect(stats.indexed).toBe(false);
    expect(stats.totalDocuments).toBe(0);
    expect(stats.cacheSize).toBe(0);
    expect(stats.hasVectorStore).toBe(false);
    expect(stats.hasAiProvider).toBe(false);
  });

  test('buildIndex should load recipes from DB', () => {
    const rows = [
      {
        id: 'r1',
        title: 'Swift URLSession',
        description: 'network',
        language: 'swift',
        category: 'Network',
        knowledgeType: 'code-pattern',
        kind: 'pattern',
        content_json: '{"pattern":"let s = URLSession()"}',
        status: 'active',
        tags_json: '["swift","network"]',
        trigger: 'url',
      },
    ];
    const db = makeMockDb(rows);
    const engine = new SearchEngine(db);

    engine.buildIndex();

    expect(engine.scorer.totalDocs).toBe(1);
    expect(engine.getStats().indexed).toBe(true);
  });

  test('search should return empty for blank query', async () => {
    const engine = new SearchEngine(makeMockDb());
    const result = await engine.search('');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('search in keyword mode should use _keywordSearch', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'URLSession',
        description: 'networking',
        language: 'swift',
        category: 'Net',
        knowledgeType: 'code-pattern',
        kind: 'pattern',
        status: 'active',
        content_json: '{}',
        trigger: '',
      },
    ];
    const db = makeMockDb(rows);
    const engine = new SearchEngine(db);

    const result = await engine.search('URLSession', { mode: 'keyword' });
    expect(result.mode).toBe('keyword');
    expect(result.searchMeta).toEqual(
      expect.objectContaining({
        route: 'core-search-engine',
        requestedMode: 'keyword',
        actualMode: 'keyword',
        semanticUsed: false,
        vectorUsed: false,
        resultCount: result.total,
      })
    );
    expect(db.prepare).toHaveBeenCalled();
  });

  test('search should cache results', async () => {
    const db = makeMockDb([]);
    const engine = new SearchEngine(db);

    await engine.search('test', { mode: 'keyword' });
    const stats1 = engine.getStats();
    expect(stats1.cacheSize).toBe(1);

    // Second call should hit cache
    await engine.search('test', { mode: 'keyword' });
    expect(engine.getStats().cacheSize).toBe(1);
  });

  function legacyBoundaryRule() {
    return {
      id: 'layer-boundary-rule',
      title: '分层依赖方向强制约束',
      description:
        'Features flow through Infrastructure into Core; Package.swift target dependencies enforce the direction.',
      lifecycle: 'active',
      language: 'swift',
      category: 'architecture',
      knowledgeType: 'boundary-constraint',
      kind: 'rule',
      content: JSON.stringify({
        markdown:
          'Every feature package stays independently removable because sibling target dependencies are absent.',
        rationale: 'Independent feature ownership prevents implicit coupling.',
      }),
      reasoning: JSON.stringify({
        whyStandard: 'A sibling feature import fails when its Package.swift dependency is absent.',
      }),
      tags: '["architecture","dependency","layering"]',
      trigger: '@layered-dependency-direction',
      whenClause: 'When adding package dependencies between feature modules',
      doClause: 'Keep feature packages independent through one-way dependencies',
      dontClause: 'Do not import one feature module from another feature directly',
    };
  }

  function shallowLegacyRule(id, title, description) {
    return {
      id,
      title,
      description,
      lifecycle: 'active',
      language: 'swift',
      category: 'architecture',
      knowledgeType: 'guide',
      kind: 'guide',
      content: '{}',
      reasoning: '{}',
      tags: '[]',
      trigger: `@${id}`,
    };
  }

  test('ranks legacy package-boundary intent above shallow SwiftPM token overlap', async () => {
    const rows = [
      shallowLegacyRule('pure-swift', 'Pure Swift packages', 'Use Swift language features.'),
      shallowLegacyRule('toolchain', 'SwiftPM toolchain', 'Configure Swift package builds.'),
      shallowLegacyRule('feature-ui', 'Feature package UI', 'Build a feature package screen.'),
      shallowLegacyRule('branch', 'Feature branch naming', 'Name a feature development branch.'),
      legacyBoundaryRule(),
    ];
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRepo: makeVectorTruthRepo(rows),
      sourceRefRepo: makeSourceRefRepo(),
    });

    const result = await engine.search(
      'How do I keep SwiftPM feature packages independent from each other?',
      { limit: rows.length, mode: 'weighted', rank: false }
    );
    const targetRank = result.items.findIndex((item) => item.id === 'layer-boundary-rule');

    expect(targetRank).toBeGreaterThanOrEqual(0);
    expect(targetRank).toBeLessThan(3);
  });

  test('ranks legacy module exclusions above shallow feature and lifecycle labels', async () => {
    const rows = [
      shallowLegacyRule(
        'feature-branch',
        'Feature branch naming',
        'Name a feature development branch.'
      ),
      shallowLegacyRule(
        'feature-module-lifecycle',
        'Feature module lifecycle',
        'Initialize an application module.'
      ),
      shallowLegacyRule(
        'feature-module-protocol',
        'Feature module protocol',
        'Define a module protocol.'
      ),
      shallowLegacyRule('direct-imports', 'Import ordering', 'Sort direct imports.'),
      legacyBoundaryRule(),
    ];
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRepo: makeVectorTruthRepo(rows),
      sourceRefRepo: makeSourceRefRepo(),
    });

    const result = await engine.search(
      'What prevents one feature module from importing another feature directly?',
      { limit: rows.length, mode: 'weighted', rank: false }
    );
    const targetRank = result.items.findIndex((item) => item.id === 'layer-boundary-rule');

    expect(targetRank).toBeGreaterThanOrEqual(0);
    expect(targetRank).toBeLessThan(3);
  });

  test('metadata filters narrow results with AND across fields', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'Architecture rule',
        description: 'project architecture standard',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'architecture',
        category: 'standards',
        knowledgeType: 'architecture',
        kind: 'rule',
        scope: 'project',
        tags: '["semantic-quality","ranking"]',
        content: '{"pattern":"architecture"}',
        trigger: 'architecture',
      },
      {
        id: 'r2',
        title: 'Architecture example',
        description: 'workspace architecture example',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'architecture',
        category: 'examples',
        knowledgeType: 'architecture',
        kind: 'pattern',
        scope: 'workspace',
        tags: '["semantic-quality"]',
        content: '{"pattern":"architecture"}',
        trigger: 'architecture',
      },
    ];
    const engine = new SearchEngine(makeMockDb(rows));

    const result = await engine.search('architecture', {
      mode: 'weighted',
      dimensionId: 'architecture',
      knowledgeType: 'architecture',
      scope: 'project',
      category: 'standards',
      kind: 'rule',
    });

    expect(result.items.map((item) => item.id)).toEqual(['r1']);
    expect(result.searchMeta?.appliedFilters).toMatchObject({
      category: ['standards'],
      dimensionId: ['architecture'],
      kind: ['rule'],
      knowledgeType: ['architecture'],
      scope: ['project'],
    });
    expect(result.items[0].matchedFilters).toMatchObject({
      category: ['standards'],
      dimensionId: ['architecture'],
      kind: ['rule'],
      knowledgeType: ['architecture'],
      scope: ['project'],
    });
  });

  test('tag filters use OR within tags and AND with other fields', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'Semantic quality',
        description: 'semantic filter quality',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'search',
        category: 'standards',
        knowledgeType: 'architecture',
        kind: 'rule',
        scope: 'project',
        tags: '["semantic-quality"]',
        content: '{"pattern":"semantic"}',
        trigger: 'semantic',
      },
      {
        id: 'r2',
        title: 'Ranking quality',
        description: 'ranking filter quality',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'search',
        category: 'standards',
        knowledgeType: 'architecture',
        kind: 'rule',
        scope: 'project',
        tags: '["ranking"]',
        content: '{"pattern":"ranking"}',
        trigger: 'ranking',
      },
      {
        id: 'r3',
        title: 'Workspace semantic quality',
        description: 'workspace scope should be excluded',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'search',
        category: 'standards',
        knowledgeType: 'architecture',
        kind: 'rule',
        scope: 'workspace',
        tags: '["semantic-quality"]',
        content: '{"pattern":"semantic"}',
        trigger: 'semantic',
      },
    ];
    const engine = new SearchEngine(makeMockDb(rows));

    const result = await engine.search('', {
      mode: 'weighted',
      scope: 'project',
      tags: ['semantic-quality', 'ranking'],
    });

    expect(result.mode).toBe('metadata-filter');
    expect(result.items.map((item) => item.id).sort()).toEqual(['r1', 'r2']);
    expect(result.items.every((item) => item.matchedFilters?.scope?.[0] === 'project')).toBe(true);
  });

  test('cache keys distinguish metadata filter sets', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'Search architecture',
        description: 'search architecture',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'search',
        category: 'standards',
        knowledgeType: 'architecture',
        kind: 'rule',
        scope: 'project',
        tags: '[]',
        content: '{"pattern":"search"}',
        trigger: 'search',
      },
      {
        id: 'r2',
        title: 'Search example',
        description: 'search example',
        lifecycle: 'active',
        language: 'typescript',
        dimensionId: 'search',
        category: 'examples',
        knowledgeType: 'architecture',
        kind: 'pattern',
        scope: 'project',
        tags: '[]',
        content: '{"pattern":"search"}',
        trigger: 'search',
      },
    ];
    const engine = new SearchEngine(makeMockDb(rows));

    const standards = await engine.search('search', { mode: 'weighted', category: 'standards' });
    const examples = await engine.search('search', { mode: 'weighted', category: 'examples' });

    expect(standards.items.map((item) => item.id)).toEqual(['r1']);
    expect(examples.items.map((item) => item.id)).toEqual(['r2']);
    expect(engine.getStats().cacheSize).toBe(2);
  });

  test('search rejects retired bm25 mode without mapping it to keyword', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'Swift',
        description: 'test',
        language: 'swift',
        category: 'A',
        knowledgeType: 'code-pattern',
        kind: 'pattern',
        content_json: '{}',
        status: 'active',
        tags_json: '[]',
        trigger: '',
      },
    ];
    const db = makeMockDb(rows);
    const engine = new SearchEngine(db);

    const result = await engine.search('swift', { mode: 'bm25' });
    expect(result.items).toEqual([]);
    expect(result.mode).toBe('unsupported');
    expect(result.searchMeta).toEqual(
      expect.objectContaining({
        requestedMode: 'bm25',
        actualMode: 'unsupported',
        fallbackReason: 'unsupported_mode:bm25',
        unsupportedMode: 'bm25',
      })
    );
    expect(engine.getStats().indexed).toBe(false);
  });

  test('search in semantic mode should fall back to weighted without aiProvider', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'Swift',
        description: 'test',
        language: 'swift',
        category: 'A',
        knowledgeType: 'code-pattern',
        kind: 'pattern',
        content_json: '{}',
        status: 'active',
        tags_json: '[]',
        trigger: '',
      },
    ];
    const db = makeMockDb(rows);
    const engine = new SearchEngine(db); // no aiProvider

    const result = await engine.search('swift', { mode: 'semantic' });
    expect(result.mode).toBe('weighted'); // falls back to FieldWeighted
    expect(result.searchMeta).toEqual(
      expect.objectContaining({
        requestedMode: 'semantic',
        actualMode: 'weighted',
        semanticUsed: false,
        vectorUsed: false,
        fallbackReason: 'embed_provider_unavailable',
      })
    );
  });

  test('searchMeta should mark real VectorService semantic route', async () => {
    const rows = [
      {
        id: 'r1',
        title: 'VideoURLPreloader',
        description: 'preload media URL',
        language: 'swift',
        category: 'Player',
        knowledgeType: 'code-pattern',
        kind: 'pattern',
        content_json: '{}',
        status: 'active',
        tags_json: '[]',
        trigger: 'preload',
      },
    ];
    const db = makeMockDb(rows);
    const vectorService = {
      search: vi.fn().mockResolvedValue([
        {
          score: 0.91,
          item: {
            id: 'entry_r1',
            metadata: {
              entryId: 'r1',
              title: 'VideoURLPreloader',
              kind: 'pattern',
              language: 'swift',
              dimensionId: 'playback',
              category: 'Player',
              knowledgeType: 'code-pattern',
              scope: 'project',
              tags: ['preload', 'media'],
            },
          },
        },
        // P-D D1 回归(BiliDili 真机):同一 Recipe 的 region 命中(metadata 带
        // recipeId 而非 entryId)必须折叠进主命中,不得以 recipe_region_* 独立占位。
        {
          score: 0.89,
          item: {
            id: 'recipe_region_r1_applicability_abcdef0123456789',
            metadata: { recipeId: 'r1', title: 'VideoURLPreloader', kind: 'pattern' },
          },
        },
        // 无 recipeId 元数据的 region 命中:靠 id 反解归并到同一 Recipe。
        {
          score: 0.87,
          item: {
            id: 'recipe_region_r1_rationale_fedcba9876543210',
            metadata: { title: 'VideoURLPreloader', kind: 'pattern' },
          },
        },
      ]),
    };
    const engine = new SearchEngine(db, { vectorService: vectorService as never });

    const result = await engine.search('视频地址预加载', {
      mode: 'semantic',
      limit: 5,
      rank: false,
    });

    expect(vectorService.search).toHaveBeenCalledWith('视频地址预加载', {
      topK: 10,
      filter: null,
    });
    expect(result.mode).toBe('semantic');
    expect(result.items[0]).toMatchObject({
      id: 'r1',
      semanticScore: 0.91,
      vectorScore: 0.91,
      semanticUsed: true,
      vectorUsed: true,
      dimensionId: 'playback',
      knowledgeType: 'code-pattern',
      scope: 'project',
      tags: ['preload', 'media'],
    });
    // D1 断言:三条向量命中(1 chunk + 2 region)按 entryId 折叠为一条,
    // 且结果 id 是 DB entryId 而非 recipe_region_* 向量 id。
    expect(result.items).toHaveLength(1);
    expect(result.items.every((item) => !String(item.id).startsWith('recipe_region_'))).toBe(true);
    expect(result.searchMeta).toEqual(
      expect.objectContaining({
        route: 'core-search-engine',
        requestedMode: 'semantic',
        actualMode: 'semantic',
        semanticUsed: true,
        vectorUsed: true,
        resultCount: 1,
      })
    );
  });

  test('semantic orphan vectors are filtered before filters and refill the live result limit', async () => {
    const knowledgeRepo = makeVectorTruthRepo([
      {
        id: 'live-a',
        title: 'Live A',
        lifecycle: 'active',
        scope: 'project',
        kind: 'pattern',
      },
      {
        id: 'live-filtered',
        title: 'Filtered live row',
        lifecycle: 'active',
        scope: 'workspace',
        kind: 'pattern',
      },
      {
        id: 'live-b',
        title: 'Live B',
        lifecycle: 'active',
        scope: 'project',
        kind: 'pattern',
      },
    ]);
    const vectorService = {
      search: vi.fn().mockResolvedValue([
        {
          score: 0.99,
          item: {
            id: 'entry_orphan',
            metadata: { entryId: 'orphan', title: 'Orphan', scope: 'project' },
          },
        },
        {
          score: 0.93,
          item: {
            id: 'entry_live-a',
            metadata: { entryId: 'live-a', title: 'Live A', scope: 'project' },
          },
        },
        {
          score: 0.82,
          item: {
            id: 'entry_live-filtered',
            metadata: {
              entryId: 'live-filtered',
              title: 'Filtered live row',
              scope: 'workspace',
            },
          },
        },
        {
          score: 0.71,
          item: {
            id: 'entry_live-b',
            metadata: { entryId: 'live-b', title: 'Live B', scope: 'project' },
          },
        },
      ]),
      upsert: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      reconcileIndex: vi.fn(),
    };
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
      vectorService: vectorService as never,
    });

    const result = await engine.search('truthful semantic results', {
      mode: 'semantic',
      limit: 2,
      rank: false,
      scope: 'project',
    });

    expect(vectorService.search).toHaveBeenCalledWith('truthful semantic results', {
      topK: 4,
      filter: { scope: ['project'] },
    });
    expect(knowledgeRepo.findByIdsDetailSync).toHaveBeenCalledWith([
      'orphan',
      'live-a',
      'live-filtered',
      'live-b',
    ]);
    expect(result.items.map((item) => [item.id, item.score])).toEqual([
      ['live-a', 0.93],
      ['live-b', 0.71],
    ]);
    expect(result.searchMeta).toMatchObject({ filteredOrphanVectorCount: 1, resultCount: 2 });
    expect(knowledgeRepo.insert).not.toHaveBeenCalled();
    expect(knowledgeRepo.update).not.toHaveBeenCalled();
    expect(knowledgeRepo.delete).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
    expect(vectorService.remove).not.toHaveBeenCalled();
    expect(vectorService.clear).not.toHaveBeenCalled();
    expect(vectorService.reconcileIndex).not.toHaveBeenCalled();
  });

  test('auto orphan vectors are filtered before ranking without changing recall budget', async () => {
    const knowledgeRepo = makeVectorTruthRepo([
      { id: 'live-a', title: 'Live A', lifecycle: 'active', kind: 'pattern' },
      { id: 'live-b', title: 'Live B', lifecycle: 'active', kind: 'pattern' },
    ]);
    const vectorService = {
      hybridSearch: vi.fn().mockResolvedValue([
        { id: 'orphan-a', score: 0.99, vectorUsed: true, semanticUsed: true },
        { id: 'live-a', score: 0.91, vectorUsed: true, semanticUsed: true },
        { id: 'orphan-b', score: 0.84, vectorUsed: true, semanticUsed: true },
        { id: 'live-b', score: 0.73, vectorUsed: true, semanticUsed: true },
      ]),
    };
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
      vectorService: vectorService as never,
    });
    const rankingSpy = vi.spyOn(engine, '_applyRanking').mockImplementation(async (items) => items);

    const result = await engine.search('how should truthful vector results be selected', {
      mode: 'auto',
      limit: 2,
    });

    expect(vectorService.hybridSearch).toHaveBeenCalledWith(
      'how should truthful vector results be selected',
      expect.objectContaining({ topK: 6 })
    );
    expect(rankingSpy.mock.calls[0][0].map((item) => [item.id, item.score])).toEqual([
      ['live-a', 0.91],
      ['live-b', 0.73],
    ]);
    expect(result.items.map((item) => [item.id, item.score])).toEqual([
      ['live-a', 0.91],
      ['live-b', 0.73],
    ]);
    expect(result.searchMeta).toMatchObject({ filteredOrphanVectorCount: 2, resultCount: 2 });
  });

  test('legacy semantic vector store refills an orphan slot with a live database row', async () => {
    const knowledgeRepo = makeVectorTruthRepo([
      { id: 'live-entry', title: 'Live entry', lifecycle: 'active', kind: 'pattern' },
    ]);
    const vectorStore = {
      query: vi.fn().mockResolvedValue([
        { id: 'orphan-entry', similarity: 0.97, metadata: { title: 'Orphan' } },
        { id: 'live-entry', similarity: 0.81, metadata: { title: 'Live entry' } },
      ]),
    };
    const engine = new SearchEngine(makeMockDb(), {
      aiProvider: { embed: vi.fn().mockResolvedValue([0.1, 0.2]) },
      vectorStore: vectorStore as never,
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
    });

    const result = await engine.search('legacy truth lookup', {
      mode: 'semantic',
      limit: 1,
      rank: false,
    });

    expect(vectorStore.query).toHaveBeenCalledWith([0.1, 0.2], 2);
    expect(knowledgeRepo.findByIdsDetailSync).toHaveBeenCalledWith(['orphan-entry', 'live-entry']);
    expect(result.items.map((item) => [item.id, item.score])).toEqual([['live-entry', 0.81]]);
    expect(result.searchMeta).toMatchObject({ filteredOrphanVectorCount: 1, resultCount: 1 });
  });

  test('vector truth lookup failure falls back without exposing unverified candidates', async () => {
    const knowledgeRepo = makeVectorTruthRepo([]);
    knowledgeRepo.findByIdsDetailSync.mockImplementation(() => {
      throw new Error('request database unavailable');
    });
    const vectorService = {
      search: vi.fn().mockResolvedValue([
        {
          score: 0.96,
          item: { id: 'entry_unverified', metadata: { entryId: 'unverified' } },
        },
      ]),
    };
    const engine = new SearchEngine(makeMockDb(), {
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
      vectorService: vectorService as never,
    });

    const result = await engine.search('fail closed truth lookup', {
      mode: 'semantic',
      limit: 1,
      rank: false,
    });

    expect(result.items).toEqual([]);
    expect(result.mode).toBe('weighted');
    expect(result.searchMeta).toMatchObject({
      fallbackReason: 'knowledge_truth_lookup_failed',
      semanticUsed: false,
      vectorUsed: false,
    });
    expect(result.searchMeta).not.toHaveProperty('filteredOrphanVectorCount');
  });

  test('semantic mode forwards filters and still hard-filters returned vectors', async () => {
    const db = makeMockDb([]);
    const knowledgeRepo = makeVectorTruthRepo([
      {
        id: 'keep',
        lifecycle: 'active',
        kind: 'rule',
        scope: 'project',
        tags: '["semantic-quality"]',
      },
      {
        id: 'drop',
        lifecycle: 'active',
        kind: 'rule',
        scope: 'workspace',
        tags: '["semantic-quality"]',
      },
    ]);
    const vectorService = {
      search: vi.fn().mockResolvedValue([
        {
          score: 0.88,
          item: {
            id: 'entry_keep',
            metadata: {
              entryId: 'keep',
              title: 'Project semantic quality',
              kind: 'rule',
              language: 'typescript',
              dimensionId: 'search',
              category: 'standards',
              knowledgeType: 'architecture',
              scope: 'project',
              tags: ['semantic-quality'],
            },
          },
        },
        {
          score: 0.93,
          item: {
            id: 'entry_drop',
            metadata: {
              entryId: 'drop',
              title: 'Workspace semantic quality',
              kind: 'rule',
              language: 'typescript',
              dimensionId: 'search',
              category: 'standards',
              knowledgeType: 'architecture',
              scope: 'workspace',
              tags: ['semantic-quality'],
            },
          },
        },
      ]),
    };
    const engine = new SearchEngine(db, {
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
      vectorService: vectorService as never,
    });

    const result = await engine.search('semantic quality', {
      mode: 'semantic',
      scope: 'project',
      tags: ['semantic-quality', 'ranking'],
      rank: false,
    });

    expect(vectorService.search).toHaveBeenCalledWith('semantic quality', {
      topK: 40,
      filter: { scope: ['project'], tags: ['ranking', 'semantic-quality'] },
    });
    expect(result.items.map((item) => item.id)).toEqual(['keep']);
    expect(result.searchMeta).toMatchObject({
      appliedFilters: { scope: ['project'], tags: ['ranking', 'semantic-quality'] },
      semanticUsed: true,
      vectorUsed: true,
    });
  });

  test('auto searchMeta should not report vector usage for sparse-only RRF fallback', async () => {
    const db = makeMockDb([]);
    const knowledgeRepo = makeVectorTruthRepo([
      { id: 'sparse-only-1', lifecycle: 'active', kind: 'pattern' },
    ]);
    const vectorService = {
      hybridSearch: vi.fn().mockResolvedValue([
        {
          id: 'sparse-only-1',
          score: 0.42,
          vectorUsed: false,
          semanticUsed: false,
          fallbackReason: 'embed_failed:API error',
          data: { item: { id: 'sparse-only-1', title: 'Sparse fallback' } },
        },
      ]),
    };
    const engine = new SearchEngine(db, {
      knowledgeRepo,
      sourceRefRepo: makeSourceRefRepo(),
      vectorService: vectorService as never,
    });

    const result = await engine.search('ambiguous resident search', {
      mode: 'auto',
      limit: 5,
      rank: false,
    });

    expect(vectorService.hybridSearch).toHaveBeenCalled();
    expect(result.mode).toBe('auto(sparse-rrf,conf=0)');
    expect(result.searchMeta).toEqual(
      expect.objectContaining({
        requestedMode: 'auto',
        actualMode: 'auto(sparse-rrf,conf=0)',
        semanticUsed: false,
        vectorUsed: false,
        fallbackReason: 'embed_failed:API error',
      })
    );
  });

  test('buildSearchResponseMeta should model resident service vector telemetry', () => {
    const meta = buildSearchResponseMeta({
      route: 'resident-service',
      requestedMode: 'semantic',
      actualMode: 'semantic',
      resultCount: 3,
      durationMs: 6.4,
      workspace: { projectId: 'bili', workspaceMode: 'ghost' },
      residentVector: { available: true, endpoint: '/api/v1/search' },
      timings: { embedMs: 2, vectorMs: 4, totalMs: 6 },
      filteredOrphanVectorCount: 3,
    });

    expect(meta).toMatchObject({
      route: 'resident-service',
      requestedMode: 'semantic',
      actualMode: 'semantic',
      semanticUsed: true,
      vectorUsed: true,
      resultCount: 3,
      durationMs: 6,
      workspace: { projectId: 'bili', workspaceMode: 'ghost' },
      residentVector: { available: true, endpoint: '/api/v1/search' },
      timings: { embedMs: 2, vectorMs: 4, totalMs: 6 },
      filteredOrphanVectorCount: 3,
    });

    expect(
      buildSearchResponseMeta({ actualMode: 'semantic', filteredOrphanVectorCount: 0 })
    ).not.toHaveProperty('filteredOrphanVectorCount');
  });

  test('resolveSearchWorkspaceIdentity derives a project id from projectRoot', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'search-project-identity-'));
    try {
      const workspace = resolveSearchWorkspaceIdentity({ projectRoot });

      expect(workspace).toMatchObject({
        dataRoot: projectRoot,
        projectRoot,
        workspaceMode: 'standard',
      });
      expect(workspace?.projectId).toMatch(/^[a-f0-9]{8}$/);
      expect(workspace?.projectId).not.toBe('project:unknown');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('refreshIndex should rebuild index', () => {
    const db = makeMockDb([]);
    const engine = new SearchEngine(db);

    engine.buildIndex();
    expect(engine.getStats().indexed).toBe(true);

    engine.refreshIndex();
    expect(engine.getStats().indexed).toBe(true);
  });

  test('search with groupByKind should partition results', async () => {
    const db = makeMockDb([]);
    const engine = new SearchEngine(db);

    const result = await engine.search('something', { mode: 'keyword', groupByKind: true });
    expect(result.byKind).toBeDefined();
    expect(result.byKind.rule).toBeDefined();
    expect(result.byKind.pattern).toBeDefined();
    expect(result.byKind.fact).toBeDefined();
  });

  test('cache should expire after maxAge', async () => {
    const db = makeMockDb([]);
    const engine = new SearchEngine(db, { cacheMaxAge: 1 }); // 1ms

    await engine.search('test', { mode: 'keyword' });
    expect(engine.getStats().cacheSize).toBe(1);

    // Wait for cache to expire
    await new Promise((r) => setTimeout(r, 10));
    // Access _getCache directly to verify expiration
    const cached = engine._getCache('test:all:20:keyword:::nofilters');
    expect(cached).toBeNull();
  });

  /* ────────────────────────────────────────────
   *  G-C P1: 源锚漂移在检索侧透出 + 降权
   * ──────────────────────────────────────────── */
  describe('source-ref drift surfacing (G-C P1)', () => {
    /** 注入 mock sourceRefRepo,按 recipeId 返回不同 status 的桥表行。 */
    function engineWithRefs(rowsByRecipe) {
      const engine = new SearchEngine(makeMockDb(), {
        sourceRefRepo: {
          findActiveByRecipeIds: (ids) => ids.flatMap((id) => rowsByRecipe[id] ?? []),
        },
      });
      return engine;
    }

    test('_supplementDetails: 纯 active 锚点 → sourceRefStatus=active,无 driftedSourceRefs', () => {
      const engine = engineWithRefs({
        r1: [
          { recipeId: 'r1', sourcePath: 'src/a.ts:1-9', status: 'active', newPath: null },
          { recipeId: 'r1', sourcePath: 'src/b.ts:1-9', status: 'active', newPath: null },
        ],
      });
      const items = [{ id: 'r1' }];
      engine._supplementDetails(items);
      expect(items[0].sourceRefs).toEqual(['src/a.ts:1-9', 'src/b.ts:1-9']);
      expect(items[0].sourceRefStatus).toBe('active');
      expect(items[0].driftedSourceRefs).toBeUndefined();
    });

    test('_supplementDetails: 含 drifted 锚点 → sourceRefStatus=drifted + driftedSourceRefs 子集;renamed 用 newPath', () => {
      const engine = engineWithRefs({
        r2: [
          { recipeId: 'r2', sourcePath: 'src/a.ts:1-9', status: 'active', newPath: null },
          { recipeId: 'r2', sourcePath: 'src/b.ts:10-20', status: 'drifted', newPath: null },
          {
            recipeId: 'r2',
            sourcePath: 'src/old.ts:1-5',
            status: 'renamed',
            newPath: 'src/new.ts:1-5',
          },
        ],
      });
      const items = [{ id: 'r2' }];
      engine._supplementDetails(items);
      // drifted 不排除:三条锚点都在 refs 里(renamed 用 newPath)。
      expect(items[0].sourceRefs).toEqual(['src/a.ts:1-9', 'src/b.ts:10-20', 'src/new.ts:1-5']);
      // 但 drifted 子集单列 + item 聚合态为 drifted。
      expect(items[0].driftedSourceRefs).toEqual(['src/b.ts:10-20']);
      expect(items[0].sourceRefStatus).toBe('drifted');
    });

    test('_applyRanking: drifted item 相对同分 active item 被降权(active 优先)', async () => {
      const engine = new SearchEngine(makeMockDb());
      // 两条几乎同分,只有源锚态不同;降权后 active 应排在 drifted 前。
      const items = [
        { id: 'drift', title: 'x', coarseScore: 1, rankerScore: 1, sourceRefStatus: 'drifted' },
        { id: 'fresh', title: 'x', coarseScore: 1, rankerScore: 1, sourceRefStatus: 'active' },
      ];
      const ranked = await engine._applyRanking(items, 'x', {});
      const drift = ranked.find((r) => r.id === 'drift');
      const fresh = ranked.find((r) => r.id === 'fresh');
      // drifted 乘性降权 → 分数严格低于 active。
      expect(drift.score).toBeLessThan(fresh.score);
    });
  });
});

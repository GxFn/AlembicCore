/**
 * SearchRanking.test.ts — 搜索算法与索引单元测试
 *
 * 覆盖:
 *  - CoarseRanker           (5维粗排、动态权重、边界)
 *  - MultiSignalRanker      (7信号、场景权重、向后兼容)
 *  - Individual Signals      (RelevanceSignal, PopularitySignal, ContextMatchSignal, etc.)
 *  - contextBoost           (共享上下文加成)
 *  - FieldWeightedScorer    (增量 remove/update/compact, lexical 评分器)
 */

import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { CoarseRanker } from '../src/service/search/CoarseRanker.js';
import { contextBoost } from '../src/service/search/contextBoost.js';
import { FieldWeightedScorer } from '../src/service/search/FieldWeightedScorer.js';
import {
  AuthoritySignal,
  ContextMatchSignal,
  DifficultySignal,
  MultiSignalRanker,
  PopularitySignal,
  RecencySignal,
  RelevanceSignal,
} from '../src/service/search/MultiSignalRanker.js';
import { tokenize } from '../src/service/search/tokenizer.js';

/* ════════════════════════════════════════════════════════════════════
 *  CoarseRanker
 * ════════════════════════════════════════════════════════════════════ */

describe('CoarseRanker', () => {
  const ranker = new CoarseRanker();

  const makeCandidates = (overrides = []) =>
    overrides.map((o, i) => ({
      id: `c${i}`,
      title: `Candidate ${i}`,
      content: 'some code',
      description: 'desc',
      category: 'patterns',
      language: 'javascript',
      tags: ['tag'],
      recallScore: 1,
      semanticScore: 0.5,
      usageCount: 10,
      updatedAt: new Date().toISOString(),
      ...o,
    }));

  test('returns empty for empty input', () => {
    expect(ranker.rank([])).toEqual([]);
    expect(ranker.rank(null)).toEqual([]);
  });

  test('adds coarseScore and coarseSignals to each candidate', () => {
    const result = ranker.rank(makeCandidates([{ recallScore: 5 }, { recallScore: 3 }]));
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r).toHaveProperty('coarseScore');
      expect(r.coarseSignals).toHaveProperty('recall');
      expect(r.coarseSignals).toHaveProperty('semantic');
      expect(r.coarseSignals).toHaveProperty('quality');
      expect(r.coarseSignals).toHaveProperty('freshness');
      expect(r.coarseSignals).toHaveProperty('popularity');
    }
  });

  test('sorts by coarseScore descending', () => {
    const result = ranker.rank(makeCandidates([{ recallScore: 10 }, { recallScore: 1 }]));
    expect(result[0].recallScore).toBe(10);
    expect(result[0].coarseScore).toBeGreaterThanOrEqual(result[1].coarseScore);
  });

  test('dynamic weight redistribution when semantic scores are all zero', () => {
    const candidates = makeCandidates([
      { recallScore: 5, semanticScore: 0 },
      { recallScore: 3, semanticScore: 0 },
    ]);
    const result = ranker.rank(candidates);
    // semanticScore 全 0 → semantic 维度被 redistribute
    expect(result[0].coarseSignals.semantic).toBe(0);
    // 分数应 > 0（来自其他维度）
    expect(result[0].coarseScore).toBeGreaterThan(0);
  });

  test('higher quality score for candidates with richer metadata', () => {
    const rich = makeCandidates([
      {
        title: 'Title',
        content: '// comment\nline1\nline2\nline3',
        description: 'desc',
        category: 'cat',
        language: 'js',
        tags: ['a'],
        recallScore: 1,
        semanticScore: 0,
      },
    ]);
    const poor = makeCandidates([
      {
        title: '',
        content: '',
        description: '',
        category: '',
        language: '',
        tags: [],
        recallScore: 1,
        semanticScore: 0,
      },
    ]);
    const richResult = ranker.rank(rich);
    const poorResult = ranker.rank(poor);
    expect(richResult[0].coarseSignals.quality).toBeGreaterThan(
      poorResult[0].coarseSignals.quality
    );
  });

  test('freshness exponential decay — newer items score higher', () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 365 * 86400000).toISOString();
    const candidates = makeCandidates([
      { recallScore: 1, semanticScore: 0, updatedAt: now },
      { recallScore: 1, semanticScore: 0, updatedAt: old },
    ]);
    const result = ranker.rank(candidates);
    const newer = result.find((r) => r.updatedAt === now);
    const older = result.find((r) => r.updatedAt === old);
    expect(newer.coarseSignals.freshness).toBeGreaterThan(older.coarseSignals.freshness);
  });

  test('popularity: higher usageCount → higher signal', () => {
    const candidates = makeCandidates([
      { recallScore: 1, semanticScore: 0, usageCount: 1000 },
      { recallScore: 1, semanticScore: 0, usageCount: 1 },
    ]);
    const result = ranker.rank(candidates);
    const popular = result.find((r) => r.usageCount === 1000);
    const unpopular = result.find((r) => r.usageCount === 1);
    expect(popular.coarseSignals.popularity).toBeGreaterThan(unpopular.coarseSignals.popularity);
  });

  test('respects custom weights from constructor', () => {
    const recallHeavy = new CoarseRanker({
      recallWeight: 1.0,
      semanticWeight: 0,
      qualityWeight: 0,
      freshnessWeight: 0,
      popularityWeight: 0,
    });
    const result = recallHeavy.rank(
      makeCandidates([
        { recallScore: 10, semanticScore: 0.9 },
        { recallScore: 1, semanticScore: 0.9 },
      ])
    );
    expect(result[0].recallScore).toBe(10);
  });
});

/* ════════════════════════════════════════════════════════════════════
 *  Individual Signals
 * ════════════════════════════════════════════════════════════════════ */

describe('RelevanceSignal', () => {
  const signal = new RelevanceSignal();

  test('returns capped score for exact title match', () => {
    const s = signal.compute(
      { title: 'react hooks', trigger: '', recallScore: 0.3, content: '' },
      { query: 'react hooks' }
    );
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThanOrEqual(1.0);
  });

  test('trigger match gives strongest boost', () => {
    const withTrigger = signal.compute(
      { title: 'something', trigger: 'useState', recallScore: 0.1, content: '' },
      { query: 'useState' }
    );
    const withoutTrigger = signal.compute(
      { title: 'something', trigger: '', recallScore: 0.1, content: '' },
      { query: 'useState' }
    );
    expect(withTrigger).toBeGreaterThan(withoutTrigger);
  });

  test('returns score even without query', () => {
    const s = signal.compute({ recallScore: 0.5 }, {});
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('AuthoritySignal', () => {
  const signal = new AuthoritySignal();

  test('high quality + high usage → high authority', () => {
    const s = signal.compute({ qualityScore: 90, authorityScore: 0.8, usageCount: 100 });
    expect(s).toBeGreaterThan(0.5);
  });

  test('returns 0.5 baseline when no signals', () => {
    const s = signal.compute({});
    expect(s).toBe(0.5);
  });
});

describe('RecencySignal', () => {
  const signal = new RecencySignal();

  test('recent item → score near 1.0', () => {
    const s = signal.compute({ updatedAt: new Date().toISOString() });
    expect(s).toBeGreaterThan(0.9);
  });

  test('very old item → score near 0', () => {
    const s = signal.compute({ updatedAt: '2020-01-01' });
    expect(s).toBeLessThan(0.3);
  });

  test('no date → 0.5 baseline', () => {
    expect(signal.compute({})).toBe(0.5);
  });

  test('Unix timestamp (seconds) handled correctly', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const s = signal.compute({ updatedAt: nowSec });
    expect(s).toBeGreaterThan(0.9);
  });
});

describe('PopularitySignal', () => {
  const signal = new PopularitySignal();

  test('usageCount 0 → 0', () => {
    expect(signal.compute({ usageCount: 0 })).toBe(0);
  });

  test('usageCount 10 → moderate score', () => {
    const s = signal.compute({ usageCount: 10 });
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.8);
  });

  test('usageCount 1000+ → capped at 1.0', () => {
    expect(signal.compute({ usageCount: 10000 })).toBeLessThanOrEqual(1.0);
  });
});

describe('DifficultySignal', () => {
  const signal = new DifficultySignal();

  test('exact match → 1.0', () => {
    expect(signal.compute({ difficulty: 'intermediate' }, { userLevel: 'intermediate' })).toBe(1.0);
  });

  test('one level off → 0.7', () => {
    expect(signal.compute({ difficulty: 'beginner' }, { userLevel: 'intermediate' })).toBe(0.7);
  });

  test('defaults to intermediate when missing', () => {
    expect(signal.compute({}, {})).toBe(1.0); // both default to intermediate
  });
});

describe('ContextMatchSignal', () => {
  const signal = new ContextMatchSignal();

  test('language match → 0.4', () => {
    const s = signal.compute({ language: 'javascript' }, { language: 'javascript' });
    expect(s).toBeGreaterThanOrEqual(0.4);
  });

  test('related language → partial score', () => {
    const s = signal.compute({ language: 'typescript' }, { language: 'javascript' });
    expect(s).toBeGreaterThanOrEqual(0.15);
    expect(s).toBeLessThan(0.4);
  });

  test('baseline 0.1 when no context', () => {
    expect(signal.compute({}, {})).toBe(0.1);
  });

  test('category match → score includes 0.25', () => {
    const s = signal.compute({ category: 'patterns' }, { category: 'patterns' });
    expect(s).toBeGreaterThanOrEqual(0.25);
  });

  test('tag overlap → additional score', () => {
    const s = signal.compute({ tags: ['react', 'hooks'] }, { tags: ['react', 'hooks', 'state'] });
    expect(s).toBeGreaterThan(0.1);
  });
});

/* ════════════════════════════════════════════════════════════════════
 *  MultiSignalRanker
 * ════════════════════════════════════════════════════════════════════ */

describe('MultiSignalRanker', () => {
  const ranker = new MultiSignalRanker();

  test.each([
    'constructor',
    '__proto__',
    'toString',
  ])('treats %s as an ordinary unknown configuration key', (key) => {
    const candidates = [
      { id: 'low', recallScore: 0.1 },
      { id: 'high', recallScore: 0.9 },
    ];
    expect(ranker.rank(candidates, { scenario: key })).toEqual(
      ranker.rank(candidates, { scenario: 'not-configured' })
    );
    expect(new DifficultySignal().compute({ difficulty: key }, {})).toBe(1);
    expect(new DifficultySignal().compute({}, { userLevel: key })).toBe(1);
    const result = ranker.rank([{ id: 'unknown', difficulty: key, language: key }], {
      userLevel: key,
      language: 'typescript',
    });
    expect(Number.isFinite(result[0].rankerScore)).toBe(true);
    expect(result[0].signals).toMatchObject({ difficulty: 1, contextMatch: 0.1 });
  });

  test('honors an own __proto__ scenario from JSON like any other custom scenario', () => {
    const subject = new MultiSignalRanker({
      scenarioWeights: JSON.parse('{"__proto__":{"relevance":1},"named":{"relevance":1}}'),
    });
    const candidates = [
      { id: 'low', recallScore: 0.1 },
      { id: 'high', recallScore: 0.9 },
    ];
    expect(subject.rank(candidates, { scenario: '__proto__' })).toEqual(
      subject.rank(candidates, { scenario: 'named' })
    );
  });

  test('keeps ranking stateless without retaining unused bus subscriptions', () => {
    const signalBus = new SignalBus();
    const subject = new MultiSignalRanker({ signalBus });
    const candidates = [
      { id: 'a', title: 'alpha', recallScore: 0.5 },
      { id: 'b', title: 'beta', recallScore: 0.2 },
    ];
    const before = subject.rank(candidates, { query: 'alpha' });
    for (const type of ['quality', 'usage'] as const) {
      signalBus.emit({ type, source: 'test', target: 'b', value: 1, metadata: {}, timestamp: 0 });
    }
    expect(subject.rank(candidates, { query: 'alpha' })).toEqual(before);
    expect(signalBus.listenerCount).toBe(0);
  });

  test('returns empty for empty/null input', () => {
    expect(ranker.rank([])).toEqual([]);
    expect(ranker.rank(null)).toEqual([]);
  });

  test('adds rankerScore and signals to each candidate', () => {
    const result = ranker.rank([{ id: 'a', recallScore: 0.5, title: 'test' }], {
      query: 'test',
      scenario: 'search',
    });
    expect(result[0]).toHaveProperty('rankerScore');
    expect(result[0]).toHaveProperty('signals');
    expect(result[0].signals).toHaveProperty('relevance');
    expect(result[0].signals).toHaveProperty('contextMatch');
  });

  test('different scenarios produce different scores', () => {
    const candidate = {
      id: 'a',
      recallScore: 0.5,
      title: 'react',
      difficulty: 'beginner',
      usageCount: 100,
    };
    const lintResult = ranker.rank([candidate], { query: 'react', scenario: 'lint' });
    const learningResult = ranker.rank([candidate], { query: 'react', scenario: 'learning' });
    // Lint scenario weights authority more, learning weights difficulty more
    // Scores should differ
    expect(lintResult[0].rankerScore).not.toBe(learningResult[0].rankerScore);
  });

  test('backward compatible with seasonality key', () => {
    const custom = new MultiSignalRanker({
      scenarioWeights: {
        custom: {
          relevance: 0.5,
          authority: 0.1,
          recency: 0.1,
          popularity: 0.1,
          difficulty: 0.1,
          seasonality: 0.1, // old key
        },
      },
    });
    const result = custom.rank([{ id: 'a', recallScore: 0.5, language: 'javascript' }], {
      query: 'test',
      scenario: 'custom',
      language: 'javascript',
    });
    expect(result[0].signals).toHaveProperty('contextMatch');
    const equivalent = new MultiSignalRanker({
      scenarioWeights: {
        custom: {
          relevance: 0.5,
          authority: 0.1,
          recency: 0.1,
          popularity: 0.1,
          difficulty: 0.1,
          contextMatch: 0.1,
        },
      },
    });
    expect(result).toEqual(
      equivalent.rank([{ id: 'a', recallScore: 0.5, language: 'javascript' }], {
        query: 'test',
        scenario: 'custom',
        language: 'javascript',
      })
    );
  });

  test('sorts by rankerScore descending', () => {
    const result = ranker.rank(
      [
        { id: 'low', recallScore: 0.1, title: 'unrelated' },
        { id: 'high', recallScore: 0.9, title: 'exact match query' },
      ],
      { query: 'exact match query' }
    );
    expect(result[0].id).toBe('high');
  });
});

/* ════════════════════════════════════════════════════════════════════
 *  contextBoost (shared)
 * ════════════════════════════════════════════════════════════════════ */

describe('contextBoost', () => {
  test('returns items unchanged when no sessionHistory', () => {
    const items = [{ id: 'a', rankerScore: 0.8, title: 'test' }];
    const result = contextBoost(items, {});
    // No contextScore added
    expect(result).toEqual(items);
  });

  test('applies session keyword overlap boost', () => {
    const items = [
      { id: 'a', rankerScore: 0.5, title: 'react hooks guide', trigger: '', content: '' },
      { id: 'b', rankerScore: 0.5, title: 'vue setup', trigger: '', content: '' },
    ];
    const context = {
      sessionHistory: [{ content: 'I am learning react hooks and useState' }],
    };
    const result = contextBoost(items, context);
    const reactItem = result.find((r) => r.id === 'a');
    const vueItem = result.find((r) => r.id === 'b');
    expect(reactItem.contextScore).toBeGreaterThan(vueItem.contextScore);
  });

  test('applies language match boost', () => {
    const items = [
      { id: 'a', rankerScore: 0.5, language: 'javascript', title: 'a' },
      { id: 'b', rankerScore: 0.5, language: 'python', title: 'b' },
    ];
    const context = {
      sessionHistory: [{ content: 'test context' }],
      language: 'javascript',
    };
    const result = contextBoost(items, context);
    const jsItem = result.find((r) => r.id === 'a');
    const pyItem = result.find((r) => r.id === 'b');
    expect(jsItem.contextBoost).toBeGreaterThan(pyItem.contextBoost);
  });

  test('sorts by contextScore descending', () => {
    const items = [
      { id: 'low', rankerScore: 0.3, title: 'unrelated', language: 'go' },
      { id: 'high', rankerScore: 0.3, title: 'react hooks', language: 'javascript' },
    ];
    const context = {
      sessionHistory: [{ content: 'react hooks help' }],
      language: 'javascript',
    };
    const result = contextBoost(items, context);
    expect(result[0].id).toBe('high');
  });
});

/* ════════════════════════════════════════════════════════════════════
 *  FieldWeightedScorer — incremental operations
 * ════════════════════════════════════════════════════════════════════ */

describe('FieldWeightedScorer incremental', () => {
  let scorer: FieldWeightedScorer;

  beforeEach(() => {
    scorer = new FieldWeightedScorer();
    scorer.addDocument('d1', 'react hooks useState');
    scorer.addDocument('d2', 'vue composition ref');
    scorer.addDocument('d3', 'angular signals effect');
  });

  test.each(['addDocument', 'updateDocument'] as const)('%s replaces the same id', (method) => {
    scorer[method]('d1', 'python django flask');
    expect(scorer.totalDocs).toBe(3);
    expect(scorer.search('react hooks', 10).some((row) => row.id === 'd1')).toBe(false);
    expect(scorer.search('python', 10).some((row) => row.id === 'd1')).toBe(true);
  });

  test('removeDocument updates membership, frequencies and searchable documents', () => {
    expect(scorer.hasDocument('d2')).toBe(true);
    expect(scorer.docFreq.vue).toBe(1);
    expect(scorer.removeDocument('d2')).toBe(true);
    expect(scorer.totalDocs).toBe(2);
    expect(scorer.hasDocument('d2')).toBe(false);
    expect(scorer.docFreq.vue).toBeUndefined();
    expect(scorer.search('vue', 10).some((row) => row.id === 'd2')).toBe(false);
  });

  test('removeDocument returns false for non-existent id', () => {
    expect(scorer.removeDocument('nonexistent')).toBe(false);
  });

  test('removeDocument updates semantic topic frequencies', () => {
    scorer.addDocument('topic', 'architecture boundary rule', {
      kind: 'rule',
      knowledgeType: 'boundary-constraint',
      tags: ['architecture'],
    });
    expect(scorer.topicDocFreq.architecture).toBe(1);
    expect(scorer.topicDocFreq.rule).toBe(1);

    scorer.removeDocument('topic');

    expect(scorer.topicDocFreq.architecture).toBeUndefined();
    expect(scorer.topicDocFreq.rule).toBeUndefined();
  });

  test('compact triggers when nullRatio > 30% and docs > 100', () => {
    // Build up > 100 docs then remove > 30%
    scorer.clear();
    for (let i = 0; i < 110; i++) {
      scorer.addDocument(`doc${i}`, `content number ${i}`);
    }
    expect(scorer.totalDocs).toBe(110);
    // Remove 40 docs (>30%) — compact triggers mid-way, so check final state
    for (let i = 0; i < 40; i++) {
      scorer.removeDocument(`doc${i}`);
    }
    expect(scorer.totalDocs).toBe(70);
    // After at least one compact, array should be shorter than original 110
    expect(scorer.documents.length).toBeLessThan(110);
  });

  test('avgLength recalculates after remove', () => {
    const avgBefore = scorer.avgLength;
    scorer.removeDocument('d1');
    // avgLength should change (d1 had 3 tokens, removed from 9 total across 3 docs)
    expect(scorer.avgLength).not.toBe(avgBefore);
    expect(scorer.totalDocs).toBe(2);
  });

  test('clear resets everything including _idIndex', () => {
    scorer.clear();
    expect(scorer.totalDocs).toBe(0);
    expect(scorer.hasDocument('d1')).toBe(false);
    expect(scorer.documents).toHaveLength(0);
    expect(scorer.avgLength).toBe(0);
    expect(Object.keys(scorer.docFreq)).toHaveLength(0);
    expect(scorer.search('react')).toEqual([]);
  });
});

// 纯算法契约集中在本套件；SearchEngine.test 只保留仓储/召回/编排与元数据集成。
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

  test.each([
    { input: 'myFunction', words: ['my', 'function'] },
    { input: 'URLSession', words: ['url', 'session'] },
    { input: 'getDataSource', words: ['get', 'data', 'source'] },
  ])('splits case boundaries in $input', ({ input, words }) => {
    expect(tokenize(input)).toEqual(expect.arrayContaining(words));
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

  test('supports Chinese unigrams and bigrams', () => {
    expect(tokenize('网络请求')).toEqual(
      expect.arrayContaining(['网', '络', '网络', '络请', '请求'])
    );
  });

  test('keeps Chinese tokens around camel-case English identifiers', () => {
    expect(tokenize('使用URLSession发送请求')).toEqual(
      expect.arrayContaining(['url', 'session', '发送', '请求'])
    );
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
  let scorer: FieldWeightedScorer;

  beforeEach(() => {
    scorer = new FieldWeightedScorer();
  });

  test('tracks constructor token frequencies through add, remove and clear', () => {
    scorer.addDocument('constructor-doc', 'constructor', { tags: ['constructor'] });
    expect(scorer.docFreq.constructor).toBe(1);
    expect(scorer.topicDocFreq.constructor).toBe(1);
    expect(scorer.search('constructor').map((item) => item.id)).toEqual(['constructor-doc']);
    scorer.removeDocument('constructor-doc');
    expect(scorer.search('constructor')).toEqual([]);
    expect(scorer.docFreq.constructor).toBeUndefined();
    expect(scorer.topicDocFreq.constructor).toBeUndefined();
    scorer.clear();
    scorer.addDocument('recreated', 'constructor', { tags: ['constructor'] });
    expect(scorer.search('constructor').map((item) => item.id)).toEqual(['recreated']);
  });

  test('starts empty and updates totals when indexing a document', () => {
    expect(scorer.totalDocs).toBe(0);
    expect(scorer.documents).toHaveLength(0);
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
});

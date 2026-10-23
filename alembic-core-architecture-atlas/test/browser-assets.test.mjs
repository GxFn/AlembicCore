import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildBrowserAssets } from '../scripts/browser-assets.mjs';
const digest = (s) => createHash('sha256').update(s).digest('hex');
const doc = {
  topicId: '01',
  title: '知识提交',
  question: '如何写入？',
  path: 'maps/01/README.md',
  truthKind: 'current-code',
  reviewDepth: 'L3',
  freshness: 'matched',
  body: '正文含commitKnowledgeWrite',
  sourcePaths: ['src/a.ts'],
  testPaths: ['test/a.ts'],
  configPaths: ['package.json'],
  consumerRefs: [],
  risks: [],
  diagrams: [],
  dependencySelection: [],
};
const input = {
  documents: [doc],
  inventory: {
    files: [
      {
        path: 'src/a.ts',
        category: 'source',
        topicId: '01',
        sha256: 'h',
        responsibility: '提交服务',
        flow: '真实写入',
        readLevel: 'full',
        reviewStatus: 'inherited',
      },
    ],
  },
  imports: {
    edges: [{ from: 'src/a.ts', to: null, kind: 'dynamic-unresolved', excerpt: 'HEAVY_AST_TEXT' }],
  },
  api: {
    entries: [
      {
        name: '.',
        modules: [{ path: 'src/a.ts', exports: [{ name: 'run', origin: 'src/a.ts' }] }],
      },
    ],
  },
  topics: [{ id: '01', title: '知识提交', question: '如何写入？', ownedFileCount: 1 }],
  summary: { sourceDigest: 's', checkedAt: 'old', documentCount: 1 },
  review: { knownRisks: [] },
};
test('bootstrap不携带正文、完整索引和API；按用途资源独立绑定digest', () => {
  const before = JSON.stringify(input);
  const { bootstrap, assets } = buildBrowserAssets(input);
  assert.equal(bootstrap.documents, undefined);
  assert.equal(bootstrap.inventory, undefined);
  assert.equal(bootstrap.api, undefined);
  assert.equal(JSON.stringify(bootstrap).includes('HEAVY_AST_TEXT'), false);
  for (const ref of Object.values(bootstrap.assets)) {
    const text = assets.get(ref.url);
    assert.equal(digest(text), ref.sha256);
    assert.equal(Buffer.byteLength(text), ref.bytes);
  }
  const topic = JSON.parse(assets.get(bootstrap.assets['topic:01'].url));
  assert.equal(topic.data.document.body, doc.body);
  assert.equal(topic.identity, '01');
  const search = JSON.parse(assets.get(bootstrap.assets.search.url)).data;
  assert.ok(search.documents[0].text.includes('commitknowledgewrite'));
  assert.equal(search.files[0].path, 'src/a.ts');
  const impact = JSON.parse(assets.get(bootstrap.assets.impact.url)).data;
  assert.equal(impact.edges[0].excerpt, undefined);
  assert.equal(impact.unknownCount, 1);
  assert.equal(JSON.stringify(input), before);
});
test('相同输入资源稳定；一个专题变动不会改另一用途资源', () => {
  const a = buildBrowserAssets(input),
    b = buildBrowserAssets(structuredClone(input));
  assert.deepEqual(a.bootstrap, b.bootstrap);
  const modified = structuredClone(input);
  modified.documents[0].body += ' 新陈述';
  const c = buildBrowserAssets(modified);
  assert.notEqual(a.bootstrap.assets['topic:01'].sha256, c.bootstrap.assets['topic:01'].sha256);
  assert.equal(a.bootstrap.assets.api.sha256, c.bootstrap.assets.api.sha256);
  assert.throws(() => buildBrowserAssets({ ...input, documents: [doc, doc] }), /duplicate/);
});
test('公开别名映射到门面和原声明，搜索不依赖此前访问过API页', () => {
  const current = structuredClone(input);
  current.api.entries[0].modules[0].exports = [{ name: 'AliasOnly', origin: 'src/a.ts' }];
  const { bootstrap, assets } = buildBrowserAssets(current);
  const search = JSON.parse(assets.get(bootstrap.assets.search.url)).data;
  assert.ok(search.files.find((f) => f.path === 'src/a.ts').publicNames.includes('AliasOnly'));
  assert.ok(!search.files.find((f) => f.path === 'src/a.ts').symbols.includes('AliasOnly'));
});

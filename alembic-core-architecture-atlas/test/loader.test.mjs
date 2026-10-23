import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AtlasLoader, LatestRequest } from '../src/loader.ts';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const file = '{}';
const make = (kind, identity, data) => {
  const text = JSON.stringify({ schemaVersion: 1, kind, identity, data });
  return {
    text,
    ref: {
      url: `atlas-data/${kind}-${sha(text)}.json`,
      kind,
      identity,
      sha256: sha(text),
      bytes: Buffer.byteLength(text),
    },
  };
};
test('只读取被选择资源，共享请求且失败可重试；坏字节/类型/身份拒绝', async () => {
  const good = make('topic', '01', { document: { topicId: '01' }, dependency: null });
  let calls = 0;
  const loader = new AtlasLoader(
    async () => {
      calls++;
      return good.text;
    },
    async (t) => sha(t),
  );
  assert.equal(calls, 0);
  await Promise.all([loader.load(good.ref), loader.load(good.ref)]);
  assert.equal(calls, 1);
  let fail = true;
  const retry = new AtlasLoader(
    async () => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return good.text;
    },
    async (t) => sha(t),
  );
  await assert.rejects(retry.load(good.ref), /offline/);
  await retry.load(good.ref);
  await assert.rejects(
    new AtlasLoader(
      async () => file,
      async (t) => sha(t),
    ).load(good.ref),
    /bytes|digest/,
  );
  await assert.rejects(loader.load({ ...good.ref, url: '../data/private.json' }), /asset-path/);
  const wrong = make('topic', '02', { document: { topicId: '02' }, dependency: null });
  await assert.rejects(
    new AtlasLoader(
      async () => wrong.text,
      async (t) => sha(t),
    ).load({ ...wrong.ref, identity: '01' }),
    /identity/,
  );
});
test('晚到成功/失败都不能覆盖新页面或新搜索；取消不发布', async () => {
  const gate = new LatestRequest(),
    events = [];
  let resolveOld, rejectOld;
  const first = gate.run(
    () =>
      new Promise((r) => {
        resolveOld = r;
      }),
    (v) => events.push(v),
    () => events.push('old-error'),
  );
  await gate.run(
    async () => 'new',
    (v) => events.push(v),
    () => events.push('error'),
  );
  resolveOld('old');
  await first;
  assert.deepEqual(events, ['new']);
  const last = gate.run(
    () =>
      new Promise((_, r) => {
        rejectOld = r;
      }),
    (v) => events.push(v),
    () => events.push('late-error'),
  );
  gate.cancel();
  rejectOld(Error('stale'));
  await last;
  assert.deepEqual(events, ['new']);
});

test('构建器生成的book资源可经真实读取器校验，坏结构仍拒绝', async () => {
  const { buildBrowserAssets } = await import('../scripts/browser-assets.mjs');
  const book = {
    modules: [],
    failures: [],
    journeys: [],
    objects: [],
    runs: [],
    graphs: [],
    edges: [],
    search: [],
    topicInputs: [],
  };
  const { bootstrap, assets } = buildBrowserAssets({
    documents: [],
    inventory: { files: [] },
    imports: { edges: [] },
    api: { entries: [] },
    topics: [],
    symbols: { files: [] },
    summary: {},
    review: {},
    book,
  });
  const loader = new AtlasLoader(
    async (url) => assets.get(url),
    async (text) => sha(text),
  );
  assert.deepEqual(await loader.load(bootstrap.assets.book), book);
  const broken = make('book', 'book', { journeys: [] });
  await assert.rejects(
    new AtlasLoader(
      async () => broken.text,
      async (text) => sha(text),
    ).load(broken.ref),
    /book-shape/,
  );
});

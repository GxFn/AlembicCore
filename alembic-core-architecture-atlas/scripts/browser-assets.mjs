import { topicNavigation } from './book.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dependencyGraph } from '../src/graph-model.ts';
const sha = (text) => createHash('sha256').update(text).digest('hex');
export const browserInputFiles = {
  documents: 'documents',
  inventory: 'source-inventory',
  imports: 'import-graph',
  api: 'public-api',
  topics: 'topic-index',
  summary: 'validation-summary',
  review: 'review-summary',
  symbols: 'source-symbols',
  book: 'book-index',
};
export function readBrowserInputs(root) {
  return Object.fromEntries(
    Object.entries(browserInputFiles).map(([key, name]) => [
      key,
      JSON.parse(readFileSync(resolve(root, 'data', name + '.json'), 'utf8')),
    ]),
  );
}
// 正典保持完整；只在构建/serve时按用途投射，不改来源、审阅时间或回执。
export function buildBrowserAssets(input) {
  const assets = new Map(),
    refs = {};
  function add(key, kind, identity, data) {
    if (refs[key]) throw Error(`duplicate-asset:${key}`);
    const text = JSON.stringify({ schemaVersion: 1, kind, identity, data });
    const hash = sha(text),
      url = `atlas-data/${kind}-${hash}.json`;
    refs[key] = { url, kind, identity, sha256: hash, bytes: Buffer.byteLength(text) };
    assets.set(url, text);
  }
  for (const d of input.documents) {
    if (!/^[a-zA-Z0-9_-]+$/.test(d.topicId)) throw Error('invalid-topic-identity');
    add(`topic:${d.topicId}`, 'topic', d.topicId, {
      document: d,
      navigation: input.book
        ? topicNavigation(input.book, d.topicId)
        : { links: {}, backlinks: {} },
      dependency: dependencyGraph(d.topicId, d.dependencySelection, input.imports.edges),
    });
  }
  add(
    'book',
    'book',
    'book',
    input.book ?? {
      modules: [],
      failures: [],
      journeys: [],
      objects: [],
      runs: [],
      graphs: [],
      edges: [],
      search: [],
      topicInputs: [],
    },
  );
  add('files', 'files', 'files', { files: input.inventory.files });
  add('api', 'api', 'api', {
    ...input.api,
    journeys: (input.book?.journeys ?? []).map((j) => ({
      id: j.id,
      title: j.title,
      entryApis: j.entryApis,
    })),
  });
  const symbols = new Map((input.symbols?.files ?? []).map((f) => [f.path, f.symbols]));
  const publicNames = new Map();
  for (const entry of input.api.entries)
    for (const module of entry.modules)
      for (const symbol of module.exports) {
        for (const path of [module.path, symbol.origin].filter(Boolean)) {
          const names = publicNames.get(path) ?? new Set();
          names.add(symbol.name);
          publicNames.set(path, names);
        }
      }
  add('search', 'search', 'search', {
    entries: input.book?.search ?? [],
    documents: input.documents.map((d) => ({
      topicId: d.topicId,
      title: d.title,
      question: d.question,
      truthKind: d.truthKind,
      text: JSON.stringify(d).toLowerCase(),
    })),
    files: input.inventory.files.map((f) => ({
      path: f.path,
      topicId: f.topicId,
      symbols: symbols.get(f.path) ?? [],
      publicNames: [...(publicNames.get(f.path) ?? [])].sort(),
    })),
  });
  add('impact', 'impact', 'impact', {
    book: input.book ?? null,
    inputs: input.documents.map((d) => ({
      topicId: d.topicId,
      title: d.title,
      paths: [...new Set([...d.sourcePaths, ...d.testPaths, ...d.configPaths])],
    })),
    files: input.inventory.files
      .filter((f) => ['source', 'config', 'test'].includes(f.category))
      .map(({ path, category }) => ({ path, category }))
      .concat(
        input.documents.flatMap((d) =>
          d.consumerRefs.map((c) => ({
            path: `consumer:${c.repository}/${c.path}`,
            category: 'consumer',
          })),
        ),
      ),
    edges: input.imports.edges.map(({ from, to, kind }) => ({ from, to, kind })),
    unknownCount: input.imports.edges.filter((e) => e.kind === 'dynamic-unresolved').length,
  });
  const topics = input.topics.map((t) => ({
    id: t.id,
    title: t.title,
    question: t.question,
    ownedFileCount: t.ownedFileCount,
    path: t.path ?? null,
    reviewDepth: input.documents.find((d) => d.topicId === t.id)?.reviewDepth ?? '未复核',
  }));
  return {
    bootstrap: {
      schemaVersion: 1,
      kind: 'core-atlas-bootstrap',
      summary: input.summary,
      review: input.review,
      topics,
      assets: refs,
    },
    assets,
  };
}

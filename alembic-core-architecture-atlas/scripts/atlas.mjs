import {
  readReviewRecords,
  selectFileReview,
  assertAppendOnly,
  projectFileReview,
} from './reviews.mjs';
import {
  bookProjection,
  writeBook,
  journeys,
  coreObjects,
  markdownNavigation,
  writeReadingProjections,
  checkReadingProjections,
} from './book.mjs';
import { validateDeepContent } from '../src/deep-content.ts';
import { readFileSync, writeFileSync, existsSync, mkdirSync, globSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import Ajv from 'ajv';
import { analyze, inspectEvidence, inspectSourceAnchor } from './analysis.mjs';
import {
  snapshot,
  sha,
  safeFile,
  inventoryDiff,
  inheritedReview,
  freshness,
  validateGraph,
  validateReceipt,
  validateReaderReceipt,
  validateIsolation,
  provenanceStatus,
  slugHeadings,
  markdownLinks,
  checkHeading,
} from './contracts.mjs';
import { mermaidSource, dependencyGraph } from '../src/graph-model.ts';
import {
  graphMarkdown,
  fileIndexMarkdown,
  registerMarkdown,
  generatedStart,
} from './projections.mjs';
import {
  stampObservation,
  writeIfChanged,
  ownershipErrors,
  readPinnedReview,
} from './snapshot-state.mjs';
import { renderConfig } from '../src/render-config.ts';
export const atlas = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  core = resolve(atlas, '..'),
  ledger = resolve(core, '../wakeflow-ledger/AlembicCore');
const getJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const readData = (name) => getJSON(resolve(atlas, 'data', name + '.json'));
export const writeData = (name, value) =>
  writeIfChanged(resolve(atlas, 'data', name + '.json'), JSON.stringify(value, null, 2) + '\n');
const origin = 'code-review-2026-10-22/file-review.json';
export const commit = () =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: core, encoding: 'utf8' }).trim();
export function productPaths() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: core,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((p) => p && !p.startsWith('alembic-core-architecture-atlas/') && p !== 'AlembicCore')
    .sort();
}
const category = (p) =>
  p.startsWith('src/')
    ? 'source'
    : p.startsWith('test/')
      ? 'test'
      : p.startsWith('scripts/')
        ? 'script'
        : p.startsWith('resources/')
          ? 'resource'
          : p.startsWith('config/')
            ? 'config'
            : 'support';
export function documents() {
  return globSync('maps/**/*.md', { cwd: atlas })
    .sort()
    .flatMap((path) => {
      const raw = readFileSync(resolve(atlas, path), 'utf8');
      if (!raw.startsWith('---\n')) return [];
      const end = raw.indexOf('\n---\n', 4);
      if (end < 0) throw new Error(`invalid-frontmatter:${path}`);
      const doc = YAML.parse(raw.slice(4, end), { uniqueKeys: true });
      if (!doc || typeof doc !== 'object') throw new Error(`invalid-frontmatter:${path}`);
      return [
        {
          ...doc,
          path,
          body: raw
            .slice(end + 5)
            .split(generatedStart)[0]
            .trim(),
        },
      ];
    });
}
export function contextDigest(doc) {
  const local = snapshot(core, [...doc.testPaths, ...doc.configPaths]);
  const consumers = doc.consumerRefs
    .map((c) => {
      if (
        !['Alembic', 'AlembicPlugin', 'AlembicAgent', 'AlembicDashboard', 'AlembicBook'].includes(
          c.repository,
        )
      )
        throw new Error(`consumer-root:${c.repository}`);
      return {
        repository: c.repository,
        path: c.path,
        sha256: sha(readFileSync(safeFile(resolve(core, '..', c.repository), c.path))),
      };
    })
    .sort((a, b) => (a.repository + a.path).localeCompare(b.repository + b.path));
  return sha(JSON.stringify({ algorithm: 'context-v1', local: local.digest, consumers }));
}
export function observedInputs(doc) {
  if (['historical', 'target-design'].includes(doc.truthKind))
    return { status: doc.truthKind, source: null, context: null };
  let source, context;
  try {
    source = snapshot(core, doc.sourcePaths).digest;
  } catch (error) {
    source = `unavailable:${error.code ?? 'source-input'}`;
  }
  try {
    context = contextDigest(doc);
  } catch (error) {
    context = `unavailable:${error.code ?? 'context-input'}`;
  }
  const status = source.startsWith('unavailable:')
    ? source
    : context.startsWith('unavailable:')
      ? context
      : freshness(
          {
            truthKind: doc.truthKind,
            source: doc.sourceFingerprint,
            context: doc.contextFingerprint,
          },
          { source, context },
        );
  return { status, source, context };
}
export function observedDoc(doc) {
  return observedInputs(doc).status;
}
export function inputObservation(
  docs = documents(),
  productDigest = snapshot(core, productPaths()).digest,
) {
  return {
    productDigest,
    documents: docs.map((d) => ({ path: d.path, topicId: d.topicId, ...observedInputs(d) })),
  };
}
function symbolsFor(analysis) {
  return {
    files: [...analysis.declarations].map(([path, names]) => ({
      path,
      symbols: [...names].sort(),
    })),
  };
}

export function allGraphs(docs, imports) {
  return docs.flatMap((d) => {
    const dep = dependencyGraph(d.topicId, d.dependencySelection, imports);
    return [...d.diagrams, ...(dep ? [dep] : [])].map((g) => ({
      ...g,
      document: d.path,
      topicId: d.topicId,
    }));
  });
}
export function rendererIdentity() {
  const pkg = getJSON(resolve(atlas, 'node_modules/mermaid/package.json'));
  const paths = [
    'src/renderer.ts',
    'src/graph-model.ts',
    'src/render-config.ts',
    'src/verify.ts',
    'src/content.ts',
    'package-lock.json',
  ];
  return {
    renderer: pkg.version,
    configDigest: sha(JSON.stringify(renderConfig)),
    harnessDigest: snapshot(atlas, paths).digest,
  };
}
export function renderExpected() {
  const graphs = allGraphs(documents(), readData('import-graph').edges);
  return {
    ...rendererIdentity(),
    diagrams: graphs
      .map((g) => ({ id: g.id, digest: sha(mermaidSource(g)) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function readerIdentity() {
  const paths = globSync('{src,schemas}/**/*.ts', { cwd: atlas }).concat(
    globSync('src/**/*.css', { cwd: atlas }),
    [
      'index.html',
      'site.config.ts',
      'vite.config.ts',
      'package-lock.json',
      'scripts/browser-assets.mjs',
      'scripts/browser-plugin.mjs',
    ],
  );
  const docs = globSync('{maps,journeys,objects}/**/*.md', { cwd: atlas });
  return {
    uiDigest: snapshot(atlas, paths).digest,
    inputObservationDigest: sha(JSON.stringify(inputObservation())),
    contentDigest: snapshot(atlas, [
      ...docs,
      'data/source-inventory.json',
      'data/import-graph.json',
      'data/public-api.json',
      'data/documents.json',
      'data/topic-index.json',
      'data/validation-summary.json',
      'data/review-summary.json',
      'data/known-risks.json',
      'data/tool-versions.json',
      'data/source-symbols.json',
      'data/book-index.json',
      'reviews/records.json',
      'evidence/scenarios.json',
    ]).digest,
  };
}
function publicAPI(analysis, paths) {
  const pkg = getJSON(resolve(core, 'package.json')),
    policy = getJSON(resolve(core, 'config/public-api-boundary.json'));
  return {
    policyPath: 'config/public-api-boundary.json',
    policySha256: sha(readFileSync(resolve(core, 'config/public-api-boundary.json'))),
    entries: Object.entries(pkg.exports).map(([name, value]) => {
      const target = (typeof value === 'string' ? value : value.import)
        .replace(/^\.\/dist\//, 'src/')
        .replace(/\.js$/, '.ts');
      const match = target.includes('*')
        ? paths.filter((p) =>
            new RegExp(
              '^' +
                target
                  .split('*')
                  .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  .join('.*') +
                '$',
            ).test(p),
          )
        : [target];
      return {
        name,
        policy: policy.stablePublicExports.includes(name)
          ? 'stable-public'
          : policy.provisionalPublicExports.includes(name)
            ? 'provisional-public'
            : name.includes('*')
              ? policy.wildcardExportStatus
              : policy.transitionalInternalExports.includes(name)
                ? 'transitional-internal'
                : 'unclassified',
        target,
        modules: match.map((path) => ({ path, exports: analysis.exportsFor(path) })),
      };
    }),
  };
}
function loadAnalysis(paths) {
  return analyze(
    core,
    paths.filter((p) => /\.(ts|mjs)$/.test(p)),
  );
}
export function inventory(write = false) {
  const paths = productPaths(),
    snap = snapshot(core, paths),
    ownership = readData('topic-ownership');
  const reviewIndex = getJSON(resolve(atlas, 'reviews/records.json'));
  const reviewHistory = existsSync(resolve(atlas, 'data/review-summary.json'))
    ? (readData('review-summary').recordHistory ?? [])
    : [];
  assertAppendOnly(reviewHistory, reviewIndex);
  const addedReviews = readReviewRecords(ledger, reviewIndex);
  const current = existsSync(resolve(atlas, 'data/source-inventory.json'))
    ? readData('source-inventory')
    : null;
  const priorFile = resolve(ledger, origin),
    expectedReviewHash = readData('provenance-inputs').find((p) => p.path === origin)?.sha256;
  const prior = readPinnedReview(priorFile, expectedReviewHash);
  const priorMap = new Map(prior.map((f) => [f.path, f])),
    owners = new Map(ownership.assignments.map((a) => [a.path, a.topicId]));
  const files = snap.files.map((f) => ({
    ...f,
    category: category(f.path),
    topicId: owners.get(f.path) ?? null,
    ...projectFileReview(priorMap.get(f.path), f.sha256, f.path, origin, addedReviews),
  }));
  if (!write) {
    if (!current) return { errors: ['missing-inventory'] };
    const diff = inventoryDiff(current.files, snap.files);
    const errors = Object.values(diff).some((a) => a.length) ? ['inventory-drift'] : [];
    if (JSON.stringify(current.files) !== JSON.stringify(files))
      errors.push('derived-drift:file-review-projection');
    if (JSON.stringify(reviewHistory) !== JSON.stringify(reviewIndex))
      errors.push('derived-drift:review-history');
    const analysis = loadAnalysis(paths);
    for (const [name, value] of [
      ['import-graph', { edges: analysis.imports }],
      ['public-api', publicAPI(analysis, paths)],
      ['source-symbols', symbolsFor(analysis)],
      ['documents', documents().map((d) => ({ ...d, freshness: observedDoc(d) }))],
      [
        'topic-index',
        ownership.topics.map((t) => ({
          ...t,
          ownedFileCount: ownership.assignments.filter((a) => a.topicId === t.id).length,
          path: documents().find((d) => d.topicId === t.id)?.path ?? null,
        })),
      ],
    ])
      if (JSON.stringify(readData(name)) !== JSON.stringify(value))
        errors.push(`derived-drift:${name}`);
    const book = bookProjection(documents(), publicAPI(analysis, paths), snap.digest);
    errors.push(...book.errors);
    if (JSON.stringify(readData('book-index')) !== JSON.stringify(book.index))
      errors.push('derived-drift:book-index');
    const expectedView = sha(
      JSON.stringify({
        documents: readData('documents'),
        topics: readData('topic-index'),
        review: readData('review-summary'),
        versions: readData('tool-versions'),
        book: book.index,
      }),
    );
    const states = documents().map((d) => ({
      path: d.path,
      topicId: d.topicId,
      status: observedDoc(d),
    }));
    const projection = readData('validation-summary');
    if (
      projection.viewDigest !== expectedView ||
      JSON.stringify(projection.documents) !== JSON.stringify(states) ||
      projection.sourceDigest !== snap.digest ||
      projection.inputObservationDigest !==
        sha(JSON.stringify(inputObservation(documents(), snap.digest))) ||
      projection.fileCount !== paths.length ||
      projection.atlasVersion !== getJSON(resolve(atlas, 'package.json')).version ||
      projection.journeyCount !== book.index.journeys.length ||
      projection.objectCount !== book.index.objects.length ||
      projection.moduleCount !== book.index.modules.length ||
      projection.failureCount !== book.index.failures.length ||
      projection.documentCount !== states.length ||
      projection.diagramCount !== allGraphs(documents(), analysis.imports).length
    )
      errors.push('derived-drift:validation-summary');
    if (
      readData('review-summary').productTests.status !== 'inherited-not-rerun' ||
      JSON.stringify(readData('review-summary').knownRisks) !==
        JSON.stringify(readData('known-risks'))
    )
      errors.push('derived-drift:review-summary');
    for (const [name, version] of Object.entries(readData('tool-versions')))
      if (getJSON(resolve(atlas, 'node_modules', name, 'package.json')).version !== version)
        errors.push(`tool-version-drift:${name}`);
    return {
      errors: [...errors, ...ownershipErrors(paths, ownership.assignments, documents())],
      diff,
      files: paths.length,
    };
  }
  const analysis = loadAnalysis(paths);
  writeData('source-inventory', {
    algorithm: snap.algorithm,
    digest: snap.digest,
    baselineCommit: current?.digest === snap.digest ? current.baselineCommit : commit(),
    files,
  });
  writeData('import-graph', { edges: analysis.imports });
  writeData('public-api', publicAPI(analysis, paths));
  writeData('source-symbols', symbolsFor(analysis));
  const priorSummary = existsSync(resolve(atlas, 'data/review-summary.json'))
    ? readData('review-summary')
    : null;
  writeData('review-summary', {
    origin,
    originSha256: expectedReviewHash,
    recordHistory: reviewIndex,
    appendedReviews: addedReviews.map((r) => ({
      id: r.id,
      path: r.path,
      sourceSha256: r.sourceSha256,
      scope: r.scope,
      readLevel: r.readLevel,
      reviewedAt: r.reviewedAt,
      method: r.method,
      rawLedgerRef: r.rawLedgerRef,
    })),
    originalAvailability: existsSync(priorFile) ? 'matched' : 'original-unavailable',
    method: '继承逐文件阅读；本轮逐边复核另见各页。full/partial保持原义，不代表本轮产品测试执行。',
    reviewedAt: '2026-10-22',
    counts: files.reduce((a, f) => ((a[f.reviewStatus] = (a[f.reviewStatus] ?? 0) + 1), a), {}),
    productTests: {
      status: 'inherited-not-rerun',
      origin: 'code-review-2026-10-22/README.md',
      summary: '原全量基线：2605 pass、1 skip；未重跑全量。选定场景的独立执行见运行证据页。',
    },
    knownRisks: readData('known-risks'),
  });
  const docs = documents(),
    topicIndex = ownership.topics.map((t) => ({
      ...t,
      ownedFileCount: ownership.assignments.filter((a) => a.topicId === t.id).length,
      path: docs.find((d) => d.topicId === t.id)?.path ?? null,
    }));
  writeData('topic-index', topicIndex);
  const book = bookProjection(docs, readData('public-api'), snap.digest);
  if (book.errors.length) throw new Error(book.errors.join('\n'));
  writeBook(book.index);
  writeReadingProjections(book.index, docs);
  writeData(
    'documents',
    docs.map((d) => ({ ...d, freshness: observedDoc(d) })),
  );
  for (const d of docs) {
    const file = resolve(atlas, d.path);
    const raw = readFileSync(file, 'utf8').split(generatedStart)[0].trimEnd();
    writeIfChanged(
      file,
      raw + '\n' + graphMarkdown(d, analysis.imports, markdownNavigation(book.index, docs, d.path)),
    );
  }
  writeIfChanged(resolve(atlas, 'maps/01-file-index.md'), fileIndexMarkdown(files));
  writeIfChanged(
    resolve(atlas, 'maps/02-diagram-register.md'),
    registerMarkdown(allGraphs(docs, analysis.imports)),
  );
  const versions = Object.fromEntries(
    [
      'mermaid',
      'cytoscape',
      'cytoscape-elk',
      'elkjs',
      'typescript',
      'vite',
      'marked',
      'dompurify',
      'yaml',
    ].map((p) => [p, getJSON(resolve(atlas, 'node_modules', p, 'package.json')).version]),
  );
  writeData('tool-versions', versions);
  const previousValidation = existsSync(resolve(atlas, 'data/validation-summary.json'))
    ? readData('validation-summary')
    : null;
  const observed = inputObservation(docs, snap.digest);
  const viewDigest = sha(
    JSON.stringify({
      documents: readData('documents'),
      topics: topicIndex,
      review: readData('review-summary'),
      versions,
      book: book.index,
    }),
  );
  writeData(
    'validation-summary',
    stampObservation(previousValidation, {
      inputObservationDigest: sha(JSON.stringify(observed)),
      viewDigest,
      baselineCommit: current?.digest === snap.digest ? current.baselineCommit : commit(),
      sourceDigest: snap.digest,
      scope: '静态来源快照；不代表产品测试重跑或实时工作树状态',
      sourceCount: files.filter((f) => f.category === 'source').length,
      fileCount: files.length,
      ownershipCount: owners.size,
      apiCount: Object.keys(getJSON(resolve(core, 'package.json')).exports).length,
      documentCount: docs.length,
      atlasVersion: getJSON(resolve(atlas, 'package.json')).version,
      journeyCount: book.index.journeys.length,
      objectCount: book.index.objects.length,
      runCount: book.index.runs.length,
      moduleCount: docs.reduce((count, d) => count + (d.moduleDetails?.length ?? 0), 0),
      failureCount: docs.reduce((count, d) => count + (d.failureModes?.length ?? 0), 0),
      diagramCount: allGraphs(docs, analysis.imports).length,
      documents: docs.map((d) => ({ path: d.path, topicId: d.topicId, status: observedDoc(d) })),
      originalAvailability: existsSync(priorFile) ? 'matched' : 'original-unavailable',
    }),
  );
  return { errors: [], files: paths.length, documents: docs.length, ownership: owners.size };
}
export function structure() {
  const errors = [],
    paths = productPaths(),
    analysis = loadAnalysis(paths),
    docs = documents(),
    ownership = readData('topic-ownership');
  const schema = new Ajv({ allErrors: true }).compile(
    getJSON(resolve(atlas, 'schemas/document.schema.json')),
  );
  const graphIds = new Set(),
    topicIds = new Set();
  for (const d of docs) {
    if (!schema(d)) {
      errors.push(`${d.path}:schema:${JSON.stringify(schema.errors)}`);
      continue;
    }
    if (topicIds.has(d.topicId)) errors.push(`duplicate-topic:${d.topicId}`);
    topicIds.add(d.topicId);
    if (!/[\u3400-\u9fff]/.test(d.title) || !/[\u3400-\u9fff]/.test(d.body))
      errors.push(`${d.path}:missing-chinese-explanation`);
    if (d.truthKind !== 'historical' && d.truthKind !== 'target-design')
      for (const path of [...d.sourcePaths, ...d.testPaths, ...d.configPaths])
        try {
          safeFile(core, path);
        } catch {
          errors.push(`${d.path}:missing-input:${path}`);
        }
    const archived = ['historical', 'target-design'].includes(d.truthKind);
    errors.push(...validateDeepContent(d).map((error) => `${d.path}:${error}`));
    if (!archived) {
      const anchors = [
        ...(d.moduleDetails ?? []).map((m) => m.entry),
        ...(d.failureModes ?? []).map((f) => f.source),
      ];
      for (const anchor of anchors) {
        if (!anchor) continue;
        if (!d.sourcePaths.includes(anchor.path))
          errors.push(`${d.path}:deep-undeclared-source:${anchor.path}`);
        errors.push(
          ...inspectSourceAnchor(analysis, anchor).map(
            (error) => `${d.path}:${anchor.symbol}:${error}`,
          ),
        );
      }
      for (const f of d.failureModes ?? []) {
        if (f.test.path && !d.testPaths.includes(f.test.path))
          errors.push(`${d.path}:deep-undeclared-test:${f.test.path}`);
        errors.push(
          ...inspectEvidence(analysis, f.test).map((error) => `${d.path}:${f.id}:${error}`),
        );
      }
    }

    for (const g of d.diagrams) {
      if (graphIds.has(g.id)) errors.push(`duplicate-graph:${g.id}`);
      graphIds.add(g.id);
      errors.push(...validateGraph(g).map((e) => `${g.id}:${e}`));
      if (g.nodes.length > 15 || g.edges.length > 20) errors.push(`${g.id}:split-required`);
      if (archived) continue;
      for (const n of g.nodes)
        if (n.path) {
          try {
            safeFile(core, n.path);
          } catch {
            errors.push(`${g.id}:node-path:${n.path}`);
          }
          if (
            n.symbol &&
            !analysis.declarations.get(n.path)?.has(n.symbol) &&
            !analysis.exportsFor(n.path).some((e) => e.name === n.symbol)
          )
            errors.push(`${g.id}:node-symbol:${n.path}#${n.symbol}`);
        }
      for (const e of g.edges) {
        if (!e.source) continue;
        const { path, symbol, excerpt } = e.source;
        let raw = '';
        try {
          raw = readFileSync(safeFile(core, path), 'utf8');
        } catch {
          errors.push(`${g.id}/${e.id}:source-path:${path}`);
        }
        if (!d.sourcePaths.includes(path)) errors.push(`${g.id}/${e.id}:undeclared-source-input`);
        if (e.test.path && !d.testPaths.includes(e.test.path))
          errors.push(`${g.id}/${e.id}:undeclared-test-input`);
        if (!raw.includes(excerpt)) errors.push(`${g.id}/${e.id}:source-excerpt`);
        errors.push(...inspectSourceAnchor(analysis, e.source).map((x) => `${g.id}/${e.id}:${x}`));
        if (
          symbol !== '<module>' &&
          !analysis.declarations.get(path)?.has(symbol) &&
          !analysis.exportsFor(path).some((e) => e.name === symbol)
        )
          errors.push(`${g.id}/${e.id}:source-symbol:${symbol}`);
        errors.push(...inspectEvidence(analysis, e.test).map((x) => `${g.id}/${e.id}:${x}`));
      }
    }
    if (archived) continue;
    for (const c of d.consumerRefs) {
      try {
        const raw = readFileSync(safeFile(resolve(core, '..', c.repository), c.path), 'utf8');
        if (!raw.includes(c.excerpt)) errors.push(`${d.path}:consumer-excerpt:${c.path}`);
      } catch {
        errors.push(`${d.path}:consumer-unavailable:${c.repository}/${c.path}`);
      }
    }
  }
  for (const t of ownership.topics) if (!topicIds.has(t.id)) errors.push(`missing-topic:${t.id}`);
  const owned = ownership.assignments.map((a) => a.path);
  if (new Set(owned).size !== owned.length) errors.push('duplicate-ownership');
  for (const path of paths.filter(
    (p) =>
      p.startsWith('src/') ||
      (p.startsWith('scripts/') && p.endsWith('.mjs')) ||
      p === 'resources/codegraph/native-worker.mjs',
  ))
    if (!owned.includes(path)) errors.push(`missing-owner:${path}`);
  for (const a of ownership.assignments)
    if (!paths.includes(a.path) || !topicIds.has(a.topicId)) errors.push(`invalid-owner:${a.path}`);
  const api = readData('public-api');
  const book = bookProjection(docs, api, readData('source-inventory').digest);
  for (const entry of api.entries)
    if (
      !entry.modules.length ||
      entry.policy === 'unclassified' ||
      entry.modules.some((m) => !paths.includes(m.path))
    )
      errors.push(`public-api:${entry.name}`);
  for (const d of docs) {
    const raw = readFileSync(resolve(atlas, d.path), 'utf8');
    const actual = '\n' + generatedStart + (raw.split(generatedStart)[1] ?? '');
    if (actual !== graphMarkdown(d, analysis.imports, markdownNavigation(book.index, docs, d.path)))
      errors.push(`${d.path}:diagram-table-projection-drift`);
  }
  if (
    readFileSync(resolve(atlas, 'maps/01-file-index.md'), 'utf8') !==
    fileIndexMarkdown(readData('source-inventory').files)
  )
    errors.push('file-index-projection-drift');
  if (
    readFileSync(resolve(atlas, 'maps/02-diagram-register.md'), 'utf8') !==
    registerMarkdown(allGraphs(docs, analysis.imports))
  )
    errors.push('diagram-register-projection-drift');
  errors.push(...book.errors, ...checkReadingProjections(book.index, docs));
  for (const j of book.index.journeys) {
    if (j.freshness !== 'matched') errors.push(`${j.id}:source-drift`);
    for (const step of j.steps)
      errors.push(...inspectSourceAnchor(analysis, step.source).map((e) => `${step.id}:${e}`));
  }
  for (const o of book.index.objects)
    errors.push(...inspectSourceAnchor(analysis, o.source).map((e) => `${o.id}:${e}`));
  errors.push(...documentLinks());
  return {
    errors,
    topics: topicIds.size,
    graphs: graphIds.size,
    edges: docs.flatMap((d) => d.diagrams.flatMap((g) => g.edges)).length,
  };
}
function documentLinks() {
  const errors = [];
  for (const path of globSync('{maps,journeys,objects,evidence}/**/*.md', { cwd: atlas })) {
    const raw = readFileSync(resolve(atlas, path), 'utf8');
    const content = raw.startsWith('---\n') ? raw.slice(raw.indexOf('\n---\n', 4) + 5) : raw;
    for (const href of markdownLinks(content)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [target, anchor] = href.split('#');
      const full = target
        ? resolve(atlas, dirname(path), decodeURIComponent(target))
        : resolve(atlas, path);
      if (!full.startsWith(atlas + '/') || !existsSync(full)) {
        errors.push(`${path}:broken-link:${href}`);
        continue;
      }
      if (anchor && !checkHeading(slugHeadings(readFileSync(full, 'utf8')), anchor))
        errors.push(`${path}:broken-heading:${href}`);
    }
  }
  return errors;
}
export function current() {
  const inv = inventory();
  const docs = documents();
  const states = docs.map((d) => ({ path: d.path, status: observedDoc(d) }));
  return {
    errors: [
      ...inv.errors,
      ...states
        .filter((d) => !['matched', 'historical', 'target-design'].includes(d.status))
        .map((d) => `${d.path}:${d.status}`),
    ],
    diff: inv.diff,
    documents: states,
  };
}
export function provenance() {
  const inputs = [
    ...readData('provenance-inputs'),
    ...getJSON(resolve(atlas, 'reviews/records.json')).map((r) => ({
      path: r.path,
      sha256: r.sha256,
    })),
  ];
  const records = inputs.map((input) => {
    let actual = null;
    try {
      actual = sha(readFileSync(safeFile(ledger, input.path)));
    } catch {}
    return { ...input, status: provenanceStatus(actual, input.sha256) };
  });
  return {
    errors: records
      .filter((r) => r.status !== 'matched')
      .map((r) => `provenance:${r.path}:${r.status}`),
    records,
  };
}

export function isolation() {
  const boundary = readData('product-boundary');
  const pkg = getJSON(resolve(core, 'package.json'));
  const errors = validateIsolation(
    pkg,
    getJSON(resolve(core, 'tsconfig.json')),
    boundary.package,
    boundary.tsconfig,
  );
  const changed = execFileSync('git', ['diff', '--name-only'], { cwd: core, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(
      (p) =>
        !p.startsWith('alembic-core-architecture-atlas/') &&
        !['README.md', 'README.zh-CN.md'].includes(p),
    );
  if (changed.length) errors.push(`outside-scope-diff:${changed.join(',')}`);
  return { errors, corePackageUnchanged: !errors.length, rootNodeEngine: pkg.engines.node };
}
export function checkRender() {
  return {
    errors: validateReceipt(
      existsSync(resolve(atlas, 'data/render-receipt.json')) ? readData('render-receipt') : null,
      renderExpected(),
    ),
    scope: '复验已有实际浏览器回执；不代表此命令重渲染',
  };
}
export function checkReader() {
  const receipt = existsSync(resolve(atlas, 'data/reader-receipt.json'))
    ? readData('reader-receipt')
    : null;
  return {
    errors: validateReaderReceipt(receipt, readerIdentity()),
    scope: '代表页面交互回执，独立于Mermaid渲染',
  };
}

export function run(command, write = false) {
  if (command === 'evidence') {
    const runs = bookProjection(
      documents(),
      readData('public-api'),
      snapshot(core, productPaths()).digest,
    ).index.runs;
    return {
      errors: runs
        .filter((r) => r.status !== 'passed')
        .map((r) => `${r.id}:${r.status}:${r.verification}`),
      scenarios: runs.map((r) => ({ id: r.id, status: r.status, cases: r.cases?.length ?? 0 })),
      scope: '仅核验所列实际运行原材料及当前输入身份，不执行测试',
    };
  }
  if (command === 'inventory') return inventory(write);
  if (command === 'structure') return structure();
  if (command === 'current') return current();
  if (command === 'provenance') return provenance();
  if (command === 'isolation') return isolation();
  if (command === 'render') return checkRender();
  if (command === 'reader') return checkReader();
  throw new Error(`unknown-command:${command}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = run(process.argv[2], process.argv.includes('--write'));
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (e) {
    console.error(JSON.stringify({ errors: [e.message] }));
    process.exitCode = 1;
  }
}

import { marked } from 'marked';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, globSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const stable = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());
export const truthKinds = [
  'current-code',
  'in-progress-worktree',
  'historical',
  'target-design',
  'stale',
];
// 路径身份参与摘要；逐段拒绝软链接，不能借自指链接无限扩大扫描根。
export function safeFile(root, path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..'))
    throw new Error(`unsafe-path:${path}`);
  const full = resolve(root, path);
  const rel = relative(resolve(root), full);
  if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`outside-root:${path}`);
  let part = resolve(root);
  for (const bit of rel.split(sep)) {
    part = resolve(part, bit);
    if (lstatSync(part).isSymbolicLink()) throw new Error(`symlink:${path}`);
  }
  if (!lstatSync(full).isFile()) throw new Error(`not-file:${path}`);
  return full;
}
export function snapshot(root, patterns) {
  if (!patterns.length) throw new Error('empty-inputs');
  const paths = new Set();
  for (const pattern of patterns) {
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..'))
      throw new Error(`unsafe-pattern:${pattern}`);
    const matches = /[*?\[]/.test(pattern)
      ? globSync(pattern, { cwd: root, exclude: ['**/node_modules/**', '**/.git/**'] })
      : [pattern];
    if (!matches.length) throw new Error(`empty-glob:${pattern}`);
    for (const path of matches) {
      safeFile(root, path);
      paths.add(path.replaceAll('\\', '/'));
    }
  }
  const sorted = [...paths].sort();
  const h = createHash('sha256');
  h.update('alembic-atlas-path-bytes-v1\0');
  const files = sorted.map((path) => {
    const raw = readFileSync(safeFile(root, path));
    const name = Buffer.from(path);
    for (const data of [name, raw]) {
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(data.length));
      h.update(length);
      h.update(data);
    }
    return { path, sha256: sha(raw), bytes: raw.length };
  });
  return {
    algorithm: 'alembic-atlas-path-bytes-v1',
    digest: h.digest('hex'),
    paths: sorted,
    files,
  };
}
export function inventoryDiff(before, after) {
  const a = new Map(before.map((x) => [x.path, x.sha256])),
    b = new Map(after.map((x) => [x.path, x.sha256]));
  return {
    added: [...b.keys()].filter((x) => !a.has(x)).sort(),
    removed: [...a.keys()].filter((x) => !b.has(x)).sort(),
    changed: [...a.keys()].filter((x) => b.has(x) && a.get(x) !== b.get(x)).sort(),
  };
}
export function inheritedReview(prior, current, origin) {
  return prior
    ? {
        status: prior.sha256 === current ? 'inherited' : 'source-changed',
        readLevel: prior.readLevel,
        method: prior.method ?? 'prior-file-reading',
        reviewedAt: prior.reviewedAt ?? '2026-10-22',
        origin,
        originalSourceSha256: prior.sha256,
      }
    : { status: 'unreviewed', readLevel: 'none', origin };
}
export function freshness(declared, observed) {
  if (!truthKinds.includes(declared.truthKind)) throw new Error('unknown-truth-kind');
  if (['historical', 'target-design', 'stale'].includes(declared.truthKind))
    return declared.truthKind;
  if (declared.source !== observed.source) return 'source-drift';
  if (declared.context !== observed.context) return 'context-drift';
  return 'matched';
}
export const provenanceStatus = (actual, expected) =>
  actual === null ? 'original-unavailable' : actual === expected ? 'matched' : 'mismatch';
export function validateGraph(g) {
  const errors = [];
  if (!g.id || !g.title || !g.description || !g.nodes?.length || !g.edges?.length)
    return ['incomplete-graph'];
  const ids = new Set();
  for (const n of g.nodes) {
    if (!n.id || ids.has(n.id)) errors.push('node-id');
    ids.add(n.id);
    if (!n.label || !n.role) errors.push('node-metadata');
  }
  const edges = new Set();
  for (const e of g.edges) {
    if (!e.id || edges.has(e.id) || ids.has(e.id)) errors.push('edge-id');
    edges.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to)) errors.push('edge-endpoint');
    if (!e.source?.path || !e.source?.symbol || !e.source?.excerpt) errors.push('edge-source');
    const t = e.test;
    if (!t || !['direct', 'indirect', 'none'].includes(t.relation)) errors.push('test-relation');
    else if (t.relation === 'none') {
      if (!t.reason) errors.push('uncovered-reason');
    } else if (
      !t.path ||
      !t.caseTitle ||
      !t.anchorSymbol ||
      !t.assertedBehavior ||
      !t.assertionExcerpt ||
      !t.scenarioKind
    )
      errors.push('test-anchor');
  }
  return errors;
}
export function projectGraph(g) {
  const errors = validateGraph(g);
  if (errors.length) throw new Error(errors.join(','));
  return { nodes: g.nodes.map((n) => ({ ...n })), edges: g.edges.map((e) => ({ ...e })) };
}
export function markdownLinks(md) {
  const links = [];
  marked.walkTokens(marked.lexer(md), (token) => {
    if (token.type === 'link') links.push(token.href);
  });
  return links;
}
export function slugHeadings(md) {
  const seen = new Map(),
    ids = [];
  marked.walkTokens(marked.lexer(md), (token) => {
    if (token.type === 'html')
      ids.push(...[...token.text.matchAll(/<a id="([^"]+)"/g)].map((m) => m[1]));
    if (token.type !== 'heading') return;
    const base = token.text
      .trim()
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.push(base + (n ? `-${n}` : ''));
  });
  return ids;
}
export const checkHeading = (slugs, anchor) => slugs.includes(decodeURIComponent(anchor));
export function validateSvgObservation(o) {
  return !o ||
    !Number.isInteger(o.svgBytes) ||
    o.svgBytes < 100 ||
    !Number.isFinite(o.width) ||
    !Number.isFinite(o.height) ||
    o.width <= 0 ||
    o.height <= 0 ||
    !Array.isArray(o.missingLabels) ||
    o.missingLabels.length
    ? ['invalid-svg-observation']
    : [];
}
export function validateReceipt(receipt, expected) {
  if (!receipt) return ['missing-render-receipt'];
  const errors = [];
  for (const key of ['renderer', 'configDigest', 'harnessDigest'])
    if (receipt[key] !== expected[key]) errors.push(`render-drift:${key}`);
  if (JSON.stringify(receipt.diagrams) !== JSON.stringify(expected.diagrams))
    errors.push('diagram-digest-mismatch');
  if (
    typeof receipt.browser !== 'string' ||
    receipt.browser.length < 5 ||
    !Number.isInteger(receipt.viewport?.width) ||
    receipt.viewport.width <= 0 ||
    !Number.isInteger(receipt.viewport?.height) ||
    receipt.viewport.height <= 0 ||
    !['light', 'dark'].includes(receipt.theme) ||
    typeof receipt.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    errors.push('missing-browser-environment');
  if (receipt.observations?.length !== expected.diagrams.length)
    errors.push('incomplete-observations');
  for (const d of expected.diagrams) {
    const rows = receipt.observations?.filter((x) => x.id === d.id) ?? [];
    if (rows.length !== 1 || validateSvgObservation(rows[0]).length)
      errors.push(`invalid-render:${d.id}`);
  }
  return errors;
}
export function validateIsolation(pkg, tsconfig, baseline, baselineTsconfig) {
  const errors = [];
  for (const key of [
    'exports',
    'files',
    'scripts',
    'dependencies',
    'devDependencies',
    'workspaces',
  ])
    if (JSON.stringify(pkg[key]) !== JSON.stringify(baseline[key]))
      errors.push(`root-package-changed:${key}`);
  if (
    pkg.workspaces ||
    pkg.files?.some((x) => x.includes('atlas') || x.includes('*')) ||
    JSON.stringify(pkg).includes('core-architecture-atlas')
  )
    errors.push('atlas-enters-package');
  if (JSON.stringify(tsconfig.include) !== JSON.stringify(['src/**/*.ts']))
    errors.push('root-tsconfig-expanded');
  if (
    tsconfig.files ||
    tsconfig.references ||
    tsconfig.extends ||
    JSON.stringify(tsconfig).includes('architecture-atlas') ||
    (baselineTsconfig && JSON.stringify(tsconfig) !== JSON.stringify(baselineTsconfig))
  )
    errors.push('root-tsconfig-changed');
  return errors;
}
export const readerChecks = [
  'navigation',
  'search-chinese',
  'search-path',
  'search-symbol',
  'evidence',
  'copy-locator',
  'diagram-read-fit',
  'fullscreen',
  'theme',
  'history',
  'none-status',
  'stale-status',
  'cytoscape-counts',
  'back-forward',
  'deep-link',
  'responsive',
  'mobile-menu',
  'keyboard',
];
export function validateReaderReceipt(receipt, expected) {
  if (!receipt) return ['missing-reader-receipt'];
  const errors = [];
  for (const key of Object.keys(expected))
    if (receipt[key] !== expected[key]) errors.push(`reader-drift:${key}`);
  if (
    typeof receipt.browser !== 'string' ||
    !receipt.browser ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    errors.push('reader-environment');
  if (!Array.isArray(receipt.samples) || !receipt.samples.length)
    return [...errors, 'missing-reader-samples'];
  for (const sample of receipt.samples)
    if (
      !sample.page ||
      !Array.isArray(sample.checks) ||
      !sample.checks.length ||
      sample.checks.some((c) => c.passed !== true || typeof c.id !== 'string' || !c.observation)
    )
      errors.push('incomplete-reader-observation');
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ])
    if (!receipt.samples.some((s) => s.viewport?.width === width && s.viewport?.height === height))
      errors.push(`missing-viewport:${width}x${height}`);
  const observed = new Set(
    receipt.samples
      .flatMap((s) => s.checks ?? [])
      .filter((c) => c.passed === true)
      .map((c) => c.id),
  );
  for (const id of readerChecks) if (!observed.has(id)) errors.push(`missing-reader-check:${id}`);
  return errors;
}

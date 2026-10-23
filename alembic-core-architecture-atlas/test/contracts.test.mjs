import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  snapshot,
  inventoryDiff,
  inheritedReview,
  freshness,
  validateGraph,
  validateReceipt,
  validateSvgObservation,
  projectGraph,
  validateIsolation,
  slugHeadings,
  checkHeading,
  provenanceStatus,
  validateReaderReceipt,
} from '../scripts/contracts.mjs';
const fixture = (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
test('B01 阅读继承保留原级别；原记录hash不一致不可继承', () => {
  const prior = { sha256: 'a', readLevel: 'partial', method: 'source-read', reviewedAt: 'old' };
  assert.equal(inheritedReview(prior, 'a', 'origin').readLevel, 'partial');
  assert.equal(inheritedReview(prior, 'b', 'origin').status, 'source-changed');
});
test('B02–B04 字节变化、上下文变化、同字节rename与新增删除都可见', () =>
  fixture((root) => {
    writeFileSync(join(root, 'a.ts'), 'one');
    writeFileSync(join(root, 'test.ts'), 'test');
    const a = snapshot(root, ['a.ts']);
    const context = snapshot(root, ['test.ts']);
    writeFileSync(join(root, 'a.ts'), 'two');
    assert.notEqual(snapshot(root, ['a.ts']).digest, a.digest);
    assert.equal(
      freshness(
        { truthKind: 'current-code', source: a.digest, context: context.digest },
        { source: a.digest, context: 'changed' },
      ),
      'context-drift',
    );
    assert.equal(
      freshness(
        { truthKind: 'current-code', source: a.digest, context: context.digest },
        { source: 'changed', context: context.digest },
      ),
      'source-drift',
    );
    assert.deepEqual(
      inventoryDiff([{ path: 'a', sha256: 'same' }], [{ path: 'b', sha256: 'same' }]),
      { added: ['b'], removed: ['a'], changed: [] },
    );
  }));
test('B05 路径逃逸、空glob、symlink与缺文件明确拒绝', () =>
  fixture((root) => {
    writeFileSync(join(root, 'a.ts'), 'x');
    symlinkSync(root, join(root, 'self'));
    for (const paths of [['../outside'], ['*.nope'], ['self/a.ts'], ['absent.ts'], []])
      assert.throws(() => snapshot(root, paths));
    assert.equal(snapshot(root, ['*.ts']).paths.length, 1);
  }));
const graph = () => ({
  id: 'g',
  title: '调用',
  description: '真实调用证据',
  viewType: 'F1',
  nodes: [
    { id: 'a', label: '入口', role: 'entry' },
    { id: 'b', label: '输出', role: 'store' },
  ],
  edges: [
    {
      id: 'e',
      from: 'a',
      to: 'b',
      label: '调用',
      kind: 'call',
      source: { path: 'src/a.ts', symbol: 'run', excerpt: 'save()' },
      test: { relation: 'none', reason: '没有对应断言' },
    },
  ],
});
test('B11 边缺失、重复ID、引用错误和伪测试都失败；none保持未覆盖', () => {
  assert.deepEqual(validateGraph(graph()), []);
  for (const change of [
    (g) => g.edges.push(g.edges[0]),
    (g) => delete g.edges[0].id,
    (g) => (g.edges[0].to = 'absent'),
    (g) => delete g.edges[0].source,
    (g) => (g.edges[0].test = { relation: 'none' }),
  ]) {
    const g = graph();
    change(g);
    assert.ok(validateGraph(g).length);
  }
});
test('B12 锚点检查遵守重复标题slug', () => {
  const slugs = slugHeadings('# 页面\n## 流程\n## 流程\n');
  assert.deepEqual(slugs, ['页面', '流程', '流程-1']);
  assert.equal(checkHeading(slugs, '流程-1'), true);
  assert.equal(checkHeading(slugs, 'lost'), false);
});
test('B13/B14 truthKind不可覆盖实际漂移；历史不被改写为当前', () => {
  assert.equal(
    freshness(
      { truthKind: 'current-code', source: 'a', context: 'b' },
      { source: 'c', context: 'b' },
    ),
    'source-drift',
  );
  assert.equal(
    freshness(
      { truthKind: 'historical', source: 'a', context: 'b' },
      { source: 'c', context: 'b' },
    ),
    'historical',
  );
  assert.throws(() => freshness({ truthKind: 'invented' }, { source: 'a', context: 'b' }));
});
test('B15 原始来源缺失必须original-unavailable', () => {
  assert.equal(provenanceStatus(null, 'a'), 'original-unavailable');
  assert.equal(provenanceStatus('a', 'a'), 'matched');
  assert.equal(provenanceStatus('b', 'a'), 'mismatch');
});
test('B16/B17 渲染版本、配置、逐图digest都绑定；同数量不能替代', () => {
  const expected = {
    renderer: '11',
    configDigest: 'c',
    harnessDigest: 'h',
    diagrams: [{ id: 'g', digest: 'd' }],
  };
  const receipt = {
    ...expected,
    observations: [{ id: 'g', svgBytes: 300, width: 400, height: 200, missingLabels: [] }],
    browser: 'actual',
    observedAt: '2026-10-22T00:00:00.000Z',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
  };
  assert.deepEqual(validateReceipt(receipt, expected), []);
  for (const patch of [
    { renderer: '12' },
    { configDigest: 'other' },
    { diagrams: [{ id: 'g', digest: 'new' }] },
  ])
    assert.ok(validateReceipt({ ...receipt, ...patch }, expected).length);
});
test('B18 Mermaid/Cytoscape投影保留同一节点边集合，不能静默丢边', () => {
  const g = graph(),
    p = projectGraph(g);
  assert.deepEqual(
    p.nodes.map((n) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    p.edges.map((e) => e.id),
    ['e'],
  );
  const broken = graph();
  broken.edges[0].to = 'absent';
  assert.throws(() => projectGraph(broken));
});
test('B19 空SVG、非法bounds、缺文字不通过', () => {
  for (const o of [
    { svgBytes: 0, width: 10, height: 10, missingLabels: [] },
    { svgBytes: 300, width: 0, height: 10, missingLabels: [] },
    { svgBytes: 300, width: 10, height: 10, missingLabels: ['入口'] },
  ])
    assert.ok(validateSvgObservation(o).length);
});
test('B18/B19 拒绝节点边重名与缺失数值字段', () => {
  const g = graph();
  g.edges[0].id = g.nodes[0].id;
  assert.ok(validateGraph(g).length);
  assert.ok(validateSvgObservation({ width: 100, height: 100, missingLabels: [] }).length);
});
test('B22 产品package/tsconfig误引入Atlas直接失败', () => {
  const pkg = {
    files: ['dist', 'resources'],
    exports: { '.': './dist/index.js' },
    scripts: { build: 'tsc' },
    dependencies: {},
    devDependencies: {},
  };
  assert.deepEqual(validateIsolation(pkg, { include: ['src/**/*.ts'] }, pkg), []);
  assert.ok(
    validateIsolation(
      { ...pkg, workspaces: ['alembic-core-architecture-atlas'] },
      { include: ['src/**/*.ts'] },
      pkg,
    ).length,
  );
  assert.ok(
    validateIsolation({ ...pkg, files: ['**/*'] }, { include: ['src/**/*.ts'] }, pkg).length,
  );
  assert.ok(validateIsolation(pkg, { include: ['**/*.ts'] }, pkg).length);
});

test('B22 tsconfig files/references/extends不允许扩大产品构建', () => {
  const pkg = {
    files: ['dist'],
    exports: { '.': './dist/index.js' },
    scripts: {},
    dependencies: {},
    devDependencies: {},
  };
  for (const delta of [
    { files: ['alembic-core-architecture-atlas/src/main.ts'] },
    { references: [{ path: './alembic-core-architecture-atlas' }] },
    { extends: './other.json' },
  ])
    assert.ok(validateIsolation(pkg, { include: ['src/**/*.ts'], ...delta }, pkg).length);
});
test('Reader 空checks或错误viewport不能伪造代表视口验收', () => {
  const r = {
    browser: 'test browser',
    observedAt: '2026-10-22T00:00:00Z',
    samples: [1440, 1024, 390].map((width) => ({
      page: 'overview',
      viewport: { width, height: 900 },
      checks: [],
    })),
  };
  assert.ok(validateReaderReceipt(r, {}).includes('incomplete-reader-observation'));
});

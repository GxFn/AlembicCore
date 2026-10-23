import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyze, inspectEvidence, inspectSourceAnchor } from '../scripts/analysis.mjs';
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-ast-'));
  try {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', allowJs: true },
        include: ['**/*.ts', '**/*.mjs'],
      }),
      'package.json': JSON.stringify({
        type: 'module',
        exports: { '.': { import: './dist/main.js' }, './b': { import: './dist/b.js' } },
      }),
      'a.ts': 'export type T = string; export const value = 1; export function run(){return 1}',
      'b.ts': 'export { run as renamed } from "./a.js"; const privateOnly = 1;',
      'main.ts':
        'import type {T} from "./a.js"; import {value,type T as U} from "./a.js"; export * from "./b.js"; export type {T} from "./a.js"; import("./b.js"); const name="other"; import(name);',
      'check.test.ts':
        'import {run} from "./a.js"; import {run as actual} from "./a.js"; const it = (n,f)=>f(); const expect=(n)=>({toBe:(x)=>{}}); it("import only",()=>{const local=1; expect(local).toBe(1)}); it("direct",()=>{expect(actual()).toBe(1)}); it("shadow",()=>{const run=()=>3; expect(run()).toBe(3)}); it("comment",()=>{/*run()*/ expect(1).toBe(1)}); it("forged assertion",()=>{actual(); const text="expect(actual()).toBe(2)"; expect(1).toBe(1)});',
    };
    for (const [p, v] of Object.entries(files)) writeFileSync(join(root, p), v);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test('B06/B07 NodeNext保留type/mixed/re-export/dynamic关系与.js身份', () =>
  fixture((root) => {
    const a = analyze(root, ['a.ts', 'b.ts', 'main.ts', 'check.test.ts']);
    const edges = a.imports.filter((e) => e.from === 'main.ts');
    for (const kind of [
      'type',
      'mixed',
      're-export',
      'type-re-export',
      'dynamic-literal',
      'dynamic-unresolved',
    ])
      assert.ok(
        edges.some((e) => e.kind === kind),
        kind,
      );
    assert.equal(edges.find((e) => e.specifier === './b.js').to, 'b.ts');
  }));
test('B08 checker只解析公开导出，别名追到真实声明', () =>
  fixture((root) => {
    const a = analyze(root, ['a.ts', 'b.ts']);
    const ex = a.exportsFor('b.ts');
    assert.deepEqual(
      ex.map((e) => e.name),
      ['renamed'],
    );
    assert.equal(ex[0].origin, 'a.ts');
  }));
test('B09 import/注释/同名局部变量不能成为direct；别名实际调用可以', () =>
  fixture((root) => {
    const a = analyze(root, ['a.ts', 'check.test.ts']);
    const base = {
      relation: 'direct',
      path: 'check.test.ts',
      anchorSymbol: 'run',
      assertedBehavior: '返回1',
      scenarioKind: 'success',
    };
    for (const [caseTitle, assertionExcerpt] of [
      ['import only', 'expect(local).toBe(1)'],
      ['shadow', 'expect(run()).toBe(3)'],
      ['comment', 'expect(1).toBe(1)'],
      ['forged assertion', 'expect(actual()).toBe(2)'],
    ])
      assert.ok(inspectEvidence(a, { ...base, caseTitle, assertionExcerpt }).length);
    assert.deepEqual(
      inspectEvidence(a, {
        ...base,
        caseTitle: 'direct',
        assertionExcerpt: 'expect(actual()).toBe(1)',
      }),
      [],
    );
  }));
test('B10 assertion必须位于case内，间接helper说明不升级为执行通过', () =>
  fixture((root) => {
    const a = analyze(root, ['a.ts', 'check.test.ts']);
    assert.ok(
      inspectEvidence(a, {
        relation: 'indirect',
        path: 'check.test.ts',
        caseTitle: 'import only',
        anchorSymbol: 'run',
        assertionExcerpt: 'expect(actual()).toBe(1)',
      }).length,
    );
  }));

test('B11 文件中的其他声明不能冒充图边owner', () =>
  fixture((root) => {
    const a = analyze(root, ['a.ts']);
    assert.deepEqual(
      inspectSourceAnchor(a, { path: 'a.ts', symbol: 'run', excerpt: 'return 1' }),
      [],
    );
    assert.ok(
      inspectSourceAnchor(a, { path: 'a.ts', symbol: 'value', excerpt: 'return 1' }).length,
    );
  }));
test('命名空间导出保留模块身份但不泄露本机绝对路径', () =>
  fixture((root) => {
    writeFileSync(join(root, 'namespace.ts'), 'export * as group from "./a.js";');
    const a = analyze(root, ['a.ts', 'namespace.ts']);
    const result = a.exportsFor('namespace.ts');
    assert.equal(result[0].name, 'group');
    assert.equal(result[0].origin, 'a.ts');
    assert.equal(result[0].declaredName, '<module>');
    assert.equal(JSON.stringify(result).includes(root), false);
  }));

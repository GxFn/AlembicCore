import { test } from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import { elements, mermaidSource } from '../src/graph-model.ts';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import YAML from 'yaml';
test('B18 实际Cytoscape元素与Mermaid共享身份，重名先拒绝', () => {
  const graph = {
    id: 'g',
    title: '测试',
    description: '同一正典',
    viewType: 'F1',
    nodes: [
      { id: 'a', label: '甲', role: 'entry' },
      { id: 'b', label: '乙', role: 'store' },
    ],
    edges: [{ id: 'e', from: 'a', to: 'b', label: '调用', kind: 'call' }],
  };
  const cy = cytoscape({ headless: true, elements: elements(graph) });
  assert.equal(cy.nodes().length, 2);
  assert.equal(cy.edges().length, 1);
  assert.ok(mermaidSource(graph).includes('e0@-->'));
  cy.destroy();
  graph.edges[0].id = 'a';
  assert.throws(() => elements(graph));
  assert.throws(() => mermaidSource(graph));
});
test('B13 schema拒绝未知truthKind；YAML重复键拒绝', () => {
  const schema = new Ajv().compile(
    JSON.parse(readFileSync(new URL('../schemas/document.schema.json', import.meta.url), 'utf8')),
  );
  assert.equal(schema({ truthKind: 'pretend-current' }), false);
  assert.throws(() =>
    YAML.parse('truthKind: current-code\ntruthKind: stale', { uniqueKeys: true }),
  );
});

import type { Graph, ImportEdge } from '../schemas/model.ts';
// 正典节点/边生成两种投影。没有从 Mermaid 文本反推交互图的第二套解释器。
const quoted = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br/>');
export function mermaidSource(graph: Graph): string {
  assertGraphIdentity(graph);
  const ids = new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
  const rows = [
    'flowchart TD',
    `accTitle: ${graph.title.replaceAll('\n', ' ')}`,
    `accDescr: ${graph.description.replaceAll('\n', ' ')}`,
  ];
  for (const n of graph.nodes) rows.push(`${ids.get(n.id)}["${quoted(n.label)}"]`);
  graph.edges.forEach((e, i) => {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`missing-endpoint:${e.id}`);
    rows.push(`${ids.get(e.from)} e${i}@-->|"${quoted(e.label)}"| ${ids.get(e.to)}`);
  });
  const palette: Record<string, string> = {
    entry: 'entry',
    boundary: 'host',
    host: 'host',
    store: 'store',
    persistence: 'store',
    file: 'store',
    error: 'error',
    failure: 'error',
    recovery: 'error',
  };
  rows.push(
    'classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33',
    'classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c',
    'classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54',
    'classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29',
  );
  graph.nodes.forEach((n) => {
    const role = palette[n.role];
    if (role) rows.push(`class ${ids.get(n.id)} ${role}`);
  });
  return rows.join('\n');
}
export function elements(graph: Graph) {
  assertGraphIdentity(graph);
  return [
    ...graph.nodes.map((n) => ({ data: { ...n } })),
    ...graph.edges.map((e) => ({
      data: { id: e.id, source: e.from, target: e.to, label: e.label, kind: e.kind },
    })),
  ];
}
export function dependencyGraph(
  topicId: string,
  selection: string[],
  imports: ImportEdge[],
): Graph | null {
  const edges = imports.filter(
    (e) => selection.includes(e.from) && e.to && selection.includes(e.to),
  );
  if (!edges.length) return null;
  const used = new Set(edges.flatMap((e) => [e.from, e.to!]));
  const paths = selection.filter((p) => used.has(p));
  return {
    id: `dependencies-${topicId}`,
    title: '文件依赖精选 · 静态关系',
    description: '显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。',
    viewType: 'F0',
    nodes: paths.map((p) => ({
      id: p,
      label: p.split('/').slice(-2).join('/'),
      role: 'file',
      path: p,
    })),
    edges: edges.map((e, i) => ({
      id: `dep-${topicId}-${i}`,
      from: e.from,
      to: e.to!,
      label: e.kind,
      kind: e.kind,
      source: { path: e.from, symbol: '<module>', excerpt: e.excerpt },
      test: { relation: 'none', reason: 'TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。' },
    })),
  };
}
function assertGraphIdentity(graph: Graph) {
  const ids = graph.nodes.map((n) => n.id).concat(graph.edges.map((e) => e.id));
  if (new Set(ids).size !== ids.length) throw new Error('duplicate-graph-identity');
  const nodes = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges)
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error(`missing-endpoint:${edge.id}`);
}

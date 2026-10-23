import { deepContentMarkdown } from '../src/deep-content.ts';
import { mermaidSource, dependencyGraph } from '../src/graph-model.ts';
export const generatedStart = '<!-- atlas:generated:start -->';
export function graphMarkdown(doc, imports, navigation) {
  const dep = dependencyGraph(doc.topicId, doc.dependencySelection, imports);
  const graphs = [...doc.diagrams, ...(dep ? [dep] : [])];
  const cell = (x) =>
    String(x ?? '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  return (
    '\n' +
    generatedStart +
    deepContentMarkdown(doc, 'modules', navigation) +
    '\n\n## 生成的图与逐边依据\n\n此区域由同页结构化图模型生成；请修改 frontmatter，再显式运行 `npm run inventory:write`，不要单独修改表格或 Mermaid。\n\n' +
    graphs
      .map(
        (g) =>
          `<a id="graph-${g.id}"></a>\n\n### ${g.title}\n\n图 ID：\`${g.id}\` · ${g.viewType} · ${g.description}\n\n\`\`\`mermaid\n${mermaidSource(g)}\n\`\`\`\n\n| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |\n| --- | --- | --- | --- | --- | --- |\n` +
          g.edges
            .map(
              (e) =>
                `| <a id="e-${g.id}--${e.id}"></a>${cell(e.id)} | ${cell(e.label)} | \`${cell(e.source.path)}#${cell(e.source.symbol)}\` | ${e.test.relation} | ${cell(e.test.caseTitle ?? e.test.reason)} | ${(navigation?.backlinks[`${g.id}/${e.id}`] ?? []).map((b) => `[${cell(b.title)}](${b.route})`).join(' · ')} |`,
            )
            .join('\n'),
      )
      .join('\n\n') +
    deepContentMarkdown(doc, 'failures', navigation) +
    '\n\n<!-- atlas:generated:end -->\n'
  );
}
export function fileIndexMarkdown(files) {
  return (
    '# 文件库存\n\n由 `inventory:write` 从当前 Git 库存与既有阅读记录生成；不是本轮产品执行回执。原始 full/partial/asset 语义不升级。\n\n' +
    `总计 ${files.length} 项。\n\n| 路径 | 类别 | 主专题 | 原阅读 | 来源状态 |\n| --- | --- | --- | --- | --- |\n` +
    files
      .map(
        (f) =>
          `| \`${f.path}\` | ${f.category} | ${f.topicId ?? '支持材料'} | ${f.readLevel} | ${f.reviewStatus} |`,
      )
      .join('\n') +
    '\n'
  );
}
export function registerMarkdown(graphs) {
  return (
    '# 图谱登记\n\n由同页正典与静态导入选择集生成。所有 F0 都是明确选择集，不声称展示完整仓库图。\n\n| 图 ID | 问题视图 | 专题 | 节点 / 边 |\n| --- | --- | --- | --- |\n' +
    graphs
      .map(
        (g) =>
          `| \`${g.id}\` | ${g.viewType}：${g.title} | [${g.topicId}](${g.document.replace(/^maps\//, '')}) | ${g.nodes.length} / ${g.edges.length} |`,
      )
      .join('\n') +
    '\n'
  );
}

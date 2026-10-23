import type { AtlasDocument } from '../schemas/model.ts';
export interface DeepNavigation {
  links: Record<string, { title: string; href: string }>;
  backlinks: Record<string, Array<{ title: string; route: string }>>;
}
const html = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\"', '&quot;');
const anchor = (id: string | undefined, aliases: string[] = []) =>
  id
    ? `<a id=\"${html(id)}\" class=\"stable-anchor\"></a>\n` +
      aliases.map((a) => `<a id=\"${html(a)}\" class=\"stable-anchor\"></a>`).join('\n') +
      '\n\n'
    : '';
type DeepContent = Pick<AtlasDocument, 'moduleDetails' | 'failureModes'>;
const cell = (text: unknown) =>
  String(text ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const code = (text: string) => {
  const length = Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1));
  const fence = '`'.repeat(length);
  return `${fence}ts\n${text}\n${fence}`;
};
// 模块与失败说明只维护一次；Git Markdown与浏览器正文消费同一投影。
export function deepContentMarkdown(
  doc: DeepContent,
  section: 'all' | 'modules' | 'failures' = 'all',
  navigation?: DeepNavigation,
): string {
  if (!doc.moduleDetails?.length && !doc.failureModes?.length) return '';
  const related = (id: string, refs: string[], apis: string[] = []) => {
    const links = refs.map((ref) => {
      const l = navigation?.links[ref];
      return l ? `[${l.title}](${l.href})` : `\`${ref}\``;
    });
    const back = (navigation?.backlinks[id] ?? []).map((l) => `[${l.title}](${l.route})`);
    return `\n\n关联：${links.join(' · ') || '未声明跨项关联'}${
      apis.length
        ? ' · 包入口 ' +
          apis
            .map((a) => {
              const l = navigation?.links[a];
              return l
                ? `[${l.title}](${l.href})`
                : `\`@alembic/core${a === '.' ? '' : a.slice(1)}\``;
            })
            .join('、')
        : ''
    }${back.length ? '\n\n返回业务旅程：' + back.join(' · ') : ''}`;
  };
  const modules = doc.moduleDetails ?? [],
    failures = doc.failureModes ?? [];
  const rows = modules
    .map(
      (m) =>
        `${anchor(m.id ? `m-${m.id}` : undefined, m.aliases)}### ${m.name}\n\n入口：\`${m.entry.path}#${m.entry.symbol}\`\n\n| 检查项 | 功能与边界 |\n| --- | --- |\n| 输入 | ${cell(m.input)} |\n| 输出 | ${cell(m.output)} |\n| 后续调用 / 绑定 | ${cell(m.calls)} |\n| 状态与副作用 | ${cell(m.sideEffects)} |\n| 能力边界 | ${cell(m.limits)} |${related(m.id ?? '', [...(m.graphRefs ?? []), ...(m.failureRefs ?? [])], m.apiRefs)}`,
    )
    .join('\n\n');
  const detail = failures
    .map(
      (f) =>
        `${anchor(`f-${f.id}`, f.aliases)}### ${f.id} · ${f.trigger}\n\n| 检查项 | 当前代码语义 |\n| --- | --- |\n| 已留下什么 | ${cell(f.remainingState)} |\n| Core自动做什么 | ${cell(f.automaticAction)} |\n| 谁显式恢复 | ${cell(f.explicitRecovery)} |\n| 必须停止的条件 | ${cell(f.stopCondition)} |\n| 源码定位 | \`${cell(f.source.path)}#${cell(f.source.symbol)}\` |\n\n${f.runbook ? `#### 恢复检查顺序\n\n前提：${f.runbook.preconditions}\n\n${f.runbook.checks.map((c, i) => `${i + 1}. ${c.observe} — ${c.meaning}`).join('\n')}\n\n显式动作：${f.runbook.action}\n\n重试身份：${f.runbook.identity}\n\n完成断言：${f.runbook.verify}\n\n停止条件：${f.runbook.stop}\n\n` : ''}${code(f.source.excerpt)}${related(f.id, [...(f.moduleRefs ?? []), ...(f.graphRefs ?? [])], f.apiRefs)}\n\n${f.test.relation === 'none' ? `断言关系：**none**。${f.test.reason}` : `断言关系：**${f.test.relation}**。\`${f.test.path}\` · \`${f.test.caseTitle}\`\n\n${f.test.assertedBehavior}（${f.test.scenarioKind}）。这里只定位断言；实际运行范围见独立运行证据。\n\n${code(f.test.assertionExcerpt ?? '')}`}`,
    )
    .join('\n\n');
  const moduleSection = `\n\n## 功能单元与调用接缝\n\n各单元按真实入口拆分职责；门面暴露、内部调用和宿主装配是不同关系。关联图提供相邻阅读上下文，故障产生位置以条目源码为准。\n\n${rows}\n`;
  const failureSection = `\n\n## 失败后的状态与恢复责任\n\n先检查已落盘状态，再决定恢复。自动动作只描述代码已执行的分支；显式恢复不能据提示文字推断为自动调用。\n\n${detail}\n`;
  return section === 'modules'
    ? moduleSection
    : section === 'failures'
      ? failureSection
      : moduleSection + failureSection;
}
export function validateDeepContent(doc: DeepContent): string[] {
  const errors: string[] = [];
  if (!Array.isArray(doc.moduleDetails) || !doc.moduleDetails.length)
    errors.push('missing-module-details');
  if (!Array.isArray(doc.failureModes) || !doc.failureModes.length)
    errors.push('missing-failure-modes');
  const names = new Set<string>(),
    ids = new Set<string>();
  for (const m of doc.moduleDetails ?? []) {
    if (names.has(m.name)) errors.push('duplicate-module');
    names.add(m.name);
    for (const key of ['name', 'input', 'output', 'calls', 'sideEffects', 'limits'] as const)
      if (typeof m[key] !== 'string' || !m[key].trim()) errors.push(`module-field:${key}`);
    if (!m.entry?.path || !m.entry.symbol || !m.entry.excerpt) errors.push('module-entry');
  }
  for (const f of doc.failureModes ?? []) {
    if (ids.has(f.id)) errors.push('duplicate-failure');
    ids.add(f.id);
    for (const key of [
      'id',
      'trigger',
      'remainingState',
      'automaticAction',
      'explicitRecovery',
      'stopCondition',
    ] as const)
      if (typeof f[key] !== 'string' || !f[key].trim()) errors.push(`failure-field:${key}`);
    if (!f.source?.path || !f.source.symbol || !f.source.excerpt) errors.push('failure-source');
    const t = f.test;
    if (!t || !['direct', 'indirect', 'none'].includes(t.relation))
      errors.push('failure-test-relation');
    else if (t.relation === 'none') {
      if (!t.reason) errors.push('failure-test-none-reason');
    } else if (
      !t.path ||
      !t.caseTitle ||
      !t.anchorSymbol ||
      !t.assertedBehavior ||
      !t.assertionExcerpt ||
      !t.scenarioKind
    )
      errors.push('failure-test-anchor');
  }
  return errors;
}

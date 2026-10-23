import type { BookIndex, RunRecord, CaseEvidenceLink, CaseOutcome } from '../schemas/book.ts';

export const outcomeLabels: Record<CaseOutcome, string> = {
  normal: '正常路径',
  recovered: '恢复验证',
  rejected: '拒绝验证',
  'observed-boundary': '边界观察',
  'risk-observed': '风险观察',
};
const fixtureLabels = {
  'real-io': '真实 I/O（范围见下方）',
  'port-contract': '内存 / 注入端口合同',
  mixed: '真实存储与注入端口混合',
};
const cell = (value: unknown) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const fenced = (value: string, language = '') => {
  const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
};
export function caseLinksMarkdown(links: CaseEvidenceLink[] = []) {
  return links.length
    ? '\n\n逐case运行依据（快照）：\n\n' +
        links
          .map(
            (l) =>
              `- [${l.id} · ${cell(l.title)}](${l.href}) — ${outcomeLabels[l.outcome]}；${l.verified ? '所列断言已核验' : `本记录不支持当前结论（${l.runStatus}）`}`,
          )
          .join('\n')
    : '';
}
// Markdown与浏览器共用同一解释；测试pass和业务结论保持两个独立字段。
export function caseEvidenceMarkdown(
  run: RunRecord,
  book: BookIndex,
  convert = (href: string) => href,
): string {
  if (!run.caseEvidence?.length)
    return '\n\n本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。\n';
  const failureLink = (id: string) => book.failures.find((f) => f.id === id)?.route;
  const moduleLink = (id: string) => book.modules.find((m) => m.id === id)?.route;
  const refs = (ids: string[], resolve: (id: string) => string | undefined) =>
    ids
      .map((id) => (resolve(id) ? `[${id}](${convert(resolve(id)!)})` : `\`${id}\``))
      .join(' · ') || '本case未声明';
  return (
    '\n\n## 逐case业务结论与观察\n\n' +
    run.caseEvidence
      .map((c) => {
        const verified =
          run.status === 'passed' &&
          run.caseResults?.some((x) => x.id === c.id && x.status === 'supported') === true;
        const actual = (run.probeObservations ?? []).filter(
          (o) => o && typeof o === 'object' && o.caseId === c.id,
        );
        return `<a id="case-${c.id}"></a>\n\n### ${c.id} · ${c.claim}\n\n执行核验：${verified ? '所列case与观察匹配' : `本记录不支持当前结论（${run.status}）`}。业务结论类型：**${outcomeLabels[c.outcome]}**。\n\n夹具：${fixtureLabels[c.fixture]}。\n\n| 检查项 | 所列case范围 |\n| --- | --- |\n| 故障 / 前提 | ${cell(c.fault)} |\n| 显式动作 | ${cell(c.action)} |\n| 实际case身份 | \`${c.testFile}\` · ${cell(c.caseTitle)} |\n\n${c.limitations.map((x) => '- ' + x).join('\n')}\n\n断言定位：\`${c.assertion.path ?? c.testFile}\` · \`${c.assertion.caseTitle ?? c.caseTitle}\`\n\n${fenced(c.assertion.assertionExcerpt ?? '', 'ts')}\n\n${actual.length ? `<details><summary>实际状态观察与检查字段</summary>\n\n${fenced(JSON.stringify(actual, null, 2), 'json')}\n\n${c.observationChecks.map((x) => `- \`${x.observationId}.${x.field}\` = \`${JSON.stringify(x)}\``).join('\n')}\n\n</details>` : '该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。'}\n\n模块：${refs(c.moduleRefs, moduleLink)}\n\n失败：${refs(c.failureRefs, failureLink)}\n\n返回具体步骤：${refs(c.stepRefs, (id) => `#journeys~${id}`)}`;
      })
      .join('\n\n')
  );
}

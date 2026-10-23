import type { BookIndex, Journey, CoreObject, RunRecord } from '../schemas/book.ts';
import { escapeHtml as esc, renderMarkdown } from './content.ts';
const pill = (title: string, route: string) =>
  `<a class="pill" href="${esc(route)}">${esc(title)}</a>`;
const relationLabels: Record<string, string> = {
  call: '入口内的真实调用',
  data: '数据传递',
  binding: '输入与身份绑定',
  'host-action': '宿主显式操作',
  'reading-order': '阅读选路',
};
const row = (label: string, value: string) =>
  `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
const source = (s: { path: string; symbol: string; excerpt: string }) =>
  `<details class="evidence"><summary>源码依据 · ${esc(s.symbol)}</summary><p><a href="#files~${encodeURIComponent(s.path)}"><code>${esc(s.path)}</code></a> <button data-copy="${esc(s.path + '#' + s.symbol)}">复制定位</button></p><pre>${esc(s.excerpt)}</pre></details>`;
export function referenceLinks(
  book: BookIndex,
  ids: string[],
  kind: 'module' | 'failure' | 'edge' | 'object' | 'run',
) {
  return ids
    .map((id) => {
      const target =
        kind === 'module'
          ? book.modules.find((x) => x.id === id)
          : kind === 'failure'
            ? book.failures.find((x) => x.id === id)
            : kind === 'edge'
              ? book.edges.find((x) => x.id === id)
              : kind === 'object'
                ? book.objects.find((x) => x.id === id)
                : book.runs.find((x) => x.id === id);
      if (!target) return `<span class="badge warn">未解析 ${esc(id)}</span>`;
      const title =
        'name' in target
          ? target.name
          : 'trigger' in target
            ? target.id + ' · ' + target.trigger
            : target.title;
      const route =
        'route' in target ? target.route : kind === 'object' ? `#objects~${id}` : `#runs~${id}`;
      return pill(title, route);
    })
    .join('');
}
export function journeyIndex(book: BookIndex) {
  return `<div class="hero"><div class="eyebrow">JOURNEYS / 显式边界</div><h1>从一个业务问题出发</h1><p class="lead">按步骤查看输入、已发生的状态变化、失败后的检查顺序与证据。步骤之间的阅读顺序不等于Core自动调用。</p></div><div class="topic-grid">${book.journeys.map((j) => `<a class="topic-card" href="#journeys~${j.id}"><span class="topic-num">${j.id}</span><div><h3>${esc(j.title)}</h3><p>${esc(j.question)}</p><small>${j.steps.length}步 · ${j.freshness === 'matched' ? '来源匹配' : '需要复核'}</small></div></a>`).join('')}</div>`;
}
export function journeyPage(book: BookIndex, j: Journey) {
  return `<a href="#journeys">← 全部业务旅程</a><div class="hero" id="${esc(j.id)}"><div class="eyebrow">${esc(j.id)} / READING JOURNEY</div><h1>${esc(j.title)}</h1><p class="lead">${esc(j.question)}</p><p>${esc(j.scope)}</p><span class="badge ${j.freshness === 'matched' ? '' : 'warn'}">${j.freshness === 'matched' ? '来源匹配' : '来源待复核'}</span><span class="badge neutral">L3链路说明 · 运行范围单列</span></div><div class="prose">${renderMarkdown(j.body)}</div><h2>步骤导航</h2><div class="journey-nav">${j.steps.map((s, i) => pill(`${i + 1}. ${s.title}`, `#journeys~${s.id}`)).join('')}</div><div class="note">示例标记：${esc(j.example.kind)}。${esc(j.example.input)}<br/>预期阅读结果：${esc(j.example.expected)}<br/>范围：${esc(j.example.limits)}</div>${j.steps.map((s, i) => `<section class="journey-step" id="${esc(s.id)}"><div class="eyebrow">${i + 1} / ${j.steps.length} · ${esc(s.id)} · ${esc(relationLabels[s.relation])}</div><h2>${esc(s.title)}</h2><div class="prose"><div class="table-wrap"><table><tbody>${row('输入', s.input)}${row('输出', s.output)}${row('状态与副作用', s.state)}${row('动作与停止', s.action)}</tbody></table></div></div><h3>相关功能</h3>${referenceLinks(book, s.moduleRefs, 'module')}${referenceLinks(book, s.objectRefs ?? [], 'object')}<h3>图边与失败入口</h3>${referenceLinks(book, s.edgeRefs, 'edge')}${referenceLinks(book, s.failureRefs, 'failure')}${source(s.source)}<p class="step-pagination">${i ? pill('← 上一步', `#journeys~${j.steps[i - 1].id}`) : ''}${i < j.steps.length - 1 ? pill('下一步 →', `#journeys~${j.steps[i + 1].id}`) : pill('回到旅程开头', `#journeys~${j.id}`)}</p></section>`).join('')}<h2>核心对象</h2>${referenceLinks(book, j.objectRefs, 'object')}<h2>独立运行证据</h2><p>仅对每个样本所列范围成立，不将整条旅程升级为已执行。</p>${referenceLinks(book, j.runRefs, 'run')}<h2>公开入口规则</h2>${j.entryApis.map((a) => pill(`@alembic/core${a === '.' ? '' : a.slice(1)}`, `#api~${encodeURIComponent(a)}`)).join('')}`;
}
export function objectsPage(book: BookIndex, selected: string) {
  const object = book.objects.find((o) => o.id === selected);
  if (!object)
    return `<h1>核心对象与生命周期</h1><p class="lead">先确认对象身份、事实来源与持久化owner，再决定恢复动作。相似名字不代表可以互换。</p><div class="topic-grid">${book.objects.map((o) => `<a class="topic-card" href="#objects~${o.id}"><span class="topic-num">${o.id}</span><div><h3>${esc(o.title)}</h3><p>${esc(o.persistence)}</p></div></a>`).join('')}</div>`;
  return objectPage(book, object);
}
function objectPage(book: BookIndex, o: CoreObject) {
  return `<a href="#objects">← 全部核心对象</a><h1 id="${esc(o.id)}">${esc(o.title)}</h1><div class="prose"><div class="table-wrap"><table><tbody>${row('谁产生', o.producer)}${row('谁消费', o.consumer)}${row('持久化', o.persistence)}${row('身份', o.identity)}${row('失效条件', o.invalidation)}</tbody></table></div><h2>状态与阶段</h2><div class="table-wrap"><table><thead><tr><th>状态/阶段</th><th>精确含义</th></tr></thead><tbody>${o.states.map((s) => row(s.name, s.meaning)).join('')}</tbody></table></div></div><h2>相关功能与失败</h2>${referenceLinks(book, o.moduleRefs, 'module')}${referenceLinks(book, o.failureRefs, 'failure')}${source(o.source)}<h2>消费本对象的旅程</h2>${book.journeys.flatMap((j) => j.steps.filter((s) => (s.objectRefs ?? []).includes(o.id)).map((s) => pill(`${j.id} · ${s.title}`, `#journeys~${s.id}`))).join('')}`;
}
export function failuresPage(book: BookIndex, query = '') {
  const q = query.trim().toLowerCase();
  const found = book.failures.filter((f) => JSON.stringify(f).toLowerCase().includes(q));
  return `<p class="status-line">${found.length} 项 · none是未关联断言，不是通过或产品缺陷判定。</p>${found.map((f) => `<a class="failure-card" href="${f.route}"><small>${esc(f.id)} · 专题${f.topicId} · 断言${f.test.relation}${f.runbook ? ' · 有恢复检查顺序' : ''}</small><h3>${esc(f.trigger)}</h3><p><strong>已留下：</strong>${esc(f.remainingState)}</p><p><strong>显式恢复：</strong>${esc(f.explicitRecovery)}</p></a>`).join('')}`;
}
const runStatus: Record<string, string> = {
  'not-run': '未运行',
  passed: '所列样本通过',
  failed: '本次执行失败',
  stale: '旧执行已过期',
  missing: '原始材料缺失',
  unavailable: '无法核验',
};
export function runsPage(book: BookIndex) {
  return `<h1>有范围的运行证据</h1><p class="lead">这些执行与源码/断言复核分开。通过只覆盖列出的输入、故障注入和断言，不代表全量产品或真实宿主验收。当前浏览器无法重验原始材料；下列状态属于已保存快照。</p>${book.runs.map((r) => runCard(book, r)).join('')}`;
}
function runCard(book: BookIndex, r: RunRecord) {
  return `<section id="${esc(r.id)}" class="run-card"><div class="eyebrow">${esc(r.id)} / SCOPED EXECUTION</div><h2>${esc(r.title)}</h2><span class="badge ${r.status === 'passed' ? '' : r.status === 'not-run' ? 'neutral' : 'warn'}">${esc(runStatus[r.status] ?? r.status)}</span><p>${esc(r.verification ?? '仅记录计划，尚无执行回执')}</p><p>${esc(r.fixtureDescription ?? '')}</p>${r.observedAt ? `<p class="status-line">实际运行：${esc(r.observedAt)} · 退出码 ${esc(r.exitCode)}<br/>来源指纹 ${esc(r.sourceDigest?.slice(0, 20))}</p>` : ''}${r.command ? `<details class="evidence"><summary>执行命令与环境</summary><p>在Core根目录执行；参数数组中的输出位置由受控runner固定。</p><pre>${esc(JSON.stringify({ environment: r.environment, command: r.command }, null, 2))}</pre><p class="status-line">完整回执：${esc(r.receiptRef)}<br/>${esc(r.receiptSha256)}</p></details>` : ''}<h3>断言范围</h3><ul>${(r.observations ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h3>不可外推</h3><ul>${(r.limitations ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${r.errors?.length ? `<div class="note warning">${r.errors.map(esc).join('<br/>')}</div>` : ''}${r.probeObservations?.length ? `<details class="evidence"><summary>实际状态观察（隔离fixture）</summary><pre>${esc(JSON.stringify(r.probeObservations, null, 2))}</pre></details>` : ''}${r.cases ? `<details class="evidence"><summary>${r.cases.length} 个实际case与状态</summary>${r.cases.map((c) => `<p><span class="badge neutral">${esc(c.status)}</span> ${esc(c.title)}</p>`).join('')}</details>` : ''}<p class="status-line">原始材料：${esc(r.rawRef ?? '未产生')}<br/>${esc(r.rawSha256 ?? '')}</p>${r.journeyRefs.map((id) => pill(`返回${id}`, `#journeys~${id}`)).join('')}${referenceLinks(book, r.failureRefs, 'failure')}</section>`;
}

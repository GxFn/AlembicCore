import {
  journeyIndex,
  journeyPage,
  objectsPage,
  failuresPage,
  runsPage,
  referenceLinks,
} from './book-content.ts';
import { searchBook, affectedBookEntries } from './book-model.ts';
import type { BookIndex } from '../schemas/book.ts';
import { deepContentMarkdown } from './deep-content.ts';
import './styles.css';
import { siteConfig } from '../site.config.ts';
import bootstrap from 'virtual:atlas-bootstrap';
import type { AtlasDocument, Graph, SourceFile } from '../schemas/model.ts';
import type {
  TopicAsset,
  FileAsset,
  SearchAsset,
  ApiAsset,
  ImpactAsset,
} from '../schemas/browser.ts';
import { AtlasLoader, LatestRequest } from './loader.ts';
import { escapeHtml as esc, renderMarkdown, headingSlug } from './content.ts';
const { summary, review, topics: topicIndex } = bootstrap;
const loader = new AtlasLoader(),
  searchRequests = new LatestRequest();
let files: SourceFile[] = [],
  api: ApiAsset = { policyPath: '', entries: [] },
  impactData: ImpactAsset = { inputs: [], files: [], edges: [], unknownCount: 0 };
let book: BookIndex | null = null;
const app = document.querySelector<HTMLDivElement>('#app')!;
const statusLabel = (s: string) =>
  ({
    matched: '来源匹配',
    historical: '历史快照',
    'target-design': '目标设计',
    'source-drift': '源码已漂移',
    'context-drift': '上下文已漂移',
    stale: '待复审',
  })[s] ?? s;
const badge = (s: string) =>
  `<span class="badge ${s === 'matched' ? '' : s === 'historical' ? 'neutral' : 'warn'}">${esc(statusLabel(s))}</span>`;
const route = () => {
  const [id = 'overview', anchor = ''] = decodeURIComponent(
    location.hash.slice(1) || 'overview',
  ).split('~');
  return { id, anchor };
};
let cleanups: Array<() => void> = [],
  generation = 0;
function toast(message: string) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.role = 'status';
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 1800);
}
async function copy(value: string) {
  // 保持用户手势内同步复制，兼容未提供异步 Clipboard API 的内嵌浏览器。
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (copied) {
    toast('已复制源码定位');
    return;
  }
  try {
    await Promise.race([
      navigator.clipboard.writeText(value),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('clipboard-timeout')), 1500),
      ),
    ]);
    toast('已复制源码定位');
  } catch {
    toast(`复制未完成：${value}`);
  }
}
function sourceLink(path: string) {
  return `<a href="#files~${encodeURIComponent(path)}"><code>${esc(path)}</code></a>`;
}
function shell() {
  app.innerHTML = `<header class="topbar"><a class="brand" href="#overview"><span class="brandmark">Ac</span><span>AlembicCore <small>ARCHITECTURE ATLAS</small></span></a><div class="top-actions"><span class="snapshot">ATLAS ${summary.atlasVersion} · SOURCE ${summary.baselineCommit.slice(0, 7)}</span><button id="theme" aria-label="切换明暗主题">明暗</button><button class="mobile-nav" id="menu" aria-label="打开专题导航" aria-expanded="false">目录</button></div></header><div class="layout"><nav class="sidebar" aria-label="专题导航"><input id="search" aria-label="搜索专题、路径或符号" placeholder="搜索专题、路径、符号…"/><div id="search-results" class="search-results"></div><div id="nav-content"><div class="nav-label">工作台 / EXPLORE</div>${[
    ['overview', '总览与阅读路线'],
    ['journeys', '业务旅程'],
    ['objects', '核心对象'],
    ['failures', '失败与恢复'],
    ['runs', '运行证据'],
    ['files', '逐文件索引'],
    ['api', '公共包入口'],
    ['impact', '变更影响'],
    ['history', '历史与来源'],
  ]
    .map(([id, label]) => `<a class="nav-item" data-route="${id}" href="#${id}">${label}</a>`)
    .join(
      '',
    )}<div class="nav-label">专题 / ${topicIndex.length} TOPICS</div>${topicIndex.map((t) => `<a class="nav-item" data-route="${t.id}" href="#${t.id}"><span>${t.id}</span>${esc(t.title)}</a>`).join('')}<div class="footer-note">独立文档工具<br/>不进入 @alembic/core 发布包</div></div></nav><main id="main" tabindex="-1"></main><aside class="aside" id="aside" aria-label="来源与目录"></aside></div>`;
  document.querySelector('#theme')!.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
  });
  document.querySelector('#menu')!.addEventListener('click', () => {
    const opened = document.querySelector('.sidebar')!.classList.toggle('open');
    document.querySelector('#menu')!.setAttribute('aria-expanded', String(opened));
  });
  document
    .querySelector<HTMLInputElement>('#search')!
    .addEventListener('input', (e) => search((e.target as HTMLInputElement).value));
  window.addEventListener('hashchange', () => {
    const r = route();
    if (
      document.querySelector<HTMLElement>('#main')?.dataset.contentReady === r.id &&
      !['files', 'api', 'journeys', 'objects'].includes(r.id)
    ) {
      restorePosition(r.id);
    } else void renderPage(r.id);
  });
  app.addEventListener('click', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-copy]');
    if (target) void copy(target.dataset.copy!);
    const a = (e.target as Element).closest<HTMLAnchorElement>('a');
    if (a?.hash) {
      document.querySelector('.sidebar')!.classList.remove('open');
      document.querySelector('#menu')!.setAttribute('aria-expanded', 'false');
    }
  });
}
function search(query: string) {
  const q = query.trim().toLowerCase(),
    out = document.querySelector('#search-results')!,
    nav = document.querySelector<HTMLElement>('#nav-content')!;
  nav.hidden = !!q;
  if (!q) {
    searchRequests.cancel();
    out.replaceChildren();
    return;
  }
  out.innerHTML = '<p role="status" class="status-line">正在读取搜索索引…</p>';
  void searchRequests.run(
    () => loader.load<SearchAsset>(bootstrap.assets.search),
    (data) => {
      const matches = data.documents
        .filter((d) => d.truthKind !== 'historical' && d.text.includes(q))
        .slice(0, 12);
      const paths = data.files
        .filter(
          (f) =>
            f.path.toLowerCase().includes(q) ||
            f.symbols.some((name) => name.toLowerCase().includes(q)) ||
            f.publicNames.some((name) => name.toLowerCase().includes(q)),
        )
        .slice(0, 12);
      const exact = searchBook({ search: data.entries } as BookIndex, q);
      out.innerHTML =
        exact
          .map(
            (e) =>
              `<a href="${esc(e.route)}"><small>${esc(e.kind)} · ${esc(e.id)}</small>${esc(e.title)}<small>${esc(e.detail.slice(0, 140))}</small></a>`,
          )
          .join('') +
          matches
            .map(
              (d) => `<a href="#${d.topicId}">${esc(d.title)}<small>${esc(d.question)}</small></a>`,
            )
            .join('') +
          paths
            .map(
              (f) =>
                `<a href="#files~${encodeURIComponent(f.path)}">${esc(f.path)}<small>文件 · 专题 ${f.topicId ?? '支持材料'}${f.publicNames.some((n) => n.toLowerCase().includes(q)) ? ' · 匹配公开导出名' : f.symbols.some((n) => n.toLowerCase().includes(q)) ? ' · 含匹配声明（不代表公共导出）' : ''}</small></a>`,
            )
            .join('') || '<p class="empty">未找到当前来源；历史记录请从“历史与来源”进入。</p>';
    },
    (error) => {
      out.innerHTML = `<p class="note warning">搜索索引读取失败：${esc(error instanceof Error ? error.message : String(error))}</p><button id="retry-search">重试搜索</button>`;
      out.querySelector('#retry-search')!.addEventListener('click', () => search(query));
    },
  );
}

function aside(doc?: AtlasDocument) {
  const s = document.querySelector('#aside')!;
  s.innerHTML = `<h3>来源快照</h3><p class="status-line">核验时间<br/>${esc(summary.checkedAt)}<br/>Core ${summary.baselineCommit.slice(0, 12)}</p>${doc ? badge(doc.freshness) : '<span class="badge neutral">静态阅读快照</span>'}<p class="status-line">此页显示已核验的来源快照，不实时读取工作树。</p>${doc ? `<h3>本页依据</h3><p>${doc.sourcePaths.length} 个源码输入<br/>${doc.testPaths.length} 个测试 / helper<br/>${doc.consumerRefs.length} 个外层接线<br/>复核深度 ${esc(doc.reviewDepth)}</p><h3>验证含义</h3><p class="status-line">direct / indirect 描述断言关系。断言关系与实际运行分开，选定场景见“运行证据”。none 为明确缺口。</p><div class="toc"><h3>本页目录</h3><div id="toc"></div></div>` : '<h3>阅读约定</h3><p>先看业务问题，再沿图边查看源码与测试证据。</p><p class="status-line">F0 = 静态文件依赖<br/>F1 = 已复核符号关系<br/>S0 = 状态变化<br/>R0 = 失败与恢复</p>'}<h3>原始记录</h3><p class="status-line">当前浏览器未重新核验原始材料。快照生成时：${review.originalAvailability === 'matched' ? '原始记录匹配' : '原始记录不可用'}。完整workspace可用check:provenance重新检查。</p><a href="#history">查看继承与未验证范围 →</a>`;
}
function overview() {
  return `<section class="hero"><div class="eyebrow">HEADLESS KERNEL / SOURCE ATLAS</div><h1>沿着代码，理解 Core。</h1><p class="lead">连接公开入口、确定性内核与真实持久化。从一次请求出发，读懂它经过什么、何时停止，以及每个判断的依据。</p></section><div class="metrics">${[
    [summary.documentCount, '架构专题'],
    [summary.moduleCount, '功能单元'],
    [summary.failureCount, '失败与恢复情形'],
    [summary.diagramCount, '关系与流程视图'],
  ]
    .map(([n, label]) => `<div class="metric"><strong>${n}</strong><span>${label}</span></div>`)
    .join(
      '',
    )}</div><div class="routes"><a class="route" href="#01"><small>01 / UNDERSTAND</small><strong>理解架构 →</strong><p>从包边界和事实责任开始。</p></a><a class="route" href="#10"><small>02 / TRACE</small><strong>排查写入失败 →</strong><p>跟随文件优先提交与显式恢复。</p></a><a class="route" href="#impact"><small>03 / CHANGE</small><strong>评估修改影响 →</strong><p>找出依赖、消费者和复核范围。</p></a></div><div class="note"><a href="#journeys">四条业务旅程 →</a> · <a href="#objects">核心对象与生命周期 →</a> · <a href="#failures">精确失败定位 →</a> · <a href="#runs">独立运行证据 →</a></div><h2>从问题进入专题</h2><div class="topic-grid">${topicIndex.map((t) => `<a class="topic-card" href="#${t.id}"><span class="topic-num">${t.id}</span><div><h3>${esc(t.title)}</h3><p>${esc(t.question)}</p><small>${t.ownedFileCount} 个主归属文件 · ${esc(t.reviewDepth)}</small></div></a>`).join('')}</div><div class="note warning">${review.knownRisks.length} 项已知源码问题保留在受影响专题中。来源匹配不等于功能无缺陷，也不表示本轮重跑产品测试。</div>`;
}
function fileIndex(anchor: string) {
  const selected = files.find((f) => f.path === anchor);
  return `<div class="eyebrow">INVENTORY / ${files.length} FILES</div><h1>逐文件索引</h1><p class="lead">${summary.ownershipCount} 个源码、脚本与 native worker 有唯一导航主归属。测试、配置与资源单独列示。</p>${selected ? `<section class="evidence"><h3>${esc(selected.path)}</h3><p>${esc(selected.responsibility)}</p><p>${esc(selected.flow)}</p><p class="status-line">阅读级别 ${esc(selected.readLevel)} · ${esc(selected.reviewStatus)} · SHA ${selected.sha256.slice(0, 16)}</p>${selected.reviewRecordId ? `<p>本字节复核：${esc(selected.reviewRecordId)} · ${esc(selected.reviewedAt)}<br/>${esc(selected.reviewMethod)}<br/><code>${esc(selected.reviewOrigin)}</code></p>` : ''}${selected.topicId ? `<a href="#${selected.topicId}">打开主专题 ${selected.topicId} →</a>` : ''}<button data-copy="${esc(selected.path)}">复制路径</button></section>` : ''}<div class="filter-row"><input id="file-filter" aria-label="筛选文件" placeholder="输入路径或职责关键词"/><select id="file-category" aria-label="筛选文件类别"><option value="">全部类别</option>${['source', 'test', 'script', 'resource', 'config', 'support'].map((c) => `<option>${c}</option>`).join('')}</select></div><div id="file-results"></div>`;
}
function fileRows(query = '', category = '') {
  const found = files.filter(
    (f) =>
      (!category || f.category === category) &&
      `${f.path} ${f.responsibility}`.toLowerCase().includes(query.toLowerCase()),
  );
  document.querySelector('#file-results')!.innerHTML =
    `<p class="status-line">匹配 ${found.length} 项，当前展示前 150 项；输入完整路径可直接定位。</p><div class="table-wrap"><table><thead><tr><th>文件</th><th>归属 / 类别</th><th>既有阅读</th></tr></thead><tbody>${found
      .slice(0, 150)
      .map(
        (f) =>
          `<tr><td>${sourceLink(f.path)}<br/><small>${esc(f.responsibility.slice(0, 120))}</small></td><td>${f.topicId ? `<a href="#${f.topicId}">${f.topicId}</a>` : '支持'} / ${f.category}</td><td>${esc(f.readLevel)}<br/><small>${esc(f.reviewStatus)}</small></td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}
function publicIndex() {
  return `<div class="eyebrow">PACKAGE CONTRACT / NODE NEXT</div><h1>公共包入口</h1><p class="lead">${api.entries.length} 条 exports 规则来自当前 package.json。通配入口保留为过渡内部契约；公开符号通过 TypeScript checker 解析到原声明。</p><div class="note">分类权威：${esc(api.policyPath)}。此索引没有恢复 ./recipe-context 或 ./source-graph 入口。</div><input id="api-filter" aria-label="搜索公共入口或导出符号" placeholder="搜索入口、符号、源文件…"/><div id="api-results"></div>`;
}
function apiRows(q = '', exact = false) {
  const entries = api.entries.filter((e) =>
    exact ? e.name === q : JSON.stringify(e).toLowerCase().includes(q.toLowerCase()),
  );
  document.querySelector('#api-results')!.innerHTML =
    entries
      .map(
        (e) =>
          `<details class="evidence ${exact ? 'selected' : ''}" ${exact ? 'open' : ''}><summary><strong>@alembic/core${e.name === '.' ? '' : e.name.slice(1)}</strong> <span class="badge ${e.policy === 'stable-public' ? '' : 'neutral'}">${e.policy}</span></summary>${(
            api.journeys ?? []
          )
            .filter((j) => j.entryApis.includes(e.name))
            .map((j) => `<a class="pill" href="#journeys~${j.id}">${esc(j.title)}</a>`)
            .join(
              '',
            )}${e.modules.map((m) => `<p>${sourceLink(m.path)}</p><div class="table-wrap"><table><thead><tr><th>公开名</th><th>种类</th><th>原声明</th></tr></thead><tbody>${m.exports.map((s) => `<tr><td><code>${esc(s.name)}</code></td><td>${s.kind}</td><td><code>${esc(s.origin)}#${esc(s.declaredName)}</code></td></tr>`).join('')}</tbody></table></div>`).join('')}</details>`,
      )
      .join('') || '<p class="empty">没有匹配的公开入口。</p>';
}
function impact() {
  return `<div class="eyebrow">CHANGE / REVIEW CANDIDATES</div><h1>变更影响</h1><p class="lead">选择一个路径，查看直接导入方与需要复核的专题。静态依赖是阅读线索，无法证明动态运行覆盖。</p><input id="impact-input" list="source-paths" aria-label="选择变更路径" placeholder="例如 src/service/knowledge/KnowledgeService.ts"/><datalist id="source-paths">${impactData.files
    .map((f) => `<option value="${esc(f.path)}">`)
    .join(
      '',
    )}</datalist><div id="impact-results"></div><h2>当前来源状态</h2>${summary.documents.map((d) => `<p><a href="#${d.topicId}">专题 ${d.topicId}</a> ${badge(d.status)}</p>`).join('')}<div class="note">全量导入索引保留 ${impactData.unknownCount} 条动态未知引用；不会把它们当作“无依赖”。</div>`;
}
function impactRows(path: string) {
  const linked = impactData.book ? affectedBookEntries(impactData.book, path) : null;
  const related = impactData.inputs.filter((d) => d.paths.includes(path));
  const edges = impactData.edges.filter((e) => e.to === path);
  document.querySelector('#impact-results')!.innerHTML = `${
    linked && impactData.book
      ? `<h2>显式关联的复核范围</h2><p>功能：${
          referenceLinks(
            impactData.book,
            linked.modules.map((m) => m.id),
            'module',
          ) || '未声明'
        }<br/>失败：${
          referenceLinks(
            impactData.book,
            linked.failures.map((f) => f.id),
            'failure',
          ) || '未声明'
        }<br/>对象：${
          referenceLinks(
            impactData.book,
            linked.objects.map((o) => o.id),
            'object',
          ) || '未声明'
        }</p><p>旅程：${linked.journeys.map((j) => `<a class="pill" href="#journeys~${j.id}">${esc(j.title)}</a>`).join('') || '未声明'}</p><p>运行材料：${
          referenceLinks(
            impactData.book,
            linked.runs.map((r) => r.id),
            'run',
          ) || '无已声明样本'
        }</p><p class="status-line">运行回执绑定完整产品库存，相关源码/测试/consumer变化保守要求重验；没有关联不代表不存在运行依赖。</p>`
      : ''
  }<h2>复核候选</h2><p>${related.map((d) => `<a class="pill" href="#${d.topicId}">${d.topicId} ${esc(d.title)}</a>`).join('') || '尚无匹配专题'}</p><h3>直接导入方 · ${edges.length}</h3><div class="table-wrap"><table><thead><tr><th>路径</th><th>关系类别</th></tr></thead><tbody>${edges
    .slice(0, 100)
    .map((e) => `<tr><td>${sourceLink(e.from)}</td><td>${e.kind}</td></tr>`)
    .join('')}</tbody></table></div>`;
}
function historyPage() {
  return `<div class="eyebrow">PROVENANCE / SNAPSHOT</div><h1>历史与来源</h1><p class="lead">阅读记录、语义复核、产品执行、图形渲染与交互验收各自保留范围。</p><div class="evidence"><span class="badge neutral">historical · 继承记录</span><h2>2026-10-22 逐文件阅读</h2><p>${esc(review.method)}</p><p>来源：<code>${esc(review.origin)}</code></p><p class="status-line">原记录 SHA ${esc(review.originSha256)}<br/>原始材料（生成快照时）${esc(review.originalAvailability)}；当前浏览器无法重新核验原ledger，不能据此声明当前位置原材料可用。</p><p>${esc(review.productTests.summary)}</p><p class="note warning">继承执行来源，不是本轮产品测试通过。源变化后应重新检查对应断言和业务链。</p></div><h2>追加复核记录</h2><p>记录绑定精确路径与字节；是否适用于当前源由文件索引单独判断，历史记录不覆盖。</p>${(review.appendedReviews ?? []).map((r) => `<div class="evidence"><h3>${esc(r.id)}</h3>${sourceLink(r.path)}<p>${esc(r.scope)} · ${esc(r.readLevel)} · ${esc(r.reviewedAt)}<br/>${esc(r.method)}</p><code>${esc(r.rawLedgerRef)}</code></div>`).join('') || '<p>暂无追加记录。</p>'}<h2>已知问题 · 保持可见</h2>${review.knownRisks.map((r) => `<div class="risk"><strong>${r.id} · ${esc(r.title)}</strong><p>${esc(r.detail)}</p><a href="#${r.topicId}">受影响专题 ${r.topicId} →</a></div>`).join('')}<h2>状态示例</h2><p class="status-line">以下是界面状态示例，不是当前源码核验结果。历史状态不会被当前指纹覆盖。</p><p>${badge('source-drift')} 源文件已变，需要复审。</p><p>${badge('context-drift')} 测试、配置或消费者已变。</p><p>${badge('historical')} 冻结的历史材料。</p><h2>维护入口</h2><p>在独立 Atlas 目录运行 <code>npm run check</code>。显式渲染验证使用 <code>npm run render:verify</code>；普通阅读没有写接口。</p><p class="status-line">历史快照被冻结，不能通过刷新当前源码hash把它变成新执行。未知来源显示 original-unavailable。</p>`;
}
function graphCard(g: Graph) {
  return `<section class="graph-card" id="graph-${esc(g.id)}"><div class="graph-heading"><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p></div><div class="graph-host" data-graph="${esc(g.id)}"></div><div class="edge-links" aria-label="图边证据">${g.edges.map((e) => `<button data-edge="${esc(g.id)}--${esc(e.id)}">${esc(e.id)} · ${esc(e.label)}</button>`).join('')}</div></section>`;
}
function evidence(g: Graph, navigation?: TopicAsset['navigation']) {
  return g.edges
    .map((e) => {
      const t = e.test;
      return `<article class="evidence" id="e-${esc(g.id)}--${esc(e.id)}"><header><h4>${esc(e.id)} · ${esc(e.label)}</h4><span class="badge ${t.relation === 'none' ? 'warn' : 'neutral'}">${t.relation}</span></header><p class="locator">${esc(e.source.path)}#${esc(e.source.symbol)} <button data-copy="${esc(e.source.path)}#${esc(e.source.symbol)}">复制定位</button></p><details><summary>源码与断言依据</summary><pre>${esc(e.source.excerpt)}</pre>${(navigation?.backlinks[`${g.id}/${e.id}`] ?? []).map((b) => `<a class="pill" href="${esc(b.route)}">返回 ${esc(b.title)}</a>`).join('')}${t.relation === 'none' ? `<p class="note warning">${esc(t.reason)}</p>` : `<p>${sourceLink(t.path!)}<br/><code>${esc(t.caseTitle)}</code></p><p>${esc(t.assertedBehavior)} · ${esc(t.scenarioKind)}</p><pre>${esc(t.assertionExcerpt)}</pre><p class="status-line">${esc(t.anchorSymbol)} · 断言定位；实际执行范围单列。</p>`}</details></article>`;
    })
    .join('');
}
function documentPage(d: AtlasDocument, graphs: Graph[], navigation: TopicAsset['navigation']) {
  return `<div class="hero"><div class="eyebrow">TOPIC ${d.topicId} / ${esc(d.truthKind.toUpperCase())}</div><h1>${esc(d.title)}</h1><p class="lead">${esc(d.question)}</p>${badge(d.freshness)} <span class="badge neutral">${d.reviewDepth} · 逐边复核</span></div><div class="prose">${renderMarkdown(d.body + deepContentMarkdown(d, 'modules', navigation))}</div><h2 id="graphs">流程与关系</h2><p class="status-line">图上按钮和边均可定位唯一证据。阅读模式保留字形大小；大图可拖动平移，使用“全图”查看整体。</p>${graphs.map(graphCard).join('')}<div class="prose">${renderMarkdown(deepContentMarkdown(d, 'failures', navigation))}</div><h2 id="limitations">已知限制</h2>${d.risks.length ? d.risks.map((r) => `<div class="note warning">${esc(r)}</div>`).join('') : '<p>本页未新增已复现问题；静态证据不代表所有运行环境均通过。</p>'}<h2 id="consumers">真实外层接线</h2>${d.consumerRefs.length ? d.consumerRefs.map((c) => `<div class="evidence"><p><code>${esc(c.repository)}/${esc(c.path)}</code></p><p>${esc(c.meaning)}</p><pre>${esc(c.excerpt)}</pre></div>`).join('') : '<div class="note">没有为此页声明已核对的外层直接调用。内部能力/测试存在不自动证明宿主已接线。</div>'}<h2 id="evidence">逐边证据</h2><p class="status-line">direct 为直接绑定调用与断言；indirect 通过fixture/helper或间接行为；none是明确未覆盖。三者均不自动代表本轮执行。</p>${graphs.map((g) => evidence(g, navigation)).join('')}<h2 id="files">文件阅读范围</h2><details class="evidence"><summary>${d.sourcePaths.length} 个源码输入与 ${d.testPaths.length} 个测试/helper</summary>${[...d.sourcePaths, ...d.testPaths].map((p) => `<p>${sourceLink(p)}</p>`).join('')}</details><div class="footer-note">来源指纹 ${d.sourceFingerprint.slice(0, 20)} · 复核 ${esc(d.reviewedAt)} · 原始记录 ${esc(d.reviewOrigin)}</div>`;
}
function focusEvidence(id: string) {
  const element = document.getElementById(`e-${id}`);
  if (!element) return;
  document.querySelectorAll('.evidence.selected').forEach((e) => e.classList.remove('selected'));
  element.classList.add('selected');
  element.querySelector('details')?.setAttribute('open', '');
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', `#${route().id}~e-${id}`);
}
function restorePosition(id: string) {
  const current = route();
  if (current.id !== id) return;
  if (current.anchor && id !== 'files') {
    const element = document.getElementById(current.anchor);
    element?.scrollIntoView();
    if (current.anchor.startsWith('e-')) {
      element?.classList.add('selected');
      element?.querySelector('details')?.setAttribute('open', '');
    }
  } else window.scrollTo(0, 0);
}
async function renderPage(id: string) {
  const token = ++generation;
  cleanups.forEach((f) => f());
  cleanups = [];
  const main = document.querySelector<HTMLElement>('#main')!;
  delete main.dataset.ready;
  delete main.dataset.contentReady;
  let positioned = false;
  const position = () => {
    if (positioned) return;
    positioned = true;
    main.dataset.contentReady = id;
    document.title = `${d?.title ?? main.querySelector('h1')?.textContent ?? '总览'} · ${siteConfig.name}`;
    restorePosition(id);
  };
  const descriptor = topicIndex.find((t) => t.id === id);
  let d: AtlasDocument | undefined, topic: TopicAsset | undefined;
  document
    .querySelectorAll('.nav-item')
    .forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.route === id));
  aside();
  const anchor = route().anchor;
  const key = descriptor
    ? `topic:${id}`
    : ['files', 'api', 'impact'].includes(id)
      ? id
      : ['journeys', 'objects', 'failures', 'runs'].includes(id)
        ? 'book'
        : null;
  if (key) {
    main.innerHTML = '<p class="status-line" role="status">正在读取当前快照的页面资料…</p>';
    try {
      const data = await loader.load(bootstrap.assets[key]);
      if (token !== generation) return;
      if (descriptor) {
        topic = data as TopicAsset;
        d = topic.document;
        aside(d);
      } else if (id === 'files') files = (data as FileAsset).files;
      else if (id === 'api') api = data as ApiAsset;
      else if (id === 'impact') impactData = data as ImpactAsset;
      else if (key === 'book') book = data as BookIndex;
    } catch (error) {
      if (token !== generation) return;
      main.innerHTML = `<h1>页面资料尚未加载</h1><p class="note warning">${esc(error instanceof Error ? error.message : String(error))}</p><p>可重试；若本地快照刚更新，请刷新页面以读取新索引。</p><button id="retry-page">重试读取</button>`;
      main.querySelector('#retry-page')!.addEventListener('click', () => void renderPage(id));
      return;
    }
  }
  if (d && topic) {
    const graphs = [...d.diagrams, ...(topic.dependency ? [topic.dependency] : [])];
    main.innerHTML = documentPage(d, graphs, topic.navigation);
    main.querySelectorAll('.prose table').forEach((table) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', '可横向滚动的对照表');
      table.before(wrap);
      wrap.append(table);
    });
    const headings = new Map<string, number>();
    const explicitIds = new Set([...main.querySelectorAll('[id]')].map((n) => n.id));
    main.querySelectorAll<HTMLHeadingElement>('.prose h1,.prose h2,.prose h3').forEach((h) => {
      const slug = headingSlug(h.textContent ?? ''),
        i = headings.get(slug) ?? 0;
      headings.set(slug, i + 1);
      const candidate = slug + (i ? `-${i}` : '');
      h.id = explicitIds.has(candidate) ? candidate + '-heading' : candidate;
    });
    document.querySelector('#toc')!.innerHTML =
      [...main.querySelectorAll('h2')]
        .map((h) => `<a href="#${d.topicId}~${esc(h.id)}">${esc(h.textContent)}</a>`)
        .join('') +
      `<details><summary>功能与恢复条目</summary>${(d.moduleDetails ?? []).map((m) => `<a href="#${d.topicId}~m-${m.id}">${esc(m.id)} ${esc(m.name)}</a>`).join('')}${(d.failureModes ?? []).map((f) => `<a href="#${d.topicId}~f-${f.id}">${esc(f.id)}</a>`).join('')}</details>`;
    main
      .querySelectorAll<HTMLButtonElement>('[data-edge]')
      .forEach((b) => b.addEventListener('click', () => focusEvidence(b.dataset.edge!)));
    position();
    let mountDiagram: typeof import('./renderer.ts').mountDiagram;
    try {
      ({ mountDiagram } = await import('./renderer.ts'));
    } catch (error) {
      if (token !== generation) return;
      main
        .querySelectorAll('.graph-host')
        .forEach(
          (host) =>
            (host.textContent = `图引擎加载失败，请刷新重试：${error instanceof Error ? error.message : String(error)}`),
        );
      return;
    }
    if (token !== generation) return;
    for (const g of graphs) {
      const host = main.querySelector<HTMLElement>(`[data-graph="${CSS.escape(g.id)}"]`)!;
      try {
        const cleanup = await mountDiagram(g, host, (id) => focusEvidence(`${g.id}--${id}`));
        if (token !== generation) {
          cleanup();
          return;
        }
        cleanups.push(cleanup);
      } catch (e) {
        if (token !== generation) return;
        host.textContent = `图形未完成：${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } else if (id === 'journeys' && book) {
    const j = book.journeys.find((j) => j.id === anchor || j.steps.some((s) => s.id === anchor));
    main.innerHTML = j ? journeyPage(book, j) : journeyIndex(book);
  } else if (id === 'objects' && book) main.innerHTML = objectsPage(book, anchor);
  else if (id === 'runs' && book) main.innerHTML = runsPage(book);
  else if (id === 'failures' && book) {
    main.innerHTML =
      '<h1>失败与恢复入口</h1><p class="lead">按错误、状态、源码路径或failure ID定位，先看残留状态，再选择显式恢复。</p><input id="failure-filter" aria-label="筛选失败与恢复" placeholder="例如 DivergenceError、租约、stf-population-unknown"/><div id="failure-results"></div>';
    const results = main.querySelector('#failure-results')!;
    results.innerHTML = failuresPage(book);
    main
      .querySelector<HTMLInputElement>('#failure-filter')!
      .addEventListener(
        'input',
        (e) => (results.innerHTML = failuresPage(book!, (e.target as HTMLInputElement).value)),
      );
  } else if (id === 'files') {
    main.innerHTML = fileIndex(anchor);
    fileRows(anchor);
    const q = document.querySelector<HTMLInputElement>('#file-filter')!,
      c = document.querySelector<HTMLSelectElement>('#file-category')!;
    q.value = anchor;
    const update = () => fileRows(q.value, c.value);
    q.addEventListener('input', update);
    c.addEventListener('change', update);
  } else if (id === 'api') {
    main.innerHTML = publicIndex();
    apiRows(anchor, Boolean(anchor));
    document.querySelector<HTMLInputElement>('#api-filter')!.value = anchor;
    document
      .querySelector<HTMLInputElement>('#api-filter')!
      .addEventListener('input', (e) => apiRows((e.target as HTMLInputElement).value));
  } else if (id === 'impact') {
    main.innerHTML = impact();
    document
      .querySelector<HTMLInputElement>('#impact-input')!
      .addEventListener('input', (e) => impactRows((e.target as HTMLInputElement).value));
  } else if (id === 'history') main.innerHTML = historyPage();
  else main.innerHTML = overview();
  if (['journeys', 'objects', 'failures', 'runs'].includes(id))
    document.title = `${main.querySelector('h1')?.textContent ?? 'Core'} · ${siteConfig.name}`;
  if (token !== generation) return;
  position();
  main.dataset.ready = id;
}
if (new URLSearchParams(location.search).has('verify')) {
  void import('./verify.ts').then((m) => m.startVerification(app));
} else {
  shell();
  void renderPage(route().id);
}

import { verifyRunRecord } from './run-records.mjs';
import { readFileSync, globSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { snapshot, sha, safeFile } from './contracts.mjs';
import { buildBookIndex, validateBook } from '../src/book-model.ts';
import { writeIfChanged } from './snapshot-state.mjs';
const atlas = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  core = resolve(atlas, '..');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const loadMarkdown = (directory) =>
  globSync(`${directory}/*.md`, { cwd: atlas })
    .sort()
    .flatMap((path) => {
      const raw = readFileSync(resolve(atlas, path), 'utf8');
      if (!raw.startsWith('---\n')) return [];
      const end = raw.indexOf('\n---\n', 4);
      if (end < 0) throw Error(`invalid-frontmatter:${path}`);
      return [
        {
          ...YAML.parse(raw.slice(4, end), { uniqueKeys: true }),
          path,
          body: raw
            .slice(end + 5)
            .split('<!-- atlas:generated:start -->')[0]
            .trim(),
        },
      ];
    });
export function journeys() {
  return loadMarkdown('journeys').map((j) => ({
    ...j,
    freshness:
      j.sourceFingerprint ===
      snapshot(core, [...(j.sourcePaths ?? []), ...(j.testPaths ?? [])]).digest
        ? 'matched'
        : 'source-drift',
  }));
}
export function coreObjects() {
  return loadMarkdown('objects');
}
export function runScenarios() {
  const p = resolve(atlas, 'evidence/scenarios.json');
  return existsSync(p) ? json(p) : [];
}
export function runRecords(productDigest) {
  return runScenarios().map((spec) => {
    const p = resolve(atlas, `evidence/runs/${spec.id}.json`);
    if (!existsSync(p)) return { ...spec, status: 'not-run', verification: '没有实际执行回执' };
    try {
      const record = json(p);
      return {
        ...spec,
        ...verifyRunRecord({
          atlas,
          ledger: resolve(core, '../wakeflow-ledger/AlembicCore'),
          productDigest,
          record,
          spec,
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            vitest: json(resolve(core, 'node_modules/vitest/package.json')).version,
          },
        }),
      };
    } catch (error) {
      return { ...spec, status: 'unavailable', verification: `回执无法读取：${error.message}` };
    }
  });
}
export function bookInput(documents, api, productDigest) {
  return {
    documents,
    api,
    journeys: journeys(),
    objects: coreObjects(),
    runs: runRecords(productDigest),
  };
}
export function bookProjection(documents, api, productDigest) {
  const input = bookInput(documents, api, productDigest);
  return { input, index: buildBookIndex(input), errors: validateBook(input) };
}
export function writeBook(index) {
  writeIfChanged(resolve(atlas, 'data/book-index.json'), JSON.stringify(index, null, 2) + '\n');
}
export function bookLinks(book) {
  const links = {};
  for (const m of book.modules) links[m.id] = { title: m.name, href: m.route };
  for (const f of book.failures) links[f.id] = { title: f.id + ' · ' + f.trigger, href: f.route };
  for (const g of book.graphs) links[g.id] = { title: g.title, href: g.route };
  for (const a of book.search.filter((e) => e.kind === '公共入口'))
    links[a.id] = { title: a.title, href: a.route };
  for (const e of book.edges) links[e.id] = { title: e.title, href: e.route };
  return links;
}
export function topicNavigation(book, topicId) {
  const moduleIds = new Set(book.modules.filter((m) => m.topicId === topicId).map((m) => m.id));
  const failureIds = new Set(book.failures.filter((f) => f.topicId === topicId).map((f) => f.id));
  const all = bookLinks(book),
    links = {},
    backlinks = {};
  for (const m of book.modules.filter((m) => moduleIds.has(m.id))) {
    for (const id of [...(m.graphRefs ?? []), ...(m.failureRefs ?? []), ...(m.apiRefs ?? [])])
      links[id] = all[id];
    backlinks[m.id] = m.journeys;
  }
  for (const f of book.failures.filter((f) => failureIds.has(f.id))) {
    for (const id of [...(f.moduleRefs ?? []), ...(f.graphRefs ?? []), ...(f.apiRefs ?? [])])
      links[id] = all[id];
    backlinks[f.id] = f.journeys;
  }
  for (const e of book.edges.filter((e) => e.topicId === topicId))
    backlinks[e.id] = book.journeys.flatMap((j) =>
      j.steps
        .filter((s) => s.edgeRefs.includes(e.id))
        .map((s) => ({
          id: j.id,
          stepId: s.id,
          title: `${j.id} · ${s.title}`,
          route: `#journeys~${s.id}`,
        })),
    );
  return { links, backlinks };
}
export function markdownNavigation(book, documents, from) {
  const routes = new Map(documents.map((d) => [d.topicId, d.path]));
  const convert = (href) => {
    const [kind, anchor = ''] = decodeURIComponent(href.slice(1)).split('~');
    let target = routes.get(kind),
      id = anchor;
    if (kind === 'journeys') {
      const j = book.journeys.find((j) => j.id === anchor || j.steps.some((s) => s.id === anchor));
      target = j?.path;
    } else if (kind === 'objects') target = book.objects.find((o) => o.id === anchor)?.path;
    else if (kind === 'runs') target = 'evidence/README.md';
    else if (kind === 'api') {
      target = 'data/public-api.json';
      id = '';
    }
    if (!target) return href;
    const rel = relative(dirname(from), target).replaceAll('\\', '/');
    return (rel || from.split('/').at(-1)) + (id ? '#' + encodeURIComponent(id) : '');
  };
  const navigation = topicNavigation(book, documents.find((d) => d.path === from)?.topicId ?? '');
  return {
    links: Object.fromEntries(
      Object.entries({ ...bookLinks(book), ...navigation.links }).map(([id, l]) => [
        id,
        { ...l, href: convert(l.href) },
      ]),
    ),
    backlinks: Object.fromEntries(
      Object.entries(navigation.backlinks).map(([id, items]) => [
        id,
        items.map((item) => ({ ...item, route: convert(item.route) })),
      ]),
    ),
    convert,
  };
}
const mdCell = (x) =>
  String(x ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const codeBlock = (s) => {
  const fence = '`'.repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}ts\n${s}\n${fence}`;
};
export function readingProjection(entity, book, documents) {
  const n = markdownNavigation(book, documents, entity.path);
  const link = (id, kind) => {
    const l = bookLinks(book)[id];
    if (l) return `[${l.title}](${n.convert(l.href)})`;
    const item =
      kind === 'object'
        ? book.objects.find((o) => o.id === id)
        : book.runs.find((r) => r.id === id);
    return item
      ? `[${item.title}](${n.convert(`#${kind === 'object' ? 'objects' : 'runs'}~${id}`)})`
      : '`' + id + '`';
  };
  const refs = (ids, kind) => ids.map((id) => link(id, kind)).join(' · ') || '未声明';
  let body = '';
  if (entity.steps) {
    body =
      `<a id="${entity.id}"></a>\n\n## 有序步骤与明确边界\n\n示例类型：${entity.example.kind}。${entity.example.input}\n\n预期：${entity.example.expected}\n\n限制：${entity.example.limits}\n\n` +
      entity.steps
        .map(
          (s) =>
            `<a id="${s.id}"></a>\n\n### ${s.id} · ${s.title}\n\n关系类型：${s.relation}\n\n| 项目 | 内容 |\n| --- | --- |\n| 输入 | ${mdCell(s.input)} |\n| 输出 | ${mdCell(s.output)} |\n| 状态 | ${mdCell(s.state)} |\n| 动作与停止 | ${mdCell(s.action)} |\n\n功能：${refs(s.moduleRefs, 'module')}\n\n对象：${refs(s.objectRefs ?? [], 'object')}\n\n图边：${refs(s.edgeRefs, 'edge')}\n\n失败：${refs(s.failureRefs, 'failure')}\n\n源码：\`${s.source.path}#${s.source.symbol}\`\n\n${codeBlock(s.source.excerpt)}`,
        )
        .join('\n\n') +
      `\n\n## 核心对象与运行范围\n\n对象：${refs(entity.objectRefs, 'object')}\n\n运行：${refs(entity.runRefs, 'run')}\n\n运行只覆盖各样本声明范围，不等于整条旅程通过。\n\n公开入口规则：${entity.entryApis.map((a) => `[${a}](${n.convert('#api~' + encodeURIComponent(a))})`).join(' · ')}`;
  } else {
    body = `<a id="${entity.id}"></a>\n\n## 对象身份与状态\n\n| 项目 | 含义 |\n| --- | --- |\n${[
      ['产生', entity.producer],
      ['消费', entity.consumer],
      ['持久化', entity.persistence],
      ['身份', entity.identity],
      ['失效', entity.invalidation],
    ]
      .map(([k, v]) => `| ${k} | ${mdCell(v)} |`)
      .join(
        '\n',
      )}\n\n| 状态/阶段 | 含义 |\n| --- | --- |\n${entity.states.map((s) => `| ${mdCell(s.name)} | ${mdCell(s.meaning)} |`).join('\n')}\n\n功能：${refs(entity.moduleRefs, 'module')}\n\n失败：${refs(entity.failureRefs, 'failure')}\n\n源码：\`${entity.source.path}#${entity.source.symbol}\`\n\n${codeBlock(entity.source.excerpt)}\n\n返回相关旅程步骤：${book.journeys.flatMap((j) => j.steps.filter((s) => (s.objectRefs ?? []).includes(entity.id)).map((s) => `[${j.id} · ${s.title}](${n.convert('#journeys~' + s.id)})`)).join(' · ') || '未声明具体步骤'}`;
  }
  return '\n<!-- atlas:generated:start -->\n\n' + body + '\n\n<!-- atlas:generated:end -->\n';
}
export function writeReadingProjections(book, documents) {
  for (const e of [...book.journeys, ...book.objects]) {
    const path = resolve(atlas, e.path);
    const raw = readFileSync(path, 'utf8').split('<!-- atlas:generated:start -->')[0].trimEnd();
    writeIfChanged(path, raw + '\n' + readingProjection(e, book, documents));
  }
  const text =
    '# 独立运行证据\n\n由明确执行命令产生回执，再由inventory:write派生。通过只对所列样本及来源身份成立。\n\n' +
    book.runs
      .map(
        (r) =>
          `<a id="${r.id}"></a>\n\n## ${r.id} · ${r.title}\n\n状态：${r.status} · ${r.verification ?? '未运行'}\n\n环境：${JSON.stringify(r.environment ?? {})}\n\n实际执行：${r.observedAt ?? '尚无'}；case数：${r.cases?.length ?? 0}。\n\n原始记录：\`${r.rawRef ?? '未产生'}\`\n\n${r.limitations.map((x) => '- ' + x).join('\n')}`,
      )
      .join('\n\n');
  writeIfChanged(resolve(atlas, 'evidence/README.md'), text + '\n');
}
export function checkReadingProjections(book, documents) {
  return [...book.journeys, ...book.objects].flatMap((e) => {
    const raw = readFileSync(resolve(atlas, e.path), 'utf8');
    const actual =
      '\n<!-- atlas:generated:start -->' + (raw.split('<!-- atlas:generated:start -->')[1] ?? '');
    return actual === readingProjection(e, book, documents)
      ? []
      : [`${e.path}:reading-projection-drift`];
  });
}

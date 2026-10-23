import type {
  BookInput,
  BookIndex,
  SearchEntry,
  JourneyBacklink,
  CaseEvidenceLink,
} from '../schemas/book.ts';
export const moduleRoute = (topic: string, id: string) => `#${topic}~m-${id}`;
export const failureRoute = (topic: string, id: string) => `#${topic}~f-${id}`;
export function caseEvidenceLinks(
  book: Pick<BookIndex, 'runs'>,
  id: string,
  field: 'moduleRefs' | 'failureRefs' | 'stepRefs',
): CaseEvidenceLink[] {
  return book.runs.flatMap((r) =>
    (r.caseEvidence ?? [])
      .filter((c) => c[field].includes(id))
      .map((c) => ({
        id: c.id,
        title: c.claim,
        href: `#runs~case-${c.id}`,
        outcome: c.outcome,
        fixture: c.fixture,
        verified:
          r.status === 'passed' &&
          r.caseResults?.some((x) => x.id === c.id && x.status === 'supported') === true,
        runStatus: r.status,
      })),
  );
}
const textOf = (value: unknown) => JSON.stringify(value).toLowerCase();
// 关联由正典明确声明。此投影只建立导航，不把相同路径/符号自动解释为调用边。
export function buildBookIndex(input: BookInput): BookIndex {
  const journeys = input.journeys ?? [],
    objects = input.objects ?? [],
    runs = input.runs ?? [];
  const back = (id: string, kind: 'moduleRefs' | 'failureRefs'): JourneyBacklink[] =>
    journeys.flatMap((j) =>
      j.steps
        .filter((s) => s[kind].includes(id))
        .map((s) => ({
          id: j.id,
          stepId: s.id,
          title: `${j.title} · ${s.title}`,
          route: `#journeys~${s.id}`,
        })),
    );
  const modules = input.documents.flatMap((d) =>
    (d.moduleDetails ?? []).map((m) => ({
      ...m,
      id: m.id ?? '',
      topicId: d.topicId,
      topicTitle: d.title,
      route: moduleRoute(d.topicId, m.id ?? ''),
      journeys: back(m.id ?? '', 'moduleRefs'),
    })),
  );
  const failures = input.documents.flatMap((d) =>
    (d.failureModes ?? []).map((f) => ({
      ...f,
      topicId: d.topicId,
      topicTitle: d.title,
      route: failureRoute(d.topicId, f.id),
      journeys: back(f.id, 'failureRefs'),
    })),
  );
  const graphs = input.documents.flatMap((d) =>
    d.diagrams.map((g) => ({
      id: g.id,
      title: g.title,
      topicId: d.topicId,
      route: `#${d.topicId}~graph-${g.id}`,
    })),
  );
  const edges = input.documents.flatMap((d) =>
    d.diagrams.flatMap((g) =>
      g.edges.map((e) => ({
        id: `${g.id}/${e.id}`,
        title: e.label,
        topicId: d.topicId,
        route: `#${d.topicId}~e-${g.id}--${e.id}`,
        path: e.source.path,
      })),
    ),
  );
  const search: SearchEntry[] = [];
  const add = (
    id: string,
    kind: string,
    title: string,
    detail: string,
    route: string,
    source: unknown,
  ) => search.push({ id, kind, title, detail, route, text: textOf(source) });
  for (const m of modules) add(m.id, '功能', m.name, m.entry.path, m.route, m);
  for (const f of failures) add(f.id, '失败', f.trigger, f.remainingState, f.route, f);
  for (const j of journeys) {
    add(j.id, '旅程', j.title, j.question, `#journeys~${j.id}`, j);
    for (const s of j.steps) add(s.id, '步骤', s.title, j.title, `#journeys~${s.id}`, s);
  }
  for (const o of objects) add(o.id, '对象', o.title, o.identity, `#objects~${o.id}`, o);
  for (const r of runs) {
    add(r.id, '运行证据', r.title, r.status, `#runs~${r.id}`, r);
    for (const c of r.caseEvidence ?? [])
      add(c.id, 'Case证据', c.claim, `${r.id} · ${c.caseTitle}`, `#runs~case-${c.id}`, c);
  }
  for (const a of input.api.entries)
    add(
      a.name,
      '公共入口',
      `@alembic/core${a.name === '.' ? '' : a.name.slice(1)}`,
      a.policy ?? '',
      `#api~${encodeURIComponent(a.name)}`,
      {
        ...a,
        package: `@alembic/core${a.name === '.' ? '' : a.name.slice(1)}`,
        journeys: journeys.filter((j) => j.entryApis.includes(a.name)).map((j) => j.title),
      },
    );
  const topicInputs = input.documents.map((d) => ({
    topicId: d.topicId,
    paths: [
      ...d.sourcePaths,
      ...d.testPaths,
      ...d.configPaths,
      ...d.consumerRefs.map((c) => `consumer:${c.repository}/${c.path}`),
    ],
  }));
  return { modules, failures, journeys, objects, runs, graphs, edges, search, topicInputs };
}
export function searchBook(book: BookIndex, query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (e: SearchEntry) =>
    e.id.toLowerCase() === q ? 0 : e.title.toLowerCase().includes(q) ? 1 : 2;
  return book.search
    .filter((e) => `${e.id} ${e.title} ${e.text}`.toLowerCase().includes(q))
    .sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))
    .slice(0, 20);
}
export function affectedBookEntries(book: BookIndex, path: string) {
  const topics = new Set(
    book.topicInputs.filter((t) => t.paths.includes(path)).map((t) => t.topicId),
  );
  const modules = book.modules.filter((m) => m.entry.path === path),
    failures = book.failures.filter((f) => f.source.path === path || f.test.path === path);
  const moduleIds = new Set(modules.map((m) => m.id)),
    failureIds = new Set(failures.map((f) => f.id));
  const edges = new Set(book.edges.filter((e) => e.path === path).map((e) => e.id));
  const objects = book.objects.filter(
    (o) => o.source.path === path || o.moduleRefs.some((id) => moduleIds.has(id)),
  );
  const objectIds = new Set(objects.map((o) => o.id));
  const journeys = book.journeys.filter(
    (j) =>
      j.steps.some(
        (s) =>
          s.source.path === path ||
          s.moduleRefs.some((id) => moduleIds.has(id)) ||
          s.edgeRefs.some((id) => edges.has(id)) ||
          s.failureRefs.some((id) => failureIds.has(id)),
      ) ||
      j.objectRefs.some((id) => objectIds.has(id)) ||
      (j.sourcePaths ?? []).includes(path) ||
      (j.testPaths ?? []).includes(path) ||
      (path.startsWith('consumer:') &&
        j.steps.some((s) =>
          s.moduleRefs.some((id) =>
            topics.has(book.modules.find((m) => m.id === id)?.topicId ?? ''),
          ),
        )),
  );
  const runs = book.runs.filter(
    (r) =>
      (!!r.sourceDigest && topics.size > 0) ||
      r.sourcePaths.includes(path) ||
      r.testFiles.includes(path) ||
      (r.inputFiles ?? []).some(
        (f) => (f.root === 'core' ? f.path : `${f.root}:${f.path}`) === path,
      ),
  );
  return { modules, failures, objects, journeys, runs, topics: [...topics] };
}
export function validateBook(input: BookInput): string[] {
  const errors: string[] = [];
  const book = buildBookIndex(input);
  const unique = (values: string[], kind: string) => {
    const seen = new Set<string>();
    for (const id of values) {
      if (!id || !/^[A-Za-z][A-Za-z0-9-]*$/.test(id)) errors.push(`${kind}:invalid-id:${id}`);
      if (seen.has(id)) errors.push(`${kind}:duplicate:${id}`);
      seen.add(id);
    }
    return seen;
  };
  const modules = unique(
      book.modules.map((m) => m.id),
      'module',
    ),
    failures = unique(
      book.failures.map((f) => f.id),
      'failure',
    ),
    journeys = unique(
      book.journeys.map((j) => j.id),
      'journey',
    ),
    objects = unique(
      book.objects.map((o) => o.id),
      'object',
    ),
    runs = unique(
      book.runs.map((r) => r.id),
      'run',
    );
  const graphs = new Set(book.graphs.map((g) => g.id)),
    edges = new Set(book.edges.map((e) => e.id)),
    apis = new Set(input.api.entries.map((a) => a.name));
  const refs = (owner: string, values: string[] | undefined, target: Set<string>, kind: string) => {
    for (const ref of values ?? []) if (!target.has(ref)) errors.push(`${owner}:${kind}:${ref}`);
  };
  const fields = (owner: string, value: Record<string, unknown>, names: string[]) => {
    for (const key of names)
      if (typeof value[key] !== 'string' || !(value[key] as string).trim())
        errors.push(`${owner}:missing:${key}`);
  };
  for (const m of book.modules) {
    refs(m.id, m.graphRefs, graphs, 'graph');
    refs(m.id, m.failureRefs, failures, 'failure');
    refs(m.id, m.apiRefs, apis, 'api');
  }
  for (const f of book.failures) {
    refs(f.id, f.moduleRefs, modules, 'module');
    refs(f.id, f.graphRefs, graphs, 'graph');
    refs(f.id, f.apiRefs, apis, 'api');
    if (f.runbook) {
      fields(f.id, f.runbook, ['preconditions', 'action', 'identity', 'verify', 'stop']);
      if (!f.runbook.checks?.length) errors.push(`${f.id}:missing-checks`);
    }
  }
  unique(
    book.journeys.flatMap((j) => j.steps.map((s) => s.id)),
    'step',
  );
  for (const j of book.journeys) {
    fields(j.id, j as unknown as Record<string, unknown>, ['title', 'question', 'scope', 'body']);
    refs(j.id, j.entryApis, apis, 'api');
    refs(j.id, j.objectRefs, objects, 'object');
    refs(j.id, j.runRefs, runs, 'run');
    if (!j.steps.length) errors.push(`${j.id}:empty-steps`);
    if (j.example?.kind !== 'illustrative') errors.push(`${j.id}:example-kind`);
    for (const s of j.steps) {
      fields(s.id, s as unknown as Record<string, unknown>, [
        'title',
        'input',
        'output',
        'state',
        'action',
      ]);
      if (!['call', 'data', 'binding', 'host-action', 'reading-order'].includes(s.relation))
        errors.push(`${s.id}:relation`);
      refs(s.id, s.moduleRefs, modules, 'module');
      refs(s.id, s.objectRefs, objects, 'object');
      refs(s.id, s.edgeRefs, edges, 'edge');
      refs(s.id, s.failureRefs, failures, 'failure');
      if (!s.moduleRefs.length) errors.push(`${s.id}:missing-module`);
      if (!s.source?.path || !s.source.symbol || !s.source.excerpt) errors.push(`${s.id}:source`);
    }
  }
  for (const o of book.objects) {
    fields(o.id, o as unknown as Record<string, unknown>, [
      'title',
      'producer',
      'consumer',
      'persistence',
      'identity',
      'invalidation',
    ]);
    refs(o.id, o.moduleRefs, modules, 'module');
    refs(o.id, o.failureRefs, failures, 'failure');
    if (!o.states.length || !o.source?.excerpt) errors.push(`${o.id}:incomplete`);
  }
  const steps = new Set(book.journeys.flatMap((j) => j.steps.map((s) => s.id)));
  unique(
    book.runs.flatMap((r) => (r.caseEvidence ?? []).map((c) => c.id)),
    'case-evidence',
  );
  for (const r of book.runs) {
    refs(r.id, r.journeyRefs, journeys, 'journey');
    refs(r.id, r.failureRefs, failures, 'failure');
    if (!['not-run', 'passed', 'failed', 'stale', 'missing', 'unavailable'].includes(r.status))
      errors.push(`${r.id}:status`);
    for (const c of r.caseEvidence ?? []) {
      refs(c.id, c.moduleRefs, modules, 'module');
      refs(c.id, c.failureRefs, failures, 'failure');
      refs(c.id, c.stepRefs, steps, 'step');
      fields(c.id, c as unknown as Record<string, unknown>, [
        'testFile',
        'caseTitle',
        'claim',
        'fault',
        'action',
      ]);
      if (!c.moduleRefs.length || !c.limitations.length || !c.assertion.assertionExcerpt)
        errors.push(`${c.id}:incomplete-case-evidence`);
    }
  }
  return errors;
}

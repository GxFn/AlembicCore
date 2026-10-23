export const requiredHarnessFiles = [
  'scripts/run-evidence.mjs',
  'scripts/run-contracts.mjs',
  'scripts/run-records.mjs',
  'scripts/book.mjs',
  'scripts/atlas.mjs',
  'scripts/contracts.mjs',
  'probes/vitest.config.ts',
  'probes/recovery.test.ts',
  'probes/persistence-recovery.test.ts',
  'probes/observation.ts',
  'evidence/scenarios.json',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalize = (t) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : '');
const testPath = (name = '') =>
  name
    .replaceAll('\\', '/')
    .replace(/^<core>\//, '')
    .replace(/^<atlas>\//, 'alembic-core-architecture-atlas/');
export function assessRunReport(report, spec, exitCode) {
  const errors = [];
  if (!object(report) || !Array.isArray(report.testResults)) errors.push('invalid-report-shape');
  const all = (Array.isArray(report?.testResults) ? report.testResults : []).flatMap((s) =>
    (Array.isArray(s?.assertionResults) ? s.assertionResults : [])
      .filter(object)
      .map((c) => ({ ...c, testFile: testPath(typeof s.name === 'string' ? s.name : '') })),
  );
  const titles = (spec.expectedCaseTitles ?? []).map(normalize);
  const expected = new Set(titles);
  if (
    !titles.length ||
    expected.size !== titles.length ||
    (spec.expectedCaseCount !== undefined && spec.expectedCaseCount !== titles.length)
  )
    errors.push('invalid-expected-case-set');
  const cases = all
    .filter(
      (c) =>
        ['passed', 'failed'].includes(c.status) ||
        expected.has(normalize(c.fullName ?? c.title ?? '')),
    )
    .map((c) => ({
      title: normalize(c.fullName ?? c.title ?? ''),
      status: c.status,
      duration: c.duration ?? 0,
      testFile: c.testFile,
    }));
  if (exitCode !== 0) errors.push(`exit:${exitCode}`);
  if (report?.success !== true) errors.push('report-not-success');
  if (!cases.length) errors.push('zero-executed-cases');
  for (const title of expected) {
    const found = cases.filter((c) => c.title === title);
    if (found.length !== 1 || found[0].status !== 'passed')
      errors.push(`expected-case-not-passed:${title}`);
  }
  for (const c of cases) if (!expected.has(c.title)) errors.push(`unexpected-case:${c.title}`);
  return { errors, cases };
}

// 新场景声明精确case身份和观察目标；旧run级材料保持原有粗粒度，不能自动获得逐case证明。
export function assessCaseEvidence(spec, cases, observations) {
  if (!Array.isArray(observations) || observations.some((o) => !object(o)))
    return { errors: ['invalid-observations-shape'], caseResults: [] };
  if (spec.caseEvidence === undefined) return { errors: [], caseResults: [] };
  const errors = [],
    caseResults = [],
    ids = new Set(),
    identities = new Set(),
    used = new Set();
  if (!Array.isArray(spec.caseEvidence) || spec.caseEvidence.some((c) => !object(c)))
    return { errors: ['invalid-case-evidence-shape'], caseResults: [] };
  if (!Array.isArray(observations) || observations.some((o) => !object(o)))
    return { errors: ['invalid-observations-shape'], caseResults: [] };
  if (!Array.isArray(cases)) return { errors: ['invalid-case-results-shape'], caseResults: [] };
  if (!spec.caseEvidence.length) errors.push('empty-case-evidence');
  for (const item of spec.caseEvidence) {
    const failures = [];
    const reject = (reason) => failures.push(`${item.id}:${reason}`);
    if (!/^[A-Z][A-Z0-9-]+$/.test(item.id ?? '') || ids.has(item.id)) reject('case-id');
    ids.add(item.id);
    const identity = `${item.testFile}\0${normalize(item.caseTitle ?? '')}`;
    if (identities.has(identity)) reject('duplicate-case-identity');
    identities.add(identity);
    for (const field of ['testFile', 'caseTitle', 'claim', 'fault', 'action'])
      if (typeof item[field] !== 'string' || !item[field].trim()) reject(`missing-${field}`);
    if (!(spec.testFiles ?? []).includes(item.testFile)) reject('undeclared-test-file');
    if (!(spec.expectedCaseTitles ?? []).map(normalize).includes(normalize(item.caseTitle ?? '')))
      reject('undeclared-case-title');
    if (
      !['normal', 'recovered', 'rejected', 'observed-boundary', 'risk-observed'].includes(
        item.outcome,
      )
    )
      reject('outcome');
    if (!['real-io', 'port-contract', 'mixed'].includes(item.fixture)) reject('fixture');
    if (
      !item.moduleRefs?.length ||
      !Array.isArray(item.failureRefs) ||
      !Array.isArray(item.stepRefs)
    )
      reject('references');
    if (!item.limitations?.length) reject('missing-limitations');
    if (
      !item.assertion?.assertionExcerpt ||
      item.assertion.path !== item.testFile ||
      !item.assertion.caseTitle ||
      !item.assertion.anchorSymbol ||
      !['direct', 'indirect'].includes(item.assertion.relation)
    )
      reject('assertion');
    const matched = cases.filter(
      (c) => c.testFile === item.testFile && c.title === normalize(item.caseTitle ?? ''),
    );
    if (matched.length !== 1 || matched[0].status !== 'passed') reject('case-not-passed');
    if (!Array.isArray(item.observationChecks)) reject('observation-checks');
    for (const check of item.observationChecks ?? []) {
      const validPath = (value) =>
        typeof value === 'string' &&
        value
          .split('.')
          .every(
            (k) =>
              /^[a-zA-Z0-9_-]+$/.test(k) && !['__proto__', 'prototype', 'constructor'].includes(k),
          );
      const operations = ['equals', 'equalsField', 'notEqualsField', 'greaterThanField'].filter(
        (k) => object(check) && Object.hasOwn(check, k),
      );
      if (
        !object(check) ||
        !validPath(check.field) ||
        operations.length !== 1 ||
        (operations[0] !== 'equals' && !validPath(check[operations[0]])) ||
        (check.format !== undefined && check.format !== 'sha256')
      ) {
        reject('observation-field');
        continue;
      }
      const found = observations.filter(
        (o) =>
          o.scenario === spec.id && o.caseId === item.id && o.observationId === check.observationId,
      );
      if (found.length !== 1) {
        reject('observation-identity');
        continue;
      }
      used.add(found[0]);
      const read = (field) =>
        field
          .split('.')
          .reduce(
            (value, key) =>
              value && typeof value === 'object' && Object.hasOwn(value, key)
                ? value[key]
                : undefined,
            found[0],
          );
      const value = read(check.field),
        operation = operations[0],
        expected = operation === 'equals' ? check.equals : read(check[operation]);
      const equal = JSON.stringify(value) === JSON.stringify(expected);
      const matches =
        operation === 'notEqualsField'
          ? !equal
          : operation === 'greaterThanField'
            ? typeof value === 'number' && typeof expected === 'number' && value > expected
            : equal;
      if (
        check.format === 'sha256' &&
        [value, expected].some(
          (v) => typeof v !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/.test(v),
        )
      )
        reject(`observation-hash:${check.field}`);
      if (value === undefined || expected === undefined || !matches)
        reject(`observation-value:${check.field}`);
    }
    errors.push(...failures);
    caseResults.push({
      id: item.id,
      status: failures.length ? 'unsupported' : 'supported',
      errors: failures,
    });
  }
  for (const c of cases)
    if (!identities.has(`${c.testFile}\0${c.title}`))
      errors.push(`unmapped-case:${c.testFile}:${c.title}`);
  for (const observation of observations)
    if (!used.has(observation)) errors.push('unbound-observation');
  return { errors, caseResults };
}

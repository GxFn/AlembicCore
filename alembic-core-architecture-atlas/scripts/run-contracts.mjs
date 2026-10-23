export const requiredHarnessFiles = [
  'scripts/run-evidence.mjs',
  'scripts/run-contracts.mjs',
  'scripts/contracts.mjs',
  'probes/vitest.config.ts',
  'probes/recovery.test.ts',
  'evidence/scenarios.json',
];
const normalize = (t) => t.trim().replace(/\s+/g, ' ');
export function assessRunReport(report, spec, exitCode) {
  const errors = [];
  const all = (report.testResults ?? []).flatMap((s) => s.assertionResults ?? []);
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
    }));
  if (exitCode !== 0) errors.push(`exit:${exitCode}`);
  if (report.success !== true) errors.push('report-not-success');
  if (!cases.length) errors.push('zero-executed-cases');
  for (const title of expected) {
    const found = cases.filter((c) => c.title === title);
    if (found.length !== 1 || found[0].status !== 'passed')
      errors.push(`expected-case-not-passed:${title}`);
  }
  for (const c of cases) if (!expected.has(c.title)) errors.push(`unexpected-case:${c.title}`);
  return { errors, cases };
}

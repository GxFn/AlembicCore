import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRunReport } from '../scripts/run-evidence.mjs';
const spec = { expectedCaseTitles: ['scope first', 'scope second'] };
const report = {
  success: true,
  testResults: [
    {
      assertionResults: [
        { fullName: 'scope first', status: 'passed' },
        { fullName: 'scope second', status: 'passed' },
        { fullName: 'outside', status: 'skipped' },
      ],
    },
  ],
};
test('仅实际匹配全部预期case且退出成功才产生有范围通过', () => {
  const result = assessRunReport(report, spec, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.cases.length, 2);
  for (const modify of [
    (r) => (r.testResults = []),
    (r) => r.testResults[0].assertionResults.forEach((c) => (c.status = 'skipped')),
    (r) => (r.testResults[0].assertionResults[0].status = 'failed'),
    (r) => r.testResults[0].assertionResults.push({ fullName: 'unplanned', status: 'passed' }),
  ]) {
    const changed = structuredClone(report);
    modify(changed);
    assert.ok(assessRunReport(changed, spec, 0).errors.length);
  }
  assert.ok(assessRunReport(report, spec, 1).errors.length);
});

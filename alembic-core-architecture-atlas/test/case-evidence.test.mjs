import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRunReport, assessCaseEvidence } from '../scripts/run-contracts.mjs';
import { runScenarios } from '../scripts/book.mjs';

const claim = {
  id: 'V06-D1',
  testFile: 'test/delete.test.ts',
  caseTitle: 'deletion same id retry',
  outcome: 'recovered',
  fixture: 'real-io',
  claim: '相同ID删除恢复后主行和文件均不存在。',
  fault: '文件移除后DB拒绝',
  action: '排故后同ID delete',
  failureRefs: ['F-delete-db'],
  moduleRefs: ['M10-06'],
  stepRefs: ['J01-D1'],
  assertion: {
    relation: 'direct',
    path: 'test/delete.test.ts',
    caseTitle: 'same id retry',
    anchorSymbol: 'service',
    assertedBehavior: '同ID恢复',
    assertionExcerpt: 'expect(row).toBeNull();',
    scenarioKind: 'recovery',
  },
  observationChecks: [{ observationId: 'delete-state', field: 'remainingRows', equals: 0 }],
  limitations: ['不证明事件监听器原子性。'],
};
const spec = {
  id: 'V06',
  expectedCaseTitles: [claim.caseTitle],
  expectedCaseCount: 1,
  expectedProbeCount: 1,
  testFiles: [claim.testFile],
  caseEvidence: [claim],
};
const report = {
  success: true,
  testResults: [
    {
      name: '<core>/test/delete.test.ts',
      assertionResults: [{ fullName: claim.caseTitle, status: 'passed' }],
    },
  ],
};
const observations = [
  { scenario: 'V06', caseId: claim.id, observationId: 'delete-state', remainingRows: 0 },
];
test('runner脱敏后的Atlas探针路径仍恢复为Core相对测试身份', () => {
  const data = structuredClone(report);
  data.testResults[0].name = '<atlas>/probes/recovery.test.ts';
  assert.equal(
    assessRunReport(data, spec, 0).cases[0].testFile,
    'alembic-core-architecture-atlas/probes/recovery.test.ts',
  );
});
test('逐case证据绑定实际测试文件、完整标题和观察归属，不能靠同名case或同数量观察签通过', () => {
  const assessed = assessRunReport(report, spec, 0);
  assert.deepEqual(assessed.errors, []);
  assert.equal(assessed.cases[0].testFile, claim.testFile);
  assert.equal(
    assessCaseEvidence(spec, assessed.cases, observations).caseResults[0].status,
    'supported',
  );
  for (const change of [
    (x) => (x.report.testResults[0].name = '<core>/test/unrelated.test.ts'),
    (x) => (x.observations[0].caseId = 'V06-other'),
    (x) => (x.observations[0].scenario = 'V01'),
    (x) => (x.observations[0].observationId = 'some-other-observation'),
    (x) => (x.observations[0].remainingRows = 1),
    (x) => delete x.observations[0].remainingRows,
    (x) => x.observations.push(x.observations[0]),
  ]) {
    const x = structuredClone({ report, observations });
    change(x);
    const cases = assessRunReport(x.report, spec, 0).cases;
    assert.ok(assessCaseEvidence(spec, cases, x.observations).errors.length);
  }
});
test('错误业务结论、孤立case声明、重复ID和无断言的映射拒绝；旧run级证据保持粗粒度', () => {
  const cases = assessRunReport(report, spec, 0).cases;
  for (const change of [
    (x) => (x.caseEvidence[0].outcome = 'everything-healthy'),
    (x) => (x.caseEvidence[0].caseTitle = 'other case'),
    (x) => x.caseEvidence.push(x.caseEvidence[0]),
    (x) => (x.caseEvidence[0].assertion.assertionExcerpt = ''),
    (x) => (x.caseEvidence[0].observationChecks[0].field = '__proto__.value'),
  ]) {
    const copy = structuredClone(spec);
    change(copy);
    assert.ok(assessCaseEvidence(copy, cases, observations).errors.length);
  }
  assert.deepEqual(assessCaseEvidence({ expectedProbeCount: 0 }, cases, []), {
    errors: [],
    caseResults: [],
  });
});

export { claim, spec, report, observations };

test('新场景的run级说明与case结论保持同一来源，旧场景说明仍保留', () => {
  const scenarios = runScenarios();
  for (const scenario of scenarios.filter((s) => s.caseEvidence))
    assert.deepEqual(
      scenario.observations,
      scenario.caseEvidence.map((c) => c.claim),
    );
  assert.ok(scenarios.find((s) => s.id === 'V01').observations.length);
});

test('观察中的实际字段必须彼此一致，派生布尔不能掩盖矛盾；坏形状留下失败评估', () => {
  const copy = structuredClone(spec);
  copy.caseEvidence[0].observationChecks = [
    {
      observationId: 'delete-state',
      field: 'beforeHash',
      equalsField: 'afterHash',
      format: 'sha256',
    },
  ];
  const cases = assessRunReport(report, spec, 0).cases;
  const observation = {
    ...observations[0],
    beforeHash: 'a'.repeat(64),
    afterHash: 'b'.repeat(64),
    hashUnchanged: true,
  };
  assert.ok(assessCaseEvidence(copy, cases, [observation]).errors.length);
  observation.afterHash = observation.beforeHash;
  assert.deepEqual(assessCaseEvidence(copy, cases, [observation]).errors, []);
  observation.beforeHash = observation.afterHash = 'not-a-hash';
  assert.ok(assessCaseEvidence(copy, cases, [observation]).errors.length);
  for (const malformed of [[null], [[]], null, { length: 1 }])
    assert.ok(assessCaseEvidence(copy, cases, malformed).errors.length);
  assert.ok(assessRunReport(null, spec, 0).errors.length);
});

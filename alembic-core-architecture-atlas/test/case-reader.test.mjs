import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failuresPage } from '../src/book-content.ts';
import { caseEvidenceMarkdown } from '../src/case-content.ts';
const failure = (id, refs, runbook) => ({
  id,
  moduleRefs: refs,
  runbook,
  route: '#10~f-' + id,
  topicId: '10',
  trigger: id,
  remainingState: '已写入',
  explicitRecovery: '重读状态',
  test: { relation: 'none' },
});
const claim = {
  id: 'V06-C1',
  testFile: 'test/example.test.ts',
  caseTitle: 'scope actual case',
  outcome: 'risk-observed',
  fixture: 'real-io',
  claim: '受控风险被观察',
  fault: '一次读取拒绝',
  action: '重读真实状态',
  moduleRefs: ['M10-01'],
  failureRefs: ['F1'],
  stepRefs: [],
  assertion: { assertionExcerpt: 'expect(actual).toBe(true);' },
  observationChecks: [],
  limitations: ['不代表已修复'],
};
const book = {
  failures: [failure('F1', ['M10-01'], {}), failure('F2', [], undefined)],
  modules: [],
  journeys: [],
  runs: [
    {
      id: 'V06',
      title: '实际样本',
      status: 'passed',
      caseEvidence: [claim],
      caseResults: [{ id: claim.id, status: 'supported', errors: [] }],
      cases: [{ title: claim.caseTitle, status: 'passed' }],
      limitations: [],
      journeyRefs: [],
      failureRefs: ['F1'],
    },
  ],
};
test('缺口筛选只按明确记录分类，已知观察不能被运行pass显示为恢复成功', () => {
  assert.ok(!failuresPage(book, '', 'no-module').includes('f-F1'));
  assert.ok(failuresPage(book, '', 'no-module').includes('f-F2'));
  assert.ok(!failuresPage(book, '', 'no-case').includes('f-F1'));
  const rendered = caseEvidenceMarkdown(book.runs[0], book);
  assert.ok(rendered.includes('case-V06-C1'));
  assert.ok(rendered.includes('风险观察'));
  assert.ok(rendered.includes('不代表已修复'));
  const stale = structuredClone(book);
  stale.runs[0].status = 'stale';
  assert.ok(caseEvidenceMarkdown(stale.runs[0], stale).includes('本记录不支持当前结论'));
});

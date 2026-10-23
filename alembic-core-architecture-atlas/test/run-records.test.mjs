import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha } from '../scripts/contracts.mjs';
import { requiredHarnessFiles, assessRunReport } from '../scripts/run-contracts.mjs';
import { verifyRunRecord } from '../scripts/run-records.mjs';
test('原始报告、回执或harness缺失/篡改不能沿用绿色；源码变化单列stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-run-proof-'));
  try {
    const atlas = path.join(root, 'atlas'),
      ledger = path.join(root, 'ledger');
    fs.mkdirSync(ledger);
    for (const p of requiredHarnessFiles) {
      fs.mkdirSync(path.dirname(path.join(atlas, p)), { recursive: true });
      fs.writeFileSync(path.join(atlas, p), 'fixture harness');
    }
    const spec = {
      id: 'V01',
      expectedCaseTitles: ['actual case'],
      expectedCaseCount: 1,
      expectedProbeCount: 0,
    };
    const report = JSON.stringify({
      success: true,
      testResults: [
        { assertionResults: [{ fullName: 'actual case', status: 'passed', duration: 1 }] },
      ],
    });
    const environment = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      vitest: 'fixture',
    };
    const record = {
      environment,
      id: 'V01',
      status: 'passed',
      sourceDigest: 'source-A',
      exitCode: 0,
      harnessFiles: requiredHarnessFiles.map((p) => ({ path: p, sha256: sha('fixture harness') })),
      cases: assessRunReport(JSON.parse(report), spec, 0).cases,
      errors: [],
      probeObservations: [],
      rawRef: 'report.json',
      rawSha256: sha(report),
      consoleRef: 'console.txt',
      consoleSha256: sha('actual output'),
      observationsRef: 'observations.json',
      observationsSha256: sha('[]'),
    };
    fs.writeFileSync(path.join(ledger, 'report.json'), report);
    fs.writeFileSync(path.join(ledger, 'console.txt'), 'actual output');
    fs.writeFileSync(path.join(ledger, 'observations.json'), '[]');
    const rawReceipt = JSON.stringify(record);
    fs.writeFileSync(path.join(ledger, 'receipt.json'), rawReceipt);
    const portable = { ...record, receiptRef: 'receipt.json', receiptSha256: sha(rawReceipt) };
    const evaluate = (r) =>
      verifyRunRecord({ atlas, ledger, productDigest: 'source-A', record: r, spec, environment });
    assert.equal(evaluate(portable).status, 'passed');
    assert.equal(
      verifyRunRecord({
        atlas,
        ledger,
        productDigest: 'source-B',
        record: portable,
        spec,
        environment,
      }).status,
      'stale',
    );
    assert.equal(evaluate({ ...portable, harnessFiles: [] }).status, 'unavailable');
    assert.equal(evaluate({ ...portable, cases: [] }).status, 'unavailable');
    fs.writeFileSync(path.join(ledger, 'report.json'), report + ' ');
    assert.equal(evaluate(portable).status, 'unavailable');
    fs.unlinkSync(path.join(ledger, 'report.json'));
    assert.equal(evaluate(portable).status, 'missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('重复预期标题或预期count不符不能折叠成一次通过', () => {
  const report = {
    success: true,
    testResults: [{ assertionResults: [{ fullName: 'one', status: 'passed' }] }],
  };
  assert.ok(
    assessRunReport(report, { expectedCaseTitles: ['one', 'one'], expectedCaseCount: 2 }, 0).errors
      .length,
  );
  assert.ok(
    assessRunReport(report, { expectedCaseTitles: ['one'], expectedCaseCount: 2 }, 0).errors.length,
  );
  assert.ok(
    assessRunReport({ success: true, testResults: [] }, { expectedCaseTitles: [] }, 0).errors
      .length,
  );
});

test('原始材料一致但观察未满足case声明时，维护复验仍拒绝伪supported', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-case-proof-'));
  try {
    const atlas = path.join(root, 'atlas'),
      ledger = path.join(root, 'ledger');
    fs.mkdirSync(ledger);
    for (const p of requiredHarnessFiles) {
      fs.mkdirSync(path.dirname(path.join(atlas, p)), { recursive: true });
      fs.writeFileSync(path.join(atlas, p), 'fixture');
    }
    const spec = {
      id: 'V06',
      expectedCaseTitles: ['delete retry'],
      expectedCaseCount: 1,
      expectedProbeCount: 1,
      testFiles: ['test/delete.test.ts'],
      caseEvidence: [
        {
          id: 'V06-D1',
          testFile: 'test/delete.test.ts',
          caseTitle: 'delete retry',
          outcome: 'recovered',
          fixture: 'real-io',
          claim: '主行已删除',
          fault: 'DB拒绝',
          action: '同ID重试',
          moduleRefs: ['M10-06'],
          failureRefs: ['F-delete'],
          stepRefs: [],
          limitations: ['只覆盖此夹具'],
          assertion: {
            relation: 'direct',
            path: 'test/delete.test.ts',
            caseTitle: 'retry',
            anchorSymbol: 'service',
            assertionExcerpt: 'expect(rows).toBe(0);',
          },
          observationChecks: [{ observationId: 'state', field: 'rows', equals: 0 }],
        },
      ],
    };
    const raw = {
      success: true,
      testResults: [
        {
          name: '<core>/test/delete.test.ts',
          assertionResults: [{ fullName: 'delete retry', status: 'passed' }],
        },
      ],
    };
    const environment = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      vitest: 'fixture',
    };
    const seal = (rows, extra = {}) => {
      const report = JSON.stringify(raw),
        observations = JSON.stringify([
          { scenario: 'V06', caseId: 'V06-D1', observationId: 'state', rows },
        ]);
      const record = {
        id: 'V06',
        status: 'passed',
        exitCode: 0,
        sourceDigest: 'source-A',
        environment,
        harnessFiles: requiredHarnessFiles.map((p) => ({ path: p, sha256: sha('fixture') })),
        cases: assessRunReport(raw, spec, 0).cases,
        errors: [],
        probeObservations: JSON.parse(observations),
        caseResults: [{ id: 'V06-D1', status: 'supported', errors: [] }],
        rawRef: 'report.json',
        rawSha256: sha(report),
        consoleRef: 'console.txt',
        consoleSha256: sha('output'),
        observationsRef: 'observations.json',
        observationsSha256: sha(observations),
      };
      fs.writeFileSync(path.join(ledger, 'report.json'), report);
      fs.writeFileSync(path.join(ledger, 'console.txt'), 'output');
      fs.writeFileSync(path.join(ledger, 'observations.json'), observations);
      Object.assign(record, extra);
      const receipt = JSON.stringify(record);
      fs.writeFileSync(path.join(ledger, 'receipt.json'), receipt);
      return { ...record, receiptRef: 'receipt.json', receiptSha256: sha(receipt) };
    };
    const evaluate = (record) =>
      verifyRunRecord({ atlas, ledger, productDigest: 'source-A', record, spec, environment });
    assert.equal(evaluate(seal(1)).status, 'unavailable');
    assert.equal(evaluate(seal(0)).status, 'passed');
    const forged = evaluate(
      seal(0, {
        caseEvidence: [{ ...spec.caseEvidence[0], claim: '全系统恢复', outcome: 'normal' }],
      }),
    );
    assert.equal(forged.status, 'unavailable');
    assert.equal(forged.caseEvidence, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

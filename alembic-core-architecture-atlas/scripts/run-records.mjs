import { readFileSync } from 'node:fs';
import { sha, safeFile } from './contracts.mjs';
import { requiredHarnessFiles, assessRunReport } from './run-contracts.mjs';
// 便携摘要不是原始运行权威；只有显式维护检查才接触ledger并重评选定case。
export function verifyRunRecord({ atlas, ledger, productDigest, record, spec, environment }) {
  const fail = (status, verification) => ({ ...record, status, verification });
  if (record.id !== spec.id) return fail('unavailable', '回执身份不符');
  const harness = record.harnessFiles ?? [];
  if (
    harness.length !== requiredHarnessFiles.length ||
    new Set(harness.map((f) => f.path)).size !== requiredHarnessFiles.length ||
    requiredHarnessFiles.some((p) => !harness.some((f) => f.path === p))
  )
    return fail('unavailable', '必需的运行harness身份不完整');
  try {
    const pairs = [
      [record.rawRef, record.rawSha256],
      [record.consoleRef, record.consoleSha256],
      [record.observationsRef, record.observationsSha256],
      [record.receiptRef, record.receiptSha256],
    ];
    const raws = pairs.map(([path, digest]) => {
      if (!path || !digest) throw Error('run-material-reference-missing');
      const raw = readFileSync(safeFile(ledger, path), 'utf8');
      if (sha(raw) !== digest) throw Error('run-material-digest-mismatch');
      return raw;
    });
    const { receiptRef, receiptSha256, ...summary } = record;
    if (JSON.stringify(JSON.parse(raws[3])) !== JSON.stringify(summary))
      throw Error('run-summary-mismatch');
    const assessment = assessRunReport(JSON.parse(raws[0]), spec, record.exitCode);
    if (JSON.stringify(assessment.cases) !== JSON.stringify(record.cases))
      throw Error('run-cases-mismatch');
    if (JSON.stringify(JSON.parse(raws[2])) !== JSON.stringify(record.probeObservations))
      throw Error('run-observations-mismatch');
    if (
      record.status === 'passed' &&
      (assessment.errors.length ||
        (record.errors ?? []).length ||
        (record.probeObservations ?? []).length !== (spec.expectedProbeCount ?? 0))
    )
      throw Error('run-pass-not-supported');
    if (record.status !== 'passed' && record.status !== 'failed')
      throw Error('run-recorded-status-invalid');
    if (!record.environment || !environment) return fail('unavailable', '运行环境身份缺失');
    if (Object.entries(environment).some(([k, v]) => record.environment[k] !== v))
      return fail('stale', '运行工具或平台已变；仅保留历史执行结论');
    if (
      record.sourceDigest !== productDigest ||
      harness.some((f) => sha(readFileSync(safeFile(atlas, f.path))) !== f.sha256)
    )
      return fail('stale', '生产来源或探针已变；仅保留历史执行结论');
    return fail(
      record.status,
      '快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger',
    );
  } catch (error) {
    return fail(
      error.code === 'ENOENT' ? 'missing' : 'unavailable',
      `原始材料不可核验：${error.message}`,
    );
  }
}

import { readFileSync, writeFileSync, mkdirSync, existsSync, globSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { snapshot, sha, safeFile } from './contracts.mjs';
import { productPaths } from './atlas.mjs';
import { runScenarios } from './book.mjs';
const atlas = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  core = resolve(atlas, '..'),
  ledger = resolve(core, '../wakeflow-ledger/AlembicCore');
export { assessRunReport } from './run-contracts.mjs';
import { assessRunReport, requiredHarnessFiles } from './run-contracts.mjs';
const redact = (s) =>
  s
    .replaceAll(atlas, '<atlas>')
    .replaceAll(core, '<core>')
    .replaceAll(os.tmpdir(), '<tmp>')
    .replaceAll(os.homedir(), '<home>');
export function executeScenario(spec) {
  if (!/^V\d\d$/.test(spec.id)) throw Error('invalid-scenario-id');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'),
    runId = `${spec.id.toLowerCase()}-${stamp}`;
  const temp = resolve(atlas, '.build/runs', runId),
    rawDir = resolve(ledger, 'architecture-atlas/runs', stamp.slice(0, 10), runId);
  mkdirSync(temp, { recursive: true });
  mkdirSync(rawDir, { recursive: true });
  const files = productPaths(),
    before = snapshot(core, files).digest;
  const harnessPaths = requiredHarnessFiles;
  const harnessFiles = harnessPaths.map((path) => ({
    path,
    sha256: sha(readFileSync(safeFile(atlas, path))),
  }));
  const reportPath = resolve(temp, 'report.json');
  const selected = spec.cliTestFiles ?? spec.testFiles;
  for (const p of selected)
    if (!p.startsWith('test/') && !p.startsWith('alembic-core-architecture-atlas/probes/'))
      throw Error('scenario-test-outside-scope');
  for (const p of selected) safeFile(core, p);
  const args = [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...selected,
    '--config',
    'alembic-core-architecture-atlas/probes/vitest.config.ts',
    '--testNamePattern',
    spec.testNamePattern,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ];
  const command = spawnSync(process.execPath, args, {
    cwd: core,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      ALEMBIC_QUIET: '1',
      ATLAS_OBSERVATION_DIR: resolve(temp, 'observations'),
    },
  });
  const output = redact((command.stdout ?? '') + '\n' + (command.stderr ?? ''));
  writeFileSync(resolve(rawDir, 'console.txt'), output);
  let report = {},
    reportText = '{}';
  const executionErrors = [];
  try {
    if (existsSync(reportPath)) {
      reportText = redact(readFileSync(reportPath, 'utf8'));
      report = JSON.parse(reportText);
    } else executionErrors.push('report-missing');
  } catch (error) {
    executionErrors.push('report-parse:' + error.message);
  }
  writeFileSync(resolve(rawDir, 'report.json'), reportText);
  const assessment = assessRunReport(report, spec, command.status);
  assessment.errors.push(...executionErrors);
  try {
    if (snapshot(core, productPaths()).digest !== before)
      assessment.errors.push('source-changed-during-run');
    if (harnessFiles.some((f) => sha(readFileSync(safeFile(atlas, f.path))) !== f.sha256))
      assessment.errors.push('harness-changed-during-run');
  } catch (error) {
    assessment.errors.push('input-observation:' + error.message);
  }
  let probeObservations = [];
  try {
    probeObservations = globSync('observations/*.json', { cwd: temp }).map((p) =>
      JSON.parse(readFileSync(resolve(temp, p), 'utf8')),
    );
  } catch (error) {
    assessment.errors.push('probe-observation-parse:' + error.message);
  }
  if (probeObservations.length !== (spec.expectedProbeCount ?? 0))
    assessment.errors.push('probe-observation-count');
  const observationsText = JSON.stringify(probeObservations, null, 2) + '\n';
  writeFileSync(resolve(rawDir, 'observations.json'), observationsText);
  const rawRef = `architecture-atlas/runs/${stamp.slice(0, 10)}/${runId}/report.json`;
  const record = {
    schemaVersion: 1,
    observationsRef: rawRef.replace('report.json', 'observations.json'),
    observationsSha256: sha(observationsText),
    id: spec.id,
    title: spec.title,
    status: assessment.errors.length ? 'failed' : 'passed',
    observedAt: new Date().toISOString(),
    exitCode: command.status,
    sourceDigest: before,
    sourceScope: '完整Core产品库存，变化时保守要求重验',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      vitest: JSON.parse(readFileSync(resolve(core, 'node_modules/vitest/package.json'), 'utf8'))
        .version,
    },
    harnessFiles,
    cases: assessment.cases,
    probeObservations,
    errors: assessment.errors,
    rawRef,
    rawSha256: sha(reportText),
    consoleRef: rawRef.replace('report.json', 'console.txt'),
    consoleSha256: sha(output),
    command: {
      executable: 'node',
      args: args.map((a) =>
        a.startsWith('--outputFile=') ? '--outputFile=<fixed-atlas-build-report>' : a,
      ),
    },
  };
  const receiptText = JSON.stringify(record, null, 2) + '\n';
  writeFileSync(resolve(rawDir, 'receipt.json'), receiptText);
  const portable = {
    ...record,
    receiptRef: rawRef.replace('report.json', 'receipt.json'),
    receiptSha256: sha(receiptText),
  };
  writeFileSync(
    resolve(atlas, `evidence/runs/${spec.id}.json`),
    JSON.stringify(portable, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      id: spec.id,
      status: record.status,
      cases: record.cases.length,
      probeObservations: probeObservations.length,
      errors: record.errors,
    }),
  );
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2] ?? 'all';
  const scenarios = runScenarios().filter((s) => id === 'all' || s.id === id);
  if (!scenarios.length) throw Error('unknown-scenario');
  let failed = false;
  for (const s of scenarios) if (executeScenario(s).status !== 'passed') failed = true;
  if (failed) process.exitCode = 1;
}

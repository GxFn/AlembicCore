import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const atlas = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'core-atlas-portable-')),
  core = path.join(workspace, 'Core'),
  copy = path.join(core, 'atlas');
const keep = process.argv.includes('--keep');
const report = {
  scope: 'detached-build',
  fixtureName: path.basename(workspace),
  coreSourcePresent: false,
  ledgerPresent: false,
  consumerPresent: false,
  checks: [],
  errors: [],
  limitations: [
    '复用已安装的Node依赖；不代表另一台机器的首次npm ci或离线安装验证。',
    '静态快照的历史来源结果保留；此副本不能重新核验原ledger或产品源码。',
  ],
};
try {
  fs.mkdirSync(copy, { recursive: true });
  const entries = [
    'src',
    'schemas',
    'scripts',
    'maps',
    'journeys',
    'objects',
    'evidence',
    'reviews',
    'data',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'site.config.ts',
    'index.html',
    'README.md',
  ];
  for (const name of entries)
    fs.cpSync(path.join(atlas, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(atlas, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  report.coreSourcePresent = fs.existsSync(path.join(core, 'src'));
  report.ledgerPresent = fs.existsSync(path.join(workspace, 'wakeflow-ledger'));
  report.consumerPresent = fs.existsSync(path.join(workspace, 'Alembic'));
  if (report.coreSourcePresent || report.ledgerPresent || report.consumerPresent)
    throw Error('portable-fixture-not-isolated');
  for (const [label, args] of [
    ['build', [path.join(copy, 'node_modules/vite/bin/vite.js'), 'build']],
    ['build-assets', [path.join(copy, 'scripts/check-build.mjs')]],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: copy,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const text = ((result.stdout ?? '') + '\n' + (result.stderr ?? ''))
      .replaceAll(workspace, '<portable-fixture>')
      .replaceAll(atlas, '<atlas>')
      .replaceAll(os.homedir(), '<home>');
    fs.mkdirSync(path.join(atlas, '.build'), { recursive: true });
    fs.writeFileSync(path.join(atlas, `.build/portable-${label}.txt`), text);
    report.checks.push({ name: label, exitCode: result.status });
    if (result.status !== 0) report.errors.push(`${label}:${result.status}`);
  }
  if (keep && report.errors.length === 0)
    fs.writeFileSync(
      path.join(atlas, '.build/portable-location.json'),
      JSON.stringify({ workspace, project: copy, site: path.join(copy, '.build/site') }, null, 2) +
        '\n',
    );
} catch (error) {
  report.errors.push(error.message);
} finally {
  fs.writeFileSync(
    path.join(atlas, '.build/portable-check.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  if (!keep || report.errors.length) fs.rmSync(workspace, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;

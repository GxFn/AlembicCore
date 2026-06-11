// Blocking consumer-import gate for `npm run check` (CO1): scans every sibling
// consumer repository against its own core-import boundary config using
// lint-consumer-core-imports.mjs. A sibling that is absent in this checkout is
// reported as skipped (its own CI guards its tree); a present sibling with
// boundary issues, or a scan that cannot run, fails the gate.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CORE_CONSUMER_REPOS } from './public-api-boundary-policy.mjs';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function scanConsumer(consumer) {
  const rootPath = path.resolve(CORE_ROOT, consumer.root);
  const configPath = path.resolve(CORE_ROOT, consumer.configPath);

  if (!existsSync(rootPath)) {
    return { name: consumer.name, reason: 'consumer root is not present in this checkout', status: 'skipped' };
  }

  if (!existsSync(configPath)) {
    return { name: consumer.name, reason: 'consumer boundary config is not present in this checkout', status: 'skipped' };
  }

  const args = [
    path.join(CORE_ROOT, 'scripts/lint-consumer-core-imports.mjs'),
    rootPath,
    '--config',
    configPath,
    '--format=json',
  ];

  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: CORE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { name: consumer.name, result: JSON.parse(stdout), status: 'scanned' };
  } catch (error) {
    const parsed = parseJsonOutput(typeof error?.stdout === 'string' ? error.stdout : '');
    return {
      name: consumer.name,
      reason: error instanceof Error ? error.message : String(error),
      result: parsed,
      status: parsed ? 'scanned-with-issues' : 'failed',
    };
  }
}

function main() {
  const scans = CORE_CONSUMER_REPOS.map(scanConsumer);
  let failing = 0;

  for (const scan of scans) {
    if (scan.status === 'skipped') {
      console.log(`- ${scan.name}: skipped (${scan.reason}).`);
      continue;
    }

    if (scan.status === 'failed') {
      failing += 1;
      console.log(`- ${scan.name}: FAILED to scan (${scan.reason}).`);
      continue;
    }

    const issueCount = scan.result.issueCount ?? 0;
    const byStatus = scan.result.byStatus ?? {};
    console.log(
      `- ${scan.name}: files=${scan.result.filesScanned}, refs=${scan.result.referencesScanned}, issues=${issueCount}, stable=${byStatus['stable-public'] ?? 0}, provisional=${byStatus['provisional-public'] ?? 0}, transitional=${byStatus['transitional-internal'] ?? 0}.`,
    );
    if (issueCount > 0) {
      failing += 1;
      for (const issue of scan.result.issues ?? []) {
        console.log(`  - ${issue.file ?? ''}:${issue.line ?? ''} ${issue.specifier ?? ''} ${issue.message ?? issue.kind ?? ''}`);
      }
    }
  }

  if (failing > 0) {
    console.log(`Consumer core-import gate failed: ${failing} consumer(s) with issues or scan failures.`);
    process.exitCode = 1;
    return;
  }

  console.log('Consumer core-import gate OK.');
}

main();

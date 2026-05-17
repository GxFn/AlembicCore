import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  makePublicApiBoundaryClassifier,
  loadPublicApiBoundaryPolicy,
  summarizePublicApiExports,
} from './public-api-boundary-policy.mjs';

function readPackageJson() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

function parseArgs(argv) {
  const options = { format: 'text', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--format') {
      index += 1;
      options.format = argv[index] ?? 'text';
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.format !== 'text' && options.format !== 'json') {
    throw new Error(`Unsupported --format value: ${options.format}`);
  }

  return options;
}

function compareCounts(actual, expected) {
  return Object.keys(expected).flatMap((status) => {
    const actualCount = actual[status] ?? 0;
    const expectedCount = expected[status] ?? 0;
    if (actualCount === expectedCount) {
      return [];
    }
    return [{ actual: actualCount, expected: expectedCount, status }];
  });
}

function findMissingPolicyExports(policy, exportPaths) {
  const exported = new Set(exportPaths);
  return {
    stablePublicExports: policy.stablePublicExports.filter((exportPath) => !exported.has(exportPath)),
    provisionalPublicExports: policy.provisionalPublicExports.filter(
      (exportPath) => !exported.has(exportPath),
    ),
    transitionalInternalExports: policy.transitionalInternalExports.filter(
      (exportPath) => !exported.has(exportPath),
    ),
  };
}

function buildReport() {
  const pkg = readPackageJson();
  const policy = loadPublicApiBoundaryPolicy();
  const classifier = makePublicApiBoundaryClassifier(policy);
  const exportPaths = Object.keys(pkg.exports);
  const summary = summarizePublicApiExports(exportPaths, policy);
  const unclassified = exportPaths.filter((exportPath) => !classifier(exportPath));
  const wildcardPublicExports = exportPaths.filter((exportPath) => {
    const classification = classifier(exportPath);
    return exportPath.includes('*') && classification?.status !== 'transitional-internal';
  });
  const countMismatches = compareCounts(summary, policy.expectedCounts);
  const missingPolicyExports = findMissingPolicyExports(policy, exportPaths);
  const missingPolicyExportCount = Object.values(missingPolicyExports).reduce(
    (sum, values) => sum + values.length,
    0,
  );
  const issues = [
    ...unclassified.map((exportPath) => ({
      kind: 'unclassified-export',
      exportPath,
      message: 'Package export is not classified in public-api-boundary policy.',
    })),
    ...wildcardPublicExports.map((exportPath) => ({
      kind: 'wildcard-not-transitional',
      exportPath,
      message: 'Wildcard exports must remain transitional during boundary construction.',
    })),
    ...countMismatches.map((mismatch) => ({
      kind: 'status-count-mismatch',
      status: mismatch.status,
      message: `${mismatch.status}: expected ${mismatch.expected}, found ${mismatch.actual}.`,
    })),
  ];

  if (missingPolicyExportCount > 0) {
    issues.push({
      kind: 'missing-policy-exports',
      message: 'Public API policy lists exports that are missing from package.json.',
      missingPolicyExports,
    });
  }

  return {
    exportCount: exportPaths.length,
    exactExportCount: exportPaths.filter((exportPath) => !exportPath.includes('*')).length,
    issueCount: issues.length,
    issues,
    packageName: pkg.name,
    summary,
    wildcardExportCount: exportPaths.filter((exportPath) => exportPath.includes('*')).length,
  };
}

function formatTextReport(report) {
  if (report.issueCount === 0) {
    return [
      `Public API boundary OK: ${report.exportCount} package exports classified.`,
      `Exact exports: ${report.exactExportCount}; wildcard exports: ${report.wildcardExportCount}.`,
      `Status summary: stable=${report.summary['stable-public']}, provisional=${report.summary['provisional-public']}, transitional=${report.summary['transitional-internal']}.`,
    ].join('\n');
  }

  return [
    `Public API boundary failed: ${report.issueCount} issue(s).`,
    ...report.issues.map((issue) => `- ${issue.kind}: ${issue.message}`),
  ].join('\n');
}

function printHelp() {
  console.log(`Usage: node scripts/check-public-api-boundary.mjs [--format text|json]

Checks package.json exports against config/public-api-boundary.json.

Phase 9 rule: public API surface changes must update the machine-readable policy,
tests, and migration notes together.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = buildReport();
  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  if (report.issueCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

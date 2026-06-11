import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  getPublicApiCloseoutDeprecations,
  getPublicApiCloseoutManualCategories,
  getPublicApiCloseoutMaxCounts,
  getPublicApiCloseoutReviewBy,
  getPublicApiFacadeReadiness,
  getPublicApiNarrowness,
  getPublicApiRemovedExports,
  getPublicApiTransitionalOwnership,
  getPublicApiTrend,
  makePublicApiBoundaryClassifier,
  loadPublicApiBoundaryPolicy,
  PUBLIC_API_BOUNDARY_POLICY_URL,
  summarizePublicApiExports,
} from './public-api-boundary-policy.mjs';

const CORE_PACKAGE_NAME = '@alembic/core';

function readPackageJson() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

function parseArgs(argv) {
  const options = { format: 'text', help: false, recordTrend: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--record-trend') {
      options.recordTrend = true;
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

function buildCloseoutSummary(policy, exportPaths, summary) {
  const wildcardExportPaths = exportPaths.filter((exportPath) => exportPath.includes('*'));
  const maxCounts = getPublicApiCloseoutMaxCounts(policy);
  const closeoutExportPaths = new Set([...policy.transitionalInternalExports, ...wildcardExportPaths]);
  const manualCategories = getPublicApiCloseoutManualCategories(policy);
  const manualCategoryCounts = Object.fromEntries(
    Object.entries(manualCategories).map(([category, values]) => [category, values.length]),
  );
  const manualIssues = Object.entries(manualCategories).flatMap(([category, values]) =>
    values
      .filter((exportPath) => !closeoutExportPaths.has(exportPath))
      .map((exportPath) => ({
        category,
        exportPath,
        kind: 'closeout-unknown-export',
        message: `Closeout category ${category} references an export that is not transitional or wildcard.`,
      })),
  );
  const countIssues = [];

  if (maxCounts) {
    const transitionalCount = summary['transitional-internal'] ?? 0;
    if (transitionalCount > maxCounts['transitional-internal']) {
      countIssues.push({
        actual: transitionalCount,
        expected: maxCounts['transitional-internal'],
        kind: 'closeout-transitional-growth',
        message: `Closeout transitional exports may not grow: expected <= ${maxCounts['transitional-internal']}, found ${transitionalCount}.`,
      });
    }

    if (wildcardExportPaths.length > maxCounts.wildcardExports) {
      countIssues.push({
        actual: wildcardExportPaths.length,
        expected: maxCounts.wildcardExports,
        kind: 'closeout-wildcard-growth',
        message: `Closeout wildcard exports may not grow: expected <= ${maxCounts.wildcardExports}, found ${wildcardExportPaths.length}.`,
      });
    }
  }

  return {
    closeoutExportCount: closeoutExportPaths.size,
    issues: [...manualIssues, ...countIssues],
    manualCategoryCounts,
    maxCounts,
    transitionalExportCount: summary['transitional-internal'] ?? 0,
    wildcardExportCount: wildcardExportPaths.length,
  };
}

// Prescriptive checks (CO1): the gate no longer just describes the surface, it
// enforces shrink-only convergence — removed exports stay removed, every
// transitional/wildcard export is owned, deprecation/review marks are complete,
// provisional facades keep their narrowness budgets, and counts never grow.
function buildResurrectionIssues(policy, exportPathSet) {
  return Object.keys(getPublicApiRemovedExports(policy))
    .filter((exportPath) => exportPathSet.has(exportPath))
    .map((exportPath) => ({
      exportPath,
      kind: 'removed-export-resurrected',
      message: `Export ${exportPath} was removed (closeout.removedExports) and may not return without a controller decision.`,
    }));
}

function buildOwnershipIssues(policy, closeoutExportPaths) {
  const readinessGroups = getPublicApiFacadeReadiness(policy).groups ?? {};
  const manualCategories = getPublicApiCloseoutManualCategories(policy);
  const manualPaths = new Set(Object.values(manualCategories).flat());
  const deprecatedPaths = new Set(getPublicApiCloseoutDeprecations(policy)?.exportPaths ?? []);
  const ownershipPaths = new Set(Object.keys(getPublicApiTransitionalOwnership(policy)));

  return [...closeoutExportPaths]
    .filter(
      (exportPath) =>
        !(exportPath in readinessGroups) &&
        !manualPaths.has(exportPath) &&
        !deprecatedPaths.has(exportPath) &&
        !ownershipPaths.has(exportPath),
    )
    .map((exportPath) => ({
      exportPath,
      kind: 'unowned-transitional-surface',
      message: `Transitional/wildcard export ${exportPath} has no facade mapping, manual category, deprecation mark, or ownership record.`,
    }));
}

function buildDeprecationIssues(policy, closeoutExportPaths) {
  const deprecations = getPublicApiCloseoutDeprecations(policy);
  if (!deprecations) {
    return [
      {
        kind: 'missing-deprecations',
        message: 'closeout.deprecations (SD-5 phase-1 marks) is required by the prescriptive boundary gate.',
      },
    ];
  }

  return deprecations.exportPaths
    .filter((exportPath) => !closeoutExportPaths.has(exportPath))
    .map((exportPath) => ({
      exportPath,
      kind: 'deprecation-unknown-export',
      message: `Deprecation mark references ${exportPath}, which is not a transitional or wildcard export.`,
    }));
}

function buildReviewByIssues(policy) {
  const manualCategories = getPublicApiCloseoutManualCategories(policy);
  const reviewByDates = getPublicApiCloseoutReviewBy(policy);
  return ['must-keep-transitional', 'keep-provisional'].flatMap((category) =>
    manualCategories[category]
      .filter((exportPath) => !reviewByDates[exportPath])
      .map((exportPath) => ({
        category,
        exportPath,
        kind: 'missing-review-by',
        message: `${category} export ${exportPath} has no closeout.reviewBy date.`,
      })),
  );
}

async function buildNarrownessIssues(policy) {
  const narrowness = getPublicApiNarrowness(policy);
  if (!narrowness) {
    return [
      {
        kind: 'missing-narrowness',
        message: 'closeout.narrowness baselines are required by the prescriptive boundary gate.',
      },
    ];
  }

  const issues = [];
  for (const exportPath of policy.provisionalPublicExports) {
    const budget = narrowness.baselines[exportPath];
    if (!Number.isInteger(budget)) {
      issues.push({
        exportPath,
        kind: 'narrowness-missing-baseline',
        message: `Provisional facade ${exportPath} has no narrowness baseline.`,
      });
      continue;
    }

    const specifier = exportPath === '.' ? CORE_PACKAGE_NAME : `${CORE_PACKAGE_NAME}/${exportPath.slice(2)}`;
    let actual;
    try {
      actual = Object.keys(await import(specifier)).length;
    } catch (error) {
      issues.push({
        exportPath,
        kind: 'narrowness-import-failed',
        message: `Provisional facade ${specifier} could not be imported for narrowness validation (run npm run build first): ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (actual > budget) {
      issues.push({
        actual,
        expected: budget,
        exportPath,
        kind: 'narrowness-violation',
        message: `Provisional facade ${exportPath} re-exports ${actual} runtime symbols, above its shrink-only budget of ${budget}.`,
      });
    }
  }

  return issues;
}

function buildTrendIssues(policy, summary, wildcardExportCount) {
  const trend = getPublicApiTrend(policy);
  if (!trend) {
    return [
      {
        kind: 'missing-trend',
        message: 'closeout.trend history is required by the prescriptive boundary gate.',
      },
    ];
  }

  const last = trend.history.at(-1);
  const maxCounts = getPublicApiCloseoutMaxCounts(policy);
  const issues = [];
  const current = {
    'provisional-public': summary['provisional-public'] ?? 0,
    'transitional-internal': summary['transitional-internal'] ?? 0,
    wildcardExports: wildcardExportCount,
  };

  for (const [key, actual] of Object.entries(current)) {
    if (actual > last[key]) {
      issues.push({
        actual,
        expected: last[key],
        kind: 'trend-growth',
        message: `${key} grew from ${last[key]} (trend ${last.date}) to ${actual}; the boundary is shrink-only.`,
      });
    }
  }

  for (const key of ['transitional-internal', 'wildcardExports']) {
    if (maxCounts[key] > last.maxCounts[key]) {
      issues.push({
        actual: maxCounts[key],
        expected: last.maxCounts[key],
        kind: 'maxcounts-raised',
        message: `closeout.maxCounts.${key} was raised from ${last.maxCounts[key]} to ${maxCounts[key]}; maxCounts are shrink-only.`,
      });
    }
  }

  return issues;
}

function buildSourceGraphIssues(policy, exportPathSet) {
  const canonical = policy.closeout?.sourceGraphCanonical;
  if (!canonical) {
    return [];
  }

  const issues = [];
  if (!exportPathSet.has(canonical.canonicalFacade) || !policy.stablePublicExports.includes(canonical.canonicalFacade)) {
    issues.push({
      kind: 'source-graph-canonical-missing',
      message: `Canonical source-graph facade ${canonical.canonicalFacade} must stay a stable package export (shape frozen for CKG2/CKG4).`,
    });
  }
  for (const variant of canonical.variantFacadesRemoved ?? []) {
    if (exportPathSet.has(variant)) {
      issues.push({
        exportPath: variant,
        kind: 'source-graph-variant-resurrected',
        message: `Removed source-graph variant facade ${variant} may not return; ${canonical.canonicalFacade} is canonical.`,
      });
    }
  }

  return issues;
}

function recordTrendEntry(policy, summary, exportPaths, wildcardExportCount) {
  const trend = getPublicApiTrend(policy);
  const last = trend?.history.at(-1);
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    exports: exportPaths.length,
    'stable-public': summary['stable-public'] ?? 0,
    'provisional-public': summary['provisional-public'] ?? 0,
    'transitional-internal': summary['transitional-internal'] ?? 0,
    wildcardExports: wildcardExportCount,
    maxCounts: { ...getPublicApiCloseoutMaxCounts(policy) },
  };
  const unchanged =
    last &&
    ['exports', 'stable-public', 'provisional-public', 'transitional-internal', 'wildcardExports'].every(
      (key) => last[key] === entry[key],
    ) &&
    last.maxCounts['transitional-internal'] === entry.maxCounts['transitional-internal'] &&
    last.maxCounts.wildcardExports === entry.maxCounts.wildcardExports;
  if (unchanged) {
    return { appended: false, entry: last };
  }

  const raw = JSON.parse(readFileSync(PUBLIC_API_BOUNDARY_POLICY_URL, 'utf8'));
  raw.closeout.trend.history.push(entry);
  writeFileSync(fileURLToPath(PUBLIC_API_BOUNDARY_POLICY_URL), `${JSON.stringify(raw, null, 2)}\n`);
  return { appended: true, entry };
}

async function buildReport(options = {}) {
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
  const closeoutSummary = buildCloseoutSummary(policy, exportPaths, summary);
  const exportPathSet = new Set(exportPaths);
  const wildcardExportPaths = exportPaths.filter((exportPath) => exportPath.includes('*'));
  const closeoutExportPaths = new Set([...policy.transitionalInternalExports, ...wildcardExportPaths]);
  const trendRecording = options.recordTrend
    ? recordTrendEntry(policy, summary, exportPaths, wildcardExportPaths.length)
    : undefined;
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
    ...closeoutSummary.issues,
    ...buildResurrectionIssues(policy, exportPathSet),
    ...buildOwnershipIssues(policy, closeoutExportPaths),
    ...buildDeprecationIssues(policy, closeoutExportPaths),
    ...buildReviewByIssues(policy),
    ...(await buildNarrownessIssues(policy)),
    ...buildTrendIssues(policy, summary, wildcardExportPaths.length),
    ...buildSourceGraphIssues(policy, exportPathSet),
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
    closeoutSummary,
    summary,
    trendRecording,
    wildcardExportCount: exportPaths.filter((exportPath) => exportPath.includes('*')).length,
  };
}

function formatTextReport(report) {
  if (report.issueCount === 0) {
    return [
      `Public API boundary OK (prescriptive): ${report.exportCount} package exports classified.`,
      `Exact exports: ${report.exactExportCount}; wildcard exports: ${report.wildcardExportCount}.`,
      `Status summary: stable=${report.summary['stable-public']}, provisional=${report.summary['provisional-public']}, transitional=${report.summary['transitional-internal']}.`,
      `Closeout no-growth: transitional<=${report.closeoutSummary.maxCounts?.['transitional-internal'] ?? 'unset'} (${report.closeoutSummary.transitionalExportCount}); wildcard<=${report.closeoutSummary.maxCounts?.wildcardExports ?? 'unset'} (${report.closeoutSummary.wildcardExportCount}).`,
      'Prescriptive checks passed: removed-export resurrection, transitional ownership, deprecation marks, review-by dates, provisional narrowness budgets, shrink-only trend/maxCounts, source-graph canonical.',
      ...(report.trendRecording
        ? [
            report.trendRecording.appended
              ? `Trend entry appended for ${report.trendRecording.entry.date}.`
              : 'Trend unchanged; no entry appended.',
          ]
        : []),
    ].join('\n');
  }

  return [
    `Public API boundary failed: ${report.issueCount} issue(s).`,
    ...report.issues.map((issue) => `- ${issue.kind}: ${issue.message}`),
  ].join('\n');
}

function printHelp() {
  console.log(`Usage: node scripts/check-public-api-boundary.mjs [--format text|json] [--record-trend]

Checks package.json exports against config/public-api-boundary.json.

Prescriptive mode (CO1): besides classification, the gate enforces that removed
exports stay removed, every transitional/wildcard export is owned (facade
mapping, manual category, deprecation mark, or ownership record), SD-5 phase-1
deprecation/review-by marks are complete, provisional facades respect their
shrink-only narrowness budgets (requires a built dist/), counts never grow past
the last trend entry, and maxCounts are shrink-only.

--record-trend appends the current counts to closeout.trend.history when they
changed (intentional shrink waves only).

Phase 9 rule: public API surface changes must update the machine-readable policy,
tests, and migration notes together.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await buildReport(options);
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

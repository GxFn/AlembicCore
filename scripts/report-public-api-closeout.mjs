import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_API_CLOSEOUT_CATEGORIES,
  PUBLIC_API_FACADE_READINESS_DECISIONS,
  getPublicApiFacadeReadiness,
  getPublicApiCloseoutManualCategories,
  loadPublicApiBoundaryPolicy,
  CORE_PACKAGE_NAME,
  specifierToExportPath,
} from './public-api-boundary-policy.mjs';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONSUMERS = [
  {
    configPath: '../AlembicAgent/config/core-import-boundary.json',
    name: 'AlembicAgent',
    root: '../AlembicAgent',
  },
  {
    configPath: '../Alembic/config/core-import-boundary.json',
    name: 'Alembic',
    root: '../Alembic',
  },
  {
    configPath: '../AlembicPlugin/config/core-import-boundary-allowlist.json',
    name: 'AlembicPlugin',
    root: '../AlembicPlugin',
  },
];

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

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));
}

function closeoutExportPaths(pkg, policy) {
  const allExportPaths = Object.keys(pkg.exports);
  const wildcardExports = allExportPaths.filter((exportPath) => exportPath.includes('*'));
  return {
    allExportPaths,
    closeoutPaths: [...new Set([...policy.transitionalInternalExports, ...wildcardExports])].sort(),
    wildcardExports,
  };
}

function manualCategoryByExportPath(policy) {
  const manualCategories = getPublicApiCloseoutManualCategories(policy);
  const entries = Object.entries(manualCategories).flatMap(([category, exportPaths]) =>
    exportPaths.map((exportPath) => [exportPath, category]),
  );
  return new Map(entries);
}

function exportPathToSpecifier(exportPath) {
  return exportPath === '.' ? CORE_PACKAGE_NAME : `${CORE_PACKAGE_NAME}/${exportPath.slice(2)}`;
}

function buildFacadeReadinessMaps(policy) {
  const readiness = getPublicApiFacadeReadiness(policy);
  return {
    groups: new Map(Object.entries(readiness.groups ?? {})),
    specifiers: new Map(Object.entries(readiness.specifiers ?? {})),
  };
}

function resolveFacadeReadiness(specifier, closeoutPath, readinessMaps) {
  const exact = readinessMaps.specifiers.get(specifier);
  if (exact) {
    return exact;
  }

  return readinessMaps.groups.get(closeoutPath);
}

function resolveCloseoutExportPath(specifier, allExportPaths, closeoutPaths, wildcardExports) {
  const exportPath = specifierToExportPath(specifier);
  if (!exportPath) {
    return undefined;
  }

  if (closeoutPaths.has(exportPath)) {
    return exportPath;
  }

  if (allExportPaths.has(exportPath)) {
    return undefined;
  }

  return wildcardExports
    .filter((wildcardPath) => exportPath.startsWith(wildcardPath.slice(0, -1)))
    .sort((left, right) => right.length - left.length)
    .at(0);
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function runConsumerScan(consumer) {
  const rootPath = path.resolve(CORE_ROOT, consumer.root);
  const configPath = path.resolve(CORE_ROOT, consumer.configPath);

  if (!existsSync(rootPath)) {
    return {
      name: consumer.name,
      reason: 'consumer root is not present in this workspace',
      status: 'skipped',
    };
  }

  if (!existsSync(configPath)) {
    return {
      name: consumer.name,
      reason: 'consumer boundary config is not present in this workspace',
      status: 'skipped',
    };
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
    return {
      name: consumer.name,
      result: JSON.parse(stdout),
      status: 'scanned',
    };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const parsed = parseJsonOutput(stdout);
    return {
      name: consumer.name,
      reason: error instanceof Error ? error.message : String(error),
      result: parsed,
      status: parsed ? 'scanned-with-issues' : 'failed',
    };
  }
}

function addConsumerReferences(inventory, consumerScan, allExportPaths, closeoutPaths, wildcardExports) {
  const references = consumerScan.result?.references ?? [];
  let matchedCloseoutReferences = 0;

  for (const reference of references) {
    const closeoutPath = resolveCloseoutExportPath(
      reference.specifier,
      allExportPaths,
      closeoutPaths,
      wildcardExports,
    );
    if (!closeoutPath) {
      continue;
    }

    matchedCloseoutReferences += 1;
    const item = inventory.get(closeoutPath);
    item.consumerReferences += 1;
    item.consumers[consumerScan.name] = (item.consumers[consumerScan.name] ?? 0) + 1;
  }

  return matchedCloseoutReferences;
}

function collectReplacementReadiness(
  consumerScans,
  allExportPaths,
  closeoutPaths,
  wildcardExports,
  readinessMaps,
) {
  const entries = new Map();

  for (const scan of consumerScans) {
    if (!scan.result || scan.status === 'failed') {
      continue;
    }

    for (const reference of scan.result.references ?? []) {
      const closeoutPath = resolveCloseoutExportPath(
        reference.specifier,
        allExportPaths,
        closeoutPaths,
        wildcardExports,
      );
      if (!closeoutPath) {
        continue;
      }

      const readiness = resolveFacadeReadiness(reference.specifier, closeoutPath, readinessMaps);
      if (!readiness) {
        continue;
      }

      const key = reference.specifier;
      const entry = entries.get(key) ?? {
        closeoutPath,
        consumers: {},
        decision: readiness.decision,
        reason: readiness.reason,
        references: 0,
        specifier: reference.specifier,
        symbols: readiness.symbols ?? [],
        targetFacade: readiness.targetFacade,
        targetSpecifier: exportPathToSpecifier(readiness.targetFacade),
      };
      entry.references += 1;
      entry.consumers[scan.name] = (entry.consumers[scan.name] ?? 0) + 1;
      entries.set(key, entry);
    }
  }

  const byDecision = Object.fromEntries(PUBLIC_API_FACADE_READINESS_DECISIONS.map((decision) => [decision, 0]));
  const items = [...entries.values()].sort(
    (left, right) => right.references - left.references || left.specifier.localeCompare(right.specifier),
  );

  for (const item of items) {
    byDecision[item.decision] += item.references;
  }

  return {
    byDecision,
    items,
    readyReferences:
      (byDecision['consumer-ready-stable'] ?? 0) + (byDecision['consumer-ready-provisional'] ?? 0),
    totalReferences: items.reduce((sum, item) => sum + item.references, 0),
  };
}

function buildReport() {
  const pkg = readPackageJson();
  const policy = loadPublicApiBoundaryPolicy();
  const { allExportPaths, closeoutPaths, wildcardExports } = closeoutExportPaths(pkg, policy);
  const allExportPathSet = new Set(allExportPaths);
  const closeoutPathSet = new Set(closeoutPaths);
  const manualCategories = manualCategoryByExportPath(policy);
  const readinessMaps = buildFacadeReadinessMaps(policy);
  const inventory = new Map(
    closeoutPaths.map((exportPath) => [
      exportPath,
      {
        consumerReferences: 0,
        consumers: {},
        exportPath,
        wildcard: exportPath.includes('*'),
      },
    ]),
  );

  const consumerScans = DEFAULT_CONSUMERS.map(runConsumerScan);
  const consumerSummaries = consumerScans.map((scan) => ({
    byStatus: scan.result?.byStatus,
    filesScanned: scan.result?.filesScanned,
    issueCount: scan.result?.issueCount,
    matchedCloseoutReferences:
      scan.result && scan.status !== 'failed'
        ? addConsumerReferences(inventory, scan, allExportPathSet, closeoutPathSet, wildcardExports)
        : 0,
    name: scan.name,
    reason: scan.reason,
    referencesScanned: scan.result?.referencesScanned,
    status: scan.status,
  }));

  const categories = Object.fromEntries(PUBLIC_API_CLOSEOUT_CATEGORIES.map((category) => [category, []]));

  for (const item of inventory.values()) {
    const category =
      manualCategories.get(item.exportPath) ??
      (item.consumerReferences > 0 ? 'consumer-replace-first' : 'no-consumer-deprecate-candidate');
    categories[category].push(item);
  }

  for (const entries of Object.values(categories)) {
    entries.sort(
      (left, right) =>
        right.consumerReferences - left.consumerReferences || left.exportPath.localeCompare(right.exportPath),
    );
  }

  return {
    categories,
    categoryCounts: Object.fromEntries(
      Object.entries(categories).map(([category, entries]) => [category, entries.length]),
    ),
    consumerSummaries,
    issueCount: consumerSummaries.reduce((sum, summary) => sum + (summary.issueCount ?? 0), 0),
    packageName: pkg.name,
    replacementReadiness: collectReplacementReadiness(
      consumerScans,
      allExportPathSet,
      closeoutPathSet,
      wildcardExports,
      readinessMaps,
    ),
    totalCloseoutExports: closeoutPaths.length,
    wildcardExportCount: wildcardExports.length,
  };
}

function formatTextReport(report) {
  const lines = [
    `Core public API closeout inventory: ${report.totalCloseoutExports} exports (${report.wildcardExportCount} wildcard).`,
    `Categories: ${PUBLIC_API_CLOSEOUT_CATEGORIES.map((category) => `${category}=${report.categoryCounts[category]}`).join(', ')}.`,
    'Consumer scans:',
  ];

  for (const summary of report.consumerSummaries) {
    if (summary.status === 'skipped' || summary.status === 'failed') {
      lines.push(`- ${summary.name}: ${summary.status} (${summary.reason}).`);
      continue;
    }

    lines.push(
      `- ${summary.name}: refs=${summary.referencesScanned}, closeoutRefs=${summary.matchedCloseoutReferences}, issues=${summary.issueCount}, stable=${summary.byStatus?.['stable-public'] ?? 0}, provisional=${summary.byStatus?.['provisional-public'] ?? 0}, transitional=${summary.byStatus?.['transitional-internal'] ?? 0}.`,
    );
  }

  const topReplaceFirst = report.categories['consumer-replace-first'].slice(0, 12);
  if (topReplaceFirst.length > 0) {
    lines.push('Top consumer-replace-first exports:');
    for (const item of topReplaceFirst) {
      const consumers = Object.entries(item.consumers)
        .map(([name, count]) => `${name}:${count}`)
        .join(', ');
      lines.push(`- ${item.exportPath}: refs=${item.consumerReferences}${consumers ? ` (${consumers})` : ''}`);
    }
  }

  const readiness = report.replacementReadiness;
  lines.push(
    `Replacement readiness: readyRefs=${readiness.readyReferences}/${readiness.totalReferences}; ${PUBLIC_API_FACADE_READINESS_DECISIONS.map((decision) => `${decision}=${readiness.byDecision[decision]}`).join(', ')}.`,
  );

  const topReadiness = readiness.items.slice(0, 12);
  if (topReadiness.length > 0) {
    lines.push('Top replacement-ready deep specifiers:');
    for (const item of topReadiness) {
      const consumers = Object.entries(item.consumers)
        .map(([name, count]) => `${name}:${count}`)
        .join(', ');
      lines.push(
        `- ${item.specifier} -> ${item.targetSpecifier} [${item.decision}]: refs=${item.references}${consumers ? ` (${consumers})` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

function printHelp() {
  console.log(`Usage: node scripts/report-public-api-closeout.mjs [--format text|json]

Builds the Core Wave 3A closeout inventory from package exports, boundary policy,
and sibling consumer import scans. The inventory is evidence only: it does not
delete exports or rewrite consumers.`);
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

  if (report.consumerSummaries.some((summary) => summary.status === 'failed')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

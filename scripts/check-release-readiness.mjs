import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const packageRootUrl = new URL('../', import.meta.url);

const dependencySections = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];

const requiredPackageEntries = [
  'package/package.json',
  'package/README.md',
  'package/config/public-api-boundary.json',
  'package/dist/index.js',
  'package/dist/index.d.ts',
  'package/resources/grammars/tree-sitter-typescript.wasm',
  'package/scripts/check-public-api-boundary.mjs',
  'package/scripts/check-release-readiness.mjs',
  'package/scripts/lint-consumer-core-imports.mjs',
  'package/scripts/public-api-boundary-policy.mjs',
];

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

function pathExists(packageRelativePath) {
  return existsSync(new URL(`../${packageRelativePath}`, import.meta.url));
}

function readGitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd: packageRootUrl,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function runNpmPackDryRun() {
  const cacheDir = path.join(tmpdir(), 'alembic-core-npm-cache');
  mkdirSync(cacheDir, { recursive: true });

  const output = execFileSync('npm', ['--cache', cacheDir, 'pack', '--dry-run', '--json'], {
    cwd: packageRootUrl,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('npm pack --dry-run --json returned an unexpected payload.');
  }

  return parsed[0];
}

function collectDependencyIssues(pkg, packageLockText) {
  const issues = [];

  for (const section of dependencySections) {
    const dependencies = pkg[section] ?? {};
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier === 'string' && /^(file|link):\.\.\//.test(specifier)) {
        issues.push({
          kind: 'local-parent-dependency',
          message: `${section}.${name} uses ${specifier}; published Core package must not depend on sibling workspace paths.`,
        });
      }
    }
  }

  if (packageLockText.includes('file:../')) {
    issues.push({
      kind: 'package-lock-local-parent-dependency',
      message: 'package-lock.json contains file:../; Core release package must be sibling-free.',
    });
  }

  return issues;
}

function normalizeExportTarget(target) {
  if (typeof target === 'string') {
    return { import: target };
  }

  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return target;
  }

  return {};
}

function collectExportIssues(pkg, packFilePaths) {
  const issues = [];
  const exportsMap = pkg.exports ?? {};

  for (const [exportPath, target] of Object.entries(exportsMap)) {
    const normalized = normalizeExportTarget(target);
    const targets = [normalized.types, normalized.import].filter(Boolean);

    for (const targetPath of targets) {
      if (typeof targetPath !== 'string') {
        issues.push({
          exportPath,
          kind: 'invalid-export-target',
          message: `Export ${exportPath} has a non-string target.`,
        });
        continue;
      }

      if (!targetPath.startsWith('./dist/')) {
        issues.push({
          exportPath,
          kind: 'non-dist-export-target',
          message: `Export ${exportPath} points to ${targetPath}; release exports must point at dist/.`,
        });
      }

      if (targetPath.includes('*')) {
        continue;
      }

      const packageRelativePath = targetPath.slice('./'.length);
      const packPath = `package/${packageRelativePath}`;
      if (!pathExists(packageRelativePath)) {
        issues.push({
          exportPath,
          kind: 'missing-dist-export-file',
          message: `Export ${exportPath} points to missing ${packageRelativePath}; run npm run build before release:check.`,
        });
      } else if (!packFilePaths.has(packPath)) {
        issues.push({
          exportPath,
          kind: 'missing-pack-export-file',
          message: `Export ${exportPath} file ${packPath} is not included in npm pack output.`,
        });
      }
    }
  }

  return issues;
}

function collectPackageEntryIssues(packFilePaths) {
  return requiredPackageEntries
    .filter((entry) => !packFilePaths.has(entry))
    .map((entry) => ({
      entry,
      kind: 'missing-required-pack-entry',
      message: `${entry} is missing from npm pack output.`,
    }));
}

function collectMetadataIssues(pkg, sourceCommit) {
  const issues = [];

  if (pkg.name !== '@alembic/core') {
    issues.push({
      kind: 'unexpected-package-name',
      message: `Expected package name @alembic/core, found ${pkg.name}.`,
    });
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version ?? '')) {
    issues.push({
      kind: 'invalid-package-version',
      message: `Package version must be semver-like, found ${pkg.version ?? '<missing>'}.`,
    });
  }

  if (!sourceCommit) {
    issues.push({
      kind: 'missing-source-commit',
      message: 'Unable to resolve git HEAD; release snapshots must record a source commit.',
    });
  }

  return issues;
}

function buildReport() {
  const pkg = readJson(packageJsonUrl);
  const packageLockText = readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8');
  const sourceCommit = readGitValue(['rev-parse', 'HEAD']);
  const gitStatus = readGitValue(['status', '--porcelain'], '');
  const pack = runNpmPackDryRun();
  const packFilePaths = new Set(pack.files.map((file) => `package/${file.path}`));

  const issues = [
    ...collectMetadataIssues(pkg, sourceCommit),
    ...collectDependencyIssues(pkg, packageLockText),
    ...collectPackageEntryIssues(packFilePaths),
    ...collectExportIssues(pkg, packFilePaths),
  ];

  return {
    entryCount: pack.entryCount,
    filename: pack.filename,
    issues,
    issueCount: issues.length,
    packageName: pkg.name,
    sourceCommit,
    unpackedSize: pack.unpackedSize,
    version: pkg.version,
    workingTreeDirty: gitStatus.length > 0,
  };
}

function formatReport(report) {
  if (report.issueCount === 0) {
    return [
      `Core release readiness OK: ${report.packageName}@${report.version}.`,
      `Source commit: ${report.sourceCommit}.`,
      `Pack file: ${report.filename}; entries=${report.entryCount}; unpackedSize=${report.unpackedSize}.`,
      `Working tree dirty: ${report.workingTreeDirty ? 'yes' : 'no'}.`,
    ].join('\n');
  }

  return [
    `Core release readiness failed: ${report.issueCount} issue(s).`,
    ...report.issues.map((issue) => `- ${issue.kind}: ${issue.message}`),
  ].join('\n');
}

try {
  const report = buildReport();
  console.log(formatReport(report));
  if (report.issueCount > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

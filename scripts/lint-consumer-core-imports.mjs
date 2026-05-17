import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { classifyCoreImportSpecifier } from './public-api-boundary-policy.mjs';

export { classifyCoreImportSpecifier } from './public-api-boundary-policy.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

const DEFAULT_IGNORE_GLOBS = [
  '.git/**',
  'coverage/**',
  'dist/**',
  'docs/**',
  'node_modules/**',
  'vendor/**',
];

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[^'";\n]*?\s+from\s*['"](@alembic\/core(?:\/[^'"]+)?)['"]/g,
  /\b(?:import|export)\s*['"](@alembic\/core(?:\/[^'"]+)?)['"]/g,
  /\b(?:import|require)\s*\(\s*['"](@alembic\/core(?:\/[^'"]+)?)['"]/g,
];

const MOCK_IMPORT_PATTERNS = [
  /\b(?:vi|jest)\.(?:mock|doMock|unmock)\s*\(\s*['"](@alembic\/core(?:\/[^'"]+)?)['"]/g,
];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function normalizeGlob(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function matchesGlob(relativePath, glob) {
  const normalizedPath = normalizePath(relativePath);
  const normalizedGlob = normalizeGlob(glob);

  if (normalizedGlob.endsWith('/**')) {
    const base = normalizedGlob.slice(0, -3);
    return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
  }

  if (!normalizedGlob.includes('*')) {
    return normalizedPath === normalizedGlob || normalizedPath.startsWith(`${normalizedGlob}/`);
  }

  const escaped = normalizedGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

function parseArgs(argv) {
  const options = {
    configPath: undefined,
    format: 'text',
    help: false,
    root: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--config') {
      index += 1;
      options.configPath = argv[index];
    } else if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length);
    } else if (arg === '--format') {
      index += 1;
      options.format = argv[index] ?? 'text';
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.root) {
      options.root = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  if (options.format !== 'text' && options.format !== 'json') {
    throw new Error(`Unsupported --format value: ${options.format}`);
  }

  return {
    ...options,
    root: path.resolve(options.root ?? process.cwd()),
  };
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function resolveConfigPath(root, configPath) {
  if (!configPath) {
    return undefined;
  }

  return path.isAbsolute(configPath) ? configPath : path.resolve(root, configPath);
}

function loadConfig(root, configPath) {
  const resolvedConfigPath = resolveConfigPath(root, configPath);
  const raw = resolvedConfigPath ? readJsonFile(resolvedConfigPath) : {};
  const referenceLimits =
    raw.referenceLimits && typeof raw.referenceLimits === 'object' ? raw.referenceLimits : {};
  const allowedSpecifiers = new Set([
    ...asArray(raw.allowedSpecifiers),
    ...asArray(raw.allowedRootSpecifiers),
    ...asArray(raw.allowedExistingSpecifiers),
    ...asArray(raw.allowedDeepSpecifiers),
    ...asArray(raw.allowedProvisionalSpecifiers),
    ...asArray(raw.allowedTransitionalSpecifiers),
    ...Object.keys(referenceLimits),
  ]);

  return {
    adapterPathGlobs: asArray(raw.adapterPathGlobs),
    allowProvisional: raw.allowProvisional === true,
    allowedSpecifiers,
    configPath: resolvedConfigPath,
    includeMockReferences: raw.includeMockReferences === true,
    ignoreGlobs: [...DEFAULT_IGNORE_GLOBS, ...asArray(raw.ignoreGlobs), ...asArray(raw.ignoredPathGlobs)],
    referenceLimits,
    scanRoots: asArray(raw.scanRoots),
  };
}

function shouldIgnorePath(relativePath, config) {
  return config.ignoreGlobs.some((glob) => matchesGlob(relativePath, glob));
}

function isAdapterPath(relativePath, config) {
  return config.adapterPathGlobs.some((glob) => matchesGlob(relativePath, glob));
}

function collectSourceFiles(root, config) {
  const files = [];
  const scanRoots = config.scanRoots.length > 0 ? config.scanRoots : ['.'];

  function visit(absolutePath) {
    const stats = statSync(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (relativePath && shouldIgnorePath(relativePath, config)) {
      return;
    }

    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
          continue;
        }
        visit(path.join(absolutePath, entry.name));
      }
      return;
    }

    if (stats.isFile() && SOURCE_EXTENSIONS.has(path.extname(absolutePath))) {
      files.push(absolutePath);
    }
  }

  for (const scanRoot of scanRoots) {
    const absoluteScanRoot = path.resolve(root, scanRoot);
    try {
      visit(absoluteScanRoot);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return files.sort();
}

function lineColumnAt(content, index) {
  const prefix = content.slice(0, index);
  const lines = prefix.split('\n');
  return {
    column: lines.at(-1).length + 1,
    line: lines.length,
  };
}

function extractCoreImports(filePath, root, includeMockReferences) {
  const content = readFileSync(filePath, 'utf8');
  const relativePath = normalizePath(path.relative(root, filePath));
  const references = [];
  const seen = new Set();
  const patterns = includeMockReferences ? [...IMPORT_PATTERNS, ...MOCK_IMPORT_PATTERNS] : IMPORT_PATTERNS;

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match) {
      const specifier = match[1];
      const captureIndex = match.index + match[0].indexOf(specifier);
      const key = `${captureIndex}:${specifier}`;
      if (!seen.has(key)) {
        const location = lineColumnAt(content, captureIndex);
        references.push({
          column: location.column,
          file: relativePath,
          line: location.line,
          specifier,
        });
        seen.add(key);
      }
      match = pattern.exec(content);
    }
  }

  return references.sort((left, right) => left.line - right.line || left.column - right.column);
}

function countReferences(references) {
  const counts = new Map();
  for (const reference of references) {
    counts.set(reference.specifier, (counts.get(reference.specifier) ?? 0) + 1);
  }
  return counts;
}

function buildIssue(reference, classification, reason) {
  return {
    classification,
    column: reference.column,
    file: reference.file,
    line: reference.line,
    reason,
    specifier: reference.specifier,
  };
}

function analyzeReferences(references, config) {
  const issues = [];
  const referenceCounts = countReferences(references);

  for (const reference of references) {
    const classification = classifyCoreImportSpecifier(reference.specifier);
    if (classification === 'stable-public') {
      continue;
    }

    if (classification === 'provisional-public' && config.allowProvisional) {
      continue;
    }

    if (isAdapterPath(reference.file, config)) {
      continue;
    }

    if (config.allowedSpecifiers.has(reference.specifier)) {
      continue;
    }

    issues.push(
      buildIssue(
        reference,
        classification,
        'New non-stable @alembic/core imports must go through a documented adapter or allowlist.',
      ),
    );
  }

  for (const [specifier, rawLimit] of Object.entries(config.referenceLimits)) {
    const classification = classifyCoreImportSpecifier(specifier);
    if (classification === 'stable-public') {
      continue;
    }

    const limit = Number(rawLimit);
    if (!Number.isFinite(limit)) {
      continue;
    }

    const actual = referenceCounts.get(specifier) ?? 0;
    if (actual > limit) {
      issues.push({
        classification,
        column: 1,
        file: '<repository>',
        line: 1,
        reason: `Reference limit exceeded: ${actual} found, baseline allows ${limit}.`,
        specifier,
      });
    }
  }

  return issues;
}

export function scanConsumerCoreImports(root, config) {
  const sourceFiles = collectSourceFiles(root, config);
  const references = sourceFiles.flatMap((filePath) =>
    extractCoreImports(filePath, root, config.includeMockReferences),
  );
  const issues = analyzeReferences(references, config);
  const byStatus = {
    'provisional-public': 0,
    'stable-public': 0,
    'transitional-internal': 0,
  };

  for (const reference of references) {
    byStatus[classifyCoreImportSpecifier(reference.specifier)] += 1;
  }

  return {
    byStatus,
    filesScanned: sourceFiles.length,
    issueCount: issues.length,
    issues,
    references,
    referencesScanned: references.length,
    root,
  };
}

function formatTextReport(result, config) {
  if (result.issueCount === 0) {
    return [
      `Core import boundary OK: scanned ${result.filesScanned} files and ${result.referencesScanned} @alembic/core imports.`,
      config.configPath ? `Config: ${config.configPath}` : 'Config: stable-only default policy',
    ].join('\n');
  }

  const lines = [
    `Core import boundary violations: ${result.issueCount}`,
    `Scanned ${result.filesScanned} files and ${result.referencesScanned} @alembic/core imports.`,
  ];

  for (const issue of result.issues) {
    lines.push(
      `- ${issue.file}:${issue.line}:${issue.column} ${issue.specifier} [${issue.classification}] ${issue.reason}`,
    );
  }

  return lines.join('\n');
}

function printHelp() {
  console.log(`Usage: node scripts/lint-consumer-core-imports.mjs [consumer-root] [--config path] [--format text|json]

Scans Alembic consumer repositories for @alembic/core imports.

Default policy:
  - stable public facades are allowed everywhere
  - provisional/transitional/deep imports fail unless covered by config

Config fields:
  - scanRoots: directories to scan
  - allowedSpecifiers: existing baseline imports
  - allowedRootSpecifiers / allowedExistingSpecifiers / allowedDeepSpecifiers
  - allowedProvisionalSpecifiers / allowedTransitionalSpecifiers
  - referenceLimits: per-specifier baseline counts; non-stable counts may not grow
  - adapterPathGlobs: path globs where adapter imports are allowed
  - ignoreGlobs / ignoredPathGlobs: additional ignored paths
  - allowProvisional: true to allow exact provisional module facades temporarily
  - includeMockReferences: true to count vi.mock/jest.mock references

阶段 8 规则：Core 只提供边界检查器；外层仓库负责 adapter、CLI/MCP/Dashboard 交付和删除计划。`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig(options.root, options.configPath);
  const result = scanConsumerCoreImports(options.root, config);

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTextReport(result, config));
  }

  if (result.issueCount > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

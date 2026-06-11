// Dependency-direction lint (CO2 B1b): enforces docs/layer-contract.md via
// config/layer-contract.json as a blocking step in `npm run check`.
// Runtime imports between src/ areas must follow allowedRuntimeImports;
// type-only imports (import type / export type … from) are exempt as type
// bridges; file-level blessed exceptions need a written reason in the config.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(CORE_ROOT, 'config/layer-contract.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

// Statement-level matchers. `[^;'"]*?` keeps a match inside one statement
// (specifier lists never contain quotes or semicolons).
const FROM_IMPORT_RE = /\b(import|export)\s+(type\s+)?[^;'"]*?from\s*['"](\.[^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"](\.[^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"](\.[^'"]+)['"]/g;

function loadConfig() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (config.schemaVersion !== 1 || !config.allowedRuntimeImports) {
    throw new Error('config/layer-contract.json must have schemaVersion 1 and allowedRuntimeImports');
  }
  return config;
}

function areaOf(relativePath) {
  const segments = relativePath.split('/');
  if (segments[0] !== 'src') {
    return undefined;
  }
  return segments.length === 2 ? 'root-facade' : segments[1];
}

function collectSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolute, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function collectImports(content) {
  const imports = [];
  for (const match of content.matchAll(FROM_IMPORT_RE)) {
    imports.push({ index: match.index, specifier: match[3], typeOnly: Boolean(match[2]) });
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
    imports.push({ index: match.index, specifier: match[1], typeOnly: false });
  }
  for (const match of content.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    imports.push({ index: match.index, specifier: match[1], typeOnly: false });
  }
  return imports;
}

function main() {
  const config = loadConfig();
  const blessedByFile = new Map(
    (config.blessedImports ?? []).map((entry) => [`${entry.file}->${entry.to}`, entry]),
  );
  const violations = [];
  let runtimeEdges = 0;
  let typeOnlyEdges = 0;

  for (const absolute of collectSourceFiles(path.join(CORE_ROOT, 'src'))) {
    const relative = path.relative(CORE_ROOT, absolute).split(path.sep).join('/');
    const fromArea = areaOf(relative);
    if (!fromArea) {
      continue;
    }
    if (!(fromArea in config.allowedRuntimeImports)) {
      violations.push({ file: relative, line: 1, message: `area "${fromArea}" is not declared in config/layer-contract.json` });
      continue;
    }

    const content = readFileSync(absolute, 'utf8');
    for (const found of collectImports(content)) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), found.specifier),
      );
      const toArea = areaOf(resolved);
      if (!toArea || toArea === fromArea) {
        continue;
      }

      if (found.typeOnly && config.typeOnlyImportsExempt) {
        typeOnlyEdges += 1;
        continue;
      }
      runtimeEdges += 1;

      const allowed = config.allowedRuntimeImports[fromArea];
      if (allowed.includes('*') || allowed.includes(toArea)) {
        continue;
      }
      if (blessedByFile.has(`${relative}->${toArea}`)) {
        continue;
      }
      violations.push({
        file: relative,
        line: lineAt(content, found.index),
        message: `runtime import ${fromArea} -> ${toArea} (${found.specifier}) violates the layer contract`,
      });
    }
  }

  if (violations.length > 0) {
    console.log(`Layer contract failed: ${violations.length} violation(s).`);
    for (const violation of violations) {
      console.log(`- ${violation.file}:${violation.line} ${violation.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Layer contract OK: ${runtimeEdges} cross-area runtime imports within the allowed matrix; ${typeOnlyEdges} type-only bridges exempt.`,
  );
}

main();

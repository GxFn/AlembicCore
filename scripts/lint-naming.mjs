// SN4a naming lint (AlembicCore, ported from the SN3/SN2/SN1 shape): blocks
// filename-convention stragglers per config/naming-lint.json. First matching
// rule wins; index.ts barrels pass; exceptions need {file, owner, reason} to
// exempt a single file. Logic is the SN1 pilot's via SN3; the Core deltas are
// this repo's rule set (reduced SN4a scope) and the parkedScopes handling:
// src/ rules are CARRIED but NOT SCANNED until SN4 proper un-parks them (user
// decision C3 — src/ is frozen on SD-5 phase-2; the migrations NNN_snake_case
// exempt family is codified inside the parked entry so un-parking is a pure
// config move).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(readFileSync(path.join(root, 'config', 'naming-lint.json'), 'utf8'));

for (const entry of config.exceptions ?? []) {
  for (const field of ['file', 'owner', 'reason']) {
    if (!entry?.[field]) {
      process.stderr.write(`naming lint: exception ${JSON.stringify(entry)} missing '${field}'.\n`);
      process.exit(1);
    }
  }
}
const exceptionFiles = new Set((config.exceptions ?? []).map((entry) => entry.file));
const barrelNames = new Set(config.barrelNames ?? []);
// Parked scopes (src/) are excluded from scanning by construction: their rules
// never enter the active rule list. Validate shape so the parked entry cannot
// silently rot before SN4 proper consumes it.
const parkedScopes = config.parkedScopes ?? [];
for (const parked of parkedScopes) {
  if (!parked?.scope || parked?.status !== 'parked' || !parked?.reason || !parked?.rules?.length) {
    process.stderr.write(
      `naming lint: parkedScopes entry ${JSON.stringify(parked?.scope)} must carry scope, status="parked", reason, and rules.\n`
    );
    process.exit(1);
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const violations = [];
let checked = 0;
const scanRoots = [...new Set(config.rules.map((rule) => rule.scope.split('/')[0]))];

for (const scanRoot of scanRoots) {
  for (const filePath of walk(path.join(root, scanRoot))) {
    const relative = path.relative(root, filePath).replaceAll(path.sep, '/');
    const baseName = path.basename(relative);
    if (barrelNames.has(baseName) || exceptionFiles.has(relative)) {
      continue;
    }
    if ((config.exemptScopes ?? []).some((scope) => relative.startsWith(`${scope.scope}/`))) {
      continue;
    }
    const rule = config.rules.find(
      (candidate) =>
        relative.startsWith(`${candidate.scope}/`) &&
        new RegExp(candidate.filePattern).test(baseName)
    );
    if (!rule) {
      continue;
    }
    checked += 1;
    if (!new RegExp(rule.namePattern).test(baseName)) {
      violations.push(`${relative}: violates "${rule.label}" (${rule.namePattern})`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('naming lint FAILED:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `naming lint passed (${checked} files checked; ${exceptionFiles.size} exception(s); parked scopes NOT scanned: ${
    parkedScopes.map((parked) => parked.scope).join(', ') || 'none'
  } — see config parkedScopes for the C3/SD-5-p2 un-park condition).\n`
);

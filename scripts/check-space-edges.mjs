// Space allowed-edge gate, AlembicCore side (P2 AD1 pA1).
//
// Consumes config/space-allowed-edges.json (the canonical space DAG) and
// verifies AlembicCore's OWN edges only — consumer repos verify theirs in
// their own check pipelines per the config's consumerContract:
//  1. Manifest edges — Core's package.json declares ZERO space-package
//     dependencies (allowedDependencies: []) and no file: links to
//     sibling repos.
//  2. Source edges — no @alembic/* package import appears anywhere in
//     src/ or scripts/ (Core is the root of the DAG; it imports nothing
//     from the space).
//  3. Exact-edge allowlist integrity — every entry carries
//     repo/dependency/owner/reason/cleanupTrigger; Core honors entries
//     scoped to alembicCore.
//  4. Toolchain floor — the gate toolchain meets the recorded space floor
//     (node / typescript / biome / vitest), failing with an explicit
//     message below floor. Floors record current facts; the drift rule
//     lives in the config.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(path.join(CORE_ROOT, 'config/space-allowed-edges.json'), 'utf8')
);
const pkg = JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));

const failures = [];
const SELF = 'alembicCore';
const selfEntry = config.repos?.[SELF];
if (!selfEntry) {
  console.error('Space-edge gate: config/space-allowed-edges.json has no alembicCore entry.');
  process.exit(1);
}

// 3. allowlist integrity (validated first so violations can consult it)
const allowlist = Array.isArray(config.exactEdgeAllowlist) ? config.exactEdgeAllowlist : [];
for (const entry of allowlist) {
  for (const field of ['repo', 'dependency', 'owner', 'reason', 'cleanupTrigger']) {
    if (!entry?.[field]) {
      failures.push(
        `exactEdgeAllowlist entry ${JSON.stringify(entry)} is missing required field '${field}'`
      );
    }
  }
}
const selfAllowlisted = new Set(
  allowlist.filter((entry) => entry.repo === SELF).map((entry) => entry.dependency)
);

// 1. manifest edges
const allowed = new Set(selfEntry.allowedDependencies ?? []);
// Space package names come from the canonical config (P3 step 8 alignment:
// a hardcoded 'alembic' literal went stale when the live manifest name
// turned out to be 'alembic-ai' — deriving from repos[*].packageName keeps
// the detector aligned with the config by construction).
const spacePackageNames = new Set(
  Object.values(config.repos).map((entry) => entry.packageName)
);
const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
for (const [name, version] of Object.entries(declared)) {
  const isSpacePackage = name.startsWith('@alembic/') || spacePackageNames.has(name);
  const isSiblingLink = typeof version === 'string' && version.startsWith('file:..');
  if ((isSpacePackage || isSiblingLink) && !allowed.has(name) && !selfAllowlisted.has(name)) {
    failures.push(
      `package.json declares space edge '${name}: ${version}' but alembicCore.allowedDependencies is [${[...allowed].join(', ')}]`
    );
  }
}

// 2. source edges
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.mjs', '.js']);
const SPACE_IMPORT_RE = /['"](@alembic\/(?!core)[a-z-]+(?:\/[^'"]*)?)['"]/g;

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolute, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

for (const scanRoot of ['src', 'scripts']) {
  for (const file of collectFiles(path.join(CORE_ROOT, scanRoot))) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(SPACE_IMPORT_RE)) {
      const specifier = match[1];
      const packageName = specifier.split('/').slice(0, 2).join('/');
      if (!allowed.has(packageName) && !selfAllowlisted.has(packageName)) {
        const line = content.slice(0, match.index).split('\n').length;
        failures.push(
          `${path.relative(CORE_ROOT, file)}:${line} references space package '${specifier}' — Core sits at the DAG root and may not depend on space packages`
        );
      }
    }
  }
}

// 4. toolchain floor
const floor = config.toolchainFloor ?? {};
const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeFloorMajor = Number((floor.node ?? '>=0').replace(/[^0-9.]/g, '').split('.')[0]);
if (nodeMajor < nodeFloorMajor) {
  failures.push(
    `toolchain floor: node ${process.versions.node} is below the space floor ${floor.node} — upgrade node (see toolchainFloor drift rule)`
  );
}
function installedVersion(name) {
  try {
    return JSON.parse(
      readFileSync(path.join(CORE_ROOT, 'node_modules', name, 'package.json'), 'utf8')
    ).version;
  } catch {
    return null;
  }
}
const tsVersion = installedVersion('typescript');
if (!tsVersion || !tsVersion.startsWith('5.9.')) {
  failures.push(
    `toolchain floor: typescript ${tsVersion ?? 'MISSING'} does not satisfy the space floor ${floor.typescript}`
  );
}
const biomeVersion = installedVersion('@biomejs/biome');
if (!biomeVersion || biomeVersion !== floor.biome) {
  failures.push(
    `toolchain floor: biome ${biomeVersion ?? 'MISSING'} does not match the pinned space floor ${floor.biome}`
  );
}
const vitestVersion = installedVersion('vitest');
if (!vitestVersion || Number(vitestVersion.split('.')[0]) < 4) {
  failures.push(
    `toolchain floor: vitest ${vitestVersion ?? 'MISSING'} is below the space floor ${floor.vitest}`
  );
}

if (failures.length > 0) {
  console.error(`Space-edge gate failed: ${failures.length} issue(s).`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Space-edge gate OK: alembicCore declares no space edges (DAG root), source scan clean across src/+scripts/, toolchain floor met (node ${process.versions.node}, tsc ${tsVersion}, biome ${biomeVersion}, vitest ${vitestVersion}).`
);

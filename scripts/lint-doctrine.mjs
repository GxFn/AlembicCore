// Side-effect doctrine lint (P2 AD6, Core): blocks the machine-checkable
// AD0 doctrine pattern classes over src/, consuming the AD4 blessed-
// singletons config (the exhaustive exception set) — method precedent:
// the accepted Alembic leg (c8aaefa).
//
//  A. module-scope mutable `let` bindings, EXCEPT null-initialized lazy
//     slots (`let _x: T | null = null` / `let _x: any = null` — the AD4
//     managed-lifecycle accessor idiom; Core's ast grammar handles use
//     `any` for native modules);
//  B. module-scope EMPTY `new Map()` / `new Set()` accumulators (literal-
//     seeded const lookups are immutable and unmatched by construction).
//
// Exemptions come ONLY from config/blessed-singletons.json lintExemptions
// rows, each tied to a blessed entry id or an explicit constant-class
// reason — nothing implicit. Eager `const x = new Class()` singletons are
// deliberately NOT a regex class here: Core has 16 stateless constant-
// class pack instances that would drown the signal; that surface is
// governed by the blessed list + its drift test instead (recorded
// judgment, AD6).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'config/blessed-singletons.json'), 'utf8')
);
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

const LET_BINDING_RE = /^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)[^\n;]*;?\s*$/gm;
const NULL_SLOT_RE = /=\s*null;?\s*$/;
const EMPTY_COLLECTION_RE =
  /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)(\s*:\s*[^=\n]+)?\s*=\s*new\s+(Map|Set)\s*(?:<[^>]*>)?\s*\(\s*\)/gm;

const exemptions = config.lintExemptions ?? [];
const blessedIds = new Set((config.blessed ?? []).map((entry) => entry.id));
for (const row of exemptions) {
  for (const field of ['file', 'binding', 'reason']) {
    if (!row?.[field]) {
      console.error(`Doctrine lint: lintExemptions row ${JSON.stringify(row)} missing '${field}'.`);
      process.exit(1);
    }
  }
  if (!row.blessedId && row.constantClass !== true) {
    console.error(
      `Doctrine lint: lintExemptions row ${row.file}::${row.binding} must reference a blessedId or declare constantClass:true.`
    );
    process.exit(1);
  }
  if (row.blessedId && !blessedIds.has(row.blessedId)) {
    console.error(
      `Doctrine lint: lintExemptions row ${row.file}::${row.binding} references unknown blessedId '${row.blessedId}'.`
    );
    process.exit(1);
  }
}
const exempt = new Set(exemptions.map((row) => `${row.file}::${row.binding}`));

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

function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

const violations = [];
let scanned = 0;
for (const absolute of collectFiles(path.join(REPO_ROOT, 'src'))) {
  const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
  const content = readFileSync(absolute, 'utf8');
  scanned += 1;

  for (const match of content.matchAll(LET_BINDING_RE)) {
    const binding = match[1];
    if (NULL_SLOT_RE.test(match[0].trimEnd())) {
      continue; // null-initialized lazy slot (managed-lifecycle idiom)
    }
    if (exempt.has(`${relative}::${binding}`)) {
      continue;
    }
    violations.push(
      `${relative}:${lineAt(content, match.index)} module-scope mutable 'let ${binding}' outside the null-slot idiom — use a managed lifecycle or add a lintExemptions row tied to a blessed entry`
    );
  }

  for (const match of content.matchAll(EMPTY_COLLECTION_RE)) {
    const binding = match[1];
    if (exempt.has(`${relative}::${binding}`)) {
      continue;
    }
    violations.push(
      `${relative}:${lineAt(content, match.index)} module-scope empty new ${match[3]}() accumulator '${binding}' — bounded blessed caches need a lintExemptions row; everything else needs a managed lifecycle`
    );
  }
}

if (violations.length > 0) {
  console.error(`Doctrine lint failed: ${violations.length} violation(s) across ${scanned} files.`);
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Doctrine lint OK: ${scanned} src files clean (null-slot idiom honored; ${exempt.size} blessed exemptions consumed from config/blessed-singletons.json).`
);

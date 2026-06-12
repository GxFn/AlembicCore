/**
 * P3 t2 — consumer-import scanner multi-line regression gate
 * (TODO CO1-SCANNER-MULTILINE-BLIND-SPOT).
 *
 * The scanner's statement matcher excluded newlines from the specifier-list
 * segment, so multi-line `import { a,\n b } from '@alembic/core/x'`
 * statements were invisible — consumer allowlists were calibrated against
 * undercounted references. This fixture proves multi-line statements are
 * detected in every statement form the scanner claims to cover.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Scanner module is plain ESM under scripts/ — imported directly so the
// fixture exercises the exact production matcher.
// @ts-expect-error - untyped .mjs script module
import { scanConsumerCoreImports } from '../scripts/lint-consumer-core-imports.mjs';

interface ScanReference {
  specifier: string;
  filePath: string;
}

interface ScanResult {
  references: ScanReference[];
  issues: unknown[];
  filesScanned: number;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    adapterPathGlobs: [],
    allowProvisional: false,
    allowedSpecifiers: new Set<string>(),
    configPath: null,
    includeMockReferences: false,
    ignoreGlobs: [],
    referenceLimits: {},
    scanRoots: ['src'],
    ...overrides,
  };
}

describe('Consumer-import scanner multi-line detection', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-multiline-'));
    fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function write(file: string, content: string) {
    fs.writeFileSync(path.join(fixtureRoot, 'src', file), content);
  }

  test('multi-line named imports are counted (the previous blind spot)', () => {
    write(
      'multiline.ts',
      [
        'import {',
        '  CORE_FAILURE_TAXONOMY,',
        '  type CoreFailureTaxonomyEntry,',
        "} from '@alembic/core/shared';",
        '',
        'export const probe = CORE_FAILURE_TAXONOMY;',
      ].join('\n')
    );

    const result = scanConsumerCoreImports(fixtureRoot, makeConfig()) as ScanResult;
    expect(result.references.map((reference) => reference.specifier)).toEqual([
      '@alembic/core/shared',
    ]);
    // Non-stable + not allowlisted → the newly visible import is an issue,
    // proving the gate sees what calibration must account for.
    expect(result.issues).toHaveLength(1);
  });

  test('multi-line export-from and dynamic import are counted too', () => {
    write(
      'exportfrom.ts',
      ['export {', '  something,', "} from '@alembic/core/knowledge';", ''].join('\n')
    );
    write(
      'dynamic.ts',
      [
        'export async function load() {',
        '  return import(',
        "    '@alembic/core/repository/knowledge/KnowledgeUnitOfWork.js'",
        '  );',
        '}',
        '',
      ].join('\n')
    );

    const result = scanConsumerCoreImports(fixtureRoot, makeConfig()) as ScanResult;
    const specifiers = result.references.map((reference) => reference.specifier).sort();
    expect(specifiers).toEqual([
      '@alembic/core/knowledge',
      '@alembic/core/repository/knowledge/KnowledgeUnitOfWork.js',
    ]);
  });

  test('single-line imports keep working and a statement boundary is respected', () => {
    write(
      'singleline.ts',
      [
        "import { a } from '@alembic/core/knowledge';",
        "const unrelated = 'not an import';",
        // A semicolon ends the statement: the matcher must NOT bridge two
        // statements into one bogus reference.
        "import { b } from './local.js';",
        '',
      ].join('\n')
    );

    const result = scanConsumerCoreImports(fixtureRoot, makeConfig()) as ScanResult;
    expect(result.references.map((reference) => reference.specifier)).toEqual([
      '@alembic/core/knowledge',
    ]);
  });
});

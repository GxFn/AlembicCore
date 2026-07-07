/**
 * P0.0 — enforcement-matrix round-trip (the HARD first step).
 *
 * Freezes "what reject fires, in which stage, on which submit paths" so the
 * "two investigations disagreed" ambiguity can never recur. The matrix is
 * round-tripped against the LIVE gate sources so it cannot silently drift:
 *   - stage 1/2 code keys MUST equal the declared reject-code unions, and
 *   - stage 3 entry count MUST equal the live UnifiedValidator errors.push count.
 * Verb counts are DERIVED from the live Set, never hardcoded (§C.10).
 *
 * Grounded on: state-root evidence/p0-gate-truth-matrix-2026-06-30.md (controller oracle).
 * No behavior is wired yet (P0 is additive) — this is a read + assert task.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getImperativeVerbAllowlist } from '../src/knowledge.js';
import matrix from './fixtures/recipe-gate-enforcement-matrix.json' with { type: 'json' };

// cwd = AlembicCore when vitest runs. In the full local workspace AlembicPlugin
// is a sibling; in the standalone GitHub Actions checkout it is intentionally
// absent, so Plugin live-source round-trips are skipped but Core-only matrix
// checks still run.
const PLUGIN_ROOT = path.resolve(process.cwd(), '../AlembicPlugin');
// Paths follow AlembicPlugin's recipe-pipeline four-rings refactor: the
// stage-1 content-quality gate now lives under host-runtime, and the stage-2
// evidence gate under recipe-pipeline/curate. Stale paths here silently
// degrade the round-trip to it.skip and defeat the drift guard.
const STAGE1_FILE = path.join(
  PLUGIN_ROOT,
  'lib/host-runtime/mcp/handlers/recipe-content-quality-gate.ts'
);
const STAGE2_FILE = path.join(
  PLUGIN_ROOT,
  'lib/recipe-pipeline/curate/recipe-evidence-gate.ts'
);
const STAGE3_FILE = path.resolve(process.cwd(), 'src/domain/knowledge/UnifiedValidator.ts');
const PLUGIN_LIVE_SOURCE_FILES = [STAGE1_FILE, STAGE2_FILE] as const;
const MISSING_PLUGIN_LIVE_SOURCE_FILES = PLUGIN_LIVE_SOURCE_FILES.filter(
  (file) => !fs.existsSync(file)
);
const pluginLiveSourceIt = MISSING_PLUGIN_LIVE_SOURCE_FILES.length === 0 ? it : it.skip;

function read(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `P0.0 matrix round-trip requires the live gate source at ${file} (co-located AlembicPlugin/AlembicCore). Missing → cannot prove the matrix is drift-free.`
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/** Extract the ALL-CAPS code literals declared in `export type <name> = 'A' | 'B' | ...;`. */
function unionCodes(src: string, typeName: string): Set<string> {
  const block = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!block) {
    throw new Error(`reject-code union ${typeName} not found in source`);
  }
  return new Set([...block[1].matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]));
}

describe('P0.0 recipe gate enforcement matrix — round-trips against live sources', () => {
  if (MISSING_PLUGIN_LIVE_SOURCE_FILES.length > 0) {
    it('documents Plugin live-source assertions skipped in standalone Core checkout', () => {
      expect(MISSING_PLUGIN_LIVE_SOURCE_FILES.length).toBeGreaterThan(0);
      for (const file of MISSING_PLUGIN_LIVE_SOURCE_FILES) {
        expect(path.isAbsolute(file)).toBe(true);
      }
    });
  }

  pluginLiveSourceIt(
    'stage 1 matrix codes == RecipeContentQualityViolationCode union (no drift)',
    () => {
      const stage1Src = read(STAGE1_FILE);
      const liveCodes = unionCodes(stage1Src, 'RecipeContentQualityViolationCode');
      const matrixCodes = new Set(Object.keys(matrix.stage1.codes));
      expect([...matrixCodes].sort()).toEqual([...liveCodes].sort());
      // every entry tagged stage 1, always-run, host-agent path
      for (const entry of Object.values(matrix.stage1.codes)) {
        expect(entry.stage).toBe(1);
        expect(entry.alwaysOrConditional).toBe('always');
        expect(entry.paths).toContain('host-agent');
      }
    }
  );

  pluginLiveSourceIt(
    'stage 2 matrix codes == RecipeEvidenceViolationCode union (incl. dead SOURCE_REF_BARE)',
    () => {
      const stage2Src = read(STAGE2_FILE);
      const liveCodes = unionCodes(stage2Src, 'RecipeEvidenceViolationCode');
      const matrixCodes = new Set(Object.keys(matrix.stage2.codes));
      expect([...matrixCodes].sort()).toEqual([...liveCodes].sort());
      // dead code recorded honestly: never-emitted, no path
      expect(matrix.stage2.codes.SOURCE_REF_BARE.alwaysOrConditional).toBe('dead');
      expect(matrix.stage2.codes.SOURCE_REF_BARE.paths).toEqual([]);
      // layered finding: DIMENSION_*/QUALITY_GATE_FAILED serve dimension_complete, not submit
      for (const [code, entry] of Object.entries(matrix.stage2.codes)) {
        if (entry.paths.includes('dimension-complete')) {
          expect(code === 'QUALITY_GATE_FAILED' || code.startsWith('DIMENSION_')).toBe(true);
        }
      }
    }
  );

  it('stage 3 entry count == live UnifiedValidator errors.push count (derived, not hardcoded)', () => {
    const stage3Src = read(STAGE3_FILE);
    const livePushCount = (stage3Src.match(/errors\.push\(/g) ?? []).length;
    expect(Object.keys(matrix.stage3.rules).length).toBe(livePushCount);
    for (const entry of Object.values(matrix.stage3.rules)) {
      expect(entry.stage).toBe(3);
      // stage 3 runs on every submit path (host-agent + in-process)
      expect(entry.paths).toEqual(expect.arrayContaining(['host-agent', 'in-process']));
    }
  });

  it('imperative verb counts derived from the live allowlist (module is the source post-P1 re-point)', () => {
    // P1 re-pointed the Plugin stage-1 gate to import the verb allowlist from the RecipeAuthoringSpec
    // module (@alembic/core/knowledge); the live source for the Sets is now the module, not an inline
    // Plugin Set. Counts still come from the live source — derived, never hardcoded (§C.10).
    const { positive, negative } = getImperativeVerbAllowlist();
    expect(new Set(positive).size).toBe(positive.length); // no dup
    expect(positive.length).toBeGreaterThan(negative.length);
    expect(negative.length).toBeGreaterThan(0);
  });

  it('layered model: stage 1 always, stage 2 conditional (cold-start), stage 3 always', () => {
    expect(matrix.stage1._runs).toMatch(/always/i);
    expect(matrix.stage2._runs).toMatch(/cold-start/i);
    expect(matrix.stage3._runs).toMatch(/always/i);
  });
});

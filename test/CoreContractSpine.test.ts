import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES,
  CORE_CONTRACT_SPINE_ROW_IDS,
  CORE_CONTRACT_SPINE_ROWS,
  CORE_CONTRACT_SPINE_VERSION,
  summarizeCoreContractSpine,
  validateCoreContractSpine,
} from '../src/shared/index.js';

interface PackageJson {
  exports: Record<string, unknown>;
}

const CORE_ROOT = process.cwd();

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8'));
}

function sourceFilesFromRows() {
  return CORE_CONTRACT_SPINE_ROWS.flatMap((row) => row.sourceFiles);
}

describe('Core deterministic contract spine', () => {
  it('locks the D2 accepted registry row set without adding outer responsibilities', () => {
    expect(CORE_CONTRACT_SPINE_VERSION).toBe(1);
    expect(CORE_CONTRACT_SPINE_ROWS.map((row) => row.id)).toEqual([...CORE_CONTRACT_SPINE_ROW_IDS]);
    expect(CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES).toEqual([
      'codex-mcp',
      'dashboard-ui-state',
      'ai-provider-runtime',
      'cli-daemon-runtime',
      'agent-tool-execution',
      'tool-execution',
    ]);
    expect(CORE_CONTRACT_SPINE_ROWS.some((row) => row.coreRole === 'shared-schema-source')).toBe(
      true
    );
    expect(CORE_CONTRACT_SPINE_ROWS.map((row) => row.coreRole)).not.toContain('codex-mcp');
  });

  it('validates the current package exports and source files against every D2 row', () => {
    const packageJson = readPackageJson();
    const sourceFiles = sourceFilesFromRows();

    for (const sourceFile of sourceFiles) {
      expect(existsSync(path.join(CORE_ROOT, sourceFile)), sourceFile).toBe(true);
    }

    expect(
      validateCoreContractSpine({
        packageExports: Object.keys(packageJson.exports),
        sourceFiles,
      })
    ).toEqual({
      issues: [],
      rowCount: 9,
      valid: true,
      version: CORE_CONTRACT_SPINE_VERSION,
    });
  });

  it('keeps every row tied to consumers, drift gates, and non-happy-path fields', () => {
    for (const row of CORE_CONTRACT_SPINE_ROWS) {
      expect(row.consumers.length, row.id).toBeGreaterThan(0);
      expect(row.currentCompatibilityOwner.length, row.id).toBeGreaterThan(0);
      expect(row.errorKinds.length, row.id).toBeGreaterThan(0);
      expect(row.exposureClasses.length, row.id).toBeGreaterThan(0);
      expect(row.capabilityCoverage.length, row.id).toBeGreaterThan(0);
      expect(row.capabilityDiscovery.length, row.id).toBeGreaterThan(0);
      expect(row.removalBlocker.length, row.id).toBeGreaterThan(0);
      expect(row.driftGate.length, row.id).toBeGreaterThan(0);
      expect(row.validationCommands.length, row.id).toBeGreaterThan(0);
    }
  });

  it('reports missing public facades as contract drift', () => {
    const packageJson = readPackageJson();
    const packageExports = Object.keys(packageJson.exports).filter(
      (exportPath) => exportPath !== './guard'
    );
    const validation = validateCoreContractSpine({ packageExports });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-export',
        path: 'rows.I21.requiredExportPaths',
        rowId: 'I21',
      })
    );
  });

  it('summarizes Core roles separately from provider/runtime ownership', () => {
    expect(summarizeCoreContractSpine()).toMatchObject({
      coreRoles: {
        'package-producer': 1,
        'shared-schema-source': 7,
        'shared-source-contract': 1,
      },
      functionClasses: {
        'diagnostic-observability': 1,
        'event-stream': 1,
        'job-artifact': 1,
        'package-export': 1,
        'rest-command': 4,
        'rest-query': 1,
      },
      rowIds: [...CORE_CONTRACT_SPINE_ROW_IDS],
      version: CORE_CONTRACT_SPINE_VERSION,
    });
  });
});

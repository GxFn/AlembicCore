import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES,
  CORE_CONTRACT_SPINE_ROW_IDS,
  CORE_CONTRACT_SPINE_ROWS,
  CORE_CONTRACT_SPINE_VERSION,
  CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES,
  CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS,
  summarizeCoreContractSpine,
  summarizeCoreLegacyContractConvergence,
  validateCoreContractSpine,
  validateCoreLegacyContractConvergence,
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

function sourceFilesFromConvergenceCandidates() {
  return CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.flatMap((candidate) => candidate.sourceFiles);
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

describe('Core legacy contract convergence', () => {
  it('locks the D9 candidate set and records delete vs preserve decisions', () => {
    expect(CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.map((candidate) => candidate.id)).toEqual([
      ...CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS,
    ]);

    const summary = summarizeCoreLegacyContractConvergence();
    expect(summary).toMatchObject({
      candidateIds: [...CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS],
      deletedCandidateIds: ['D9-C04'],
      preservedCandidateIds: ['D9-C01', 'D9-C02', 'D9-C03'],
      statuses: {
        'already-solved': 0,
        blocked: 0,
        deleted: 1,
        'preserved-with-owner': 3,
        rewritten: 0,
      },
      version: CORE_CONTRACT_SPINE_VERSION,
    });
  });

  it('validates package exports and source files for every D9 convergence candidate', () => {
    const packageJson = readPackageJson();
    const sourceFiles = sourceFilesFromConvergenceCandidates();

    for (const sourceFile of sourceFiles) {
      expect(existsSync(path.join(CORE_ROOT, sourceFile)), sourceFile).toBe(true);
    }

    expect(
      validateCoreLegacyContractConvergence({
        packageExports: Object.keys(packageJson.exports),
        sourceFiles,
      })
    ).toEqual({
      candidateCount: 4,
      issues: [],
      valid: true,
      version: CORE_CONTRACT_SPINE_VERSION,
    });
  });

  it('keeps preserved legacy surfaces tied to current owners and cleanup triggers', () => {
    const preserved = CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.filter(
      (candidate) => candidate.status === 'preserved-with-owner'
    );

    for (const candidate of preserved) {
      expect(candidate.currentConsumers.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.currentCompatibilityOwner.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.cleanupBlocker.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.removalTrigger.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.publicExposurePolicy).toMatch(/canonical|compatibility|stay outside Core/i);
    }
  });

  it('blocks deleting a legacy surface while active consumer evidence remains', () => {
    const validation = validateCoreLegacyContractConvergence({
      activeLegacyConsumerRefs: ['D9-C04'],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        candidateId: 'D9-C04',
        code: 'deleted-candidate-has-active-consumer',
        path: 'candidates.D9-C04.status',
      })
    );
  });

  it('records file monitor aliases and ProjectScope legacy refs as compatibility-only', () => {
    const fileMonitor = CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.find(
      (candidate) => candidate.id === 'D9-C02'
    );
    const projectScope = CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.find(
      (candidate) => candidate.id === 'D9-C03'
    );

    expect(fileMonitor?.publicExposurePolicy).toContain('canonical acceptedEventSources');
    expect(fileMonitor?.removalTrigger).toContain('compatibilityAliases');
    expect(projectScope?.publicExposurePolicy).toContain('qualifiedPath/projectScopeId');
    expect(projectScope?.publicExposurePolicy).toContain('ambiguous legacy refs must be rejected');
  });
});

/**
 * IC4 (Train A) — cross-repo error registry drift gate.
 *
 * config/error-registry.json is the script-readable registry other repos
 * read for adoption mapping. This suite is Core's adoption proof: the
 * registry must byte-match the compiled failure taxonomy, error classes,
 * and diagnostic codes — drift in either direction fails the test gate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORE_DIAGNOSTIC_CODES } from '../src/shared/DiagnosticCodes.js';
import {
  type BaseError,
  ConflictError,
  ConstitutionViolation,
  DivergenceError,
  InternalError,
  NotFoundError,
  PermissionDenied,
  PersistenceError,
  ValidationError,
} from '../src/shared/errors/index.js';
import { CORE_FAILURE_TAXONOMY } from '../src/shared/FailureTaxonomy.js';

const registry = JSON.parse(
  readFileSync(fileURLToPath(new URL('../config/error-registry.json', import.meta.url)), 'utf8')
);

describe('Error registry (config/error-registry.json)', () => {
  test('failureKinds match the compiled CORE_FAILURE_TAXONOMY exactly', () => {
    const compiledKinds = CORE_FAILURE_TAXONOMY.map((entry) => entry.kind);
    expect(registry.failureKinds).toEqual(compiledKinds);
  });

  test('errorClasses match the shared/errors classes and their stable codes', () => {
    const compiled: Record<string, string | null> = { BaseError: null };
    const classes = [
      PermissionDenied,
      ConstitutionViolation,
      ValidationError,
      NotFoundError,
      ConflictError,
      InternalError,
      PersistenceError,
      DivergenceError,
    ];
    for (const ErrorClass of classes) {
      // Instantiate to read the stable code each class pins in its constructor.
      const instance =
        ErrorClass === ConstitutionViolation
          ? new ConstitutionViolation([{ rule: 'probe' }])
          : ErrorClass === ConflictError
            ? new ConflictError('probe', {})
            : new (ErrorClass as new (message: string) => BaseError)('probe');
      compiled[ErrorClass.name] = instance.code;
    }
    expect(registry.errorClasses).toEqual(compiled);
  });

  test('diagnosticCodes match CORE_DIAGNOSTIC_CODES values exactly', () => {
    expect(registry.diagnosticCodes).toEqual(Object.values(CORE_DIAGNOSTIC_CODES));
  });

  test('adoption section names every repo with a status and path', () => {
    for (const repo of [
      'alembicCore',
      'alembic',
      'alembicAgent',
      'alembicPlugin',
      'alembicDashboard',
    ]) {
      expect(registry.adoption[repo]?.status).toBeTruthy();
    }
    // The Agent ruling is recorded as documentation, not integration.
    expect(registry.adoption.alembicAgent.decision).toMatch(/DOCUMENT/);
    expect(
      Object.keys(registry.adoption.alembicAgent.mappingToCoreFailureKinds).length
    ).toBeGreaterThanOrEqual(4);
  });

  test('staged facade promotion is recorded but NOT shipped (./shared stays pinned)', () => {
    expect(registry.staged['CO3-TAXONOMY-FACADE-PROMOTION'].stagedFor).toContain('0.3.0');
    // The facade must not re-export the staged classes yet.
    const sharedIndex = readFileSync(
      fileURLToPath(new URL('../src/shared/index.ts', import.meta.url)),
      'utf8'
    );
    const errorExportBlock = sharedIndex.slice(
      sharedIndex.indexOf('export {'),
      sharedIndex.indexOf("} from './errors/index.js';")
    );
    expect(errorExportBlock).not.toContain('PersistenceError');
    expect(errorExportBlock).not.toContain('DivergenceError');
  });
});

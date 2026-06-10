import { describe, expect, it } from 'vitest';

import {
  CORE_D25_REQUIRED_FAILURE_KINDS,
  CORE_FAILURE_TAXONOMY,
  CORE_FAILURE_TAXONOMY_VERSION,
  CORE_FIELD_FAILURE_KINDS,
  getCoreFailureTaxonomyEntry,
  summarizeCoreFailureTaxonomy,
  validateCoreFailureTaxonomy,
} from '../src/shared/index.js';

describe('Core failure/problem taxonomy', () => {
  it('covers every D25 failure class while preserving Core-only safety classes', () => {
    expect(CORE_D25_REQUIRED_FAILURE_KINDS).toEqual([
      'invalid-input',
      'not-found',
      'conflict',
      'permission-denied',
      'timeout',
      'cancelled',
      'unavailable',
      'degraded',
      'partial',
      'capability-mismatch',
      'needs-confirmation',
      'provider-error',
      'host-failure',
      'internal-error',
    ]);
    expect(CORE_FIELD_FAILURE_KINDS).toEqual(
      expect.arrayContaining([...CORE_D25_REQUIRED_FAILURE_KINDS, 'schema-drift', 'sensitive-leak'])
    );
    expect(CORE_FAILURE_TAXONOMY.map((entry) => entry.kind)).toEqual([...CORE_FIELD_FAILURE_KINDS]);
  });

  it('validates stable ids, status classes, retry policy, and ref safety', () => {
    expect(validateCoreFailureTaxonomy()).toEqual({
      issues: [],
      taxonomyCount: CORE_FAILURE_TAXONOMY.length,
      valid: true,
      version: CORE_FAILURE_TAXONOMY_VERSION,
    });

    expect(summarizeCoreFailureTaxonomy()).toMatchObject({
      byProblemClass: {
        'confirmation-required': 1,
        'host-problem': 1,
        'provider-problem': 1,
        'sensitive-data-problem': 1,
      },
      byStatus: {
        'needs-confirmation': 1,
        failed: 4,
      },
      taxonomyCount: CORE_FAILURE_TAXONOMY.length,
      version: CORE_FAILURE_TAXONOMY_VERSION,
    });
  });

  it('keeps needs-confirmation, provider-error, and host-failure as distinct branches', () => {
    expect(getCoreFailureTaxonomyEntry('needs-confirmation')).toMatchObject({
      agentBranch: 'needs-confirmation',
      httpStatus: 412,
      problemClass: 'confirmation-required',
      retryPolicy: 'after-confirmation',
      stableId: 'core.failure.needs-confirmation',
      status: 'needs-confirmation',
    });
    expect(getCoreFailureTaxonomyEntry('provider-error')).toMatchObject({
      agentBranch: 'provider-error',
      httpStatus: 502,
      problemClass: 'provider-problem',
      stableId: 'core.failure.provider-error',
    });
    expect(getCoreFailureTaxonomyEntry('host-failure')).toMatchObject({
      agentBranch: 'host-failure',
      httpStatus: 424,
      problemClass: 'host-problem',
      stableId: 'core.failure.host-failure',
    });
  });

  it('keeps sensitive failure details behind a redacted ref policy', () => {
    expect(getCoreFailureTaxonomyEntry('sensitive-leak')).toMatchObject({
      detailExposureClass: 'sensitive',
      privateDataSafe: true,
      publicMessage: 'A sensitive-data safety boundary was triggered.',
      refPolicy: 'redacted-detailRef',
    });
  });

  it('reports missing taxonomy entries as contract drift', () => {
    const validation = validateCoreFailureTaxonomy(
      CORE_FAILURE_TAXONOMY.filter((entry) => entry.kind !== 'host-failure')
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-failure-kind',
        kind: 'host-failure',
      })
    );
  });
});

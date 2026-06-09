import { describe, expect, it } from 'vitest';

import {
  CORE_FIELD_CLASSES,
  CORE_FIELD_TAXONOMY,
  type CoreFieldPolicy,
  validateCoreFieldPolicies,
} from '../src/shared/index.js';

const BASE_POLICY: CoreFieldPolicy = {
  consumers: ['AlembicPlugin'],
  diagnosticPolicy: 'none',
  extensionPolicy: 'strict',
  failureKinds: ['invalid-input'],
  fieldClass: 'consumer-needed',
  fieldPath: 'ExampleContract.field',
  interfaceRole: 'consumer-projection',
  ordinaryOutputAllowed: true,
  owner: 'AlembicCore',
  validationCommands: ['npm run test -- FieldTaxonomy'],
};

describe('Core field taxonomy', () => {
  it('exports the D19 field-class vocabulary in taxonomy order', () => {
    expect(CORE_FIELD_CLASSES).toEqual([
      'public',
      'consumer-needed',
      'diagnostic',
      'internal',
      'sensitive',
      'raw-provider',
      'hidden-reasoning',
      'detailRef-only',
      'artifactRef-only',
      'compatibility-private',
      'typed-extension',
    ]);
    expect(CORE_FIELD_TAXONOMY.map((entry) => entry.className)).toEqual([...CORE_FIELD_CLASSES]);
  });

  it('catches missing policy ownership, consumers, failures, and validation commands', () => {
    const validation = validateCoreFieldPolicies(
      [
        {
          ...BASE_POLICY,
          consumers: [],
          failureKinds: [],
          owner: '',
          validationCommands: [],
        },
      ],
      { expectedFieldPaths: ['MissingContract.field'] }
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'missing-field-policy',
        'missing-owner',
        'missing-consumer',
        'missing-failure-kind',
        'missing-validation-command',
      ])
    );
  });

  it('blocks private and sensitive classes from ordinary output', () => {
    const validation = validateCoreFieldPolicies([
      {
        ...BASE_POLICY,
        diagnosticPolicy: 'redacted-summary',
        extensionPolicy: 'private-adapter',
        fieldClass: 'sensitive',
        ordinaryOutputAllowed: true,
      },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'private-field-public-exposure',
        path: 'ExampleContract.field.ordinaryOutputAllowed',
      })
    );
  });

  it('requires explicit closure policies for compatibility, typed extension, and ref-only fields', () => {
    const validation = validateCoreFieldPolicies([
      {
        ...BASE_POLICY,
        cleanupTrigger: 'consumer import scan is clean',
        extensionPolicy: 'strict',
        fieldClass: 'compatibility-private',
        ordinaryOutputAllowed: false,
      },
      {
        ...BASE_POLICY,
        extensionPolicy: 'strict',
        fieldClass: 'typed-extension',
      },
      {
        ...BASE_POLICY,
        diagnosticPolicy: 'detailRef',
        extensionPolicy: 'diagnostic-ref',
        fieldClass: 'detailRef-only',
      },
      {
        ...BASE_POLICY,
        diagnosticPolicy: 'artifactRef',
        extensionPolicy: 'diagnostic-ref',
        fieldClass: 'artifactRef-only',
      },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'closure-policy-mismatch',
        'typed-extension-policy-mismatch',
        'detail-ref-policy-mismatch',
        'artifact-ref-policy-mismatch',
      ])
    );
  });

  it('requires diagnostic policy when a class is diagnostic-context-only', () => {
    const validation = validateCoreFieldPolicies([
      {
        ...BASE_POLICY,
        diagnosticPolicy: 'none',
        extensionPolicy: 'diagnostic-ref',
        fieldClass: 'diagnostic',
        ordinaryOutputAllowed: false,
      },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-diagnostic-policy',
        path: 'ExampleContract.field.diagnosticPolicy',
      })
    );
  });
});

export const CORE_FIELD_CLASSES = [
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
] as const;

export const CORE_PRIVATE_FIELD_CLASSES = [
  'internal',
  'sensitive',
  'raw-provider',
  'hidden-reasoning',
  'compatibility-private',
] as const satisfies readonly CoreFieldClass[];

export const CORE_SCHEMA_CLOSURE_POLICIES = [
  'strict',
  'typed-extension',
  'diagnostic-ref',
  'detailRef-only',
  'artifactRef-only',
  'compatibility-gated',
  'private-adapter',
] as const;

export const CORE_INTERFACE_ROLES = [
  'producer-contract',
  'consumer-projection',
  'diagnostic-extension',
  'compatibility-bridge',
  'internal-runtime',
] as const;

export const CORE_DIAGNOSTIC_POLICIES = [
  'none',
  'diagnostic-context',
  'redacted-summary',
  'detailRef',
  'artifactRef',
] as const;

export const CORE_FIELD_FAILURE_KINDS = [
  'invalid-input',
  'unavailable',
  'capability-mismatch',
  'not-found',
  'conflict',
  'permission-denied',
  'timeout',
  'cancelled',
  'partial',
  'degraded',
  'internal-error',
  'schema-drift',
  'sensitive-leak',
] as const;

export type CoreFieldClass = (typeof CORE_FIELD_CLASSES)[number];
export type CorePrivateFieldClass = (typeof CORE_PRIVATE_FIELD_CLASSES)[number];
export type CoreSchemaClosurePolicy = (typeof CORE_SCHEMA_CLOSURE_POLICIES)[number];
export type CoreInterfaceRole = (typeof CORE_INTERFACE_ROLES)[number];
export type CoreDiagnosticPolicy = (typeof CORE_DIAGNOSTIC_POLICIES)[number];
export type CoreFieldFailureKind = (typeof CORE_FIELD_FAILURE_KINDS)[number];

export interface CoreFieldTaxonomyEntry {
  className: CoreFieldClass;
  description: string;
  ordinaryOutputDefault: boolean;
  requiredClosurePolicy: CoreSchemaClosurePolicy;
  requiresConsumer: boolean;
  requiresDiagnosticContext: boolean;
  requiresRedaction: boolean;
}

export interface CoreFieldPolicy {
  cleanupTrigger?: string;
  consumers: readonly string[];
  diagnosticPolicy: CoreDiagnosticPolicy;
  extensionPolicy: CoreSchemaClosurePolicy;
  failureKinds: readonly CoreFieldFailureKind[];
  fieldClass: CoreFieldClass;
  fieldPath: string;
  interfaceRole: CoreInterfaceRole;
  ordinaryOutputAllowed: boolean;
  owner: string;
  validationCommands: readonly string[];
}

export interface CoreFieldPolicyValidationIssue {
  code:
    | 'missing-field-policy'
    | 'missing-owner'
    | 'missing-consumer'
    | 'missing-validation-command'
    | 'missing-failure-kind'
    | 'missing-cleanup-trigger'
    | 'closure-policy-mismatch'
    | 'invalid-field-class'
    | 'invalid-extension-policy'
    | 'invalid-interface-role'
    | 'invalid-diagnostic-policy'
    | 'invalid-failure-kind'
    | 'private-field-public-exposure'
    | 'forbidden-owner'
    | 'typed-extension-policy-mismatch'
    | 'detail-ref-policy-mismatch'
    | 'artifact-ref-policy-mismatch';
  fieldPath?: string;
  message: string;
  path: string;
}

export interface CoreFieldPolicyValidationResult {
  issues: CoreFieldPolicyValidationIssue[];
  policyCount: number;
  valid: boolean;
}

export interface ValidateCoreFieldPoliciesOptions {
  expectedFieldPaths?: readonly string[];
  forbiddenOwners?: readonly string[];
}

export interface CoreFieldPolicySummary {
  byClass: Record<CoreFieldClass, number>;
  byExtensionPolicy: Record<CoreSchemaClosurePolicy, number>;
  policyCount: number;
}

export const CORE_FIELD_TAXONOMY = [
  {
    className: 'public',
    description: 'Stable ordinary output or public package/API field.',
    ordinaryOutputDefault: true,
    requiredClosurePolicy: 'strict',
    requiresConsumer: false,
    requiresDiagnosticContext: false,
    requiresRedaction: false,
  },
  {
    className: 'consumer-needed',
    description: 'Field required by a named current consumer on a specific surface.',
    ordinaryOutputDefault: true,
    requiredClosurePolicy: 'strict',
    requiresConsumer: true,
    requiresDiagnosticContext: false,
    requiresRedaction: false,
  },
  {
    className: 'diagnostic',
    description: 'Troubleshooting field available only in diagnostic context.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'diagnostic-ref',
    requiresConsumer: true,
    requiresDiagnosticContext: true,
    requiresRedaction: false,
  },
  {
    className: 'internal',
    description: 'Implementation state that must not be ordinary public output.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'private-adapter',
    requiresConsumer: false,
    requiresDiagnosticContext: false,
    requiresRedaction: false,
  },
  {
    className: 'sensitive',
    description: 'Secrets, credentials, private paths, and other sensitive fields.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'private-adapter',
    requiresConsumer: false,
    requiresDiagnosticContext: true,
    requiresRedaction: true,
  },
  {
    className: 'raw-provider',
    description: 'Provider-private raw payload or transport-specific response data.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'private-adapter',
    requiresConsumer: false,
    requiresDiagnosticContext: true,
    requiresRedaction: true,
  },
  {
    className: 'hidden-reasoning',
    description: 'Hidden model reasoning or provider-equivalent private reasoning content.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'private-adapter',
    requiresConsumer: false,
    requiresDiagnosticContext: true,
    requiresRedaction: true,
  },
  {
    className: 'detailRef-only',
    description: 'Long diagnostic/log/report/replay payload exposed through detailRef only.',
    ordinaryOutputDefault: true,
    requiredClosurePolicy: 'detailRef-only',
    requiresConsumer: true,
    requiresDiagnosticContext: true,
    requiresRedaction: false,
  },
  {
    className: 'artifactRef-only',
    description: 'Large generated report/snapshot/export exposed through artifactRef only.',
    ordinaryOutputDefault: true,
    requiredClosurePolicy: 'artifactRef-only',
    requiresConsumer: true,
    requiresDiagnosticContext: true,
    requiresRedaction: false,
  },
  {
    className: 'compatibility-private',
    description: 'Compatibility field with current owner, consumer, and deletion proof gate.',
    ordinaryOutputDefault: false,
    requiredClosurePolicy: 'compatibility-gated',
    requiresConsumer: true,
    requiresDiagnosticContext: false,
    requiresRedaction: false,
  },
  {
    className: 'typed-extension',
    description: 'Explicit dynamic extension point with typed owner and validation.',
    ordinaryOutputDefault: true,
    requiredClosurePolicy: 'typed-extension',
    requiresConsumer: true,
    requiresDiagnosticContext: false,
    requiresRedaction: false,
  },
] as const satisfies readonly CoreFieldTaxonomyEntry[];

export function validateCoreFieldPolicies(
  policies: readonly CoreFieldPolicy[],
  options: ValidateCoreFieldPoliciesOptions = {}
): CoreFieldPolicyValidationResult {
  const issues: CoreFieldPolicyValidationIssue[] = [];
  const policiesByPath = new Map(policies.map((policy) => [policy.fieldPath, policy]));

  for (const fieldPath of options.expectedFieldPaths ?? []) {
    if (!policiesByPath.has(fieldPath)) {
      issues.push({
        code: 'missing-field-policy',
        fieldPath,
        message: `Missing field policy for ${fieldPath}.`,
        path: fieldPath,
      });
    }
  }

  for (const policy of policies) {
    collectPolicyShapeIssues(policy, issues, options);
  }

  return {
    issues,
    policyCount: policies.length,
    valid: issues.length === 0,
  };
}

export function summarizeCoreFieldPolicies(
  policies: readonly CoreFieldPolicy[]
): CoreFieldPolicySummary {
  const byClass = emptyFieldClassCounts();
  const byExtensionPolicy = emptyExtensionPolicyCounts();
  for (const policy of policies) {
    if (isCoreFieldClass(policy.fieldClass)) {
      byClass[policy.fieldClass] += 1;
    }
    if (isCoreSchemaClosurePolicy(policy.extensionPolicy)) {
      byExtensionPolicy[policy.extensionPolicy] += 1;
    }
  }
  return {
    byClass,
    byExtensionPolicy,
    policyCount: policies.length,
  };
}

export function isCoreFieldClass(value: unknown): value is CoreFieldClass {
  return typeof value === 'string' && CORE_FIELD_CLASSES.includes(value as CoreFieldClass);
}

export function isCoreSchemaClosurePolicy(value: unknown): value is CoreSchemaClosurePolicy {
  return (
    typeof value === 'string' &&
    CORE_SCHEMA_CLOSURE_POLICIES.includes(value as CoreSchemaClosurePolicy)
  );
}

export function isCoreInterfaceRole(value: unknown): value is CoreInterfaceRole {
  return typeof value === 'string' && CORE_INTERFACE_ROLES.includes(value as CoreInterfaceRole);
}

export function isCoreDiagnosticPolicy(value: unknown): value is CoreDiagnosticPolicy {
  return (
    typeof value === 'string' && CORE_DIAGNOSTIC_POLICIES.includes(value as CoreDiagnosticPolicy)
  );
}

export function isCoreFieldFailureKind(value: unknown): value is CoreFieldFailureKind {
  return (
    typeof value === 'string' && CORE_FIELD_FAILURE_KINDS.includes(value as CoreFieldFailureKind)
  );
}

export function isCorePrivateFieldClass(value: CoreFieldClass): value is CorePrivateFieldClass {
  return CORE_PRIVATE_FIELD_CLASSES.includes(value as CorePrivateFieldClass);
}

function collectPolicyShapeIssues(
  policy: CoreFieldPolicy,
  issues: CoreFieldPolicyValidationIssue[],
  options: ValidateCoreFieldPoliciesOptions
) {
  if (!policy.owner.trim()) {
    issues.push({
      code: 'missing-owner',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} is missing an owner.`,
      path: `${policy.fieldPath}.owner`,
    });
  }

  if (options.forbiddenOwners?.includes(policy.owner)) {
    issues.push({
      code: 'forbidden-owner',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} uses forbidden owner ${policy.owner}.`,
      path: `${policy.fieldPath}.owner`,
    });
  }

  if (!isCoreFieldClass(policy.fieldClass)) {
    issues.push({
      code: 'invalid-field-class',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} has invalid field class.`,
      path: `${policy.fieldPath}.fieldClass`,
    });
    return;
  }

  if (!isCoreSchemaClosurePolicy(policy.extensionPolicy)) {
    issues.push({
      code: 'invalid-extension-policy',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} has invalid extension policy.`,
      path: `${policy.fieldPath}.extensionPolicy`,
    });
  }

  if (!isCoreInterfaceRole(policy.interfaceRole)) {
    issues.push({
      code: 'invalid-interface-role',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} has invalid interface role.`,
      path: `${policy.fieldPath}.interfaceRole`,
    });
  }

  if (!isCoreDiagnosticPolicy(policy.diagnosticPolicy)) {
    issues.push({
      code: 'invalid-diagnostic-policy',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} has invalid diagnostic policy.`,
      path: `${policy.fieldPath}.diagnosticPolicy`,
    });
  }

  if (policy.failureKinds.length === 0) {
    issues.push({
      code: 'missing-failure-kind',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} must name at least one failure kind.`,
      path: `${policy.fieldPath}.failureKinds`,
    });
  }

  for (const failureKind of policy.failureKinds) {
    if (!isCoreFieldFailureKind(failureKind)) {
      issues.push({
        code: 'invalid-failure-kind',
        fieldPath: policy.fieldPath,
        message: `Field policy ${policy.fieldPath} has invalid failure kind ${failureKind}.`,
        path: `${policy.fieldPath}.failureKinds`,
      });
    }
  }

  if (policy.validationCommands.length === 0) {
    issues.push({
      code: 'missing-validation-command',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} must name consumer validation commands.`,
      path: `${policy.fieldPath}.validationCommands`,
    });
  }

  const taxonomy = CORE_FIELD_TAXONOMY.find((entry) => entry.className === policy.fieldClass);
  if (
    taxonomy &&
    policy.extensionPolicy !== taxonomy.requiredClosurePolicy &&
    policy.fieldClass !== 'typed-extension' &&
    policy.fieldClass !== 'detailRef-only' &&
    policy.fieldClass !== 'artifactRef-only'
  ) {
    issues.push({
      code: 'closure-policy-mismatch',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} must use ${taxonomy.requiredClosurePolicy} closure.`,
      path: `${policy.fieldPath}.extensionPolicy`,
    });
  }

  if (taxonomy?.requiresConsumer && policy.consumers.length === 0) {
    issues.push({
      code: 'missing-consumer',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} must name current consumers.`,
      path: `${policy.fieldPath}.consumers`,
    });
  }

  if (taxonomy?.requiresDiagnosticContext && policy.diagnosticPolicy === 'none') {
    issues.push({
      code: 'invalid-diagnostic-policy',
      fieldPath: policy.fieldPath,
      message: `Field policy ${policy.fieldPath} must name a diagnostic policy.`,
      path: `${policy.fieldPath}.diagnosticPolicy`,
    });
  }

  if (policy.fieldClass === 'compatibility-private' && !policy.cleanupTrigger?.trim()) {
    issues.push({
      code: 'missing-cleanup-trigger',
      fieldPath: policy.fieldPath,
      message: `Compatibility field policy ${policy.fieldPath} must name a cleanup trigger.`,
      path: `${policy.fieldPath}.cleanupTrigger`,
    });
  }

  if (isCorePrivateFieldClass(policy.fieldClass) && policy.ordinaryOutputAllowed) {
    issues.push({
      code: 'private-field-public-exposure',
      fieldPath: policy.fieldPath,
      message: `Private field policy ${policy.fieldPath} cannot allow ordinary output.`,
      path: `${policy.fieldPath}.ordinaryOutputAllowed`,
    });
  }

  if (policy.fieldClass === 'typed-extension' && policy.extensionPolicy !== 'typed-extension') {
    issues.push({
      code: 'typed-extension-policy-mismatch',
      fieldPath: policy.fieldPath,
      message: `Typed extension ${policy.fieldPath} must use typed-extension policy.`,
      path: `${policy.fieldPath}.extensionPolicy`,
    });
  }

  if (policy.fieldClass === 'detailRef-only' && policy.extensionPolicy !== 'detailRef-only') {
    issues.push({
      code: 'detail-ref-policy-mismatch',
      fieldPath: policy.fieldPath,
      message: `Detail ref field ${policy.fieldPath} must use detailRef-only policy.`,
      path: `${policy.fieldPath}.extensionPolicy`,
    });
  }

  if (policy.fieldClass === 'artifactRef-only' && policy.extensionPolicy !== 'artifactRef-only') {
    issues.push({
      code: 'artifact-ref-policy-mismatch',
      fieldPath: policy.fieldPath,
      message: `Artifact ref field ${policy.fieldPath} must use artifactRef-only policy.`,
      path: `${policy.fieldPath}.extensionPolicy`,
    });
  }
}

function emptyFieldClassCounts(): Record<CoreFieldClass, number> {
  return {
    public: 0,
    'consumer-needed': 0,
    diagnostic: 0,
    internal: 0,
    sensitive: 0,
    'raw-provider': 0,
    'hidden-reasoning': 0,
    'detailRef-only': 0,
    'artifactRef-only': 0,
    'compatibility-private': 0,
    'typed-extension': 0,
  };
}

function emptyExtensionPolicyCounts(): Record<CoreSchemaClosurePolicy, number> {
  return {
    'artifactRef-only': 0,
    'compatibility-gated': 0,
    'detailRef-only': 0,
    'diagnostic-ref': 0,
    'private-adapter': 0,
    strict: 0,
    'typed-extension': 0,
  };
}

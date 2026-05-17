import { readFileSync } from 'node:fs';

export const CORE_PACKAGE_NAME = '@alembic/core';
export const PUBLIC_API_BOUNDARY_POLICY_URL = new URL(
  '../config/public-api-boundary.json',
  import.meta.url,
);

export function loadPublicApiBoundaryPolicy(policyUrl = PUBLIC_API_BOUNDARY_POLICY_URL) {
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  validatePolicy(policy);
  return policy;
}

export function makePublicApiBoundaryClassifier(policy = loadPublicApiBoundaryPolicy()) {
  const stablePublicExports = new Set(policy.stablePublicExports);
  const provisionalPublicExports = new Set(policy.provisionalPublicExports);
  const transitionalInternalExports = new Set(policy.transitionalInternalExports);

  return function classifyPublicApiExport(exportPath) {
    if (stablePublicExports.has(exportPath)) {
      return {
        status: 'stable-public',
        reason: 'Locked by the Core stable public API policy.',
      };
    }

    if (provisionalPublicExports.has(exportPath)) {
      return {
        status: 'provisional-public',
        reason: 'Module-level migration facade that still needs narrowing.',
      };
    }

    if (transitionalInternalExports.has(exportPath)) {
      return {
        status: 'transitional-internal',
        reason: 'Migration compatibility entrypoint; new consumers need a stable facade.',
      };
    }

    if (exportPath.includes('*') && policy.wildcardExportStatus === 'transitional-internal') {
      return {
        status: 'transitional-internal',
        reason: 'Wildcard exports are migration-only compatibility surface.',
      };
    }

    return null;
  };
}

export function classifyPublicApiExport(exportPath, policy = loadPublicApiBoundaryPolicy()) {
  return makePublicApiBoundaryClassifier(policy)(exportPath);
}

export function specifierToExportPath(specifier) {
  if (specifier === CORE_PACKAGE_NAME) {
    return '.';
  }

  if (specifier.startsWith(`${CORE_PACKAGE_NAME}/`)) {
    return `./${specifier.slice(CORE_PACKAGE_NAME.length + 1)}`;
  }

  return null;
}

export function classifyCoreImportSpecifier(specifier, policy = loadPublicApiBoundaryPolicy()) {
  const exportPath = specifierToExportPath(specifier);
  if (!exportPath) {
    return undefined;
  }

  return classifyPublicApiExport(exportPath, policy)?.status ?? 'transitional-internal';
}

export function summarizePublicApiExports(exportPaths, policy = loadPublicApiBoundaryPolicy()) {
  const classifier = makePublicApiBoundaryClassifier(policy);
  const counts = {
    'stable-public': 0,
    'provisional-public': 0,
    'transitional-internal': 0,
    'internal-only': 0,
    forbidden: 0,
  };

  for (const exportPath of exportPaths) {
    const classification = classifier(exportPath);
    if (classification) {
      counts[classification.status] += 1;
    }
  }

  return counts;
}

function validatePolicy(policy) {
  const requiredArrays = [
    'stablePublicExports',
    'provisionalPublicExports',
    'transitionalInternalExports',
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(policy[key])) {
      throw new Error(`public-api-boundary policy must contain ${key}[]`);
    }
  }

  if (!policy.expectedCounts || typeof policy.expectedCounts !== 'object') {
    throw new Error('public-api-boundary policy must contain expectedCounts');
  }

  for (const key of requiredArrays) {
    const values = policy[key];
    const unique = new Set(values);
    if (unique.size !== values.length) {
      throw new Error(`public-api-boundary policy ${key} must be unique`);
    }
  }
}

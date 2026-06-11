import { readFileSync } from 'node:fs';

export const CORE_PACKAGE_NAME = '@alembic/core';
export const PUBLIC_API_BOUNDARY_POLICY_URL = new URL(
  '../config/public-api-boundary.json',
  import.meta.url,
);
export const PUBLIC_API_CLOSEOUT_CATEGORIES = [
  'promote-to-stable',
  'keep-provisional',
  'consumer-replace-first',
  'no-consumer-deprecate-candidate',
  'must-keep-transitional',
];
export const PUBLIC_API_FACADE_READINESS_DECISIONS = [
  'consumer-ready-stable',
  'consumer-ready-provisional',
  'split-required',
  'keep-transitional',
];
// Sibling consumer repositories scanned by the consumer-import gate and the
// closeout report. AlembicPlugin consumes Core through a live file: link, so
// its frozen keep-alive specifier list is a hard runtime constraint.
export const CORE_CONSUMER_REPOS = [
  {
    configPath: '../AlembicAgent/config/core-import-boundary.json',
    name: 'AlembicAgent',
    root: '../AlembicAgent',
  },
  {
    configPath: '../Alembic/config/core-import-boundary.json',
    name: 'Alembic',
    root: '../Alembic',
  },
  {
    configPath: '../AlembicPlugin/config/core-import-boundary-allowlist.json',
    name: 'AlembicPlugin',
    root: '../AlembicPlugin',
  },
];

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

export function getPublicApiCloseoutManualCategories(policy = loadPublicApiBoundaryPolicy()) {
  const rawCategories = policy.closeout?.manualCategories ?? {};
  return Object.fromEntries(
    PUBLIC_API_CLOSEOUT_CATEGORIES.map((category) => [
      category,
      Array.isArray(rawCategories[category]) ? [...rawCategories[category]] : [],
    ]),
  );
}

export function getPublicApiCloseoutMaxCounts(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.maxCounts;
}

export function getPublicApiFacadeReadiness(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.facadeReadiness ?? { groups: {}, specifiers: {} };
}

export function getPublicApiCloseoutDeprecations(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.deprecations;
}

export function getPublicApiCloseoutReviewBy(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.reviewBy?.dates ?? {};
}

export function getPublicApiTransitionalOwnership(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.transitionalOwnership ?? {};
}

export function getPublicApiRemovedExports(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.removedExports ?? {};
}

export function getPublicApiNarrowness(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.narrowness;
}

export function getPublicApiTrend(policy = loadPublicApiBoundaryPolicy()) {
  return policy.closeout?.trend;
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

  validateCloseoutPolicy(policy.closeout);
}

function validateCloseoutPolicy(closeout) {
  if (closeout === undefined) {
    return;
  }

  if (!closeout || typeof closeout !== 'object' || Array.isArray(closeout)) {
    throw new Error('public-api-boundary policy closeout must be an object');
  }

  if (closeout.schemaVersion !== 1) {
    throw new Error('public-api-boundary policy closeout.schemaVersion must be 1');
  }

  validateCloseoutMaxCounts(closeout.maxCounts);
  validateCloseoutManualCategories(closeout.manualCategories ?? {});
  validateFacadeReadiness(closeout.facadeReadiness);
  validateRemovedExports(closeout.removedExports);
  validateDeprecations(closeout.deprecations);
  validateReviewBy(closeout.reviewBy);
  validateTransitionalOwnership(closeout.transitionalOwnership);
  validateNarrowness(closeout.narrowness);
  validateTrend(closeout.trend);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`public-api-boundary policy ${label} must be an object`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`public-api-boundary policy ${label} must be a non-empty string`);
  }
}

function validateRemovedExports(removedExports) {
  if (removedExports === undefined) {
    return;
  }

  requirePlainObject(removedExports, 'closeout.removedExports');
  for (const [exportPath, record] of Object.entries(removedExports)) {
    if (!exportPath.startsWith('.')) {
      throw new Error(`public-api-boundary policy closeout.removedExports key must be an export path: ${exportPath}`);
    }
    requirePlainObject(record, `closeout.removedExports.${exportPath}`);
    requireNonEmptyString(record.removedAt, `closeout.removedExports.${exportPath}.removedAt`);
    requireNonEmptyString(record.scanEvidence, `closeout.removedExports.${exportPath}.scanEvidence`);
    if (typeof record.replacementFacade !== 'string' || !record.replacementFacade.startsWith('.')) {
      throw new Error(
        `public-api-boundary policy closeout.removedExports.${exportPath}.replacementFacade must name a stable replacement export path`,
      );
    }
  }
}

function validateDeprecations(deprecations) {
  if (deprecations === undefined) {
    return;
  }

  requirePlainObject(deprecations, 'closeout.deprecations');
  if (deprecations.schemaVersion !== 1) {
    throw new Error('public-api-boundary policy closeout.deprecations.schemaVersion must be 1');
  }
  requireNonEmptyString(deprecations.deprecatedAt, 'closeout.deprecations.deprecatedAt');
  requireNonEmptyString(deprecations.removalRelease, 'closeout.deprecations.removalRelease');
  if (!Array.isArray(deprecations.exportPaths) || deprecations.exportPaths.some((p) => typeof p !== 'string' || !p.startsWith('.'))) {
    throw new Error('public-api-boundary policy closeout.deprecations.exportPaths must be an array of export paths');
  }
  if (new Set(deprecations.exportPaths).size !== deprecations.exportPaths.length) {
    throw new Error('public-api-boundary policy closeout.deprecations.exportPaths must be unique');
  }
}

function validateReviewBy(reviewBy) {
  if (reviewBy === undefined) {
    return;
  }

  requirePlainObject(reviewBy, 'closeout.reviewBy');
  requirePlainObject(reviewBy.dates ?? {}, 'closeout.reviewBy.dates');
  for (const [exportPath, date] of Object.entries(reviewBy.dates ?? {})) {
    if (!exportPath.startsWith('.')) {
      throw new Error(`public-api-boundary policy closeout.reviewBy.dates key must be an export path: ${exportPath}`);
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`public-api-boundary policy closeout.reviewBy.dates.${exportPath} must be a YYYY-MM-DD date`);
    }
  }
}

function validateTransitionalOwnership(transitionalOwnership) {
  if (transitionalOwnership === undefined) {
    return;
  }

  requirePlainObject(transitionalOwnership, 'closeout.transitionalOwnership');
  for (const [key, record] of Object.entries(transitionalOwnership)) {
    requirePlainObject(record, `closeout.transitionalOwnership.${key}`);
    requireNonEmptyString(record.owner, `closeout.transitionalOwnership.${key}.owner`);
    requireNonEmptyString(record.consumer, `closeout.transitionalOwnership.${key}.consumer`);
    requireNonEmptyString(record.cleanupTrigger, `closeout.transitionalOwnership.${key}.cleanupTrigger`);
  }
}

function validateNarrowness(narrowness) {
  if (narrowness === undefined) {
    return;
  }

  requirePlainObject(narrowness, 'closeout.narrowness');
  if (narrowness.schemaVersion !== 1) {
    throw new Error('public-api-boundary policy closeout.narrowness.schemaVersion must be 1');
  }
  requirePlainObject(narrowness.baselines, 'closeout.narrowness.baselines');
  for (const [exportPath, budget] of Object.entries(narrowness.baselines)) {
    if (!exportPath.startsWith('.') || !Number.isInteger(budget) || budget < 0) {
      throw new Error(
        `public-api-boundary policy closeout.narrowness.baselines.${exportPath} must map an export path to a non-negative integer`,
      );
    }
  }
}

function validateTrend(trend) {
  if (trend === undefined) {
    return;
  }

  requirePlainObject(trend, 'closeout.trend');
  if (trend.schemaVersion !== 1) {
    throw new Error('public-api-boundary policy closeout.trend.schemaVersion must be 1');
  }
  if (!Array.isArray(trend.history) || trend.history.length === 0) {
    throw new Error('public-api-boundary policy closeout.trend.history must be a non-empty array');
  }
  for (const entry of trend.history) {
    requirePlainObject(entry, 'closeout.trend.history[]');
    requireNonEmptyString(entry.date, 'closeout.trend.history[].date');
    for (const key of ['transitional-internal', 'wildcardExports', 'provisional-public']) {
      if (!Number.isInteger(entry[key]) || entry[key] < 0) {
        throw new Error(`public-api-boundary policy closeout.trend.history[].${key} must be a non-negative integer`);
      }
    }
    validateCloseoutMaxCounts(entry.maxCounts);
  }
}

function validateCloseoutMaxCounts(maxCounts) {
  if (!maxCounts || typeof maxCounts !== 'object' || Array.isArray(maxCounts)) {
    throw new Error('public-api-boundary policy closeout.maxCounts must be an object');
  }

  for (const key of ['transitional-internal', 'wildcardExports']) {
    const value = maxCounts[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`public-api-boundary policy closeout.maxCounts.${key} must be a non-negative integer`);
    }
  }
}

function validateCloseoutManualCategories(manualCategories) {
  if (!manualCategories || typeof manualCategories !== 'object' || Array.isArray(manualCategories)) {
    throw new Error('public-api-boundary policy closeout.manualCategories must be an object');
  }

  const allowedCategories = new Set(PUBLIC_API_CLOSEOUT_CATEGORIES);
  const seen = new Map();

  for (const [category, exportPaths] of Object.entries(manualCategories)) {
    if (!allowedCategories.has(category)) {
      throw new Error(`public-api-boundary policy closeout category is unknown: ${category}`);
    }

    if (!Array.isArray(exportPaths)) {
      throw new Error(`public-api-boundary policy closeout.manualCategories.${category} must be an array`);
    }

    for (const exportPath of exportPaths) {
      if (typeof exportPath !== 'string' || !exportPath.startsWith('.')) {
        throw new Error(
          `public-api-boundary policy closeout.manualCategories.${category} contains an invalid export path`,
        );
      }

      const existingCategory = seen.get(exportPath);
      if (existingCategory) {
        throw new Error(
          `public-api-boundary policy closeout export ${exportPath} is listed in both ${existingCategory} and ${category}`,
        );
      }
      seen.set(exportPath, category);
    }
  }
}

function validateFacadeReadiness(facadeReadiness) {
  if (facadeReadiness === undefined) {
    return;
  }

  if (!facadeReadiness || typeof facadeReadiness !== 'object' || Array.isArray(facadeReadiness)) {
    throw new Error('public-api-boundary policy closeout.facadeReadiness must be an object');
  }

  if (facadeReadiness.schemaVersion !== 1) {
    throw new Error('public-api-boundary policy closeout.facadeReadiness.schemaVersion must be 1');
  }

  validateReadinessEntries(facadeReadiness.groups ?? {}, 'groups');
  validateReadinessEntries(facadeReadiness.specifiers ?? {}, 'specifiers');
}

function validateReadinessEntries(entries, key) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`public-api-boundary policy closeout.facadeReadiness.${key} must be an object`);
  }

  const allowedDecisions = new Set(PUBLIC_API_FACADE_READINESS_DECISIONS);
  for (const [source, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`public-api-boundary policy closeout.facadeReadiness.${key}.${source} must be an object`);
    }

    if (!allowedDecisions.has(entry.decision)) {
      throw new Error(
        `public-api-boundary policy closeout.facadeReadiness.${key}.${source}.decision is unknown`,
      );
    }

    if (typeof entry.targetFacade !== 'string' || !entry.targetFacade.startsWith('.')) {
      throw new Error(
        `public-api-boundary policy closeout.facadeReadiness.${key}.${source}.targetFacade must be an export path`,
      );
    }

    if (entry.symbols !== undefined && !Array.isArray(entry.symbols)) {
      throw new Error(
        `public-api-boundary policy closeout.facadeReadiness.${key}.${source}.symbols must be an array`,
      );
    }
  }
}

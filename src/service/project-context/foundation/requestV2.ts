import {
  PROJECT_CONTEXT_REQUEST_KIND_VALUES,
  type ProjectContextRequestKind,
} from '../../../domain/project-context/index.js';
import { resolveAstParserLanguage } from '../shared/parserLanguage.js';
import {
  hashCanonicalJson,
  normalizePortableRelativePath,
  toProjectFactsJson,
} from './canonical.js';
import {
  PROJECT_CONTEXT_REQUEST_OUTCOME_V2_VERSION,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextFoundationRepositoryInput,
  type ProjectContextRequestAuditPlan,
  type ProjectContextRequestAuditPlanV2,
  type ProjectContextRequestEnvelopeIndexRowV2,
  type ProjectContextRequestMatrixV2,
  type ProjectFactsJson,
  type ProjectScopeManifestV1,
} from './contracts.js';
import { createProjectContextRequestAuditPlans } from './nodePorts.js';
import { normalizeProjectContextInventoryOwnersV2 } from './ownersV2.js';
import { verifyProjectScopeManifestV1 } from './scope.js';

const FILE_SURFACE_KINDS = new Set<ProjectContextRequestKind>([
  'anchor-range',
  'file-flow',
  'file-symbols',
  'source-slice',
]);

export function createProjectContextRequestAuditPlansV2(input: {
  repository: ProjectContextFoundationRepositoryInput;
  eligibleFiles: readonly ProjectContextFoundationFileDescriptor[];
  projectScopeManifest: ProjectScopeManifestV1;
}): ProjectContextRequestAuditPlanV2[] {
  verifyProjectScopeManifestV1(input.projectScopeManifest);
  assertRepositoryInScope(input.repository, input.projectScopeManifest);
  const compatibilityPlans = createProjectContextRequestAuditPlans({
    repository: input.repository,
    eligibleFiles: input.eligibleFiles.map((file) => ({
      ...file,
      ownerModuleIds: normalizeProjectContextInventoryOwnersV2(file)
        .filter(
          (owner) =>
            ['package-build-declaration', 'host-declared'].includes(owner.origin) &&
            owner.disposition !== 'ambiguous'
        )
        .map((owner) => owner.ownerModuleId),
    })),
  });
  const nonFilePlans = compatibilityPlans
    .filter((plan) => !FILE_SURFACE_KINDS.has(plan.kind))
    .map((plan) => toV2Plan(plan, { ownerSurfaceId: readOwnerSurface(plan) }));
  const emptyInventoryFilePlans =
    input.eligibleFiles.length === 0
      ? compatibilityPlans
          .filter((plan) => FILE_SURFACE_KINDS.has(plan.kind))
          .map((plan) => toV2Plan(plan, { ownerSurfaceId: readOwnerSurface(plan) }))
      : [];
  const representativeFiles = new Map<
    string,
    { file: ProjectContextFoundationFileDescriptor; ownerSurfaceId: string }
  >();
  for (const file of [...input.eligibleFiles].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  )) {
    const relativePath = normalizePortableRelativePath(file.relativePath, 'relativePath');
    const language = requireOptionalToken(file.language, 'language') ?? 'unknown';
    const parserFamily = resolveAstParserLanguage(relativePath, language);
    for (const ownerSurfaceId of authoritativeOwnerSurfaces(file, language, parserFamily)) {
      const key = `${language}\u0000${parserFamily ?? ''}\u0000${ownerSurfaceId}`;
      if (!representativeFiles.has(key)) {
        representativeFiles.set(key, { file, ownerSurfaceId });
      }
    }
  }
  const filePlans = [...representativeFiles.values()]
    .sort(
      (left, right) =>
        left.ownerSurfaceId.localeCompare(right.ownerSurfaceId) ||
        left.file.relativePath.localeCompare(right.file.relativePath)
    )
    .flatMap(({ file, ownerSurfaceId }) => {
      const relativePath = normalizePortableRelativePath(file.relativePath, 'relativePath');
      const language = requireOptionalToken(file.language, 'language') ?? 'unknown';
      const parserFamily = resolveAstParserLanguage(relativePath, language);
      return [
        createFilePlan('anchor-range', {
          file,
          language,
          ownerSurfaceId,
          parserFamily,
          repository: input.repository,
          selector: {
            filePath: relativePath,
            line: 1,
            radius: { afterLines: 0, beforeLines: 0 },
          },
          parserRequired: true,
        }),
        createFilePlan('file-flow', {
          file,
          language,
          ownerSurfaceId,
          parserFamily,
          repository: input.repository,
          selector: { filePath: relativePath },
          parserRequired: true,
        }),
        createFilePlan('file-symbols', {
          file,
          language,
          ownerSurfaceId,
          parserFamily,
          repository: input.repository,
          selector: { filePath: relativePath },
          parserRequired: true,
        }),
        createFilePlan('source-slice', {
          file,
          language,
          ownerSurfaceId,
          parserFamily,
          repository: input.repository,
          selector: {
            filePath: relativePath,
            includeText: true,
            range: { endLine: 1, startLine: 1 },
          },
          parserRequired: false,
        }),
      ];
    });
  return [...nonFilePlans, ...emptyInventoryFilePlans, ...filePlans].sort(comparePlans);
}

export function buildProjectContextRequestMatrixV2(
  projectScopeManifest: ProjectScopeManifestV1,
  plans: readonly ProjectContextRequestAuditPlanV2[]
): ProjectContextRequestMatrixV2 {
  verifyProjectScopeManifestV1(projectScopeManifest);
  if (plans.length === 0) {
    throw new TypeError('ProjectContextRequestMatrixV2 requires at least one request plan.');
  }
  const normalizedPlans = plans.map((plan) => normalizePlan(plan, projectScopeManifest));
  const rows = normalizedPlans.map((plan) =>
    buildRequestEnvelopeIndexRowV2(plan, projectScopeManifest)
  );
  assertUniqueRows(rows);
  const ordered = rows
    .map((row, index) => ({ plan: normalizedPlans[index]!, row }))
    .sort((left, right) => left.row.rowId.localeCompare(right.row.rowId));
  const semantic = {
    kind: 'ProjectContextRequestMatrixV2' as const,
    version: PROJECT_CONTEXT_REQUEST_OUTCOME_V2_VERSION,
    projectScopeHash: projectScopeManifest.canonicalScopeHash,
    plans: ordered.map(({ plan }) => plan),
    rows: ordered.map(({ row }) => row),
  };
  const matrixHash = hashCanonicalJson(semantic.rows);
  return {
    ...semantic,
    matrixHash,
    receiptHash: hashCanonicalJson({ ...semantic, matrixHash }),
  };
}

export function buildRequestEnvelopeIndexRowV2(
  plan: ProjectContextRequestAuditPlanV2,
  projectScopeManifest: ProjectScopeManifestV1
): ProjectContextRequestEnvelopeIndexRowV2 {
  const selectorHash = hashCanonicalJson(toProjectFactsJson(plan.selector));
  const canonicalScopeHash = buildCanonicalRequestScopeHashV2(plan, projectScopeManifest);
  const identity = {
    repoId: plan.repoId,
    kind: plan.kind,
    selectorHash,
    canonicalScopeHash,
    language: normalizeNullableToken(plan.language),
    parserFamily: normalizeNullableToken(plan.parserFamily),
    ownerSurfaceId: normalizeNullableToken(plan.ownerSurfaceId),
  };
  return {
    rowId: hashCanonicalJson(identity),
    ...identity,
    applicability: plan.applicability,
  };
}

export function buildCanonicalRequestScopeHashV2(
  plan: ProjectContextRequestAuditPlanV2,
  projectScopeManifest: ProjectScopeManifestV1
) {
  verifyProjectScopeManifestV1(projectScopeManifest);
  const repository = projectScopeManifest.repositories.find((row) => row.repoId === plan.repoId);
  if (!repository) {
    throw new TypeError(
      `V2 request references a repository outside accepted scope: ${plan.repoId}.`
    );
  }
  const scope = {
    repoId: plan.scope.repoId ?? plan.repoId,
    ...(plan.scope.sourceFolder
      ? {
          sourceFolder: normalizePortableRelativePath(
            plan.scope.sourceFolder,
            'request.scope.sourceFolder'
          ),
        }
      : {}),
    ...(plan.scope.activeFile
      ? {
          activeFile: normalizePortableRelativePath(
            plan.scope.activeFile,
            'request.scope.activeFile'
          ),
        }
      : {}),
    includeGenerated: plan.scope.includeGenerated ?? false,
    includeVendor: plan.scope.includeVendor ?? false,
  };
  if (scope.repoId !== plan.repoId) {
    throw new TypeError(`V2 request scope repoId mismatch for ${plan.repoId}/${plan.kind}.`);
  }
  return hashCanonicalJson({
    projectScopeHash: projectScopeManifest.canonicalScopeHash,
    repository,
    scope,
    selectorScope: selectScopeBearingFields(plan.selector),
  });
}

export function evaluateProjectContextRequestMatrixV2(
  expected: ProjectContextRequestMatrixV2,
  actualRows: readonly ProjectContextRequestEnvelopeIndexRowV2[],
  projectScopeManifest: ProjectScopeManifestV1
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    verifyProjectContextRequestMatrixV2(expected, projectScopeManifest);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const identities = actualRows.map(toIdentityRow);
  const rowIds = identities.map((row) => row.rowId);
  if (new Set(rowIds).size !== rowIds.length) {
    errors.push('duplicate-row-id');
  }
  const expectedRows = expected.rows.map(toIdentityRow).sort(compareRows);
  const normalizedActual = identities.sort(compareRows);
  if (hashCanonicalJson(expectedRows) !== hashCanonicalJson(normalizedActual)) {
    errors.push('request-matrix-conservation-failed');
  }
  for (const row of normalizedActual) {
    const rebuiltId = hashCanonicalJson({
      repoId: row.repoId,
      kind: row.kind,
      selectorHash: row.selectorHash,
      canonicalScopeHash: row.canonicalScopeHash,
      language: row.language,
      parserFamily: row.parserFamily,
      ownerSurfaceId: row.ownerSurfaceId,
    });
    if (rebuiltId !== row.rowId) {
      errors.push(`row-identity-mismatch:${row.rowId}`);
    }
  }
  return { ok: errors.length === 0, errors: uniqueStrings(errors) };
}

export function verifyProjectContextRequestMatrixV2(
  matrix: ProjectContextRequestMatrixV2,
  projectScopeManifest: ProjectScopeManifestV1
): void {
  verifyProjectScopeManifestV1(projectScopeManifest);
  if (matrix.kind !== 'ProjectContextRequestMatrixV2' || matrix.version !== 2) {
    throw new TypeError('Unsupported ProjectContextRequestMatrixV2 kind/version.');
  }
  const rowEvaluation = evaluateProjectContextRequestMatrixV2Unchecked(matrix.rows);
  if (!rowEvaluation.ok) {
    throw new TypeError(
      `ProjectContext request matrix is not canonical: ${rowEvaluation.errors.join(',')}.`
    );
  }
  if (hashCanonicalJson(matrix.rows.map(toIdentityRow)) !== matrix.matrixHash) {
    throw new TypeError('ProjectContext request matrix hash mismatch.');
  }
  if (matrix.projectScopeHash !== projectScopeManifest.canonicalScopeHash) {
    throw new TypeError('ProjectContext request matrix scope receipt mismatch.');
  }
  if (matrix.plans.length !== matrix.rows.length) {
    throw new TypeError('ProjectContext request matrix plan/row cardinality mismatch.');
  }
  const rebuiltPairs = matrix.plans
    .map((plan) => {
      const normalizedPlan = normalizePlan(plan, projectScopeManifest);
      return {
        plan: normalizedPlan,
        row: buildRequestEnvelopeIndexRowV2(normalizedPlan, projectScopeManifest),
      };
    })
    .sort((left, right) => left.row.rowId.localeCompare(right.row.rowId));
  if (
    hashCanonicalJson(rebuiltPairs.map(({ plan }) => plan)) !== hashCanonicalJson(matrix.plans) ||
    hashCanonicalJson(rebuiltPairs.map(({ row }) => row)) !==
      hashCanonicalJson(matrix.rows.map(toIdentityRow))
  ) {
    throw new TypeError('ProjectContext request matrix plans are not canonically bound to rows.');
  }
  const semantic = {
    kind: matrix.kind,
    version: matrix.version,
    projectScopeHash: matrix.projectScopeHash,
    plans: matrix.plans,
    rows: matrix.rows,
    matrixHash: matrix.matrixHash,
  };
  if (hashCanonicalJson(semantic) !== matrix.receiptHash) {
    throw new TypeError('ProjectContext request matrix receipt hash mismatch.');
  }
}

function evaluateProjectContextRequestMatrixV2Unchecked(
  rows: readonly ProjectContextRequestEnvelopeIndexRowV2[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (new Set(rows.map((row) => row.rowId)).size !== rows.length) {
    errors.push('duplicate-row-id');
  }
  for (const row of rows) {
    const rebuiltId = hashCanonicalJson({
      repoId: row.repoId,
      kind: row.kind,
      selectorHash: row.selectorHash,
      canonicalScopeHash: row.canonicalScopeHash,
      language: row.language,
      parserFamily: row.parserFamily,
      ownerSurfaceId: row.ownerSurfaceId,
    });
    if (rebuiltId !== row.rowId) {
      errors.push(`row-identity-mismatch:${row.rowId}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function createFilePlan(
  kind: ProjectContextRequestKind,
  input: {
    file: ProjectContextFoundationFileDescriptor;
    language: string;
    ownerSurfaceId: string;
    parserFamily: string | undefined;
    repository: ProjectContextFoundationRepositoryInput;
    selector: ProjectFactsJson;
    parserRequired: boolean;
  }
): ProjectContextRequestAuditPlanV2 {
  const applicable = !input.parserRequired || Boolean(input.parserFamily);
  return {
    authorityVersion: PROJECT_CONTEXT_REQUEST_OUTCOME_V2_VERSION,
    repoId: input.repository.repoId,
    kind,
    applicability: applicable ? 'applicable' : 'not-applicable',
    ...(applicable ? {} : { typedReason: 'no-parser-family-for-eligible-language' }),
    scope: {
      repoId: input.repository.repoId,
      sourceFolder: '.',
      activeFile: normalizePortableRelativePath(input.file.relativePath),
    },
    selector: input.selector,
    language: input.language,
    ...(input.parserFamily ? { parserFamily: input.parserFamily } : {}),
    ownerSurfaceId: input.ownerSurfaceId,
  };
}

function toV2Plan(
  plan: ProjectContextRequestAuditPlan,
  identity: { ownerSurfaceId?: string }
): ProjectContextRequestAuditPlanV2 {
  return {
    ...plan,
    authorityVersion: PROJECT_CONTEXT_REQUEST_OUTCOME_V2_VERSION,
    ...(identity.ownerSurfaceId ? { ownerSurfaceId: identity.ownerSurfaceId } : {}),
  };
}

function normalizePlan(
  plan: ProjectContextRequestAuditPlanV2,
  projectScopeManifest: ProjectScopeManifestV1
): ProjectContextRequestAuditPlanV2 {
  if (plan.authorityVersion !== 2) {
    throw new TypeError('Strict request matrix accepts only authorityVersion=2 plans.');
  }
  if (!PROJECT_CONTEXT_REQUEST_KIND_VALUES.includes(plan.kind)) {
    throw new TypeError(`Strict request matrix contains an unknown request kind: ${plan.kind}.`);
  }
  if (!['applicable', 'not-applicable'].includes(plan.applicability)) {
    throw new TypeError(
      `Strict request matrix contains an invalid applicability: ${plan.applicability}.`
    );
  }
  if (plan.applicability === 'not-applicable' && !plan.typedReason?.trim()) {
    throw new TypeError(
      `Strict N/A request plan requires a typed reason: ${plan.repoId}/${plan.kind}.`
    );
  }
  buildCanonicalRequestScopeHashV2(plan, projectScopeManifest);
  return {
    ...plan,
    selector: toProjectFactsJson(plan.selector),
    scope: {
      ...plan.scope,
      ...(plan.scope.sourceFolder
        ? { sourceFolder: normalizePortableRelativePath(plan.scope.sourceFolder) }
        : {}),
      ...(plan.scope.activeFile
        ? { activeFile: normalizePortableRelativePath(plan.scope.activeFile) }
        : {}),
    },
    ...(plan.language ? { language: requireOptionalToken(plan.language, 'language') } : {}),
    ...(plan.parserFamily
      ? { parserFamily: requireOptionalToken(plan.parserFamily, 'parserFamily') }
      : {}),
    ...(plan.ownerSurfaceId
      ? { ownerSurfaceId: requireOptionalToken(plan.ownerSurfaceId, 'ownerSurfaceId') }
      : {}),
  };
}

function authoritativeOwnerSurfaces(
  file: ProjectContextFoundationFileDescriptor,
  language: string,
  parserFamily: string | undefined
): string[] {
  const authoritative = normalizeProjectContextInventoryOwnersV2(file)
    .filter(
      (owner) =>
        ['package-build-declaration', 'host-declared'].includes(owner.origin) &&
        owner.disposition !== 'ambiguous'
    )
    .map((owner) => owner.ownerModuleId);
  return uniqueStrings(
    authoritative.length > 0
      ? authoritative
      : [`language:${language}:${parserFamily ?? 'no-parser'}`]
  );
}

function readOwnerSurface(plan: ProjectContextRequestAuditPlan): string {
  const selector = plan.selector;
  if (selector && !Array.isArray(selector) && typeof selector === 'object') {
    const owner = selector.ownerModuleId;
    if (typeof owner === 'string' && owner.trim()) {
      return owner.trim();
    }
  }
  return `repository:${plan.repoId}`;
}

function selectScopeBearingFields(value: unknown): unknown {
  const json = toProjectFactsJson(value);
  if (!json || Array.isArray(json) || typeof json !== 'object') {
    return {};
  }
  const pathKeys = ['filePath', 'modulePath', 'sourceFolder'] as const;
  const result: Record<string, unknown> = {};
  for (const key of pathKeys) {
    const entry = json[key];
    if (typeof entry === 'string') {
      result[key] = normalizePortableRelativePath(entry, `selector.${key}`);
    }
  }
  for (const key of ['line', 'radius', 'range', 'ownerModuleId', 'moduleName'] as const) {
    if (json[key] !== undefined) {
      result[key] = json[key];
    }
  }
  return result;
}

function assertRepositoryInScope(
  repository: ProjectContextFoundationRepositoryInput,
  manifest: ProjectScopeManifestV1
): void {
  const row = manifest.repositories.find((candidate) => candidate.repoId === repository.repoId);
  if (
    !row ||
    row.scopeId !== repository.scopeId ||
    row.relativeRoot !== normalizePortableRelativePath(repository.relativeRoot)
  ) {
    throw new TypeError(`Repository is not bound by accepted project scope: ${repository.repoId}.`);
  }
}

function toIdentityRow(
  row: ProjectContextRequestEnvelopeIndexRowV2
): ProjectContextRequestEnvelopeIndexRowV2 {
  return {
    rowId: row.rowId,
    repoId: row.repoId,
    kind: row.kind,
    selectorHash: row.selectorHash,
    canonicalScopeHash: row.canonicalScopeHash,
    language: row.language,
    parserFamily: row.parserFamily,
    ownerSurfaceId: row.ownerSurfaceId,
    applicability: row.applicability,
  };
}

function assertUniqueRows(rows: ProjectContextRequestEnvelopeIndexRowV2[]): void {
  if (new Set(rows.map((row) => row.rowId)).size !== rows.length) {
    throw new TypeError('Duplicate strict-v2 request row identity.');
  }
}

function comparePlans(
  left: ProjectContextRequestAuditPlanV2,
  right: ProjectContextRequestAuditPlanV2
) {
  return hashCanonicalJson(left).localeCompare(hashCanonicalJson(right));
}

function compareRows(
  left: ProjectContextRequestEnvelopeIndexRowV2,
  right: ProjectContextRequestEnvelopeIndexRowV2
) {
  return left.rowId.localeCompare(right.rowId);
}

function normalizeNullableToken(value: string | undefined): string | null {
  return value ? (requireOptionalToken(value, 'request identity') ?? null) : null;
}

function requireOptionalToken(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized !== value.toLowerCase()) {
    throw new TypeError(`${fieldName} must be a canonical non-empty token.`);
  }
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

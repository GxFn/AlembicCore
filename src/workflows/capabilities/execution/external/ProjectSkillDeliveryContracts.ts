export const PROJECT_SKILL_DELIVERY_CONTRACT_VERSION = 1;

export const PROJECT_SKILL_DELIVERY_ROUTES = ['alembic', 'plugin'] as const;

export const PROJECT_SKILL_ASSET_KINDS = [
  'project-skill',
  'skill-directory',
  'skill-file',
  'skill-index',
  'delivery-receipt',
] as const;

export const PROJECT_SKILL_RUNTIME_EXPORT_STRATEGIES = ['symlink-first', 'copy', 'none'] as const;

export const PROJECT_SKILL_RUNTIME_EXPORT_STATUSES = [
  'not-requested',
  'pending',
  'exported',
  'skipped',
  'blocked',
  'failed',
] as const;

export const PROJECT_SKILL_LINK_MODES = ['symlink', 'copy', 'none'] as const;

export const PROJECT_SKILL_AUTHORIZATION_STATUSES = [
  'unknown',
  'pending',
  'granted',
  'denied',
  'not-required',
] as const;

export const PROJECT_SKILL_CONFLICT_STATUSES = [
  'none',
  'compatible-existing',
  'different-existing',
  'target-missing',
  'blocked',
] as const;

export type ProjectSkillDeliveryRoute = (typeof PROJECT_SKILL_DELIVERY_ROUTES)[number];
export type ProjectSkillAssetKind = (typeof PROJECT_SKILL_ASSET_KINDS)[number];
export type ProjectSkillRuntimeExportStrategy =
  (typeof PROJECT_SKILL_RUNTIME_EXPORT_STRATEGIES)[number];
export type ProjectSkillRuntimeExportStatus =
  (typeof PROJECT_SKILL_RUNTIME_EXPORT_STATUSES)[number];
export type ProjectSkillLinkMode = (typeof PROJECT_SKILL_LINK_MODES)[number];
export type ProjectSkillAuthorizationStatus = (typeof PROJECT_SKILL_AUTHORIZATION_STATUSES)[number];
export type ProjectSkillConflictStatus = (typeof PROJECT_SKILL_CONFLICT_STATUSES)[number];
export type ProjectSkillDeliveryValidationIssue =
  | 'invalid-receipt-shape'
  | 'authorization-scope-missing'
  | 'runtime-export-scope-missing'
  | 'managed-marker-identity-missing';

export interface ProjectSkillDeliveryEvidenceRef {
  dimensionId: string | null;
  kind: string;
  label: string | null;
  ref: string;
  targetName: string | null;
}

export interface ProjectSkillDeliveryAsset {
  artifactRefs: ProjectSkillDeliveryEvidenceRef[];
  contentHash: string | null;
  description: string | null;
  dimensionId: string | null;
  kind: ProjectSkillAssetKind;
  path: string;
  skillName: string;
  targetName: string | null;
}

export interface ProjectSkillDeliveryAuthorization {
  codexSkillRoot: string | null;
  grantedBy: string | null;
  message: string | null;
  projectScopeId: string | null;
  required: boolean;
  status: ProjectSkillAuthorizationStatus;
}

export interface ProjectSkillRuntimeExportReceipt {
  authorizationStatus: ProjectSkillAuthorizationStatus;
  codexSkillRoot: string | null;
  conflictStatus: ProjectSkillConflictStatus;
  linkMode: ProjectSkillLinkMode;
  message: string | null;
  projectScopeId: string | null;
  refreshRequired: boolean;
  status: ProjectSkillRuntimeExportStatus;
  strategy: ProjectSkillRuntimeExportStrategy;
  targetPath: string | null;
  targetRoot: string | null;
}

export interface ProjectSkillManagedMarker {
  contractVersion: typeof PROJECT_SKILL_DELIVERY_CONTRACT_VERSION;
  generatedSkillId: string | null;
  generationHash: string | null;
  managedBy: 'alembic';
  markerPath: string | null;
  projectId: string | null;
  projectRoot: string;
  projectScopeId: string | null;
  route: ProjectSkillDeliveryRoute;
  skillName: string;
  sourcePath: string;
}

export interface ProjectSkillDeliveryShoutSummary {
  delivered: boolean;
  message: string;
  runtimeVisible: boolean;
  skillName: string;
  title: string;
  trigger: string | null;
}

export interface ProjectSkillDeliveryReceipt {
  asset: ProjectSkillDeliveryAsset;
  authorization: ProjectSkillDeliveryAuthorization;
  conflictStatus: ProjectSkillConflictStatus;
  contractVersion: typeof PROJECT_SKILL_DELIVERY_CONTRACT_VERSION;
  createdAt: string;
  dimensionId: string | null;
  evidenceRefs: ProjectSkillDeliveryEvidenceRef[];
  id: string;
  managedMarker: ProjectSkillManagedMarker | null;
  projectId: string | null;
  projectRoot: string;
  projectScopeId: string | null;
  route: ProjectSkillDeliveryRoute;
  runtimeExport: ProjectSkillRuntimeExportReceipt;
  shoutSummary: ProjectSkillDeliveryShoutSummary;
  skillName: string;
  targetName: string | null;
}

export interface ProjectSkillDeliveryValidationResult {
  issues: ProjectSkillDeliveryValidationIssue[];
  ok: boolean;
  receipt: ProjectSkillDeliveryReceipt | null;
}

export interface CreateProjectSkillDeliveryReceiptInput {
  asset: {
    artifactRefs?: readonly unknown[];
    contentHash?: string | null;
    description?: string | null;
    dimensionId?: string | null;
    kind?: ProjectSkillAssetKind;
    path: string;
    skillName?: string | null;
    targetName?: string | null;
  };
  authorization?: Partial<ProjectSkillDeliveryAuthorization> | null;
  conflictStatus?: ProjectSkillConflictStatus | null;
  codexSkillRoot?: string | null;
  createdAt: string;
  dimensionId?: string | null;
  evidenceRefs?: readonly unknown[];
  id: string;
  managedMarker?: Partial<ProjectSkillManagedMarker> | null;
  projectId?: string | null;
  projectRoot: string;
  projectScopeId?: string | null;
  route: ProjectSkillDeliveryRoute;
  runtimeExport?: Partial<ProjectSkillRuntimeExportReceipt> | null;
  shoutSummary?: Partial<ProjectSkillDeliveryShoutSummary> | null;
  skillName: string;
  targetName?: string | null;
}

export type CreateRouteProjectSkillDeliveryReceiptInput = Omit<
  CreateProjectSkillDeliveryReceiptInput,
  'route'
>;

export function createProjectSkillDeliveryReceipt(
  input: CreateProjectSkillDeliveryReceiptInput
): ProjectSkillDeliveryReceipt {
  const dimensionId = input.dimensionId ?? input.asset.dimensionId ?? null;
  const targetName = input.targetName ?? input.asset.targetName ?? null;
  const projectScopeId =
    input.projectScopeId ??
    input.authorization?.projectScopeId ??
    input.runtimeExport?.projectScopeId ??
    input.managedMarker?.projectScopeId ??
    null;
  const codexSkillRoot =
    input.codexSkillRoot ??
    input.authorization?.codexSkillRoot ??
    input.runtimeExport?.codexSkillRoot ??
    null;
  const conflictStatus = input.conflictStatus ?? input.runtimeExport?.conflictStatus ?? 'none';
  const authorization = createProjectSkillDeliveryAuthorization(input.authorization, {
    codexSkillRoot,
    projectScopeId,
  });
  const asset = createProjectSkillDeliveryAsset(input.asset, {
    dimensionId,
    skillName: input.skillName,
    targetName,
  });
  const runtimeExport = createProjectSkillRuntimeExportReceipt(input.runtimeExport, {
    authorizationStatus: authorization.status,
    codexSkillRoot,
    conflictStatus,
    projectScopeId,
  });
  const receipt: ProjectSkillDeliveryReceipt = {
    asset,
    authorization,
    conflictStatus,
    contractVersion: PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
    createdAt: input.createdAt,
    dimensionId,
    evidenceRefs: normalizeProjectSkillDeliveryEvidenceRefs(input.evidenceRefs),
    id: input.id,
    managedMarker: input.managedMarker
      ? createProjectSkillManagedMarker(input.managedMarker, {
          projectId: input.projectId ?? null,
          projectRoot: input.projectRoot,
          projectScopeId,
          route: input.route,
          skillName: input.skillName,
          generationHash: asset.contentHash,
          sourcePath: asset.path,
        })
      : null,
    projectId: input.projectId ?? null,
    projectRoot: input.projectRoot,
    projectScopeId,
    route: input.route,
    runtimeExport,
    shoutSummary: createProjectSkillDeliveryShoutSummary(input.shoutSummary, {
      runtimeExport,
      skillName: input.skillName,
    }),
    skillName: input.skillName,
    targetName,
  };

  return receipt;
}

export function createAlembicProjectSkillDeliveryReceipt(
  input: CreateRouteProjectSkillDeliveryReceiptInput
): ProjectSkillDeliveryReceipt {
  return createProjectSkillDeliveryReceipt({ ...input, route: 'alembic' });
}

export function createPluginProjectSkillDeliveryReceipt(
  input: CreateRouteProjectSkillDeliveryReceiptInput
): ProjectSkillDeliveryReceipt {
  return createProjectSkillDeliveryReceipt({ ...input, route: 'plugin' });
}

export function normalizeProjectSkillDeliveryReceipt(
  value: unknown
): ProjectSkillDeliveryReceipt | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const asset = asRecord(record.asset);
  const createdAt = nonEmptyString(record.createdAt);
  const id = nonEmptyString(record.id);
  const projectRoot = nonEmptyString(record.projectRoot);
  const route = normalizeProjectSkillDeliveryRoute(record.route);
  const skillName = nonEmptyString(record.skillName);
  const assetPath = nonEmptyString(asset?.path);
  const contractVersion =
    record.contractVersion === undefined
      ? PROJECT_SKILL_DELIVERY_CONTRACT_VERSION
      : numberOrNull(record.contractVersion);
  if (
    contractVersion !== PROJECT_SKILL_DELIVERY_CONTRACT_VERSION ||
    !createdAt ||
    !id ||
    !projectRoot ||
    !route ||
    !skillName ||
    !assetPath
  ) {
    return null;
  }

  return createProjectSkillDeliveryReceipt({
    asset: {
      artifactRefs: Array.isArray(asset?.artifactRefs) ? asset.artifactRefs : [],
      contentHash: nullableString(asset?.contentHash),
      description: nullableString(asset?.description),
      dimensionId: nullableString(asset?.dimensionId),
      kind: normalizeProjectSkillAssetKind(asset?.kind) ?? undefined,
      path: assetPath,
      skillName: nullableString(asset?.skillName),
      targetName: nullableString(asset?.targetName),
    },
    authorization: normalizeProjectSkillDeliveryAuthorization(record.authorization),
    conflictStatus: normalizeProjectSkillConflictStatus(record.conflictStatus),
    codexSkillRoot: firstString(
      asRecord(record.authorization)?.codexSkillRoot,
      asRecord(record.runtimeExport)?.codexSkillRoot
    ),
    createdAt,
    dimensionId: nullableString(record.dimensionId),
    evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [],
    id,
    managedMarker: normalizeProjectSkillManagedMarkerInput(record.managedMarker),
    projectId: nullableString(record.projectId),
    projectRoot,
    projectScopeId: firstString(
      record.projectScopeId,
      asRecord(record.authorization)?.projectScopeId,
      asRecord(record.runtimeExport)?.projectScopeId,
      asRecord(record.managedMarker)?.projectScopeId
    ),
    route,
    runtimeExport: normalizeProjectSkillRuntimeExportReceipt(record.runtimeExport),
    shoutSummary: normalizeProjectSkillDeliveryShoutSummary(record.shoutSummary),
    skillName,
    targetName: nullableString(record.targetName),
  });
}

export function isProjectSkillDeliveryReceipt(
  value: unknown
): value is ProjectSkillDeliveryReceipt {
  return normalizeProjectSkillDeliveryReceipt(value) !== null;
}

export function validateProjectSkillDeliveryReceipt(
  value: unknown
): ProjectSkillDeliveryValidationResult {
  const receipt = normalizeProjectSkillDeliveryReceipt(value);
  if (!receipt) {
    return {
      issues: ['invalid-receipt-shape'],
      ok: false,
      receipt: null,
    };
  }

  const issues: ProjectSkillDeliveryValidationIssue[] = [];
  if (
    receipt.authorization.required &&
    receipt.authorization.status === 'granted' &&
    (!receipt.authorization.projectScopeId || !receipt.authorization.codexSkillRoot)
  ) {
    issues.push('authorization-scope-missing');
  }
  if (
    receipt.runtimeExport.status === 'exported' &&
    (!receipt.runtimeExport.projectScopeId || !receipt.runtimeExport.codexSkillRoot)
  ) {
    issues.push('runtime-export-scope-missing');
  }
  if (
    receipt.managedMarker &&
    (!receipt.managedMarker.generatedSkillId ||
      !receipt.managedMarker.generationHash ||
      !receipt.managedMarker.projectScopeId)
  ) {
    issues.push('managed-marker-identity-missing');
  }

  return {
    issues,
    ok: issues.length === 0,
    receipt,
  };
}

export function createProjectSkillDeliveryEvidenceRef(
  value: unknown
): ProjectSkillDeliveryEvidenceRef | null {
  const directRef = nonEmptyString(value);
  if (directRef) {
    return {
      dimensionId: null,
      kind: 'artifact',
      label: null,
      ref: directRef,
      targetName: null,
    };
  }

  const record = asRecord(value);
  const ref =
    nonEmptyString(record?.ref) ?? nonEmptyString(record?.path) ?? nonEmptyString(record?.url);
  if (!ref) {
    return null;
  }

  return {
    dimensionId: nullableString(record?.dimensionId),
    kind: nonEmptyString(record?.kind) ?? 'artifact',
    label: nullableString(record?.label),
    ref,
    targetName: nullableString(record?.targetName),
  };
}

export function summarizeProjectSkillDeliveryReceipt(receipt: ProjectSkillDeliveryReceipt): string {
  return receipt.shoutSummary.message;
}

export function normalizeProjectSkillDeliveryRoute(
  value: unknown
): ProjectSkillDeliveryRoute | null {
  return isLiteral(value, PROJECT_SKILL_DELIVERY_ROUTES) ? value : null;
}

export function normalizeProjectSkillAssetKind(value: unknown): ProjectSkillAssetKind | null {
  return isLiteral(value, PROJECT_SKILL_ASSET_KINDS) ? value : null;
}

export function normalizeProjectSkillRuntimeExportStrategy(
  value: unknown
): ProjectSkillRuntimeExportStrategy | null {
  return isLiteral(value, PROJECT_SKILL_RUNTIME_EXPORT_STRATEGIES) ? value : null;
}

export function normalizeProjectSkillRuntimeExportStatus(
  value: unknown
): ProjectSkillRuntimeExportStatus | null {
  return isLiteral(value, PROJECT_SKILL_RUNTIME_EXPORT_STATUSES) ? value : null;
}

export function normalizeProjectSkillLinkMode(value: unknown): ProjectSkillLinkMode | null {
  return isLiteral(value, PROJECT_SKILL_LINK_MODES) ? value : null;
}

export function normalizeProjectSkillAuthorizationStatus(
  value: unknown
): ProjectSkillAuthorizationStatus | null {
  return isLiteral(value, PROJECT_SKILL_AUTHORIZATION_STATUSES) ? value : null;
}

export function normalizeProjectSkillConflictStatus(
  value: unknown
): ProjectSkillConflictStatus | null {
  return isLiteral(value, PROJECT_SKILL_CONFLICT_STATUSES) ? value : null;
}

function createProjectSkillDeliveryAsset(
  asset: CreateProjectSkillDeliveryReceiptInput['asset'],
  defaults: {
    dimensionId: string | null;
    skillName: string;
    targetName: string | null;
  }
): ProjectSkillDeliveryAsset {
  return {
    artifactRefs: normalizeProjectSkillDeliveryEvidenceRefs(asset.artifactRefs),
    contentHash: asset.contentHash ?? null,
    description: asset.description ?? null,
    dimensionId: asset.dimensionId ?? defaults.dimensionId,
    kind: asset.kind ?? 'project-skill',
    path: asset.path,
    skillName: asset.skillName ?? defaults.skillName,
    targetName: asset.targetName ?? defaults.targetName,
  };
}

function createProjectSkillDeliveryAuthorization(
  value: Partial<ProjectSkillDeliveryAuthorization> | null | undefined,
  defaults: {
    codexSkillRoot: string | null;
    projectScopeId: string | null;
  }
): ProjectSkillDeliveryAuthorization {
  return {
    codexSkillRoot: value?.codexSkillRoot ?? defaults.codexSkillRoot,
    grantedBy: value?.grantedBy ?? null,
    message: value?.message ?? null,
    projectScopeId: value?.projectScopeId ?? defaults.projectScopeId,
    required: value?.required ?? true,
    status: value?.status ?? 'unknown',
  };
}

function createProjectSkillRuntimeExportReceipt(
  value: Partial<ProjectSkillRuntimeExportReceipt> | null | undefined,
  defaults: {
    authorizationStatus: ProjectSkillAuthorizationStatus;
    codexSkillRoot: string | null;
    conflictStatus: ProjectSkillConflictStatus;
    projectScopeId: string | null;
  }
): ProjectSkillRuntimeExportReceipt {
  const status = value?.status ?? 'not-requested';
  return {
    authorizationStatus: value?.authorizationStatus ?? defaults.authorizationStatus,
    codexSkillRoot: value?.codexSkillRoot ?? defaults.codexSkillRoot,
    conflictStatus: value?.conflictStatus ?? defaults.conflictStatus,
    linkMode: value?.linkMode ?? 'none',
    message: value?.message ?? null,
    projectScopeId: value?.projectScopeId ?? defaults.projectScopeId,
    refreshRequired: value?.refreshRequired ?? status === 'exported',
    status,
    strategy: value?.strategy ?? 'symlink-first',
    targetPath: value?.targetPath ?? null,
    targetRoot: value?.targetRoot ?? null,
  };
}

function createProjectSkillManagedMarker(
  marker: Partial<ProjectSkillManagedMarker>,
  defaults: {
    projectId: string | null;
    projectRoot: string;
    projectScopeId: string | null;
    route: ProjectSkillDeliveryRoute;
    skillName: string;
    generationHash: string | null;
    sourcePath: string;
  }
): ProjectSkillManagedMarker {
  // marker 只描述“谁管理了导出的项目 Skill”，实际写入与覆盖判断由 Alembic/Plugin 完成。
  return {
    contractVersion: PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
    generatedSkillId: marker.generatedSkillId ?? defaults.skillName,
    generationHash: marker.generationHash ?? defaults.generationHash,
    managedBy: 'alembic',
    markerPath: marker.markerPath ?? null,
    projectId: marker.projectId ?? defaults.projectId,
    projectRoot: marker.projectRoot ?? defaults.projectRoot,
    projectScopeId: marker.projectScopeId ?? defaults.projectScopeId,
    route: marker.route ?? defaults.route,
    skillName: marker.skillName ?? defaults.skillName,
    sourcePath: marker.sourcePath ?? defaults.sourcePath,
  };
}

function createProjectSkillDeliveryShoutSummary(
  value: Partial<ProjectSkillDeliveryShoutSummary> | null | undefined,
  defaults: {
    runtimeExport: ProjectSkillRuntimeExportReceipt;
    skillName: string;
  }
): ProjectSkillDeliveryShoutSummary {
  const runtimeVisible = defaults.runtimeExport.status === 'exported';
  return {
    delivered: value?.delivered ?? runtimeVisible,
    message:
      value?.message ??
      (runtimeVisible
        ? `Project Skill ${defaults.skillName} exported to Codex runtime.`
        : `Project Skill ${defaults.skillName} is available in Alembic receipt.`),
    runtimeVisible: value?.runtimeVisible ?? runtimeVisible,
    skillName: value?.skillName ?? defaults.skillName,
    title: value?.title ?? 'Project Skill delivery',
    trigger: value?.trigger ?? null,
  };
}

function normalizeProjectSkillDeliveryAuthorization(
  value: unknown
): Partial<ProjectSkillDeliveryAuthorization> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    codexSkillRoot: nullableString(record.codexSkillRoot),
    grantedBy: nullableString(record.grantedBy),
    message: nullableString(record.message),
    projectScopeId: nullableString(record.projectScopeId),
    required: booleanOrUndefined(record.required),
    status: normalizeProjectSkillAuthorizationStatus(record.status) ?? undefined,
  };
}

function normalizeProjectSkillRuntimeExportReceipt(
  value: unknown
): Partial<ProjectSkillRuntimeExportReceipt> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    authorizationStatus:
      normalizeProjectSkillAuthorizationStatus(record.authorizationStatus) ?? undefined,
    codexSkillRoot: nullableString(record.codexSkillRoot),
    conflictStatus: normalizeProjectSkillConflictStatus(record.conflictStatus) ?? undefined,
    linkMode: normalizeProjectSkillLinkMode(record.linkMode) ?? undefined,
    message: nullableString(record.message),
    projectScopeId: nullableString(record.projectScopeId),
    refreshRequired: booleanOrUndefined(record.refreshRequired),
    status: normalizeProjectSkillRuntimeExportStatus(record.status) ?? undefined,
    strategy: normalizeProjectSkillRuntimeExportStrategy(record.strategy) ?? undefined,
    targetPath: nullableString(record.targetPath),
    targetRoot: nullableString(record.targetRoot),
  };
}

function normalizeProjectSkillManagedMarkerInput(
  value: unknown
): Partial<ProjectSkillManagedMarker> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const route = normalizeProjectSkillDeliveryRoute(record.route);
  return {
    generatedSkillId: nullableString(record.generatedSkillId),
    generationHash: nullableString(record.generationHash),
    markerPath: nullableString(record.markerPath),
    projectId: nullableString(record.projectId),
    projectRoot: nullableString(record.projectRoot) ?? undefined,
    projectScopeId: nullableString(record.projectScopeId),
    route: route ?? undefined,
    skillName: nullableString(record.skillName) ?? undefined,
    sourcePath: nullableString(record.sourcePath) ?? undefined,
  };
}

function normalizeProjectSkillDeliveryShoutSummary(
  value: unknown
): Partial<ProjectSkillDeliveryShoutSummary> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    delivered: booleanOrUndefined(record.delivered),
    message: nullableString(record.message) ?? undefined,
    runtimeVisible: booleanOrUndefined(record.runtimeVisible),
    skillName: nullableString(record.skillName) ?? undefined,
    title: nullableString(record.title) ?? undefined,
    trigger: nullableString(record.trigger),
  };
}

function normalizeProjectSkillDeliveryEvidenceRefs(
  value: readonly unknown[] | undefined
): ProjectSkillDeliveryEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => createProjectSkillDeliveryEvidenceRef(item))
    .filter((item): item is ProjectSkillDeliveryEvidenceRef => item !== null);
}

function isLiteral<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = nullableString(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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
  grantedBy: string | null;
  message: string | null;
  required: boolean;
  status: ProjectSkillAuthorizationStatus;
}

export interface ProjectSkillRuntimeExportReceipt {
  authorizationStatus: ProjectSkillAuthorizationStatus;
  conflictStatus: ProjectSkillConflictStatus;
  linkMode: ProjectSkillLinkMode;
  message: string | null;
  status: ProjectSkillRuntimeExportStatus;
  strategy: ProjectSkillRuntimeExportStrategy;
  targetPath: string | null;
  targetRoot: string | null;
}

export interface ProjectSkillManagedMarker {
  contractVersion: typeof PROJECT_SKILL_DELIVERY_CONTRACT_VERSION;
  managedBy: 'alembic';
  markerPath: string | null;
  projectId: string | null;
  projectRoot: string;
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
  route: ProjectSkillDeliveryRoute;
  runtimeExport: ProjectSkillRuntimeExportReceipt;
  shoutSummary: ProjectSkillDeliveryShoutSummary;
  skillName: string;
  targetName: string | null;
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
  createdAt: string;
  dimensionId?: string | null;
  evidenceRefs?: readonly unknown[];
  id: string;
  managedMarker?: Partial<ProjectSkillManagedMarker> | null;
  projectId?: string | null;
  projectRoot: string;
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
  const conflictStatus = input.conflictStatus ?? input.runtimeExport?.conflictStatus ?? 'none';
  const authorization = createProjectSkillDeliveryAuthorization(input.authorization);
  const asset = createProjectSkillDeliveryAsset(input.asset, {
    dimensionId,
    skillName: input.skillName,
    targetName,
  });
  const runtimeExport = createProjectSkillRuntimeExportReceipt(input.runtimeExport, {
    authorizationStatus: authorization.status,
    conflictStatus,
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
          route: input.route,
          skillName: input.skillName,
          sourcePath: asset.path,
        })
      : null,
    projectId: input.projectId ?? null,
    projectRoot: input.projectRoot,
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
    createdAt,
    dimensionId: nullableString(record.dimensionId),
    evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [],
    id,
    managedMarker: normalizeProjectSkillManagedMarkerInput(record.managedMarker),
    projectId: nullableString(record.projectId),
    projectRoot,
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
  value?: Partial<ProjectSkillDeliveryAuthorization> | null
): ProjectSkillDeliveryAuthorization {
  return {
    grantedBy: value?.grantedBy ?? null,
    message: value?.message ?? null,
    required: value?.required ?? true,
    status: value?.status ?? 'unknown',
  };
}

function createProjectSkillRuntimeExportReceipt(
  value: Partial<ProjectSkillRuntimeExportReceipt> | null | undefined,
  defaults: {
    authorizationStatus: ProjectSkillAuthorizationStatus;
    conflictStatus: ProjectSkillConflictStatus;
  }
): ProjectSkillRuntimeExportReceipt {
  return {
    authorizationStatus: value?.authorizationStatus ?? defaults.authorizationStatus,
    conflictStatus: value?.conflictStatus ?? defaults.conflictStatus,
    linkMode: value?.linkMode ?? 'none',
    message: value?.message ?? null,
    status: value?.status ?? 'not-requested',
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
    route: ProjectSkillDeliveryRoute;
    skillName: string;
    sourcePath: string;
  }
): ProjectSkillManagedMarker {
  // marker 只描述“谁管理了导出的项目 Skill”，实际写入由 Alembic/Plugin 完成。
  return {
    contractVersion: PROJECT_SKILL_DELIVERY_CONTRACT_VERSION,
    managedBy: 'alembic',
    markerPath: marker.markerPath ?? null,
    projectId: marker.projectId ?? defaults.projectId,
    projectRoot: marker.projectRoot ?? defaults.projectRoot,
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
    grantedBy: nullableString(record.grantedBy),
    message: nullableString(record.message),
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
    conflictStatus: normalizeProjectSkillConflictStatus(record.conflictStatus) ?? undefined,
    linkMode: normalizeProjectSkillLinkMode(record.linkMode) ?? undefined,
    message: nullableString(record.message),
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
    markerPath: nullableString(record.markerPath),
    projectId: nullableString(record.projectId),
    projectRoot: nullableString(record.projectRoot) ?? undefined,
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

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

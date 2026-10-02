import type {
  ProjectContextPresenterInput,
  ProjectContextRef,
} from '../../../../domain/project-context/index.js';
import type {
  AnalysisScale,
  AnatomyLensId,
} from '../../../../service/plan/intent/coldStartProductionPlan.js';
import type {
  FactRecordV1,
  StrictHostAgentAnalysisUnitProjectionV1,
} from '../../../../service/production/StrictAnalysisContracts.js';
import { createStrictHostAgentAnalysisUnitProjectionFromFactsV1 } from '../../../../service/production/StrictAnalysisContracts.js';
import type { DimensionDef } from '../../../../types/ProjectSnapshot.js';
import { normalizeProjectContextPresenterInput } from './analysis-packet/ProjectContextNormalize.js';
import { expectedEvidenceForDimension, scoreProjectContextRef } from './analysis-packet/Scoring.js';
import {
  normalizeComparablePath,
  sortUnique,
  stableHash,
} from './analysis-packet/StableIdentity.js';
import type {
  HostAgentAnalysisDegradedReason,
  HostAgentAnalysisPacket,
  HostAgentAnalysisUnit,
  HostAgentCompletionContract,
  HostAgentProjectContextPacketInput,
  HostAgentSourceRef,
  HostAgentSourceRefRole,
  HostAgentStructuralEvidenceRef,
  HostAgentStructuralHints,
} from './analysis-packet/Types.js';
import {
  createHostAgentAnalysisProgressSeed,
  createHostAgentAnalysisUnitKey,
  STABLE_HOST_AGENT_ANALYSIS_UNIT_KEY_FORMAT,
} from './analysis-packet/UnitProgress.js';

export type {
  HostAgentAnalysisDegradedReason,
  HostAgentAnalysisPacket,
  HostAgentAnalysisPacketBuilderOptions,
  HostAgentAnalysisPacketProfile,
  HostAgentAnalysisProgressSeed,
  HostAgentAnalysisUnit,
  HostAgentAnalysisUnitCheckpointLink,
  HostAgentAnalysisUnitProgress,
  HostAgentAnalysisUnitStatus,
  HostAgentCompletionContract,
  HostAgentDependencyHint,
  HostAgentProjectContextPacketInput,
  HostAgentSourceRef,
  HostAgentSourceRefRole,
  HostAgentStableUnitKey,
  HostAgentStableUnitKeyInput,
  HostAgentStructuralEvidenceKind,
  HostAgentStructuralEvidenceRef,
  HostAgentStructuralHints,
  IDEAgentAnalysisDegradedReason,
  IDEAgentAnalysisPacket,
  IDEAgentAnalysisPacketBuilderOptions,
  IDEAgentAnalysisPacketProfile,
  IDEAgentAnalysisProgressSeed,
  IDEAgentAnalysisUnit,
  IDEAgentAnalysisUnitCheckpointLink,
  IDEAgentAnalysisUnitProgress,
  IDEAgentAnalysisUnitStatus,
  IDEAgentCompletionContract,
  IDEAgentDependencyHint,
  IDEAgentProjectContextPacketInput,
  IDEAgentSourceRef,
  IDEAgentSourceRefRole,
  IDEAgentStableUnitKey,
  IDEAgentStableUnitKeyInput,
  IDEAgentStructuralEvidenceKind,
  IDEAgentStructuralEvidenceRef,
  IDEAgentStructuralHints,
} from './analysis-packet/Types.js';
export {
  createHostAgentAnalysisProgressSeed,
  createHostAgentAnalysisProgressSeed as createIDEAgentAnalysisProgressSeed,
  createHostAgentAnalysisUnitKey,
  createHostAgentAnalysisUnitKey as createIDEAgentAnalysisUnitKey,
  createHostAgentAnalysisUnitProgress,
  createHostAgentAnalysisUnitProgress as createIDEAgentAnalysisUnitProgress,
} from './analysis-packet/UnitProgress.js';

interface SourceRefCandidate {
  sourceRef: HostAgentSourceRef;
  evidence: HostAgentStructuralEvidenceRef;
  score: number;
}

/**
 * Bind the strict, dimension-free fact plane to the existing HostAgent unit type.
 * The projection is derived from canonical FactRecords rather than caller-supplied IDs.
 */
export function bindStrictProductionProjectionToHostAgentAnalysisUnitV1(
  unit: HostAgentAnalysisUnit,
  input: {
    readonly canonicalSubjectRef: string;
    readonly parentSubjectRefs: readonly string[];
    readonly primaryScale: AnalysisScale;
    readonly anatomyLensIds: readonly AnatomyLensId[];
    readonly facts: readonly FactRecordV1[];
  }
): HostAgentAnalysisUnit & { strictProjection: StrictHostAgentAnalysisUnitProjectionV1 } {
  const strictProjection = createStrictHostAgentAnalysisUnitProjectionFromFactsV1(input);
  if (
    unit.strictProjection &&
    JSON.stringify(unit.strictProjection) !== JSON.stringify(strictProjection)
  ) {
    throw new Error('STRICT_ANALYSIS_UNIT_PROJECTION_CONFLICT');
  }
  return Object.freeze({ ...unit, strictProjection });
}

const DEFAULT_MAX_UNITS = 12;
const STABLE_KEY_FORMAT = STABLE_HOST_AGENT_ANALYSIS_UNIT_KEY_FORMAT;

export function buildHostAgentAnalysisPacketFromProjectContext({
  projectContext,
  dimensions = [],
  options = {},
}: HostAgentProjectContextPacketInput): HostAgentAnalysisPacket {
  const presenterInput = normalizeProjectContextPresenterInput(projectContext);
  const projectRoot = options.projectRoot ?? presenterInput.project.projectRoot;
  const profile = options.profile ?? 'cold-start';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const maxUnits = Math.max(1, options.maxUnits ?? DEFAULT_MAX_UNITS);
  const globalDegraded = inferProjectContextDegraded(presenterInput);
  const globalWarnings = inferProjectContextWarnings(presenterInput, globalDegraded);
  const candidates = collectProjectContextCandidates(presenterInput);
  const packetDimensions = dimensions.length
    ? [...dimensions]
    : [{ id: 'project-overview', label: 'Project Overview' }];
  const totalUnits = packetDimensions.length;
  const selectedDimensions = packetDimensions.slice(0, maxUnits);
  const units = selectedDimensions.map((dimension, index) =>
    buildProjectContextAnalysisUnit({
      presenterInput,
      dimension,
      index,
      candidates,
      globalDegraded,
      globalWarnings,
    })
  );
  const sourceRefs = dedupeSourceRefs(units.flatMap((unit) => unit.sourceRefs));
  const requiredReadSet = sortUnique(units.flatMap((unit) => unit.requiredReadSet));
  const structuralEvidenceRefs = dedupeEvidenceRefs(
    units.flatMap((unit) => unit.structuralEvidenceRefs)
  );
  const packetIdentity = {
    profile,
    projectRoot,
    dimensions: units.map((unit) => unit.dimensionId),
    requiredReadSet,
    structuralEvidenceRefs: structuralEvidenceRefs.map((ref) => ref.ref),
    source: 'project-context',
  };
  const packetId = `ide_packet_${stableHash(packetIdentity)}`;
  const progressSeed = createHostAgentAnalysisProgressSeed({ packetId, units });

  return {
    packetId,
    projectRootHash: stableHash(projectRoot),
    generatedAt,
    profile,
    projectSummary: {
      primaryLanguage: inferProjectContextPrimaryLanguage(presenterInput),
      fileCount: presenterInput.files.length,
      targetCount: presenterInput.repo?.targets.length ?? 0,
      materialization: buildProjectContextMaterializationSummary(presenterInput),
      degraded: globalDegraded,
      warnings: globalWarnings,
    },
    units,
    sourceRefs,
    requiredReadSet,
    structuralEvidenceRefs,
    retrievalHints: {
      structureTools: ['ProjectContext.execute', 'alembic_project_matrix'],
      callContextAvailable: false,
      graphAvailable: Boolean(
        presenterInput.map ||
          presenterInput.fileFlows.length ||
          presenterInput.moduleLayers.length ||
          presenterInput.modules.length
      ),
      stableKeyFormat: STABLE_KEY_FORMAT,
      aliasPolicy: 'shortAlias is display/search only and must not be used as the primary key',
    },
    budget: {
      includedUnits: units.length,
      totalUnits,
      ...(totalUnits > units.length
        ? { omittedReason: `maxUnits=${maxUnits} limited packet projection` }
        : {}),
    },
    progressSeed,
    meta: {
      compressionIndependent: true,
      builder: 'HostAgentAnalysisPacketBuilder',
      source: 'project-context',
    },
  };
}
export const buildIDEAgentAnalysisPacketFromProjectContext =
  buildHostAgentAnalysisPacketFromProjectContext;

function buildProjectContextAnalysisUnit({
  presenterInput,
  dimension,
  index,
  candidates,
  globalDegraded,
  globalWarnings,
}: {
  presenterInput: ProjectContextPresenterInput;
  dimension: DimensionDef;
  index: number;
  candidates: readonly SourceRefCandidate[];
  globalDegraded: readonly HostAgentAnalysisDegradedReason[];
  globalWarnings: readonly string[];
}): HostAgentAnalysisUnit {
  const selected = selectProjectContextCandidatesForDimension(dimension.id, candidates).slice(0, 8);
  const fallbackSelected = selected.length ? selected : candidates.slice(0, 8);
  const sourceRefs = dedupeSourceRefs(fallbackSelected.map((candidate) => candidate.sourceRef));
  const requiredReadSet = sortUnique(sourceRefs.map(readableSourcePath));
  const structuralEvidenceRefs = dedupeEvidenceRefs(
    fallbackSelected.map((candidate) => candidate.evidence)
  );
  const representative = sourceRefs[0] ?? createProjectContextFallbackSourceRef(presenterInput);
  const key = createHostAgentAnalysisUnitKey({
    sourceRef: sourceRefKey(representative),
    projectScopeId: representative.projectScopeId,
    folderId: representative.folderId,
    qualifiedPath: representative.qualifiedPath,
    fqn: representative.fqn,
    entityType: representative.entityType ?? 'project-context',
    line: representative.line,
    symbol: representative.symbol,
  });
  const degraded = dedupeDegraded([
    ...globalDegraded,
    ...(requiredReadSet.length === 0 ? ['empty-read-set' as const] : []),
  ]);
  const warnings = [
    ...globalWarnings,
    ...(requiredReadSet.length === 0
      ? [`${dimension.id}: no ProjectContext source refs could be projected`]
      : []),
  ];
  const priority = Math.max(1, 100 - index * 5 - degraded.length * 3);
  const structuralHints = buildProjectContextStructuralHints(
    presenterInput,
    dimension.id,
    fallbackSelected
  );
  const completionContract: HostAgentCompletionContract = {
    minDistinctFiles: Math.min(2, Math.max(1, requiredReadSet.length)),
    mustReferenceAssignedSources: true,
    expectedEvidence: expectedEvidenceForDimension(dimension.id, structuralEvidenceRefs),
    allowNoRecipeWithReason: true,
  };

  return {
    unitId: `ide_unit_${stableHash({
      dimensionId: dimension.id,
      key: key.key,
      requiredReadSet,
      evidenceRefs: structuralEvidenceRefs.map((ref) => ref.ref),
      source: 'project-context',
    })}`,
    key,
    dimensionId: dimension.id,
    priority,
    reason: buildUnitReason(dimension, fallbackSelected, degraded),
    sourceRefs,
    requiredReadSet,
    structuralEvidenceRefs,
    structuralHints,
    completionContract,
    degraded,
    warnings,
  };
}

function collectProjectContextCandidates(
  presenterInput: ProjectContextPresenterInput
): SourceRefCandidate[] {
  const fileCandidates = presenterInput.files.flatMap((file) => {
    const ref = sourceRefFromProjectContextFile(file);
    return ref ? [makeProjectContextCandidate(ref, file.ref, `file:${file.filePath}`, 70)] : [];
  });
  const refCandidates = presenterInput.refs.flatMap((ref) => {
    const sourceRef = sourceRefFromProjectContextRef(ref);
    return sourceRef
      ? [makeProjectContextCandidate(sourceRef, ref, `ref:${ref.id}`, scoreProjectContextRef(ref))]
      : [];
  });

  return [...fileCandidates, ...refCandidates].sort(
    (a, b) =>
      b.score - a.score ||
      readableSourcePath(a.sourceRef).localeCompare(readableSourcePath(b.sourceRef)) ||
      (a.sourceRef.symbol ?? '').localeCompare(b.sourceRef.symbol ?? '')
  );
}

function sourceRefFromProjectContextFile(file: {
  filePath: string;
  repoId?: string;
  language?: string;
  ref?: ProjectContextRef;
}): HostAgentSourceRef | null {
  return makeProjectContextSourceRef({
    path: file.filePath,
    repoId: file.repoId,
    ref: file.ref,
    symbol: file.ref?.label,
    entityType: 'file',
    role: 'entry',
    displayName: file.filePath,
  });
}

function sourceRefFromProjectContextRef(ref: ProjectContextRef): HostAgentSourceRef | null {
  const pathValue =
    ref.scope.filePath ??
    metadataString(ref, 'filePath') ??
    metadataString(ref, 'path') ??
    ref.scope.sourceFolder;
  return makeProjectContextSourceRef({
    path: pathValue,
    repoId: ref.scope.repoId,
    ref,
    line: ref.scope.range?.startLine,
    symbol: ref.label ?? metadataString(ref, 'symbol') ?? metadataString(ref, 'name'),
    fqn:
      pathValue && ref.label
        ? `${pathValue}::${ref.label}`
        : (metadataString(ref, 'qualifiedName') ?? undefined),
    entityType: ref.kind,
    role: projectContextRefRole(ref.kind),
    displayName: ref.label ?? ref.id,
  });
}

function makeProjectContextSourceRef({
  path,
  repoId,
  ref,
  line,
  symbol,
  fqn,
  entityType,
  role,
  displayName,
}: {
  path?: string;
  repoId?: string;
  ref?: ProjectContextRef;
  line?: number;
  symbol?: string;
  fqn?: string;
  entityType: string;
  role: HostAgentSourceRefRole;
  displayName?: string;
}): HostAgentSourceRef | null {
  if (!path?.trim()) {
    return null;
  }
  const normalizedPath = normalizeComparablePath(path);
  const qualifiedPath = repoId ? `${repoId}/${normalizedPath}` : undefined;
  const alias = createShortAlias({ fqn, symbol, sourceRef: normalizedPath });
  return {
    path: normalizedPath,
    ...(repoId ? { folderId: repoId, qualifiedPath } : {}),
    ...(ref?.scope.sourceFolder ? { folderRelativeRoot: ref.scope.sourceFolder } : {}),
    ...(typeof line === 'number' ? { line } : {}),
    ...(symbol ? { symbol } : {}),
    ...(fqn ? { fqn: normalizeComparablePath(fqn) } : {}),
    entityType,
    role,
    ...(displayName ? { displayName } : {}),
    ...(alias ? { alias } : {}),
  };
}

function makeProjectContextCandidate(
  sourceRef: HostAgentSourceRef,
  ref: ProjectContextRef | undefined,
  identity: string,
  score: number
): SourceRefCandidate {
  return {
    sourceRef,
    evidence: {
      kind: 'project-context',
      ref: `project-context:${ref?.id ?? stableHash(identity)}`,
      summary: `${ref?.kind ?? 'file'}:${describeSourceRef(sourceRef)}`,
      sourceRefs: [sourceRef],
    },
    score,
  };
}

function projectContextRefRole(kind: ProjectContextRef['kind']): HostAgentSourceRefRole {
  switch (kind) {
    case 'file-flow':
    case 'relation-site':
      return 'dependency';
    case 'symbol':
    case 'file-symbol':
      return 'symbol';
    case 'module':
    case 'module-layer':
      return 'module';
    case 'source-slice':
    case 'anchor-range':
      return 'project-context';
    default:
      return 'entry';
  }
}

function selectProjectContextCandidatesForDimension(
  dimensionId: string,
  candidates: readonly SourceRefCandidate[]
): SourceRefCandidate[] {
  const id = dimensionId.toLowerCase();
  const preferredKinds =
    id.includes('flow') || id.includes('event') || id.includes('data')
      ? new Set<ProjectContextRef['kind']>(['file-flow', 'relation-site', 'source-slice'])
      : id.includes('architecture') || id.includes('module')
        ? new Set<ProjectContextRef['kind']>(['map', 'module', 'module-layer', 'file'])
        : id.includes('symbol') || id.includes('api') || id.includes('surface')
          ? new Set<ProjectContextRef['kind']>(['file-symbol', 'symbol', 'source-slice'])
          : new Set<ProjectContextRef['kind']>();
  if (preferredKinds.size === 0) {
    return candidates.slice(0, 12);
  }
  const preferred = candidates.filter((candidate) => {
    const refKind = candidate.sourceRef.entityType as ProjectContextRef['kind'] | undefined;
    return refKind ? preferredKinds.has(refKind) : false;
  });
  return (preferred.length ? preferred : candidates).slice(0, 12);
}

function buildProjectContextStructuralHints(
  presenterInput: ProjectContextPresenterInput,
  dimensionId: string,
  candidates: readonly SourceRefCandidate[]
): HostAgentStructuralHints {
  const dependencyHints = [
    ...(presenterInput.map?.majorFlows ?? []).slice(0, 8).map((flow) => ({
      from: flow.refs[0]?.label ?? flow.refs[0]?.id ?? 'project-context',
      to: flow.refs[1]?.label ?? flow.refs[1]?.id ?? 'project-context',
      relation: flow.summary,
    })),
    ...presenterInput.fileFlows.slice(0, 4).flatMap((flow) =>
      [...flow.imports, ...flow.callees, ...flow.outflow].slice(0, 4).map((relation) => ({
        from:
          relation.from?.label ??
          relation.fromRef?.label ??
          relation.filePath ??
          flow.file.filePath,
        to: relation.to?.label ?? relation.toRef?.label ?? relation.label ?? flow.file.filePath,
        relation: relation.kind,
      }))
    ),
  ];
  const projectContextHints = sortUnique([
    ...(presenterInput.repo?.languages.map(
      (language) =>
        `${language.language}${language.fileCount ? ` files=${language.fileCount}` : ''}`
    ) ?? []),
    ...(presenterInput.repo?.entrypoints.map(
      (entrypoint) => `${entrypoint.kind}:${entrypoint.name}`
    ) ?? []),
    ...(presenterInput.map?.modules.map((module) => `module:${module.name}`) ?? []),
    ...(presenterInput.map?.layers.map((layer) => `layer:${layer.name}`) ?? []),
    ...presenterInput.unavailable.map((item) => `${item.queryLevel} unavailable: ${item.reason}`),
  ]).slice(0, 12);
  const aliases = sortUnique(
    candidates.flatMap((candidate) => candidate.sourceRef.alias ?? candidate.sourceRef.symbol ?? [])
  ).slice(0, 8);
  const dataFlowHints = dimensionId.toLowerCase().includes('flow')
    ? presenterInput.fileFlows
        .slice(0, 8)
        .map(
          (flow) =>
            `${flow.file.filePath}: imports=${flow.imports.length} callers=${flow.callers.length} callees=${flow.callees.length}`
        )
    : [];

  return {
    ...(dependencyHints.length ? { dependencies: dependencyHints.slice(0, 8) } : {}),
    ...(dataFlowHints.length ? { dataFlowHints } : {}),
    ...(projectContextHints.length ? { projectContext: projectContextHints } : {}),
    ...(aliases.length ? { aliases } : {}),
  };
}

function createProjectContextFallbackSourceRef(
  presenterInput: ProjectContextPresenterInput
): HostAgentSourceRef {
  const firstFile = presenterInput.files[0];
  return {
    path: firstFile?.filePath ?? (presenterInput.project.projectRoot || 'project'),
    entityType: 'project-context',
    role: 'project-context',
    displayName: presenterInput.project.displayName ?? 'ProjectContext',
    alias: presenterInput.project.displayName ?? 'ProjectContext',
  };
}

function inferProjectContextPrimaryLanguage(input: ProjectContextPresenterInput): string {
  const repoLanguage = input.repo?.languages[0]?.language;
  if (repoLanguage) {
    return repoLanguage;
  }
  const counts = new Map<string, number>();
  for (const file of input.files) {
    if (file.language) {
      counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
    }
  }
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    'unknown'
  );
}

function buildProjectContextMaterializationSummary(
  input: ProjectContextPresenterInput
): Record<string, boolean | number | string> {
  return {
    projectContext: true,
    space: Boolean(input.space),
    repo: Boolean(input.repo),
    map: Boolean(input.map),
    modules: input.modules.length,
    moduleLayers: input.moduleLayers.length,
    fileFlows: input.fileFlows.length,
    fileSymbols: input.fileSymbols.length,
    sourceSlices: input.sourceSlices.length,
    anchorRanges: input.anchorRanges.length,
    unavailable: input.unavailable.length,
  };
}

function inferProjectContextDegraded(
  input: ProjectContextPresenterInput
): HostAgentAnalysisDegradedReason[] {
  return input.unavailable.length || input.warnings.some((warning) => warning.severity === 'error')
    ? ['project-context-unavailable']
    : [];
}

function inferProjectContextWarnings(
  input: ProjectContextPresenterInput,
  degraded: readonly HostAgentAnalysisDegradedReason[]
): string[] {
  return sortUnique([
    ...input.warnings.map((warning) => `${warning.queryLevel}:${warning.code}: ${warning.message}`),
    ...input.unavailable.map((item) => `${item.queryLevel} unavailable: ${item.reason}`),
    ...degraded.map((reason) => `IDE analysis packet degraded: ${reason}`),
  ]);
}

function metadataString(ref: ProjectContextRef, key: string): string | undefined {
  const value = ref.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function buildUnitReason(
  dimension: DimensionDef,
  candidates: readonly SourceRefCandidate[],
  degraded: readonly HostAgentAnalysisDegradedReason[]
): string {
  const label = dimension.label ?? dimension.id;
  const evidenceKinds = sortUnique(candidates.map((candidate) => candidate.evidence.kind));
  const evidenceText = evidenceKinds.length ? evidenceKinds.join(', ') : 'file fallback';
  const degradedText = degraded.length ? `; degraded=${degraded.join(',')}` : '';
  return `${label}: read assigned ${evidenceText} evidence before producing or rejecting Recipe${degradedText}`;
}

function readableSourcePath(sourceRef: HostAgentSourceRef): string {
  return sourceRef.qualifiedPath ?? sourceRef.path;
}

function sourceRefKey(sourceRef: HostAgentSourceRef): string {
  const pathValue = readableSourcePath(sourceRef);
  return `${pathValue}${typeof sourceRef.line === 'number' ? `:${sourceRef.line}` : ''}`;
}

function describeSourceRef(sourceRef: HostAgentSourceRef): string {
  const line = typeof sourceRef.line === 'number' ? `:${sourceRef.line}` : '';
  const symbol = sourceRef.symbol ? ` ${sourceRef.symbol}` : '';
  return `${readableSourcePath(sourceRef)}${line}${symbol}`.trim();
}

function createShortAlias({
  fqn,
  symbol,
  sourceRef,
}: {
  fqn?: string;
  symbol?: string;
  sourceRef: string;
}): string | undefined {
  if (symbol) {
    return symbol.split('.').filter(Boolean).pop();
  }
  if (fqn) {
    return fqn.split('::').pop()?.split('.').filter(Boolean).pop();
  }
  return sourceRef.split('/').filter(Boolean).pop();
}

function dedupeSourceRefs(sourceRefs: readonly HostAgentSourceRef[]): HostAgentSourceRef[] {
  const map = new Map<string, HostAgentSourceRef>();
  for (const ref of sourceRefs) {
    const key = stableHash({
      path: ref.path,
      qualifiedPath: ref.qualifiedPath,
      projectScopeId: ref.projectScopeId,
      folderId: ref.folderId,
      line: ref.line,
      symbol: ref.symbol,
      fqn: ref.fqn,
      entityType: ref.entityType,
      role: ref.role,
    });
    if (!map.has(key)) {
      map.set(key, ref);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      readableSourcePath(a).localeCompare(readableSourcePath(b)) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.symbol ?? '').localeCompare(b.symbol ?? '')
  );
}

function dedupeEvidenceRefs(
  refs: readonly HostAgentStructuralEvidenceRef[]
): HostAgentStructuralEvidenceRef[] {
  const map = new Map<string, HostAgentStructuralEvidenceRef>();
  for (const ref of refs) {
    if (!map.has(ref.ref)) {
      map.set(ref.ref, ref);
    }
  }
  return [...map.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

function dedupeDegraded(
  reasons: readonly HostAgentAnalysisDegradedReason[]
): HostAgentAnalysisDegradedReason[] {
  return [...new Set(reasons)].sort();
}

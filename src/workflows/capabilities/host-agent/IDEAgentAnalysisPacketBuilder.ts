import { isAbsolute, relative } from 'node:path';
import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextRef,
  type ProjectContextResult,
} from '../../../domain/project-context/index.js';
import { computeContentHash } from '../../../shared/contentHash.js';
import type { CanonicalSourceIdentity } from '../../../shared/ProjectScope.js';
import type {
  AstClassInfo,
  AstMethodInfo,
  AstProtocolInfo,
  AstSummary,
  DependencyEdge,
  DependencyGraph,
  DimensionDef,
  GuardAudit,
  GuardViolation,
  LocalPackageModule,
  PanoramaResult,
  ProjectSnapshot,
  ProjectSnapshotInput,
  SnapshotFile,
} from '../../../types/ProjectSnapshot.js';
import { buildProjectSnapshot } from '../../../types/projectSnapshotBuilder.js';

type ProjectAnalysisResult = Omit<ProjectSnapshotInput, 'projectRoot'>;

export type IDEAgentAnalysisPacketProfile = 'cold-start' | 'rescan';

export type IDEAgentSourceRefRole =
  | 'entry'
  | 'caller'
  | 'callee'
  | 'dependency'
  | 'guard'
  | 'example'
  | 'module'
  | 'project-context'
  | 'symbol';

export type IDEAgentStructuralEvidenceKind =
  | 'ast'
  | 'callgraph'
  | 'dependency'
  | 'guard'
  | 'panorama'
  | 'target'
  | 'module'
  | 'file'
  | 'project-context';

export type IDEAgentAnalysisDegradedReason =
  | 'ast-unavailable'
  | 'ast-partial'
  | 'callgraph-unavailable'
  | 'callgraph-partial'
  | 'depgraph-unavailable'
  | 'guard-unavailable'
  | 'panorama-unavailable'
  | 'project-context-unavailable'
  | 'source-path-compressed'
  | 'empty-read-set';

export type IDEAgentAnalysisUnitStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'skipped';

export interface IDEAgentSourceRef {
  path: string;
  folderDisplayName?: string;
  folderId?: string;
  folderRelativeRoot?: string;
  line?: number;
  projectScopeId?: string;
  qualifiedPath?: string;
  relativePath?: string;
  symbol?: string;
  fqn?: string;
  entityType?: string;
  role?: IDEAgentSourceRefRole;
  displayName?: string;
  alias?: string;
}

export interface IDEAgentStableUnitKeyInput {
  sourceRef: string;
  folderId?: string;
  projectScopeId?: string;
  qualifiedPath?: string;
  fqn?: string;
  entityType: string;
  line?: number;
  symbol?: string;
}

export interface IDEAgentStableUnitKey extends IDEAgentStableUnitKeyInput {
  key: string;
  shortAlias?: string;
}

export interface IDEAgentStructuralEvidenceRef {
  kind: IDEAgentStructuralEvidenceKind;
  ref: string;
  summary: string;
  sourceRefs?: IDEAgentSourceRef[];
}

export interface IDEAgentDependencyHint {
  from: string;
  to: string;
  relation: string;
}

export interface IDEAgentStructuralHints {
  ast?: string[];
  dependencies?: IDEAgentDependencyHint[];
  callers?: string[];
  callees?: string[];
  dataFlowHints?: string[];
  guardFindings?: string[];
  panorama?: string[];
  projectContext?: string[];
  aliases?: string[];
}

export interface IDEAgentCompletionContract {
  minDistinctFiles: number;
  mustReferenceAssignedSources: boolean;
  expectedEvidence: string[];
  allowNoRecipeWithReason?: boolean;
}

export interface IDEAgentAnalysisUnit {
  unitId: string;
  key: IDEAgentStableUnitKey;
  dimensionId: string;
  targetName?: string;
  moduleName?: string;
  priority: number;
  reason: string;
  sourceRefs: IDEAgentSourceRef[];
  requiredReadSet: string[];
  structuralEvidenceRefs: IDEAgentStructuralEvidenceRef[];
  structuralHints: IDEAgentStructuralHints;
  completionContract: IDEAgentCompletionContract;
  degraded: IDEAgentAnalysisDegradedReason[];
  warnings: string[];
}

export interface IDEAgentAnalysisUnitCheckpointLink {
  sessionId?: string;
  dimensionId: string;
  checkpointKind: 'dimension-checkpoint' | 'job-result' | 'bootstrap-session';
  updatedAt?: string;
}

export interface IDEAgentAnalysisUnitProgress {
  unitId: string;
  status: IDEAgentAnalysisUnitStatus;
  claimedAt?: string;
  completedAt?: string;
  submittedRecipeIds: string[];
  referencedFiles: string[];
  rejectedReasons: string[];
  deviationReason?: string;
  checkpoint?: IDEAgentAnalysisUnitCheckpointLink;
}

export interface IDEAgentAnalysisProgressSeed {
  packetId: string;
  checkpointKind: 'ide-agent-analysis-unit-progress';
  totalUnits: number;
  remainingUnitIds: string[];
  unitProgress: IDEAgentAnalysisUnitProgress[];
}

export interface IDEAgentAnalysisPacket {
  packetId: string;
  projectRootHash: string;
  generatedAt: string;
  profile: IDEAgentAnalysisPacketProfile;
  projectSummary: {
    primaryLanguage: string;
    fileCount: number;
    targetCount: number;
    materialization: Record<string, boolean | number | string>;
    degraded: IDEAgentAnalysisDegradedReason[];
    warnings: string[];
  };
  units: IDEAgentAnalysisUnit[];
  sourceRefs: IDEAgentSourceRef[];
  requiredReadSet: string[];
  structuralEvidenceRefs: IDEAgentStructuralEvidenceRef[];
  retrievalHints: {
    structureTools: string[];
    callContextAvailable: boolean;
    graphAvailable: boolean;
    stableKeyFormat: string;
    aliasPolicy: string;
  };
  budget: {
    includedUnits: number;
    totalUnits: number;
    omittedReason?: string;
  };
  progressSeed: IDEAgentAnalysisProgressSeed;
  meta: {
    compressionIndependent: true;
    builder: 'IDEAgentAnalysisPacketBuilder';
    source: 'project-context' | 'project-intelligence-result' | 'project-snapshot';
  };
}

export interface IDEAgentAnalysisPacketBuilderOptions {
  profile?: IDEAgentAnalysisPacketProfile;
  generatedAt?: string;
  maxUnits?: number;
  projectRoot?: string;
}

export interface IDEAgentAnalysisPacketBuilderInput {
  result: ProjectAnalysisResult | ProjectSnapshot;
  options?: IDEAgentAnalysisPacketBuilderOptions;
}

export interface IDEAgentProjectContextPacketInput {
  projectContext:
    | ProjectContextPresenterInput
    | readonly ProjectContextEnvelope<ProjectContextResult>[];
  dimensions?: readonly DimensionDef[];
  options?: IDEAgentAnalysisPacketBuilderOptions;
}

interface NormalizedProjectIntelligence {
  source: 'project-intelligence-result' | 'project-snapshot';
  snapshot: ProjectSnapshot;
}

interface SourceRefCandidate {
  sourceRef: IDEAgentSourceRef;
  evidence: IDEAgentStructuralEvidenceRef;
  score: number;
}

interface SourceIdentityIndex {
  byComparablePath: ReadonlyMap<string, CanonicalSourceIdentity>;
}

const DEFAULT_MAX_UNITS = 12;
const STABLE_KEY_FORMAT =
  'qualifiedSourceRef/folder identity + fqn + entityType + optional line/symbol';

export function buildIDEAgentAnalysisPacket({
  result,
  options = {},
}: IDEAgentAnalysisPacketBuilderInput): IDEAgentAnalysisPacket {
  const normalized = normalizeProjectIntelligence(result, options.projectRoot);
  return buildIDEAgentAnalysisPacketFromSnapshot(normalized.snapshot, {
    ...options,
    source: normalized.source,
  });
}

export function buildIDEAgentAnalysisPacketFromSnapshot(
  snapshot: ProjectSnapshot,
  options: IDEAgentAnalysisPacketBuilderOptions & {
    source?: IDEAgentAnalysisPacket['meta']['source'];
  } = {}
): IDEAgentAnalysisPacket {
  const profile = options.profile ?? 'cold-start';
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const maxUnits = Math.max(1, options.maxUnits ?? DEFAULT_MAX_UNITS);
  const globalDegraded = inferGlobalDegraded(snapshot);
  const globalWarnings = inferGlobalWarnings(snapshot, globalDegraded);
  const candidates = collectSourceRefCandidates(snapshot);
  const dimensions = snapshot.activeDimensions.length
    ? [...snapshot.activeDimensions]
    : [{ id: 'project-overview', label: 'Project Overview' }];
  const totalUnits = dimensions.length;
  const selectedDimensions = dimensions.slice(0, maxUnits);
  const units = selectedDimensions.map((dimension, index) =>
    buildAnalysisUnit({
      snapshot,
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
    projectRoot: snapshot.projectRoot,
    dimensions: units.map((unit) => unit.dimensionId),
    requiredReadSet,
    structuralEvidenceRefs: structuralEvidenceRefs.map((ref) => ref.ref),
  };
  const packetId = `ide_packet_${stableHash(packetIdentity)}`;
  const progressSeed = createIDEAgentAnalysisProgressSeed({ packetId, units });

  return {
    packetId,
    projectRootHash: stableHash(snapshot.projectRoot),
    generatedAt,
    profile,
    projectSummary: {
      primaryLanguage: snapshot.language.primaryLang,
      fileCount: snapshot.allFiles.length,
      targetCount: snapshot.targetsSummary.length || snapshot.allTargets.length,
      materialization: buildMaterializationSummary(snapshot),
      degraded: globalDegraded,
      warnings: globalWarnings,
    },
    units,
    sourceRefs,
    requiredReadSet,
    structuralEvidenceRefs,
    retrievalHints: {
      structureTools: ['alembic_structure', 'alembic_graph', 'alembic_call_context'],
      callContextAvailable: Boolean(snapshot.callGraph && snapshot.callGraph.edgesCreated !== 0),
      graphAvailable: Boolean(
        snapshot.codeEntityGraph ||
          snapshot.callGraph ||
          (snapshot.dependencyGraph?.edges?.length ?? 0) > 0
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
      builder: 'IDEAgentAnalysisPacketBuilder',
      source: options.source ?? 'project-snapshot',
    },
  };
}

export function buildIDEAgentAnalysisPacketFromProjectContext({
  projectContext,
  dimensions = [],
  options = {},
}: IDEAgentProjectContextPacketInput): IDEAgentAnalysisPacket {
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
  const progressSeed = createIDEAgentAnalysisProgressSeed({ packetId, units });

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
      builder: 'IDEAgentAnalysisPacketBuilder',
      source: 'project-context',
    },
  };
}

export function createIDEAgentAnalysisUnitKey(
  input: IDEAgentStableUnitKeyInput
): IDEAgentStableUnitKey {
  const sourceRef = normalizeComparablePath(input.sourceRef);
  const qualifiedPath = input.qualifiedPath
    ? normalizeComparablePath(input.qualifiedPath)
    : undefined;
  const symbol = input.symbol?.trim() || undefined;
  const fqn = input.fqn?.trim() || undefined;
  const shortAlias = createShortAlias({ fqn, symbol, sourceRef });
  return {
    sourceRef,
    ...(input.projectScopeId ? { projectScopeId: input.projectScopeId } : {}),
    ...(input.folderId ? { folderId: input.folderId } : {}),
    ...(qualifiedPath ? { qualifiedPath } : {}),
    ...(fqn ? { fqn } : {}),
    entityType: input.entityType,
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
    ...(symbol ? { symbol } : {}),
    key: `ide_unit_${stableHash({
      sourceRef: qualifiedPath ?? sourceRef,
      projectScopeId: input.projectScopeId,
      folderId: input.folderId,
      fqn,
      entityType: input.entityType,
      line: input.line,
      symbol,
    })}`,
    ...(shortAlias ? { shortAlias } : {}),
  };
}

export function createIDEAgentAnalysisUnitProgress(
  unit: Pick<IDEAgentAnalysisUnit, 'unitId' | 'dimensionId'>,
  overrides: Partial<Omit<IDEAgentAnalysisUnitProgress, 'unitId'>> = {}
): IDEAgentAnalysisUnitProgress {
  return {
    unitId: unit.unitId,
    status: overrides.status ?? 'pending',
    ...(overrides.claimedAt ? { claimedAt: overrides.claimedAt } : {}),
    ...(overrides.completedAt ? { completedAt: overrides.completedAt } : {}),
    submittedRecipeIds: [...(overrides.submittedRecipeIds ?? [])],
    referencedFiles: sortUnique(overrides.referencedFiles ?? []),
    rejectedReasons: [...(overrides.rejectedReasons ?? [])],
    ...(overrides.deviationReason ? { deviationReason: overrides.deviationReason } : {}),
    checkpoint: overrides.checkpoint ?? {
      dimensionId: unit.dimensionId,
      checkpointKind: 'dimension-checkpoint',
    },
  };
}

export function createIDEAgentAnalysisProgressSeed({
  packetId,
  units,
}: {
  packetId: string;
  units: readonly IDEAgentAnalysisUnit[];
}): IDEAgentAnalysisProgressSeed {
  const unitProgress = units.map((unit) => createIDEAgentAnalysisUnitProgress(unit));
  return {
    packetId,
    checkpointKind: 'ide-agent-analysis-unit-progress',
    totalUnits: units.length,
    remainingUnitIds: units.map((unit) => unit.unitId),
    unitProgress,
  };
}

function normalizeProjectIntelligence(
  result: ProjectAnalysisResult | ProjectSnapshot,
  projectRoot?: string
): NormalizedProjectIntelligence {
  if (isProjectSnapshot(result)) {
    return { source: 'project-snapshot', snapshot: result };
  }
  return {
    source: 'project-intelligence-result',
    snapshot: buildProjectSnapshot({
      projectRoot: projectRoot ?? '',
      allFiles: result.allFiles,
      allTargets: result.allTargets,
      discoverer: result.discoverer,
      langStats: result.langStats,
      primaryLang: result.primaryLang,
      truncated: result.truncated,
      astProjectSummary: result.astProjectSummary,
      astContext: result.astContext,
      codeEntityResult: result.codeEntityResult,
      callGraphResult: result.callGraphResult,
      panoramaResult: result.panoramaResult,
      depGraphData: result.depGraphData,
      depEdgesWritten: result.depEdgesWritten,
      guardAudit: result.guardAudit,
      activeDimensions: result.activeDimensions,
      enhancementPackInfo: result.enhancementPackInfo,
      enhancementPatterns: result.enhancementPatterns,
      enhancementGuardRules: result.enhancementGuardRules,
      detectedFrameworks: result.detectedFrameworks,
      langProfile: result.langProfile,
      targetsSummary: result.targetsSummary,
      localPackageModules: result.localPackageModules,
      report: result.report,
      warnings: result.warnings,
      incrementalPlan: result.incrementalPlan,
      isEmpty: result.isEmpty,
    }),
  };
}

function isProjectSnapshot(
  input: ProjectAnalysisResult | ProjectSnapshot
): input is ProjectSnapshot {
  return 'version' in input && 'language' in input && 'dependencyGraph' in input;
}

function buildAnalysisUnit({
  snapshot,
  dimension,
  index,
  candidates,
  globalDegraded,
  globalWarnings,
}: {
  snapshot: ProjectSnapshot;
  dimension: DimensionDef;
  index: number;
  candidates: readonly SourceRefCandidate[];
  globalDegraded: readonly IDEAgentAnalysisDegradedReason[];
  globalWarnings: readonly string[];
}): IDEAgentAnalysisUnit {
  const dimensionCandidates = selectCandidatesForDimension(dimension.id, candidates);
  const fallbackCandidates = candidates.slice(0, 8);
  const selected = (dimensionCandidates.length ? dimensionCandidates : fallbackCandidates).slice(
    0,
    8
  );
  const sourceRefs = dedupeSourceRefs(selected.map((candidate) => candidate.sourceRef));
  const requiredReadSet = sortUnique(sourceRefs.map(readableSourcePath));
  const structuralEvidenceRefs = dedupeEvidenceRefs(
    selected.map((candidate) => candidate.evidence)
  );
  const representative = sourceRefs[0] ?? createFallbackSourceRef(snapshot);
  const key = createIDEAgentAnalysisUnitKey({
    sourceRef: sourceRefKey(representative),
    projectScopeId: representative.projectScopeId,
    folderId: representative.folderId,
    qualifiedPath: representative.qualifiedPath,
    fqn: representative.fqn,
    entityType: representative.entityType ?? 'dimension',
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
      ? [`${dimension.id}: no deterministic read set could be projected`]
      : []),
  ];
  const targetName = findTargetName(sourceRefs, snapshot.allFiles);
  const moduleName = findModuleName(sourceRefs, snapshot.localPackageModules);
  const priority = Math.max(1, 100 - index * 5 - degraded.length * 3);
  const structuralHints = buildStructuralHints(snapshot, dimension.id, selected);

  // 这里的完成契约只描述 Host Agent 需要证明什么，不决定提交/持久化策略。
  const completionContract: IDEAgentCompletionContract = {
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
    })}`,
    key,
    dimensionId: dimension.id,
    ...(targetName ? { targetName } : {}),
    ...(moduleName ? { moduleName } : {}),
    priority,
    reason: buildUnitReason(dimension, selected, degraded),
    sourceRefs,
    requiredReadSet,
    structuralEvidenceRefs,
    structuralHints,
    completionContract,
    degraded,
    warnings,
  };
}

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
  globalDegraded: readonly IDEAgentAnalysisDegradedReason[];
  globalWarnings: readonly string[];
}): IDEAgentAnalysisUnit {
  const selected = selectProjectContextCandidatesForDimension(dimension.id, candidates).slice(0, 8);
  const fallbackSelected = selected.length ? selected : candidates.slice(0, 8);
  const sourceRefs = dedupeSourceRefs(fallbackSelected.map((candidate) => candidate.sourceRef));
  const requiredReadSet = sortUnique(sourceRefs.map(readableSourcePath));
  const structuralEvidenceRefs = dedupeEvidenceRefs(
    fallbackSelected.map((candidate) => candidate.evidence)
  );
  const representative = sourceRefs[0] ?? createProjectContextFallbackSourceRef(presenterInput);
  const key = createIDEAgentAnalysisUnitKey({
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
  const completionContract: IDEAgentCompletionContract = {
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

function normalizeProjectContextPresenterInput(
  input: ProjectContextPresenterInput | readonly ProjectContextEnvelope<ProjectContextResult>[]
): ProjectContextPresenterInput {
  return 'project' in input ? input : buildProjectContextPresenterInput(input);
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
}): IDEAgentSourceRef | null {
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

function sourceRefFromProjectContextRef(ref: ProjectContextRef): IDEAgentSourceRef | null {
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
  role: IDEAgentSourceRefRole;
  displayName?: string;
}): IDEAgentSourceRef | null {
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
  sourceRef: IDEAgentSourceRef,
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

function scoreProjectContextRef(ref: ProjectContextRef): number {
  switch (ref.kind) {
    case 'source-slice':
    case 'anchor-range':
    case 'symbol':
      return 96;
    case 'file-symbol':
    case 'file-flow':
      return 92;
    case 'file':
      return 88;
    case 'module':
    case 'module-layer':
      return 82;
    case 'map':
    case 'repo':
      return 76;
    default:
      return 60;
  }
}

function projectContextRefRole(kind: ProjectContextRef['kind']): IDEAgentSourceRefRole {
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
): IDEAgentStructuralHints {
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
): IDEAgentSourceRef {
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
): IDEAgentAnalysisDegradedReason[] {
  return input.unavailable.length || input.warnings.some((warning) => warning.severity === 'error')
    ? ['project-context-unavailable']
    : [];
}

function inferProjectContextWarnings(
  input: ProjectContextPresenterInput,
  degraded: readonly IDEAgentAnalysisDegradedReason[]
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

function collectSourceRefCandidates(snapshot: ProjectSnapshot): SourceRefCandidate[] {
  const sourceIdentityIndex = buildSourceIdentityIndex(snapshot.allFiles);
  const candidates: SourceRefCandidate[] = [
    ...collectAstCandidates(snapshot.projectRoot, snapshot.ast, sourceIdentityIndex),
    ...collectDependencyCandidates(
      snapshot.projectRoot,
      snapshot.dependencyGraph,
      sourceIdentityIndex
    ),
    ...collectGuardCandidates(snapshot.projectRoot, snapshot.guardAudit, sourceIdentityIndex),
    ...collectModuleCandidates(
      snapshot.projectRoot,
      snapshot.localPackageModules,
      sourceIdentityIndex
    ),
    ...collectFileCandidates(snapshot.projectRoot, snapshot.allFiles),
  ];
  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      readableSourcePath(a.sourceRef).localeCompare(readableSourcePath(b.sourceRef)) ||
      (a.sourceRef.symbol ?? '').localeCompare(b.sourceRef.symbol ?? '')
  );
}

function collectAstCandidates(
  projectRoot: string,
  ast: AstSummary | null,
  sourceIdentityIndex: SourceIdentityIndex
): SourceRefCandidate[] {
  if (!ast) {
    return [];
  }
  const result: SourceRefCandidate[] = [];
  for (const cls of ast.classes ?? []) {
    const ref = sourceRefFromAstClass(projectRoot, cls, sourceIdentityIndex);
    if (!ref) {
      continue;
    }
    result.push(makeCandidate(ref, 'ast', `class:${ref.fqn ?? ref.symbol ?? ref.path}`, 100));
    for (const method of collectClassMethods(cls).slice(0, 4)) {
      const methodRef = sourceRefFromAstMethod(projectRoot, method, cls, sourceIdentityIndex);
      if (methodRef) {
        result.push(
          makeCandidate(
            methodRef,
            'ast',
            `method:${methodRef.fqn ?? methodRef.symbol ?? methodRef.path}`,
            94
          )
        );
      }
    }
  }
  for (const protocol of ast.protocols ?? []) {
    const ref = sourceRefFromProtocol(projectRoot, protocol, sourceIdentityIndex);
    if (ref) {
      result.push(makeCandidate(ref, 'ast', `protocol:${ref.fqn ?? ref.symbol ?? ref.path}`, 86));
    }
  }
  return result;
}

function collectDependencyCandidates(
  projectRoot: string,
  dependencyGraph: DependencyGraph | null,
  sourceIdentityIndex: SourceIdentityIndex
): SourceRefCandidate[] {
  return (dependencyGraph?.edges ?? [])
    .map((edge) => sourceRefFromDependencyEdge(projectRoot, edge, sourceIdentityIndex))
    .filter((candidate): candidate is SourceRefCandidate => Boolean(candidate));
}

function collectGuardCandidates(
  projectRoot: string,
  guardAudit: GuardAudit | null,
  sourceIdentityIndex: SourceIdentityIndex
): SourceRefCandidate[] {
  const result: SourceRefCandidate[] = [];
  for (const file of guardAudit?.files ?? []) {
    for (const violation of file.violations ?? []) {
      const ref = makeSourceRef({
        projectRoot,
        path: file.filePath,
        line: violation.line,
        symbol: violation.ruleId,
        entityType: 'guard-violation',
        role: 'guard',
        displayName: violation.message ?? violation.ruleId ?? file.filePath,
        sourceIdentityIndex,
      });
      if (ref) {
        result.push(makeCandidate(ref, 'guard', `guard:${ref.path}:${violation.ruleId ?? ''}`, 78));
      }
    }
  }
  for (const violation of guardAudit?.crossFileViolations ?? []) {
    for (const location of violation.locations ?? []) {
      const ref = makeSourceRef({
        projectRoot,
        path: location.filePath,
        line: location.line ?? violation.line,
        symbol: violation.ruleId,
        entityType: 'guard-violation',
        role: 'guard',
        displayName: violation.message ?? violation.ruleId ?? location.filePath,
        sourceIdentityIndex,
      });
      if (ref) {
        result.push(makeCandidate(ref, 'guard', `guard:${ref.path}:${violation.ruleId ?? ''}`, 76));
      }
    }
  }
  return result;
}

function collectModuleCandidates(
  projectRoot: string,
  modules: readonly LocalPackageModule[],
  sourceIdentityIndex: SourceIdentityIndex
): SourceRefCandidate[] {
  return modules.flatMap((module) =>
    (module.keyFiles ?? []).slice(0, 6).flatMap((filePath) => {
      const ref = makeSourceRef({
        projectRoot,
        path: filePath,
        symbol: module.name,
        entityType: 'module',
        role: 'module',
        displayName: module.packageName || module.name,
        sourceIdentityIndex,
      });
      return ref ? [makeCandidate(ref, 'module', `module:${module.name}:${ref.path}`, 72)] : [];
    })
  );
}

function collectFileCandidates(
  projectRoot: string,
  files: readonly SnapshotFile[]
): SourceRefCandidate[] {
  return files.slice(0, 20).flatMap((file) => {
    const ref = makeSourceRef({
      projectRoot,
      path: file.relativePath || file.path,
      entityType: 'file',
      role: 'entry',
      displayName: file.name || file.relativePath || file.path,
      sourceIdentity: file.sourceIdentity,
    });
    return ref
      ? [makeCandidate(ref, 'file', `file:${ref.path}`, file.priority === 'high' ? 70 : 50)]
      : [];
  });
}

function makeCandidate(
  sourceRef: IDEAgentSourceRef,
  kind: IDEAgentStructuralEvidenceKind,
  ref: string,
  score: number
): SourceRefCandidate {
  return {
    sourceRef,
    evidence: {
      kind,
      ref: `${kind}:${stableHash(ref)}`,
      summary: describeSourceRef(sourceRef),
      sourceRefs: [sourceRef],
    },
    score,
  };
}

function sourceRefFromAstClass(
  projectRoot: string,
  cls: AstClassInfo,
  sourceIdentityIndex: SourceIdentityIndex
): IDEAgentSourceRef | null {
  return makeSourceRef({
    projectRoot,
    path: cls.relativePath ?? cls.file,
    symbol: cls.name,
    fqn: cls.file || cls.relativePath ? `${cls.file ?? cls.relativePath}::${cls.name}` : cls.name,
    entityType: cls.kind ?? 'class',
    role: 'symbol',
    displayName: cls.name,
    sourceIdentityIndex,
  });
}

function sourceRefFromAstMethod(
  projectRoot: string,
  method: AstMethodInfo,
  cls: AstClassInfo,
  sourceIdentityIndex: SourceIdentityIndex
): IDEAgentSourceRef | null {
  const methodName = method.name;
  const className = method.className ?? cls.name;
  const path = method.file ?? cls.relativePath ?? cls.file;
  return makeSourceRef({
    projectRoot,
    path,
    line: method.line,
    symbol: methodName,
    fqn: path ? `${path}::${className}.${methodName}` : `${className}.${methodName}`,
    entityType: 'method',
    role: 'symbol',
    displayName: `${className}.${methodName}`,
    sourceIdentityIndex,
  });
}

function sourceRefFromProtocol(
  projectRoot: string,
  protocol: AstProtocolInfo,
  sourceIdentityIndex: SourceIdentityIndex
): IDEAgentSourceRef | null {
  return makeSourceRef({
    projectRoot,
    path: protocol.relativePath ?? protocol.file,
    symbol: protocol.name,
    fqn:
      protocol.file || protocol.relativePath
        ? `${protocol.file ?? protocol.relativePath}::${protocol.name}`
        : protocol.name,
    entityType: 'protocol',
    role: 'symbol',
    displayName: protocol.name,
    sourceIdentityIndex,
  });
}

function sourceRefFromDependencyEdge(
  projectRoot: string,
  edge: DependencyEdge,
  sourceIdentityIndex: SourceIdentityIndex
): SourceRefCandidate | null {
  const ref = makeSourceRef({
    projectRoot,
    path: pathLike(edge.from) ?? pathLike(edge.to),
    symbol: `${edge.from}->${edge.to}`,
    entityType: 'dependency-edge',
    role: 'dependency',
    displayName: `${edge.from} -> ${edge.to}`,
    sourceIdentityIndex,
  });
  if (!ref) {
    return null;
  }
  return makeCandidate(
    ref,
    'dependency',
    `dependency:${edge.from}:${edge.to}:${edge.type ?? ''}`,
    80
  );
}

function makeSourceRef({
  projectRoot,
  path,
  line,
  symbol,
  fqn,
  entityType,
  role,
  displayName,
  sourceIdentity,
  sourceIdentityIndex,
}: {
  projectRoot: string;
  path?: string;
  line?: number;
  symbol?: string;
  fqn?: string;
  entityType?: string;
  role?: IDEAgentSourceRefRole;
  displayName?: string;
  sourceIdentity?: CanonicalSourceIdentity;
  sourceIdentityIndex?: SourceIdentityIndex;
}): IDEAgentSourceRef | null {
  const normalizedPath = normalizeProjectPath(path, projectRoot);
  if (!normalizedPath) {
    return null;
  }
  const identity = sourceIdentity ?? sourceIdentityIndex?.byComparablePath.get(normalizedPath);
  const alias = createShortAlias({ fqn, symbol, sourceRef: normalizedPath });
  return {
    path: normalizedPath,
    ...(identity?.projectScopeId ? { projectScopeId: identity.projectScopeId } : {}),
    ...(identity?.folderId ? { folderId: identity.folderId } : {}),
    ...(identity?.folderDisplayName ? { folderDisplayName: identity.folderDisplayName } : {}),
    ...(identity?.folderRelativeRoot ? { folderRelativeRoot: identity.folderRelativeRoot } : {}),
    ...(identity?.relativePath ? { relativePath: identity.relativePath } : {}),
    ...(identity?.qualifiedPath ? { qualifiedPath: identity.qualifiedPath } : {}),
    ...(typeof line === 'number' ? { line } : {}),
    ...(symbol ? { symbol } : {}),
    ...(fqn ? { fqn: normalizeFqn(fqn, projectRoot) } : {}),
    ...(entityType ? { entityType } : {}),
    ...(role ? { role } : {}),
    ...(displayName ? { displayName } : {}),
    ...(alias ? { alias } : {}),
  };
}

function collectClassMethods(cls: AstClassInfo): AstMethodInfo[] {
  return (cls.methods ?? []).flatMap((method) => {
    if (typeof method === 'string') {
      return [{ name: method, className: cls.name, file: cls.relativePath ?? cls.file }];
    }
    if (method && typeof method === 'object' && 'name' in method) {
      return [
        {
          ...(method as AstMethodInfo),
          className: (method as AstMethodInfo).className ?? cls.name,
          file: (method as AstMethodInfo).file ?? cls.relativePath ?? cls.file,
        },
      ];
    }
    return [];
  });
}

function selectCandidatesForDimension(
  dimensionId: string,
  candidates: readonly SourceRefCandidate[]
): SourceRefCandidate[] {
  const id = dimensionId.toLowerCase();
  const preferredKinds = preferredEvidenceKinds(id);
  const preferred = candidates.filter((candidate) => preferredKinds.has(candidate.evidence.kind));
  return (preferred.length ? preferred : candidates).slice(0, 12);
}

function preferredEvidenceKinds(dimensionId: string): Set<IDEAgentStructuralEvidenceKind> {
  if (dimensionId.includes('architecture') || dimensionId.includes('module')) {
    return new Set(['dependency', 'module', 'ast', 'panorama']);
  }
  if (
    dimensionId.includes('flow') ||
    dimensionId.includes('event') ||
    dimensionId.includes('data') ||
    dimensionId.includes('call')
  ) {
    return new Set(['callgraph', 'dependency', 'ast']);
  }
  if (
    dimensionId.includes('quality') ||
    dimensionId.includes('guard') ||
    dimensionId.includes('standard')
  ) {
    return new Set(['guard', 'ast', 'file']);
  }
  return new Set(['ast', 'dependency', 'guard', 'module', 'file']);
}

function buildStructuralHints(
  snapshot: ProjectSnapshot,
  dimensionId: string,
  candidates: readonly SourceRefCandidate[]
): IDEAgentStructuralHints {
  const astHints = candidates
    .filter((candidate) => candidate.evidence.kind === 'ast')
    .map((candidate) => describeSourceRef(candidate.sourceRef))
    .slice(0, 8);
  const dependencyHints = (snapshot.dependencyGraph?.edges ?? []).slice(0, 8).map((edge) => ({
    from: edge.from,
    to: edge.to,
    relation: edge.type ?? 'depends-on',
  }));
  const guardHints = collectGuardHintText(snapshot.guardAudit).slice(0, 8);
  const panorama = collectPanoramaHints(snapshot.panorama).slice(0, 8);
  const aliases = sortUnique(
    candidates.flatMap((candidate) => candidate.sourceRef.alias ?? candidate.sourceRef.symbol ?? [])
  ).slice(0, 8);
  const callGraphHint =
    snapshot.callGraph && snapshot.callGraph.edgesCreated !== undefined
      ? [`materialized call edges: ${snapshot.callGraph.edgesCreated}`]
      : [];

  return {
    ...(astHints.length ? { ast: astHints } : {}),
    ...(dependencyHints.length ? { dependencies: dependencyHints } : {}),
    ...(callGraphHint.length ? { callers: callGraphHint, callees: callGraphHint } : {}),
    ...(dimensionId.toLowerCase().includes('flow') && callGraphHint.length
      ? { dataFlowHints: callGraphHint }
      : {}),
    ...(guardHints.length ? { guardFindings: guardHints } : {}),
    ...(panorama.length ? { panorama } : {}),
    ...(aliases.length ? { aliases } : {}),
  };
}

function collectGuardHintText(guardAudit: GuardAudit | null): string[] {
  const local = (guardAudit?.files ?? []).flatMap((file) =>
    (file.violations ?? []).map((violation) => describeGuardViolation(file.filePath, violation))
  );
  const cross = (guardAudit?.crossFileViolations ?? []).map((violation) =>
    describeGuardViolation(violation.locations?.[0]?.filePath ?? 'cross-file', violation)
  );
  return [...local, ...cross].filter(Boolean);
}

function describeGuardViolation(filePath: string, violation: GuardViolation): string {
  const rule = violation.ruleId ? `[${violation.ruleId}] ` : '';
  const line = typeof violation.line === 'number' ? `:${violation.line}` : '';
  return `${filePath}${line} ${rule}${violation.message ?? 'guard violation'}`;
}

function collectPanoramaHints(panorama: PanoramaResult | null): string[] {
  return [
    ...collectPanoramaLayerHints(panorama),
    ...collectPanoramaCouplingHints(panorama),
    ...collectPanoramaCycleHints(panorama),
  ];
}

// 兼容两类 legacy panorama 输入：ProjectSnapshot 归一化数组，以及旧 raw layers.levels / modules Map。
function collectPanoramaLayerHints(panorama: PanoramaResult | null): string[] {
  const rawLayers = panorama?.layers as unknown;
  const layers = Array.isArray(rawLayers)
    ? rawLayers
    : isRecord(rawLayers) && Array.isArray(rawLayers.levels)
      ? rawLayers.levels
      : [];

  return layers.filter(isRecord).map((layer) => {
    const level = typeof layer.level === 'number' ? layer.level : 0;
    const name = typeof layer.name === 'string' ? layer.name : `Layer ${level}`;
    const modules = Array.isArray(layer.modules) ? layer.modules.map(String) : [];
    return `L${level} ${name}: ${modules.join(', ')}`;
  });
}

function collectPanoramaCouplingHints(panorama: PanoramaResult | null): string[] {
  const normalizedHotspots = (panorama?.couplingHotspots ?? []).map(
    (hotspot) => `${hotspot.module} fanIn=${hotspot.fanIn} fanOut=${hotspot.fanOut}`
  );
  const rawModules = (panorama as Record<string, unknown> | null)?.modules;
  const moduleValues =
    rawModules instanceof Map
      ? [...rawModules.values()]
      : isRecord(rawModules)
        ? Object.values(rawModules)
        : [];
  const rawHotspots = moduleValues
    .filter(isRecord)
    .filter((mod) => (readNumber(mod.fanIn) ?? 0) >= 10 || (readNumber(mod.fanOut) ?? 0) >= 10)
    .map((mod) => {
      const name = typeof mod.name === 'string' ? mod.name : '';
      return `${name} fanIn=${readNumber(mod.fanIn) ?? 0} fanOut=${readNumber(mod.fanOut) ?? 0}`;
    });

  return [...normalizedHotspots, ...rawHotspots];
}

function collectPanoramaCycleHints(panorama: PanoramaResult | null): string[] {
  const normalizedCycles = (panorama?.cyclicDependencies ?? []).map(
    (cycle) => `${cycle.severity}: ${cycle.cycle.join(' -> ')}`
  );
  const rawCycles = (panorama as Record<string, unknown> | null)?.cycles;
  const rawCycleHints = Array.isArray(rawCycles)
    ? rawCycles.filter(isRecord).map((cycle) => {
        const severity = typeof cycle.severity === 'string' ? cycle.severity : 'cycle';
        const modules = Array.isArray(cycle.modules)
          ? cycle.modules.map(String)
          : Array.isArray(cycle.cycle)
            ? cycle.cycle.map(String)
            : [];
        return `${severity}: ${modules.join(' -> ')}`;
      })
    : [];
  return [...normalizedCycles, ...rawCycleHints];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function buildMaterializationSummary(
  snapshot: ProjectSnapshot
): Record<string, boolean | number | string> {
  return {
    ast: Boolean(snapshot.ast),
    codeEntityGraph: Boolean(snapshot.codeEntityGraph),
    callGraph: Boolean(snapshot.callGraph),
    callGraphEdges: snapshot.callGraph?.edgesCreated ?? 0,
    dependencyGraph: Boolean(snapshot.dependencyGraph),
    dependencyEdges: snapshot.dependencyGraph?.edges?.length ?? 0,
    depEdgesWritten: snapshot.depEdgesWritten,
    guardAudit: Boolean(snapshot.guardAudit),
    panorama: Boolean(snapshot.panorama),
    truncated: snapshot.truncated,
  };
}

function inferGlobalDegraded(snapshot: ProjectSnapshot): IDEAgentAnalysisDegradedReason[] {
  const reasons: IDEAgentAnalysisDegradedReason[] = [];
  if (!snapshot.ast) {
    reasons.push('ast-unavailable');
  }
  if (matchesWarning(snapshot.warnings, ['ast', 'partial', 'failed', 'degraded'])) {
    reasons.push('ast-partial');
  }
  if (!snapshot.callGraph) {
    reasons.push('callgraph-unavailable');
  }
  if (matchesWarning(snapshot.warnings, ['call graph', 'callgraph', 'partial', 'failed'])) {
    reasons.push(snapshot.callGraph ? 'callgraph-partial' : 'callgraph-unavailable');
  }
  if (!snapshot.dependencyGraph) {
    reasons.push('depgraph-unavailable');
  }
  if (!snapshot.guardAudit) {
    reasons.push('guard-unavailable');
  }
  if (!snapshot.panorama) {
    reasons.push('panorama-unavailable');
  }
  return dedupeDegraded(reasons);
}

function inferGlobalWarnings(
  snapshot: ProjectSnapshot,
  degraded: readonly IDEAgentAnalysisDegradedReason[]
): string[] {
  return sortUnique([
    ...snapshot.warnings,
    ...degraded.map((reason) => `IDE analysis packet degraded: ${reason}`),
  ]);
}

function matchesWarning(warnings: readonly string[], tokens: readonly string[]): boolean {
  return warnings.some((warning) => {
    const lower = warning.toLowerCase();
    return tokens.some((token) => lower.includes(token));
  });
}

function expectedEvidenceForDimension(
  dimensionId: string,
  evidenceRefs: readonly IDEAgentStructuralEvidenceRef[]
): string[] {
  const kinds = sortUnique(evidenceRefs.map((ref) => ref.kind));
  const expected = ['reasoning.sources intersects unit.requiredReadSet'];
  if (kinds.length) {
    expected.push(`structural evidence: ${kinds.join(', ')}`);
  }
  if (dimensionId.includes('flow')) {
    expected.push('call/data-flow relationship or explicit deviation reason');
  }
  return expected;
}

function buildUnitReason(
  dimension: DimensionDef,
  candidates: readonly SourceRefCandidate[],
  degraded: readonly IDEAgentAnalysisDegradedReason[]
): string {
  const label = dimension.label ?? dimension.id;
  const evidenceKinds = sortUnique(candidates.map((candidate) => candidate.evidence.kind));
  const evidenceText = evidenceKinds.length ? evidenceKinds.join(', ') : 'file fallback';
  const degradedText = degraded.length ? `; degraded=${degraded.join(',')}` : '';
  return `${label}: read assigned ${evidenceText} evidence before producing or rejecting Recipe${degradedText}`;
}

function createFallbackSourceRef(snapshot: ProjectSnapshot): IDEAgentSourceRef {
  const first = snapshot.allFiles[0];
  const identity = first?.sourceIdentity;
  return {
    path: first?.relativePath || first?.path || 'project',
    ...(identity?.projectScopeId ? { projectScopeId: identity.projectScopeId } : {}),
    ...(identity?.folderId ? { folderId: identity.folderId } : {}),
    ...(identity?.folderDisplayName ? { folderDisplayName: identity.folderDisplayName } : {}),
    ...(identity?.folderRelativeRoot ? { folderRelativeRoot: identity.folderRelativeRoot } : {}),
    ...(identity?.relativePath ? { relativePath: identity.relativePath } : {}),
    ...(identity?.qualifiedPath ? { qualifiedPath: identity.qualifiedPath } : {}),
    entityType: 'project',
    role: 'entry',
    displayName: snapshot.projectRoot ? 'Project overview' : 'Project',
    alias: 'Project',
  };
}

function findTargetName(
  sourceRefs: readonly IDEAgentSourceRef[],
  files: readonly SnapshotFile[]
): string | undefined {
  const paths = new Set(sourceRefs.flatMap(sourceRefComparablePaths));
  return (
    files.find((file) =>
      [file.relativePath, file.path, file.sourceIdentity?.qualifiedPath].some(
        (candidate) => candidate && paths.has(normalizeComparablePath(candidate))
      )
    )?.targetName || undefined
  );
}

function findModuleName(
  sourceRefs: readonly IDEAgentSourceRef[],
  modules: readonly LocalPackageModule[]
): string | undefined {
  const paths = new Set(sourceRefs.flatMap(sourceRefComparablePaths));
  return modules.find((module) =>
    [
      ...(module.keyFiles ?? []),
      ...(module.keyFileIdentities ?? []).flatMap((identity) => [
        identity.relativePath,
        identity.qualifiedPath,
      ]),
    ].some((candidate) => paths.has(normalizeComparablePath(candidate)))
  )?.name;
}

function buildSourceIdentityIndex(files: readonly SnapshotFile[]): SourceIdentityIndex {
  const byComparablePath = new Map<string, CanonicalSourceIdentity>();
  for (const file of files) {
    const identity = file.sourceIdentity;
    if (!identity) {
      continue;
    }
    for (const candidate of [
      file.relativePath,
      file.path,
      identity.relativePath,
      identity.qualifiedPath,
    ]) {
      if (candidate) {
        byComparablePath.set(normalizeComparablePath(candidate), identity);
      }
    }
  }
  return { byComparablePath };
}

function readableSourcePath(sourceRef: IDEAgentSourceRef): string {
  return sourceRef.qualifiedPath ?? sourceRef.path;
}

function sourceRefComparablePaths(sourceRef: IDEAgentSourceRef): string[] {
  return [sourceRef.path, sourceRef.relativePath, sourceRef.qualifiedPath]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(normalizeComparablePath);
}

function normalizeProjectPath(pathValue: string | undefined, projectRoot: string): string | null {
  if (!pathValue || !pathValue.trim()) {
    return null;
  }
  const withoutLine = pathValue.trim().replace(/\\/g, '/');
  const normalized = isAbsolute(withoutLine)
    ? relative(projectRoot || '/', withoutLine).replace(/\\/g, '/')
    : withoutLine;
  return normalizeComparablePath(normalized);
}

function normalizeFqn(fqn: string, projectRoot: string): string {
  const [filePart, symbolPart] = fqn.split('::');
  if (!symbolPart) {
    return fqn;
  }
  const normalizedPath = normalizeProjectPath(filePart, projectRoot) ?? filePart;
  return `${normalizedPath}::${symbolPart}`;
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function pathLike(value: string): string | undefined {
  return value.includes('/') || /\.[a-z0-9]+$/i.test(value) ? value : undefined;
}

function sourceRefKey(sourceRef: IDEAgentSourceRef): string {
  const pathValue = readableSourcePath(sourceRef);
  return `${pathValue}${typeof sourceRef.line === 'number' ? `:${sourceRef.line}` : ''}`;
}

function describeSourceRef(sourceRef: IDEAgentSourceRef): string {
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

function dedupeSourceRefs(sourceRefs: readonly IDEAgentSourceRef[]): IDEAgentSourceRef[] {
  const map = new Map<string, IDEAgentSourceRef>();
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
  refs: readonly IDEAgentStructuralEvidenceRef[]
): IDEAgentStructuralEvidenceRef[] {
  const map = new Map<string, IDEAgentStructuralEvidenceRef>();
  for (const ref of refs) {
    if (!map.has(ref.ref)) {
      map.set(ref.ref, ref);
    }
  }
  return [...map.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

function dedupeDegraded(
  reasons: readonly IDEAgentAnalysisDegradedReason[]
): IDEAgentAnalysisDegradedReason[] {
  return [...new Set(reasons)].sort();
}

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableHash(value: unknown): string {
  return computeContentHash(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

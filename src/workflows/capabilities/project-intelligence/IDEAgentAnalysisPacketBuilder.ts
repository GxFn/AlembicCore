import { isAbsolute, relative } from 'node:path';
import { computeContentHash } from '../../../shared/content-hash.js';
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
  SnapshotFile,
} from '../../../types/project-snapshot.js';
import { buildProjectSnapshot } from '../../../types/project-snapshot-builder.js';
import type { ProjectAnalysisResult } from './ProjectIntelligenceCapability.js';

export type IDEAgentAnalysisPacketProfile = 'cold-start' | 'rescan';

export type IDEAgentSourceRefRole =
  | 'entry'
  | 'caller'
  | 'callee'
  | 'dependency'
  | 'guard'
  | 'example'
  | 'module'
  | 'symbol';

export type IDEAgentStructuralEvidenceKind =
  | 'ast'
  | 'callgraph'
  | 'dependency'
  | 'guard'
  | 'panorama'
  | 'target'
  | 'module'
  | 'file';

export type IDEAgentAnalysisDegradedReason =
  | 'ast-unavailable'
  | 'ast-partial'
  | 'callgraph-unavailable'
  | 'callgraph-partial'
  | 'depgraph-unavailable'
  | 'guard-unavailable'
  | 'panorama-unavailable'
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
  line?: number;
  symbol?: string;
  fqn?: string;
  entityType?: string;
  role?: IDEAgentSourceRefRole;
  displayName?: string;
  alias?: string;
}

export interface IDEAgentStableUnitKeyInput {
  sourceRef: string;
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
    source: 'project-intelligence-result' | 'project-snapshot';
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

interface NormalizedProjectIntelligence {
  source: 'project-intelligence-result' | 'project-snapshot';
  snapshot: ProjectSnapshot;
}

interface SourceRefCandidate {
  sourceRef: IDEAgentSourceRef;
  evidence: IDEAgentStructuralEvidenceRef;
  score: number;
}

const DEFAULT_MAX_UNITS = 12;
const STABLE_KEY_FORMAT = 'sourceRef + fqn + entityType + optional line/symbol';

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

export function createIDEAgentAnalysisUnitKey(
  input: IDEAgentStableUnitKeyInput
): IDEAgentStableUnitKey {
  const sourceRef = normalizeComparablePath(input.sourceRef);
  const symbol = input.symbol?.trim() || undefined;
  const fqn = input.fqn?.trim() || undefined;
  const shortAlias = createShortAlias({ fqn, symbol, sourceRef });
  return {
    sourceRef,
    ...(fqn ? { fqn } : {}),
    entityType: input.entityType,
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
    ...(symbol ? { symbol } : {}),
    key: `ide_unit_${stableHash({ sourceRef, fqn, entityType: input.entityType, line: input.line, symbol })}`,
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
  const requiredReadSet = sortUnique(sourceRefs.map((sourceRef) => sourceRef.path));
  const structuralEvidenceRefs = dedupeEvidenceRefs(
    selected.map((candidate) => candidate.evidence)
  );
  const representative = sourceRefs[0] ?? createFallbackSourceRef(snapshot);
  const key = createIDEAgentAnalysisUnitKey({
    sourceRef: sourceRefKey(representative),
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

function collectSourceRefCandidates(snapshot: ProjectSnapshot): SourceRefCandidate[] {
  const candidates: SourceRefCandidate[] = [
    ...collectAstCandidates(snapshot.projectRoot, snapshot.ast),
    ...collectDependencyCandidates(snapshot.projectRoot, snapshot.dependencyGraph),
    ...collectGuardCandidates(snapshot.projectRoot, snapshot.guardAudit),
    ...collectModuleCandidates(snapshot.projectRoot, snapshot.localPackageModules),
    ...collectFileCandidates(snapshot.projectRoot, snapshot.allFiles),
  ];
  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.sourceRef.path.localeCompare(b.sourceRef.path) ||
      (a.sourceRef.symbol ?? '').localeCompare(b.sourceRef.symbol ?? '')
  );
}

function collectAstCandidates(projectRoot: string, ast: AstSummary | null): SourceRefCandidate[] {
  if (!ast) {
    return [];
  }
  const result: SourceRefCandidate[] = [];
  for (const cls of ast.classes ?? []) {
    const ref = sourceRefFromAstClass(projectRoot, cls);
    if (!ref) {
      continue;
    }
    result.push(makeCandidate(ref, 'ast', `class:${ref.fqn ?? ref.symbol ?? ref.path}`, 100));
    for (const method of collectClassMethods(cls).slice(0, 4)) {
      const methodRef = sourceRefFromAstMethod(projectRoot, method, cls);
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
    const ref = sourceRefFromProtocol(projectRoot, protocol);
    if (ref) {
      result.push(makeCandidate(ref, 'ast', `protocol:${ref.fqn ?? ref.symbol ?? ref.path}`, 86));
    }
  }
  return result;
}

function collectDependencyCandidates(
  projectRoot: string,
  dependencyGraph: DependencyGraph | null
): SourceRefCandidate[] {
  return (dependencyGraph?.edges ?? [])
    .map((edge) => sourceRefFromDependencyEdge(projectRoot, edge))
    .filter((candidate): candidate is SourceRefCandidate => Boolean(candidate));
}

function collectGuardCandidates(
  projectRoot: string,
  guardAudit: GuardAudit | null
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
  modules: readonly LocalPackageModule[]
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

function sourceRefFromAstClass(projectRoot: string, cls: AstClassInfo): IDEAgentSourceRef | null {
  return makeSourceRef({
    projectRoot,
    path: cls.relativePath ?? cls.file,
    symbol: cls.name,
    fqn: cls.file || cls.relativePath ? `${cls.file ?? cls.relativePath}::${cls.name}` : cls.name,
    entityType: cls.kind ?? 'class',
    role: 'symbol',
    displayName: cls.name,
  });
}

function sourceRefFromAstMethod(
  projectRoot: string,
  method: AstMethodInfo,
  cls: AstClassInfo
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
  });
}

function sourceRefFromProtocol(
  projectRoot: string,
  protocol: AstProtocolInfo
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
  });
}

function sourceRefFromDependencyEdge(
  projectRoot: string,
  edge: DependencyEdge
): SourceRefCandidate | null {
  const ref = makeSourceRef({
    projectRoot,
    path: pathLike(edge.from) ?? pathLike(edge.to),
    symbol: `${edge.from}->${edge.to}`,
    entityType: 'dependency-edge',
    role: 'dependency',
    displayName: `${edge.from} -> ${edge.to}`,
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
}: {
  projectRoot: string;
  path?: string;
  line?: number;
  symbol?: string;
  fqn?: string;
  entityType?: string;
  role?: IDEAgentSourceRefRole;
  displayName?: string;
}): IDEAgentSourceRef | null {
  const normalizedPath = normalizeProjectPath(path, projectRoot);
  if (!normalizedPath) {
    return null;
  }
  const alias = createShortAlias({ fqn, symbol, sourceRef: normalizedPath });
  return {
    path: normalizedPath,
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
    ...(panorama?.layers ?? []).map(
      (layer) => `L${layer.level} ${layer.name}: ${layer.modules.join(', ')}`
    ),
    ...(panorama?.couplingHotspots ?? []).map(
      (hotspot) => `${hotspot.module} fanIn=${hotspot.fanIn} fanOut=${hotspot.fanOut}`
    ),
    ...(panorama?.cyclicDependencies ?? []).map(
      (cycle) => `${cycle.severity}: ${cycle.cycle.join(' -> ')}`
    ),
  ];
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
  return {
    path: first?.relativePath || first?.path || 'project',
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
  const paths = new Set(sourceRefs.map((ref) => ref.path));
  return files.find((file) => paths.has(file.relativePath || file.path))?.targetName || undefined;
}

function findModuleName(
  sourceRefs: readonly IDEAgentSourceRef[],
  modules: readonly LocalPackageModule[]
): string | undefined {
  const paths = new Set(sourceRefs.map((ref) => ref.path));
  return modules.find((module) => (module.keyFiles ?? []).some((path) => paths.has(path)))?.name;
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
  return `${sourceRef.path}${typeof sourceRef.line === 'number' ? `:${sourceRef.line}` : ''}`;
}

function describeSourceRef(sourceRef: IDEAgentSourceRef): string {
  const line = typeof sourceRef.line === 'number' ? `:${sourceRef.line}` : '';
  const symbol = sourceRef.symbol ? ` ${sourceRef.symbol}` : '';
  return `${sourceRef.path}${line}${symbol}`.trim();
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
      a.path.localeCompare(b.path) ||
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

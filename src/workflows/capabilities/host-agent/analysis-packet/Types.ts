import type {
  ProjectContextEnvelope,
  ProjectContextPresenterInput,
  ProjectContextResult,
} from '../../../../domain/project-context/index.js';
import type {
  DimensionDef,
  ProjectSnapshot,
  ProjectSnapshotInput,
} from '../../../../types/ProjectSnapshot.js';

export type ProjectAnalysisResult = Omit<ProjectSnapshotInput, 'projectRoot'>;

export type HostAgentAnalysisPacketProfile = 'cold-start' | 'rescan';

export type HostAgentSourceRefRole =
  | 'entry'
  | 'caller'
  | 'callee'
  | 'dependency'
  | 'guard'
  | 'example'
  | 'module'
  | 'project-context'
  | 'symbol';

export type HostAgentStructuralEvidenceKind =
  | 'ast'
  | 'callgraph'
  | 'dependency'
  | 'guard'
  | 'panorama'
  | 'target'
  | 'module'
  | 'file'
  | 'project-context';

export type HostAgentAnalysisDegradedReason =
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

export type HostAgentAnalysisUnitStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'skipped';

export interface HostAgentSourceRef {
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
  role?: HostAgentSourceRefRole;
  displayName?: string;
  alias?: string;
}

export interface HostAgentStableUnitKeyInput {
  sourceRef: string;
  folderId?: string;
  projectScopeId?: string;
  qualifiedPath?: string;
  fqn?: string;
  entityType: string;
  line?: number;
  symbol?: string;
}

export interface HostAgentStableUnitKey extends HostAgentStableUnitKeyInput {
  key: string;
  shortAlias?: string;
}

export interface HostAgentStructuralEvidenceRef {
  kind: HostAgentStructuralEvidenceKind;
  ref: string;
  summary: string;
  sourceRefs?: HostAgentSourceRef[];
}

export interface HostAgentDependencyHint {
  from: string;
  to: string;
  relation: string;
}

export interface HostAgentStructuralHints {
  ast?: string[];
  dependencies?: HostAgentDependencyHint[];
  callers?: string[];
  callees?: string[];
  dataFlowHints?: string[];
  guardFindings?: string[];
  panorama?: string[];
  projectContext?: string[];
  aliases?: string[];
}

export interface HostAgentCompletionContract {
  minDistinctFiles: number;
  mustReferenceAssignedSources: boolean;
  expectedEvidence: string[];
  allowNoRecipeWithReason?: boolean;
}

export interface HostAgentAnalysisUnit {
  unitId: string;
  key: HostAgentStableUnitKey;
  dimensionId: string;
  targetName?: string;
  moduleName?: string;
  priority: number;
  reason: string;
  sourceRefs: HostAgentSourceRef[];
  requiredReadSet: string[];
  structuralEvidenceRefs: HostAgentStructuralEvidenceRef[];
  structuralHints: HostAgentStructuralHints;
  completionContract: HostAgentCompletionContract;
  degraded: HostAgentAnalysisDegradedReason[];
  warnings: string[];
}

export interface HostAgentAnalysisUnitCheckpointLink {
  sessionId?: string;
  dimensionId: string;
  checkpointKind: 'dimension-checkpoint' | 'job-result' | 'bootstrap-session';
  updatedAt?: string;
}

export interface HostAgentAnalysisUnitProgress {
  unitId: string;
  status: HostAgentAnalysisUnitStatus;
  claimedAt?: string;
  completedAt?: string;
  submittedRecipeIds: string[];
  referencedFiles: string[];
  rejectedReasons: string[];
  deviationReason?: string;
  checkpoint?: HostAgentAnalysisUnitCheckpointLink;
}

export interface HostAgentAnalysisProgressSeed {
  packetId: string;
  checkpointKind: 'ide-agent-analysis-unit-progress';
  totalUnits: number;
  remainingUnitIds: string[];
  unitProgress: HostAgentAnalysisUnitProgress[];
}

export interface HostAgentAnalysisPacket {
  packetId: string;
  projectRootHash: string;
  generatedAt: string;
  profile: HostAgentAnalysisPacketProfile;
  projectSummary: {
    primaryLanguage: string;
    fileCount: number;
    targetCount: number;
    materialization: Record<string, boolean | number | string>;
    degraded: HostAgentAnalysisDegradedReason[];
    warnings: string[];
  };
  units: HostAgentAnalysisUnit[];
  sourceRefs: HostAgentSourceRef[];
  requiredReadSet: string[];
  structuralEvidenceRefs: HostAgentStructuralEvidenceRef[];
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
  progressSeed: HostAgentAnalysisProgressSeed;
  meta: {
    compressionIndependent: true;
    builder: 'HostAgentAnalysisPacketBuilder';
    source: 'project-context' | 'project-intelligence-result' | 'project-snapshot';
  };
}

export interface HostAgentAnalysisPacketBuilderOptions {
  profile?: HostAgentAnalysisPacketProfile;
  generatedAt?: string;
  maxUnits?: number;
  projectRoot?: string;
}

export interface HostAgentAnalysisPacketBuilderInput {
  result: ProjectAnalysisResult | ProjectSnapshot;
  options?: HostAgentAnalysisPacketBuilderOptions;
}

export interface HostAgentProjectContextPacketInput {
  projectContext:
    | ProjectContextPresenterInput
    | readonly ProjectContextEnvelope<ProjectContextResult>[];
  dimensions?: readonly DimensionDef[];
  options?: HostAgentAnalysisPacketBuilderOptions;
}

// R1 compatibility aliases. Keep old exported type names available while the
// public facade moves to HostAgent* vocabulary.
export type IDEAgentAnalysisPacketProfile = HostAgentAnalysisPacketProfile;
export type IDEAgentSourceRefRole = HostAgentSourceRefRole;
export type IDEAgentStructuralEvidenceKind = HostAgentStructuralEvidenceKind;
export type IDEAgentAnalysisDegradedReason = HostAgentAnalysisDegradedReason;
export type IDEAgentAnalysisUnitStatus = HostAgentAnalysisUnitStatus;
export type IDEAgentSourceRef = HostAgentSourceRef;
export type IDEAgentStableUnitKeyInput = HostAgentStableUnitKeyInput;
export type IDEAgentStableUnitKey = HostAgentStableUnitKey;
export type IDEAgentStructuralEvidenceRef = HostAgentStructuralEvidenceRef;
export type IDEAgentDependencyHint = HostAgentDependencyHint;
export type IDEAgentStructuralHints = HostAgentStructuralHints;
export type IDEAgentCompletionContract = HostAgentCompletionContract;
export type IDEAgentAnalysisUnit = HostAgentAnalysisUnit;
export type IDEAgentAnalysisUnitCheckpointLink = HostAgentAnalysisUnitCheckpointLink;
export type IDEAgentAnalysisUnitProgress = HostAgentAnalysisUnitProgress;
export type IDEAgentAnalysisProgressSeed = HostAgentAnalysisProgressSeed;
export type IDEAgentAnalysisPacket = HostAgentAnalysisPacket;
export type IDEAgentAnalysisPacketBuilderOptions = HostAgentAnalysisPacketBuilderOptions;
export type IDEAgentAnalysisPacketBuilderInput = HostAgentAnalysisPacketBuilderInput;
export type IDEAgentProjectContextPacketInput = HostAgentProjectContextPacketInput;

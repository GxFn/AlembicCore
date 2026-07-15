import type {
  ProjectContextRequestKind,
  ProjectContextScopeInput,
} from '../../../domain/project-context/index.js';

export const CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION = 1 as const;
export const SOURCE_REVISION_VECTOR_VERSION = 1 as const;
export const PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION = 1 as const;
export const PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION = 1 as const;
export const PROJECT_FACTS_CANONICALIZER_VERSION = 'pcf-canonical-json-v1' as const;
export const PROJECT_FACTS_READINESS_VALIDATOR_VERSION = 'pcf-readiness-v1' as const;

export const CERTIFIED_PROJECT_FACTS_CONSUMERS = [
  'plan',
  'recipe-generation',
  'dimension-completion',
  'dependency-graph',
  'module-coverage',
] as const;

export type CertifiedProjectFactsConsumer = (typeof CERTIFIED_PROJECT_FACTS_CONSUMERS)[number];

export type ProjectFactsJsonPrimitive = null | boolean | number | string;
export type ProjectFactsJson =
  | ProjectFactsJsonPrimitive
  | ProjectFactsJson[]
  | { [key: string]: ProjectFactsJson };

export type CanonicalSha256 = `sha256:${string}`;
export type CertifiedProjectFactsArtifactId = `cpf-v1:${string}`;

export interface GitCleanSourceRevisionV1 {
  kind: 'git-clean';
  commitId: string;
  treeId: string;
}

export interface GitDirtySourceRevisionV1 {
  kind: 'git-dirty';
  commitId: string | null;
  treeId: string | null;
  workingTreeContentHash: CanonicalSha256;
}

export interface ContentSourceRevisionV1 {
  kind: 'content';
  workingTreeContentHash: CanonicalSha256;
}

export type SourceRevisionV1 =
  | GitCleanSourceRevisionV1
  | GitDirtySourceRevisionV1
  | ContentSourceRevisionV1;

export interface SourceRevisionVectorEntryV1 {
  scopeId: string;
  repoId: string;
  relativeRoot: string;
  revision: SourceRevisionV1;
  eligibleInventoryHash: CanonicalSha256;
  includeExcludePolicyHash: CanonicalSha256;
}

export interface SourceRevisionVectorV1 {
  kind: 'SourceRevisionVectorV1';
  version: typeof SOURCE_REVISION_VECTOR_VERSION;
  entries: SourceRevisionVectorEntryV1[];
  sourceVectorHash: CanonicalSha256;
}

export interface ProjectContextInventoryPolicyV1 {
  version: string;
  includeExtensions: string[];
  excludeDirectories: string[];
  excludeRelativePaths?: string[];
}

export interface ProjectContextDetailPolicyV1 {
  maxSelectedFiles: number;
  maxPreviewBytes: number;
  chunkBytes: number;
  selectedFiles?: Array<{ repoId: string; relativePath: string }>;
}

export interface ProjectContextFoundationRepositoryInput {
  scopeId: string;
  repoId: string;
  relativeRoot: string;
  /** 仅用于当前进程的 host port；绝不进入 artifact 或 semantic hash。 */
  sourceRoot: string;
}

export interface ProjectContextFoundationFileDescriptor {
  relativePath: string;
  language: string;
  mode: string;
  ownerModuleIds?: string[];
}

export type ProjectContextRepositoryRevisionObservation =
  | {
      kind: 'git';
      dirty: boolean;
      commitId: string | null;
      treeId: string | null;
    }
  | { kind: 'content' };

export type ProjectContextSnapshotBindingV1 = 'git-tree' | 'working-tree-content';

export interface ProjectContextSnapshotCandidateFileV1 {
  readonly file: Readonly<ProjectFactsInventoryFileV1>;
  readonly content: Uint8Array;
}

export interface ProjectContextSnapshotCandidateV1 {
  readonly version: typeof PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION;
  readonly preRevision: Readonly<ProjectContextRepositoryRevisionObservation>;
  readonly postRevision: Readonly<ProjectContextRepositoryRevisionObservation>;
  readonly files: readonly ProjectContextSnapshotCandidateFileV1[];
  readonly eligibleInventoryHash: CanonicalSha256;
  readonly workingTreeContentHash: CanonicalSha256;
}

export interface ProjectContextSnapshotVerificationV1 {
  version: typeof PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION;
  verified: boolean;
  binding: ProjectContextSnapshotBindingV1;
  finalRevision: ProjectContextRepositoryRevisionObservation;
  eligibleInventoryHash: CanonicalSha256;
  workingTreeContentHash: CanonicalSha256;
  treeId?: string;
  /** Host observed Git clean at the terminal fence but eligible policy includes stable tree-external bytes. */
  cleanObservationContentPromotion?: true;
  typedReason: string;
}

export type ProjectContextDependencyOwnershipSourceV1 =
  | 'package-name'
  | 'package-export'
  | 'package-import'
  | 'module-alias';

export interface ProjectContextDependencyOwnershipEntryV1 {
  repoId: string;
  ownerModuleId: string;
  ownerPackageName?: string;
  source: ProjectContextDependencyOwnershipSourceV1;
  pattern: string;
  /** Canonical repository-relative targets declared by package import metadata. */
  targetPatterns?: string[];
  provenance: {
    relativePath: string;
    contentHash: CanonicalSha256;
  };
}

export interface ProjectContextDependencyOwnershipV1 {
  version: typeof PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION;
  entries: ProjectContextDependencyOwnershipEntryV1[];
  ownershipHash: CanonicalSha256;
}

export type ProjectContextDependencyResolutionClassificationV1 =
  | 'internal-resolved'
  | 'approved-sibling'
  | 'expected-external'
  | 'confirmed-defect';

export interface ProjectContextDependencyResolutionV1 {
  dependencyName: string;
  importerRepoId: string;
  requestKind: ProjectContextRequestKind;
  classification: ProjectContextDependencyResolutionClassificationV1;
  typedReason: string;
  ownerRepoId?: string;
  ownerModuleId?: string;
  ownerPackageName?: string;
  ownershipSource?: ProjectContextDependencyOwnershipSourceV1;
  matchedOwnershipKey?: string;
  ownershipEvidenceHash?: CanonicalSha256;
  ownershipProvenancePath?: string;
  resolvedTargets?: Array<{
    relativePath: string;
    blobSha256?: CanonicalSha256;
  }>;
}

export interface ProjectContextDependencyGraphReconciliationV1 {
  originalExternalHotspotCount: number;
  internalResolvedHotspotCount: number;
  approvedSiblingHotspotCount: number;
  remainingExternalHotspotCount: number;
  originalExternalDependencyNames?: string[];
  internalResolvedDependencyNames?: string[];
  approvedSiblingDependencyNames?: string[];
  remainingExternalDependencyNames?: string[];
}

export type ProjectContextRequestApplicability = 'applicable' | 'not-applicable';

export interface ProjectContextRequestAuditPlan {
  repoId: string;
  kind: ProjectContextRequestKind;
  applicability: ProjectContextRequestApplicability;
  typedReason?: string;
  selector: ProjectFactsJson;
  scope: Omit<ProjectContextScopeInput, 'projectRoot'>;
}

export type ProjectContextRequestTerminalStatus =
  | 'completed'
  | 'not-applicable'
  | 'cancelled'
  | 'timed-out'
  | 'failed'
  | 'unavailable';

export type ProjectContextParserReadiness = 'ready' | 'not-required' | 'unavailable';

export type ProjectContextRequestDiagnosticClassification =
  | 'expected-external'
  | 'advisory'
  | 'confirmed-defect';

export interface ProjectContextRequestDiagnosticV1 {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  retryable: boolean;
  classification: ProjectContextRequestDiagnosticClassification;
  typedReason: string;
  path?: string;
  relatedRepoId?: string;
}

export interface ProjectContextSourceRangeV1 {
  repoId: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}

export interface ProjectContextRequestExecutionResult {
  terminalStatus: Exclude<ProjectContextRequestTerminalStatus, 'not-applicable'>;
  output: unknown;
  detectedLanguage?: string;
  parserRuntime: ProjectContextParserReadiness;
  queryInitialization: ProjectContextParserReadiness;
  continuation?: string;
  sourceRanges?: ProjectContextSourceRangeV1[];
  errors?: ProjectContextRequestDiagnosticV1[];
  dependencyResolutions?: ProjectContextDependencyResolutionV1[];
  dependencyObservationCount?: number;
  dependencyGraphReconciliation?: ProjectContextDependencyGraphReconciliationV1;
}

export interface ProjectContextRequestOutcomeV1 {
  repoId: string;
  kind: ProjectContextRequestKind;
  applicability: ProjectContextRequestApplicability;
  typedReason?: string;
  selector: ProjectFactsJson;
  scope: ProjectFactsJson;
  detectedLanguage?: string;
  parserRuntime: ProjectContextParserReadiness;
  queryInitialization: ProjectContextParserReadiness;
  terminalStatus: ProjectContextRequestTerminalStatus;
  continuation?: string;
  output: ProjectFactsJson;
  outputHash: CanonicalSha256;
  sourceRanges: ProjectContextSourceRangeV1[];
  errors: ProjectContextRequestDiagnosticV1[];
  /** Additive V1 ownership evidence; absent on artifacts created before the ownership extension. */
  dependencyResolutions?: ProjectContextDependencyResolutionV1[];
  dependencyObservationCount?: number;
  dependencyGraphReconciliation?: ProjectContextDependencyGraphReconciliationV1;
}

export interface ProjectContextLegacyEntryAuditRowV1 {
  entryId: string;
  entrypoint: string;
  reachability: 'unreachable' | 'artifact-only-adapter';
  typedReason: string;
  directProjectContextCallCount: number;
  rawFilesystemFallbackCount: number;
  synthesizedProjectScopeFactCount: number;
}

export interface ProjectContextCertificationInputV1 {
  scopeIdentityHash: CanonicalSha256;
  capabilityHash: CanonicalSha256;
  parserHash: CanonicalSha256;
  acceptedRuntimeHash: CanonicalSha256;
  acceptedConfigHash: CanonicalSha256;
}

export type CertifiedProjectFactsProjectionInputs = Record<CertifiedProjectFactsConsumer, unknown>;

export interface ProjectContextFoundationCaptureInput {
  projectMode: string;
  repositories: ProjectContextFoundationRepositoryInput[];
  inventoryPolicy: ProjectContextInventoryPolicyV1;
  detailPolicy: ProjectContextDetailPolicyV1;
  requestPlans: ProjectContextRequestAuditPlan[];
  legacyEntries: ProjectContextLegacyEntryAuditRowV1[];
  projections: CertifiedProjectFactsProjectionInputs;
  certification: ProjectContextCertificationInputV1;
  signal?: AbortSignal;
}

export interface ProjectContextFoundationHostPorts {
  observeRevision(input: {
    repository: ProjectContextFoundationRepositoryInput;
    signal?: AbortSignal;
  }): Promise<ProjectContextRepositoryRevisionObservation>;
  enumerateEligibleFiles(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    signal?: AbortSignal;
  }): Promise<ProjectContextFoundationFileDescriptor[]>;
  readFile(input: {
    repository: ProjectContextFoundationRepositoryInput;
    relativePath: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array>;
  /**
   * Versioned terminal snapshot fence. Git observations require this verifier;
   * older host objects remain structurally compatible but fail closed when they
   * attempt to certify a Git revision without binding the captured bytes.
   */
  verifySnapshot?(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    candidate: ProjectContextSnapshotCandidateV1;
    signal?: AbortSignal;
  }): Promise<ProjectContextSnapshotVerificationV1>;
  executeRequest(input: {
    repository: ProjectContextFoundationRepositoryInput;
    plan: ProjectContextRequestAuditPlan;
    signal?: AbortSignal;
  }): Promise<ProjectContextRequestExecutionResult>;
}

export interface ProjectFactsInventoryFileV1 {
  repoId: string;
  relativePath: string;
  language: string;
  mode: string;
  sizeBytes: number;
  blobSha256: CanonicalSha256;
  ownerModuleIds: string[];
}

export interface ProjectFactsInventoryRepositoryV1 {
  scopeId: string;
  repoId: string;
  relativeRoot: string;
  fileCount: number;
  eligibleInventoryHash: CanonicalSha256;
}

export interface ProjectFactsInventoryPlaneV1 {
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  includeExcludePolicy: ProjectContextInventoryPolicyV1;
  includeExcludePolicyHash: CanonicalSha256;
  repositories: ProjectFactsInventoryRepositoryV1[];
  files: ProjectFactsInventoryFileV1[];
  fileCount: number;
  inventoryContentHash: CanonicalSha256;
}

export interface ProjectFactsDetailDecisionV1 {
  repoId: string;
  relativePath: string;
  status: 'selected' | 'omitted';
  reason: 'selected-by-policy' | 'detail-file-cap';
}

export interface ProjectFactsDetailSelectionV1 {
  repoId: string;
  relativePath: string;
  previewBase64: string;
  previewByteLength: number;
  previewTruncated: boolean;
  fullContentHash: CanonicalSha256;
  fullChunkRefs: CanonicalSha256[];
}

export interface ProjectFactsDetailPlaneV1 {
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  policy: ProjectContextDetailPolicyV1;
  decisions: ProjectFactsDetailDecisionV1[];
  selections: ProjectFactsDetailSelectionV1[];
  selectedFileCount: number;
  omittedFileCount: number;
  continuation?: `pcf-detail-v1:${string}`;
  detailContentHash: CanonicalSha256;
}

export interface CertifiedProjectFactsChunkV1 {
  blobHash: CanonicalSha256;
  byteLength: number;
  dataBase64: string;
}

export interface CertifiedProjectFactsProjectionV1 {
  payload: ProjectFactsJson;
  projectionContentHash: CanonicalSha256;
}

export interface CertifiedProjectFactsV1 {
  inventory: ProjectFactsInventoryPlaneV1;
  detail: ProjectFactsDetailPlaneV1;
  requestOutcomes: ProjectContextRequestOutcomeV1[];
  legacyEntries: ProjectContextLegacyEntryAuditRowV1[];
}

export interface CertifiedProjectFactsManifestV1 {
  kind: 'CertifiedProjectFactsManifest';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  canonicalizerVersion: typeof PROJECT_FACTS_CANONICALIZER_VERSION;
  projectMode: string;
  factsContentHash: CanonicalSha256;
  sourceRevisionVector: SourceRevisionVectorV1;
  sourceVectorHash: CanonicalSha256;
  inventoryManifestHash: CanonicalSha256;
  detailManifestHash: CanonicalSha256;
  fullChunkManifestHash: CanonicalSha256;
  legacyEntryInventoryHash: CanonicalSha256;
  requestEnvelopeIndex: Array<{
    repoId: string;
    kind: ProjectContextRequestKind;
    applicability: ProjectContextRequestApplicability;
    terminalStatus: ProjectContextRequestTerminalStatus;
    outputHash: CanonicalSha256;
  }>;
  projectionContentHashes: Record<CertifiedProjectFactsConsumer, CanonicalSha256>;
  blobTable: Array<{ blobHash: CanonicalSha256; byteLength: number }>;
}

export interface CertifiedProjectFactsReadinessSummaryV1 {
  validatorVersion: typeof PROJECT_FACTS_READINESS_VALIDATOR_VERSION;
  verdict: 'passed' | 'failed';
  errors: string[];
  errorsHash: CanonicalSha256;
}

export interface CertifiedProjectFactsArtifactV1 {
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  sourceVectorHash: CanonicalSha256;
  factsContentHash: CanonicalSha256;
  certificationBindingHash: CanonicalSha256;
  certification: ProjectContextCertificationInputV1;
  readiness: CertifiedProjectFactsReadinessSummaryV1;
  manifest: CertifiedProjectFactsManifestV1;
  facts: CertifiedProjectFactsV1;
  projections: Record<CertifiedProjectFactsConsumer, CertifiedProjectFactsProjectionV1>;
  chunks: CertifiedProjectFactsChunkV1[];
}

export interface CertifiedProjectFactsCertificationReceiptV1 {
  kind: 'CertifiedProjectFactsCertificationReceipt';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  sourceVectorHash: CanonicalSha256;
  factsContentHash: CanonicalSha256;
  manifestHash: CanonicalSha256;
  inventoryContentHash: CanonicalSha256;
  includeExcludePolicyHash: CanonicalSha256;
  detailContentHash: CanonicalSha256;
  requestOutcomesHash: CanonicalSha256;
  projectionContentHashes: Record<CertifiedProjectFactsConsumer, CanonicalSha256>;
  certification: ProjectContextCertificationInputV1;
  readiness: CertifiedProjectFactsReadinessSummaryV1;
  certificationBindingHash: CanonicalSha256;
  receiptHash: CanonicalSha256;
}

export interface ProjectContextConsumerLineageRowV1 {
  consumer: CertifiedProjectFactsConsumer;
  entrypoint: string;
  artifactId: CertifiedProjectFactsArtifactId;
  sourceVectorHash: CanonicalSha256;
  projectionContentHash: CanonicalSha256;
  sessionReloadStatus: 'passed' | 'not-applicable';
  directProjectContextCallCount: number;
  rawFilesystemFallbackCount: number;
  synthesizedProjectScopeFactCount: number;
  verdict: 'passed' | 'failed';
}

export type ProjectContextConsumerLineageRowInputV1 = Omit<
  ProjectContextConsumerLineageRowV1,
  'artifactId' | 'sourceVectorHash'
>;

export interface ProjectContextConsumerLineageReceiptV1 {
  kind: 'ProjectContextConsumerLineageReceipt';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  sourceVectorHash: CanonicalSha256;
  rows: ProjectContextConsumerLineageRowV1[];
  receiptHash: CanonicalSha256;
}

export interface CertifiedProjectFactsReadinessResult {
  ok: boolean;
  errors: string[];
}

export interface CertifiedProjectFactsStoreReceiptV1 {
  kind: 'CertifiedProjectFactsStoreReceipt';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  certificationBindingHash: CanonicalSha256;
  artifactRef: string;
  certificationReceiptRef: string;
  manifestHash: CanonicalSha256;
  blobRefs: string[];
  receiptHash: CanonicalSha256;
}

export interface CertifiedProjectFactsPreparationReceiptV1 {
  kind: 'CertifiedProjectFactsPreparationReceipt';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  certificationBindingHash: CanonicalSha256;
  preparationId: `prep-v1:${string}`;
  preparationRef: string;
  receiptHash: CanonicalSha256;
}

export interface CertifiedProjectFactsRunLeaseReceiptV1 {
  kind: 'CertifiedProjectFactsRunLeaseReceipt';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  certificationBindingHash: CanonicalSha256;
  preparationId: `prep-v1:${string}`;
  runId: string;
  leaseRef: string;
  status: 'acquired' | 'resumed' | 'completed';
  receiptHash: CanonicalSha256;
}

export interface ProjectContextFoundationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface CertifiedProjectFactsConsumerBindingV1 {
  artifactId: CertifiedProjectFactsArtifactId;
  sourceVectorHash: CanonicalSha256;
  factsContentHash: CanonicalSha256;
  certificationBindingHash: CanonicalSha256;
  consumer: CertifiedProjectFactsConsumer;
  projectionContentHash: CanonicalSha256;
  payload: ProjectFactsJson;
  lease: CertifiedProjectFactsRunLeaseReceiptV1;
}

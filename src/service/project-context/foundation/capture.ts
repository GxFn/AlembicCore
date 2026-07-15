import path from 'node:path';
import { PROJECT_CONTEXT_REQUEST_KIND_VALUES } from '../../../domain/project-context/index.js';
import {
  buildSourceRevisionVectorV1,
  canonicalHashDigest,
  hashBytes,
  hashCanonicalJson,
  normalizePortableRelativePath,
  toProjectFactsJson,
} from './canonical.js';
import {
  type CanonicalSha256,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
  type CertifiedProjectFactsArtifactV1,
  type CertifiedProjectFactsCertificationReceiptV1,
  type CertifiedProjectFactsChunkV1,
  type CertifiedProjectFactsConsumer,
  type CertifiedProjectFactsManifestV1,
  type CertifiedProjectFactsProjectionV1,
  PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION,
  PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
  PROJECT_FACTS_CANONICALIZER_VERSION,
  PROJECT_FACTS_READINESS_VALIDATOR_VERSION,
  type ProjectContextDependencyResolutionV1,
  type ProjectContextFoundationCaptureInput,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextFoundationHostPorts,
  type ProjectContextFoundationRepositoryInput,
  type ProjectContextRepositoryRevisionObservation,
  type ProjectContextRequestAuditPlan,
  type ProjectContextRequestDiagnosticV1,
  type ProjectContextRequestOutcomeV1,
  type ProjectContextSnapshotVerificationV1,
  type ProjectFactsDetailDecisionV1,
  type ProjectFactsDetailPlaneV1,
  type ProjectFactsDetailSelectionV1,
  type ProjectFactsInventoryFileV1,
  type ProjectFactsInventoryPlaneV1,
  type ProjectFactsInventoryRepositoryV1,
  type ProjectFactsJson,
  type SourceRevisionVectorEntryV1,
} from './contracts.js';

interface CapturedRepository {
  input: ProjectContextFoundationRepositoryInput;
  descriptors: ProjectContextFoundationFileDescriptor[];
  files: ProjectFactsInventoryFileV1[];
  contents: Map<string, Uint8Array>;
  eligibleInventoryHash: CanonicalSha256;
  workingTreeContentHash: CanonicalSha256;
  revisionEntry: SourceRevisionVectorEntryV1;
}

export class ProjectContextSourceStateDriftError extends Error {
  readonly code = 'PROJECT_CONTEXT_SOURCE_STATE_DRIFT';
  readonly retryable = true;

  constructor(repoId: string, cause?: unknown) {
    super(
      `Source state changed during certified capture for ${repoId}; discard this attempt and retry from a new capture.`,
      cause === undefined ? undefined : { cause }
    );
    this.name = 'ProjectContextSourceStateDriftError';
  }
}

export class ProjectContextInventoryOverlapError extends TypeError {
  readonly code = 'PROJECT_CONTEXT_INVENTORY_OVERLAP';
  readonly retryable = false;

  constructor(scopeId: string, projectRelativePath: string, repoIds: readonly string[]) {
    super(
      `Certified inventory assigns ${scopeId}:${projectRelativePath} to multiple repositories: ${[
        ...repoIds,
      ]
        .sort()
        .join(',')}.`
    );
    this.name = 'ProjectContextInventoryOverlapError';
  }
}

export async function captureCertifiedProjectFacts(
  input: ProjectContextFoundationCaptureInput,
  ports: ProjectContextFoundationHostPorts
): Promise<CertifiedProjectFactsArtifactV1> {
  validateCaptureInput(input);
  const includeExcludePolicy = normalizeInventoryPolicy(input.inventoryPolicy);
  const includeExcludePolicyHash = hashCanonicalJson(includeExcludePolicy);
  const repositories = await captureRepositories(
    { ...input, inventoryPolicy: includeExcludePolicy },
    ports,
    includeExcludePolicyHash
  );
  assertNoCrossRepositoryInventoryOverlap(repositories);
  const inventory = buildInventoryPlane(
    repositories,
    includeExcludePolicy,
    includeExcludePolicyHash
  );
  const { detail, chunks } = buildDetailPlane(repositories, input.detailPolicy);
  const requestOutcomes = await captureRequestOutcomes(input, repositories, ports);
  await assertSourceStateStable(
    { ...input, inventoryPolicy: includeExcludePolicy },
    ports,
    includeExcludePolicyHash,
    repositories
  );
  assertPortableSemanticJson(toProjectFactsJson(requestOutcomes), 'request outcomes');
  const legacyEntries = [...input.legacyEntries].sort((left, right) =>
    left.entryId.localeCompare(right.entryId)
  );
  const facts = {
    inventory,
    detail,
    requestOutcomes,
    legacyEntries,
  };
  const factsContentHash = hashCanonicalJson(facts);
  const readiness = buildCaptureReadinessSummary(
    facts,
    repositories.map((repository) => repository.input.repoId),
    chunks
  );
  const projections = buildProjections(input.projections);
  const sourceRevisionVector = buildSourceRevisionVectorV1(
    repositories.map((repository) => repository.revisionEntry)
  );
  const manifest = buildManifest({
    chunks,
    detail,
    factsContentHash,
    inventory,
    legacyEntries,
    projectMode: input.projectMode,
    projections,
    requestOutcomes,
    sourceRevisionVector,
  });
  const artifactId = `cpf-v1:${canonicalHashDigest(hashCanonicalJson(manifest))}` as const;
  const certificationBindingHash = hashCanonicalJson({
    artifactId,
    factsContentHash,
    sourceVectorHash: sourceRevisionVector.sourceVectorHash,
    readiness,
    ...input.certification,
  });
  const artifact: CertifiedProjectFactsArtifactV1 = {
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    artifactId,
    sourceVectorHash: sourceRevisionVector.sourceVectorHash,
    factsContentHash,
    certificationBindingHash,
    certification: { ...input.certification },
    readiness,
    manifest,
    facts,
    projections,
    chunks,
  };
  verifyCertifiedProjectFactsArtifact(artifact);
  return artifact;
}

async function assertSourceStateStable(
  input: ProjectContextFoundationCaptureInput,
  ports: ProjectContextFoundationHostPorts,
  includeExcludePolicyHash: CanonicalSha256,
  captured: CapturedRepository[]
): Promise<void> {
  let verified: CapturedRepository[];
  try {
    verified = await captureRepositories(input, ports, includeExcludePolicyHash);
  } catch (error) {
    if (isAbortLike(error, input.signal)) {
      throw error;
    }
    if (error instanceof ProjectContextSourceStateDriftError) {
      throw error;
    }
    const repoId = captured.find((repository) =>
      error instanceof Error ? error.message.includes(repository.input.sourceRoot) : false
    )?.input.repoId;
    throw new ProjectContextSourceStateDriftError(repoId ?? 'captured repository', error);
  }
  for (const expected of captured) {
    const actual = verified.find((repository) => repository.input.repoId === expected.input.repoId);
    if (
      !actual ||
      hashCanonicalJson({ files: actual.files, revision: actual.revisionEntry }) !==
        hashCanonicalJson({ files: expected.files, revision: expected.revisionEntry })
    ) {
      throw new ProjectContextSourceStateDriftError(expected.input.repoId);
    }
  }
}

function assertNoCrossRepositoryInventoryOverlap(
  repositories: readonly CapturedRepository[]
): void {
  const ownersByProjectPath = new Map<
    string,
    { path: string; repoIds: Set<string>; scopeId: string }
  >();
  for (const repository of repositories) {
    const relativeRoot = normalizePortableRelativePath(
      repository.input.relativeRoot,
      'relativeRoot'
    );
    for (const file of repository.files) {
      const projectRelativePath =
        relativeRoot === '.' ? file.relativePath : `${relativeRoot}/${file.relativePath}`;
      const key = `${repository.input.scopeId}\u0000${projectRelativePath}`;
      const owners = ownersByProjectPath.get(key) ?? {
        path: projectRelativePath,
        repoIds: new Set<string>(),
        scopeId: repository.input.scopeId,
      };
      owners.repoIds.add(repository.input.repoId);
      ownersByProjectPath.set(key, owners);
    }
  }
  for (const owners of ownersByProjectPath.values()) {
    if (owners.repoIds.size > 1) {
      throw new ProjectContextInventoryOverlapError(owners.scopeId, owners.path, [
        ...owners.repoIds,
      ]);
    }
  }
}

export function verifyCertifiedProjectFactsArtifact(
  artifact: CertifiedProjectFactsArtifactV1
): void {
  if (artifact.schemaVersion !== CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported certified facts schema: ${artifact.schemaVersion}.`);
  }
  const expectedArtifactId = `cpf-v1:${canonicalHashDigest(hashCanonicalJson(artifact.manifest))}`;
  if (artifact.artifactId !== expectedArtifactId) {
    throw new TypeError('Certified facts artifactId does not match its canonical manifest.');
  }
  if (artifact.sourceVectorHash !== artifact.manifest.sourceVectorHash) {
    throw new TypeError('Certified facts sourceVectorHash does not match its manifest.');
  }
  if (artifact.factsContentHash !== artifact.manifest.factsContentHash) {
    throw new TypeError('Certified facts content hash does not match its manifest.');
  }
  const rebuiltVector = buildSourceRevisionVectorV1(artifact.manifest.sourceRevisionVector.entries);
  if (rebuiltVector.sourceVectorHash !== artifact.sourceVectorHash) {
    throw new TypeError('Certified facts SourceRevisionVectorV1 is not canonical.');
  }
  if (hashCanonicalJson(artifact.facts) !== artifact.factsContentHash) {
    throw new TypeError('Certified facts content hash does not match the facts payload.');
  }
  if (
    hashCanonicalJson(artifact.facts.inventory) !== artifact.manifest.inventoryManifestHash ||
    hashCanonicalJson(artifact.facts.detail) !== artifact.manifest.detailManifestHash ||
    hashCanonicalJson(artifact.facts.legacyEntries) !== artifact.manifest.legacyEntryInventoryHash
  ) {
    throw new TypeError('Certified facts plane hash does not match its manifest.');
  }
  const requestEnvelopeIndex = artifact.facts.requestOutcomes.map((outcome) => ({
    repoId: outcome.repoId,
    kind: outcome.kind,
    applicability: outcome.applicability,
    terminalStatus: outcome.terminalStatus,
    outputHash: outcome.outputHash,
  }));
  if (
    hashCanonicalJson(requestEnvelopeIndex) !==
    hashCanonicalJson(artifact.manifest.requestEnvelopeIndex)
  ) {
    throw new TypeError('Certified request envelope index does not match its manifest.');
  }
  const expectedReadiness = buildCaptureReadinessSummary(
    artifact.facts,
    artifact.manifest.sourceRevisionVector.entries.map((entry) => entry.repoId),
    artifact.chunks
  );
  if (hashCanonicalJson(expectedReadiness) !== hashCanonicalJson(artifact.readiness)) {
    throw new TypeError('Certified facts readiness summary is not reproducible.');
  }
  const expectedBinding = hashCanonicalJson({
    artifactId: artifact.artifactId,
    factsContentHash: artifact.factsContentHash,
    sourceVectorHash: artifact.sourceVectorHash,
    readiness: artifact.readiness,
    ...artifact.certification,
  });
  if (expectedBinding !== artifact.certificationBindingHash) {
    throw new TypeError('Certified facts binding hash does not match its accepted inputs.');
  }
  const chunksByHash = new Map<CanonicalSha256, Uint8Array>();
  const chunkTable = artifact.chunks
    .map((chunk) => {
      const bytes = Buffer.from(chunk.dataBase64, 'base64');
      if (bytes.byteLength !== chunk.byteLength || hashBytes(bytes) !== chunk.blobHash) {
        throw new TypeError(`Certified facts full chunk is corrupt: ${chunk.blobHash}.`);
      }
      const previous = chunksByHash.get(chunk.blobHash);
      if (previous && !Buffer.from(previous).equals(bytes)) {
        throw new TypeError('Certified facts chunk hash is duplicated with different bytes.');
      }
      chunksByHash.set(chunk.blobHash, bytes);
      return { blobHash: chunk.blobHash, byteLength: chunk.byteLength };
    })
    .sort((left, right) => left.blobHash.localeCompare(right.blobHash));
  if (hashCanonicalJson(chunkTable) !== artifact.manifest.fullChunkManifestHash) {
    throw new TypeError('Certified facts full chunk table does not match its manifest hash.');
  }
  for (const selection of artifact.facts.detail.selections) {
    const inventoryFile = artifact.facts.inventory.files.find(
      (file) => file.repoId === selection.repoId && file.relativePath === selection.relativePath
    );
    if (!inventoryFile) {
      throw new TypeError(
        `Certified detail selection is outside inventory: ${selection.repoId}/${selection.relativePath}.`
      );
    }
    const fullContent = Buffer.concat(
      selection.fullChunkRefs.map((chunkRef) => {
        const chunk = chunksByHash.get(chunkRef);
        if (!chunk) {
          throw new TypeError(
            `Certified detail selection references a missing chunk: ${chunkRef}.`
          );
        }
        return Buffer.from(chunk);
      })
    );
    if (
      hashBytes(fullContent) !== selection.fullContentHash ||
      selection.fullContentHash !== inventoryFile.blobSha256 ||
      fullContent.byteLength !== inventoryFile.sizeBytes
    ) {
      throw new TypeError(
        `Certified detail content does not match inventory: ${selection.repoId}/${selection.relativePath}.`
      );
    }
    const preview = Buffer.from(selection.previewBase64, 'base64');
    const expectedPreviewLength = Math.min(
      fullContent.byteLength,
      artifact.facts.detail.policy.maxPreviewBytes
    );
    if (
      preview.byteLength !== selection.previewByteLength ||
      preview.byteLength !== expectedPreviewLength ||
      !preview.equals(fullContent.subarray(0, expectedPreviewLength)) ||
      selection.previewTruncated !== expectedPreviewLength < fullContent.byteLength
    ) {
      throw new TypeError(
        `Certified detail preview does not match full content: ${selection.repoId}/${selection.relativePath}.`
      );
    }
  }
  for (const consumer of CERTIFIED_PROJECT_FACTS_CONSUMERS) {
    const projection = artifact.projections[consumer];
    assertProjectionPayloadIsLineageFree(projection.payload, consumer);
    if (hashCanonicalJson(projection.payload) !== projection.projectionContentHash) {
      throw new TypeError(`Projection payload hash mismatch for ${consumer}.`);
    }
    if (projection.projectionContentHash !== artifact.manifest.projectionContentHashes[consumer]) {
      throw new TypeError(`Projection manifest hash mismatch for ${consumer}.`);
    }
  }
}

export function createCertifiedProjectFactsCertificationReceipt(
  artifact: CertifiedProjectFactsArtifactV1
): CertifiedProjectFactsCertificationReceiptV1 {
  verifyCertifiedProjectFactsArtifact(artifact);
  const semantic = {
    kind: 'CertifiedProjectFactsCertificationReceipt' as const,
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    artifactId: artifact.artifactId,
    sourceVectorHash: artifact.sourceVectorHash,
    factsContentHash: artifact.factsContentHash,
    manifestHash: hashCanonicalJson(artifact.manifest),
    inventoryContentHash: artifact.facts.inventory.inventoryContentHash,
    includeExcludePolicyHash: artifact.facts.inventory.includeExcludePolicyHash,
    detailContentHash: artifact.facts.detail.detailContentHash,
    requestOutcomesHash: hashCanonicalJson(artifact.facts.requestOutcomes),
    projectionContentHashes: artifact.manifest.projectionContentHashes,
    certification: artifact.certification,
    readiness: artifact.readiness,
    certificationBindingHash: artifact.certificationBindingHash,
  };
  return { ...semantic, receiptHash: hashCanonicalJson(semantic) };
}

function validateCaptureInput(input: ProjectContextFoundationCaptureInput): void {
  if (!input.projectMode.trim() || input.projectMode !== input.projectMode.trim()) {
    throw new TypeError('projectMode is required.');
  }
  if (input.repositories.length === 0) {
    throw new TypeError('At least one repository is required for certified capture.');
  }
  const repoIds = new Set<string>();
  for (const repository of input.repositories) {
    requireExactIdentifier(repository.scopeId, 'scopeId');
    requireExactIdentifier(repository.repoId, 'repoId');
    if (repoIds.has(repository.repoId)) {
      throw new TypeError(`Duplicate capture repository: ${repository.repoId}.`);
    }
    repoIds.add(repository.repoId);
    if (
      normalizePortableRelativePath(repository.relativeRoot, 'relativeRoot') !==
      repository.relativeRoot
    ) {
      throw new TypeError(`relativeRoot must already be canonical: ${repository.repoId}.`);
    }
    if (!path.isAbsolute(repository.sourceRoot)) {
      throw new TypeError(`sourceRoot must be absolute for host access: ${repository.repoId}.`);
    }
  }
  for (const plan of input.requestPlans) {
    if (!repoIds.has(plan.repoId)) {
      throw new TypeError(`Request plan references an unknown repository: ${plan.repoId}.`);
    }
    if (plan.applicability === 'not-applicable' && !plan.typedReason?.trim()) {
      throw new TypeError(`Typed N/A reason is required for ${plan.repoId}/${plan.kind}.`);
    }
  }
  if (!input.inventoryPolicy.version.trim()) {
    throw new TypeError('inventoryPolicy.version is required.');
  }
  for (const value of Object.values(input.certification)) {
    canonicalHashDigest(value);
  }
  normalizePositiveInteger(input.detailPolicy.maxSelectedFiles, 'maxSelectedFiles');
  normalizePositiveInteger(input.detailPolicy.maxPreviewBytes, 'maxPreviewBytes');
  normalizePositiveInteger(input.detailPolicy.chunkBytes, 'chunkBytes');
}

function requireExactIdentifier(value: string, fieldName: string): void {
  if (!value || value !== value.trim() || /[\\/]/.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical stable identifier.`);
  }
}

function normalizeInventoryPolicy(
  policy: ProjectContextFoundationCaptureInput['inventoryPolicy']
): ProjectContextFoundationCaptureInput['inventoryPolicy'] {
  const includeExtensions = uniqueStrings(
    policy.includeExtensions.map((extension) =>
      extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
    )
  );
  const excludeDirectories = uniqueStrings(
    policy.excludeDirectories.map((directory) =>
      normalizePortableRelativePath(directory, 'excludeDirectories')
    )
  );
  const excludeRelativePaths = uniqueStrings(
    (policy.excludeRelativePaths ?? []).map((relativePath) =>
      normalizePortableRelativePath(relativePath, 'excludeRelativePaths')
    )
  );
  return {
    version: policy.version.trim(),
    includeExtensions,
    excludeDirectories,
    ...(excludeRelativePaths.length > 0 ? { excludeRelativePaths } : {}),
  };
}

async function captureRepositories(
  input: ProjectContextFoundationCaptureInput,
  ports: ProjectContextFoundationHostPorts,
  includeExcludePolicyHash: CanonicalSha256
): Promise<CapturedRepository[]> {
  const result: CapturedRepository[] = [];
  for (const repository of [...input.repositories].sort(compareRepositories)) {
    throwIfAborted(input.signal);
    const preRevision = await ports.observeRevision({ repository, signal: input.signal });
    throwIfAborted(input.signal);
    const descriptors = await ports.enumerateEligibleFiles({
      repository,
      policy: input.inventoryPolicy,
      signal: input.signal,
    });
    const normalizedDescriptors = normalizeFileDescriptors(descriptors);
    const contents = new Map<string, Uint8Array>();
    const files: ProjectFactsInventoryFileV1[] = [];
    for (const descriptor of normalizedDescriptors) {
      throwIfAborted(input.signal);
      let content: Uint8Array;
      try {
        content = await ports.readFile({
          repository,
          relativePath: descriptor.relativePath,
          signal: input.signal,
        });
      } catch (error) {
        if (isAbortLike(error, input.signal)) {
          throw error;
        }
        throw new ProjectContextSourceStateDriftError(repository.repoId, error);
      }
      const copied = Uint8Array.from(content);
      contents.set(descriptor.relativePath, copied);
      files.push({
        repoId: repository.repoId,
        relativePath: descriptor.relativePath,
        language: descriptor.language.trim() || 'unknown',
        mode: normalizeFileMode(descriptor.mode),
        sizeBytes: copied.byteLength,
        blobSha256: hashBytes(copied),
        ownerModuleIds: uniqueStrings(descriptor.ownerModuleIds ?? []),
      });
    }
    const eligibleInventoryHash = hashCanonicalJson(files);
    const workingTreeContentHash = hashCanonicalJson(
      files.map((file) => [file.relativePath, file.mode, file.blobSha256])
    );
    throwIfAborted(input.signal);
    const postRevision = await ports.observeRevision({ repository, signal: input.signal });
    if (!sameRevisionObservation(preRevision, postRevision)) {
      throw new ProjectContextSourceStateDriftError(repository.repoId);
    }
    let verification: ProjectContextSnapshotVerificationV1;
    try {
      verification = await verifyCapturedSnapshot({
        candidate: {
          version: PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
          preRevision: { ...preRevision },
          postRevision: { ...postRevision },
          files: files.map((file) => ({
            file: { ...file, ownerModuleIds: [...file.ownerModuleIds] },
            content: Uint8Array.from(contents.get(file.relativePath)!),
          })),
          eligibleInventoryHash,
          workingTreeContentHash,
        },
        input,
        ports,
        repository,
      });
    } catch (error) {
      if (isAbortLike(error, input.signal)) {
        throw error;
      }
      if (error instanceof ProjectContextSourceStateDriftError) {
        throw error;
      }
      throw new ProjectContextSourceStateDriftError(repository.repoId, error);
    }
    if (
      !isValidSnapshotVerification(verification, preRevision, {
        eligibleInventoryHash,
        workingTreeContentHash,
      })
    ) {
      throw new ProjectContextSourceStateDriftError(repository.repoId);
    }
    const revision =
      verification.finalRevision.kind === 'content'
        ? ({ kind: 'content', workingTreeContentHash } as const)
        : verification.finalRevision.dirty
          ? ({
              kind: 'git-dirty',
              commitId: verification.finalRevision.commitId,
              treeId: verification.finalRevision.treeId,
              workingTreeContentHash,
            } as const)
          : buildCleanRevision(verification.finalRevision, repository.repoId);
    result.push({
      input: repository,
      descriptors: normalizedDescriptors,
      files,
      contents,
      eligibleInventoryHash,
      workingTreeContentHash,
      revisionEntry: {
        scopeId: repository.scopeId,
        repoId: repository.repoId,
        relativeRoot: normalizePortableRelativePath(repository.relativeRoot, 'relativeRoot'),
        revision,
        eligibleInventoryHash,
        includeExcludePolicyHash,
      },
    });
  }
  return result;
}

async function verifyCapturedSnapshot(input: {
  candidate: Parameters<
    NonNullable<ProjectContextFoundationHostPorts['verifySnapshot']>
  >[0]['candidate'];
  input: ProjectContextFoundationCaptureInput;
  ports: ProjectContextFoundationHostPorts;
  repository: ProjectContextFoundationRepositoryInput;
}): Promise<ProjectContextSnapshotVerificationV1> {
  throwIfAborted(input.input.signal);
  if (input.ports.verifySnapshot) {
    const verification = await input.ports.verifySnapshot({
      repository: input.repository,
      policy: input.input.inventoryPolicy,
      candidate: input.candidate,
      signal: input.input.signal,
    });
    throwIfAborted(input.input.signal);
    return verification;
  }
  if (input.candidate.preRevision.kind !== 'content') {
    return {
      version: PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
      verified: false,
      binding: 'working-tree-content',
      finalRevision: input.candidate.postRevision,
      eligibleInventoryHash: input.candidate.eligibleInventoryHash,
      workingTreeContentHash: input.candidate.workingTreeContentHash,
      typedReason: 'git-snapshot-verifier-required',
    };
  }
  const terminal = await captureLegacyContentTerminalState(input);
  const candidateFiles = input.candidate.files.map(({ file }) => file);
  const filesMatch = hashCanonicalJson(terminal.files) === hashCanonicalJson(candidateFiles);
  const hashesMatch =
    terminal.eligibleInventoryHash === input.candidate.eligibleInventoryHash &&
    terminal.workingTreeContentHash === input.candidate.workingTreeContentHash;
  const revisionMatches = sameRevisionObservation(
    input.candidate.postRevision,
    terminal.finalRevision
  );
  const verified = filesMatch && hashesMatch && revisionMatches;
  return {
    version: PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
    verified,
    binding: 'working-tree-content',
    finalRevision: terminal.finalRevision,
    eligibleInventoryHash: terminal.eligibleInventoryHash,
    workingTreeContentHash: terminal.workingTreeContentHash,
    typedReason: verified
      ? 'content-revision-bound-to-terminal-complete-reread'
      : 'content-revision-terminal-state-mismatch',
  };
}

async function captureLegacyContentTerminalState(input: {
  input: ProjectContextFoundationCaptureInput;
  ports: ProjectContextFoundationHostPorts;
  repository: ProjectContextFoundationRepositoryInput;
}): Promise<{
  eligibleInventoryHash: CanonicalSha256;
  files: ProjectFactsInventoryFileV1[];
  finalRevision: ProjectContextRepositoryRevisionObservation;
  workingTreeContentHash: CanonicalSha256;
}> {
  // Legacy content hosts cannot attest snapshots, so Core closes their open interval
  // by rebuilding the complete terminal inventory and content with the same policy.
  throwIfAborted(input.input.signal);
  const descriptors = normalizeFileDescriptors(
    await input.ports.enumerateEligibleFiles({
      repository: input.repository,
      policy: input.input.inventoryPolicy,
      signal: input.input.signal,
    })
  );
  throwIfAborted(input.input.signal);
  const files: ProjectFactsInventoryFileV1[] = [];
  for (const descriptor of descriptors) {
    throwIfAborted(input.input.signal);
    const content = await input.ports.readFile({
      repository: input.repository,
      relativePath: descriptor.relativePath,
      signal: input.input.signal,
    });
    throwIfAborted(input.input.signal);
    const copied = Uint8Array.from(content);
    files.push({
      repoId: input.repository.repoId,
      relativePath: descriptor.relativePath,
      language: descriptor.language.trim() || 'unknown',
      mode: normalizeFileMode(descriptor.mode),
      sizeBytes: copied.byteLength,
      blobSha256: hashBytes(copied),
      ownerModuleIds: uniqueStrings(descriptor.ownerModuleIds ?? []),
    });
  }
  const eligibleInventoryHash = hashCanonicalJson(files);
  const workingTreeContentHash = hashCanonicalJson(
    files.map((file) => [file.relativePath, file.mode, file.blobSha256])
  );
  throwIfAborted(input.input.signal);
  const finalRevision = await input.ports.observeRevision({
    repository: input.repository,
    signal: input.input.signal,
  });
  throwIfAborted(input.input.signal);
  return { eligibleInventoryHash, files, finalRevision, workingTreeContentHash };
}

function isValidSnapshotVerification(
  verification: ProjectContextSnapshotVerificationV1,
  expectedRevision: ProjectContextRepositoryRevisionObservation,
  expectedHashes: {
    eligibleInventoryHash: CanonicalSha256;
    workingTreeContentHash: CanonicalSha256;
  }
): boolean {
  const contentBoundPromotion = isContentBoundDirtyPromotion(
    expectedRevision,
    verification.finalRevision,
    verification.cleanObservationContentPromotion
  );
  if (
    verification.version !== PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION ||
    !verification.verified ||
    !verification.typedReason.trim() ||
    (!sameRevisionObservation(expectedRevision, verification.finalRevision) &&
      !contentBoundPromotion) ||
    verification.eligibleInventoryHash !== expectedHashes.eligibleInventoryHash ||
    verification.workingTreeContentHash !== expectedHashes.workingTreeContentHash
  ) {
    return false;
  }
  if (expectedRevision.kind === 'git' && !expectedRevision.dirty) {
    if (contentBoundPromotion) {
      return verification.binding === 'working-tree-content' && verification.treeId === undefined;
    }
    return (
      verification.binding === 'git-tree' &&
      Boolean(expectedRevision.treeId) &&
      verification.treeId === expectedRevision.treeId
    );
  }
  return verification.binding === 'working-tree-content';
}

function isContentBoundDirtyPromotion(
  expected: ProjectContextRepositoryRevisionObservation,
  verified: ProjectContextRepositoryRevisionObservation,
  cleanObservationContentPromotion: true | undefined
): boolean {
  return (
    cleanObservationContentPromotion === true &&
    expected.kind === 'git' &&
    !expected.dirty &&
    verified.kind === 'git' &&
    verified.dirty &&
    expected.commitId === verified.commitId &&
    expected.treeId === verified.treeId
  );
}

function sameRevisionObservation(
  left: ProjectContextRepositoryRevisionObservation,
  right: ProjectContextRepositoryRevisionObservation
): boolean {
  return hashCanonicalJson(left) === hashCanonicalJson(right);
}

function buildInventoryPlane(
  repositories: CapturedRepository[],
  includeExcludePolicy: ProjectContextFoundationCaptureInput['inventoryPolicy'],
  includeExcludePolicyHash: CanonicalSha256
): ProjectFactsInventoryPlaneV1 {
  const files = repositories.flatMap((repository) => repository.files).sort(compareInventoryFiles);
  const repoRows: ProjectFactsInventoryRepositoryV1[] = repositories.map((repository) => ({
    scopeId: repository.input.scopeId,
    repoId: repository.input.repoId,
    relativeRoot: normalizePortableRelativePath(repository.input.relativeRoot, 'relativeRoot'),
    fileCount: repository.files.length,
    eligibleInventoryHash: repository.eligibleInventoryHash,
  }));
  const semantic = {
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    includeExcludePolicy,
    includeExcludePolicyHash,
    repositories: repoRows,
    files,
    fileCount: files.length,
  };
  return {
    ...semantic,
    inventoryContentHash: hashCanonicalJson(semantic),
  };
}

function buildDetailPlane(
  repositories: CapturedRepository[],
  policy: ProjectContextFoundationCaptureInput['detailPolicy']
): { detail: ProjectFactsDetailPlaneV1; chunks: CertifiedProjectFactsChunkV1[] } {
  const inventoryFiles = repositories
    .flatMap((repository) => repository.files)
    .sort(compareInventoryFiles);
  const explicitSelection = policy.selectedFiles?.map(
    (selection) =>
      `${selection.repoId}\u0000${normalizePortableRelativePath(selection.relativePath)}`
  );
  const selectedKeys = new Set(
    explicitSelection ??
      inventoryFiles
        .slice(0, policy.maxSelectedFiles)
        .map((file) => `${file.repoId}\u0000${file.relativePath}`)
  );
  if (selectedKeys.size > policy.maxSelectedFiles) {
    throw new TypeError('selectedFiles exceeds the declared detail maxSelectedFiles cap.');
  }
  const chunksByHash = new Map<CanonicalSha256, CertifiedProjectFactsChunkV1>();
  const decisions: ProjectFactsDetailDecisionV1[] = [];
  const selections: ProjectFactsDetailSelectionV1[] = [];
  for (const file of inventoryFiles) {
    const key = `${file.repoId}\u0000${file.relativePath}`;
    if (!selectedKeys.has(key)) {
      decisions.push({
        repoId: file.repoId,
        relativePath: file.relativePath,
        status: 'omitted',
        reason: 'detail-file-cap',
      });
      continue;
    }
    const repository = repositories.find((candidate) => candidate.input.repoId === file.repoId);
    const content = repository?.contents.get(file.relativePath);
    if (!content) {
      throw new TypeError(`Selected detail file is missing from capture: ${key}.`);
    }
    const fullChunkRefs: CanonicalSha256[] = [];
    for (let offset = 0; offset < content.byteLength; offset += policy.chunkBytes) {
      const bytes = content.slice(offset, Math.min(offset + policy.chunkBytes, content.byteLength));
      const blobHash = hashBytes(bytes);
      fullChunkRefs.push(blobHash);
      if (!chunksByHash.has(blobHash)) {
        chunksByHash.set(blobHash, {
          blobHash,
          byteLength: bytes.byteLength,
          dataBase64: Buffer.from(bytes).toString('base64'),
        });
      }
    }
    const preview = content.slice(0, Math.min(content.byteLength, policy.maxPreviewBytes));
    decisions.push({
      repoId: file.repoId,
      relativePath: file.relativePath,
      status: 'selected',
      reason: 'selected-by-policy',
    });
    selections.push({
      repoId: file.repoId,
      relativePath: file.relativePath,
      previewBase64: Buffer.from(preview).toString('base64'),
      previewByteLength: preview.byteLength,
      previewTruncated: preview.byteLength < content.byteLength,
      fullContentHash: file.blobSha256,
      fullChunkRefs,
    });
  }
  for (const key of selectedKeys) {
    if (!inventoryFiles.some((file) => `${file.repoId}\u0000${file.relativePath}` === key)) {
      throw new TypeError(`selectedFiles references a file outside the inventory: ${key}.`);
    }
  }
  const omittedKeys = decisions
    .filter((decision) => decision.status === 'omitted')
    .map((decision) => `${decision.repoId}\u0000${decision.relativePath}`);
  const semantic = {
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    policy: normalizeDetailPolicy(policy),
    decisions,
    selections,
    selectedFileCount: selections.length,
    omittedFileCount: omittedKeys.length,
    ...(omittedKeys.length > 0
      ? {
          continuation:
            `pcf-detail-v1:${canonicalHashDigest(hashCanonicalJson(omittedKeys))}` as const,
        }
      : {}),
  };
  return {
    detail: {
      ...semantic,
      detailContentHash: hashCanonicalJson(semantic),
    },
    chunks: [...chunksByHash.values()].sort((left, right) =>
      left.blobHash.localeCompare(right.blobHash)
    ),
  };
}

async function captureRequestOutcomes(
  input: ProjectContextFoundationCaptureInput,
  repositories: CapturedRepository[],
  ports: ProjectContextFoundationHostPorts
): Promise<ProjectContextRequestOutcomeV1[]> {
  const outcomes: ProjectContextRequestOutcomeV1[] = [];
  for (const plan of [...input.requestPlans].sort(compareRequestPlans)) {
    throwIfAborted(input.signal);
    const repository = repositories.find((candidate) => candidate.input.repoId === plan.repoId);
    if (!repository) {
      throw new TypeError(`Request plan repository was not captured: ${plan.repoId}.`);
    }
    const selector = toProjectFactsJson(plan.selector);
    const scope = toProjectFactsJson(plan.scope);
    if (plan.applicability === 'not-applicable') {
      const output = toProjectFactsJson({ reason: plan.typedReason, status: 'not-applicable' });
      outcomes.push({
        repoId: plan.repoId,
        kind: plan.kind,
        applicability: plan.applicability,
        typedReason: plan.typedReason,
        selector,
        scope,
        parserRuntime: 'not-required',
        queryInitialization: 'not-required',
        terminalStatus: 'not-applicable',
        output,
        outputHash: hashCanonicalJson(output),
        sourceRanges: [],
        errors: [],
        dependencyResolutions: [],
        dependencyObservationCount: 0,
        dependencyGraphReconciliation: emptyDependencyGraphReconciliation(),
      });
      continue;
    }
    try {
      const result = await ports.executeRequest({
        repository: repository.input,
        plan,
        signal: input.signal,
      });
      const output = toProjectFactsJson(result.output);
      const sourceRanges = (result.sourceRanges ?? []).map(normalizeSourceRange);
      outcomes.push({
        repoId: plan.repoId,
        kind: plan.kind,
        applicability: plan.applicability,
        selector,
        scope,
        ...(result.detectedLanguage ? { detectedLanguage: result.detectedLanguage } : {}),
        parserRuntime: result.parserRuntime,
        queryInitialization: result.queryInitialization,
        terminalStatus: result.terminalStatus,
        ...(result.continuation
          ? { continuation: normalizeOpaqueContinuation(result.continuation) }
          : {}),
        output,
        outputHash: hashCanonicalJson(output),
        sourceRanges,
        errors: normalizeRequestDiagnostics(result.errors ?? []),
        dependencyResolutions: normalizeDependencyResolutions(
          result.dependencyResolutions ?? [],
          plan,
          repositories
        ),
        dependencyObservationCount: normalizeNonnegativeCount(
          result.dependencyObservationCount ?? 0,
          'dependencyObservationCount'
        ),
        dependencyGraphReconciliation: normalizeDependencyGraphReconciliation(
          result.dependencyGraphReconciliation ?? emptyDependencyGraphReconciliation()
        ),
      });
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const output = toProjectFactsJson({ error: message, status: 'failed' });
      outcomes.push({
        repoId: plan.repoId,
        kind: plan.kind,
        applicability: plan.applicability,
        selector,
        scope,
        parserRuntime: 'unavailable',
        queryInitialization: 'unavailable',
        terminalStatus: 'failed',
        output,
        outputHash: hashCanonicalJson(output),
        sourceRanges: [],
        dependencyResolutions: [],
        dependencyObservationCount: 0,
        dependencyGraphReconciliation: emptyDependencyGraphReconciliation(),
        errors: [
          {
            classification: 'confirmed-defect',
            code: 'execution-failed',
            message,
            retryable: false,
            severity: 'error',
            typedReason: 'project-context-request-threw-before-a-valid-envelope',
          },
        ],
      });
    }
  }
  return outcomes;
}

function buildProjections(
  inputs: ProjectContextFoundationCaptureInput['projections']
): Record<CertifiedProjectFactsConsumer, CertifiedProjectFactsProjectionV1> {
  const result = {} as Record<CertifiedProjectFactsConsumer, CertifiedProjectFactsProjectionV1>;
  for (const consumer of CERTIFIED_PROJECT_FACTS_CONSUMERS) {
    if (!(consumer in inputs)) {
      throw new TypeError(`Missing certified facts projection: ${consumer}.`);
    }
    const payload = toProjectFactsJson(inputs[consumer]);
    assertProjectionPayloadIsLineageFree(payload, consumer);
    result[consumer] = {
      payload,
      projectionContentHash: hashCanonicalJson(payload),
    };
  }
  return result;
}

function buildManifest(input: {
  projectMode: string;
  factsContentHash: CanonicalSha256;
  sourceRevisionVector: ReturnType<typeof buildSourceRevisionVectorV1>;
  inventory: ProjectFactsInventoryPlaneV1;
  detail: ProjectFactsDetailPlaneV1;
  requestOutcomes: ProjectContextRequestOutcomeV1[];
  legacyEntries: ProjectContextFoundationCaptureInput['legacyEntries'];
  projections: Record<CertifiedProjectFactsConsumer, CertifiedProjectFactsProjectionV1>;
  chunks: CertifiedProjectFactsChunkV1[];
}): CertifiedProjectFactsManifestV1 {
  const blobTable = input.chunks
    .map((chunk) => ({ blobHash: chunk.blobHash, byteLength: chunk.byteLength }))
    .sort((left, right) => left.blobHash.localeCompare(right.blobHash));
  return {
    kind: 'CertifiedProjectFactsManifest',
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    canonicalizerVersion: PROJECT_FACTS_CANONICALIZER_VERSION,
    projectMode: input.projectMode,
    factsContentHash: input.factsContentHash,
    sourceRevisionVector: input.sourceRevisionVector,
    sourceVectorHash: input.sourceRevisionVector.sourceVectorHash,
    inventoryManifestHash: hashCanonicalJson(input.inventory),
    detailManifestHash: hashCanonicalJson(input.detail),
    fullChunkManifestHash: hashCanonicalJson(blobTable),
    legacyEntryInventoryHash: hashCanonicalJson(input.legacyEntries),
    requestEnvelopeIndex: input.requestOutcomes.map((outcome) => ({
      repoId: outcome.repoId,
      kind: outcome.kind,
      applicability: outcome.applicability,
      terminalStatus: outcome.terminalStatus,
      outputHash: outcome.outputHash,
    })),
    projectionContentHashes: Object.fromEntries(
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [
        consumer,
        input.projections[consumer].projectionContentHash,
      ])
    ) as Record<CertifiedProjectFactsConsumer, CanonicalSha256>,
    blobTable,
  };
}

function buildCaptureReadinessSummary(
  facts: CertifiedProjectFactsArtifactV1['facts'],
  repositoryIds: string[],
  chunks: CertifiedProjectFactsChunkV1[]
): CertifiedProjectFactsArtifactV1['readiness'] {
  const errors: string[] = [];
  const repoIds = [...repositoryIds].sort();
  const inventoryKeys = new Set(
    facts.inventory.files.map((file) => `${file.repoId}\u0000${file.relativePath}`)
  );
  const decisionKeys = new Set(
    facts.detail.decisions.map((decision) => `${decision.repoId}\u0000${decision.relativePath}`)
  );
  if (facts.inventory.fileCount !== inventoryKeys.size) {
    errors.push('inventory-file-conservation-failed');
  }
  if (
    decisionKeys.size !== inventoryKeys.size ||
    facts.detail.decisions.length !== inventoryKeys.size
  ) {
    errors.push('detail-decision-conservation-failed');
  }
  for (const key of decisionKeys) {
    if (!inventoryKeys.has(key)) {
      errors.push(`detail-outside-inventory:${key}`);
    }
  }
  const chunkHashes = new Set(chunks.map((chunk) => chunk.blobHash));
  for (const selection of facts.detail.selections) {
    for (const chunkRef of selection.fullChunkRefs) {
      if (!chunkHashes.has(chunkRef)) {
        errors.push(`missing-full-chunk:${chunkRef}`);
      }
    }
  }
  for (const repoId of repoIds) {
    const expectedOwnership = buildExpectedModuleOwnership(
      facts.inventory.files.filter((file) => file.repoId === repoId)
    );
    const expectedOwnerIds = new Set(Object.keys(expectedOwnership));
    for (const kind of PROJECT_CONTEXT_REQUEST_KIND_VALUES) {
      const rows = facts.requestOutcomes.filter(
        (row) => row.repoId === repoId && row.kind === kind
      );
      if (rows.length === 0) {
        errors.push(`request-row-count:${repoId}/${kind}:${rows.length}`);
        continue;
      }
      if (!['module', 'module-layers'].includes(kind) && rows.length !== 1) {
        errors.push(`request-row-count:${repoId}/${kind}:${rows.length}`);
      }
      if (['module', 'module-layers'].includes(kind) && expectedOwnerIds.size > 0) {
        const actualOwnerIds = rows
          .map((row) => readDirectOwnerModuleId(row.selector))
          .filter((owner): owner is string => Boolean(owner));
        if (
          actualOwnerIds.length !== rows.length ||
          hashCanonicalJson([...new Set(actualOwnerIds)].sort()) !==
            hashCanonicalJson([...expectedOwnerIds].sort()) ||
          hashCanonicalJson(collectModuleOwnership(rows.map((row) => row.selector))) !==
            hashCanonicalJson(expectedOwnership)
        ) {
          errors.push(`module-owner-coverage:${repoId}/${kind}`);
        }
      }
      for (const row of rows) {
        if (['repo', 'map'].includes(kind) && expectedOwnerIds.size > 0) {
          const declaredOwnerIds = collectOwnerModuleIds(row.selector);
          if (
            hashCanonicalJson(declaredOwnerIds) !==
              hashCanonicalJson([...expectedOwnerIds].sort()) ||
            hashCanonicalJson(collectModuleOwnership(row.selector)) !==
              hashCanonicalJson(expectedOwnership)
          ) {
            errors.push(`module-owner-coverage:${repoId}/${kind}`);
          }
        }
        if (
          (row.applicability === 'applicable' && row.terminalStatus !== 'completed') ||
          (row.applicability === 'not-applicable' &&
            (!row.typedReason || row.terminalStatus !== 'not-applicable'))
        ) {
          errors.push(`request-not-ready:${repoId}/${kind}:${row.terminalStatus}`);
        }
        if (row.parserRuntime === 'unavailable' || row.queryInitialization === 'unavailable') {
          errors.push(`runtime-not-ready:${repoId}/${kind}`);
        }
        for (const diagnostic of row.errors) {
          if (!isTypedRequestDiagnostic(diagnostic)) {
            errors.push(`unclassified-request-diagnostic:${repoId}/${kind}`);
          } else if (diagnostic.classification === 'confirmed-defect') {
            errors.push(`confirmed-request-defect:${repoId}/${kind}:${diagnostic.code}`);
          }
        }
        const resolutions = row.dependencyResolutions ?? [];
        if (
          row.dependencyObservationCount !== undefined &&
          row.dependencyObservationCount !== resolutions.length
        ) {
          errors.push(`dependency-observation-conservation:${repoId}/${kind}`);
        }
        const graph = row.dependencyGraphReconciliation;
        if (
          graph &&
          graph.originalExternalHotspotCount !==
            graph.internalResolvedHotspotCount +
              graph.approvedSiblingHotspotCount +
              graph.remainingExternalHotspotCount
        ) {
          errors.push(`dependency-graph-conservation:${repoId}/${kind}`);
        }
        if (graph && (graph.originalExternalHotspotCount > 0 || kind === 'map')) {
          const resolutionNames = (...classifications: string[]) =>
            uniqueStrings(
              resolutions
                .filter((resolution) => classifications.includes(resolution.classification))
                .map((resolution) => resolution.dependencyName)
            );
          if (
            hashCanonicalJson(
              resolutionNames(
                'internal-resolved',
                'approved-sibling',
                'expected-external',
                'confirmed-defect'
              )
            ) !== hashCanonicalJson(graph.originalExternalDependencyNames ?? []) ||
            hashCanonicalJson(resolutionNames('internal-resolved')) !==
              hashCanonicalJson(graph.internalResolvedDependencyNames ?? []) ||
            hashCanonicalJson(resolutionNames('approved-sibling')) !==
              hashCanonicalJson(graph.approvedSiblingDependencyNames ?? []) ||
            hashCanonicalJson(resolutionNames('expected-external', 'confirmed-defect')) !==
              hashCanonicalJson(graph.remainingExternalDependencyNames ?? [])
          ) {
            errors.push(`dependency-warning-graph-alignment:${repoId}/${kind}`);
          }
        }
        for (const resolution of resolutions) {
          errors.push(
            ...validateDependencyResolutionEvidence(resolution, row, facts.inventory.files)
          );
        }
        for (const range of row.sourceRanges) {
          if (!inventoryKeys.has(`${range.repoId}\u0000${range.relativePath}`)) {
            errors.push(`source-range-outside-inventory:${range.repoId}/${range.relativePath}`);
          }
        }
      }
    }
  }
  errors.push(...validateDependencyOwnershipCatalog(facts.requestOutcomes, facts.inventory.files));
  for (const entry of facts.legacyEntries) {
    if (
      entry.directProjectContextCallCount !== 0 ||
      entry.rawFilesystemFallbackCount !== 0 ||
      entry.synthesizedProjectScopeFactCount !== 0
    ) {
      errors.push(`legacy-strict-counter:${entry.entryId}`);
    }
  }
  const normalizedErrors = uniqueStrings(errors);
  return {
    validatorVersion: PROJECT_FACTS_READINESS_VALIDATOR_VERSION,
    verdict: normalizedErrors.length === 0 ? 'passed' : 'failed',
    errors: normalizedErrors,
    errorsHash: hashCanonicalJson(normalizedErrors),
  };
}

function validateDependencyResolutionEvidence(
  resolution: ProjectContextDependencyResolutionV1,
  row: ProjectContextRequestOutcomeV1,
  inventoryFiles: readonly ProjectFactsInventoryFileV1[]
): string[] {
  const prefix = `${row.repoId}/${row.kind}/${resolution.dependencyName}`;
  const errors: string[] = [];
  if (resolution.importerRepoId !== row.repoId || resolution.requestKind !== row.kind) {
    errors.push(`dependency-resolution-row-mismatch:${prefix}`);
  }
  if (!['internal-resolved', 'approved-sibling'].includes(resolution.classification)) {
    return errors;
  }
  if (
    !resolution.ownerRepoId ||
    !resolution.ownerModuleId ||
    !resolution.ownershipSource ||
    !resolution.matchedOwnershipKey ||
    !resolution.ownershipEvidenceHash ||
    !resolution.ownershipProvenancePath
  ) {
    errors.push(`dependency-ownership-evidence-missing:${prefix}`);
    return errors;
  }
  const provenance = inventoryFiles.find(
    (file) =>
      file.repoId === resolution.ownerRepoId &&
      file.relativePath === resolution.ownershipProvenancePath
  );
  if (!provenance || provenance.blobSha256 !== resolution.ownershipEvidenceHash) {
    errors.push(`dependency-provenance-outside-inventory:${prefix}`);
  }
  if (
    !inventoryFiles.some(
      (file) =>
        file.repoId === resolution.ownerRepoId &&
        file.ownerModuleIds.includes(resolution.ownerModuleId!)
    )
  ) {
    errors.push(`dependency-owner-module-outside-inventory:${prefix}`);
  }
  if (resolution.classification === 'internal-resolved') {
    if (resolution.resolvedTargets?.length !== 1) {
      errors.push(`dependency-internal-target-count:${prefix}`);
    }
    for (const target of resolution.resolvedTargets ?? []) {
      const file = inventoryFiles.find(
        (candidate) =>
          candidate.repoId === row.repoId && candidate.relativePath === target.relativePath
      );
      if (
        !file ||
        resolution.ownerRepoId !== row.repoId ||
        !file.ownerModuleIds.includes(resolution.ownerModuleId) ||
        target.blobSha256 !== file.blobSha256
      ) {
        errors.push(`dependency-internal-target-outside-owned-inventory:${prefix}`);
      }
    }
  }
  return errors;
}

function validateDependencyOwnershipCatalog(
  outcomes: readonly ProjectContextRequestOutcomeV1[],
  inventoryFiles: readonly ProjectFactsInventoryFileV1[]
): string[] {
  const errors: string[] = [];
  const catalogHashes = new Set<string>();
  const entries = new Map<
    string,
    {
      repoId: string;
      ownerModuleId: string;
      ownerPackageName?: string;
      source: 'package-name' | 'package-export' | 'package-import' | 'module-alias';
      pattern: string;
      targetPatterns?: string[];
      provenance: { relativePath: string; contentHash: CanonicalSha256 };
    }
  >();
  for (const outcome of outcomes.filter((row) => row.kind === 'map')) {
    visitSeed(outcome.selector, outcome.repoId);
  }
  if (entries.size === 0 && catalogHashes.size === 0) {
    return errors;
  }
  if (entries.size === 0 || catalogHashes.size !== 1) {
    errors.push('dependency-ownership-catalog-hash-coverage');
    return errors;
  }
  const normalizedEntries = [...entries.values()].sort(
    (left, right) =>
      left.repoId.localeCompare(right.repoId) ||
      left.ownerModuleId.localeCompare(right.ownerModuleId) ||
      left.source.localeCompare(right.source) ||
      left.pattern.localeCompare(right.pattern) ||
      left.provenance.contentHash.localeCompare(right.provenance.contentHash)
  );
  const rebuiltHash = hashCanonicalJson({
    version: PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION,
    entries: normalizedEntries,
  });
  if (![...catalogHashes][0] || rebuiltHash !== [...catalogHashes][0]) {
    errors.push('dependency-ownership-catalog-hash-mismatch');
  }
  return errors;

  function visitSeed(value: ProjectFactsJson, repoId: string): void {
    if (Array.isArray(value)) {
      for (const entry of value) {
        visitSeed(entry, repoId);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    if (
      typeof value.ownerModuleId === 'string' &&
      Array.isArray(value.dependencyOwnershipBindings)
    ) {
      if (typeof value.dependencyOwnershipHash !== 'string') {
        errors.push(`dependency-ownership-catalog-hash-missing:${repoId}/${value.ownerModuleId}`);
      } else {
        catalogHashes.add(value.dependencyOwnershipHash);
      }
      for (const rawBinding of value.dependencyOwnershipBindings) {
        const binding =
          rawBinding && !Array.isArray(rawBinding) && typeof rawBinding === 'object'
            ? rawBinding
            : undefined;
        const source = binding?.ownershipSource;
        const pattern = binding?.matchedOwnershipKey;
        const evidenceHash = binding?.ownershipEvidenceHash;
        const provenancePath = binding?.ownershipProvenancePath;
        if (
          !binding ||
          typeof source !== 'string' ||
          !['package-name', 'package-export', 'package-import', 'module-alias'].includes(source) ||
          typeof pattern !== 'string' ||
          !pattern.trim() ||
          typeof evidenceHash !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/.test(evidenceHash) ||
          typeof provenancePath !== 'string'
        ) {
          errors.push(`dependency-ownership-binding-malformed:${repoId}/${value.ownerModuleId}`);
          continue;
        }
        let normalizedProvenancePath: string;
        let targetPatterns: string[] | undefined;
        try {
          normalizedProvenancePath = normalizePortableRelativePath(
            provenancePath,
            'ownershipProvenancePath'
          );
          targetPatterns = Array.isArray(binding.targetPatterns)
            ? uniqueStrings(
                binding.targetPatterns.map((target) => {
                  if (typeof target !== 'string') {
                    throw new TypeError('ownership target must be a string');
                  }
                  return normalizePortableRelativePath(target, 'ownershipTargetPattern');
                })
              )
            : undefined;
        } catch {
          errors.push(`dependency-ownership-binding-path-invalid:${repoId}/${value.ownerModuleId}`);
          continue;
        }
        if (source === 'package-import' && !targetPatterns?.length) {
          errors.push(`dependency-ownership-import-target-missing:${repoId}/${pattern}`);
        }
        const provenance = inventoryFiles.find(
          (file) => file.repoId === repoId && file.relativePath === normalizedProvenancePath
        );
        if (!provenance || provenance.blobSha256 !== evidenceHash) {
          errors.push(`dependency-ownership-catalog-provenance:${repoId}/${pattern}`);
        }
        if (
          !inventoryFiles.some(
            (file) =>
              file.repoId === repoId && file.ownerModuleIds.includes(value.ownerModuleId as string)
          )
        ) {
          errors.push(`dependency-ownership-catalog-owner:${repoId}/${value.ownerModuleId}`);
        }
        const entry = {
          repoId,
          ownerModuleId: value.ownerModuleId,
          ...(typeof binding.ownerPackageName === 'string' && binding.ownerPackageName.trim()
            ? { ownerPackageName: binding.ownerPackageName.trim() }
            : {}),
          source: source as 'package-name' | 'package-export' | 'package-import' | 'module-alias',
          pattern: pattern.trim(),
          ...(targetPatterns ? { targetPatterns } : {}),
          provenance: {
            relativePath: normalizedProvenancePath,
            contentHash: evidenceHash as CanonicalSha256,
          },
        };
        const identity = hashCanonicalJson(entry);
        if (entries.has(identity)) {
          errors.push(`dependency-ownership-catalog-duplicate:${repoId}/${pattern}`);
        } else {
          entries.set(identity, entry);
        }
      }
    }
    for (const nested of Object.values(value)) {
      visitSeed(nested, repoId);
    }
  }
}

function normalizeFileDescriptors(
  descriptors: ProjectContextFoundationFileDescriptor[]
): ProjectContextFoundationFileDescriptor[] {
  const byPath = new Map<string, ProjectContextFoundationFileDescriptor>();
  for (const descriptor of descriptors) {
    const relativePath = normalizePortableRelativePath(descriptor.relativePath, 'relativePath');
    if (byPath.has(relativePath)) {
      throw new TypeError(`Duplicate eligible file path: ${relativePath}.`);
    }
    byPath.set(relativePath, {
      ...descriptor,
      relativePath,
      language: descriptor.language.trim() || 'unknown',
      mode: normalizeFileMode(descriptor.mode),
      ownerModuleIds: uniqueStrings(descriptor.ownerModuleIds ?? []),
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function normalizeDetailPolicy(
  policy: ProjectContextFoundationCaptureInput['detailPolicy']
): ProjectContextFoundationCaptureInput['detailPolicy'] {
  return {
    maxSelectedFiles: policy.maxSelectedFiles,
    maxPreviewBytes: policy.maxPreviewBytes,
    chunkBytes: policy.chunkBytes,
    ...(policy.selectedFiles
      ? {
          selectedFiles: policy.selectedFiles
            .map((selection) => ({
              repoId: selection.repoId,
              relativePath: normalizePortableRelativePath(selection.relativePath),
            }))
            .sort(
              (left, right) =>
                left.repoId.localeCompare(right.repoId) ||
                left.relativePath.localeCompare(right.relativePath)
            ),
        }
      : {}),
  };
}

function normalizeSourceRange(
  range: ProjectContextRequestOutcomeV1['sourceRanges'][number]
): ProjectContextRequestOutcomeV1['sourceRanges'][number] {
  const relativePath = normalizePortableRelativePath(
    range.relativePath,
    'sourceRange.relativePath'
  );
  if (
    !Number.isInteger(range.startLine) ||
    !Number.isInteger(range.endLine) ||
    range.startLine < 1 ||
    range.endLine < range.startLine
  ) {
    throw new TypeError(`Invalid bounded source range: ${range.repoId}/${relativePath}.`);
  }
  return { ...range, relativePath };
}

function normalizeOpaqueContinuation(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new TypeError('Continuation must be opaque and must not contain a host path.');
  }
  return trimmed;
}

function buildCleanRevision(
  observation: Extract<
    Awaited<ReturnType<ProjectContextFoundationHostPorts['observeRevision']>>,
    { kind: 'git' }
  >,
  repoId: string
) {
  if (!observation.commitId || !observation.treeId) {
    throw new TypeError(`Clean Git revision is incomplete for ${repoId}.`);
  }
  return {
    kind: 'git-clean' as const,
    commitId: observation.commitId,
    treeId: observation.treeId,
  };
}

function normalizeFileMode(value: string): string {
  const normalized = value.trim();
  if (!/^[0-7]{6}$/.test(normalized)) {
    throw new TypeError(`File mode must be a six-digit octal Git mode: ${value}.`);
  }
  return normalized;
}

function normalizePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer.`);
  }
}

function compareRepositories(
  left: ProjectContextFoundationRepositoryInput,
  right: ProjectContextFoundationRepositoryInput
): number {
  return (
    left.scopeId.localeCompare(right.scopeId) ||
    left.repoId.localeCompare(right.repoId) ||
    left.relativeRoot.localeCompare(right.relativeRoot)
  );
}

function compareInventoryFiles(
  left: ProjectFactsInventoryFileV1,
  right: ProjectFactsInventoryFileV1
): number {
  return (
    left.repoId.localeCompare(right.repoId) || left.relativePath.localeCompare(right.relativePath)
  );
}

function compareRequestPlans(
  left: ProjectContextRequestAuditPlan,
  right: ProjectContextRequestAuditPlan
): number {
  return (
    left.repoId.localeCompare(right.repoId) ||
    PROJECT_CONTEXT_REQUEST_KIND_VALUES.indexOf(left.kind) -
      PROJECT_CONTEXT_REQUEST_KIND_VALUES.indexOf(right.kind) ||
    hashCanonicalJson(left.selector).localeCompare(hashCanonicalJson(right.selector))
  );
}

function normalizeRequestDiagnostics(
  diagnostics: readonly ProjectContextRequestDiagnosticV1[]
): ProjectContextRequestDiagnosticV1[] {
  const byIdentity = new Map<string, ProjectContextRequestDiagnosticV1>();
  for (const diagnostic of diagnostics) {
    if (!isTypedRequestDiagnostic(diagnostic)) {
      throw new TypeError('ProjectContext request diagnostics must carry a typed classification.');
    }
    const normalized = {
      ...diagnostic,
      code: diagnostic.code.trim(),
      message: diagnostic.message.trim(),
      typedReason: diagnostic.typedReason.trim(),
      ...(diagnostic.path ? { path: normalizePortableDiagnosticPath(diagnostic.path) } : {}),
    };
    byIdentity.set(hashCanonicalJson(normalized), normalized);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.classification.localeCompare(right.classification) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
  );
}

function normalizeDependencyResolutions(
  resolutions: readonly ProjectContextDependencyResolutionV1[],
  plan: ProjectContextRequestAuditPlan,
  repositories: readonly CapturedRepository[]
): ProjectContextDependencyResolutionV1[] {
  const byIdentity = new Map<string, ProjectContextDependencyResolutionV1>();
  for (const resolution of resolutions) {
    if (
      !resolution.dependencyName.trim() ||
      !resolution.importerRepoId.trim() ||
      !resolution.typedReason.trim() ||
      !['internal-resolved', 'approved-sibling', 'expected-external', 'confirmed-defect'].includes(
        resolution.classification
      )
    ) {
      throw new TypeError('ProjectContext dependency resolution must be typed and attributable.');
    }
    if (resolution.importerRepoId !== plan.repoId || resolution.requestKind !== plan.kind) {
      throw new TypeError('ProjectContext dependency resolution does not match its request row.');
    }
    const requiresOwner = ['internal-resolved', 'approved-sibling'].includes(
      resolution.classification
    );
    if (
      requiresOwner &&
      (!resolution.ownerRepoId?.trim() ||
        !resolution.ownerModuleId?.trim() ||
        !resolution.ownershipSource ||
        !resolution.matchedOwnershipKey?.trim() ||
        !resolution.ownershipEvidenceHash ||
        !resolution.ownershipProvenancePath?.trim())
    ) {
      throw new TypeError('Owned dependency resolution is missing canonical ownership evidence.');
    }
    const ownerRepository = resolution.ownerRepoId
      ? repositories.find((repository) => repository.input.repoId === resolution.ownerRepoId)
      : undefined;
    const provenancePath = resolution.ownershipProvenancePath
      ? normalizePortableRelativePath(resolution.ownershipProvenancePath, 'ownershipProvenancePath')
      : undefined;
    if (requiresOwner) {
      const provenanceFile = ownerRepository?.files.find(
        (file) => file.relativePath === provenancePath
      );
      if (!provenanceFile || provenanceFile.blobSha256 !== resolution.ownershipEvidenceHash) {
        throw new TypeError('Dependency ownership provenance is not bound to certified inventory.');
      }
      if (
        !ownerRepository?.files.some((file) =>
          file.ownerModuleIds.includes(resolution.ownerModuleId!)
        )
      ) {
        throw new TypeError('Dependency owner module is absent from certified inventory.');
      }
    }
    const resolvedTargets = (resolution.resolvedTargets ?? []).map((target) => {
      const relativePath = normalizePortableRelativePath(
        target.relativePath,
        'dependencyTarget.relativePath'
      );
      const file = ownerRepository?.files.find(
        (candidate) => candidate.relativePath === relativePath
      );
      if (
        !file ||
        file.repoId !== plan.repoId ||
        resolution.ownerRepoId !== plan.repoId ||
        !file.ownerModuleIds.includes(resolution.ownerModuleId ?? '')
      ) {
        throw new TypeError('Internal dependency target is not a certified owned inventory file.');
      }
      if (target.blobSha256 && target.blobSha256 !== file.blobSha256) {
        throw new TypeError('Internal dependency target hash does not match certified inventory.');
      }
      return { relativePath, blobSha256: file.blobSha256 };
    });
    if (resolution.classification === 'internal-resolved' && resolvedTargets.length !== 1) {
      throw new TypeError('Internal dependency resolution must bind one certified owned target.');
    }
    const normalized = {
      ...resolution,
      dependencyName: resolution.dependencyName.trim(),
      importerRepoId: resolution.importerRepoId.trim(),
      typedReason: resolution.typedReason.trim(),
      ...(provenancePath ? { ownershipProvenancePath: provenancePath } : {}),
      ...(resolvedTargets.length > 0 ? { resolvedTargets } : {}),
    };
    byIdentity.set(hashCanonicalJson(normalized), normalized);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.classification.localeCompare(right.classification) ||
      left.dependencyName.localeCompare(right.dependencyName) ||
      left.importerRepoId.localeCompare(right.importerRepoId)
  );
}

function emptyDependencyGraphReconciliation() {
  return {
    originalExternalHotspotCount: 0,
    internalResolvedHotspotCount: 0,
    approvedSiblingHotspotCount: 0,
    remainingExternalHotspotCount: 0,
    originalExternalDependencyNames: [],
    internalResolvedDependencyNames: [],
    approvedSiblingDependencyNames: [],
    remainingExternalDependencyNames: [],
  };
}

function normalizeDependencyGraphReconciliation(
  value: NonNullable<ProjectContextRequestOutcomeV1['dependencyGraphReconciliation']>
): NonNullable<ProjectContextRequestOutcomeV1['dependencyGraphReconciliation']> {
  return {
    originalExternalHotspotCount: normalizeNonnegativeCount(
      value.originalExternalHotspotCount,
      'originalExternalHotspotCount'
    ),
    internalResolvedHotspotCount: normalizeNonnegativeCount(
      value.internalResolvedHotspotCount,
      'internalResolvedHotspotCount'
    ),
    approvedSiblingHotspotCount: normalizeNonnegativeCount(
      value.approvedSiblingHotspotCount,
      'approvedSiblingHotspotCount'
    ),
    remainingExternalHotspotCount: normalizeNonnegativeCount(
      value.remainingExternalHotspotCount,
      'remainingExternalHotspotCount'
    ),
    originalExternalDependencyNames: uniqueStrings(value.originalExternalDependencyNames ?? []),
    internalResolvedDependencyNames: uniqueStrings(value.internalResolvedDependencyNames ?? []),
    approvedSiblingDependencyNames: uniqueStrings(value.approvedSiblingDependencyNames ?? []),
    remainingExternalDependencyNames: uniqueStrings(value.remainingExternalDependencyNames ?? []),
  };
}

function normalizeNonnegativeCount(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function isTypedRequestDiagnostic(value: unknown): value is ProjectContextRequestDiagnosticV1 {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const diagnostic = value as Partial<ProjectContextRequestDiagnosticV1>;
  return (
    typeof diagnostic.code === 'string' &&
    Boolean(diagnostic.code.trim()) &&
    typeof diagnostic.message === 'string' &&
    Boolean(diagnostic.message.trim()) &&
    typeof diagnostic.typedReason === 'string' &&
    Boolean(diagnostic.typedReason.trim()) &&
    typeof diagnostic.retryable === 'boolean' &&
    ['error', 'warning'].includes(diagnostic.severity ?? '') &&
    ['expected-external', 'advisory', 'confirmed-defect'].includes(diagnostic.classification ?? '')
  );
}

function normalizePortableDiagnosticPath(value: string): string {
  if (value.startsWith('portable:')) {
    return value;
  }
  return normalizePortableRelativePath(value, 'diagnostic.path');
}

function readDirectOwnerModuleId(value: ProjectFactsJson): string | undefined {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? typeof value.ownerModuleId === 'string'
      ? value.ownerModuleId
      : undefined
    : undefined;
}

function collectOwnerModuleIds(value: ProjectFactsJson): string[] {
  const ownerIds = new Set<string>();
  visitJson(value, (key, entry) => {
    if (key === 'ownerModuleId' && typeof entry === 'string') {
      ownerIds.add(entry);
    }
  });
  return [...ownerIds].sort();
}

function buildExpectedModuleOwnership(
  files: readonly ProjectFactsInventoryFileV1[]
): Record<string, string[]> {
  const ownership = new Map<string, Set<string>>();
  for (const file of files) {
    for (const ownerModuleId of file.ownerModuleIds) {
      const ownedFiles = ownership.get(ownerModuleId) ?? new Set<string>();
      ownedFiles.add(file.relativePath);
      ownership.set(ownerModuleId, ownedFiles);
    }
  }
  return serializeModuleOwnership(ownership);
}

function collectModuleOwnership(value: ProjectFactsJson): Record<string, string[]> {
  const ownership = new Map<string, Set<string>>();
  const visitSeed = (entry: ProjectFactsJson): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visitSeed(item);
      }
      return;
    }
    if (!entry || typeof entry !== 'object') {
      return;
    }
    if (typeof entry.ownerModuleId === 'string' && Array.isArray(entry.ownedFiles)) {
      const ownedFiles = ownership.get(entry.ownerModuleId) ?? new Set<string>();
      for (const file of entry.ownedFiles) {
        if (typeof file === 'string') {
          ownedFiles.add(file);
        }
      }
      ownership.set(entry.ownerModuleId, ownedFiles);
    }
    for (const nested of Object.values(entry)) {
      visitSeed(nested);
    }
  };
  visitSeed(value);
  return serializeModuleOwnership(ownership);
}

function serializeModuleOwnership(
  ownership: ReadonlyMap<string, ReadonlySet<string>>
): Record<string, string[]> {
  return Object.fromEntries(
    [...ownership.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ownerModuleId, ownedFiles]) => [ownerModuleId, [...ownedFiles].sort()])
  );
}

function assertProjectionPayloadIsLineageFree(payload: ProjectFactsJson, consumer: string): void {
  const forbidden = new Set([
    'artifactId',
    'absolutePath',
    'createdAt',
    'projectRoot',
    'sourceVectorHash',
    'sourceRoot',
    'projectionContentHash',
    'consumerReceipt',
    'lease',
    'pid',
    'processId',
    'preparationId',
    'timestamp',
    'updatedAt',
  ]);
  visitJson(payload, (key) => {
    if (key && forbidden.has(key)) {
      throw new TypeError(`Projection ${consumer} contains circular lineage field ${key}.`);
    }
  });
  assertPortableSemanticJson(payload, `projection ${consumer}`);
}

function assertPortableSemanticJson(value: ProjectFactsJson, label: string): void {
  visitJson(value, (key, entry) => {
    if (
      typeof entry === 'string' &&
      key !== 'dataBase64' &&
      key !== 'previewBase64' &&
      key !== 'text' &&
      (path.posix.isAbsolute(entry.replace(/\\/g, '/')) || /^[A-Za-z]:[\\/]/.test(entry))
    ) {
      throw new TypeError(`${label} contains a host absolute path at ${key ?? '<root>'}.`);
    }
  });
}

function visitJson(
  value: ProjectFactsJson,
  visitor: (key: string | undefined, value: ProjectFactsJson) => void,
  key?: string
): void {
  visitor(key, value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitJson(entry, visitor);
    }
  } else if (value && typeof value === 'object') {
    for (const [entryKey, entry] of Object.entries(value)) {
      visitJson(entry, visitor, entryKey);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('ProjectContext capture aborted.');
  }
}

function isAbortLike(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

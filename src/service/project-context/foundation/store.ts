import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalHashDigest,
  canonicalJsonStringify,
  hashBytes,
  hashCanonicalJson,
} from './canonical.js';
import {
  createCertifiedProjectFactsCertificationReceipt,
  verifyCertifiedProjectFactsArtifact,
} from './capture.js';
import {
  type CanonicalSha256,
  CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
  type CertifiedProjectFactsArtifactId,
  type CertifiedProjectFactsArtifactV1,
  type CertifiedProjectFactsCertificationReceiptV1,
  type CertifiedProjectFactsPreparationReceiptV1,
  type CertifiedProjectFactsRunLeaseReceiptV1,
  type CertifiedProjectFactsStoreReceiptV1,
  type ProjectContextFoundationLogger,
} from './contracts.js';

interface StoredCertifiedProjectFactsArtifactV1
  extends Omit<
    CertifiedProjectFactsArtifactV1,
    'certification' | 'certificationBindingHash' | 'chunks' | 'readiness'
  > {
  chunks: Array<{ blobHash: CanonicalSha256; byteLength: number }>;
}

interface StoredPreparationV1 extends CertifiedProjectFactsPreparationReceiptV1 {}

interface StoredRunLeaseV1 {
  kind: 'CertifiedProjectFactsRunLease';
  schemaVersion: typeof CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION;
  artifactId: CertifiedProjectFactsArtifactId;
  certificationBindingHash: CanonicalSha256;
  preparationId: `prep-v1:${string}`;
  runId: string;
  state: 'active' | 'completed';
}

const DEFAULT_LOGGER: ProjectContextFoundationLogger = {
  info(message) {
    process.stdout.write(`[project-context-foundation] ${message}\n`);
  },
  warn(message) {
    process.stderr.write(`[project-context-foundation] ${message}\n`);
  },
};

export class ProjectFactsLeaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFactsLeaseConflictError';
  }
}

export class FileCertifiedProjectFactsStore {
  readonly #root: string;
  readonly #logger: ProjectContextFoundationLogger;

  constructor(root: string, options: { logger?: ProjectContextFoundationLogger } = {}) {
    if (!path.isAbsolute(root)) {
      throw new TypeError('Certified facts store root must be absolute.');
    }
    this.#root = path.resolve(root);
    this.#logger = options.logger ?? DEFAULT_LOGGER;
  }

  async put(
    artifact: CertifiedProjectFactsArtifactV1
  ): Promise<CertifiedProjectFactsStoreReceiptV1> {
    verifyCertifiedProjectFactsArtifact(artifact);
    if (artifact.readiness.verdict !== 'passed') {
      throw new TypeError('Refusing to store certified facts that failed strict readiness.');
    }
    await this.#ensureLayout();
    const blobRefs: string[] = [];
    for (const chunk of artifact.chunks) {
      const bytes = Buffer.from(chunk.dataBase64, 'base64');
      if (bytes.byteLength !== chunk.byteLength || hashBytes(bytes) !== chunk.blobHash) {
        throw new TypeError(`Refusing corrupt full chunk ${chunk.blobHash}.`);
      }
      const blobRef = this.#blobRef(chunk.blobHash);
      await this.#writeImmutable(blobRef, bytes);
      blobRefs.push(blobRef);
    }
    const storedArtifact: StoredCertifiedProjectFactsArtifactV1 = {
      schemaVersion: artifact.schemaVersion,
      artifactId: artifact.artifactId,
      sourceVectorHash: artifact.sourceVectorHash,
      factsContentHash: artifact.factsContentHash,
      manifest: artifact.manifest,
      facts: artifact.facts,
      projections: artifact.projections,
      chunks: artifact.chunks.map((chunk) => ({
        blobHash: chunk.blobHash,
        byteLength: chunk.byteLength,
      })),
    };
    const artifactRef = this.#artifactRef(artifact.artifactId);
    await this.#writeImmutable(artifactRef, canonicalJsonStringify(storedArtifact));
    const certificationReceipt = createCertifiedProjectFactsCertificationReceipt(artifact);
    const certificationReceiptRef = this.#certificationReceiptRef(
      artifact.certificationBindingHash
    );
    await this.#writeImmutable(
      certificationReceiptRef,
      canonicalJsonStringify(certificationReceipt)
    );
    const semantic = {
      kind: 'CertifiedProjectFactsStoreReceipt' as const,
      schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
      artifactId: artifact.artifactId,
      certificationBindingHash: artifact.certificationBindingHash,
      artifactRef,
      certificationReceiptRef,
      manifestHash: hashCanonicalJson(artifact.manifest),
      blobRefs: [...new Set(blobRefs)].sort(),
    };
    const receipt = { ...semantic, receiptHash: hashCanonicalJson(semantic) };
    const receiptRef = this.#storeReceiptRef(
      artifact.artifactId,
      artifact.certificationBindingHash
    );
    await this.#writeImmutable(receiptRef, canonicalJsonStringify(receipt));
    this.#logger.info(
      `stored artifact=${artifact.artifactId} blobs=${receipt.blobRefs.length} ref=${artifactRef}`
    );
    return receipt;
  }

  async open(
    artifactId: CertifiedProjectFactsArtifactId,
    certificationBindingHash: CanonicalSha256
  ): Promise<CertifiedProjectFactsArtifactV1> {
    const artifactRef = this.#artifactRef(artifactId);
    const stored = parseJson<StoredCertifiedProjectFactsArtifactV1>(
      await fs.readFile(this.#absolute(artifactRef), 'utf8'),
      artifactRef
    );
    const chunks = await Promise.all(
      stored.chunks.map(async (chunk) => {
        const blobRef = this.#blobRef(chunk.blobHash);
        const bytes = await fs.readFile(this.#absolute(blobRef));
        if (bytes.byteLength !== chunk.byteLength || hashBytes(bytes) !== chunk.blobHash) {
          throw new TypeError(`Stored full chunk failed readback verification: ${chunk.blobHash}.`);
        }
        return {
          ...chunk,
          dataBase64: bytes.toString('base64'),
        };
      })
    );
    const certificationReceiptRef = this.#certificationReceiptRef(certificationBindingHash);
    const certificationReceipt = parseJson<CertifiedProjectFactsCertificationReceiptV1>(
      await fs.readFile(this.#absolute(certificationReceiptRef), 'utf8'),
      certificationReceiptRef
    );
    verifyCertificationReceipt(certificationReceipt, artifactId, certificationBindingHash);
    const artifact: CertifiedProjectFactsArtifactV1 = {
      ...stored,
      certification: certificationReceipt.certification,
      certificationBindingHash: certificationReceipt.certificationBindingHash,
      readiness: certificationReceipt.readiness,
      chunks,
    };
    if (artifact.artifactId !== artifactId) {
      throw new TypeError(`Stored artifact path/id mismatch for ${artifactId}.`);
    }
    verifyCertifiedProjectFactsArtifact(artifact);
    if (
      certificationReceipt.manifestHash !== hashCanonicalJson(artifact.manifest) ||
      certificationReceipt.inventoryContentHash !== artifact.facts.inventory.inventoryContentHash ||
      certificationReceipt.includeExcludePolicyHash !==
        artifact.facts.inventory.includeExcludePolicyHash ||
      certificationReceipt.detailContentHash !== artifact.facts.detail.detailContentHash ||
      certificationReceipt.requestOutcomesHash !==
        hashCanonicalJson(artifact.facts.requestOutcomes) ||
      hashCanonicalJson(certificationReceipt.projectionContentHashes) !==
        hashCanonicalJson(artifact.manifest.projectionContentHashes)
    ) {
      throw new TypeError(`Certification receipt evidence mismatch for ${artifactId}.`);
    }
    this.#logger.info(`reopened artifact=${artifactId} blobs=${chunks.length}`);
    return artifact;
  }

  async createPreparation(
    artifactId: CertifiedProjectFactsArtifactId,
    certificationBindingHash: CanonicalSha256
  ): Promise<CertifiedProjectFactsPreparationReceiptV1> {
    await this.open(artifactId, certificationBindingHash);
    await this.#ensureLayout();
    const preparationId = `prep-v1:${randomUUID()}` as const;
    const preparationRef = this.#preparationRef(preparationId);
    const semantic = {
      kind: 'CertifiedProjectFactsPreparationReceipt' as const,
      schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
      artifactId,
      certificationBindingHash,
      preparationId,
      preparationRef,
    };
    const receipt = { ...semantic, receiptHash: hashCanonicalJson(semantic) };
    await this.#writeImmutable(preparationRef, canonicalJsonStringify(receipt));
    this.#logger.info(`created opaque preparation=${preparationId} artifact=${artifactId}`);
    return receipt;
  }

  async acquireRunLease(input: {
    preparationId: `prep-v1:${string}`;
    runId: string;
    expectedCertificationBindingHash: CanonicalSha256;
  }): Promise<CertifiedProjectFactsRunLeaseReceiptV1> {
    const runId = requireOpaqueId(input.runId, 'runId');
    const preparation = await this.#readPreparation(input.preparationId);
    if (preparation.certificationBindingHash !== input.expectedCertificationBindingHash) {
      throw new ProjectFactsLeaseConflictError(
        `Certified facts preparation ${preparation.preparationId} has a stale certification binding.`
      );
    }
    const leaseRef = this.#leaseRef(input.preparationId);
    const lease: StoredRunLeaseV1 = {
      kind: 'CertifiedProjectFactsRunLease',
      schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
      artifactId: preparation.artifactId,
      certificationBindingHash: preparation.certificationBindingHash,
      preparationId: preparation.preparationId,
      runId,
      state: 'active',
    };
    await fs.mkdir(path.dirname(this.#absolute(leaseRef)), { recursive: true });
    let status: CertifiedProjectFactsRunLeaseReceiptV1['status'] = 'acquired';
    try {
      await fs.writeFile(this.#absolute(leaseRef), canonicalJsonStringify(lease), {
        encoding: 'utf8',
        flag: 'wx',
      });
      this.#logger.info(
        `lease acquired preparation=${preparation.preparationId} run=${runId} artifact=${preparation.artifactId}`
      );
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      const existing = parseJson<StoredRunLeaseV1>(
        await fs.readFile(this.#absolute(leaseRef), 'utf8'),
        leaseRef
      );
      if (
        existing.preparationId !== preparation.preparationId ||
        existing.artifactId !== preparation.artifactId ||
        existing.certificationBindingHash !== preparation.certificationBindingHash ||
        existing.runId !== runId
      ) {
        this.#logger.warn(
          `lease conflict preparation=${preparation.preparationId} requestedRun=${runId} activeRun=${existing.runId}`
        );
        throw new ProjectFactsLeaseConflictError(
          `Certified facts preparation ${preparation.preparationId} is already bound to another run.`
        );
      }
      status = existing.state === 'completed' ? 'completed' : 'resumed';
      this.#logger.info(
        `lease ${status} preparation=${preparation.preparationId} run=${runId} artifact=${preparation.artifactId}`
      );
    }
    return createRunLeaseReceipt({
      artifactId: preparation.artifactId,
      certificationBindingHash: preparation.certificationBindingHash,
      preparationId: preparation.preparationId,
      runId,
      leaseRef,
      status,
    });
  }

  async completeRunLease(input: {
    preparationId: `prep-v1:${string}`;
    runId: string;
    expectedCertificationBindingHash: CanonicalSha256;
  }): Promise<CertifiedProjectFactsRunLeaseReceiptV1> {
    const current = await this.acquireRunLease(input);
    if (current.status !== 'completed') {
      const lease: StoredRunLeaseV1 = {
        kind: 'CertifiedProjectFactsRunLease',
        schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
        artifactId: current.artifactId,
        certificationBindingHash: current.certificationBindingHash,
        preparationId: current.preparationId,
        runId: current.runId,
        state: 'completed',
      };
      await this.#replaceAtomically(current.leaseRef, canonicalJsonStringify(lease));
      this.#logger.info(
        `lease completed preparation=${current.preparationId} run=${current.runId} artifact=${current.artifactId}`
      );
    }
    return createRunLeaseReceipt({ ...current, status: 'completed' });
  }

  async #readPreparation(preparationId: `prep-v1:${string}`): Promise<StoredPreparationV1> {
    if (!/^prep-v1:[0-9a-f-]{36}$/i.test(preparationId)) {
      throw new TypeError('Invalid certified facts preparationId.');
    }
    const preparationRef = this.#preparationRef(preparationId);
    const preparation = parseJson<StoredPreparationV1>(
      await fs.readFile(this.#absolute(preparationRef), 'utf8'),
      preparationRef
    );
    if (
      preparation.preparationId !== preparationId ||
      preparation.preparationRef !== preparationRef
    ) {
      throw new TypeError(`Preparation receipt/path mismatch for ${preparationId}.`);
    }
    const semantic = {
      kind: preparation.kind,
      schemaVersion: preparation.schemaVersion,
      artifactId: preparation.artifactId,
      certificationBindingHash: preparation.certificationBindingHash,
      preparationId: preparation.preparationId,
      preparationRef: preparation.preparationRef,
    };
    if (hashCanonicalJson(semantic) !== preparation.receiptHash) {
      throw new TypeError(`Preparation receipt hash mismatch for ${preparationId}.`);
    }
    return preparation;
  }

  async #ensureLayout(): Promise<void> {
    await Promise.all(
      ['artifacts', 'blobs', 'certification-receipts', 'preparations', 'leases'].map((directory) =>
        fs.mkdir(path.join(this.#root, directory), { recursive: true })
      )
    );
  }

  async #writeImmutable(relativeRef: string, content: string | Uint8Array): Promise<void> {
    const absolutePath = this.#absolute(relativeRef);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const bytes = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    try {
      await fs.writeFile(absolutePath, bytes, { flag: 'wx' });
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      const existing = await fs.readFile(absolutePath);
      if (!existing.equals(bytes)) {
        this.#logger.warn(`immutable content conflict ref=${relativeRef}`);
        throw new TypeError(`Content-addressed store collision at ${relativeRef}.`);
      }
      this.#logger.info(`immutable content replay matched ref=${relativeRef}`);
    }
  }

  async #replaceAtomically(relativeRef: string, content: string): Promise<void> {
    const absolutePath = this.#absolute(relativeRef);
    const temporaryPath = `${absolutePath}.tmp-${randomUUID()}`;
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, absolutePath);
  }

  #absolute(relativeRef: string): string {
    const absolutePath = path.resolve(this.#root, relativeRef);
    if (absolutePath !== this.#root && !absolutePath.startsWith(`${this.#root}${path.sep}`)) {
      throw new TypeError(`Store reference escapes its private root: ${relativeRef}.`);
    }
    return absolutePath;
  }

  #artifactRef(artifactId: CertifiedProjectFactsArtifactId): string {
    const digest = artifactDigest(artifactId);
    return `artifacts/${digest}/artifact.json`;
  }

  #storeReceiptRef(
    artifactId: CertifiedProjectFactsArtifactId,
    certificationBindingHash: CanonicalSha256
  ): string {
    const digest = artifactDigest(artifactId);
    return `artifacts/${digest}/store-receipts/${canonicalHashDigest(certificationBindingHash)}.json`;
  }

  #certificationReceiptRef(certificationBindingHash: CanonicalSha256): string {
    return `certification-receipts/${canonicalHashDigest(certificationBindingHash)}.json`;
  }

  #blobRef(blobHash: CanonicalSha256): string {
    return `blobs/${canonicalHashDigest(blobHash)}`;
  }

  #preparationRef(preparationId: `prep-v1:${string}`): string {
    return `preparations/${canonicalHashDigest(hashCanonicalJson(preparationId))}.json`;
  }

  #leaseRef(preparationId: `prep-v1:${string}`): string {
    return `leases/${canonicalHashDigest(hashCanonicalJson(preparationId))}.json`;
  }
}

export function serializeCertifiedProjectFactsArtifact(
  artifact: CertifiedProjectFactsArtifactV1
): string {
  verifyCertifiedProjectFactsArtifact(artifact);
  return canonicalJsonStringify(artifact);
}

export function deserializeCertifiedProjectFactsArtifact(
  serialized: string
): CertifiedProjectFactsArtifactV1 {
  const artifact = parseJson<CertifiedProjectFactsArtifactV1>(serialized, 'serialized artifact');
  verifyCertifiedProjectFactsArtifact(artifact);
  return artifact;
}

function createRunLeaseReceipt(input: {
  artifactId: CertifiedProjectFactsArtifactId;
  certificationBindingHash: CanonicalSha256;
  preparationId: `prep-v1:${string}`;
  runId: string;
  leaseRef: string;
  status: CertifiedProjectFactsRunLeaseReceiptV1['status'];
}): CertifiedProjectFactsRunLeaseReceiptV1 {
  const semantic = {
    kind: 'CertifiedProjectFactsRunLeaseReceipt' as const,
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    ...input,
  };
  return { ...semantic, receiptHash: hashCanonicalJson(semantic) };
}

function verifyCertificationReceipt(
  receipt: CertifiedProjectFactsCertificationReceiptV1,
  artifactId: CertifiedProjectFactsArtifactId,
  certificationBindingHash: CanonicalSha256
): void {
  const { receiptHash, ...semantic } = receipt;
  if (hashCanonicalJson(semantic) !== receiptHash) {
    throw new TypeError(`Certification receipt hash mismatch for ${artifactId}.`);
  }
  if (
    receipt.artifactId !== artifactId ||
    receipt.certificationBindingHash !== certificationBindingHash
  ) {
    throw new TypeError(`Certification receipt identity mismatch for ${artifactId}.`);
  }
  const expectedBinding = hashCanonicalJson({
    artifactId: receipt.artifactId,
    factsContentHash: receipt.factsContentHash,
    sourceVectorHash: receipt.sourceVectorHash,
    readiness: receipt.readiness,
    ...receipt.certification,
  });
  if (expectedBinding !== receipt.certificationBindingHash) {
    throw new TypeError(`Certification binding mismatch for ${artifactId}.`);
  }
}

function artifactDigest(artifactId: CertifiedProjectFactsArtifactId): string {
  const match = /^cpf-v1:([a-f0-9]{64})$/.exec(artifactId);
  if (!match) {
    throw new TypeError(`Invalid certified facts artifactId: ${artifactId}.`);
  }
  return match[1];
}

function requireOpaqueId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized || path.isAbsolute(normalized) || /[\\/]/.test(normalized)) {
    throw new TypeError(`${fieldName} must be an opaque identifier, not a path.`);
  }
  return normalized;
}

function parseJson<T>(serialized: string, label: string): T {
  try {
    return JSON.parse(serialized) as T;
  } catch (error) {
    throw new TypeError(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

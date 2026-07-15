import { canonicalHashDigest, hashCanonicalJson, toProjectFactsJson } from './canonical.js';
import type {
  CanonicalSha256,
  CertifiedProjectFactsArtifactV1,
  CertifiedProjectFactsConsumer,
  CertifiedProjectFactsConsumerBindingV1,
  CertifiedProjectFactsConsumerProjectionV2,
  ProjectContextConsumerProjectionReceiptV2,
} from './contracts.js';
import type { FileCertifiedProjectFactsStore } from './store.js';

/**
 * 后续 Alembic / Plugin adapter 只需注入此端口并消费命名 projection。
 * 端口不会 import live ProjectContext、旧 Plan collector 或 raw filesystem scanner；这些能力无法从
 * strict consumer 调用链回流，capture 和 consumption 因而保持单向。
 */
export class CertifiedProjectFactsConsumerPort {
  readonly #store: FileCertifiedProjectFactsStore;

  constructor(store: FileCertifiedProjectFactsStore) {
    this.#store = store;
  }

  async reopen(input: {
    preparationId: `prep-v1:${string}`;
    runId: string;
    consumer: CertifiedProjectFactsConsumer;
    expectedCertificationBindingHash: CanonicalSha256;
  }): Promise<CertifiedProjectFactsConsumerBindingV1> {
    const lease = await this.#store.acquireRunLease({
      preparationId: input.preparationId,
      runId: input.runId,
      expectedCertificationBindingHash: input.expectedCertificationBindingHash,
    });
    const artifact = await this.#store.open(lease.artifactId, lease.certificationBindingHash);
    const projection = artifact.projections[input.consumer];
    if (!projection) {
      throw new TypeError(`Certified facts projection is unavailable: ${input.consumer}.`);
    }
    return {
      artifactId: artifact.artifactId,
      sourceVectorHash: artifact.sourceVectorHash,
      factsContentHash: artifact.factsContentHash,
      certificationBindingHash: artifact.certificationBindingHash,
      consumer: input.consumer,
      projectionContentHash: projection.projectionContentHash,
      payload: projection.payload,
      lease,
    };
  }

  async reopenWithAdapter(input: {
    preparationId: `prep-v1:${string}`;
    runId: string;
    consumer: CertifiedProjectFactsConsumer;
    expectedCertificationBindingHash: CanonicalSha256;
    adapter: {
      adapterVersion: string;
      entrypoint: string;
      payloadSchemaHash: CanonicalSha256;
      loadEvidenceHash: CanonicalSha256;
      project(artifact: Readonly<CertifiedProjectFactsArtifactV1>): unknown | Promise<unknown>;
    };
  }): Promise<CertifiedProjectFactsConsumerProjectionV2> {
    const lease = await this.#store.acquireRunLease({
      preparationId: input.preparationId,
      runId: input.runId,
      expectedCertificationBindingHash: input.expectedCertificationBindingHash,
    });
    const artifact = await this.#store.open(lease.artifactId, lease.certificationBindingHash);
    const adapterVersion = requireAdapterToken(input.adapter.adapterVersion, 'adapterVersion');
    const entrypoint = requireActualAdapterEntrypoint(input.adapter.entrypoint);
    canonicalHashDigest(input.adapter.payloadSchemaHash);
    canonicalHashDigest(input.adapter.loadEvidenceHash);
    const sealedBase = {
      artifactId: artifact.artifactId,
      sourceVectorHash: artifact.sourceVectorHash,
      factsContentHash: artifact.factsContentHash,
      certificationBindingHash: artifact.certificationBindingHash,
    };
    const adapterView = deepFreeze(artifact);
    const payload = toProjectFactsJson(await input.adapter.project(adapterView));
    const projectionContentHash = hashCanonicalJson(payload);
    const semantic = {
      kind: 'ProjectContextConsumerProjectionReceiptV2' as const,
      version: 2 as const,
      ...sealedBase,
      consumer: input.consumer,
      adapterVersion,
      projectionContentHash,
      entrypoint,
      runId: requireAdapterToken(input.runId, 'runId'),
      payloadSchemaHash: input.adapter.payloadSchemaHash,
      loadEvidenceHash: input.adapter.loadEvidenceHash,
    };
    const receipt: ProjectContextConsumerProjectionReceiptV2 = {
      ...semantic,
      receiptHash: hashCanonicalJson(semantic),
    };
    return {
      payload,
      receipt,
      binding: {
        artifactId: artifact.artifactId,
        sourceVectorHash: artifact.sourceVectorHash,
        factsContentHash: artifact.factsContentHash,
        certificationBindingHash: artifact.certificationBindingHash,
        consumer: input.consumer,
        projectionContentHash,
        payload,
        lease,
      },
    };
  }
}

function requireActualAdapterEntrypoint(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /(^|\/)(audit|scripts?\/audit|capture)([./-]|\/|$)/i.test(normalized) ||
    /placeholder/i.test(normalized)
  ) {
    throw new TypeError(
      'A strict projection receipt requires an actual loaded adapter entrypoint.'
    );
  }
  return normalized;
}

function requireAdapterToken(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized || /[\\/]/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a non-empty opaque value.`);
  }
  return normalized;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

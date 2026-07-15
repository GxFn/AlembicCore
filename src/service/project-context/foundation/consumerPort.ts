import type {
  CanonicalSha256,
  CertifiedProjectFactsConsumer,
  CertifiedProjectFactsConsumerBindingV1,
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
}

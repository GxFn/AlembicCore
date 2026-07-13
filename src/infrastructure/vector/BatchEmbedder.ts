/**
 * BatchEmbedder — 批量 embedding, 支持背压控制
 *
 * 只依赖外部注入的 embedding provider contract:
 * - 支持批量: embed(string[]) → number[][]
 * - 只支持单条: embed(string) → number[]
 *
 * 使用 p-limit 并发控制, 避免 API 限流:
 * - 每批 batchSize (默认 32) 条文本
 * - 最多 maxConcurrency (默认 2) 个批次并行
 *
 * 性能: 100 chunks × 串行 300ms = 30s → 批量 ≈ 0.6s (50× 加速)
 *
 * @module infrastructure/vector/BatchEmbedder
 */

import type { EmbeddingPort, LegacyEmbedProvider } from '../../service/vector/EmbeddingPort.js';
import { createLimit } from '../../shared/concurrency.js';
import Logger from '../logging/Logger.js';

export interface EmbeddingProvider extends LegacyEmbedProvider {
  /**
   * Optional transport capacity hint (AD5; AlembicAgent 637d094 contract):
   * mirrors the provider's live request gate so Core batches at the exact
   * ceiling embedding calls already queue against.
   */
  getEmbeddingCapacityHint?(): {
    provider: string;
    maxInFlightEmbeddings: number;
    source: string;
  };
}

export class BatchEmbedder {
  #embeddingPort: EmbeddingPort | null;
  #batchSize;
  #maxConcurrency;

  /** @param embeddingProvider 外部注入的 embedding provider, Core 不拥有具体 provider 或密钥 */
  constructor(
    embeddingProvider: EmbeddingPort | EmbeddingProvider | null,
    options: { batchSize?: number; maxConcurrency?: number } = {}
  ) {
    this.#embeddingPort = embeddingProvider ? toEmbeddingPort(embeddingProvider) : null;
    this.#batchSize = options.batchSize || 32;
    // Concurrency resolution (AD5 provider-aware upgrade): explicit option
    // wins; otherwise the injected provider's transport capacity hint;
    // otherwise the historical default of 2. The chosen value and its
    // source are logged once per embedder so throttling stays observable.
    let concurrency = 2;
    let concurrencySource = 'default';
    const hint = (
      embeddingProvider as Partial<EmbeddingProvider> | null
    )?.getEmbeddingCapacityHint?.();
    if (typeof hint?.maxInFlightEmbeddings === 'number' && hint.maxInFlightEmbeddings >= 1) {
      concurrency = Math.floor(hint.maxInFlightEmbeddings);
      concurrencySource = `provider-hint(${hint.provider}/${hint.source})`;
    }
    if (options.maxConcurrency) {
      concurrency = options.maxConcurrency;
      concurrencySource = 'options';
    }
    this.#maxConcurrency = concurrency;
    Logger.getInstance().debug('[BatchEmbedder] concurrency resolved', {
      concurrency,
      source: concurrencySource,
      batchSize: this.#batchSize,
    });
  }

  /**
   * 批量 embed 文本
   *
   * @param items
   * @param [onProgress] (embedded, total) => void
   * @returns id → vector
   */
  async embedAll(
    items: Array<{ id: string; content: string }>,
    onProgress?: (embedded: number, total: number) => void
  ) {
    if (!this.#embeddingPort) {
      return new Map();
    }
    const results = new Map();
    const batches = this.#chunkArray(items, this.#batchSize);
    const limit = createLimit(this.#maxConcurrency);

    // p-limit 并发控制
    await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          const batchResult = await this.#embedBatch(batch);
          for (const [id, vector] of batchResult) {
            results.set(id, vector);
          }
          onProgress?.(results.size, items.length);
          return batchResult;
        })
      )
    );

    return results;
  }

  /**
   * embed 单个批次
   * @param items
   */
  async #embedBatch(items: Array<{ id: string; content: string }>) {
    const result = new Map();

    try {
      // 截断过长文本 (8K 字符限制)
      const texts = items.map((item) => (item.content || '').slice(0, 8000));
      const vectors = await this.#embeddingPort!.embedDocuments(texts);

      // 批量 provider 返回 number[][]; 单条 provider 可能返回 number[]。
      if (Array.isArray(vectors) && Array.isArray(vectors[0])) {
        // 批量返回
        items.forEach((item, idx) => {
          if (vectors[idx]) {
            result.set(item.id, vectors[idx]);
          }
        });
      } else if (Array.isArray(vectors) && typeof vectors[0] === 'number') {
        // 单条返回 (只有一个元素或 provider 不支持批量)
        if (items.length === 1) {
          result.set(items[0].id, vectors);
        } else {
          // provider 不支持批量, 降级到串行
          for (const item of items) {
            try {
              const vec = await this.#embeddingPort!.embedDocuments([item.content.slice(0, 8000)]);
              result.set(item.id, vec[0]);
            } catch {
              /* skip failed embed */
            }
          }
        }
      }
    } catch {
      // 整批失败, 降级到逐条
      for (const item of items) {
        try {
          const vec = await this.#embeddingPort!.embedDocuments([item.content.slice(0, 8000)]);
          if (vec[0]) {
            result.set(item.id, vec[0]);
          }
        } catch {
          /* skip */
        }
      }
    }

    return result;
  }

  /** 将数组分成固定大小的批次 */
  #chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

function toEmbeddingPort(provider: EmbeddingPort | EmbeddingProvider): EmbeddingPort {
  if (
    'embedDocuments' in provider &&
    typeof provider.embedDocuments === 'function' &&
    'embedQuery' in provider &&
    typeof provider.embedQuery === 'function'
  ) {
    return provider;
  }
  const legacy = provider as EmbeddingProvider;
  return {
    describeCapabilities: () => ({
      batchSupported: true,
      formatProfile: 'symmetric',
      inputKinds: ['query', 'document'],
      normalization: 'provider-defined',
      provider: legacy.getEmbeddingCapacityHint?.().provider ?? 'legacy',
    }),
    embedDocuments: async (texts) => {
      try {
        const result = await legacy.embed([...texts]);
        if (Array.isArray(result[0])) {
          return result as number[][];
        }
        if (texts.length === 1) {
          return [result as number[]];
        }
      } catch {
        // Single-only legacy transports are serialized below.
      }
      const vectors: number[][] = [];
      for (const text of texts) {
        const result = await legacy.embed(text);
        vectors.push(
          Array.isArray(result[0]) ? ((result as number[][])[0] ?? []) : (result as number[])
        );
      }
      return vectors;
    },
    embedQuery: async (text) => {
      const result = await legacy.embed(text);
      return Array.isArray(result[0]) ? ((result as number[][])[0] ?? []) : (result as number[]);
    },
  };
}

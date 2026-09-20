import Logger from '../logging/Logger.js';

export type EmbeddingInputKind = 'query' | 'document';

export interface EmbeddingExecutionContext {
  signal?: AbortSignal;
}

export interface EmbeddingCapabilityDescriptor {
  provider: string;
  model?: string;
  dimension?: number;
  inputKinds: readonly EmbeddingInputKind[];
  batchSupported: boolean;
  normalization: 'normalized' | 'not-normalized' | 'provider-defined';
  formatProfile: 'symmetric' | 'asymmetric';
}

export interface EmbeddingPort {
  embedQuery(text: string, context?: EmbeddingExecutionContext): Promise<number[]>;
  embedDocuments(
    texts: readonly string[],
    context?: EmbeddingExecutionContext
  ): Promise<number[][]>;
  describeCapabilities(): EmbeddingCapabilityDescriptor;
}

export interface LegacyEmbedProvider {
  embed(texts: string | string[]): Promise<number[] | number[][]>;
  isAvailable?(): Promise<boolean>;
  getEmbeddingCapacityHint?(): {
    provider: string;
    maxInFlightEmbeddings: number;
    source: string;
  };
}

export interface LegacyEmbedProviderAdapterOptions {
  provider?: string;
  model?: string;
  dimension?: number;
  batchSupported?: boolean;
  normalization?: EmbeddingCapabilityDescriptor['normalization'];
}

/**
 * Compatibility adapter for providers whose historical API did not distinguish
 * query and document purposes. The descriptor deliberately reports a symmetric
 * format profile; callers never have to infer provider-specific formatting.
 */
export class LegacyEmbedProviderAdapter implements EmbeddingPort {
  readonly #provider: LegacyEmbedProvider;
  readonly #descriptor: EmbeddingCapabilityDescriptor;

  constructor(provider: LegacyEmbedProvider, options: LegacyEmbedProviderAdapterOptions = {}) {
    this.#provider = provider;
    this.#descriptor = Object.freeze({
      batchSupported: options.batchSupported ?? true,
      ...(options.dimension === undefined ? {} : { dimension: options.dimension }),
      formatProfile: 'symmetric' as const,
      inputKinds: ['query', 'document'] as const,
      ...(options.model ? { model: options.model } : {}),
      normalization: options.normalization ?? 'provider-defined',
      provider: options.provider ?? 'legacy',
    });
  }

  async embedQuery(text: string, context?: EmbeddingExecutionContext): Promise<number[]> {
    context?.signal?.throwIfAborted();
    const result = await this.#provider.embed(text);
    context?.signal?.throwIfAborted();
    return normalizeSingleEmbedding(result);
  }

  async embedDocuments(
    texts: readonly string[],
    context?: EmbeddingExecutionContext
  ): Promise<number[][]> {
    context?.signal?.throwIfAborted();
    if (texts.length === 0) {
      return [];
    }
    if (this.#descriptor.batchSupported) {
      try {
        const result = await this.#provider.embed([...texts]);
        context?.signal?.throwIfAborted();
        if (Array.isArray(result[0])) {
          return result as number[][];
        }
        if (texts.length === 1) {
          return [result as number[]];
        }
      } catch (error) {
        if (context?.signal?.aborted) {
          throw error;
        }
        Logger.getInstance().warn('Legacy embedding batch failed; using serial document requests', {
          provider: this.#descriptor.provider,
          count: texts.length,
          // provider 的异常文本可能回显文档，诊断只记录本地原因，不复制原始错误。
          reason: 'batch-request-failed',
        });
      }
    }

    Logger.getInstance().debug('Legacy embedding serial path selected', {
      provider: this.#descriptor.provider,
      count: texts.length,
      batchSupported: this.#descriptor.batchSupported,
    });
    const embeddings: number[][] = [];
    for (const text of texts) {
      context?.signal?.throwIfAborted();
      const result = await this.#provider.embed(text);
      // provider 不接收 signal；最后一次 await 后也须拒绝已取消结果，不能把取消报告为完成。
      context?.signal?.throwIfAborted();
      embeddings.push(normalizeSingleEmbedding(result));
    }
    return embeddings;
  }

  describeCapabilities(): EmbeddingCapabilityDescriptor {
    return this.#descriptor;
  }

  get legacyProvider(): LegacyEmbedProvider {
    return this.#provider;
  }
}

export function isEmbeddingPort(value: unknown): value is EmbeddingPort {
  const candidate = value as Partial<EmbeddingPort> | null;
  return (
    typeof candidate?.embedQuery === 'function' &&
    typeof candidate?.embedDocuments === 'function' &&
    typeof candidate?.describeCapabilities === 'function'
  );
}

export function asEmbeddingPort(
  provider: EmbeddingPort | LegacyEmbedProvider,
  options: LegacyEmbedProviderAdapterOptions = {}
): EmbeddingPort {
  return isEmbeddingPort(provider) ? provider : new LegacyEmbedProviderAdapter(provider, options);
}

function normalizeSingleEmbedding(result: number[] | number[][]): number[] {
  return Array.isArray(result[0]) ? ((result as number[][])[0] ?? []) : (result as number[]);
}

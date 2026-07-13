import { describe, expect, it, vi } from 'vitest';
import { BatchEmbedder } from '../src/infrastructure/vector/BatchEmbedder.js';
import {
  type LegacyEmbedProvider,
  LegacyEmbedProviderAdapter,
} from '../src/service/vector/EmbeddingPort.js';

describe('EmbeddingPort', () => {
  it('keeps query and document purposes explicit while honestly adapting symmetric providers', async () => {
    const embed = vi.fn(async (value: string | string[]) =>
      typeof value === 'string' ? [value.length] : value.map((item) => [item.length])
    );
    const legacy: LegacyEmbedProvider = { embed };
    const port = new LegacyEmbedProviderAdapter(legacy, {
      dimension: 1,
      model: 'fixture-model',
      provider: 'fixture',
    });

    await expect(port.embedQuery('query')).resolves.toEqual([5]);
    await expect(port.embedDocuments(['one', 'three'])).resolves.toEqual([[3], [5]]);
    expect(port.describeCapabilities()).toEqual({
      batchSupported: true,
      dimension: 1,
      formatProfile: 'symmetric',
      inputKinds: ['query', 'document'],
      model: 'fixture-model',
      normalization: 'provider-defined',
      provider: 'fixture',
    });
    expect(embed).toHaveBeenNthCalledWith(1, 'query');
    expect(embed).toHaveBeenNthCalledWith(2, ['one', 'three']);
  });

  it('routes BatchEmbedder through document embedding rather than the legacy method', async () => {
    const embedDocuments = vi.fn(async (texts: readonly string[]) =>
      texts.map((text) => [text.length])
    );
    const port = {
      describeCapabilities: () => ({
        batchSupported: true,
        formatProfile: 'symmetric' as const,
        inputKinds: ['query', 'document'] as const,
        normalization: 'provider-defined' as const,
        provider: 'fixture',
      }),
      embedDocuments,
      embedQuery: vi.fn(),
    };

    const result = await new BatchEmbedder(port).embedAll([{ content: 'document', id: 'doc-1' }]);

    expect(result.get('doc-1')).toEqual([8]);
    expect(embedDocuments).toHaveBeenCalledWith(['document']);
    expect(port.embedQuery).not.toHaveBeenCalled();
  });

  it('serializes a legacy provider that declares batch unsupported', async () => {
    const embed = vi.fn(async (value: string | string[]) => {
      if (Array.isArray(value)) {
        throw new Error('batch unsupported');
      }
      return [value.length];
    });
    const port = new LegacyEmbedProviderAdapter(
      { embed },
      { batchSupported: false, provider: 'single-only' }
    );

    await expect(port.embedDocuments(['a', 'three'])).resolves.toEqual([[1], [5]]);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed).toHaveBeenNthCalledWith(1, 'a');
  });

  it('keeps BatchEmbedder compatible with a single-only legacy transport', async () => {
    const embed = vi.fn(async (value: string | string[]) => {
      if (Array.isArray(value)) {
        throw new Error('single only');
      }
      return [value.length];
    });

    const result = await new BatchEmbedder({ embed }).embedAll([
      { content: 'a', id: 'a' },
      { content: 'three', id: 'b' },
    ]);

    expect([...result.entries()]).toEqual([
      ['a', [1]],
      ['b', [5]],
    ]);
  });
});

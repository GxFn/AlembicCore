import { afterEach, describe, expect, it, vi } from 'vitest';
import Logger from '../src/infrastructure/logging/Logger.js';
import { BatchEmbedder } from '../src/infrastructure/vector/BatchEmbedder.js';
import {
  type LegacyEmbedProvider,
  LegacyEmbedProviderAdapter,
} from '../src/service/vector/EmbeddingPort.js';

describe('EmbeddingPort', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    'declared-serial',
    'rejected-batch',
    'flat-batch',
  ] as const)('rejects the original cancellation reason after the final await (%s)', async (mode) => {
    const controller = new AbortController();
    const reason = new Error('cancelled while final document was pending');
    const port = new LegacyEmbedProviderAdapter(
      {
        embed: async (input) => {
          if (Array.isArray(input)) {
            if (mode === 'rejected-batch') {
              throw new Error('batch unsupported');
            }
            return [0.5];
          }
          if (input === 'last') {
            controller.abort(reason);
          }
          return [input.length];
        },
      },
      { batchSupported: mode !== 'declared-serial' }
    );
    await expect(
      port.embedDocuments(['first', 'last'], { signal: controller.signal })
    ).rejects.toBe(reason);
  });

  it('keeps the existing two-method native route even without a capability descriptor', async () => {
    const provider = {
      embed: vi.fn(async () => {
        throw new Error('legacy transport must not be selected');
      }),
      embedQuery: vi.fn(async () => [1]),
      embedDocuments: vi.fn(async () => [[7]]),
    };
    expect([
      ...(await new BatchEmbedder(provider).embedAll([{ id: 'doc', content: 'document' }])),
    ]).toEqual([['doc', [7]]]);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.embedQuery).not.toHaveBeenCalled();
  });

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

  it('falls back to single-only legacy transport without logging document content', async () => {
    const content = 'document-with-private-content';
    const warnings = vi.spyOn(Logger.getInstance(), 'warn').mockImplementation(() => {});
    const embed = vi.fn(async (value: string | string[]) => {
      if (Array.isArray(value)) {
        throw new Error(`single only: ${value.join('|')}`);
      }
      return [value.length];
    });

    const result = await new BatchEmbedder({ embed }).embedAll([
      { content: 'a', id: 'a' },
      { content, id: 'b' },
    ]);

    expect([...result.entries()]).toEqual([
      ['a', [1]],
      ['b', [content.length]],
    ]);
    expect(warnings).toHaveBeenCalled();
    expect(JSON.stringify(warnings.mock.calls)).not.toContain(content);
  });
});

// GMAP-L1 — OllamaEmbedProvider over a mocked HTTP transport. Covers the
// EmbedProvider contract (single/batch), honest error + length-mismatch
// surfacing, request timeout, and the availability probe (model present /
// absent / endpoint unreachable). No real Ollama daemon is required.

import { describe, expect, it } from 'vitest';
import {
  type FetchLike,
  type FetchRequestInit,
  type FetchResponseLike,
  OllamaEmbedProvider,
} from '../src/vector.js';

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {}
): FetchResponseLike {
  return {
    json: async () => body,
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  };
}

function routeFetch(routes: { embed?: FetchResponseLike; tags?: FetchResponseLike }): FetchLike {
  return async (url) => {
    if (url.endsWith('/api/embed') && routes.embed) {
      return routes.embed;
    }
    if (url.endsWith('/api/tags') && routes.tags) {
      return routes.tags;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

describe('OllamaEmbedProvider — embed', () => {
  it('embeds a single string into a flat vector', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ embed: jsonResponse({ embeddings: [[1, 2, 3]] }) }),
      model: 'qwen3',
    });
    const result = await provider.embed('hello');
    expect(result).toEqual([1, 2, 3]);
  });

  it('embeds a batch into one vector per input, in order', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ embed: jsonResponse({ embeddings: [[1], [2]] }) }),
      model: 'qwen3',
    });
    const result = await provider.embed(['a', 'b']);
    expect(result).toEqual([[1], [2]]);
  });

  it('returns empty without calling the daemon for an empty batch', async () => {
    let called = false;
    const provider = new OllamaEmbedProvider({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({ embeddings: [] });
      },
      model: 'qwen3',
    });
    expect(await provider.embed([])).toEqual([]);
    expect(called).toBe(false);
  });

  it('throws an honest error on a non-2xx response', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ embed: jsonResponse({ error: 'boom' }, { ok: false, status: 500 }) }),
      model: 'qwen3',
    });
    await expect(provider.embed('x')).rejects.toThrow(/HTTP 500/);
  });

  it('throws when the embedding count does not match the input count', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ embed: jsonResponse({ embeddings: [[1]] }) }),
      model: 'qwen3',
    });
    await expect(provider.embed(['a', 'b'])).rejects.toThrow(/embeddings for 2 input/);
  });

  it('times out a hung request with an honest error', async () => {
    const hangingFetch: FetchLike = (_url, init?: FetchRequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const provider = new OllamaEmbedProvider({
      fetchImpl: hangingFetch,
      model: 'qwen3',
      timeoutMs: 20,
    });
    await expect(provider.embed('x')).rejects.toThrow(/timed out after 20ms/);
  });

  it('preserves caller cancellation as AbortError rather than reporting a timeout', async () => {
    const hangingFetch: FetchLike = (_url, init?: FetchRequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const controller = new AbortController();
    const provider = new OllamaEmbedProvider({
      fetchImpl: hangingFetch,
      model: 'qwen3',
      timeoutMs: 1_000,
    });
    const pending = provider.embedQuery('x', { signal: controller.signal });
    controller.abort('caller-cancelled');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toThrow(/timed out/);
  });
});

describe('OllamaEmbedProvider — availability probe', () => {
  it('reports available when the endpoint is up and the model is pulled', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ tags: jsonResponse({ models: [{ name: 'qwen3:0.6b' }] }) }),
      model: 'qwen3',
    });
    const probe = await provider.probe();
    expect(probe.available).toBe(true);
    expect(probe.models).toContain('qwen3:0.6b');
    expect(await provider.isAvailable()).toBe(true);
  });

  it('reports unavailable with a reason when the model is not pulled', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: routeFetch({ tags: jsonResponse({ models: [{ name: 'llama3' }] }) }),
      model: 'qwen3',
    });
    const probe = await provider.probe();
    expect(probe.available).toBe(false);
    expect(probe.reason).toMatch(/not pulled/);
  });

  it('reports unavailable when the endpoint is unreachable', async () => {
    const provider = new OllamaEmbedProvider({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
      model: 'qwen3',
    });
    const probe = await provider.probe();
    expect(probe.available).toBe(false);
    expect(probe.reason).toMatch(/ECONNREFUSED/);
    expect(await provider.isAvailable()).toBe(false);
  });
});

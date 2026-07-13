// OllamaEmbedProvider (GMAP-L1) — a lightweight, self-contained EmbedProvider
// that talks to a locally-installed Ollama over plain HTTP. It is a pure HTTP
// client: NO native inference dependency, NO model bundling or download
// (transformers.js / onnxruntime / llama.cpp are explicitly out of scope — the
// user installs Ollama and pulls the model). Injected into VectorService.
// embedProvider, it transparently drives RecipeContext / prime semantic search.

import type {
  EmbeddingCapabilityDescriptor,
  EmbeddingExecutionContext,
  EmbeddingPort,
  LegacyEmbedProvider,
} from '../../service/vector/EmbeddingPort.js';
import Logger from '../logging/Logger.js';

/** Minimal structural fetch contract so Core needs no DOM lib + is testable. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchLike = (input: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

export interface OllamaEmbedProviderConfig {
  /** Ollama model name, e.g. "qwen3-embedding" or "nomic-embed-text:latest". */
  model: string;
  /** Base endpoint; defaults to the local Ollama daemon. */
  endpoint?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Transport capacity hint mirrored to BatchEmbedder (default 2). */
  maxInFlightEmbeddings?: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export interface OllamaProbeResult {
  available: boolean;
  endpoint: string;
  model: string;
  models?: string[];
  reason?: string;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IN_FLIGHT = 2;

const defaultFetch: FetchLike = (input, init) =>
  (
    globalThis as unknown as {
      fetch: (i: string, o?: FetchRequestInit) => Promise<FetchResponseLike>;
    }
  ).fetch(input, init);

export class OllamaEmbedProvider implements EmbeddingPort, LegacyEmbedProvider {
  readonly model: string;
  readonly endpoint: string;
  readonly #timeoutMs: number;
  readonly #maxInFlight: number;
  readonly #fetch: FetchLike;
  readonly #logger = Logger.getInstance();

  constructor(config: OllamaEmbedProviderConfig) {
    if (!config || typeof config.model !== 'string' || config.model.trim().length === 0) {
      throw new Error('OllamaEmbedProvider requires a non-empty model name.');
    }
    this.model = config.model.trim();
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxInFlight = config.maxInFlightEmbeddings ?? DEFAULT_MAX_IN_FLIGHT;
    this.#fetch = config.fetchImpl ?? defaultFetch;
  }

  /** EmbedProvider contract: string -> number[]; string[] -> number[][]. */
  async embed(texts: string | string[]): Promise<number[] | number[][]> {
    const single = typeof texts === 'string';
    const input = single ? [texts] : texts;
    if (input.length === 0) {
      return single ? [] : [];
    }
    const embeddings = await this.#embedBatch(input);
    return single ? embeddings[0] : embeddings;
  }

  async embedQuery(text: string, context?: EmbeddingExecutionContext): Promise<number[]> {
    return (await this.#embedBatch([text], context?.signal))[0] ?? [];
  }

  async embedDocuments(
    texts: readonly string[],
    context?: EmbeddingExecutionContext
  ): Promise<number[][]> {
    return texts.length === 0 ? [] : this.#embedBatch([...texts], context?.signal);
  }

  describeCapabilities(): EmbeddingCapabilityDescriptor {
    return {
      batchSupported: true,
      formatProfile: 'symmetric',
      inputKinds: ['query', 'document'],
      model: this.model,
      normalization: 'provider-defined',
      provider: 'ollama',
    };
  }

  async #embedBatch(input: string[], signal?: AbortSignal): Promise<number[][]> {
    // /api/embed is batch-native: input may be a string[] and returns one
    // embedding per input in order.
    const response = await this.#request(
      'POST',
      '/api/embed',
      {
        input,
        model: this.model,
      },
      signal
    );
    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(
        `Ollama /api/embed failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''} (model ${this.model}, endpoint ${this.endpoint}).`
      );
    }
    const data = (await response.json()) as { embeddings?: unknown } | null;
    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
      throw new Error(
        `Ollama /api/embed returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} embeddings for ${input.length} input(s) (model ${this.model}).`
      );
    }
    return embeddings as number[][];
  }

  /** True when the endpoint is reachable AND the configured model is pulled. */
  async isAvailable(): Promise<boolean> {
    return (await this.probe()).available;
  }

  /** Honest availability probe: /api/tags reachable + model present. */
  async probe(): Promise<OllamaProbeResult> {
    try {
      const response = await this.#request('GET', '/api/tags');
      if (!response.ok) {
        return {
          available: false,
          endpoint: this.endpoint,
          model: this.model,
          reason: `/api/tags returned HTTP ${response.status}`,
        };
      }
      const data = (await response.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      } | null;
      const names = (data?.models ?? [])
        .flatMap((entry) => [entry?.name, entry?.model])
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      const present = names.some((name) => modelMatches(name, this.model));
      if (!present) {
        return {
          available: false,
          endpoint: this.endpoint,
          model: this.model,
          models: names,
          reason: `model "${this.model}" is not pulled (available: ${names.join(', ') || 'none'})`,
        };
      }
      return { available: true, endpoint: this.endpoint, model: this.model, models: names };
    } catch (error) {
      return {
        available: false,
        endpoint: this.endpoint,
        model: this.model,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Transport capacity hint consumed by BatchEmbedder (AD5 contract). */
  getEmbeddingCapacityHint(): {
    provider: string;
    maxInFlightEmbeddings: number;
    source: string;
  } {
    return {
      maxInFlightEmbeddings: this.#maxInFlight,
      provider: 'ollama',
      source: 'OllamaEmbedProvider config',
    };
  }

  async #request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<FetchResponseLike> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(`${this.endpoint}${path}`, {
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        method,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        if (signal.reason instanceof Error && signal.reason.name === 'AbortError') {
          throw signal.reason;
        }
        const abortError = new Error(
          signal.reason instanceof Error ? signal.reason.message : 'Ollama embedding cancelled.'
        );
        abortError.name = 'AbortError';
        throw abortError;
      }
      if (isAbortError(error)) {
        throw new Error(
          `Ollama ${method} ${path} timed out after ${this.#timeoutMs}ms (endpoint ${this.endpoint}).`
        );
      }
      this.#logger.debug('[OllamaEmbedProvider] request failed', {
        error: error instanceof Error ? error.message : String(error),
        path,
      });
      throw error instanceof Error
        ? error
        : new Error(`Ollama ${method} ${path} failed: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Match an installed model name against a requested one, tolerating tags. */
function modelMatches(have: string, want: string): boolean {
  if (have === want) {
    return true;
  }
  if (have.startsWith(`${want}:`) || want.startsWith(`${have}:`)) {
    return true;
  }
  return have.split(':')[0] === want.split(':')[0];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function safeText(response: FetchResponseLike): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

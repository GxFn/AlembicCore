export interface VectorIndexItem {
  id: string;
  content: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorIndexHit {
  item: Record<string, unknown>;
  score: number;
}

export interface VectorIndexStats {
  count: number;
  indexSize: number;
  dimension?: number;
}

export interface VectorIndexReader {
  searchVector(
    queryVector: number[],
    options?: { topK?: number; filter?: unknown; minScore?: number }
  ): Promise<VectorIndexHit[]>;
  getById(id: string): Promise<Record<string, unknown> | null>;
  getStats(): Promise<VectorIndexStats>;
  listIds(options?: { limit?: number }): Promise<string[]>;
}

export interface VectorIndexWriter {
  upsert(item: VectorIndexItem): Promise<void>;
  batchUpsert(items: VectorIndexItem[]): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface VectorIndexReaderSource {
  searchVector(queryVector: number[], options?: Record<string, unknown>): Promise<VectorIndexHit[]>;
  getById(id: string): Promise<Record<string, unknown> | null>;
  getStats(): Promise<VectorIndexStats>;
  listIds(): Promise<string[]>;
}

export interface VectorIndexWriterSource {
  upsert(item: VectorIndexItem): Promise<void>;
  batchUpsert(items: VectorIndexItem[]): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Reader-only view over existing HNSW/JSON stores. */
export class VectorIndexReaderAdapter implements VectorIndexReader {
  readonly #source: VectorIndexReaderSource;

  constructor(source: VectorIndexReaderSource) {
    this.#source = source;
  }

  searchVector(
    queryVector: number[],
    options: { topK?: number; filter?: unknown; minScore?: number } = {}
  ): Promise<VectorIndexHit[]> {
    return this.#source.searchVector(queryVector, options);
  }

  getById(id: string): Promise<Record<string, unknown> | null> {
    return this.#source.getById(id);
  }

  getStats(): Promise<VectorIndexStats> {
    return this.#source.getStats();
  }

  async listIds(options: { limit?: number } = {}): Promise<string[]> {
    const ids = await this.#source.listIds();
    return options.limit === undefined ? ids : ids.slice(0, Math.max(0, options.limit));
  }
}

/** Mutation-only view over existing HNSW/JSON stores. */
export class VectorIndexWriterAdapter implements VectorIndexWriter {
  readonly #source: VectorIndexWriterSource;

  constructor(source: VectorIndexWriterSource) {
    this.#source = source;
  }

  upsert(item: VectorIndexItem): Promise<void> {
    return this.#source.upsert(item);
  }

  batchUpsert(items: VectorIndexItem[]): Promise<void> {
    return this.#source.batchUpsert(items);
  }

  remove(id: string): Promise<void> {
    return this.#source.remove(id);
  }

  clear(): Promise<void> {
    return this.#source.clear();
  }
}

export function createVectorIndexPorts(source: VectorIndexReaderSource & VectorIndexWriterSource): {
  reader: VectorIndexReader;
  writer: VectorIndexWriter;
} {
  return {
    reader: new VectorIndexReaderAdapter(source),
    writer: new VectorIndexWriterAdapter(source),
  };
}

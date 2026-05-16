/** Vector chunk enrichment contract.
 *
 * Core 只定义可注入的增强接口，不持有具体 AI provider 或 prompt 实现。
 * Alembic / AlembicPlugin 可在外层提供自己的 ContextualEnricher adapter。
 */
export interface VectorChunkData {
  content: string;
  metadata: Record<string, unknown>;
}

export interface VectorDocumentInfo {
  title: string;
  content: string;
  kind: string;
  sourcePath?: string;
}

export interface VectorChunkEnricher {
  enrichChunks(document: VectorDocumentInfo, chunks: VectorChunkData[]): Promise<VectorChunkData[]>;
}

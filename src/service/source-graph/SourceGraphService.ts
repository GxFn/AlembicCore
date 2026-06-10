import {
  createSourceGraphFreshness,
  createSourceGraphQueryResult,
  createSourceSection,
  type SourceGraphDiagnosticInput,
  type SourceGraphEdge,
  type SourceGraphQueryResult,
  type SourceGraphSnapshot,
  type SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import type {
  SourceGraphReplaceInput,
  SourceGraphRepositoryImpl,
  SourceGraphSymbolSearchOptions,
} from '../../repository/source-graph/SourceGraphRepository.js';

export interface SourceGraphQueryOptions extends SourceGraphSymbolSearchOptions {
  includeEdges?: boolean;
}

export class SourceGraphService {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async replaceSnapshot(input: SourceGraphReplaceInput): Promise<SourceGraphSnapshot> {
    return this.repository.replaceGeneration(input);
  }

  async getFreshness(projectRoot: string, repoId = 'default') {
    return this.repository.getFreshness(projectRoot, repoId);
  }

  async querySymbols(
    generationId: string,
    query: string,
    options: SourceGraphQueryOptions = {}
  ): Promise<SourceGraphQueryResult> {
    const snapshot = await this.repository.getSnapshot(generationId);
    if (!snapshot) {
      return createSourceGraphQueryResult({
        generationId,
        projectRoot: 'unknown',
        query,
        freshness: createSourceGraphFreshness({
          status: 'unavailable',
          generationId,
          reason: 'Source graph generation does not exist.',
          nextAction: 'rebuild_source_graph',
        }),
        diagnostics: [
          {
            code: 'source-ref-unproven',
            message: `Source graph generation not found: ${generationId}`,
            nextAction: 'rebuild_source_graph',
          },
        ],
      });
    }

    const symbols = await this.repository.searchSymbols(generationId, query, options);
    const edges =
      options.includeEdges === false ? [] : await collectSymbolEdges(this.repository, symbols);
    const diagnostics = buildQueryDiagnostics(query, symbols, snapshot);

    return createSourceGraphQueryResult({
      generationId,
      projectRoot: snapshot.projectRoot,
      query,
      freshness: snapshot.freshness,
      symbols,
      edges,
      sourceSections: symbols.map((symbol) =>
        createSourceSection({
          filePath: symbol.filePath,
          startLine: symbol.range.startLine,
          endLine: symbol.range.endLine,
          reason: `symbol:${symbol.kind}`,
          freshness: snapshot.freshness,
          symbolIds: [symbol.symbolId],
        })
      ),
      impactedFiles: collectImpactedFiles(symbols, edges),
      diagnostics,
      metadata: {
        repoId: snapshot.repoId,
        extractionVersion: snapshot.extractionVersion,
      },
    });
  }

  async clearGeneration(generationId: string) {
    return this.repository.clearGeneration(generationId);
  }
}

async function collectSymbolEdges(
  repository: SourceGraphRepositoryImpl,
  symbols: SourceSymbolNode[]
): Promise<SourceGraphEdge[]> {
  const edgeMap = new Map<string, SourceGraphEdge>();
  for (const symbol of symbols) {
    const edges = await repository.findEdgesForSymbol(symbol.generationId, symbol.symbolId);
    for (const edge of edges) {
      edgeMap.set(edge.edgeId, edge);
    }
  }
  return Array.from(edgeMap.values());
}

function buildQueryDiagnostics(
  query: string,
  symbols: SourceSymbolNode[],
  snapshot: SourceGraphSnapshot
): SourceGraphDiagnosticInput[] {
  const diagnostics: SourceGraphDiagnosticInput[] = [];
  if (snapshot.status === 'partial' || snapshot.status === 'degraded') {
    diagnostics.push({
      code: 'catch-up-failed',
      message: `Source graph generation is ${snapshot.status}.`,
      metadata: { degradedReason: snapshot.degradedReason },
    });
  }
  if (symbols.length === 0) {
    diagnostics.push({
      code: 'low-confidence-query',
      message: `No source symbols matched query: ${query}`,
    });
  }
  return diagnostics;
}

function collectImpactedFiles(symbols: SourceSymbolNode[], edges: SourceGraphEdge[]): string[] {
  const files = new Set<string>();
  for (const symbol of symbols) {
    files.add(symbol.filePath);
  }
  for (const edge of edges) {
    if (edge.fromFilePath) {
      files.add(edge.fromFilePath);
    }
    if (edge.toFilePath) {
      files.add(edge.toFilePath);
    }
    if (edge.siteFilePath) {
      files.add(edge.siteFilePath);
    }
  }
  return Array.from(files).sort();
}

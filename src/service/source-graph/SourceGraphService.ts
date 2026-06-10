import {
  createSourceGraphFreshness,
  createSourceGraphQueryResult,
  type SourceGraphDiagnosticInput,
  type SourceGraphQueryResult,
  type SourceGraphSnapshot,
} from '../../domain/source-graph/index.js';
import type {
  SourceGraphReplaceInput,
  SourceGraphRepositoryImpl,
  SourceGraphSymbolSearchOptions,
} from '../../repository/source-graph/SourceGraphRepository.js';
import {
  type SourceGraphFreshnessOptions,
  type SourceGraphFreshnessReport,
  SourceGraphFreshnessService,
  type SourceGraphIncrementalIndexOptions,
  type SourceGraphIndexBuildResult,
  SourceGraphIndexer,
  type SourceGraphIndexOptions,
} from './SourceGraphIndexer.js';
import {
  type SourceGraphAffectedTestsInput,
  type SourceGraphExploreInput,
  type SourceGraphImpactInput,
  type SourceGraphNodeInput,
  SourceGraphQueryService,
  type SourceGraphRelationInput,
  type SourceGraphSearchInput,
} from './SourceGraphQueryService.js';

export interface SourceGraphQueryOptions extends SourceGraphSymbolSearchOptions {
  includeEdges?: boolean;
}

export class SourceGraphService {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async replaceSnapshot(input: SourceGraphReplaceInput): Promise<SourceGraphSnapshot> {
    return this.repository.replaceGeneration(input);
  }

  async buildFullIndex(input: SourceGraphIndexOptions): Promise<SourceGraphIndexBuildResult> {
    return new SourceGraphIndexer(this.repository).buildFull(input);
  }

  async buildIncrementalIndex(
    input: SourceGraphIncrementalIndexOptions
  ): Promise<SourceGraphIndexBuildResult> {
    return new SourceGraphIndexer(this.repository).buildIncremental(input);
  }

  async inspectFreshness(input: SourceGraphFreshnessOptions): Promise<SourceGraphFreshnessReport> {
    return new SourceGraphFreshnessService(this.repository).inspect(input);
  }

  async getFreshness(projectRoot: string, repoId = 'default') {
    return this.repository.getFreshness(projectRoot, repoId);
  }

  async searchSourceGraph(input: SourceGraphSearchInput) {
    return new SourceGraphQueryService(this.repository).search(input);
  }

  async exploreSourceGraph(input: SourceGraphExploreInput) {
    return new SourceGraphQueryService(this.repository).explore(input);
  }

  async getSourceGraphNode(input: SourceGraphNodeInput) {
    return new SourceGraphQueryService(this.repository).node(input);
  }

  async getSourceGraphCallers(input: SourceGraphRelationInput) {
    return new SourceGraphQueryService(this.repository).callers(input);
  }

  async getSourceGraphCallees(input: SourceGraphRelationInput) {
    return new SourceGraphQueryService(this.repository).callees(input);
  }

  async getSourceGraphImpact(input: SourceGraphImpactInput) {
    return new SourceGraphQueryService(this.repository).impact(input);
  }

  async getSourceGraphAffectedTests(input: SourceGraphAffectedTestsInput) {
    return new SourceGraphQueryService(this.repository).affectedTests(input);
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

    const searchResult = await this.searchSourceGraph({
      generationId,
      query,
      limit: options.limit,
      kind: options.kind,
      filePath: options.filePath,
      includeEdges: options.includeEdges,
    });
    const diagnostics = buildQueryDiagnostics(query, searchResult.symbols, snapshot);

    return createSourceGraphQueryResult({
      generationId,
      projectRoot: snapshot.projectRoot,
      query,
      freshness: snapshot.freshness,
      symbols: searchResult.symbols,
      edges: searchResult.edges,
      sourceSections: searchResult.sourceSections,
      impactedFiles: searchResult.impactedFiles,
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

function buildQueryDiagnostics(
  query: string,
  symbols: { length: number },
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

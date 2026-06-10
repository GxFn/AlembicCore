import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createSourceGraphAffectedTestsResult,
  createSourceGraphCalleesResult,
  createSourceGraphCallersResult,
  createSourceGraphDiagnostic,
  createSourceGraphExploreResult,
  createSourceGraphFreshness,
  createSourceGraphImpactResult,
  createSourceGraphNodeResult,
  createSourceGraphSearchResult,
  createSourceGraphValidationPlanResult,
  createSourceSection,
  type SourceFileNode,
  type SourceGraphAffectedTestsResult,
  type SourceGraphCalleesResult,
  type SourceGraphCallersResult,
  type SourceGraphDiagnostic,
  type SourceGraphEdge,
  type SourceGraphExploreResult,
  type SourceGraphFileClassification,
  type SourceGraphFreshness,
  type SourceGraphImpactResult,
  type SourceGraphNodeResult,
  type SourceGraphSearchResult,
  type SourceGraphSnapshot,
  type SourceGraphValidationEvidenceInput,
  type SourceGraphValidationPlanResult,
  type SourceGraphValidationRecommendationInput,
  type SourceSection,
  type SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import type { SourceGraphRepositoryImpl } from '../../repository/source-graph/SourceGraphRepository.js';

export interface SourceGraphQueryTarget {
  generationId?: string;
  projectRoot?: string;
  repoId?: string;
}

export interface SourceGraphRankingOptions extends SourceGraphQueryTarget {
  limit?: number;
  kind?: string;
  filePath?: string;
  includeEdges?: boolean;
  includeText?: boolean;
  includeTests?: boolean;
  includeGenerated?: boolean;
  includeConfig?: boolean;
  contextLines?: number;
  maxSectionLines?: number;
  sourceSectionLineBudget?: number;
  edgeLimit?: number;
}

export interface SourceGraphSearchInput extends SourceGraphRankingOptions {
  query: string;
}

export interface SourceGraphExploreInput extends SourceGraphRankingOptions {
  query?: string;
  focus?: string;
}

export interface SourceGraphNodeInput extends SourceGraphRankingOptions {
  nodeId: string;
}

export interface SourceGraphRelationInput extends SourceGraphRankingOptions {
  symbolId: string;
}

export interface SourceGraphImpactInput extends SourceGraphRankingOptions {
  changedFiles?: string[];
  symbolId?: string;
}

export interface SourceGraphAffectedTestsInput extends SourceGraphRankingOptions {
  changedFiles: string[];
}

export interface SourceGraphValidationPlanInput extends SourceGraphRankingOptions {
  changedFiles?: string[];
  symbolIds?: string[];
  packageScripts?: Record<string, string>;
}

interface NormalizedRankingOptions {
  limit: number;
  kind?: string;
  filePath?: string;
  includeEdges: boolean;
  includeText: boolean;
  includeTests: boolean;
  includeGenerated: boolean;
  includeConfig: boolean;
  contextLines: number;
  maxSectionLines: number;
  sourceSectionLineBudget: number;
  edgeLimit: number;
}

interface SourceGraphQueryContext {
  snapshot?: SourceGraphSnapshot;
  projectRoot: string;
  repoId?: string;
  generationId?: string;
  freshness: SourceGraphFreshness;
  diagnostics: SourceGraphDiagnostic[];
  files: SourceFileNode[];
  symbols: SourceSymbolNode[];
  edges: SourceGraphEdge[];
  fileByPath: Map<string, SourceFileNode>;
  symbolById: Map<string, SourceSymbolNode>;
  options: NormalizedRankingOptions;
}

interface QueryTerms {
  query: string;
  normalized: string;
  tokens: string[];
  asksForTests: boolean;
  asksForGenerated: boolean;
  asksForConfig: boolean;
}

interface RankedSymbol {
  symbol: SourceSymbolNode;
  file?: SourceFileNode;
  score: number;
  reasons: string[];
  edges: SourceGraphEdge[];
}

interface TextMatch {
  file: SourceFileNode;
  lineNumber: number;
  score: number;
  reasons: string[];
}

interface SectionPlan {
  filePath: string;
  startLine: number;
  endLine: number;
  reason: string;
  symbolIds: string[];
  metadata: Record<string, unknown>;
}

export class SourceGraphQueryService {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async search(input: SourceGraphSearchInput): Promise<SourceGraphSearchResult> {
    const context = await this.createContext(input);
    const terms = createQueryTerms(input.query);
    const rankedSymbols = this.rankSymbols(context, terms);
    const rankingDiagnostics = this.buildRankingDiagnostics(terms, rankedSymbols);
    const symbols = rankedSymbols.slice(0, context.options.limit).map((ranked) => ranked.symbol);
    const symbolSections = await this.buildRankedSymbolSections(context, rankedSymbols);
    const textSections = await this.buildTextRecallSections(context, terms, symbolSections);
    const sourceSections = dedupeSections([...symbolSections, ...textSections]);
    const edges =
      context.options.includeEdges === false
        ? []
        : collectEdgesForSymbols(context, symbols, context.options.edgeLimit);

    return createSourceGraphSearchResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      query: input.query,
      freshness: context.freshness,
      diagnostics: [...context.diagnostics, ...rankingDiagnostics],
      symbols,
      sourceSections,
      edges,
      impactedFiles: collectImpactedFiles(symbols, sourceSections, edges),
    });
  }

  async explore(input: SourceGraphExploreInput): Promise<SourceGraphExploreResult> {
    const query = input.query?.trim() || input.focus?.trim() || '';
    const search = await this.search({ ...input, query });
    return createSourceGraphExploreResult({
      generationId: search.generationId,
      projectRoot: search.projectRoot,
      repoId: search.repoId,
      query: input.query,
      focus: input.focus,
      freshness: search.freshness,
      diagnostics: search.diagnostics,
      symbols: search.symbols,
      sourceSections: search.sourceSections,
      edges: search.edges,
      detailRefs: search.detailRefs,
    });
  }

  async node(input: SourceGraphNodeInput): Promise<SourceGraphNodeResult> {
    const context = await this.createContext(input);
    const nodeId = input.nodeId.trim();
    const symbol = context.symbolById.get(nodeId);
    const file = context.fileByPath.get(normalizeRepoPath(nodeId));
    const diagnostics = [...context.diagnostics];

    if (!symbol && !file) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'source-ref-unproven',
          message: `Source graph node not found: ${nodeId}`,
          nextAction: 'search_source_graph_or_rebuild_index',
        })
      );
    }

    const sections =
      symbol !== undefined
        ? await this.buildSectionsFromPlans(context, [
            this.createSymbolSectionPlan(context, {
              symbol,
              file: context.fileByPath.get(symbol.filePath),
              score: 100,
              reasons: ['node:symbol'],
              edges: collectEdgesForSymbols(context, [symbol], context.options.edgeLimit),
            }),
          ])
        : file !== undefined
          ? await this.buildSectionsFromPlans(context, [createFileSectionPlan(file, 'node:file')])
          : [];
    const edges =
      context.options.includeEdges === false
        ? []
        : symbol !== undefined
          ? collectEdgesForSymbols(context, [symbol], context.options.edgeLimit)
          : file !== undefined
            ? collectEdgesForFiles(context, [file.repoRelativePath], context.options.edgeLimit)
            : [];

    return createSourceGraphNodeResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      nodeId,
      symbol,
      sourceSections: sections,
      edges,
      freshness: context.freshness,
      diagnostics,
    });
  }

  async callers(input: SourceGraphRelationInput): Promise<SourceGraphCallersResult> {
    const context = await this.createContext(input);
    const relation = this.collectRelationSymbols(context, input.symbolId, 'incoming');
    const sections = await this.buildRelationSections(context, relation.symbols, relation.edges);
    return createSourceGraphCallersResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      symbolId: input.symbolId,
      callers: relation.symbols,
      sourceSections: sections,
      edges: context.options.includeEdges === false ? [] : relation.edges,
      freshness: context.freshness,
      diagnostics: [...context.diagnostics, ...relation.diagnostics],
    });
  }

  async callees(input: SourceGraphRelationInput): Promise<SourceGraphCalleesResult> {
    const context = await this.createContext(input);
    const relation = this.collectRelationSymbols(context, input.symbolId, 'outgoing');
    const sections = await this.buildRelationSections(context, relation.symbols, relation.edges);
    return createSourceGraphCalleesResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      symbolId: input.symbolId,
      callees: relation.symbols,
      sourceSections: sections,
      edges: context.options.includeEdges === false ? [] : relation.edges,
      freshness: context.freshness,
      diagnostics: [...context.diagnostics, ...relation.diagnostics],
    });
  }

  async impact(input: SourceGraphImpactInput): Promise<SourceGraphImpactResult> {
    const context = await this.createContext(input);
    const seedFiles = this.resolveImpactSeedFiles(context, input);
    const impactedEdges = collectImpactEdges(context, seedFiles, input.symbolId).slice(
      0,
      context.options.edgeLimit
    );
    const impactedFiles = normalizeStringList([...seedFiles, ...edgeFilePaths(impactedEdges)]);
    const testFiles = collectTestFiles(context, impactedFiles, impactedEdges);
    const diagnostics = [...context.diagnostics];
    if (testFiles.length === 0) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'affected-tests-unknown',
          message:
            'No deterministic source graph test edge or indexed test file covers this impact.',
          metadata: { changedFiles: seedFiles, impactedFiles },
        })
      );
    }

    return createSourceGraphImpactResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      freshness: context.freshness,
      diagnostics,
      changedFiles: seedFiles,
      impactedFiles,
      edges: context.options.includeEdges === false ? [] : impactedEdges,
      affectedValidations: testFiles.map((filePath) => `test:${filePath}`),
    });
  }

  async affectedTests(
    input: SourceGraphAffectedTestsInput
  ): Promise<SourceGraphAffectedTestsResult> {
    const context = await this.createContext(input);
    const changedFiles = normalizeStringList(input.changedFiles.map(normalizeRepoPath));
    const impactedEdges = collectImpactEdges(context, changedFiles, undefined).slice(
      0,
      context.options.edgeLimit
    );
    const impactedFiles = normalizeStringList([...changedFiles, ...edgeFilePaths(impactedEdges)]);
    const testFiles = collectTestFiles(context, impactedFiles, impactedEdges);
    const diagnostics = [...context.diagnostics];
    const unknownReason =
      testFiles.length === 0
        ? 'No source_graph symbol_to_test edge or indexed test file maps these changed files.'
        : undefined;

    if (unknownReason) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'affected-tests-unknown',
          message: unknownReason,
          metadata: { changedFiles, impactedFiles },
        })
      );
    }

    return createSourceGraphAffectedTestsResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      freshness: context.freshness,
      diagnostics,
      changedFiles,
      testFiles,
      unknownReason,
    });
  }

  async validationPlan(
    input: SourceGraphValidationPlanInput
  ): Promise<SourceGraphValidationPlanResult> {
    const context = await this.createContext(input);
    const changedFiles = normalizeStringList((input.changedFiles ?? []).map(normalizeRepoPath));
    const seedSymbols = normalizeStringList(input.symbolIds ?? []);
    const missingSeedSymbols = seedSymbols.filter((symbolId) => !context.symbolById.has(symbolId));
    const seedFiles = this.resolveValidationSeedFiles(context, input, changedFiles, seedSymbols);
    const impactedEdges = collectImpactEdges(context, seedFiles, seedSymbols).slice(
      0,
      context.options.edgeLimit
    );
    const impactedFiles = normalizeStringList([...seedFiles, ...edgeFilePaths(impactedEdges)]);
    const impactedSymbols = collectImpactedSymbols(
      context,
      impactedFiles,
      impactedEdges,
      seedSymbols
    );
    const testFiles = collectTestFiles(context, impactedFiles, impactedEdges);
    const packageScripts = {
      ...(await readPackageScripts(context.projectRoot)),
      ...normalizeScriptRecord(input.packageScripts),
    };
    const diagnostics = [...context.diagnostics];
    const evidence = buildValidationPlanEvidence(
      changedFiles,
      impactedFiles,
      impactedSymbols,
      impactedEdges
    );
    const buckets = createValidationPlanBuckets();

    appendMissingSeedSymbolRecommendations(missingSeedSymbols, diagnostics, buckets.unknown);
    appendAffectedTestRecommendations({
      testFiles,
      packageScripts,
      graphEvidence: evidence.graph,
      changedFiles,
      seedSymbols,
      impactedFiles,
      diagnostics,
      mustRun: buckets.mustRun,
      unknown: buckets.unknown,
    });
    appendRepositoryScriptRecommendations(packageScripts, evidence.graph, buckets.recommended);
    appendManualReviewRecommendations(changedFiles, context, buckets.manualReview);
    appendSeedAndScriptUnknowns(changedFiles, seedSymbols, packageScripts, buckets.unknown);

    return createSourceGraphValidationPlanResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      freshness: context.freshness,
      diagnostics,
      changedFiles,
      seedSymbols,
      impactedFiles,
      impactedSymbols,
      edges: context.options.includeEdges === false ? [] : impactedEdges,
      mustRun: buckets.mustRun,
      recommended: buckets.recommended,
      manualReview: buckets.manualReview,
      unknown: buckets.unknown,
    });
  }

  private async createContext(input: SourceGraphRankingOptions): Promise<SourceGraphQueryContext> {
    const options = normalizeRankingOptions(input);
    const snapshot = await this.resolveSnapshot(input);
    const projectRoot = snapshot?.projectRoot ?? input.projectRoot?.trim() ?? 'unknown';
    const repoId = snapshot?.repoId ?? input.repoId?.trim();
    const generationId = snapshot?.generationId ?? input.generationId?.trim();

    if (!snapshot) {
      const freshness = createSourceGraphFreshness({
        status: input.generationId ? 'unavailable' : 'uninitialized',
        generationId,
        reason: input.generationId
          ? 'Source graph generation does not exist.'
          : 'No source graph generation exists for this project.',
        nextAction: 'build_source_graph',
      });
      return {
        projectRoot,
        repoId,
        generationId,
        freshness,
        diagnostics: [
          createSourceGraphDiagnostic({
            code: 'source-ref-unproven',
            message: input.generationId
              ? `Source graph generation not found: ${input.generationId}`
              : 'Source graph query has no indexed generation to read.',
            nextAction: 'build_source_graph',
          }),
        ],
        files: [],
        symbols: [],
        edges: [],
        fileByPath: new Map(),
        symbolById: new Map(),
        options,
      };
    }

    const files = await this.repository.listFiles(snapshot.generationId);
    const symbols = await this.repository.listSymbols(snapshot.generationId);
    const edges = await this.repository.listEdges(snapshot.generationId, {
      limit: options.edgeLimit,
    });
    const diagnostics = buildFreshnessDiagnostics(snapshot);
    return {
      snapshot,
      projectRoot,
      repoId,
      generationId,
      freshness: snapshot.freshness,
      diagnostics,
      files,
      symbols,
      edges,
      fileByPath: new Map(files.map((file) => [file.repoRelativePath, file])),
      symbolById: new Map(symbols.map((symbol) => [symbol.symbolId, symbol])),
      options,
    };
  }

  private async resolveSnapshot(
    input: SourceGraphQueryTarget
  ): Promise<SourceGraphSnapshot | null> {
    if (input.generationId?.trim()) {
      return this.repository.getSnapshot(input.generationId.trim());
    }
    if (input.projectRoot?.trim()) {
      return this.repository.getLatestSnapshot(
        input.projectRoot.trim(),
        input.repoId?.trim() || 'default'
      );
    }
    return null;
  }

  private rankSymbols(context: SourceGraphQueryContext, terms: QueryTerms): RankedSymbol[] {
    if (!context.snapshot) {
      return [];
    }
    const ranked = context.symbols
      .filter((symbol) => this.symbolMatchesOptions(context, symbol))
      .map((symbol) => {
        const file = context.fileByPath.get(symbol.filePath);
        const edges = collectEdgesForSymbols(context, [symbol], context.options.edgeLimit);
        const { score, reasons } = scoreSymbol(symbol, file, edges, terms, context.options);
        return { symbol, file, score, reasons, edges };
      })
      .filter((rankedSymbol) => rankedSymbol.score > 0)
      .sort(compareRankedSymbols);
    return ranked;
  }

  private symbolMatchesOptions(
    context: SourceGraphQueryContext,
    symbol: SourceSymbolNode
  ): boolean {
    if (context.options.kind && symbol.kind !== context.options.kind) {
      return false;
    }
    if (
      context.options.filePath &&
      symbol.filePath !== normalizeRepoPath(context.options.filePath)
    ) {
      return false;
    }
    return true;
  }

  private buildRankingDiagnostics(
    terms: QueryTerms,
    rankedSymbols: RankedSymbol[]
  ): SourceGraphDiagnostic[] {
    if (terms.normalized === '') {
      return [
        createSourceGraphDiagnostic({
          code: 'low-confidence-query',
          message: 'Source graph query is empty.',
          nextAction: 'provide_symbol_file_or_search_terms',
        }),
      ];
    }
    if (rankedSymbols.length === 0) {
      return [
        createSourceGraphDiagnostic({
          code: 'low-confidence-query',
          message: `No source symbols matched query: ${terms.query}`,
        }),
      ];
    }

    const [first, second] = rankedSymbols;
    const diagnostics: SourceGraphDiagnostic[] = [];
    if (first.score < 35) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'low-confidence-query',
          message: `Top source graph match is low confidence for query: ${terms.query}`,
          metadata: { topScore: first.score, topSymbolId: first.symbol.symbolId },
        })
      );
    }
    if (second && first.score - second.score < 10) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'ambiguous-symbol',
          message: `Multiple source graph symbols are close matches for query: ${terms.query}`,
          metadata: {
            candidates: rankedSymbols.slice(0, 5).map((ranked) => ({
              symbolId: ranked.symbol.symbolId,
              displayName: ranked.symbol.displayName,
              filePath: ranked.symbol.filePath,
              score: ranked.score,
            })),
          },
        })
      );
    }
    return diagnostics;
  }

  private async buildRankedSymbolSections(
    context: SourceGraphQueryContext,
    rankedSymbols: RankedSymbol[]
  ): Promise<SourceSection[]> {
    const plans = rankedSymbols
      .slice(0, context.options.limit)
      .map((ranked) => this.createSymbolSectionPlan(context, ranked));
    return this.buildSectionsFromPlans(context, plans);
  }

  private createSymbolSectionPlan(
    context: SourceGraphQueryContext,
    ranked: RankedSymbol
  ): SectionPlan {
    const file = ranked.file ?? context.fileByPath.get(ranked.symbol.filePath);
    const lineCount = file?.lineCount ?? ranked.symbol.range.endLine;
    const contextLines = context.options.contextLines;
    return {
      filePath: ranked.symbol.filePath,
      startLine: Math.max(1, ranked.symbol.range.startLine - contextLines),
      endLine: Math.min(lineCount, ranked.symbol.range.endLine + contextLines),
      reason: `ranked-symbol:${ranked.symbol.kind}`,
      symbolIds: [ranked.symbol.symbolId],
      metadata: {
        score: ranked.score,
        reasons: ranked.reasons,
        classification: file?.classification,
      },
    };
  }

  private async buildRelationSections(
    context: SourceGraphQueryContext,
    symbols: SourceSymbolNode[],
    edges: SourceGraphEdge[]
  ): Promise<SourceSection[]> {
    const symbolPlans = symbols.map((symbol) =>
      this.createSymbolSectionPlan(context, {
        symbol,
        file: context.fileByPath.get(symbol.filePath),
        score: 100,
        reasons: ['graph-relation'],
        edges,
      })
    );
    const edgePlans = edges
      .filter((edge) => edge.site && edge.siteFilePath)
      .map((edge) => ({
        filePath: edge.siteFilePath ?? '',
        startLine: edge.site?.startLine ?? 1,
        endLine: edge.site?.endLine ?? edge.site?.startLine ?? 1,
        reason: `edge-site:${edge.kind}`,
        symbolIds: normalizeStringList([edge.fromSymbolId, edge.toSymbolId]),
        metadata: { edgeId: edge.edgeId, confidence: edge.confidence },
      }));
    return this.buildSectionsFromPlans(context, [...symbolPlans, ...edgePlans]);
  }

  private async buildTextRecallSections(
    context: SourceGraphQueryContext,
    terms: QueryTerms,
    existingSections: SourceSection[]
  ): Promise<SourceSection[]> {
    if (!canIncludeSourceText(context)) {
      return [];
    }
    const existingKeys = new Set(existingSections.map((section) => section.filePath));
    const matches: TextMatch[] = [];
    for (const file of context.files) {
      const lines = await readProjectFileLines(context.projectRoot, file.repoRelativePath);
      if (lines.length === 0) {
        continue;
      }
      const best = scoreFileTextMatch(file, lines, terms, context.options, existingKeys);
      if (best) {
        matches.push(best);
      }
    }
    const plans = matches
      .sort(compareTextMatches)
      .slice(0, context.options.limit)
      .map((match) => {
        const startLine = Math.max(1, match.lineNumber - context.options.contextLines);
        const endLine = Math.min(
          match.file.lineCount ?? match.lineNumber,
          match.lineNumber + context.options.contextLines
        );
        return {
          filePath: match.file.repoRelativePath,
          startLine,
          endLine,
          reason: 'text-recall',
          symbolIds: symbolsInRange(context, match.file.repoRelativePath, startLine, endLine).map(
            (symbol) => symbol.symbolId
          ),
          metadata: {
            score: match.score,
            reasons: match.reasons,
            classification: match.file.classification,
          },
        };
      });
    return this.buildSectionsFromPlans(context, plans);
  }

  private async buildSectionsFromPlans(
    context: SourceGraphQueryContext,
    plans: SectionPlan[]
  ): Promise<SourceSection[]> {
    const budget = new SectionBudget(context.options.sourceSectionLineBudget);
    const sections: SourceSection[] = [];
    for (const plan of plans) {
      const file = context.fileByPath.get(plan.filePath);
      const allowed = budget.reserve(plan.startLine, plan.endLine, context.options.maxSectionLines);
      if (!allowed) {
        continue;
      }
      const shouldRedact = file?.classification === 'config';
      const text =
        canIncludeSourceText(context) && !shouldRedact
          ? await readProjectFileText(
              context.projectRoot,
              plan.filePath,
              allowed.startLine,
              allowed.endLine
            )
          : undefined;
      const overflow = allowed.endLine < plan.endLine || allowed.startLine > plan.startLine;
      sections.push(
        createSourceSection({
          filePath: plan.filePath,
          startLine: allowed.startLine,
          endLine: allowed.endLine,
          text,
          freshness: context.freshness,
          reason: plan.reason,
          symbolIds: plan.symbolIds,
          redaction: shouldRedact
            ? { state: 'redacted', reason: 'config-source-text-redacted' }
            : { state: 'none' },
          metadata: {
            ...plan.metadata,
            overflow,
            originalStartLine: plan.startLine,
            originalEndLine: plan.endLine,
          },
        })
      );
    }
    return sections;
  }

  private collectRelationSymbols(
    context: SourceGraphQueryContext,
    symbolId: string,
    direction: 'incoming' | 'outgoing'
  ): {
    symbols: SourceSymbolNode[];
    edges: SourceGraphEdge[];
    diagnostics: SourceGraphDiagnostic[];
  } {
    const symbol = context.symbolById.get(symbolId);
    if (!symbol) {
      return {
        symbols: [],
        edges: [],
        diagnostics: [
          createSourceGraphDiagnostic({
            code: 'source-ref-unproven',
            message: `Source graph symbol not found: ${symbolId}`,
            nextAction: 'search_source_graph_or_rebuild_index',
          }),
        ],
      };
    }
    const relationEdges = context.edges
      .filter((edge) =>
        direction === 'incoming' ? edge.toSymbolId === symbolId : edge.fromSymbolId === symbolId
      )
      .slice(0, context.options.edgeLimit);
    const relationSymbols = relationEdges
      .map((edge) =>
        direction === 'incoming'
          ? symbolForRelationEndpoint(context, edge.fromSymbolId, edge.fromFilePath)
          : symbolForRelationEndpoint(context, edge.toSymbolId, edge.toFilePath)
      )
      .filter((candidate): candidate is SourceSymbolNode => candidate !== undefined);
    return {
      symbols: uniqueSymbols(relationSymbols),
      edges: relationEdges,
      diagnostics: [],
    };
  }

  private resolveImpactSeedFiles(
    context: SourceGraphQueryContext,
    input: SourceGraphImpactInput
  ): string[] {
    const files = new Set<string>();
    for (const filePath of input.changedFiles ?? []) {
      files.add(normalizeRepoPath(filePath));
    }
    if (input.filePath) {
      files.add(normalizeRepoPath(input.filePath));
    }
    if (input.symbolId) {
      const symbol = context.symbolById.get(input.symbolId);
      if (symbol) {
        files.add(symbol.filePath);
      }
    }
    return normalizeStringList(Array.from(files));
  }

  private resolveValidationSeedFiles(
    context: SourceGraphQueryContext,
    input: SourceGraphValidationPlanInput,
    changedFiles: string[],
    seedSymbols: string[]
  ): string[] {
    const files = new Set<string>(changedFiles);
    if (input.filePath) {
      files.add(normalizeRepoPath(input.filePath));
    }
    for (const symbolId of seedSymbols) {
      const symbol = context.symbolById.get(symbolId);
      if (symbol) {
        files.add(symbol.filePath);
      }
    }
    return normalizeStringList(Array.from(files));
  }
}

function normalizeRankingOptions(input: SourceGraphRankingOptions): NormalizedRankingOptions {
  const terms = createQueryTerms('query' in input ? String(input.query) : '');
  return {
    limit: normalizeBoundedInteger(input.limit, 20, 1, 100),
    kind: input.kind?.trim() || undefined,
    filePath: input.filePath?.trim() ? normalizeRepoPath(input.filePath) : undefined,
    includeEdges: input.includeEdges ?? true,
    includeText: input.includeText ?? true,
    includeTests: input.includeTests ?? terms.asksForTests,
    includeGenerated: input.includeGenerated ?? terms.asksForGenerated,
    includeConfig: input.includeConfig ?? terms.asksForConfig,
    contextLines: normalizeBoundedInteger(input.contextLines, 2, 0, 12),
    maxSectionLines: normalizeBoundedInteger(input.maxSectionLines, 40, 1, 200),
    sourceSectionLineBudget: normalizeBoundedInteger(input.sourceSectionLineBudget, 80, 1, 500),
    edgeLimit: normalizeBoundedInteger(input.edgeLimit, 500, 1, 500),
  };
}

function scoreSymbol(
  symbol: SourceSymbolNode,
  file: SourceFileNode | undefined,
  edges: SourceGraphEdge[],
  terms: QueryTerms,
  options: NormalizedRankingOptions
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const haystacks = [
    symbol.displayName,
    symbol.qualifiedName,
    symbol.symbolId,
    symbol.filePath,
    symbol.signature,
  ]
    .filter((value): value is string => value !== undefined)
    .map(normalizeForSearch);
  const symbolName = normalizeForSearch(symbol.displayName);
  const qualifiedName = normalizeForSearch(symbol.qualifiedName ?? '');
  const filePath = normalizeForSearch(symbol.filePath);
  let score = 0;

  if (terms.normalized !== '') {
    if (symbolName === terms.normalized || qualifiedName === terms.normalized) {
      score += 150;
      reasons.push('exact-symbol');
    } else if (symbolName.includes(terms.normalized) || qualifiedName.includes(terms.normalized)) {
      score += 75;
      reasons.push('symbol-name');
    }
    if (filePath === terms.normalized || filePath.endsWith(`/${terms.normalized}`)) {
      score += 120;
      reasons.push('exact-path');
    } else if (filePath.includes(terms.normalized)) {
      score += 50;
      reasons.push('path');
    }
  }

  const tokenHits = terms.tokens.filter((token) =>
    haystacks.some((haystack) => haystack.includes(token))
  );
  if (tokenHits.length > 0) {
    const coverage = tokenHits.length / Math.max(1, terms.tokens.length);
    score += Math.round(coverage * 45);
    reasons.push(`token-coverage:${tokenHits.length}/${terms.tokens.length}`);
  }

  if (symbol.exported) {
    score += 8;
    reasons.push('exported');
  }
  if (symbol.kind === 'module' && (filePath.includes(terms.normalized) || tokenHits.length > 0)) {
    score += 15;
    reasons.push('file-module');
  }
  const connectivity = Math.min(
    30,
    edges.reduce((total, edge) => total + Math.max(1, Math.round(edge.confidence * 5)), 0)
  );
  if (connectivity > 0) {
    score += connectivity;
    reasons.push('graph-connectivity');
  }

  const classification = file?.classification ?? 'unknown';
  const penalty = classificationPenalty(classification, options);
  if (penalty !== 0) {
    score += penalty;
    reasons.push(`classification:${classification}`);
  }
  return { score, reasons };
}

function scoreFileTextMatch(
  file: SourceFileNode,
  lines: string[],
  terms: QueryTerms,
  options: NormalizedRankingOptions,
  existingSectionFiles: Set<string>
): TextMatch | undefined {
  if (file.classification === 'generated' && !options.includeGenerated) {
    return undefined;
  }
  if (file.classification === 'config' && !options.includeConfig) {
    return undefined;
  }
  let best: TextMatch | undefined;
  for (const [index, line] of lines.entries()) {
    const normalizedLine = normalizeForSearch(line);
    const tokenHits = terms.tokens.filter((token) => normalizedLine.includes(token));
    const phraseHit = terms.normalized !== '' && normalizedLine.includes(terms.normalized);
    if (!phraseHit && tokenHits.length === 0) {
      continue;
    }
    const coverage = tokenHits.length / Math.max(1, terms.tokens.length);
    const pathBoost = normalizeForSearch(file.repoRelativePath).includes(terms.normalized) ? 20 : 0;
    const existingPenalty = existingSectionFiles.has(file.repoRelativePath) ? -15 : 0;
    const score =
      (phraseHit ? 55 : 0) +
      Math.round(coverage * 35) +
      pathBoost +
      classificationPenalty(file.classification, options) +
      existingPenalty;
    const candidate: TextMatch = {
      file,
      lineNumber: index + 1,
      score,
      reasons: [
        phraseHit ? 'text-phrase' : 'text-token',
        `token-coverage:${tokenHits.length}/${terms.tokens.length}`,
      ],
    };
    if (!best || compareTextMatches(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best && best.score > 0 ? best : undefined;
}

function createQueryTerms(query: string): QueryTerms {
  const normalized = normalizeForSearch(query);
  const tokens = normalizeStringList(
    splitSearchTokens(query).filter((token) => token.length > 1 && !COMMON_QUERY_WORDS.has(token))
  );
  return {
    query,
    normalized,
    tokens,
    asksForTests: tokens.some((token) => ['test', 'tests', 'spec', 'validation'].includes(token)),
    asksForGenerated: tokens.some((token) => ['generated', 'dist', 'compiled'].includes(token)),
    asksForConfig: tokens.some((token) =>
      ['config', 'json', 'yaml', 'toml', 'settings'].includes(token)
    ),
  };
}

function buildFreshnessDiagnostics(snapshot: SourceGraphSnapshot): SourceGraphDiagnostic[] {
  const diagnostics: SourceGraphDiagnostic[] = [];
  const status = snapshot.freshness.status;
  if (['pending', 'stale', 'catching-up', 'opening'].includes(status)) {
    diagnostics.push(
      createSourceGraphDiagnostic({
        code: 'pending-file-in-response',
        message: `Source graph query is not fresh: ${status}.`,
        metadata: {
          generationId: snapshot.generationId,
          pendingFileCount: snapshot.freshness.pendingFileCount,
          staleFileCount: snapshot.freshness.staleFileCount,
        },
      })
    );
  }
  if (
    ['partial', 'degraded', 'unavailable'].includes(status) ||
    snapshot.status === 'partial' ||
    snapshot.status === 'degraded'
  ) {
    diagnostics.push(
      createSourceGraphDiagnostic({
        code: 'catch-up-failed',
        message: `Source graph generation is ${snapshot.status}/${status}.`,
        metadata: {
          generationId: snapshot.generationId,
          degradedReason: snapshot.degradedReason ?? snapshot.freshness.degradedReason,
        },
      })
    );
  }
  if (status === 'wrong-scope' || snapshot.status === 'wrong-scope') {
    diagnostics.push(
      createSourceGraphDiagnostic({
        code: 'worktree-index-mismatch',
        message: 'Source graph generation does not match the requested project scope.',
        metadata: { generationId: snapshot.generationId },
      })
    );
  }
  return diagnostics;
}

function createFileSectionPlan(file: SourceFileNode, reason: string): SectionPlan {
  return {
    filePath: file.repoRelativePath,
    startLine: 1,
    endLine: file.lineCount ?? 1,
    reason,
    symbolIds: [],
    metadata: { classification: file.classification },
  };
}

function symbolsInRange(
  context: SourceGraphQueryContext,
  filePath: string,
  startLine: number,
  endLine: number
): SourceSymbolNode[] {
  return context.symbols.filter(
    (symbol) =>
      symbol.filePath === filePath &&
      symbol.range.startLine <= endLine &&
      symbol.range.endLine >= startLine
  );
}

function canIncludeSourceText(context: SourceGraphQueryContext): boolean {
  return context.options.includeText && context.freshness.status === 'fresh';
}

async function readProjectFileLines(
  projectRoot: string,
  repoRelativePath: string
): Promise<string[]> {
  const absolutePath = resolveProjectFile(projectRoot, repoRelativePath);
  if (!absolutePath) {
    return [];
  }
  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    return content.split(/\r\n|\n|\r/);
  } catch {
    return [];
  }
}

async function readProjectFileText(
  projectRoot: string,
  repoRelativePath: string,
  startLine: number,
  endLine: number
): Promise<string | undefined> {
  const lines = await readProjectFileLines(projectRoot, repoRelativePath);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.slice(startLine - 1, endLine).join('\n');
}

function resolveProjectFile(projectRoot: string, repoRelativePath: string): string | undefined {
  if (projectRoot === 'unknown') {
    return undefined;
  }
  const root = path.resolve(projectRoot);
  const absolutePath = path.resolve(root, normalizeRepoPath(repoRelativePath));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return absolutePath;
}

function collectEdgesForSymbols(
  context: SourceGraphQueryContext,
  symbols: SourceSymbolNode[],
  limit: number
): SourceGraphEdge[] {
  const ids = new Set(symbols.map((symbol) => symbol.symbolId));
  return uniqueEdges(
    context.edges.filter((edge) => {
      return (
        (edge.fromSymbolId !== undefined && ids.has(edge.fromSymbolId)) ||
        (edge.toSymbolId !== undefined && ids.has(edge.toSymbolId))
      );
    })
  ).slice(0, limit);
}

function collectEdgesForFiles(
  context: SourceGraphQueryContext,
  filePaths: string[],
  limit: number
): SourceGraphEdge[] {
  const paths = new Set(filePaths.map(normalizeRepoPath));
  return uniqueEdges(
    context.edges.filter((edge) => {
      return edgeFilePaths([edge]).some((filePath) => paths.has(filePath));
    })
  ).slice(0, limit);
}

interface ValidationPlanBuckets {
  mustRun: SourceGraphValidationRecommendationInput[];
  recommended: SourceGraphValidationRecommendationInput[];
  manualReview: SourceGraphValidationRecommendationInput[];
  unknown: SourceGraphValidationRecommendationInput[];
}

interface ValidationPlanEvidence {
  graph: SourceGraphValidationEvidenceInput[];
}

interface AffectedTestRecommendationInput {
  testFiles: string[];
  packageScripts: Record<string, string>;
  graphEvidence: SourceGraphValidationEvidenceInput[];
  changedFiles: string[];
  seedSymbols: string[];
  impactedFiles: string[];
  diagnostics: SourceGraphDiagnostic[];
  mustRun: SourceGraphValidationRecommendationInput[];
  unknown: SourceGraphValidationRecommendationInput[];
}

function createValidationPlanBuckets(): ValidationPlanBuckets {
  return {
    mustRun: [],
    recommended: [],
    manualReview: [],
    unknown: [],
  };
}

function buildValidationPlanEvidence(
  changedFiles: string[],
  impactedFiles: string[],
  impactedSymbols: SourceSymbolNode[],
  impactedEdges: SourceGraphEdge[]
): ValidationPlanEvidence {
  const changedEvidence = changedFiles.map((filePath) =>
    fileEvidence('changed-file', filePath, 'Changed file seed for validation planning.', 1)
  );
  const impactedEvidence = impactedFiles.map((filePath) =>
    fileEvidence('impacted-file', filePath, 'Impacted file from source graph impact edges.', 0.85)
  );
  const symbolEvidence = impactedSymbols.map((symbol) =>
    symbolValidationEvidence(symbol, 'Impacted source graph symbol.')
  );
  const edgeEvidence = impactedEdges.map((edge) =>
    edgeValidationEvidence(edge, 'Source graph edge used for impact-to-validation planning.')
  );
  return {
    graph: [...changedEvidence, ...impactedEvidence, ...symbolEvidence, ...edgeEvidence],
  };
}

function appendMissingSeedSymbolRecommendations(
  missingSeedSymbols: string[],
  diagnostics: SourceGraphDiagnostic[],
  unknown: SourceGraphValidationRecommendationInput[]
): void {
  for (const symbolId of missingSeedSymbols) {
    const diagnostic = createSourceGraphDiagnostic({
      code: 'source-ref-unproven',
      message: `Source graph symbol seed not found: ${symbolId}`,
      metadata: { symbolId },
    });
    diagnostics.push(diagnostic);
    unknown.push({
      bucket: 'unknown',
      kind: 'unknown',
      label: `Symbol seed not found ${symbolId}`,
      symbolId,
      diagnosticCode: 'source-ref-unproven',
      reason:
        'Validation planning cannot bind impact or test evidence to an unknown source graph symbol seed.',
      evidence: [
        diagnosticEvidence(
          'source-ref-unproven',
          'The requested source graph symbol seed was not present in the snapshot.'
        ),
      ],
      metadata: { symbolId },
    });
  }
}

function appendAffectedTestRecommendations(input: AffectedTestRecommendationInput): void {
  for (const testFile of input.testFiles) {
    const command = input.packageScripts.test ? `npm run test -- ${testFile}` : undefined;
    input.mustRun.push({
      bucket: 'mustRun',
      kind: 'test-file',
      label: `Run affected test ${testFile}`,
      filePath: testFile,
      command,
      reason:
        'A deterministic source graph symbol_to_test edge or indexed impacted test file maps this change to the test.',
      evidence: [
        ...input.graphEvidence,
        fileEvidence('test-file', testFile, 'Deterministic affected test file.', 1),
        ...scriptEvidence('test', command, input.packageScripts.test),
      ],
      metadata: { testFile },
    });
  }

  if (input.testFiles.length > 0) {
    return;
  }

  const diagnostic = createSourceGraphDiagnostic({
    code: 'affected-tests-unknown',
    message: 'No deterministic source graph test edge or indexed test file maps this change.',
    metadata: {
      changedFiles: input.changedFiles,
      seedSymbols: input.seedSymbols,
      impactedFiles: input.impactedFiles,
    },
  });
  input.diagnostics.push(diagnostic);
  input.unknown.push({
    bucket: 'unknown',
    kind: 'unknown',
    label: 'Affected tests unknown',
    command: input.packageScripts.test ? 'npm run test' : undefined,
    diagnosticCode: 'affected-tests-unknown',
    reason:
      'Source graph can describe impact, but it cannot prove a deterministic test owner for this change.',
    evidence: [
      ...input.graphEvidence,
      diagnosticEvidence(
        'affected-tests-unknown',
        'No deterministic affected-test edge was available.'
      ),
      ...scriptEvidence(
        'test',
        input.packageScripts.test ? 'npm run test' : undefined,
        input.packageScripts.test
      ),
    ],
    metadata: {
      changedFiles: input.changedFiles,
      seedSymbols: input.seedSymbols,
      impactedFiles: input.impactedFiles,
    },
  });
}

function appendRepositoryScriptRecommendations(
  packageScripts: Record<string, string>,
  graphEvidence: SourceGraphValidationEvidenceInput[],
  recommended: SourceGraphValidationRecommendationInput[]
): void {
  for (const scriptName of ['build:check', 'lint', 'check']) {
    const scriptCommand = packageScripts[scriptName];
    if (!scriptCommand) {
      continue;
    }
    recommended.push({
      bucket: 'recommended',
      kind: 'repo-command',
      label: `Run repository script ${scriptName}`,
      command: `npm run ${scriptName}`,
      reason:
        'Repository metadata exposes this validation script; source graph recommends it without claiming acceptance.',
      evidence: [
        ...graphEvidence,
        {
          kind: 'repo-script',
          ref: `package.json#scripts.${scriptName}`,
          command: `npm run ${scriptName}`,
          reason: 'Repository package script is available for validation.',
          confidence: 1,
          metadata: { scriptName, scriptCommand },
        },
      ],
      metadata: { scriptName, scriptCommand },
    });
  }
}

function appendManualReviewRecommendations(
  changedFiles: string[],
  context: SourceGraphQueryContext,
  manualReview: SourceGraphValidationRecommendationInput[]
): void {
  for (const filePath of changedFiles) {
    const file = context.fileByPath.get(filePath);
    if (!requiresManualReview(filePath, file)) {
      continue;
    }
    manualReview.push({
      bucket: 'manualReview',
      kind: 'manual-review',
      label: `Review non-source change ${filePath}`,
      filePath,
      reason:
        'Configuration or unknown-file changes may affect validation outside deterministic symbol-to-test edges.',
      evidence: [
        fileEvidence(
          'changed-file',
          filePath,
          'Changed file needs manual review before narrowing validation.',
          0.9
        ),
      ],
      metadata: {
        classification: file?.classification ?? inferManualReviewClassification(filePath),
      },
    });
  }
}

function appendSeedAndScriptUnknowns(
  changedFiles: string[],
  seedSymbols: string[],
  packageScripts: Record<string, string>,
  unknown: SourceGraphValidationRecommendationInput[]
): void {
  if (changedFiles.length === 0 && seedSymbols.length === 0) {
    unknown.push({
      bucket: 'unknown',
      kind: 'unknown',
      label: 'No validation seed provided',
      reason: 'Validation planning needs changed files or symbol seeds to bind impact evidence.',
      evidence: [
        diagnosticEvidence(
          'source-ref-unproven',
          'No changed file or source graph symbol seed was provided.'
        ),
      ],
      metadata: {},
    });
  }

  if (Object.keys(packageScripts).length === 0) {
    unknown.push({
      bucket: 'unknown',
      kind: 'unknown',
      label: 'Repository validation commands unknown',
      reason:
        'No package.json scripts or explicit packageScripts metadata were available for command recommendations.',
      evidence: [
        diagnosticEvidence(
          'source-ref-unproven',
          'Repository command metadata was not available to Core.'
        ),
      ],
      metadata: {},
    });
  }
}

function collectImpactEdges(
  context: SourceGraphQueryContext,
  seedFiles: string[],
  symbolIds: string | string[] | undefined
): SourceGraphEdge[] {
  const files = new Set(seedFiles.map(normalizeRepoPath));
  const symbols = new Set(normalizeStringList(Array.isArray(symbolIds) ? symbolIds : [symbolIds]));
  return uniqueEdges(
    context.edges.filter((edge) => {
      const symbolMatch =
        symbols.size > 0 &&
        ((edge.fromSymbolId !== undefined && symbols.has(edge.fromSymbolId)) ||
          (edge.toSymbolId !== undefined && symbols.has(edge.toSymbolId)));
      return symbolMatch || edgeFilePaths([edge]).some((filePath) => files.has(filePath));
    })
  );
}

function collectImpactedSymbols(
  context: SourceGraphQueryContext,
  impactedFiles: string[],
  impactedEdges: SourceGraphEdge[],
  seedSymbolIds: string[]
): SourceSymbolNode[] {
  const files = new Set(impactedFiles.map(normalizeRepoPath));
  const symbolIds = new Set(seedSymbolIds);
  for (const edge of impactedEdges) {
    if (edge.fromSymbolId) {
      symbolIds.add(edge.fromSymbolId);
    }
    if (edge.toSymbolId) {
      symbolIds.add(edge.toSymbolId);
    }
  }
  return uniqueSymbols(
    context.symbols.filter((symbol) => files.has(symbol.filePath) || symbolIds.has(symbol.symbolId))
  );
}

function collectTestFiles(
  context: SourceGraphQueryContext,
  impactedFiles: string[],
  impactedEdges: SourceGraphEdge[]
): string[] {
  const testFiles = new Set<string>();
  const impacted = new Set(impactedFiles);
  for (const file of context.files) {
    if (file.classification === 'test' && impacted.has(file.repoRelativePath)) {
      testFiles.add(file.repoRelativePath);
    }
  }
  for (const edge of impactedEdges) {
    if (edge.kind !== 'symbol_to_test') {
      continue;
    }
    for (const filePath of edgeFilePaths([edge])) {
      if (context.fileByPath.get(filePath)?.classification === 'test') {
        testFiles.add(filePath);
      }
    }
    if (edge.toSymbolId) {
      const symbol = context.symbolById.get(edge.toSymbolId);
      if (symbol && context.fileByPath.get(symbol.filePath)?.classification === 'test') {
        testFiles.add(symbol.filePath);
      }
    }
  }
  return normalizeStringList(Array.from(testFiles));
}

function fileEvidence(
  kind: 'changed-file' | 'impacted-file' | 'test-file',
  filePath: string,
  reason: string,
  confidence: number
): SourceGraphValidationEvidenceInput {
  return {
    kind,
    ref: filePath,
    filePath,
    reason,
    confidence,
    metadata: {},
  };
}

function symbolValidationEvidence(
  symbol: SourceSymbolNode,
  reason: string
): SourceGraphValidationEvidenceInput {
  return {
    kind: 'symbol',
    ref: symbol.symbolId,
    symbolId: symbol.symbolId,
    filePath: symbol.filePath,
    reason,
    confidence: 0.9,
    metadata: {
      displayName: symbol.displayName,
      kind: symbol.kind,
    },
  };
}

function edgeValidationEvidence(
  edge: SourceGraphEdge,
  reason: string
): SourceGraphValidationEvidenceInput {
  return {
    kind: 'edge',
    ref: edge.edgeId,
    edgeId: edge.edgeId,
    filePath: edge.siteFilePath ?? edge.fromFilePath ?? edge.toFilePath,
    reason,
    confidence: edge.confidence,
    metadata: {
      kind: edge.kind,
      provenance: edge.provenance,
      fromSymbolId: edge.fromSymbolId,
      toSymbolId: edge.toSymbolId,
    },
  };
}

function diagnosticEvidence(
  diagnosticCode: NonNullable<SourceGraphValidationEvidenceInput['diagnosticCode']>,
  reason: string
): SourceGraphValidationEvidenceInput {
  return {
    kind: 'diagnostic',
    ref: diagnosticCode,
    diagnosticCode,
    reason,
    confidence: 1,
    metadata: {},
  };
}

function scriptEvidence(
  scriptName: string,
  command: string | undefined,
  scriptCommand: string | undefined
): SourceGraphValidationEvidenceInput[] {
  if (!scriptCommand) {
    return [];
  }
  return [
    {
      kind: 'repo-script',
      ref: `package.json#scripts.${scriptName}`,
      command,
      reason: 'Repository package script is available for validation.',
      confidence: 1,
      metadata: { scriptName, scriptCommand },
    },
  ];
}

function requiresManualReview(filePath: string, file: SourceFileNode | undefined): boolean {
  const classification = file?.classification ?? inferManualReviewClassification(filePath);
  return classification === 'config' || classification === 'unknown';
}

function inferManualReviewClassification(filePath: string): SourceGraphFileClassification {
  const normalized = normalizeRepoPath(filePath).toLowerCase();
  if (
    normalized.endsWith('.json') ||
    normalized.endsWith('.yaml') ||
    normalized.endsWith('.yml') ||
    normalized.endsWith('.toml') ||
    normalized.endsWith('.config.ts') ||
    normalized.endsWith('.config.js') ||
    normalized.includes('/config/') ||
    normalized === 'package.json' ||
    normalized === 'tsconfig.json'
  ) {
    return 'config';
  }
  return 'unknown';
}

async function readPackageScripts(projectRoot: string): Promise<Record<string, string>> {
  const packageJsonPath = resolveProjectFile(projectRoot, 'package.json');
  if (!packageJsonPath) {
    return {};
  }
  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
      scripts?: unknown;
    };
    return normalizeScriptRecord(packageJson.scripts);
  } catch {
    return {};
  }
}

function normalizeScriptRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(value)) {
    if (typeof command === 'string' && command.trim() !== '' && name.trim() !== '') {
      scripts[name.trim()] = command.trim();
    }
  }
  return scripts;
}

function symbolForRelationEndpoint(
  context: SourceGraphQueryContext,
  symbolId: string | undefined,
  filePath: string | undefined
): SourceSymbolNode | undefined {
  if (symbolId) {
    return context.symbolById.get(symbolId);
  }
  if (!filePath) {
    return undefined;
  }
  return context.symbols.find((symbol) => symbol.filePath === filePath && symbol.kind === 'module');
}

function collectImpactedFiles(
  symbols: SourceSymbolNode[],
  sections: SourceSection[],
  edges: SourceGraphEdge[]
): string[] {
  return normalizeStringList([
    ...symbols.map((symbol) => symbol.filePath),
    ...sections.map((section) => section.filePath),
    ...edgeFilePaths(edges),
  ]);
}

function edgeFilePaths(edges: SourceGraphEdge[]): string[] {
  return normalizeStringList(
    edges.flatMap((edge) => [edge.fromFilePath, edge.toFilePath, edge.siteFilePath])
  );
}

function dedupeSections(sections: SourceSection[]): SourceSection[] {
  const seen = new Set<string>();
  const result: SourceSection[] = [];
  for (const section of sections) {
    const key = `${section.filePath}:${section.startLine}:${section.endLine}:${section.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(section);
    }
  }
  return result;
}

function uniqueSymbols(symbols: SourceSymbolNode[]): SourceSymbolNode[] {
  const seen = new Set<string>();
  const result: SourceSymbolNode[] = [];
  for (const symbol of symbols) {
    if (!seen.has(symbol.symbolId)) {
      seen.add(symbol.symbolId);
      result.push(symbol);
    }
  }
  return result.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function uniqueEdges(edges: SourceGraphEdge[]): SourceGraphEdge[] {
  const seen = new Set<string>();
  const result: SourceGraphEdge[] = [];
  for (const edge of edges) {
    if (!seen.has(edge.edgeId)) {
      seen.add(edge.edgeId);
      result.push(edge);
    }
  }
  return result.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
}

function classificationPenalty(
  classification: SourceGraphFileClassification,
  options: NormalizedRankingOptions
): number {
  switch (classification) {
    case 'test':
      return options.includeTests ? 5 : -35;
    case 'generated':
      return options.includeGenerated ? 0 : -60;
    case 'config':
      return options.includeConfig ? 0 : -25;
    default:
      return 0;
  }
}

function compareRankedSymbols(left: RankedSymbol, right: RankedSymbol): number {
  return (
    right.score - left.score ||
    left.symbol.filePath.localeCompare(right.symbol.filePath) ||
    left.symbol.displayName.localeCompare(right.symbol.displayName)
  );
}

function compareTextMatches(left: TextMatch, right: TextMatch): number {
  return (
    right.score - left.score ||
    left.file.repoRelativePath.localeCompare(right.file.repoRelativePath) ||
    left.lineNumber - right.lineNumber
  );
}

function normalizeForSearch(value: string): string {
  return splitSearchTokens(value).join(' ');
}

function splitSearchTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeRepoPath(value: string): string {
  return value.trim().replaceAll(path.sep, '/').replace(/^\.\//, '');
}

function normalizeStringList(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => value !== undefined && value.trim() !== ''))
  ).sort();
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

class SectionBudget {
  private remaining: number;

  constructor(lineBudget: number) {
    this.remaining = lineBudget;
  }

  reserve(
    startLine: number,
    endLine: number,
    maxSectionLines: number
  ): { startLine: number; endLine: number } | undefined {
    if (this.remaining < 1) {
      return undefined;
    }
    const normalizedStart = Math.max(1, startLine);
    const normalizedEnd = Math.max(normalizedStart, endLine);
    const allowedLines = Math.min(
      this.remaining,
      maxSectionLines,
      normalizedEnd - normalizedStart + 1
    );
    this.remaining -= allowedLines;
    return {
      startLine: normalizedStart,
      endLine: normalizedStart + allowedLines - 1,
    };
  }
}

const COMMON_QUERY_WORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'what',
  'where',
  'how',
  'does',
  'this',
  'that',
  'code',
  'source',
]);

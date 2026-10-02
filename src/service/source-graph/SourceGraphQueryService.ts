import crypto from 'node:crypto';
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
  createSourceGraphRelationsResult,
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
  type SourceGraphRelation,
  type SourceGraphRelationsResult,
  type SourceGraphSearchResult,
  type SourceGraphSnapshot,
  type SourceGraphValidationEvidenceInput,
  type SourceGraphValidationPlanResult,
  type SourceGraphValidationRecommendationInput,
  type SourceSection,
  type SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
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
  /**
   * 是否把候选档的边也算进来。候选边来自外部引擎的低把握解析（按名字撞上的目标等），
   * 默认不参与任何查询结果；只有明确要看候选时才打开，并应向使用者标明它们不是事实。
   */
  includeCandidates?: boolean;
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
  /** 起点是类型时，把它的成员也算作起点（"这个类调用了谁"通常问的是它的方法）。 */
  includeMembers?: boolean;
  /** 沿同一种关系继续走几跳；默认 1，最多 8。 */
  depth?: number;
}

export interface SourceGraphRelationsInput extends SourceGraphRankingOptions {
  relation: SourceGraphRelation;
  /**
   * 起点符号。不给时用 filePath：对符号级关系是这个文件里的全部声明，
   * 对 importers / imports 就是这个文件本身。
   */
  symbolId?: string;
  /**
   * 同一个声明在别处的落点，与 symbolId 一起作为起点。头文件里的方法声明与实现文件里的方法定义
   * 是两个符号，"谁调用了它"问的是它们合在一起。
   */
  alsoSymbolIds?: readonly string[];
  includeMembers?: boolean;
  depth?: number;
}

export interface SourceGraphMembersInput extends SourceGraphRankingOptions {
  /** 类型的声明。 */
  symbolId: string;
  /** 同一个类型在别处的声明（接口之外的类扩展等）。 */
  alsoSymbolIds?: readonly string[];
}

export interface SourceGraphImpactInput extends SourceGraphRankingOptions {
  changedFiles?: string[];
  symbolId?: string;
  /** 沿"依赖它的一方"走几跳；默认 3，最多 8。 */
  depth?: number;
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
  includeCandidates: boolean;
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
  sectionBudget: SectionBudget;
  sourceLines: Map<string, string[]>;
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
  /** 排序用的总分，含图连通度加成。 */
  score: number;
  /**
   * 查询与符号本身的匹配强度，不含图连通度。诊断（低置信、歧义）只看它：
   * 被调用得多只说明符号重要，不能证明它就是查询要找的那一个。
   */
  matchScore: number;
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
    const sourceSections = finalizeSourceSections(
      context,
      dedupeSections([...symbolSections, ...textSections])
    );
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
    const context = await this.createContext(input, 'target');
    const nodeId = input.nodeId.trim();
    const symbol = context.symbolById.get(nodeId);
    const file = context.fileByPath.get(normalizeRepoPath(nodeId));
    const diagnostics: SourceGraphDiagnostic[] = [];

    if (!symbol && !file) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'source-ref-unproven',
          message: `Source graph node not found: ${nodeId}`,
          nextAction: 'search_source_graph_or_rebuild_index',
        })
      );
    }

    await this.loadTargetEdges(
      context,
      symbol ? { symbolIds: [symbol.symbolId] } : { filePaths: file ? [file.repoRelativePath] : [] }
    );

    const sections =
      symbol !== undefined
        ? await this.buildSectionsFromPlans(context, [
            this.createSymbolSectionPlan(context, {
              symbol,
              file: context.fileByPath.get(symbol.filePath),
              score: 100,
              matchScore: 100,
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
      sourceSections: finalizeSourceSections(context, sections),
      edges,
      freshness: context.freshness,
      diagnostics: [...context.diagnostics, ...diagnostics],
    });
  }

  async callers(input: SourceGraphRelationInput): Promise<SourceGraphCallersResult> {
    const result = await this.relations({ ...input, relation: 'callers' });
    return createSourceGraphCallersResult({
      generationId: result.generationId,
      projectRoot: result.projectRoot,
      repoId: result.repoId,
      symbolId: input.symbolId,
      callers: result.symbols,
      sourceSections: result.sourceSections,
      edges: result.edges,
      freshness: result.freshness,
      diagnostics: result.diagnostics,
    });
  }

  async callees(input: SourceGraphRelationInput): Promise<SourceGraphCalleesResult> {
    const result = await this.relations({ ...input, relation: 'callees' });
    return createSourceGraphCalleesResult({
      generationId: result.generationId,
      projectRoot: result.projectRoot,
      repoId: result.repoId,
      symbolId: input.symbolId,
      callees: result.symbols,
      sourceSections: result.sourceSections,
      edges: result.edges,
      freshness: result.freshness,
      diagnostics: result.diagnostics,
    });
  }

  /** 一个类型的成员，含写在别的文件里的（扩展、分类、实现文件）。 */
  async members(input: SourceGraphMembersInput): Promise<SourceSymbolNode[]> {
    const context = await this.createContext(input, 'target');
    const sites = [input.symbolId, ...(input.alsoSymbolIds ?? [])].flatMap(
      (id) => context.symbolById.get(id) ?? []
    );
    return membersOfType(context, sites);
  }

  /**
   * 一种关系的另一端：从起点出发，只沿这一种关系的边走，可走多跳。
   * 候选档的边不参与，除非查询明确要求。
   */
  async relations(input: SourceGraphRelationsInput): Promise<SourceGraphRelationsResult> {
    const context = await this.createContext(input, 'target');
    const rule = RELATION_RULES[input.relation];
    const symbolId = input.symbolId?.trim() || undefined;
    const filePath = context.options.filePath;
    const diagnostics: SourceGraphDiagnostic[] = [];
    const anchor = this.resolveRelationAnchor(
      context,
      rule,
      symbolId,
      input.includeMembers,
      input.alsoSymbolIds
    );
    if (rule.level === 'symbol' && symbolId && !anchor.missing) {
      anchor.symbolIds.push(
        ...(input.alsoSymbolIds ?? []).filter(
          (id) => context.symbolById.has(id) && !anchor.symbolIds.includes(id)
        )
      );
    }
    if (anchor.missing) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'source-ref-unproven',
          message: anchor.missing,
          nextAction: 'search_source_graph_or_rebuild_index',
        })
      );
    }
    // 实例化只有"谁创建了它"这一层含义，不存在第二跳。
    const maxDepth =
      input.relation === 'instantiations' ? 1 : normalizeBoundedInteger(input.depth, 1, 1, 8);
    const walk = context.snapshot
      ? await this.walkRelation(context, rule, anchor, maxDepth)
      : { edges: [], distances: new Map<string, number>(), truncated: false };
    const symbols = [...walk.distances.entries()]
      .map(([id, distance]) => ({ symbol: context.symbolById.get(id), distance }))
      .filter(
        (entry): entry is { symbol: SourceSymbolNode; distance: number } =>
          entry.symbol !== undefined
      )
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.symbol.filePath.localeCompare(right.symbol.filePath) ||
          left.symbol.symbolId.localeCompare(right.symbol.symbolId)
      )
      .map((entry) => entry.symbol);
    const edges = walk.edges.slice(0, context.options.edgeLimit);
    const sections = await this.buildRelationSections(context, symbols, edges);
    return createSourceGraphRelationsResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      relation: input.relation,
      symbolId,
      // 没有任何起点的请求也要能如实返回"缺起点"的诊断。
      filePath: filePath ?? (symbolId ? undefined : 'unknown'),
      symbols,
      edges: context.options.includeEdges === false ? [] : edges,
      sourceSections: finalizeSourceSections(context, sections),
      distances: Object.fromEntries(walk.distances),
      truncated: walk.truncated || walk.edges.length > edges.length,
      freshness: context.freshness,
      diagnostics: [...context.diagnostics, ...diagnostics],
    });
  }

  async impact(input: SourceGraphImpactInput): Promise<SourceGraphImpactResult> {
    const context = await this.createContext(input, 'target');
    const changedFiles = this.resolveImpactSeedFiles(context, input);
    // 只给了符号时，受影响的是用到这个符号的地方，不是它所在文件的全部导入方。
    const seedFiles =
      input.symbolId && !(input.changedFiles?.length || input.filePath) ? [] : changedFiles;
    const closure = await this.collectDependents(
      context,
      seedFiles,
      input.symbolId ? [input.symbolId] : [],
      normalizeBoundedInteger(input.depth, 3, 1, 8)
    );
    const impactedEdges = closure.edges.slice(0, context.options.edgeLimit);
    const impactedFiles = normalizeStringList([...changedFiles, ...closure.files.keys()]);
    const testFiles = collectTestFiles(context, impactedFiles, closure.edges);
    const diagnostics = [...context.diagnostics];
    if (testFiles.length === 0) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'affected-tests-unknown',
          message:
            'No deterministic source graph test edge or indexed test file covers this impact.',
          metadata: { changedFiles, impactedFiles },
        })
      );
    }

    return createSourceGraphImpactResult({
      generationId: context.generationId,
      projectRoot: context.projectRoot,
      repoId: context.repoId,
      freshness: context.freshness,
      diagnostics,
      changedFiles,
      impactedFiles,
      impactedSymbols: [...closure.symbols.entries()]
        .filter(([, distance]) => distance > 0)
        .map(([id, distance]) => ({ symbol: context.symbolById.get(id), distance }))
        .filter(
          (entry): entry is { symbol: SourceSymbolNode; distance: number } =>
            entry.symbol !== undefined && entry.symbol.kind !== 'module'
        )
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            left.symbol.symbolId.localeCompare(right.symbol.symbolId)
        )
        .map((entry) => entry.symbol),
      edges: context.options.includeEdges === false ? [] : impactedEdges,
      affectedValidations: testFiles.map((filePath) => `test:${filePath}`),
      depth: closure.depth,
      truncated: closure.truncated || closure.edges.length > impactedEdges.length,
    });
  }

  async affectedTests(
    input: SourceGraphAffectedTestsInput
  ): Promise<SourceGraphAffectedTestsResult> {
    const context = await this.createContext(input, 'target');
    const changedFiles = normalizeStringList(input.changedFiles.map(normalizeRepoPath));
    // 测试可以隔着好几层才依赖到被改的文件：一直走到没有新的依赖方为止。
    const closure = await this.collectDependents(context, changedFiles, [], MAX_RELATION_DEPTH);
    const impactedFiles = normalizeStringList([...changedFiles, ...closure.files.keys()]);
    const testFiles = collectTestFiles(context, impactedFiles, closure.edges);
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
    const context = await this.createContext(input, 'target');
    const changedFiles = normalizeStringList((input.changedFiles ?? []).map(normalizeRepoPath));
    const seedSymbols = normalizeStringList(input.symbolIds ?? []);
    const missingSeedSymbols = seedSymbols.filter((symbolId) => !context.symbolById.has(symbolId));
    const seedFiles = this.resolveValidationSeedFiles(context, input, changedFiles, seedSymbols);
    const closure = await this.collectDependents(
      context,
      seedFiles,
      seedSymbols,
      MAX_RELATION_DEPTH
    );
    const impactedEdges = closure.edges.slice(0, context.options.edgeLimit);
    const impactedFiles = normalizeStringList([...seedFiles, ...closure.files.keys()]);
    const impactedSymbols = uniqueSymbols(
      [...closure.symbols.keys()]
        .map((id) => context.symbolById.get(id))
        .filter((symbol): symbol is SourceSymbolNode => symbol !== undefined)
    );
    const testFiles = collectTestFiles(context, impactedFiles, closure.edges);
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

  private async loadTargetEdges(
    context: SourceGraphQueryContext,
    targets: Parameters<SourceGraphRepositoryImpl['findEdgesForTargets']>[1]
  ): Promise<void> {
    if (context.snapshot) {
      context.edges = factEdges(
        await this.repository.findEdgesForTargets(context.snapshot.generationId, targets),
        context.options
      );
    }
  }

  private async createContext(
    input: SourceGraphRankingOptions,
    edgeRead: 'ranking' | 'target' = 'ranking'
  ): Promise<SourceGraphQueryContext> {
    const options = normalizeRankingOptions(input);
    // 同一查询的符号召回与文本召回复用总预算，不能各自重新获得一份额度。
    const sectionBudget = new SectionBudget(options.sourceSectionLineBudget);
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
        sectionBudget,
        sourceLines: new Map(),
      };
    }

    const files = await this.repository.listFiles(snapshot.generationId);
    const symbols = await this.repository.listSymbols(snapshot.generationId);
    // 排名继续使用既有连通性采样；显式目标操作在识别 symbol/file 后读取相关边，
    // 不能先对全图 LIMIT 再筛选，否则其他文件会吞掉目标的全部返回预算。
    const edges =
      edgeRead === 'ranking'
        ? factEdges(
            await this.repository.listEdges(snapshot.generationId, { limit: options.edgeLimit }),
            options
          )
        : [];
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
      sectionBudget,
      sourceLines: new Map(),
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
        const { score, matchScore, reasons } = scoreSymbol(
          symbol,
          file,
          edges,
          terms,
          context.options
        );
        return { symbol, file, score, matchScore, reasons, edges };
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
    if (first.matchScore < 35) {
      diagnostics.push(
        createSourceGraphDiagnostic({
          code: 'low-confidence-query',
          message: `Top source graph match is low confidence for query: ${terms.query}`,
          metadata: { topScore: first.matchScore, topSymbolId: first.symbol.symbolId },
        })
      );
    }
    if (second && first.matchScore - second.matchScore < 10) {
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
        matchScore: 100,
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
      const lines = await readProjectFileLines(context, file.repoRelativePath);
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
    const budget = context.sectionBudget;
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
          ? await readProjectFileText(context, plan.filePath, allowed.startLine, allowed.endLine)
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

  /** 关系查询的起点：符号级关系是一组符号，文件级关系是一组文件。 */
  private resolveRelationAnchor(
    context: SourceGraphQueryContext,
    rule: RelationRule,
    symbolId: string | undefined,
    includeMembers: boolean | undefined,
    alsoSymbolIds: readonly string[] = []
  ): { symbolIds: string[]; filePaths: string[]; missing?: string } {
    const filePath = context.options.filePath;
    const symbol = symbolId ? context.symbolById.get(symbolId) : undefined;
    const also = alsoSymbolIds.flatMap((id) => context.symbolById.get(id) ?? []);
    if (symbolId && !symbol) {
      return {
        symbolIds: [],
        filePaths: [],
        missing: `Source graph symbol not found: ${symbolId}`,
      };
    }
    if (rule.level === 'file') {
      const file = symbol?.filePath ?? filePath;
      return file && context.fileByPath.has(file)
        ? { symbolIds: [], filePaths: [file] }
        : {
            symbolIds: [],
            filePaths: [],
            missing: file
              ? `Source graph file not found: ${file}`
              : 'Source graph relation query needs a symbolId or filePath.',
          };
    }
    if (symbol) {
      const members = includeMembers
        ? membersOfType(context, [symbol, ...also]).map((candidate) => candidate.symbolId)
        : [];
      return { symbolIds: [symbol.symbolId, ...members], filePaths: [] };
    }
    if (!filePath) {
      return {
        symbolIds: [],
        filePaths: [],
        missing: 'Source graph relation query needs a symbolId or filePath.',
      };
    }
    const declared = context.symbols
      .filter((candidate) => candidate.filePath === filePath)
      .map((candidate) => candidate.symbolId);
    return declared.length > 0
      ? { symbolIds: declared, filePaths: [] }
      : { symbolIds: [], filePaths: [], missing: `Source graph file not found: ${filePath}` };
  }

  /** 从起点出发沿一种关系逐层走；每层只读与当前前沿有关的边。 */
  private async walkRelation(
    context: SourceGraphQueryContext,
    rule: RelationRule,
    anchor: { symbolIds: string[]; filePaths: string[] },
    maxDepth: number
  ): Promise<{ edges: SourceGraphEdge[]; distances: Map<string, number>; truncated: boolean }> {
    const generationId = context.snapshot?.generationId;
    const edges = new Map<string, SourceGraphEdge>();
    const distances = new Map<string, number>();
    const incoming = rule.direction === 'incoming';
    // 文件级关系按文件走，结果用文件自身的 #module 符号表示。
    const visited = new Set(rule.level === 'file' ? anchor.filePaths : anchor.symbolIds);
    let frontier = [...visited];
    let truncated = false;
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && generationId; depth += 1) {
      const current = new Set(frontier);
      const found = factEdges(
        await this.repository.findEdgesForTargets(
          generationId,
          rule.level === 'file'
            ? { filePaths: frontier }
            : { symbolIds: frontier, direction: rule.direction }
        ),
        context.options
      );
      const next: string[] = [];
      for (const edge of found) {
        if (!rule.kinds.has(edge.kind) || (rule.accepts && !rule.accepts(edge))) {
          continue;
        }
        const near =
          rule.level === 'file'
            ? incoming
              ? edge.toFilePath
              : edge.fromFilePath
            : incoming
              ? edge.toSymbolId
              : edge.fromSymbolId;
        const far =
          rule.level === 'file'
            ? incoming
              ? edge.fromFilePath
              : edge.toFilePath
            : incoming
              ? edge.fromSymbolId
              : edge.toSymbolId;
        if (!near || !current.has(near) || !far) {
          continue;
        }
        edges.set(edge.edgeId, edge);
        if (!visited.has(far)) {
          visited.add(far);
          next.push(far);
          distances.set(rule.level === 'file' ? `${far}#module` : far, depth);
        }
        if (edges.size >= MAX_TRAVERSAL_EDGES) {
          truncated = true;
          break;
        }
      }
      if (truncated) {
        break;
      }
      // 到了深度上限而前沿还没走完，也要如实说明结果不是全部。
      truncated = depth === maxDepth && next.length > 0 && maxDepth > 1;
      frontier = next;
    }
    return { edges: [...edges.values()], distances, truncated };
  }

  /**
   * 依赖起点的一方，逐层向外：符号的调用方、子类型及引用方；文件的导入方；符号对应的测试。
   * 只沿"谁依赖它"的方向走——被起点依赖的文件与符号不受起点变化的影响。
   */
  private async collectDependents(
    context: SourceGraphQueryContext,
    seedFiles: readonly string[],
    seedSymbolIds: readonly string[],
    maxDepth: number
  ): Promise<{
    edges: SourceGraphEdge[];
    files: Map<string, number>;
    symbols: Map<string, number>;
    depth: number;
    truncated: boolean;
  }> {
    const generationId = context.snapshot?.generationId;
    const edges = new Map<string, SourceGraphEdge>();
    const files = new Map<string, number>(seedFiles.map((filePath) => [filePath, 0]));
    const seedFileSet = new Set(seedFiles);
    const symbols = new Map<string, number>(
      [
        ...seedSymbolIds.filter((id) => context.symbolById.has(id)),
        // 文件变了，它里面的任何声明都可能变。
        ...context.symbols
          .filter((symbol) => seedFileSet.has(symbol.filePath))
          .map((symbol) => symbol.symbolId),
      ].map((id) => [id, 0])
    );
    let symbolFrontier = [...symbols.keys()];
    let fileFrontier = [...files.keys()];
    let depth = 0;
    let truncated = false;
    while (
      generationId &&
      depth < maxDepth &&
      (symbolFrontier.length > 0 || fileFrontier.length > 0)
    ) {
      depth += 1;
      const currentSymbols = new Set(symbolFrontier);
      const currentFiles = new Set(fileFrontier);
      const found = factEdges(
        await this.repository.findEdgesForTargets(generationId, {
          symbolIds: symbolFrontier,
          filePaths: fileFrontier,
        }),
        context.options
      );
      const nextSymbols: string[] = [];
      const nextFiles: string[] = [];
      const reach = (filePath: string | undefined, symbolId: string | undefined) => {
        if (symbolId && !symbols.has(symbolId)) {
          symbols.set(symbolId, depth);
          nextSymbols.push(symbolId);
        }
        if (filePath && !files.has(filePath)) {
          files.set(filePath, depth);
        }
      };
      for (const edge of found) {
        if (edge.kind === 'imports') {
          // 文件依赖：导入方依赖被导入的文件。
          if (edge.toFilePath && currentFiles.has(edge.toFilePath) && edge.fromFilePath) {
            edges.set(edge.edgeId, edge);
            if (!files.has(edge.fromFilePath)) {
              files.set(edge.fromFilePath, depth);
              nextFiles.push(edge.fromFilePath);
            }
          }
        } else if (edge.kind === 'symbol_to_test') {
          // "这个符号由那个测试覆盖"：测试依赖符号，边的方向是符号 → 测试。
          if (edge.fromSymbolId && currentSymbols.has(edge.fromSymbolId)) {
            edges.set(edge.edgeId, edge);
            reach(edge.toFilePath, undefined);
          }
        } else if (
          SYMBOL_DEPENDENCY_KINDS.has(edge.kind) &&
          edge.toSymbolId &&
          currentSymbols.has(edge.toSymbolId)
        ) {
          edges.set(edge.edgeId, edge);
          reach(edge.fromFilePath, edge.fromSymbolId);
        }
        if (edges.size >= MAX_TRAVERSAL_EDGES) {
          truncated = true;
          break;
        }
      }
      if (truncated) {
        break;
      }
      symbolFrontier = nextSymbols;
      fileFrontier = nextFiles;
    }
    if (
      !truncated &&
      depth === maxDepth &&
      (symbolFrontier.length > 0 || fileFrontier.length > 0)
    ) {
      // 再往外可能还有依赖方；只在确实还有下一层时才报告没走完。
      truncated = await this.hasFurtherDependents(context, symbolFrontier, fileFrontier);
    }
    if (truncated) {
      Logger.debug('Source graph dependent closure stopped before exhausting the graph', {
        generationId,
        seedFiles: seedFiles.length,
        seedSymbols: seedSymbolIds.length,
        depth,
        maxDepth,
        edges: edges.size,
        edgeCap: MAX_TRAVERSAL_EDGES,
      });
    }
    return { edges: [...edges.values()], files, symbols, depth, truncated };
  }

  private async hasFurtherDependents(
    context: SourceGraphQueryContext,
    symbolIds: readonly string[],
    filePaths: readonly string[]
  ): Promise<boolean> {
    const generationId = context.snapshot?.generationId;
    if (!generationId) {
      return false;
    }
    const symbols = new Set(symbolIds);
    const files = new Set(filePaths);
    return factEdges(
      await this.repository.findEdgesForTargets(generationId, { symbolIds, filePaths }),
      context.options
    ).some((edge) =>
      edge.kind === 'imports'
        ? edge.toFilePath !== undefined && files.has(edge.toFilePath)
        : SYMBOL_DEPENDENCY_KINDS.has(edge.kind) &&
          edge.toSymbolId !== undefined &&
          symbols.has(edge.toSymbolId)
    );
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

interface RelationRule {
  direction: 'incoming' | 'outgoing';
  kinds: ReadonlySet<string>;
  /** symbol：端点是符号；file：端点是文件（导入关系）。 */
  level: 'symbol' | 'file';
  accepts?: (edge: SourceGraphEdge) => boolean;
}

const CALL_KINDS: ReadonlySet<string> = new Set(['calls']);
const HIERARCHY_KINDS: ReadonlySet<string> = new Set([
  'extends',
  'implements',
  'inherits',
  'conforms',
]);
const IMPORT_KINDS: ReadonlySet<string> = new Set(['imports']);

/** 创建实例的调用：`new T()`、JSX 元素，以及没有语法种类的语言里目标是类型的调用。 */
function isInstantiation(edge: SourceGraphEdge): boolean {
  return edge.metadata.callKind === 'new' || edge.metadata.callKind === 'jsx';
}

const RELATION_RULES: Record<SourceGraphRelation, RelationRule> = {
  callers: { direction: 'incoming', kinds: CALL_KINDS, level: 'symbol' },
  callees: { direction: 'outgoing', kinds: CALL_KINDS, level: 'symbol' },
  instantiations: {
    direction: 'incoming',
    kinds: CALL_KINDS,
    level: 'symbol',
    accepts: isInstantiation,
  },
  supertypes: { direction: 'outgoing', kinds: HIERARCHY_KINDS, level: 'symbol' },
  subtypes: { direction: 'incoming', kinds: HIERARCHY_KINDS, level: 'symbol' },
  importers: { direction: 'incoming', kinds: IMPORT_KINDS, level: 'file' },
  imports: { direction: 'outgoing', kinds: IMPORT_KINDS, level: 'file' },
};

/** 一个符号变化会波及它的使用方的那些边：调用、继承与实现、引用、数据流、路由。 */
const SYMBOL_DEPENDENCY_KINDS: ReadonlySet<string> = new Set([
  'calls',
  ...HIERARCHY_KINDS,
  'references',
  'data_flow',
  'route_to_handler',
  'depends_on',
]);

const MAX_RELATION_DEPTH = 8;
/** 一次遍历最多读这么多条边；到了就停并如实标记，不让病态的图把查询拖垮。 */
const MAX_TRAVERSAL_EDGES = 20_000;

/**
 * 一个类型的成员。sites 是这个类型的全部声明处（多数语言只有一处）。
 *
 * 写在类型体内的成员指向同文件里的那个声明。写在别处的成员——Swift 的 extension、
 * ObjC 的实现文件与分类——所在文件里没有这个类型的声明，只记着所属类型的名字：名字相同、
 * 且那个文件自己没有另外声明一个同名类型时，它们属于这个类型。
 */
function membersOfType(
  context: SourceGraphQueryContext,
  sites: readonly SourceSymbolNode[]
): SourceSymbolNode[] {
  if (sites.length === 0) {
    return [];
  }
  const siteIds = new Set(sites.map((site) => site.symbolId));
  const typeNames = new Set(sites.map((site) => site.qualifiedName ?? site.displayName));
  // 另外声明了同名类型的文件：那里的成员归那个类型。
  const otherDeclarationFiles = new Set<string>();
  for (const candidate of context.symbols) {
    if (
      candidate.kind !== 'module' &&
      !siteIds.has(candidate.symbolId) &&
      outlineContainer(candidate) === undefined &&
      typeNames.has(candidate.qualifiedName ?? candidate.displayName)
    ) {
      otherDeclarationFiles.add(candidate.filePath);
    }
  }
  return context.symbols.filter((candidate) => {
    if (candidate.kind === 'module' || siteIds.has(candidate.symbolId)) {
      return false;
    }
    if (candidate.containerSymbolId) {
      return siteIds.has(candidate.containerSymbolId);
    }
    const container = outlineContainer(candidate);
    return (
      container !== undefined &&
      typeNames.has(container) &&
      !otherDeclarationFiles.has(candidate.filePath)
    );
  });
}

/** 声明所属类型的名字（协议对外呈现的那个）；顶层声明没有。 */
function outlineContainer(symbol: SourceSymbolNode): string | undefined {
  const outline = symbol.metadata.outline;
  const container =
    outline && typeof outline === 'object' && 'container' in outline
      ? outline.container
      : undefined;
  return typeof container === 'string' && container ? container : undefined;
}

/** 候选档的边不是事实：除非查询明确要求，否则任何结果都看不到它们。 */
function factEdges(
  edges: SourceGraphEdge[],
  options: Pick<NormalizedRankingOptions, 'includeCandidates'>
): SourceGraphEdge[] {
  if (options.includeCandidates) {
    return edges;
  }
  return edges.filter((edge) => {
    const resolution = edge.metadata.resolution;
    return !(
      resolution &&
      typeof resolution === 'object' &&
      'tier' in resolution &&
      resolution.tier === 'candidate'
    );
  });
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
    includeCandidates: input.includeCandidates ?? false,
  };
}

function scoreSymbol(
  symbol: SourceSymbolNode,
  file: SourceFileNode | undefined,
  edges: SourceGraphEdge[],
  terms: QueryTerms,
  options: NormalizedRankingOptions
): { score: number; matchScore: number; reasons: string[] } {
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
  return { score, matchScore: score - connectivity, reasons };
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

/**
 * 正文能不能给，看的是索引有没有过期，不是覆盖是否完整：partial 只说明别的文件有解析缺口，
 * 而每个被引用文件的正文在读取时都按索引里的内容哈希单独核对过。
 */
function canIncludeSourceText(context: SourceGraphQueryContext): boolean {
  return context.options.includeText && isCurrentFreshness(context.freshness.status);
}

function isCurrentFreshness(status: SourceGraphFreshness['status']): boolean {
  return status === 'fresh' || status === 'partial';
}

async function readProjectFileLines(
  context: SourceGraphQueryContext,
  repoRelativePath: string
): Promise<string[]> {
  const cached = context.sourceLines.get(repoRelativePath);
  if (cached !== undefined) {
    return cached;
  }
  // 同一查询只读取并核验一次正文；后续 range/text-recall 共用已核验字节，
  // 避免两次读取跨过文件编辑时把不同版本拼成同一份 source section。
  // 两个读取循环均串行 await；若未来改为并发读取，此处须改存 Promise 而非空数组哨兵。
  context.sourceLines.set(repoRelativePath, []);
  const { projectRoot } = context;
  const expectedContentHash = context.fileByPath.get(repoRelativePath)?.contentHash;
  const absolutePath = resolveProjectFile(projectRoot, repoRelativePath);
  if (!expectedContentHash) {
    rejectUnverifiedSourceText(context, repoRelativePath, 'missing-indexed-hash');
    return [];
  }
  if (!absolutePath) {
    rejectUnverifiedSourceText(context, repoRelativePath, 'outside-project-scope');
    return [];
  }
  try {
    // 索引完成后文件也可能被换成符号链接；查询时仍需验证真实路径边界。
    const rootRealpath = await fs.realpath(projectRoot);
    const fileRealpath = await fs.realpath(absolutePath);
    const relative = path.relative(rootRealpath, fileRealpath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      Logger.getInstance().warn('Source graph text read refused outside project scope', {
        projectRoot,
        repoRelativePath,
        fileRealpath,
      });
      rejectUnverifiedSourceText(context, repoRelativePath, 'outside-project-scope');
      return [];
    }
    const content = await fs.readFile(fileRealpath, 'utf8');
    const actualContentHash = crypto.createHash('sha256').update(content).digest('hex');
    if (actualContentHash !== expectedContentHash) {
      rejectUnverifiedSourceText(context, repoRelativePath, 'content-hash-mismatch', {
        expectedContentHash,
        actualContentHash,
      });
      return [];
    }
    const lines = content.split(/\r\n|\n|\r/);
    context.sourceLines.set(repoRelativePath, lines);
    return lines;
  } catch (error) {
    rejectUnverifiedSourceText(context, repoRelativePath, 'source-unavailable', {
      error: error instanceof Error ? error.message : String(error),
      expectedContentHash,
    });
    return [];
  }
}

async function readProjectFileText(
  context: SourceGraphQueryContext,
  repoRelativePath: string,
  startLine: number,
  endLine: number
): Promise<string | undefined> {
  const lines = await readProjectFileLines(context, repoRelativePath);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.slice(startLine - 1, endLine).join('\n');
}

function rejectUnverifiedSourceText(
  context: SourceGraphQueryContext,
  filePath: string,
  reason:
    | 'content-hash-mismatch'
    | 'missing-indexed-hash'
    | 'outside-project-scope'
    | 'source-unavailable',
  metadata: Record<string, unknown> = {}
): void {
  const changed = reason === 'content-hash-mismatch';
  const message = changed
    ? 'Live source content no longer matches the indexed source graph file.'
    : 'Source graph text could not be verified against an indexed file.';
  const nextAction = changed
    ? 'run_incremental_source_graph_index'
    : 'verify_source_ref_before_citing';
  const alreadyUnavailable = context.freshness.status === 'unavailable';
  // 只降级本次读取，不在查询中修改持久化 generation 或偷偷重建图。
  // 后续另一个文件的 hash 变化不能把先前无法核验的状态升级为仅需增量更新的 stale。
  context.freshness = createSourceGraphFreshness({
    ...context.freshness,
    status: changed && !alreadyUnavailable ? 'stale' : 'unavailable',
    checkedAt: Date.now(),
    pendingFileCount: context.freshness.pendingFileCount + (changed ? 1 : 0),
    reason: alreadyUnavailable ? context.freshness.reason : message,
    nextAction: alreadyUnavailable ? context.freshness.nextAction : nextAction,
  });
  context.diagnostics.push(
    createSourceGraphDiagnostic({
      code: changed ? 'pending-file-in-response' : 'source-ref-unproven',
      message,
      filePath,
      nextAction,
      metadata: { reason, ...metadata },
    })
  );
  Logger.getInstance().warn('Source graph omitted unverified source text', {
    generationId: context.generationId,
    filePath,
    reason,
    ...metadata,
    freshness: context.freshness.status,
    nextAction: context.freshness.nextAction,
  });
}

function finalizeSourceSections(
  context: SourceGraphQueryContext,
  sections: SourceSection[]
): SourceSection[] {
  if (isCurrentFreshness(context.freshness.status)) {
    return sections;
  }
  // 后续文本召回也可能发现漂移；先前已生成的 section 必须服从同一查询的降级状态。
  return sections.map((section) => ({
    ...section,
    text: undefined,
    freshness: createSourceGraphFreshness(context.freshness),
  }));
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

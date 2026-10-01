import path from 'node:path';
import {
  type FileSummary,
  isProjectRelationKind,
  type ModuleSummary,
  type ProjectContextQueryError,
  type ProjectContextRef,
  type ProjectEvidenceContext,
  type ProjectImpactContext,
  type ProjectIndexState,
  type ProjectModuleDependencyContext,
  type ProjectModuleDependencySummary,
  type ProjectRelationEnvelope,
  type ProjectRelationKind,
  type ProjectRelationRequest,
  type ProjectRelationResult,
  type ProjectRelationTarget,
  type ProjectRelationWalkContext,
  type ProjectRelationWalkKind,
  type ProjectSymbolListContext,
  type RelationSummary,
  type RepoContext,
  type SymbolSummary,
} from '../../../domain/project-context/index.js';
import type {
  SourceFileNode,
  SourceGraphEdge,
  SourceGraphSnapshot,
  SourceSymbolNode,
} from '../../../domain/source-graph/index.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { SourceGraphRepositoryImpl } from '../../../repository/source-graph/SourceGraphRepository.js';
import type { SourceGraphIndexOptions } from '../../source-graph/SourceGraphIndexOptions.js';
import { SourceGraphLifecycleService } from '../../source-graph/SourceGraphLifecycle.js';
import { SourceGraphQueryService } from '../../source-graph/SourceGraphQueryService.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { ProjectContext } from '../ProjectContextService.js';
import { ownerOfPath } from '../shared/map-repo/index.js';
import { dedupeProjectContextRefs } from '../shared/refs.js';
import { loadSourceSliceFile } from '../sourceSlice/fileAccess.js';
import { createRelationProjection, type RelationProjection } from './projection.js';
import { parseProjectContextRef } from './refIds.js';

export interface ProjectRelationsOptions {
  /** 宿主数据库上的源码索引仓库。 */
  repository: SourceGraphRepositoryImpl;
  /** 索引的仓库标识，与建索引时传的 repoId 一致；默认 'default'。 */
  indexRepoId?: string;
}

/**
 * 关系查询的入口：把协议形态的请求交给源码索引，再把索引的回答投影回协议的符号、文件与引用。
 * 这里不保存任何项目状态；索引的代际由宿主的数据库持有。
 */
export interface ProjectRelations {
  /** 把索引追到当前源码：没有就建，过期就增量，已是最新则不动。 */
  ensureIndex(options: SourceGraphIndexOptions): Promise<ProjectIndexState>;
  query(
    request: ProjectRelationRequest,
    context?: { signal?: AbortSignal }
  ): Promise<ProjectRelationEnvelope>;
}

const FILE_LEVEL_KINDS: ReadonlySet<string> = new Set(['importers', 'imports']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
/** evidence 带回正文的行数上限：复核一条引用不需要整份文件。 */
const MAX_EVIDENCE_LINES = 200;
const MAX_NEXT_REFS = 60;
/** 模块之间的依赖由这些边构成：文件导入与符号级的使用关系。 */
const MODULE_DEPENDENCY_KINDS: ReadonlySet<string> = new Set([
  'imports',
  'calls',
  'extends',
  'implements',
  'inherits',
  'conforms',
  'references',
]);
/** 每一对模块带几条有代表性的关系供核对。 */
const MODULE_DEPENDENCY_SAMPLES = 3;
/** 模块划分要看到仓库的全部源码文件；与宿主建图时用的上限一致。 */
const MODULE_PARTITION_MAX_FILES = 20_000;

interface GenerationView {
  snapshot: SourceGraphSnapshot;
  files: Map<string, SourceFileNode>;
  symbols: Map<string, SourceSymbolNode | null>;
  coverageGaps: number;
}

type ResolvedTarget =
  | {
      ok: true;
      symbol?: SourceSymbolNode;
      file?: SourceFileNode;
      /** 同一个声明的其他落点：头文件里的方法声明之于实现文件里的定义。 */
      counterparts?: SourceSymbolNode[];
    }
  | { ok: false; error: ProjectContextQueryError };

export function createProjectRelations(options: ProjectRelationsOptions): ProjectRelations {
  const { repository } = options;
  const indexRepoId = options.indexRepoId?.trim() || 'default';
  const queries = new SourceGraphQueryService(repository);
  const views = new Map<string, GenerationView>();

  /** 一代索引的文件表只读一次；代际重写（同一编号再次发布）时计数或时间会变，缓存随之失效。 */
  const viewOf = async (snapshot: SourceGraphSnapshot): Promise<GenerationView> => {
    const key = [
      snapshot.generationId,
      snapshot.indexedAt,
      snapshot.fileCount,
      snapshot.symbolCount,
      snapshot.edgeCount,
    ].join(':');
    let view = views.get(key);
    if (!view) {
      const files = await repository.listFiles(snapshot.generationId);
      view = {
        snapshot,
        files: new Map(files.map((file) => [file.repoRelativePath, file])),
        symbols: new Map(),
        coverageGaps: files.filter(
          (file) => file.parseStatus !== 'parsed' && file.metadata.inventoryOnly !== true
        ).length,
      };
      views.clear();
      views.set(key, view);
    }
    return view;
  };

  const symbolOf = async (
    view: GenerationView,
    symbolId: string | undefined
  ): Promise<SourceSymbolNode | undefined> => {
    if (!symbolId) {
      return undefined;
    }
    let symbol = view.symbols.get(symbolId);
    if (symbol === undefined) {
      symbol = await repository.getSymbol(view.snapshot.generationId, symbolId);
      view.symbols.set(symbolId, symbol);
    }
    return symbol ?? undefined;
  };

  const remember = (view: GenerationView, symbols: readonly SourceSymbolNode[]) => {
    for (const symbol of symbols) {
      view.symbols.set(symbol.symbolId, symbol);
    }
  };

  return {
    async ensureIndex(indexOptions) {
      const result = await new SourceGraphLifecycleService(repository).catchUpOnStartup(
        indexOptions
      );
      views.clear();
      const snapshot = result.generationId
        ? await repository.getSnapshot(result.generationId)
        : null;
      Logger.debug('ProjectContext relations brought the source index up to date', {
        projectRoot: result.projectRoot,
        action: result.action,
        generationId: result.generationId,
        freshness: result.freshness.status,
      });
      return snapshot
        ? indexState(await viewOf(snapshot))
        : unavailableIndex(result.freshness.status, result.freshness.reason);
    },

    async query(request, context) {
      throwIfProjectContextAborted(context);
      const kind = request?.kind;
      const projectRoot =
        typeof request?.scope?.projectRoot === 'string' && request.scope.projectRoot.trim()
          ? path.resolve(request.scope.projectRoot)
          : undefined;
      if (!isProjectRelationKind(kind) || !projectRoot) {
        return failure(
          isProjectRelationKind(kind) ? kind : 'symbols',
          { projectRoot: projectRoot ?? '', repoId: request?.scope?.repoId },
          unavailableIndex('uninitialized'),
          {
            code: isProjectRelationKind(kind) ? 'invalid-scope' : 'invalid-request-kind',
            message: isProjectRelationKind(kind)
              ? 'relation query scope.projectRoot is required.'
              : `Unsupported relation query kind: ${String(kind)}.`,
            retryable: false,
            severity: 'error',
          }
        );
      }
      const project = { projectRoot, repoId: request.scope.repoId };
      const projection = createRelationProjection({
        projectRoot,
        repoId: request.scope.repoId,
        sourceFolder: request.scope.sourceFolder,
      });
      const snapshot = await repository.getLatestSnapshot(projectRoot, indexRepoId);
      throwIfProjectContextAborted(context);
      const view = snapshot ? await viewOf(snapshot) : undefined;

      if (kind === 'evidence') {
        // 复核引用读的是当前文件，不依赖索引；索引只用来回答"它与索引里的版本是否一致"。
        return evidence(request, project, projection, view, context);
      }
      if (!view) {
        Logger.debug('ProjectContext relation query has no source index to read', {
          projectRoot,
          indexRepoId,
          kind,
        });
        return failure(
          kind,
          project,
          unavailableIndex('uninitialized', 'No source index exists for this project.'),
          {
            code: 'query-unavailable',
            message:
              'No source index exists for this project; build it before asking relation queries.',
            retryable: true,
            severity: 'warning',
          }
        );
      }
      const state = indexState(view);

      if (kind === 'search') {
        const result = await queries.search({
          generationId: view.snapshot.generationId,
          query: request.query ?? '',
          limit: boundedLimit(request.limit, 20, 100),
          includeText: false,
          includeEdges: false,
        });
        remember(view, result.symbols);
        const symbols = summarizeSymbols(view, projection, result.symbols);
        const data: ProjectSymbolListContext = {
          kind,
          symbols,
          truncated: false,
          nextRefs: nextRefs(symbols.map((symbol) => symbol.ref)),
        };
        return envelope(kind, project, state, data);
      }

      if (kind === 'module-dependencies') {
        return moduleDependencies(request, project, projection, view, state, context);
      }

      const target = await resolveTarget(view, request.target, kind === 'impact');
      throwIfProjectContextAborted(context);
      if (!target.ok) {
        return failure(kind, project, state, target.error);
      }

      if (kind === 'symbols') {
        const file = target.file ?? fileOfSymbol(view, target.symbol);
        if (!file) {
          return failure(kind, project, state, targetRequired(kind, 'a file'));
        }
        const limit = MAX_LIMIT;
        const declared = (
          await repository.searchSymbols(view.snapshot.generationId, '', {
            filePath: file.repoRelativePath,
            limit,
          })
        ).filter((symbol) => symbol.kind !== 'module');
        remember(view, declared);
        const symbols = summarizeSymbols(view, projection, declared).sort(compareByPosition);
        const data: ProjectSymbolListContext = {
          kind,
          file: projection.fileSummary(file),
          symbols,
          truncated: declared.length >= limit,
          nextRefs: nextRefs([projection.fileRef(file), ...symbols.map((symbol) => symbol.ref)]),
        };
        return envelope(kind, project, state, data);
      }

      if (kind === 'impact') {
        const changedFiles = [
          ...(request.changedFiles ?? []),
          ...(target.file && !target.symbol ? [target.file.repoRelativePath] : []),
        ];
        if (changedFiles.length === 0 && !target.symbol) {
          return failure(kind, project, state, targetRequired(kind, 'changedFiles or a symbol'));
        }
        const result = await queries.impact({
          generationId: view.snapshot.generationId,
          changedFiles,
          symbolId: target.symbol?.symbolId,
          depth: request.depth,
          edgeLimit: boundedLimit(request.limit, DEFAULT_LIMIT, MAX_LIMIT),
          includeCandidates: request.includeCandidates,
          includeText: false,
        });
        remember(view, result.impactedSymbols);
        const relations = await summarizeEdges(view, projection, result.edges);
        const filesOf = (paths: readonly string[]): FileSummary[] =>
          paths.flatMap((filePath) => {
            const file = view.files.get(filePath);
            return file ? [projection.fileSummary(file)] : [];
          });
        const impactedSymbols = summarizeSymbols(view, projection, result.impactedSymbols);
        const impactedFiles = filesOf(
          result.impactedFiles.filter((filePath) => !result.changedFiles.includes(filePath))
        );
        const data: ProjectImpactContext = {
          kind,
          changedFiles: filesOf(result.changedFiles),
          impactedFiles,
          impactedSymbols,
          tests: filesOf(
            result.affectedValidations.map((validation) => validation.replace(/^test:/, ''))
          ),
          relations,
          depth: result.depth,
          truncated: result.truncated,
          nextRefs: nextRefs([
            ...impactedSymbols.map((symbol) => symbol.ref),
            ...impactedFiles.map((file) => file.ref),
          ]),
        };
        return envelope(kind, project, state, data);
      }

      // 其余都是沿一种关系的边走。
      const walkKind = kind as ProjectRelationWalkKind;
      const anchorFile = target.file ?? fileOfSymbol(view, target.symbol);
      if (!anchorFile || (!target.symbol && !target.file)) {
        return failure(kind, project, state, targetRequired(kind, 'a symbol or a file'));
      }
      const fileLevel = FILE_LEVEL_KINDS.has(walkKind);
      const result = await queries.relations({
        generationId: view.snapshot.generationId,
        relation: walkKind,
        symbolId: fileLevel ? undefined : target.symbol?.symbolId,
        alsoSymbolIds: target.counterparts?.map((symbol) => symbol.symbolId),
        filePath: fileLevel || !target.symbol ? anchorFile.repoRelativePath : undefined,
        depth: request.depth,
        includeMembers: request.includeMembers,
        includeCandidates: request.includeCandidates,
        edgeLimit: boundedLimit(request.limit, DEFAULT_LIMIT, MAX_LIMIT),
        includeText: false,
      });
      remember(view, result.symbols);
      const related = result.symbols.filter((symbol) => symbol.kind !== 'module');
      const symbols = summarizeSymbols(view, projection, related);
      const files = result.symbols.flatMap((symbol) => {
        const file = symbol.kind === 'module' ? view.files.get(symbol.filePath) : undefined;
        return file ? [projection.fileSummary(file)] : [];
      });
      const distances: Record<string, number> = {};
      for (const symbol of result.symbols) {
        const file = view.files.get(symbol.filePath);
        const distance = result.distances[symbol.symbolId];
        const refId =
          file && symbol.kind === 'module'
            ? projection.fileRef(file).id
            : file
              ? projection.symbolSummary(symbol, file).ref?.id
              : undefined;
        if (refId && distance !== undefined) {
          distances[refId] = distance;
        }
      }
      const anchorSymbol =
        target.symbol && !fileLevel
          ? projection.symbolSummary(target.symbol, anchorFile)
          : undefined;
      const data: ProjectRelationWalkContext = {
        kind: walkKind,
        anchor: anchorSymbol
          ? { symbol: anchorSymbol, file: projection.fileSummary(anchorFile) }
          : { file: projection.fileSummary(anchorFile) },
        symbols,
        files,
        relations: await summarizeEdges(view, projection, result.edges),
        distances,
        truncated: result.truncated,
        nextRefs: nextRefs([
          anchorSymbol?.ref,
          ...symbols.map((symbol) => symbol.ref),
          ...files.map((file) => file.ref),
        ]),
      };
      return envelope(kind, project, state, data);
    },
  };

  /**
   * 模块之间谁依赖谁：模块划分来自协议自己的 repo 查询（发现层目标 → 模块），
   * 依赖来自索引里跨模块的边。清单里声明的依赖（RepoContext.dependencyGraph）是另一回事，不在这里。
   */
  async function moduleDependencies(
    request: ProjectRelationRequest,
    project: { projectRoot: string; repoId?: string },
    projection: RelationProjection,
    view: GenerationView,
    state: ProjectIndexState,
    context: { signal?: AbortSignal } | undefined
  ): Promise<ProjectRelationEnvelope> {
    const repo = await ProjectContext.execute(
      {
        kind: 'repo',
        scope: request.scope,
        payload: {
          includeCommands: false,
          includeEntrypoints: false,
          includeMapSummary: false,
          includeTopAreas: false,
          maxFiles: MODULE_PARTITION_MAX_FILES,
        },
      },
      context
    );
    throwIfProjectContextAborted(context);
    const partition = ((repo.data as RepoContext).modules ?? []).map((module) => ({
      id: module.ref.id,
      // 归属按项目相对路径判断：索引里的文件路径相对项目根，不相对仓库根。
      path: module.ref.scope.filePath ?? module.path,
      summary: {
        id: module.ref.id,
        name: module.name,
        kind: module.kind,
        ownedFileCount: module.fileCount,
        ref: module.ref,
      } satisfies ModuleSummary,
    }));
    if (partition.length === 0) {
      return failure('module-dependencies', project, state, {
        code: 'query-unavailable',
        message: 'The repository has no source files to partition into modules.',
        retryable: false,
        severity: 'warning',
      });
    }
    const focus = request.module?.trim();
    const focused = focus
      ? partition.filter((module) => module.summary.name === focus || module.path === focus)
      : [];
    if (focus && focused.length === 0) {
      return failure('module-dependencies', project, state, {
        code: 'not-found',
        message: `No module named ${focus}; modules are: ${partition
          .map((module) => module.summary.name)
          .join(', ')}`,
        retryable: false,
        severity: 'error',
      });
    }

    const owners = new Map<string, (typeof partition)[number] | undefined>();
    const ownerOf = (filePath: string | undefined) => {
      if (!filePath) {
        return undefined;
      }
      if (!owners.has(filePath)) {
        owners.set(filePath, ownerOfPath(partition, filePath));
      }
      return owners.get(filePath);
    };
    const pairs = new Map<
      string,
      {
        from: string;
        to: string;
        counts: Record<string, number>;
        trustedOnly: number;
        samples: SourceGraphEdge[];
      }
    >();
    for (const edge of await repository.listGenerationEdges(view.snapshot.generationId)) {
      if (!MODULE_DEPENDENCY_KINDS.has(edge.kind)) {
        continue;
      }
      const tier = edgeTier(edge);
      if (tier === 'candidate' && !request.includeCandidates) {
        continue;
      }
      const from = ownerOf(edge.fromFilePath);
      const to = ownerOf(edge.toFilePath);
      if (!from || !to || from === to) {
        continue;
      }
      if (focused.length > 0 && !focused.includes(from) && !focused.includes(to)) {
        continue;
      }
      const key = `${from.id}\u0000${to.id}`;
      let pair = pairs.get(key);
      if (!pair) {
        pair = { from: from.id, to: to.id, counts: {}, trustedOnly: 0, samples: [] };
        pairs.set(key, pair);
      }
      pair.counts[edge.kind] = (pair.counts[edge.kind] ?? 0) + 1;
      if (tier !== 'certain') {
        pair.trustedOnly += 1;
      }
      if (pair.samples.length < MODULE_DEPENDENCY_SAMPLES) {
        pair.samples.push(edge);
      }
    }
    const total = (counts: Record<string, number>) =>
      Object.values(counts).reduce((sum, count) => sum + count, 0);
    const limit = boundedLimit(request.limit, 200, MAX_LIMIT);
    const ordered = [...pairs.values()].sort(
      (left, right) =>
        total(right.counts) - total(left.counts) ||
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to)
    );
    const dependencies: ProjectModuleDependencySummary[] = [];
    for (const pair of ordered.slice(0, limit)) {
      dependencies.push({
        from: pair.from,
        to: pair.to,
        counts: pair.counts,
        trustedOnly: pair.trustedOnly,
        samples: await summarizeEdges(view, projection, pair.samples),
      });
    }
    const modules = partition.map((module) => module.summary);
    const data: ProjectModuleDependencyContext = {
      kind: 'module-dependencies',
      modules,
      dependencies,
      unownedFiles: [...view.files.values()].filter(
        (file) => file.metadata.inventoryOnly !== true && !ownerOf(file.repoRelativePath)
      ).length,
      truncated: ordered.length > limit,
      nextRefs: nextRefs(modules.map((module) => module.ref)),
    };
    return envelope('module-dependencies', project, state, data, repo.errors ?? []);
  }

  /** 索引的边 → 协议的关系：两端取自各自的声明，位置与引用属于关系发生处所在的文件。 */
  async function summarizeEdges(
    view: GenerationView,
    projection: RelationProjection,
    edges: readonly SourceGraphEdge[]
  ): Promise<RelationSummary[]> {
    const relations: RelationSummary[] = [];
    for (const edge of edges) {
      const from = await symbolOf(view, edge.fromSymbolId);
      const to = await symbolOf(view, edge.toSymbolId);
      relations.push(
        projection.relationSummary({
          edge,
          from,
          fromFile: view.files.get(from?.filePath ?? edge.fromFilePath ?? ''),
          to,
          toFile: view.files.get(to?.filePath ?? edge.toFilePath ?? ''),
          siteFile: view.files.get(edge.siteFilePath ?? edge.fromFilePath ?? ''),
        })
      );
    }
    return relations;
  }

  /** 把请求里的起点落到索引的符号或文件上。找不到与不唯一都是明确的错误，不取近似。 */
  async function resolveTarget(
    view: GenerationView,
    target: ProjectRelationTarget | undefined,
    optional: boolean
  ): Promise<ResolvedTarget> {
    const parsed = parseProjectContextRef(target?.ref);
    if (target?.ref && !parsed) {
      return {
        ok: false,
        error: {
          code: 'invalid-scope',
          message: 'relation query target.ref is not a file, symbol, slice or relation-site ref.',
          retryable: false,
          severity: 'error',
        },
      };
    }
    const filePath = normalizeFilePath(target?.filePath ?? parsed?.filePath);
    const name =
      target?.symbol?.trim() || (parsed?.kind === 'file-symbol' ? parsed.name : undefined);
    const line = target?.line ?? (parsed?.kind === 'file' ? undefined : parsed?.range?.startLine);
    const file = filePath ? view.files.get(filePath) : undefined;
    if (filePath && !file) {
      return {
        ok: false,
        error: {
          code: 'not-found',
          message: `File is not in the source index: ${filePath}`,
          path: filePath,
          retryable: false,
          severity: 'error',
        },
      };
    }
    if (!name) {
      if (file && line !== undefined) {
        // 只有位置：取包住这一行的最内层声明；没有声明包住它时就是文件本身。
        const enclosing = (
          await repository.searchSymbols(view.snapshot.generationId, '', {
            filePath: file.repoRelativePath,
            limit: MAX_LIMIT,
          })
        )
          .filter(
            (symbol) =>
              symbol.kind !== 'module' &&
              symbol.range.startLine <= line &&
              symbol.range.endLine >= line
          )
          .sort(
            (left, right) =>
              left.range.endLine -
              left.range.startLine -
              (right.range.endLine - right.range.startLine)
          )[0];
        return { ok: true, file, symbol: enclosing };
      }
      if (file || optional) {
        return { ok: true, file };
      }
      return { ok: false, error: targetRequired('symbols', 'a symbol or a file') };
    }

    // 限定名（Type.member）按最后一段检索，再按完整名字精确比对。
    const leaf = name.split('.').at(-1) ?? name;
    const candidates = (
      await repository.searchSymbols(view.snapshot.generationId, leaf, {
        ...(file ? { filePath: file.repoRelativePath } : {}),
        limit: MAX_LIMIT,
      })
    ).filter((symbol) => symbol.kind !== 'module');
    const qualified = candidates.filter((symbol) => symbol.qualifiedName === name);
    let matches =
      qualified.length > 0 ? qualified : candidates.filter((symbol) => symbol.displayName === name);
    if (matches.length > 1 && line !== undefined) {
      const atLine = matches.filter(
        (symbol) => symbol.range.startLine <= line && symbol.range.endLine >= line
      );
      matches = atLine.length > 0 ? atLine : matches;
    }
    if (matches.length > 1) {
      // 声明与定义分开写的语言（ObjC 的 .h 与 .m）里，同名的那几个是同一个方法：
      // 恰好只有一个带实现时，起点就是它，其余的声明作为它的别处落点一并算上。
      const definitions = matches.filter((symbol) => !isBodilessDeclaration(symbol));
      if (definitions.length === 1) {
        remember(view, matches);
        return {
          ok: true,
          symbol: definitions[0],
          file: view.files.get(definitions[0].filePath),
          counterparts: matches.filter((symbol) => symbol !== definitions[0]),
        };
      }
    }
    if (matches.length === 1) {
      view.symbols.set(matches[0].symbolId, matches[0]);
      return { ok: true, symbol: matches[0], file: view.files.get(matches[0].filePath) };
    }
    if (matches.length === 0) {
      return {
        ok: false,
        error: {
          code: 'not-found',
          message: `No declaration named ${name}${file ? ` in ${file.repoRelativePath}` : ''} is in the source index.`,
          ...(file ? { path: file.repoRelativePath } : {}),
          retryable: false,
          severity: 'error',
        },
      };
    }
    Logger.debug('ProjectContext relation target is ambiguous', {
      name,
      filePath,
      candidates: matches.length,
    });
    return {
      ok: false,
      error: {
        code: 'ambiguous',
        message: `${matches.length} declarations are named ${name}; add target.filePath or target.line. Candidates: ${matches
          .slice(0, 5)
          .map(
            (symbol) =>
              `${symbol.filePath}:${symbol.range.startLine} ${symbol.qualifiedName ?? symbol.displayName}`
          )
          .join('; ')}`,
        retryable: false,
        severity: 'error',
      },
    };
  }

  async function evidence(
    request: ProjectRelationRequest,
    project: { projectRoot: string; repoId?: string },
    projection: RelationProjection,
    view: GenerationView | undefined,
    context: { signal?: AbortSignal } | undefined
  ): Promise<ProjectRelationEnvelope> {
    const state = view ? indexState(view) : unavailableIndex('uninitialized');
    const parsed = parseProjectContextRef(request.target?.ref);
    const filePath = normalizeFilePath(request.target?.filePath ?? parsed?.filePath);
    if (!filePath) {
      return failure('evidence', project, state, targetRequired('evidence', 'a ref or a file'));
    }
    const access = await loadSourceSliceFile({
      filePath,
      projectRoot: project.projectRoot,
      repoId: request.scope.repoId,
      sourceFolder: request.scope.sourceFolder,
      signal: context?.signal,
    });
    if (!access.ok) {
      return failure('evidence', project, state, {
        code: access.failure.code,
        message: access.failure.message,
        path: access.failure.path ?? filePath,
        retryable: access.failure.retryable ?? false,
        severity: 'error',
      });
    }
    const { facts } = access;
    const range =
      parsed?.range ??
      (request.target?.line !== undefined
        ? { startLine: request.target.line, endLine: request.target.line }
        : undefined);
    const current = parsed?.hash !== undefined && parsed.hash === facts.hash;
    const indexedFile = view?.files.get(facts.filePath);
    const fileRef = projection.fileRef({
      ...(indexedFile ?? ({} as SourceFileNode)),
      repoRelativePath: facts.filePath,
      contentHash: facts.hash,
    } as SourceFileNode);
    const withinFile =
      range !== undefined && range.startLine >= 1 && range.startLine <= facts.lineCount;
    const data: ProjectEvidenceContext = {
      kind: 'evidence',
      file: {
        filePath: facts.filePath,
        hash: facts.hash,
        language: facts.language,
        lineCount: facts.lineCount,
        mtimeMs: facts.mtimeMs,
        ref: fileRef,
        repoId: request.scope.repoId,
      },
      ...(range ? { range } : {}),
      current,
      indexed: indexedFile !== undefined && indexedFile.contentHash.slice(0, 16) === facts.hash,
      ...(current
        ? {}
        : {
            reason:
              parsed?.hash === undefined
                ? 'The ref carries no content hash, so it cannot be checked against the current file.'
                : 'The file changed after this ref was produced.',
          }),
      // 过期引用指的那几行现在可能是别的内容：不给正文，避免把新内容当成旧结论的证据。
      ...(request.includeText && current && range && withinFile
        ? {
            text: facts.lines
              .slice(
                range.startLine - 1,
                Math.min(range.endLine, range.startLine - 1 + MAX_EVIDENCE_LINES)
              )
              .join('\n'),
          }
        : {}),
      nextRefs: [fileRef],
    };
    return envelope('evidence', project, state, data);
  }
}

function summarizeSymbols(
  view: GenerationView,
  projection: RelationProjection,
  symbols: readonly SourceSymbolNode[]
): SymbolSummary[] {
  return symbols.flatMap((symbol) => {
    const file = symbol.kind === 'module' ? undefined : view.files.get(symbol.filePath);
    return file ? [projection.symbolSummary(symbol, file)] : [];
  });
}

/** 没有函数体的方法声明（接口、头文件里的那一行），不是定义。 */
function isBodilessDeclaration(symbol: SourceSymbolNode): boolean {
  return symbol.metadata.compatibilitySource === 'method-declaration';
}

function edgeTier(edge: SourceGraphEdge): string {
  const resolution = edge.metadata.resolution;
  const tier =
    resolution && typeof resolution === 'object' && 'tier' in resolution
      ? resolution.tier
      : undefined;
  if (typeof tier === 'string') {
    return tier;
  }
  return edge.provenance === 'deterministic' ? 'certain' : 'trusted';
}

function fileOfSymbol(
  view: GenerationView,
  symbol: SourceSymbolNode | undefined
): SourceFileNode | undefined {
  return symbol ? view.files.get(symbol.filePath) : undefined;
}

function indexState(view: GenerationView): ProjectIndexState {
  const { snapshot } = view;
  const external = snapshot.metadata.externalLinker;
  const status =
    external && typeof external === 'object' && 'status' in external ? external.status : undefined;
  return {
    available: true,
    generationId: snapshot.generationId,
    freshness: snapshot.freshness.status,
    indexedAt: snapshot.indexedAt,
    coverageGaps: view.coverageGaps,
    externalEngine: typeof status === 'string' ? status : 'absent',
    ...(snapshot.freshness.reason ? { reason: snapshot.freshness.reason } : {}),
    ...(snapshot.freshness.nextAction ? { nextAction: snapshot.freshness.nextAction } : {}),
  };
}

function unavailableIndex(freshness: string, reason?: string): ProjectIndexState {
  return {
    available: false,
    freshness,
    coverageGaps: 0,
    externalEngine: 'absent',
    ...(reason ? { reason } : {}),
    nextAction: 'build_source_graph',
  };
}

function envelope<T extends ProjectRelationResult>(
  kind: ProjectRelationKind,
  project: { projectRoot: string; repoId?: string },
  index: ProjectIndexState,
  data: T,
  errors: ProjectContextQueryError[] = []
): ProjectRelationEnvelope<T> {
  return {
    contractVersion: 1,
    project,
    kind,
    data,
    index,
    refs: data.nextRefs,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function failure(
  kind: ProjectRelationKind,
  project: { projectRoot: string; repoId?: string },
  index: ProjectIndexState,
  error: ProjectContextQueryError
): ProjectRelationEnvelope {
  return envelope(
    kind,
    project,
    index,
    { kind, available: false, reason: error.message, nextRefs: [] },
    [error]
  );
}

function targetRequired(kind: ProjectRelationKind, what: string): ProjectContextQueryError {
  return {
    code: 'invalid-scope',
    message: `relation query ${kind} needs ${what} as its target.`,
    retryable: false,
    severity: 'error',
  };
}

function nextRefs(refs: readonly (ProjectContextRef | undefined)[]): ProjectContextRef[] {
  return dedupeProjectContextRefs(refs).slice(0, MAX_NEXT_REFS);
}

function normalizeFilePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replaceAll('\\', '/').replace(/^\.\//, '');
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

function compareByPosition(left: SymbolSummary, right: SymbolSummary): number {
  return (
    (left.range?.startLine ?? 0) - (right.range?.startLine ?? 0) ||
    (left.range?.endLine ?? 0) - (right.range?.endLine ?? 0) ||
    left.name.localeCompare(right.name)
  );
}

import type { ExtractedFileFlowCallSite, ExtractedFileSymbol } from '../../core/facts/contracts.js';
import { JS_FAMILY_LANGUAGES } from '../../core/facts/parserLanguage.js';
import {
  findCalleeSymbol,
  findCallerSymbol,
  findEnclosingDeclaration,
  hasImplicitMemberCalls,
  type ImportBindingStrategy,
  isCallSiteOwner,
  linkHeritage,
  linkImportBoundCallSites,
  MODULE_SOURCE_EXTENSIONS,
  type ModuleGraphAccess,
  type ModuleResolution,
  type ModuleResolutionAccess,
  resolveModuleSpecifier,
} from '../../core/linking/index.js';
import type { SourceGraphEdgeInput, SourceSymbolNode } from '../../domain/source-graph/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { FileLinkFacts } from './SourceGraphFileAnalyzer.js';

/** 链接一个文件时能看到的本代其余部分。 */
export interface SourceGraphLinkContext {
  generationId: string;
  /** 任意文件的链接事实。未完整解析的文件返回 undefined，它不能作为链接目标。 */
  factsOf(filePath: string): Promise<FileLinkFacts | undefined>;
  /** 说明符解析的读取通道：目标与配置都只认本代清单里的文件，整代共用一份缓存。 */
  modules: ModuleResolutionAccess;
}

export interface LinkedFile {
  edges: SourceGraphEdgeInput[];
  /** 未解析的调用点不入库，只留计数：total 是提取到的调用点，linked 是连到声明的。 */
  callSites: { total: number; linked: number };
}

/**
 * 边的解析记录。tier 是对外呈现时的分级：
 * certain = 自有链接器给出，每一步都有语法或配置为证；
 * trusted = 高把握但不是证明：外部引擎的高准确率解析，或自有链接器经"构建产物目录对应 src"的
 * 惯例找到的包入口；candidate 只属于外部引擎的低把握解析，默认不出现在查询结果里。
 */
export interface EdgeResolution {
  linker: 'lexical' | 'import-binding' | 'module-import' | 'heritage';
  strategy: string;
  tier: 'certain' | 'trusted' | 'candidate';
}

/** 经目录惯例解析的模块上的边：自有链接器给出，但中间有一步没有配置为证。 */
const CONVENTIONAL_CONFIDENCE = 0.9;

function proofOf(conventional: boolean | undefined): {
  provenance: 'deterministic' | 'heuristic';
  confidence: number;
  tier: EdgeResolution['tier'];
} {
  return conventional
    ? { provenance: 'heuristic', confidence: CONVENTIONAL_CONFIDENCE, tier: 'trusted' }
    : { provenance: 'deterministic', confidence: 1, tier: 'certain' };
}

/** 链接器看其他模块的通道，另带完整的解析记录（文件级依赖边要写明说明符是怎么落到文件的）。 */
interface ModuleLinkAccess extends ModuleGraphAccess {
  resolution(importerFile: string, specifier: string): Promise<ModuleResolution>;
}

/** 一个文件的全部出边：文件级依赖、类型层级、调用。 */
export async function linkFile(
  facts: FileLinkFacts,
  context: SourceGraphLinkContext
): Promise<LinkedFile> {
  const jsFamily = JS_FAMILY_LANGUAGES.has(facts.parserLanguage);
  // 只有 JS 家族的模块说明符能按相对路径落到文件；其他语言的跨文件关系不在这里解析。
  const access = jsFamily ? moduleAccess(context) : undefined;
  const edges = access ? await linkModuleDependencies(facts, context, access) : [];
  const heritage = access ? await linkTypeHierarchy(facts, context, access) : [];
  const calls = await linkCalls(facts, context, access);
  return { edges: [...edges, ...heritage, ...calls.edges], callSites: calls.callSites };
}

/**
 * 链接器看其他模块的通道：目标文件只能是本代清单里的文件，声明来自目标自己的事实。
 * 说明符怎么落到文件由链接层唯一的解析规则决定（相对路径、路径别名、项目内的包）。
 */
function moduleAccess(context: SourceGraphLinkContext): ModuleLinkAccess {
  const resolution = (importerFile: string, specifier: string) =>
    resolveModuleSpecifier(context.modules, importerFile, specifier, {
      extensions: MODULE_SOURCE_EXTENSIONS,
      // 索引收下按目录惯例换回源码的包入口，并把经它得到的边标为可信档。
      conventions: true,
    });
  return {
    resolution,
    async resolveModule(importerFile, specifier) {
      const resolved = await resolution(importerFile, specifier);
      return resolved.status === 'found'
        ? {
            filePath: resolved.filePath,
            ...(resolved.conventional ? { conventional: true } : {}),
          }
        : undefined;
    },
    async declarations(filePath) {
      const target = await context.factsOf(filePath);
      return target
        ? {
            symbols: target.declarations.map((declaration) => declaration.symbol),
            exports: target.exports,
            defaultExportNames: target.defaultExportNames,
          }
        : undefined;
    },
  };
}

/** 声明对象 → 它在索引里的节点；目标可能在别的文件里。 */
async function nodeFor(
  context: SourceGraphLinkContext,
  filePath: string,
  symbol: ExtractedFileSymbol
): Promise<SourceSymbolNode | undefined> {
  return (await context.factsOf(filePath))?.declarations.find(
    (declaration) => declaration.symbol === symbol
  )?.node;
}

/** JS/TS 的 extends / implements：父类型名字经同文件声明或 import 绑定连到声明。 */
async function linkTypeHierarchy(
  facts: FileLinkFacts,
  context: SourceGraphLinkContext,
  access: ModuleLinkAccess
): Promise<SourceGraphEdgeInput[]> {
  const symbols = facts.declarations.map((declaration) => declaration.symbol);
  if (!symbols.some((symbol) => symbol.heritage)) {
    return [];
  }
  const edges = new Map<string, SourceGraphEdgeInput>();
  for (const target of await linkHeritage({
    filePath: facts.filePath,
    symbols,
    imports: facts.imports,
    access,
  })) {
    const from = facts.declarations.find((declaration) => declaration.symbol === target.from)?.node;
    const to = await nodeFor(context, target.filePath, target.symbol);
    if (!from || !to) {
      continue;
    }
    const edgeId = `${facts.filePath}:${target.relation}:${from.symbolId}->${to.symbolId}`;
    const proof = proofOf(target.conventional);
    edges.set(edgeId, {
      generationId: context.generationId,
      edgeId,
      kind: target.relation,
      fromSymbolId: from.symbolId,
      toSymbolId: to.symbolId,
      fromFilePath: facts.filePath,
      toFilePath: to.filePath,
      siteFilePath: facts.filePath,
      // 父类型写在声明头部；位置取声明的起始行。
      site: {
        startLine: from.range.startLine,
        startColumn: from.range.startColumn,
        endLine: from.range.startLine,
        endColumn: from.range.startColumn,
      },
      provenance: proof.provenance,
      confidence: proof.confidence,
      source: target.name,
      metadata: {
        resolution: {
          linker: 'heritage',
          strategy: strategyLabel(target.strategy, target),
          tier: proof.tier,
        } satisfies EdgeResolution,
      },
    });
  }
  return [...edges.values()];
}

/** 边的策略标签：基础策略后面依次注明经过了 re-export、目标模块是按目录惯例找到的。 */
function strategyLabel(
  strategy: string,
  target: { viaReexport: boolean; conventional?: boolean }
): string {
  return `${strategy}${target.viaReexport ? '+re-export' : ''}${
    target.conventional ? '+source-convention' : ''
  }`;
}

const DEPENDENCY_STRATEGIES = {
  relative: 'relative-specifier',
  'path-alias': 'path-alias',
  'package-entry': 'package-entry',
  'package-import': 'package-import',
} as const;

/** JS/TS 的导入与 re-export：每个（来源文件 → 目标文件）一条文件级依赖边。 */
async function linkModuleDependencies(
  facts: FileLinkFacts,
  context: SourceGraphLinkContext,
  access: ModuleLinkAccess
): Promise<SourceGraphEdgeInput[]> {
  const dependencies = [
    ...facts.imports.map((item) => ({
      specifier: item.specifier,
      range: item.range,
      reexport: false,
    })),
    ...facts.exports.flatMap((item) =>
      item.specifier ? [{ specifier: item.specifier, range: item.range, reexport: true }] : []
    ),
  ];
  const byTarget = new Map<string, SourceGraphEdgeInput>();
  let unlinked = 0;
  for (const dependency of dependencies) {
    const resolved = await access.resolution(facts.filePath, dependency.specifier);
    if (resolved.status !== 'found') {
      unlinked += 1;
      continue;
    }
    const target = resolved.filePath;
    const proof = proofOf(resolved.conventional);
    const existing = byTarget.get(target);
    if (existing) {
      // 多条绑定指向同一个文件仍是一个文件依赖；只补记"这里还有 re-export"。
      // 增量构建靠它判断目标变化是否要继续传给本文件的导入方。
      if (dependency.reexport) {
        existing.metadata = { ...existing.metadata, reexport: true };
      }
      continue;
    }
    byTarget.set(target, {
      generationId: context.generationId,
      edgeId: `${facts.filePath}:imports:${target}`,
      kind: 'imports',
      fromSymbolId: facts.moduleSymbolId,
      fromFilePath: facts.filePath,
      toFilePath: target,
      siteFilePath: facts.filePath,
      site: {
        startLine: dependency.range.startLine,
        startColumn: dependency.range.startColumn ?? 0,
        endLine: dependency.range.endLine,
        endColumn: dependency.range.endColumn ?? 0,
      },
      provenance: proof.provenance,
      confidence: proof.confidence,
      source: dependency.specifier,
      metadata: {
        dependencyKind: dependency.reexport ? 're-export' : 'import',
        ...(dependency.reexport ? { reexport: true } : {}),
        resolution: {
          linker: 'module-import',
          strategy: resolved.conventional
            ? 'package-source-convention'
            : DEPENDENCY_STRATEGIES[resolved.via],
          tier: proof.tier,
        } satisfies EdgeResolution,
      },
    });
  }
  Logger.debug('Source graph linked module dependencies', {
    filePath: facts.filePath,
    declarations: dependencies.length,
    edges: byTarget.size,
    outsideInventoryOrPackage: unlinked,
  });
  return [...byTarget.values()];
}

async function linkCalls(
  facts: FileLinkFacts,
  context: SourceGraphLinkContext,
  access: ModuleLinkAccess | undefined
): Promise<LinkedFile> {
  const callSites = facts.callSites ?? [];
  if (callSites.length === 0) {
    return { edges: [], callSites: { total: 0, linked: 0 } };
  }
  const symbols = facts.declarations.map((declaration) => declaration.symbol);
  const nodeOf = new Map(
    facts.declarations.map((declaration) => [declaration.symbol, declaration])
  );

  // 跨文件：调用点的词法绑定是一条 import。目标声明来自目标文件自己的事实。
  const imported = new Map<
    number,
    {
      node: SourceSymbolNode;
      strategy: ImportBindingStrategy;
      viaReexport: boolean;
      conventional?: boolean;
    }
  >();
  if (access) {
    for (const target of await linkImportBoundCallSites({
      filePath: facts.filePath,
      imports: facts.imports,
      callSites,
      access,
    })) {
      const node = await nodeFor(context, target.filePath, target.symbol);
      if (node) {
        imported.set(target.index, {
          node,
          strategy: target.strategy,
          viaReexport: target.viaReexport,
          conventional: target.conventional,
        });
      }
    }
  }

  const implicitMembers = hasImplicitMemberCalls(facts.parserLanguage);
  const edges = new Map<string, SourceGraphEdgeInput>();
  const attributions = { declaration: 0, enclosing: 0, module: 0 };
  let linked = 0;
  for (const [index, site] of callSites.entries()) {
    const crossFile = imported.get(index);
    const target = crossFile?.node ?? sameFileTarget(symbols, nodeOf, site, implicitMembers);
    if (!target) {
      continue;
    }
    linked += 1;
    const caller = callerOf(symbols, site);
    attributions[caller.attribution] += 1;
    const from = caller.symbol ? nodeOf.get(caller.symbol)?.node : undefined;
    const range = site.matchingRange ?? site.range;
    // 同一位置连到同一目标只有一条边；只有行号的语言里，同行的重复调用因此合并。
    const edgeId = `${facts.filePath}:calls:${range.startLine}:${range.startColumn ?? 0}:${target.symbolId}`;
    const proof = proofOf(crossFile?.conventional);
    edges.set(edgeId, {
      generationId: context.generationId,
      edgeId,
      kind: 'calls',
      fromSymbolId: from?.symbolId ?? facts.moduleSymbolId,
      toSymbolId: target.symbolId,
      fromFilePath: facts.filePath,
      toFilePath: target.filePath,
      siteFilePath: facts.filePath,
      site: {
        startLine: range.startLine,
        startColumn: range.startColumn ?? 0,
        endLine: range.endLine,
        endColumn: range.endColumn ?? 0,
      },
      provenance: proof.provenance,
      confidence: proof.confidence,
      source: site.calleeExpression ?? site.callee,
      metadata: {
        resolution: (crossFile
          ? {
              linker: 'import-binding',
              strategy: strategyLabel(crossFile.strategy, crossFile),
              tier: proof.tier,
            }
          : {
              linker: 'lexical',
              strategy: 'same-file-declaration',
              tier: 'certain',
            }) satisfies EdgeResolution,
        // new 与 jsx 的目标是类型或组件本身，即"谁创建了它"；没有语法种类的语言按目标是否为类型判断。
        callKind: site.syntaxKind ?? (TYPE_KINDS.has(target.kind) ? 'new' : 'call'),
        callerAttribution: caller.attribution,
      },
    });
  }
  Logger.debug('Source graph linked call sites', {
    filePath: facts.filePath,
    callSites: callSites.length,
    linked,
    crossFile: imported.size,
    // enclosing / module 不是降级：调用点的直接拥有者不是符号时，归到包住它的声明或文件本身。
    callerAttribution: attributions,
  });
  return { edges: [...edges.values()], callSites: { total: callSites.length, linked } };
}

const TYPE_KINDS: ReadonlySet<string> = new Set(['class', 'struct', 'enum']);

function sameFileTarget(
  symbols: readonly ExtractedFileSymbol[],
  nodeOf: ReadonlyMap<ExtractedFileSymbol, { node: SourceSymbolNode }>,
  site: ExtractedFileFlowCallSite,
  implicitMembers: boolean
): SourceSymbolNode | undefined {
  const symbol = findCalleeSymbol(symbols, site, implicitMembers).symbol;
  return symbol ? nodeOf.get(symbol)?.node : undefined;
}

/**
 * 调用方归属。declaration：调用点的直接拥有者就是这个符号；enclosing：拥有者是匿名回调、
 * 嵌套函数或初始化表达式，归到包住它的最内层声明；module：没有任何声明包住它，属于文件顶层代码。
 */
function callerOf(
  symbols: readonly ExtractedFileSymbol[],
  site: ExtractedFileFlowCallSite
): { symbol?: ExtractedFileSymbol; attribution: 'declaration' | 'enclosing' | 'module' } {
  if (site.matchingRange?.startColumn !== undefined) {
    // 有精确位置的语言：由声明范围直接给出最内层声明，不经名字比对。
    const enclosing = findEnclosingDeclaration(symbols, site);
    return enclosing
      ? {
          symbol: enclosing,
          attribution: isCallSiteOwner(enclosing, site) ? 'declaration' : 'enclosing',
        }
      : { attribution: 'module' };
  }
  const named = findCallerSymbol(symbols, site);
  if (named.symbol) {
    return { symbol: named.symbol, attribution: 'declaration' };
  }
  if (named.fileCaller) {
    return { attribution: 'module' };
  }
  // 只有行号的语言插件：拥有者同名（重载）或没有成为符号（闭包）时，按行包含取最内层声明。
  const enclosing = findEnclosingDeclaration(symbols, site);
  return enclosing ? { symbol: enclosing, attribution: 'enclosing' } : { attribution: 'module' };
}

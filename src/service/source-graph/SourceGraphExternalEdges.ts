import type {
  SourceGraphEdgeInput,
  SourceRange,
  SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import type {
  CodeGraphNativeEdge,
  CodeGraphNativeResult,
} from '../../infrastructure/analysis/CodeGraphNativeIndex.js';
import { moduleSymbolId } from './SourceGraphSymbols.js';

/** 分级与对齐规则的版本；规则变化时提高它，使已有代际重建。 */
export const EXTERNAL_EDGE_RULES_VERSION = 'codegraph-edges-v1';

/** 外部边只用于核对过准确率的语言；其余语言 CodeGraph 即使给了结果也不采用。 */
const EVALUATED_LANGUAGES: ReadonlySet<string> = new Set([
  'swift',
  'objc',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
]);
const JS_FAMILY: ReadonlySet<string> = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

/** 自有符号里算类型声明的种类。 */
const OWN_TYPE_KINDS: ReadonlySet<string> = new Set([
  'class',
  'struct',
  'enum',
  'interface',
  'type',
]);

export type ExternalEdgeTier = 'trusted' | 'candidate';

export interface ExternalEdgeSummary {
  /** CodeGraph 交回的边数（已限定种类）。 */
  received: number;
  trusted: number;
  candidate: number;
  /** 没有采用的边，按原因计数。 */
  dropped: Record<string, number>;
}

export interface ExternalEdgeImport {
  edges: SourceGraphEdgeInput[];
  summary: ExternalEdgeSummary;
}

interface FileSymbols {
  byStartLine: Map<number, SourceSymbolNode[]>;
  declared: SourceSymbolNode[];
}

interface Tiering {
  tier: ExternalEdgeTier;
  /** CodeGraph 的策略名，后面可带本模块补上的证据（`+same-type-member` 等）。 */
  strategy: string;
}

/**
 * 把 CodeGraph 的边变成索引的边。
 *
 * CodeGraph 只贡献"这个位置连到那个声明"。两端的身份都换成自有符号：调用方取包住引用位置的
 * 最内层自有声明，目标按"文件 + 起始行 + 名字"对齐。自有链接器已经连上的位置不再采用外部结果。
 *
 * 分级依据是按策略分层抽样、逐条对照源码的结果，加上两端自有符号能给出的结构性证据：
 *
 * - 可信：导入、限定名、文件路径；已知类型的成员访问（置信度 ≥ 0.8）；`Type.member` 形式且
 *   接收者就是目标所属类型；不带接收者的调用连到自由函数，或连到调用方自己所属类型的成员
 *   （Swift 的隐式 self，含类型主体与 extension 分在两个文件）；ObjC 带参数的选择器全项目唯一。
 * - 可信的类型引用（实例化、继承、协议）：两端都必须是项目里真实的类型声明。CodeGraph 把
 *   `extension T` 也当成类型节点，T 在项目里有唯一声明时改指向那个声明，没有时不采用。
 * - 候选：其余全部——按短名字撞上的方法、低置信度的成员访问、合成的协议分发边、
 *   目标对不上自有符号的边。候选边入库，但默认不出现在任何查询结果里。
 *
 * JS/TS 另有两条限制：相对说明符的导入归自有链接器，外部结果只用于路径别名与包名；
 * 候选档不入库——自有链接器在这两种语言里有完整的词法与导入证据，剩下的只是按名字的猜测。
 */
export function importExternalEdges(input: {
  generationId: string;
  result: CodeGraphNativeResult;
  /** 本代全部符号（沿用的与新分析的）。 */
  symbols: readonly SourceSymbolNode[];
  /** 本代文件的内容哈希；CodeGraph 读到的内容不同的文件，涉及它的边全部不采用。 */
  contentHashes: ReadonlyMap<string, string>;
  /** 自有链接器已写出的边。 */
  ownEdges: readonly SourceGraphEdgeInput[];
}): ExternalEdgeImport {
  const summary: ExternalEdgeSummary = {
    received: input.result.edges.length,
    trusted: 0,
    candidate: 0,
    dropped: {},
  };
  const drop = (reason: string) => {
    summary.dropped[reason] = (summary.dropped[reason] ?? 0) + 1;
  };

  const stale = new Set(
    input.result.files
      .filter((file) => input.contentHashes.get(file.path) !== file.contentHash)
      .map((file) => file.path)
  );
  const analyzed = new Set(input.result.files.map((file) => file.path));
  const files = new Map<string, FileSymbols>();
  // 项目里的类型声明按名字登记：extension 节点要靠它找回被扩展的类型。
  const typesByName = new Map<string, SourceSymbolNode[]>();
  for (const symbol of input.symbols) {
    if (symbol.kind === 'module') {
      continue;
    }
    let entry = files.get(symbol.filePath);
    if (!entry) {
      entry = { byStartLine: new Map(), declared: [] };
      files.set(symbol.filePath, entry);
    }
    entry.declared.push(symbol);
    const line = entry.byStartLine.get(symbol.range.startLine) ?? [];
    line.push(symbol);
    entry.byStartLine.set(symbol.range.startLine, line);
    if (OWN_TYPE_KINDS.has(symbol.kind)) {
      const list = typesByName.get(symbol.displayName) ?? [];
      list.push(symbol);
      typesByName.set(symbol.displayName, list);
    }
  }
  const uniqueType = (name: string): SourceSymbolNode | undefined => {
    const declared = typesByName.get(name);
    return declared?.length === 1 ? declared[0] : undefined;
  };
  // 自有边按"文件:行"登记目标与被调名字，用来识别外部边是否只是重复或冲突。
  const ownSites = new Map<string, { targets: Set<string>; callees: Set<string> }>();
  const ownRelations = new Set<string>();
  const ownDependencies = new Set<string>();
  for (const edge of input.ownEdges) {
    if (edge.kind === 'imports') {
      ownDependencies.add(`${edge.fromFilePath}->${edge.toFilePath}`);
      continue;
    }
    if (edge.kind !== 'calls') {
      ownRelations.add(`${edge.kind}:${edge.fromSymbolId}->${edge.toSymbolId}`);
    }
    if (!edge.siteFilePath || !edge.site) {
      continue;
    }
    const key = `${edge.siteFilePath}:${edge.site.startLine}`;
    const site = ownSites.get(key) ?? { targets: new Set(), callees: new Set() };
    if (edge.toSymbolId) {
      site.targets.add(edge.toSymbolId);
    }
    if (edge.source) {
      site.callees.add(lastSegment(edge.source));
    }
    ownSites.set(key, site);
  }

  const jsImports = collectJsImports(input.result);

  const edges = new Map<string, SourceGraphEdgeInput>();
  const accept = (edge: SourceGraphEdgeInput, tier: ExternalEdgeTier) => {
    edges.set(edge.edgeId, edge);
    summary[tier] += 1;
  };
  for (const edge of input.result.edges) {
    if (!EVALUATED_LANGUAGES.has(edge.language)) {
      drop('language-not-evaluated');
      continue;
    }
    if (!analyzed.has(edge.to.filePath) || edge.to.kind === 'import') {
      // 目标不是项目里的声明（框架、系统头文件的占位节点）。
      drop('target-outside-project');
      continue;
    }
    if (stale.has(edge.from.filePath) || stale.has(edge.to.filePath)) {
      drop('content-changed-since-indexing');
      continue;
    }
    const line = edge.line ?? edge.from.startLine;
    const site = siteOf(line, edge.column);
    // JS/TS 的相对导入归自有链接器：它要么已经连上，要么有理由不连（歧义、类型导入、
    // 找不到唯一声明）。外部结果只用于它管不了的说明符——路径别名与包名。
    const importedFrom = JS_FAMILY.has(edge.language)
      ? edge.kind === 'imports'
        ? jsImports.specifierAt(edge.from.filePath, line)
        : jsImports.specifierOf(edge.from.filePath, edge.referenceName)
      : undefined;
    if (importedFrom?.startsWith('.')) {
      drop('relative-import-owned-by-own-linker');
      continue;
    }
    if (
      JS_FAMILY.has(edge.language) &&
      edge.resolvedBy === 'import' &&
      importedFrom === undefined
    ) {
      // 找不到这个名字是从哪条 import 语句来的，无法确认它不是相对导入
      // （default 导入就是这样；CodeGraph 会把目标文件的第一个导出当成 default）。
      drop('unconfirmed-import-binding');
      continue;
    }

    if (edge.kind === 'imports') {
      // 文件级依赖（ObjC 的 `#import "X.h"`、别名与包内导入）：自有链接器没有这条依赖时才补。
      const fromFile = edge.from.filePath;
      const toFile = edge.to.filePath;
      if (fromFile === toFile || ownDependencies.has(`${fromFile}->${toFile}`)) {
        drop('duplicate-of-own-edge');
        continue;
      }
      const tiering = strategyTier(edge);
      if (tiering.tier !== 'trusted') {
        // 文件依赖只收有把握的；按名字撞上的目标不当作依赖。
        drop('unconfirmed-file-dependency');
        continue;
      }
      accept(
        {
          generationId: input.generationId,
          edgeId: `${fromFile}:imports:${toFile}`,
          kind: 'imports',
          fromSymbolId: moduleSymbolId(fromFile),
          fromFilePath: fromFile,
          toFilePath: toFile,
          siteFilePath: fromFile,
          site,
          provenance: 'heuristic',
          confidence: clampConfidence(edge.confidence),
          source: edge.referenceName ?? edge.to.name,
          metadata: {
            dependencyKind: 'import',
            resolution: { linker: 'codegraph', ...tiering },
          },
        },
        tiering.tier
      );
      continue;
    }

    const aligned = findTarget(files.get(edge.to.filePath), edge);
    if (edge.kind === 'extends' || edge.kind === 'implements') {
      // 层级边的两端都必须是项目里真实的类型声明。
      const target =
        aligned && OWN_TYPE_KINDS.has(aligned.kind) ? aligned : uniqueType(edge.to.name);
      if (!target) {
        drop('type-target-is-not-a-declaration');
        continue;
      }
      const declaredHere = (
        files.get(edge.from.filePath)?.byStartLine.get(edge.from.startLine) ?? []
      ).filter(
        (symbol) => symbol.displayName === edge.from.name && OWN_TYPE_KINDS.has(symbol.kind)
      );
      // `extension Loader: Delegate` 写在别的文件里：主语是被扩展的那个类型。
      const subject = declaredHere.length === 1 ? declaredHere[0] : uniqueType(edge.from.name);
      if (!subject) {
        // `extension UITableViewCell: Reusable`：主语是框架类型，项目里没有它的声明。
        drop('subject-type-outside-project');
        continue;
      }
      if (
        subject === target ||
        ownRelations.has(`${edge.kind}:${subject.symbolId}->${target.symbolId}`)
      ) {
        drop('duplicate-of-own-edge');
        continue;
      }
      const tiering = JS_FAMILY.has(edge.language)
        ? strategyTier(edge)
        : typeReferenceTier(edge, target, target !== aligned, uniqueType);
      if (tiering.tier === 'candidate' && JS_FAMILY.has(edge.language)) {
        drop('unproven-js-reference');
        continue;
      }
      accept(
        {
          generationId: input.generationId,
          edgeId: `${edge.from.filePath}:${edge.kind}:${line}:codegraph:${subject.symbolId}->${target.symbolId}`,
          kind: edge.kind,
          fromSymbolId: subject.symbolId,
          toSymbolId: target.symbolId,
          fromFilePath: subject.filePath,
          toFilePath: target.filePath,
          siteFilePath: edge.from.filePath,
          site,
          provenance: 'heuristic',
          confidence: clampConfidence(edge.confidence),
          source: edge.referenceName ?? edge.to.name,
          metadata: { resolution: { linker: 'codegraph', ...tiering } },
        },
        tiering.tier
      );
      continue;
    }

    if (edge.selfEdge && edge.kind === 'calls') {
      // `super.viewDidLoad()`、`[super init]` 和重载之间的调用都被解析成方法自身；
      // 真正的自递归极少，宁可不要。类型在自己的属性初始值里创建实例（单例）不在此列。
      drop('call-resolved-to-its-own-caller');
      continue;
    }
    let target = aligned;
    let retargeted = false;
    if (edge.kind === 'instantiates' && (!target || !OWN_TYPE_KINDS.has(target.kind))) {
      target = uniqueType(edge.to.name);
      if (!target) {
        // `Logger(...)` 连到项目里的 `extension Logger`，或别的文件里的局部类型。
        drop('type-target-is-not-a-declaration');
        continue;
      }
      retargeted = true;
    }
    if (!target && edge.from.filePath === edge.to.filePath) {
      // 目标在本文件里却对不上任何声明：没有可用的信息。
      drop('unaligned-same-file-target');
      continue;
    }
    const ownSite = ownSites.get(`${edge.from.filePath}:${line}`);
    if (ownSite && target && ownSite.targets.has(target.symbolId)) {
      drop('duplicate-of-own-edge');
      continue;
    }
    if (ownSite && edge.referenceName && ownSite.callees.has(lastSegment(edge.referenceName))) {
      // 同一位置自有链接器给了别的目标：以有语法证明的自有结果为准。
      drop('conflicts-with-own-edge');
      continue;
    }
    const caller = innermostDeclaration(files.get(edge.from.filePath), line);
    const tiering = !target
      ? // 目标声明对不上自有符号：只留文件级的候选边，供人工核对。
        { tier: 'candidate' as const, strategy: `${edge.resolvedBy ?? 'synthesized'}+unaligned` }
      : JS_FAMILY.has(edge.language)
        ? callTier(edge, caller, target)
        : edge.kind === 'instantiates' || OWN_TYPE_KINDS.has(target.kind)
          ? typeReferenceTier(edge, target, retargeted, uniqueType)
          : callTier(edge, caller, target);
    if (tiering.tier === 'candidate' && JS_FAMILY.has(edge.language)) {
      // JS/TS 有完整的词法与导入证据，能证明的都已由自有链接器连上；
      // CodeGraph 在这里剩下的只是按名字的猜测，抽样核对基本是错的，不入库。
      drop('unproven-js-reference');
      continue;
    }
    const targetId = target?.symbolId ?? `${edge.to.filePath}#${edge.to.name}`;
    accept(
      {
        generationId: input.generationId,
        edgeId: `${edge.from.filePath}:calls:${line}:${edge.column ?? 0}:codegraph:${targetId}`,
        kind: 'calls',
        fromSymbolId: caller?.symbolId ?? moduleSymbolId(edge.from.filePath),
        ...(target ? { toSymbolId: target.symbolId } : {}),
        fromFilePath: edge.from.filePath,
        toFilePath: target?.filePath ?? edge.to.filePath,
        siteFilePath: edge.from.filePath,
        site,
        provenance: 'heuristic',
        confidence: clampConfidence(edge.confidence),
        source: edge.referenceName ?? edge.to.name,
        metadata: {
          resolution: { linker: 'codegraph', ...tiering },
          callKind: target && OWN_TYPE_KINDS.has(target.kind) ? 'new' : 'call',
          callerAttribution: caller ? 'enclosing' : 'module',
          // 目标没对上自有符号时保留 CodeGraph 的写法。
          ...(target ? {} : { externalTarget: `${edge.to.qualifiedName}@${edge.to.startLine}` }),
        },
      },
      tiering.tier
    );
  }
  return { edges: [...edges.values()], summary };
}

/**
 * JS/TS 的 import 语句与绑定。CodeGraph 为每条 import 语句建一个节点（名字是说明符、范围是
 * 整条语句），又为每个导入的名字建一条指向目标声明的边；两者按行对上，就知道某个名字是从
 * 哪个说明符导入的。
 */
function collectJsImports(result: CodeGraphNativeResult): {
  specifierAt(filePath: string, line: number): string | undefined;
  specifierOf(filePath: string, reference: string | undefined): string | undefined;
} {
  const statements = new Map<string, CodeGraphNativeResult['importStatements']>();
  for (const statement of result.importStatements) {
    if (JS_FAMILY.has(statement.language)) {
      const list = statements.get(statement.filePath) ?? [];
      list.push(statement);
      statements.set(statement.filePath, list);
    }
  }
  const specifierAt = (filePath: string, line: number) =>
    statements
      .get(filePath)
      ?.find((statement) => statement.startLine <= line && line <= statement.endLine)?.specifier;
  const names = new Map<string, Map<string, string>>();
  for (const edge of result.edges) {
    if (
      edge.kind !== 'imports' ||
      edge.to.kind === 'import' ||
      !JS_FAMILY.has(edge.language) ||
      !edge.referenceName ||
      edge.line === undefined
    ) {
      continue;
    }
    const specifier = specifierAt(edge.from.filePath, edge.line);
    if (specifier !== undefined) {
      const file = names.get(edge.from.filePath) ?? new Map<string, string>();
      file.set(edge.referenceName, specifier);
      names.set(edge.from.filePath, file);
    }
  }
  return {
    specifierAt,
    // 引用的第一段是导入的名字时，返回它的说明符：`helper()`、`Type.member()`、`ns.fn()`。
    specifierOf: (filePath, reference) =>
      reference === undefined ? undefined : names.get(filePath)?.get(reference.split('.')[0]),
  };
}

/** 只凭 CodeGraph 的策略标签就能定级的情形；其余由调用方结合两端符号判断。 */
function strategyTier(edge: CodeGraphNativeEdge): Tiering {
  const strategy = edge.resolvedBy ?? 'synthesized';
  const trusted =
    strategy === 'import' ||
    strategy === 'qualified-name' ||
    strategy === 'file-path' ||
    (strategy === 'instance-method' && (edge.confidence ?? 0) >= 0.8);
  return { tier: trusted ? 'trusted' : 'candidate', strategy };
}

/** 类型引用（实例化、继承、协议）：目标已确认是项目里的类型声明。 */
function typeReferenceTier(
  edge: CodeGraphNativeEdge,
  target: SourceSymbolNode,
  retargeted: boolean,
  uniqueType: (name: string) => SourceSymbolNode | undefined
): Tiering {
  const base = strategyTier(edge);
  const strategy = `${base.strategy}${retargeted ? '+extended-type' : ''}`;
  const confidence = edge.confidence ?? 0;
  if (
    base.tier === 'trusted' ||
    (edge.resolvedBy === 'exact-match' && confidence >= 0.9) ||
    (edge.resolvedBy === 'framework' && confidence >= 0.7)
  ) {
    return { tier: 'trusted', strategy };
  }
  // 这个名字在项目里只有一个类型声明。CodeGraph 因为同名的 extension 节点降低了置信度，
  // 但它们指的是同一个类型。
  if (
    uniqueType(target.displayName) === target &&
    lastSegment(edge.referenceName ?? edge.to.name) === target.displayName
  ) {
    return { tier: 'trusted', strategy: `${strategy}+unique-type` };
  }
  return { tier: 'candidate', strategy };
}

/** 调用边：目标是函数或成员，且已对上自有符号。 */
function callTier(
  edge: CodeGraphNativeEdge,
  caller: SourceSymbolNode | undefined,
  target: SourceSymbolNode
): Tiering {
  const base = strategyTier(edge);
  if (base.tier === 'trusted') {
    return base;
  }
  const targetType = ownerType(target);
  const reference = edge.referenceName ?? '';
  const parts = reference.split('.');
  if (targetType && parts.length === 2 && /^[A-Z]/.test(parts[0]) && parts[0] === targetType) {
    // `Type.member`：接收者就是目标所属类型的名字。
    return { tier: 'trusted', strategy: `${base.strategy}+type-qualified` };
  }
  const confidence = edge.confidence ?? 0;
  if (!JS_FAMILY.has(edge.language) && edge.resolvedBy === 'exact-match' && parts.length === 1) {
    // 不带接收者的调用。JS/TS 的裸标识符要么已由自有链接器按词法绑定解析，要么是全局函数，不采信。
    if (!targetType && target.kind === 'function') {
      if (edge.from.filePath === edge.to.filePath || confidence >= 0.9) {
        return { tier: 'trusted', strategy: `${base.strategy}+free-function` };
      }
    } else if (targetType && callerType(caller) === targetType) {
      // 隐式 self：调用方与目标属于同一个类型，包括类型主体与 extension 分在两个文件的情形。
      return { tier: 'trusted', strategy: `${base.strategy}+same-type-member` };
    }
  }
  if (
    edge.language === 'objc' &&
    target.displayName.includes(':') &&
    ((edge.resolvedBy === 'exact-match' && confidence >= 0.9) ||
      (edge.resolvedBy === 'instance-method' && confidence >= 0.7))
  ) {
    // 带参数的选择器名字足够长，全项目唯一时可信；不带参数的短选择器不在此列。
    return { tier: 'trusted', strategy: `${base.strategy}+keyword-selector` };
  }
  return base;
}

/** 成员所属类型的名字：限定名去掉最后一段；顶层声明没有所属类型。 */
function ownerType(symbol: SourceSymbolNode): string | undefined {
  const qualified = symbol.qualifiedName ?? symbol.displayName;
  return qualified.endsWith(`.${symbol.displayName}`)
    ? qualified.slice(0, -(symbol.displayName.length + 1))
    : undefined;
}

/** 调用方所在的类型：调用方本身是类型（属性初始值写在类型体里）时就是它自己。 */
function callerType(caller: SourceSymbolNode | undefined): string | undefined {
  if (!caller) {
    return undefined;
  }
  return OWN_TYPE_KINDS.has(caller.kind) ? caller.qualifiedName : ownerType(caller);
}

/** 目标声明：同文件、同起始行、同名字的自有符号；名字写法不同时退到该行唯一的声明。 */
function findTarget(
  file: FileSymbols | undefined,
  edge: CodeGraphNativeEdge
): SourceSymbolNode | undefined {
  const candidates = file?.byStartLine.get(edge.to.startLine) ?? [];
  const qualified = edge.to.qualifiedName.replaceAll('::', '.');
  const named = candidates.filter(
    (symbol) => symbol.displayName === edge.to.name || symbol.qualifiedName === qualified
  );
  if (named.length === 1) {
    return named[0];
  }
  return named.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
}

/** 包住某一行的最内层自有声明。 */
function innermostDeclaration(
  file: FileSymbols | undefined,
  line: number
): SourceSymbolNode | undefined {
  let innermost: SourceSymbolNode | undefined;
  for (const symbol of file?.declared ?? []) {
    if (symbol.range.startLine > line || symbol.range.endLine < line) {
      continue;
    }
    if (
      !innermost ||
      symbol.range.startLine > innermost.range.startLine ||
      (symbol.range.startLine === innermost.range.startLine &&
        symbol.range.endLine < innermost.range.endLine)
    ) {
      innermost = symbol;
    }
  }
  return innermost;
}

function siteOf(line: number, column: number | undefined): SourceRange {
  return { startLine: line, startColumn: column ?? 0, endLine: line, endColumn: column ?? 0 };
}

function clampConfidence(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0.5 : Math.min(1, Math.max(0, value));
}

function lastSegment(expression: string): string {
  return expression.split('.').at(-1) ?? expression;
}

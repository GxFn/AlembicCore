import type { ExtractedFileFlowCallSite } from '../facts/contracts.js';

/** 词法链接需要的最小符号形状；文件事实里的符号与协议层的 SymbolSummary 都满足。 */
export interface LinkableSymbol {
  name: string;
  qualifiedName?: string;
  container?: string;
  /** 对外的行级范围；老插件只有这个。 */
  range?: LinkableRange;
  /** 真实声明节点的范围（含列）。有它时优先用它比对，行级范围对不上多行签名。 */
  declarationRange?: LinkableRange;
}

export interface LinkableRange {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * 成员调用可以省略接收者的语言：方法体里的裸调用先在本类型成员里找。
 * Python/Go/Rust 的成员调用必须写出接收者，裸调用指向模块级函数，不在此列。
 */
const IMPLICIT_MEMBER_LANGUAGES = new Set(['swift', 'kotlin', 'java', 'dart']);

export function hasImplicitMemberCalls(parserLanguage: string | undefined): boolean {
  return parserLanguage !== undefined && IMPLICIT_MEMBER_LANGUAGES.has(parserLanguage);
}

export interface SymbolResolution<T extends LinkableSymbol = LinkableSymbol> {
  /** 调用点属于文件顶层（模块代码），拥有者是文件本身而不是某个符号。 */
  fileCaller?: boolean;
  symbol?: T;
  /** 未解析原因；有值即表示这一端没有可证明的同文件符号。 */
  reason?: string;
}

function uniqueSymbol<T extends LinkableSymbol>(
  candidates: readonly T[],
  role: 'caller' | 'callee'
): SymbolResolution<T> {
  return candidates.length === 1
    ? { symbol: candidates[0] }
    : { reason: `${role}-${candidates.length > 1 ? 'ambiguous' : 'unresolved'}` };
}

/** 调用点的拥有者：由声明范围证明，不靠名字顺序猜。 */
export function findCallerSymbol<T extends LinkableSymbol>(
  symbols: readonly T[],
  callSite: ExtractedFileFlowCallSite
): SymbolResolution<T> {
  const qualifiedName =
    callSite.callerQualifiedName ??
    (callSite.callerClass
      ? `${callSite.callerClass}.${callSite.callerMethod}`
      : callSite.callerMethod);
  if (
    qualifiedName === '<module>' &&
    callSite.callerRange &&
    containsRange(callSite.callerRange, callSite.matchingRange ?? callSite.range)
  ) {
    // 真实program owner对应现有文件ref，不制造一个“module函数”或借SDK节点推断调用者。
    return { fileCaller: true };
  }
  const named = symbols.filter((symbol) => (symbol.qualifiedName ?? symbol.name) === qualifiedName);
  if (callSite.callerRange) {
    // 公共symbol可能为兼容保留旧短名/行级range，真实owner声明位置负责消歧。
    // 不能因为完整名未投影出来，就退回第一个同名函数。
    const candidates =
      named.length > 0 ? named : symbols.filter((symbol) => symbol.name === callSite.callerMethod);
    const owner = callSite.callerRange;
    if (!containsRange(owner, callSite.matchingRange ?? callSite.range)) {
      return { reason: 'caller-range-mismatch' };
    }
    return uniqueSymbol(
      candidates.filter((symbol) => matchesDeclarationRange(symbol, owner)),
      'caller'
    );
  }
  if (named.length === 1) {
    return { symbol: named[0] };
  }
  // 老语言插件没有owner范围时，仅完整声明范围能证明某个重复候选包含调用点。
  const candidates =
    named.length > 0 ? named : symbols.filter((symbol) => symbol.name === callSite.callerMethod);
  const containing = candidates.filter(
    (symbol) =>
      symbol.range && containsRange(symbol.range, callSite.matchingRange ?? callSite.range)
  );
  return uniqueSymbol(containing.length > 0 ? containing : named, 'caller');
}

/** 同文件内的被调符号。跨文件目标不在这里解析，由导入绑定与外部链接器给出。 */
export function findCalleeSymbol<T extends LinkableSymbol>(
  symbols: readonly T[],
  callSite: ExtractedFileFlowCallSite,
  implicitMembers = false
): SymbolResolution<T> {
  const receiver = callSite.receiver?.trim();
  if (callSite.calleeShadowed) {
    const candidates = symbols.filter(
      (symbol) => (symbol.qualifiedName ?? symbol.name) === callSite.callee
    );
    return {
      reason: receiver
        ? 'callee-receiver-shadowed'
        : candidates.length > 1
          ? 'callee-shadowed; callee-ambiguous'
          : 'callee-shadowed',
    };
  }
  const expression = callSite.calleeExpression ?? callSite.callee;
  const calleeName = callSite.callee.split('.').at(-1) ?? callSite.callee;
  if (receiver === 'this' && callSite.callerClass) {
    // 新AST区分普通nested function的动态this与arrow继承的词法this；callerClass
    // 只表示词法包含关系，不能单独证明接收者。旧插件没有syntax元数据时保留原分支。
    if (callSite.syntaxKind && callSite.receiverType !== callSite.callerClass) {
      return { reason: 'callee-receiver-unresolved' };
    }
    return uniqueSymbol(
      symbols.filter((symbol) => symbol.qualifiedName === `${callSite.callerClass}.${calleeName}`),
      'callee'
    );
  }
  if (receiver === 'self' && callSite.callerClass && !callSite.syntaxKind) {
    // Swift/Python/Rust 的显式 self：接收者就是当前类型，只在本文件声明的同类型成员里找。
    // 继承来的或写在其他文件扩展里的成员不在本文件符号内，保持未解析，由跨文件链接处理。
    return uniqueSymbol(
      symbols.filter((symbol) => symbol.qualifiedName === `${callSite.callerClass}.${calleeName}`),
      'callee'
    );
  }
  // 任意对象成员不是文件内同名函数。receiverType仅是旧启发式数据，不是绑定证明。
  if (receiver) {
    return { reason: 'callee-receiver-unresolved' };
  }
  const bindingRange = callSite.calleeBindingRange;
  const qualifiedName = callSite.calleeQualifiedName;
  if (bindingRange) {
    const candidates = symbols.filter(
      (symbol) =>
        ((symbol.qualifiedName ?? symbol.name) === qualifiedName || symbol.name === calleeName) &&
        matchesDeclarationRange(symbol, bindingRange)
    );
    return uniqueSymbol(candidates, 'callee');
  }
  if (qualifiedName) {
    return uniqueSymbol(
      symbols.filter((symbol) => (symbol.qualifiedName ?? symbol.name) === qualifiedName),
      'callee'
    );
  }
  // 括号只改变callee的源码表达式；真实AST已证明的identifier绑定优先于文本形态防线。
  if (expression.includes('.') || expression.includes('[') || expression.includes('(')) {
    return { reason: 'callee-receiver-unresolved' };
  }
  if (callSite.syntaxKind) {
    // 新AST已做词法查找但没有证明本地绑定；缺证据不能再用裸名补造一个目标。
    const candidates = symbols.filter(
      (symbol) => (symbol.qualifiedName ?? symbol.name) === calleeName
    );
    return { reason: candidates.length > 1 ? 'callee-ambiguous' : 'callee-unresolved' };
  }
  if (implicitMembers && callSite.callerClass) {
    // 隐式 self：成员优先于模块级同名函数。本类型在本文件里有唯一同名成员才采用；
    // 这些语言的插件没有词法绑定证据，同名局部闭包会被当成成员，属于已知的近似。
    const members = symbols.filter(
      (symbol) => symbol.qualifiedName === `${callSite.callerClass}.${calleeName}`
    );
    if (members.length === 1) {
      return { symbol: members[0] };
    }
    if (members.length > 1) {
      return { reason: 'callee-ambiguous' };
    }
  }
  // 旧生产方只保留唯一、顶层的同名声明；移除跨class的后缀匹配。
  return uniqueSymbol(
    symbols.filter(
      (symbol) => !symbol.container && (symbol.qualifiedName ?? symbol.name) === calleeName
    ),
    'callee'
  );
}

/**
 * 调用点所在的最内层声明。调用发生在匿名回调、嵌套函数、对象字面量方法或模块级初始化里时，
 * 它的直接拥有者不是任何符号；索引把这样的调用归到包住它的具名声明上，不让它在图里消失。
 * 没有任何声明包住调用点时返回 undefined，调用属于模块顶层。
 */
export function findEnclosingDeclaration<T extends LinkableSymbol>(
  symbols: readonly T[],
  callSite: ExtractedFileFlowCallSite
): T | undefined {
  const position = callSite.matchingRange ?? callSite.range;
  let innermost: T | undefined;
  let innermostRange: LinkableRange | undefined;
  for (const symbol of symbols) {
    const range = symbol.declarationRange ?? symbol.range;
    if (!range || !containsRange(range, position)) {
      continue;
    }
    // 声明范围来自同一棵树，互相只会嵌套；起点更晚（或起点相同而终点更早）的就是更内层。
    if (!innermostRange || startsAfter(range, innermostRange)) {
      innermost = symbol;
      innermostRange = range;
    }
  }
  return innermost;
}

/**
 * 符号是否就是调用点的直接拥有者（而不只是包住它的外层声明）。
 * 名字与范围都要对上：单行代码里匿名回调的范围也落在外层声明之内，只比范围会把它认成拥有者。
 */
export function isCallSiteOwner(
  symbol: LinkableSymbol,
  callSite: ExtractedFileFlowCallSite
): boolean {
  const owner =
    callSite.callerQualifiedName ??
    (callSite.callerClass
      ? `${callSite.callerClass}.${callSite.callerMethod}`
      : callSite.callerMethod);
  return (
    (symbol.qualifiedName ?? symbol.name) === owner &&
    callSite.callerRange !== undefined &&
    matchesDeclarationRange(symbol, callSite.callerRange)
  );
}

function startsAfter(candidate: LinkableRange, current: LinkableRange): boolean {
  if (candidate.startLine !== current.startLine) {
    return candidate.startLine > current.startLine;
  }
  const candidateColumn = candidate.startColumn ?? 0;
  const currentColumn = current.startColumn ?? 0;
  if (candidateColumn !== currentColumn) {
    return candidateColumn > currentColumn;
  }
  if (candidate.endLine !== current.endLine) {
    return candidate.endLine < current.endLine;
  }
  return (
    (candidate.endColumn ?? Number.MAX_SAFE_INTEGER) <
    (current.endColumn ?? Number.MAX_SAFE_INTEGER)
  );
}

function matchesDeclarationRange(symbol: LinkableSymbol, declaration: LinkableRange): boolean {
  const precise = symbol.declarationRange;
  if (precise && precise.endLine === declaration.endLine && containsRange(precise, declaration)) {
    // 符号的声明范围可能把 export 等前缀包在内，所以起点允许更早；终点必须一致，
    // 否则一个外层声明会把内层同名声明也认成自己。
    return true;
  }
  return matchesLineRange(symbol.range, declaration);
}

function matchesLineRange(symbol: LinkableRange | undefined, declaration: LinkableRange): boolean {
  if (!symbol || symbol.startLine !== declaration.startLine) {
    return false;
  }
  if (
    symbol.startColumn !== undefined &&
    declaration.startColumn !== undefined &&
    symbol.startColumn !== declaration.startColumn
  ) {
    return false;
  }
  // 旧symbol行级锚点可能仅覆盖声明首行；完整多行范围存在时必须吻合。
  return symbol.endLine === symbol.startLine || symbol.endLine === declaration.endLine;
}

function containsRange(outer: LinkableRange, inner: LinkableRange): boolean {
  return (
    outer.startLine <= inner.startLine &&
    outer.endLine >= inner.endLine &&
    !(
      outer.startLine === inner.startLine &&
      outer.startColumn !== undefined &&
      inner.startColumn !== undefined &&
      outer.startColumn > inner.startColumn
    ) &&
    !(
      outer.endLine === inner.endLine &&
      outer.endColumn !== undefined &&
      inner.endColumn !== undefined &&
      outer.endColumn < inner.endColumn
    )
  );
}

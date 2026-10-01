import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowExport,
  ExtractedFileFlowImport,
  FileFlowExtractionResult,
  FileFlowImportKind,
} from './contracts.js';
import { type FileAstFacts, type FileAstInput, readFileAst } from './fileAst.js';
import { JS_FAMILY_LANGUAGES, resolveAstParserLanguage } from './parserLanguage.js';

interface AstImportRecordLike {
  path?: unknown;
  symbols?: unknown;
  alias?: unknown;
  kind?: unknown;
  isTypeOnly?: unknown;
}

interface AstCallSiteLike {
  callee?: unknown;
  callerMethod?: unknown;
  callerClass?: unknown;
  callType?: unknown;
  receiver?: unknown;
  receiverType?: unknown;
  argCount?: unknown;
  line?: unknown;
  isAwait?: unknown;
  matchingRange?: unknown;
  callerRange?: unknown;
  callerQualifiedName?: unknown;
  calleeExpression?: unknown;
  receiverSyntax?: unknown;
  syntaxKind?: unknown;
  omissionReason?: unknown;
  calleeShadowed?: unknown;
  calleeQualifiedName?: unknown;
  calleeBindingRange?: unknown;
}

// 历史行正则曾被 80KB 压缩行钉死。JS import/export 已改为树内事实投影；
// 仍保留整文件形态预算，避免调用点分析处理压缩/生成物。非 JS 文本定位保留行长上限。
// 整文件预算保持保守：合法手写源码中可有 5-15KB 的 data-URI/base64 数据行，
// 不能因为一行长数据丢掉整个文件的真实 imports。20KB 单行和平均行长 400 仍沿用旧阈值。
const MAX_PARSE_LINE_LENGTH = 2_000;
const PATHOLOGICAL_SINGLE_LINE_LENGTH = 20_000;
const PATHOLOGICAL_AVG_LINE_LENGTH = 400;

/** 压缩/生成物形态判定:任一行极端超长,或平均行长离谱(minified bundle 的典型形态)。 */
function detectPathologicalSourceShape(
  text: string
): { pathological: true; reason: string } | { pathological: false } {
  let lineStart = 0;
  let lineCount = 0;
  let maxLineLength = 0;
  for (let index = 0; index <= text.length; index++) {
    if (index === text.length || text[index] === '\n' || text[index] === '\r') {
      const length = index - lineStart;
      if (length > maxLineLength) {
        maxLineLength = length;
      }
      lineCount += 1;
      if (maxLineLength > PATHOLOGICAL_SINGLE_LINE_LENGTH) {
        return {
          pathological: true,
          reason: `single line of ${maxLineLength}+ chars (minified/generated content)`,
        };
      }
      if (index < text.length && text[index] === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      lineStart = index + 1;
    }
  }
  const avg = lineCount > 0 ? text.length / lineCount : 0;
  if (avg > PATHOLOGICAL_AVG_LINE_LENGTH) {
    return {
      pathological: true,
      reason: `average line length ${Math.round(avg)} chars (minified/generated content)`,
    };
  }
  return { pathological: false };
}

/** 会话和独立调用共用同一防线：先语言，再形态，均发生在调用点 AST 读取之前。 */
export function getFileFlowUnavailableReason(input: FileAstInput): string | undefined {
  const parserLanguage = resolveParserLanguage(input.filePath, input.language);
  if (!parserLanguage) {
    return `file-flow parser is unavailable for language ${input.language ?? 'unknown'}.`;
  }

  // 防线①:压缩/生成物整体跳过(先于 AST——垃圾内容连 AST 成本也不值得付)。
  // 降级走既有 unavailableReason 通道,消费方(fileFlow handler/上游投影)已适配该形态。
  const shape = detectPathologicalSourceShape(input.text);
  if (shape.pathological) {
    return `file-flow line-parse skipped for ${input.filePath}: ${shape.reason}.`;
  }
  return undefined;
}

export function extractFileFlowFromSource(
  input: FileAstInput,
  ast?: FileAstFacts
): FileFlowExtractionResult {
  const unavailableReason = getFileFlowUnavailableReason(input);
  if (unavailableReason) {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason,
    };
  }

  const facts = ast ?? readFileAst(input, true);
  if (facts.status !== 'ready') {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason:
        facts.status === 'unsupported'
          ? `file-flow parser is unavailable for language ${input.language ?? 'unknown'}.`
          : facts.status === 'runtime-unavailable'
            ? 'file-flow parser runtime is unavailable.'
            : facts.status === 'empty'
              ? `file-flow parser returned no AST summary for ${facts.parserLanguage}.`
              : `file-flow parser failed for ${input.filePath}.`,
    };
  }

  try {
    const { parserLanguage, summary } = facts;
    const lines = input.text.split(/\r\n|\n|\r/);
    const evidence =
      facts.callSiteEvidence === undefined
        ? undefined
        : collectCallSites(facts.callSiteEvidence, input.lineCount, false);
    // 旧 summary 的调用点仍只有旧字段；完整观察包含明确过滤项和对应证据，不能反向污染摘要。
    const callFacts = {
      callSites:
        evidence && facts.callSitesComplete
          ? dedupeCallSites(evidence.filter((item) => !item.omissionReason))
          : collectCallSites(summary.callSites, input.lineCount),
      ...(evidence === undefined ? {} : { callSiteEvidence: evidence }),
      ...(facts.callSitesComplete === undefined
        ? {}
        : { callSitesComplete: facts.callSitesComplete }),
    };
    // JS 模块关系来自本次真实 AST 节点，不再从字符串/注释中二次猜测语法。
    // 非 JS 的既有 ImportRecord 投影保持不变，不能用 JS 模块语法替换其语义。
    if (JS_FAMILY_LANGUAGES.has(parserLanguage)) {
      if (!facts.moduleSyntax) {
        return {
          ...callFacts,
          imports: [],
          exports: [],
          unavailableReason: `file-flow module syntax facts are unavailable for ${input.filePath}.`,
        };
      }
      return {
        ...callFacts,
        exports: dedupeExports(
          facts.moduleSyntax.exports.map((item) => ({ ...item, range: { ...item.range } }))
        ),
        imports: dedupeImports(
          facts.moduleSyntax.imports.map((item) => ({
            ...item,
            range: { ...item.range },
            symbols: [...item.symbols],
          }))
        ),
      };
    }
    return {
      ...callFacts,
      exports: [],
      imports: collectAstImportsDirect(lines, summary.imports),
    };
  } catch {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason: `file-flow parser failed for ${input.filePath}.`,
    };
  }
}

/**
 * 非 JS 语言的 imports 直出:AST walker(lang-swift/lang-objc/...)已产结构化 ImportRecord,
 * 无需行级正则。行号定位:ImportRecord 不携带行号,按 specifier 在文本中找首个 import 行
 * (确定性、便宜);找不到(理论不该发生)兜底第 1 行——range 语义降级但 specifier 仍真实。
 */
function collectAstImportsDirect(
  lines: readonly string[],
  astImports: readonly unknown[] | undefined
): ExtractedFileFlowImport[] {
  const imports: ExtractedFileFlowImport[] = [];
  for (const raw of astImports ?? []) {
    const record = readAstImportRecord(raw);
    if (!record) {
      continue;
    }
    const lineNumber = findImportLine(lines, record.specifier);
    imports.push({
      alias: record.alias,
      kind: record.kind,
      range: { endLine: lineNumber, startLine: lineNumber },
      specifier: record.specifier,
      statement: (lines[lineNumber - 1] ?? '').trim() || `import ${record.specifier}`,
      symbols: record.symbols,
      typeOnly: record.typeOnly,
    });
  }
  return dedupeImports(imports);
}

/** 找首个"含 import 关键字且含 specifier"的行(1-based);超长行跳过(防线②同口径)。 */
function findImportLine(lines: readonly string[], specifier: string): number {
  for (const [index, line] of lines.entries()) {
    if (line.length > MAX_PARSE_LINE_LENGTH) {
      continue;
    }
    if (line.includes('import') && line.includes(specifier)) {
      return index + 1;
    }
  }
  return 1;
}

function collectCallSites(
  astCallSites: readonly unknown[] | undefined,
  lineCount: number,
  dedupe = true
): ExtractedFileFlowCallSite[] {
  const callSites: ExtractedFileFlowCallSite[] = [];
  for (const item of astCallSites ?? []) {
    if (!isRecord(item)) {
      continue;
    }
    const callSite = item as AstCallSiteLike;
    const callee = readString(callSite.callee);
    const callerMethod = readString(callSite.callerMethod);
    const rawLine = readPositiveInteger(callSite.line);
    if (!callee || !callerMethod || !rawLine) {
      continue;
    }
    const line = Math.min(rawLine, lineCount);
    const matchingRange = readRange(callSite.matchingRange);
    const callerRange = readRange(callSite.callerRange);
    const callerQualifiedName = readString(callSite.callerQualifiedName);
    const calleeExpression = readString(callSite.calleeExpression);
    const receiverSyntax = readString(callSite.receiverSyntax);
    const omissionReason = readString(callSite.omissionReason);
    const calleeQualifiedName = readString(callSite.calleeQualifiedName);
    const calleeBindingRange = readRange(callSite.calleeBindingRange);
    callSites.push({
      argCount:
        Number.isInteger(callSite.argCount) && Number(callSite.argCount) >= 0
          ? Number(callSite.argCount)
          : undefined,
      callee,
      callerClass: readString(callSite.callerClass),
      callerMethod,
      callType: readString(callSite.callType) ?? 'function',
      isAwait: callSite.isAwait === true,
      ...(matchingRange ? { matchingRange } : {}),
      ...(callerRange ? { callerRange } : {}),
      ...(callerQualifiedName ? { callerQualifiedName } : {}),
      ...(calleeExpression ? { calleeExpression } : {}),
      ...(receiverSyntax ? { receiverSyntax } : {}),
      ...(callSite.syntaxKind === 'call' ||
      callSite.syntaxKind === 'new' ||
      callSite.syntaxKind === 'jsx'
        ? { syntaxKind: callSite.syntaxKind }
        : {}),
      ...(omissionReason ? { omissionReason } : {}),
      ...(typeof callSite.calleeShadowed === 'boolean'
        ? { calleeShadowed: callSite.calleeShadowed }
        : {}),
      ...(calleeQualifiedName ? { calleeQualifiedName } : {}),
      ...(calleeBindingRange ? { calleeBindingRange } : {}),
      range: { endLine: line, startLine: line },
      receiver: readString(callSite.receiver),
      receiverType: readString(callSite.receiverType),
    });
  }
  return dedupe ? dedupeCallSites(callSites) : callSites;
}

function readAstImportRecord(value: unknown):
  | {
      specifier: string;
      symbols: string[];
      kind: FileFlowImportKind;
      alias?: string;
      typeOnly?: boolean;
    }
  | undefined {
  if (typeof value === 'string') {
    return {
      kind: 'side-effect',
      specifier: value,
      symbols: [],
    };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const record = value as AstImportRecordLike;
  const specifier = readString(record.path);
  if (!specifier) {
    return undefined;
  }
  return {
    alias: readString(record.alias),
    kind: readImportKind(record.kind),
    specifier,
    symbols: readStringArray(record.symbols),
    typeOnly: record.isTypeOnly === true,
  };
}

function readImportKind(value: unknown): FileFlowImportKind {
  if (
    value === 'named' ||
    value === 'default' ||
    value === 'namespace' ||
    value === 'side-effect' ||
    value === 'dynamic'
  ) {
    return value;
  }
  return 'side-effect';
}

function dedupeImports(imports: readonly ExtractedFileFlowImport[]): ExtractedFileFlowImport[] {
  return dedupeBy(imports, (item) =>
    [
      item.specifier,
      item.kind,
      item.range.startLine,
      item.range.endLine,
      item.range.startColumn ?? '',
      item.range.endColumn ?? '',
      item.symbols.join(','),
    ].join(':')
  ).sort(compareImportRecords);
}

function dedupeExports(exports: readonly ExtractedFileFlowExport[]): ExtractedFileFlowExport[] {
  return dedupeBy(exports, (item) =>
    [
      item.kind,
      item.name,
      item.exportedName ?? '',
      item.specifier ?? '',
      item.range.startLine,
      item.range.startColumn ?? '',
      item.range.endColumn ?? '',
    ].join(':')
  ).sort(compareExportRecords);
}

function dedupeCallSites(
  callSites: readonly ExtractedFileFlowCallSite[]
): ExtractedFileFlowCallSite[] {
  return dedupeBy(callSites, (item) =>
    [
      item.callerClass ?? '',
      item.callerMethod,
      item.callerQualifiedName ?? '',
      item.callerRange?.startLine ?? '',
      item.callerRange?.startColumn ?? '',
      item.callee,
      item.callType,
      item.range.startLine,
      item.matchingRange?.startColumn ?? '',
      item.matchingRange?.endLine ?? '',
      item.matchingRange?.endColumn ?? '',
      item.receiver ?? '',
    ].join(':')
  ).sort(compareCallSites);
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareImportRecords(
  left: ExtractedFileFlowImport,
  right: ExtractedFileFlowImport
): number {
  return (
    compareRange(left.range, right.range) ||
    left.specifier.localeCompare(right.specifier) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareExportRecords(
  left: ExtractedFileFlowExport,
  right: ExtractedFileFlowExport
): number {
  return (
    compareRange(left.range, right.range) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareCallSites(
  left: ExtractedFileFlowCallSite,
  right: ExtractedFileFlowCallSite
): number {
  return (
    compareRange(left.range, right.range) ||
    (left.callerClass ?? '').localeCompare(right.callerClass ?? '') ||
    left.callerMethod.localeCompare(right.callerMethod) ||
    left.callee.localeCompare(right.callee)
  );
}

function compareRange(
  left: { startLine: number; endLine: number },
  right: { startLine: number; endLine: number }
): number {
  return left.startLine - right.startLine || left.endLine - right.endLine;
}

// 解析语言判定收敛到单源 shared/parserLanguage(fileSymbols 同款白名单同修,
// 2026-07-10 模块能力深审:适配层白名单把支持 swift/objc 等的 AstAnalyzer 挡在门外)。
function resolveParserLanguage(filePath: string, language?: string): string | undefined {
  return resolveAstParserLanguage(filePath, language);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readRange(value: unknown): ExtractedFileFlowCallSite['range'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const startLine = readPositiveInteger(value.startLine);
  const endLine = readPositiveInteger(value.endLine);
  if (!startLine || !endLine || endLine < startLine) {
    return undefined;
  }
  return {
    startLine,
    endLine,
    ...(Number.isInteger(value.startColumn) && Number(value.startColumn) >= 0
      ? { startColumn: Number(value.startColumn) }
      : {}),
    ...(Number.isInteger(value.endColumn) && Number(value.endColumn) >= 0
      ? { endColumn: Number(value.endColumn) }
      : {}),
  };
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

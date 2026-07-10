import path from 'node:path';

import '../../../core/ast/index.js';
import { analyzeFile, isAvailable as isAstAvailable } from '../../../core/AstAnalyzer.js';
import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowExport,
  ExtractedFileFlowImport,
  FileFlowExtractionResult,
  FileFlowImportKind,
} from './contracts.js';

interface AstFileFlowSummaryLike {
  imports?: unknown[];
  exports?: unknown[];
  callSites?: unknown[];
}

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
}

// 行级解析防线(2026-07-10 真实事故:SPM checkout 里的 jquery.min.js 单行 80KB+,
// parseCommonJsRequire 的懒惰组在其上灾难性回溯,钉死宿主 MCP 单线程事件循环 1h+)。
// 三层防御:①整文件压缩/生成物判定(本常量组)→ 走 unavailableReason 降级;②行长门——
// 超长行不进任何行级正则(真实 import/require 语句远短于此);③正则组自身界长。
// 阈值分工(复审校准):防线②的 2000 是"单行不解析"门,兜住正则安全;防线①的整文件
// 跳过必须显著保守——合法手写源码里嵌 5-15KB 的 data-URI/base64 字符串是真实形态,
// 单行 5000 就整文件跳过会把这类文件的 imports 全部误杀(防线②本就会跳过那一行)。
// 20000 以上的单行不再有合法手写场景(jquery.min 单行 80KB+ 仍稳判);平均行长 400
// 仍是 minified bundle(整文件几乎无换行)的主判据。
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

export function extractFileFlowFromSource(input: {
  text: string;
  filePath: string;
  language?: string;
  lineCount: number;
}): FileFlowExtractionResult {
  const parserLanguage = resolveParserLanguage(input.filePath, input.language);
  if (!parserLanguage) {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason: `file-flow parser is unavailable for language ${input.language ?? 'unknown'}.`,
    };
  }

  // 防线①:压缩/生成物整体跳过(先于 AST——垃圾内容连 AST 成本也不值得付)。
  // 降级走既有 unavailableReason 通道,消费方(fileFlow handler/上游投影)已适配该形态。
  const shape = detectPathologicalSourceShape(input.text);
  if (shape.pathological) {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason: `file-flow line-parse skipped for ${input.filePath}: ${shape.reason}.`,
    };
  }

  if (!isAstAvailable()) {
    return {
      callSites: [],
      exports: [],
      imports: [],
      unavailableReason: 'file-flow parser runtime is unavailable.',
    };
  }

  try {
    const summary = analyzeFile(input.text, parserLanguage, {
      extractCallSites: true,
    }) as AstFileFlowSummaryLike | null;
    if (!summary) {
      return {
        callSites: [],
        exports: [],
        imports: [],
        unavailableReason: `file-flow parser returned no AST summary for ${parserLanguage}.`,
      };
    }

    const lines = input.text.split(/\r\n|\n|\r/);
    return {
      callSites: collectCallSites(summary.callSites, input.lineCount),
      exports: collectExports(lines),
      imports: collectImports(lines, summary.imports),
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

function collectImports(
  lines: readonly string[],
  astImports: readonly unknown[] | undefined
): ExtractedFileFlowImport[] {
  const astQueue = (astImports ?? []).map(readAstImportRecord).filter(isExtractedImportMetadata);
  const codeLines = maskCommentText(lines);
  const imports: ExtractedFileFlowImport[] = [];
  const seenDynamicLines = new Set<number>();

  for (const statement of collectLogicalStatements(codeLines, 'import')) {
    const staticImport = parseStaticImportStatement(statement.text);
    if (staticImport) {
      const astRecord = shiftMatchingImport(astQueue, staticImport.specifier);
      imports.push({
        alias: staticImport.alias ?? astRecord?.alias,
        kind: staticImport.kind,
        range: statement.range,
        specifier: staticImport.specifier,
        statement: statement.text,
        symbols:
          staticImport.symbols.length > 0 ? staticImport.symbols : (astRecord?.symbols ?? []),
        typeOnly: staticImport.typeOnly || astRecord?.typeOnly,
      });
      continue;
    }

    for (const dynamicImport of parseDynamicImports(statement.text)) {
      imports.push({
        kind: 'dynamic',
        range: statement.range,
        specifier: dynamicImport,
        statement: statement.text,
        symbols: [],
      });
      seenDynamicLines.add(statement.range.startLine);
    }
  }

  for (const [index, line] of codeLines.entries()) {
    const lineNumber = index + 1;
    if (seenDynamicLines.has(lineNumber)) {
      continue;
    }
    // 防线②:超长行不进行级正则(真实 require 语句远短于门限;超长行=生成物/数据行)。
    if (line.length > MAX_PARSE_LINE_LENGTH) {
      continue;
    }
    if (isCommentOnlyLine(lines[index] ?? '')) {
      continue;
    }
    const cjs = parseCommonJsRequire(line);
    if (cjs) {
      imports.push({
        kind: cjs.kind,
        range: { endLine: lineNumber, startLine: lineNumber },
        specifier: cjs.specifier,
        statement: line.trim(),
        symbols: cjs.symbols,
      });
    }
    for (const dynamicImport of parseDynamicImports(line)) {
      imports.push({
        kind: 'dynamic',
        range: { endLine: lineNumber, startLine: lineNumber },
        specifier: dynamicImport,
        statement: line.trim(),
        symbols: [],
      });
    }
  }

  return dedupeImports(imports);
}

function isCommentOnlyLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}

function maskCommentText(lines: readonly string[]): string[] {
  let inBlockComment = false;
  let inString: '"' | "'" | '`' | undefined;
  let escaped = false;

  return lines.map((line) => {
    let masked = '';
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      const next = line[index + 1];

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          masked += '  ';
          index++;
          inBlockComment = false;
        } else {
          masked += ' ';
        }
        continue;
      }

      if (inString) {
        masked += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === inString) {
          inString = undefined;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        masked += char;
        continue;
      }

      if (char === '/' && next === '/') {
        masked += ' '.repeat(line.length - index);
        break;
      }

      if (char === '/' && next === '*') {
        masked += '  ';
        index++;
        inBlockComment = true;
        continue;
      }

      masked += char;
    }
    return masked;
  });
}

function collectExports(lines: readonly string[]): ExtractedFileFlowExport[] {
  const exports: ExtractedFileFlowExport[] = [];
  for (const statement of collectLogicalStatements(lines, 'export')) {
    const declaration = statement.text.match(
      /\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/
    );
    if (declaration?.[1] && declaration[2]) {
      exports.push({
        kind: declaration[1],
        name: declaration[2],
        range: statement.range,
        statement: statement.text,
      });
      continue;
    }

    const named = statement.text.match(
      /\bexport\s*\{\s*([^}]+)\s*\}(?:\s+from\s+['"]([^'"]+)['"])?/
    );
    if (named?.[1]) {
      for (const part of named[1].split(',')) {
        const [name, exportedName] = part.trim().split(/\s+as\s+/i);
        if (!name) {
          continue;
        }
        exports.push({
          exportedName: exportedName?.trim(),
          kind: named[2] ? 're-export' : 'named',
          name: name.trim(),
          range: statement.range,
          specifier: named[2],
          statement: statement.text,
        });
      }
      continue;
    }

    const all = statement.text.match(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (all?.[1]) {
      exports.push({
        kind: 're-export-all',
        name: '*',
        range: statement.range,
        specifier: all[1],
        statement: statement.text,
      });
    }
  }
  return dedupeExports(exports);
}

function collectCallSites(
  astCallSites: readonly unknown[] | undefined,
  lineCount: number
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
    callSites.push({
      argCount: readPositiveInteger(callSite.argCount),
      callee,
      callerClass: readString(callSite.callerClass),
      callerMethod,
      callType: readString(callSite.callType) ?? 'function',
      isAwait: callSite.isAwait === true,
      range: { endLine: line, startLine: line },
      receiver: readString(callSite.receiver),
      receiverType: readString(callSite.receiverType),
    });
  }
  return dedupeCallSites(callSites);
}

function collectLogicalStatements(
  lines: readonly string[],
  keyword: 'import' | 'export'
): Array<{ text: string; range: { startLine: number; endLine: number } }> {
  const statements: Array<{ text: string; range: { startLine: number; endLine: number } }> = [];
  let current: { parts: string[]; startLine: number } | undefined;
  const startPattern = keyword === 'import' ? /^\s*import\b/ : /^\s*export\b/;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    // 防线②:超长行既不能开启也不能延续逻辑语句(真实 import/export 语句远短于门限;
    // 已开启的语句遇到超长续行直接废弃——它不是人写的语句体)。
    if (line.length > MAX_PARSE_LINE_LENGTH) {
      current = undefined;
      continue;
    }
    if (!current && !startPattern.test(line)) {
      continue;
    }
    if (!current) {
      current = { parts: [], startLine: lineNumber };
    }
    current.parts.push(line.trim());
    const text = current.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (line.includes(';') || isCompleteKeywordStatement(text, keyword)) {
      statements.push({
        range: { endLine: lineNumber, startLine: current.startLine },
        text,
      });
      current = undefined;
    }
  }

  if (current) {
    statements.push({
      range: { endLine: lines.length, startLine: current.startLine },
      text: current.parts.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }

  return statements;
}

function isCompleteKeywordStatement(text: string, keyword: 'import' | 'export'): boolean {
  if (keyword === 'import') {
    return /['"]\s*$/.test(text) || /\)\s*$/.test(text);
  }
  return (
    /\}\s*(?:from\s+['"][^'"]+['"])?\s*$/.test(text) || /\*\s+from\s+['"][^'"]+['"]\s*$/.test(text)
  );
}

function parseStaticImportStatement(statement: string):
  | {
      specifier: string;
      symbols: string[];
      kind: FileFlowImportKind;
      alias?: string;
      typeOnly?: boolean;
    }
  | undefined {
  // 防线③:clause 组界长(同 parseCommonJsRequire——以 import 开头的单行压缩 ESM bundle
  // 会让无界 (.*?) 在寻找带空白 from 的过程中 O(n²) 回溯)。
  const match = statement.match(
    /^\s*import\s+(type\s+)?(?:(.{0,240}?)\s+from\s+)?['"]([^'"]+)['"]/
  );
  if (!match?.[3]) {
    return undefined;
  }
  const clause = match[2]?.trim();
  if (!clause) {
    return {
      kind: 'side-effect',
      specifier: match[3],
      symbols: [],
      typeOnly: Boolean(match[1]),
    };
  }

  const parsedClause = parseImportClause(clause);
  return {
    ...parsedClause,
    specifier: match[3],
    typeOnly: Boolean(match[1]),
  };
}

function parseImportClause(clause: string): {
  symbols: string[];
  kind: FileFlowImportKind;
  alias?: string;
} {
  if (/^\*\s+as\s+/.test(clause)) {
    const alias = clause.replace(/^\*\s+as\s+/, '').trim();
    return { alias, kind: 'namespace', symbols: ['*'] };
  }

  const namedMatch = clause.match(/\{([^}]+)\}/);
  const namedSymbols = namedMatch ? parseNamedBindings(namedMatch[1]) : [];
  const defaultName = clause.split(',')[0]?.trim();
  const hasDefault = Boolean(
    defaultName && !defaultName.startsWith('{') && !defaultName.includes('* as')
  );
  if (namedSymbols.length > 0) {
    return {
      kind: 'named',
      symbols: hasDefault && defaultName ? [defaultName, ...namedSymbols] : namedSymbols,
    };
  }
  if (defaultName) {
    return { kind: 'default', symbols: [defaultName] };
  }
  return { kind: 'side-effect', symbols: [] };
}

function parseNamedBindings(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .split(/\s+as\s+/i)
        .pop()
        ?.trim()
    )
    .filter((part): part is string => Boolean(part));
}

function parseCommonJsRequire(line: string):
  | {
      specifier: string;
      symbols: string[];
      kind: FileFlowImportKind;
    }
  | undefined {
  // 防线③:绑定组界长(1-240 已覆盖真实解构绑定;无界懒惰组 (.+?) 在含大量 var/= 的
  // 单行压缩 JS 上回溯 O(n²)——2026-07-10 jquery.min.js 事故的直接引信)。
  const match = line.match(
    /\b(?:const|let|var)\s+(.{1,240}?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const binding = match[1].trim();
  const symbols = binding.startsWith('{') ? parseNamedBindings(binding.slice(1, -1)) : [binding];
  return {
    kind: binding.startsWith('{') ? 'named' : 'default',
    specifier: match[2],
    symbols,
  };
}

function parseDynamicImports(text: string): string[] {
  const specifiers: string[] = [];

  for (let index = 0; index < text.length; index++) {
    const dynamicImport = readDynamicImportAt(text, index);
    if (dynamicImport) {
      specifiers.push(dynamicImport.specifier);
      index = dynamicImport.endIndex;
      continue;
    }

    const quoted = readQuotedLiteralAt(text, index);
    if (quoted) {
      index = quoted.endIndex;
    }
  }

  return specifiers;
}

function readDynamicImportAt(
  text: string,
  index: number
): { specifier: string; endIndex: number } | undefined {
  if (!isDynamicImportTokenAt(text, index)) {
    return undefined;
  }

  let cursor = skipWhitespace(text, index + 'import'.length);
  if (text[cursor] !== '(') {
    return undefined;
  }

  cursor = skipWhitespace(text, cursor + 1);
  const literal = readQuotedLiteralAt(text, cursor);
  const specifier = literal?.value.trim();
  if (!literal || !specifier || specifier.includes('${')) {
    return undefined;
  }

  return {
    endIndex: literal.endIndex,
    specifier,
  };
}

function readQuotedLiteralAt(
  text: string,
  index: number
): { value: string; endIndex: number } | undefined {
  const quote = text[index];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return undefined;
  }

  let value = '';
  for (let cursor = index + 1; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (char === '\\') {
      cursor++;
      if (cursor < text.length) {
        value += text[cursor];
      }
      continue;
    }
    if (char === quote) {
      return { endIndex: cursor, value };
    }
    value += char;
  }

  return undefined;
}

function isDynamicImportTokenAt(text: string, index: number): boolean {
  if (!text.startsWith('import', index)) {
    return false;
  }
  const previous = text[index - 1];
  const next = text[index + 'import'.length];
  return !isIdentifierChar(previous) && !isIdentifierChar(next);
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor++;
  }
  return cursor;
}

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
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

function shiftMatchingImport(
  imports: Array<NonNullable<ReturnType<typeof readAstImportRecord>>>,
  specifier: string
): NonNullable<ReturnType<typeof readAstImportRecord>> | undefined {
  const index = imports.findIndex((item) => item.specifier === specifier);
  if (index < 0) {
    return undefined;
  }
  const [item] = imports.splice(index, 1);
  return item;
}

function isExtractedImportMetadata<T>(value: T | undefined): value is T {
  return value !== undefined;
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
      item.callee,
      item.callType,
      item.range.startLine,
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

function resolveParserLanguage(filePath: string, language?: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.tsx') {
    return 'tsx';
  }
  if (extension === '.jsx') {
    return 'javascript';
  }
  if (language === 'typescript' || language === 'javascript') {
    return language;
  }
  return undefined;
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

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

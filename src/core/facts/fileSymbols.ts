import Logger from '../../infrastructure/logging/Logger.js';
import type { SupplementalDeclaration } from '../ast/extract/JsDeclarationCollector.js';
import type { ExtractedFileSymbol, FileSymbolsExtractionResult } from './contracts.js';
import { type FileAstFacts, type FileAstInput, readFileAst } from './fileAst.js';
import { createSourceLineRange } from './sourceLineRange.js';

interface AstSymbolRecord {
  superclass?: unknown;
  protocols?: unknown;
  inherits?: unknown;
  name?: unknown;
  kind?: unknown;
  line?: unknown;
  endLine?: unknown;
  bodyLines?: unknown;
  className?: unknown;
  isConstructorParam?: unknown;
  isConstructorAssignment?: unknown;
  matchingRange?: { startLine: number; endLine: number; startColumn?: number; endColumn?: number };
  nameIsPlaceholder?: boolean;
  declarationKind?: unknown;
  declarationRange?: ExtractedFileSymbol['range'];
}

interface AstFileSummaryLike {
  classes?: AstSymbolRecord[];
  protocols?: AstSymbolRecord[];
  methods?: AstSymbolRecord[];
  properties?: AstSymbolRecord[];
  exports?: unknown[];
}

export function extractFileSymbolsFromSource(
  input: FileAstInput,
  ast?: FileAstFacts
): FileSymbolsExtractionResult {
  const facts = ast ?? readFileAst(input, false);
  if (facts.status !== 'ready') {
    return {
      symbols: [],
      unavailableReason:
        facts.status === 'unsupported'
          ? `file-symbols parser is unavailable for language ${input.language ?? 'unknown'}.`
          : facts.status === 'runtime-unavailable'
            ? 'file-symbols parser runtime is unavailable.'
            : facts.status === 'empty'
              ? `file-symbols parser returned no AST summary for ${facts.parserLanguage}.`
              : `file-symbols parser failed for ${input.filePath}.`,
    };
  }

  try {
    const lines = input.text.split(/\r\n|\n|\r/);
    const symbols = collectExtractedSymbols({
      filePath: input.filePath,
      lineCount: input.lineCount,
      lines,
      summary: facts.summary,
    });
    symbols.push(
      ...collectSupplementalSymbols({
        declarations: facts.declarations ?? [],
        filePath: input.filePath,
        lineCount: input.lineCount,
        lines,
        // `export { x }` 形式的本地导出：声明语句自身不带 export，由导出表证明。
        locallyExported: new Set(
          (facts.moduleSyntax?.exports ?? [])
            .filter((item) => item.specifier === undefined)
            .map((item) => item.name)
        ),
      })
    );
    if (facts.moduleSyntax) {
      const local = new Set(
        facts.moduleSyntax.exports
          .filter((item) => item.specifier === undefined)
          .map((item) => item.name)
      );
      const remote = new Set(
        facts.moduleSyntax.exports
          .filter((item) => item.specifier !== undefined)
          .map((item) => item.name)
      );
      // 旧摘要的文本名集合会把export-from误当本地导出；只纠正已证实的同名非导出绑定，
      // 其余旧语言、声明范围及成员标志不在此变更，不能借re-export把本地private符号公开。
      for (const symbol of symbols) {
        if (
          symbol.exported &&
          !symbol.container &&
          remote.has(symbol.name) &&
          !local.has(symbol.name)
        ) {
          symbol.exported = false;
          Logger.debug('ProjectContext kept re-export and local symbol ownership separate', {
            filePath: input.filePath,
            symbol: symbol.name,
          });
        }
      }
    }
    return {
      syntaxValid: facts.syntaxValid,
      syntaxFeatures: facts.syntaxFeatures,
      symbols,
    };
  } catch {
    return {
      symbols: [],
      unavailableReason: `file-symbols parser failed for ${input.filePath}.`,
    };
  }
}

function collectExtractedSymbols(input: {
  summary: AstFileSummaryLike;
  filePath: string;
  lineCount: number;
  lines: string[];
}): ExtractedFileSymbol[] {
  const exportedNames = collectExportedNames(input.summary.exports);
  const symbols: ExtractedFileSymbol[] = [];

  for (const record of input.summary.classes ?? []) {
    const name = readString(record.name);
    const range = createSourceLineRange({
      endLine: record.endLine,
      lineCount: input.lineCount,
      startLine: record.line,
    });
    if (!name || !range) {
      continue;
    }
    const kind = normalizeClassKind(record.kind);
    symbols.push({
      ...declarationEvidence(record),
      ...heritageEvidence(
        record.superclass === undefined ? [] : [record.superclass],
        record.protocols
      ),
      exported: isExported(name, range.startLine, input.lines, exportedNames),
      filePath: input.filePath,
      kind,
      name,
      qualifiedName: name,
      range,
      signature: readSignature(input.lines, range),
    });
  }

  for (const record of input.summary.protocols ?? []) {
    const name = readString(record.name);
    const range = createSourceLineRange({
      endLine: record.endLine,
      lineCount: input.lineCount,
      startLine: record.line,
    });
    if (!name || !range) {
      continue;
    }
    symbols.push({
      ...declarationEvidence(record),
      ...heritageEvidence(record.inherits, []),
      exported: isExported(name, range.startLine, input.lines, exportedNames),
      filePath: input.filePath,
      kind: 'interface',
      name,
      qualifiedName: name,
      range,
      signature: readSignature(input.lines, range),
    });
  }

  for (const record of input.summary.methods ?? []) {
    const name = readString(record.name);
    const range = createSourceLineRange({
      bodyLines: record.bodyLines,
      endLine: record.endLine,
      lineCount: input.lineCount,
      startLine: record.line,
    });
    if (!name || !range) {
      continue;
    }
    const container = readString(record.className);
    const kind = container ? (name === 'constructor' ? 'constructor' : 'method') : 'function';
    symbols.push({
      ...declarationEvidence(record),
      container,
      ...(record.matchingRange ? { matchingRange: { ...record.matchingRange } } : {}),
      ...(record.nameIsPlaceholder ? { nameIsPlaceholder: true } : {}),
      ...(record.kind === 'declaration'
        ? { compatibilitySource: 'method-declaration' as const }
        : {}),
      exported: isExported(name, range.startLine, input.lines, exportedNames),
      filePath: input.filePath,
      kind,
      name,
      qualifiedName: container ? `${container}.${name}` : name,
      range,
      signature: readSignature(input.lines, range),
    });
  }

  for (const record of input.summary.properties ?? []) {
    const name = readString(record.name);
    const range = createSourceLineRange({
      endLine: record.endLine,
      lineCount: input.lineCount,
      startLine: record.line,
    });
    if (!name || !range) {
      continue;
    }
    const container = readString(record.className);
    symbols.push({
      ...declarationEvidence(record),
      container,
      ...(record.isConstructorParam === true
        ? { compatibilitySource: 'constructor-parameter-property' as const }
        : record.isConstructorAssignment === true
          ? { compatibilitySource: 'constructor-this-assignment' as const }
          : {}),
      exported: isExported(name, range.startLine, input.lines, exportedNames),
      filePath: input.filePath,
      kind: container ? 'property' : 'variable',
      name,
      qualifiedName: container ? `${container}.${name}` : name,
      range,
      signature: readSignature(input.lines, range),
    });
  }

  return symbols;
}

/** 摘要之外的模块级声明（顶层变量、接口成员）投影成同一种符号记录。 */
function collectSupplementalSymbols(input: {
  declarations: readonly SupplementalDeclaration[];
  filePath: string;
  lineCount: number;
  lines: string[];
  locallyExported: ReadonlySet<string>;
}): ExtractedFileSymbol[] {
  const symbols: ExtractedFileSymbol[] = [];
  for (const declaration of input.declarations) {
    const range = createSourceLineRange({
      endLine: declaration.range.endLine,
      lineCount: input.lineCount,
      startLine: declaration.range.startLine,
    });
    if (!range) {
      continue;
    }
    symbols.push({
      ...(declaration.container ? { container: declaration.container } : {}),
      declarationKind: declaration.declarationKind,
      declarationRange: { ...declaration.range },
      exported:
        declaration.exported ||
        (!declaration.container && input.locallyExported.has(declaration.name)),
      filePath: input.filePath,
      kind: declaration.kind,
      name: declaration.name,
      qualifiedName: declaration.container
        ? `${declaration.container}.${declaration.name}`
        : declaration.name,
      range,
      signature: readSignature(input.lines, range),
      supplement: true,
    });
  }
  return symbols;
}

function declarationEvidence(
  record: AstSymbolRecord
): Pick<ExtractedFileSymbol, 'declarationKind' | 'declarationRange'> {
  const declarationKind = readString(record.declarationKind);
  return {
    ...(declarationKind ? { declarationKind } : {}),
    ...(record.declarationRange ? { declarationRange: { ...record.declarationRange } } : {}),
  };
}

/** 父类型名字：去掉泛型实参与空白，丢弃空值；两类都没有时不带这个字段。 */
function heritageEvidence(
  extended: unknown,
  implemented: unknown
): Pick<ExtractedFileSymbol, 'heritage'> {
  const names = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
      .map((item) => (typeof item === 'string' ? item.split('<')[0].trim() : ''))
      .filter((item) => item.length > 0);
  const superTypes = names(extended);
  // Swift 的继承列表不区分父类与协议，插件把第一项同时记进两边；这里不重复。
  const heritage = {
    extends: superTypes,
    implements: names(implemented).filter((name) => !superTypes.includes(name)),
  };
  return heritage.extends.length > 0 || heritage.implements.length > 0 ? { heritage } : {};
}

function normalizeClassKind(value: unknown): string {
  const kind = readString(value);
  if (kind === 'type' || kind === 'enum') {
    return kind;
  }
  return 'class';
}

function collectExportedNames(exports: readonly unknown[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const item of exports ?? []) {
    const text = isRecord(item) ? readString(item.text) : undefined;
    if (!text) {
      continue;
    }
    const declaration = text.match(
      /\bexport\s+(?:abstract\s+)?(?:class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/
    );
    if (declaration?.[1]) {
      names.add(declaration[1]);
    }
    const named = text.match(/\bexport\s*\{\s*([^}]+)\}/);
    if (named?.[1]) {
      for (const part of named[1].split(',')) {
        const localName = part
          .trim()
          .split(/\s+as\s+/i)[0]
          ?.trim();
        if (localName) {
          names.add(localName);
        }
      }
    }
  }
  return names;
}

function isExported(
  name: string,
  startLine: number,
  lines: readonly string[],
  exportedNames: ReadonlySet<string>
): boolean {
  const line = lines[startLine - 1] ?? '';
  return exportedNames.has(name) || /\bexport\b/.test(line);
}

function readSignature(lines: readonly string[], range: { startLine: number; endLine: number }) {
  const text = lines
    .slice(range.startLine - 1, Math.min(range.endLine, range.startLine + 2))
    .join(' ');
  const normalized = text.replace(/\s+/g, ' ').trim();
  const firstBlock = normalized.split(/\s+\{|\s+=>/)[0]?.trim() ?? normalized;
  return firstBlock.length > 160 ? `${firstBlock.slice(0, 157)}...` : firstBlock;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

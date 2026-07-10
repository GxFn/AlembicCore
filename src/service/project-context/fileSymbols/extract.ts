import '../../../core/ast/index.js';
import { analyzeFile, isAvailable as isAstAvailable } from '../../../core/AstAnalyzer.js';
import { resolveAstParserLanguage } from '../shared/parserLanguage.js';
import type { ExtractedFileSymbol, FileSymbolsExtractionResult } from './contracts.js';
import { createSourceLineRange } from './ranges.js';

interface AstSymbolRecord {
  name?: unknown;
  kind?: unknown;
  line?: unknown;
  endLine?: unknown;
  bodyLines?: unknown;
  className?: unknown;
}

interface AstFileSummaryLike {
  classes?: AstSymbolRecord[];
  protocols?: AstSymbolRecord[];
  methods?: AstSymbolRecord[];
  properties?: AstSymbolRecord[];
  exports?: unknown[];
}

export function extractFileSymbolsFromSource(input: {
  text: string;
  filePath: string;
  language?: string;
  lineCount: number;
}): FileSymbolsExtractionResult {
  const parserLanguage = resolveParserLanguage(input.filePath, input.language);
  if (!parserLanguage) {
    return {
      symbols: [],
      unavailableReason: `file-symbols parser is unavailable for language ${input.language ?? 'unknown'}.`,
    };
  }

  if (!isAstAvailable()) {
    return {
      symbols: [],
      unavailableReason: 'file-symbols parser runtime is unavailable.',
    };
  }

  try {
    const summary = analyzeFile(input.text, parserLanguage, {
      extractCallSites: false,
    }) as AstFileSummaryLike | null;
    if (!summary) {
      return {
        symbols: [],
        unavailableReason: `file-symbols parser returned no AST summary for ${parserLanguage}.`,
      };
    }

    return {
      symbols: collectExtractedSymbols({
        filePath: input.filePath,
        lineCount: input.lineCount,
        lines: input.text.split(/\r\n|\n|\r/),
        summary,
      }),
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
      container,
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
      container,
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

// 解析语言判定收敛到单源 shared/parserLanguage(与 fileFlow 同修:此前私有白名单只认
// ts/js 四型,Swift/ObjC/Kotlin 的 file-symbols 自诞生起 unavailable——2026-07-10 深审)。
function resolveParserLanguage(filePath: string, language?: string): string | undefined {
  return resolveAstParserLanguage(filePath, language);
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

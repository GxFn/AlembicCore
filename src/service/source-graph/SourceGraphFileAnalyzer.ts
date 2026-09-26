import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../../core/ast/index.js';
import { analyzeFile, isAvailable as isAstAvailable } from '../../core/AstAnalyzer.js';
import { ImportPathResolver } from '../../core/analysis/ImportPathResolver.js';
import type {
  SourceFileNode,
  SourceFileNodeInput,
  SourceGraphDiagnosticInput,
  SourceGraphEdgeInput,
  SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { readProjectContextAst } from '../project-context/analysis/astFacts.js';
import type { ProjectContextSymbolExtractor } from '../project-context/analysis/SymbolExtractor.js';
import { extractFileFlowFromSource } from '../project-context/fileFlow/extract.js';
import { extractFileSymbolsFromSource } from '../project-context/fileSymbols/extract.js';
import {
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from '../project-context/shared/parserLanguage.js';
import { projectSourceGraphSymbols } from './SourceGraphCodeGraphSymbols.js';
import {
  CODEGRAPH_PARSABLE_EXTENSIONS,
  type NormalizedIndexOptions,
  normalizeRepoRelative,
  PARSABLE_EXTENSIONS,
} from './SourceGraphIndexOptions.js';

export interface InventoryFile {
  absolutePath: string;
  repoRelativePath: string;
  language: string;
  classification: SourceFileNodeInput['classification'];
  sizeBytes: number;
  mtimeMs: number;
  extension: string;
}

export interface ParsedFile {
  file: SourceFileNodeInput;
  symbols: SourceSymbolNode[];
  edges: SourceGraphEdgeInput[];
  diagnostics: SourceGraphDiagnosticInput[];
}

export async function parseInventoryFile(
  file: InventoryFile,
  options: NormalizedIndexOptions,
  generationId: string,
  knownPaths: Set<string>,
  symbolExtractor?: ProjectContextSymbolExtractor
): Promise<ParsedFile> {
  throwIfSourceReadAborted(options);
  const content = await fs.readFile(file.absolutePath, {
    encoding: 'utf8',
    signal: options.signal,
  });
  throwIfSourceReadAborted(options);
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const lineCount = countLines(content);
  const baseFile: SourceFileNodeInput = {
    generationId,
    projectRoot: options.projectRoot,
    repoRelativePath: file.repoRelativePath,
    language: file.language,
    contentHash,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    indexedAt: options.now,
    classification: file.classification,
    parseStatus: 'parsed',
    lineCount,
    metadata: {
      extractorVersion: options.extractorVersion,
    },
  };

  if (file.sizeBytes > options.maxFileSizeBytes) {
    return skippedFile(
      baseFile,
      'large-file-skipped',
      'File exceeded source graph index size limit.'
    );
  }
  const parsableExtensions = options.codeGraph
    ? CODEGRAPH_PARSABLE_EXTENSIONS
    : PARSABLE_EXTENSIONS;
  if (!parsableExtensions.has(file.extension)) {
    // Track2-b(2026-07-11 决策③生态补全):非 JS 系但 AstAnalyzer 支持的语言
    // (swift/objectivec/kotlin/python/go/rust/dart…)走 AST 符号抽取——此前一律
    // skipped,BiliDili(纯 Swift)source_graph 恒 0 实体。预算闸(maxParseBytes)
    // 对 AST 路径同样生效;AST 不可用/解析失败按 failed 降级,files 行保留。
    const astLanguage = resolveAstParserLanguage(file.repoRelativePath, file.language);
    if (astLanguage && !JS_FAMILY_LANGUAGES.has(astLanguage)) {
      if (file.sizeBytes > options.maxParseBytes) {
        return partialFile(baseFile, 'parser-timeout', 'File exceeded source graph parser budget.');
      }
      return parseAstFile(content, baseFile, file, generationId, options, lineCount, astLanguage);
    }
    return skippedFile(
      baseFile,
      'unsupported-language',
      `Unsupported source graph language: ${file.language}.`
    );
  }
  if (file.sizeBytes > options.maxParseBytes) {
    return partialFile(baseFile, 'parser-timeout', 'File exceeded source graph parser budget.');
  }
  if (symbolExtractor) {
    return parseCodeGraphFile(
      content,
      baseFile,
      file,
      generationId,
      options,
      lineCount,
      knownPaths,
      symbolExtractor
    );
  }
  if (content.includes('SOURCE_GRAPH_PARSE_FAILURE')) {
    return failedFile(baseFile, 'Source graph parser failed for this file.');
  }

  const symbols = extractSymbols(content, file, generationId, options.extractorVersion, lineCount);
  const edges = extractImportEdges(content, file, generationId, knownPaths);
  return {
    file: baseFile,
    symbols,
    edges,
    diagnostics: [],
  };
}

async function parseCodeGraphFile(
  content: string,
  baseFile: SourceFileNodeInput,
  file: InventoryFile,
  generationId: string,
  options: NormalizedIndexOptions,
  lineCount: number,
  knownPaths: Set<string>,
  extractor: ProjectContextSymbolExtractor
): Promise<ParsedFile> {
  const input = {
    text: content,
    filePath: file.repoRelativePath,
    language: file.language,
    lineCount,
  };
  // 所有投影共享本次已读文本；不调用会重新读取live文件的ProjectContext envelope。
  const ast = readProjectContextAst(input, false);
  const legacy = extractFileSymbolsFromSource(input, ast);
  const extracted = await extractor.extractSymbols(input, legacy, { signal: options.signal });
  throwIfSourceReadAborted(options);
  if (extracted.unavailableReason) {
    return failedFile(baseFile, extracted.unavailableReason);
  }
  let symbols: SourceSymbolNode[];
  try {
    symbols = [
      moduleSymbolFromInventory(file, generationId, options.extractorVersion, lineCount),
      ...projectSourceGraphSymbols(
        extracted.symbols,
        file.repoRelativePath,
        generationId,
        options.extractorVersion
      ),
    ];
  } catch (error) {
    Logger.warn('Source graph rejected ambiguous symbol persistence', {
      filePath: file.repoRelativePath,
      reason: error instanceof Error ? error.message : String(error),
    });
    return failedFile(baseFile, error instanceof Error ? error.message : String(error));
  }
  // SDK符号与现有Core导入生产方职责分开；复用多行/comment-aware解析，不再增一份JS正则。
  const flow = extractFileFlowFromSource(input, ast);
  if (flow.unavailableReason) {
    const partial = partialFile(baseFile, 'parser-timeout', flow.unavailableReason);
    return { ...partial, symbols };
  }
  const edges: SourceGraphEdgeInput[] = [];
  for (const item of flow.imports) {
    const target = resolveRelativeImport(
      file.repoRelativePath,
      item.specifier,
      knownPaths,
      CODEGRAPH_PARSABLE_EXTENSIONS
    );
    if (!target) {
      continue;
    }
    edges.push({
      generationId,
      edgeId: `${file.repoRelativePath}:imports:${target}`,
      kind: 'imports',
      fromSymbolId: `${file.repoRelativePath}#module`,
      fromFilePath: file.repoRelativePath,
      toFilePath: target,
      siteFilePath: file.repoRelativePath,
      site: {
        startLine: item.range.startLine,
        startColumn: item.range.startColumn ?? 0,
        endLine: item.range.endLine,
        endColumn: item.range.endColumn ?? 0,
      },
      provenance: 'deterministic',
      confidence: 1,
      source: item.specifier,
    });
  }
  return { file: baseFile, symbols, edges, diagnostics: [] };
}

/** AstAnalyzer 的 summary 记录最小读取形态(与 fileSymbols 适配层同源语义)。 */
interface AstSymbolRecordLike {
  name?: unknown;
  kind?: unknown;
  line?: unknown;
  endLine?: unknown;
  className?: unknown;
}

interface AstSummaryLike {
  classes?: AstSymbolRecordLike[];
  protocols?: AstSymbolRecordLike[];
  methods?: AstSymbolRecordLike[];
  properties?: AstSymbolRecordLike[];
  imports?: Array<{ specifier?: unknown } | string>;
}

/**
 * Track2-b:AST 语言的符号/导入抽取。产出契约与正则版 extractSymbols 完全同型
 * (symbolId=path#name/range/provenance),消费方(仓储/查询)零改动。
 * Swift 等模块名导入解析不到仓内文件(与 JS 相对导入语义不同),本期不产伪 file
 * 边——imports 证据留待模块名 join 需求(与 Track1 同语义)单独立项。
 */
function parseAstFile(
  content: string,
  baseFile: SourceFileNodeInput,
  file: InventoryFile,
  generationId: string,
  options: NormalizedIndexOptions,
  lineCount: number,
  astLanguage: string
): ParsedFile {
  if (!isAstAvailable()) {
    return failedFile(baseFile, `AST runtime unavailable for language ${astLanguage}.`);
  }
  let summary: AstSummaryLike | null = null;
  try {
    summary = analyzeFile(content, astLanguage, { extractCallSites: false }) as AstSummaryLike;
  } catch (error) {
    return failedFile(
      baseFile,
      `AST parse failed for ${astLanguage}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!summary) {
    return failedFile(baseFile, `AST parser returned no summary for ${astLanguage}.`);
  }

  const symbols: SourceSymbolNode[] = [
    moduleSymbolFromInventory(file, generationId, options.extractorVersion, lineCount),
  ];
  const pushSymbol = (record: AstSymbolRecordLike, kind: string) => {
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null;
    if (!name) {
      return;
    }
    const startLine =
      typeof record.line === 'number' && record.line >= 1 ? Math.trunc(record.line) : 1;
    const endLine =
      typeof record.endLine === 'number' && record.endLine >= startLine
        ? Math.trunc(record.endLine)
        : startLine;
    const container =
      typeof record.className === 'string' && record.className.trim()
        ? record.className.trim()
        : null;
    symbols.push({
      generationId,
      symbolId: `${file.repoRelativePath}#${container ? `${container}.` : ''}${name}`,
      displayName: name,
      qualifiedName: container ? `${container}.${name}` : name,
      kind,
      filePath: file.repoRelativePath,
      range: { startLine, startColumn: 0, endLine, endColumn: 0 },
      exported: false,
      imported: false,
      metadata: {
        extractorVersion: options.extractorVersion,
        declarationKind: kind,
        astLanguage,
      },
      provenance: {
        extractor: 'source-graph-ast-symbols',
      },
    });
  };
  for (const record of summary.classes ?? []) {
    pushSymbol(record, 'class');
  }
  for (const record of summary.protocols ?? []) {
    pushSymbol(record, 'interface');
  }
  for (const record of summary.methods ?? []) {
    pushSymbol(record, 'function');
  }
  for (const record of summary.properties ?? []) {
    pushSymbol(record, 'variable');
  }

  return {
    file: baseFile,
    symbols,
    edges: [],
    diagnostics: [],
  };
}

function skippedFile(
  file: SourceFileNodeInput,
  code: 'large-file-skipped' | 'unsupported-language',
  message: string
): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'skipped',
      parseErrors: [{ message, severity: 'warning', code }],
    },
    symbols: [],
    edges: [],
    diagnostics: [
      {
        code,
        message,
        filePath: file.repoRelativePath,
      },
    ],
  };
}

function partialFile(
  file: SourceFileNodeInput,
  code: 'parser-timeout',
  message: string
): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'partial',
      parseErrors: [{ message, severity: 'warning', code }],
    },
    symbols: [moduleSymbol(file, 1)],
    edges: [],
    diagnostics: [
      {
        code,
        message,
        filePath: file.repoRelativePath,
      },
    ],
  };
}

function failedFile(file: SourceFileNodeInput, message: string): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'failed',
      parseErrors: [{ message, severity: 'error', code: 'parse-failed' }],
    },
    symbols: [],
    edges: [],
    diagnostics: [
      {
        code: 'catch-up-failed',
        message,
        filePath: file.repoRelativePath,
        metadata: { parseErrorCode: 'parse-failed' },
      },
    ],
  };
}

export function diagnosticsForRetainedFile(file: SourceFileNode): SourceGraphDiagnosticInput[] {
  if (file.parseErrors.length === 0) {
    return file.parseStatus === 'parsed'
      ? []
      : [
          {
            code: 'catch-up-failed',
            message: `Retained source graph file has ${file.parseStatus} parsing coverage.`,
            filePath: file.repoRelativePath,
            metadata: { parseStatus: file.parseStatus },
          },
        ];
  }
  return file.parseErrors.map((error) => {
    if (
      error.code === 'large-file-skipped' ||
      error.code === 'unsupported-language' ||
      error.code === 'parser-timeout'
    ) {
      return { code: error.code, message: error.message, filePath: file.repoRelativePath };
    }
    // parse-failed 是文件级错误码；查询诊断保持 failedFile 使用的 catch-up-failed。
    // 未知旧错误码也不能被当成已解析成功，保留原码供后续核验。
    return {
      code: 'catch-up-failed',
      message: error.message,
      filePath: file.repoRelativePath,
      metadata: error.code ? { parseErrorCode: error.code } : undefined,
    };
  });
}

function extractSymbols(
  content: string,
  file: InventoryFile,
  generationId: string,
  extractorVersion: string,
  lineCount: number
): SourceSymbolNode[] {
  const symbols: SourceSymbolNode[] = [
    moduleSymbolFromInventory(file, generationId, extractorVersion, lineCount),
  ];
  const lines = content.split(/\r\n|\n|\r/);
  const symbolPattern =
    /\b(export\s+)?(?:abstract\s+)?(class|interface|enum|function|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(symbolPattern)) {
      const kind = symbolKindForDeclaration(match[2]);
      const displayName = match[3];
      symbols.push({
        generationId,
        symbolId: `${file.repoRelativePath}#${displayName}`,
        displayName,
        qualifiedName: displayName,
        kind,
        filePath: file.repoRelativePath,
        range: {
          startLine: index + 1,
          startColumn: match.index ?? 0,
          endLine: index + 1,
          endColumn: (match.index ?? 0) + match[0].length,
        },
        exported: Boolean(match[1]),
        imported: false,
        metadata: {
          extractorVersion,
          declarationKind: match[2],
        },
        provenance: {
          extractor: 'source-graph-regex-symbols',
        },
      });
    }
  }
  return symbols;
}

function moduleSymbolFromInventory(
  file: InventoryFile,
  generationId: string,
  extractorVersion: string,
  lineCount: number
): SourceSymbolNode {
  return {
    generationId,
    symbolId: `${file.repoRelativePath}#module`,
    displayName: path.basename(file.repoRelativePath),
    qualifiedName: file.repoRelativePath,
    kind: 'module',
    filePath: file.repoRelativePath,
    range: { startLine: 1, startColumn: 0, endLine: Math.max(1, lineCount), endColumn: 0 },
    exported: true,
    imported: false,
    metadata: {
      extractorVersion,
      language: file.language,
    },
    provenance: {
      extractor: 'source-graph-file-inventory',
    },
  };
}

function moduleSymbol(file: SourceFileNodeInput, lineCount: number): SourceSymbolNode {
  return {
    generationId: file.generationId,
    symbolId: `${file.repoRelativePath}#module`,
    displayName: path.basename(file.repoRelativePath),
    qualifiedName: file.repoRelativePath,
    kind: 'module',
    filePath: file.repoRelativePath,
    range: { startLine: 1, startColumn: 0, endLine: Math.max(1, lineCount), endColumn: 0 },
    exported: true,
    imported: false,
    metadata: {
      language: file.language,
    },
    provenance: {
      extractor: 'source-graph-file-inventory',
    },
  };
}

function extractImportEdges(
  content: string,
  file: InventoryFile,
  generationId: string,
  knownPaths: Set<string>
): SourceGraphEdgeInput[] {
  const lines = content.split(/\r\n|\n|\r/);
  const edges: SourceGraphEdgeInput[] = [];
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      const target = resolveRelativeImport(file.repoRelativePath, specifier, knownPaths);
      if (!target) {
        continue;
      }
      edges.push({
        generationId,
        edgeId: `${file.repoRelativePath}:imports:${target}`,
        kind: 'imports',
        fromSymbolId: `${file.repoRelativePath}#module`,
        fromFilePath: file.repoRelativePath,
        toFilePath: target,
        siteFilePath: file.repoRelativePath,
        site: {
          startLine: index + 1,
          startColumn: match.index ?? 0,
          endLine: index + 1,
          endColumn: (match.index ?? 0) + match[0].length,
        },
        provenance: 'deterministic',
        confidence: 1,
        source: specifier,
      });
    }
  }
  return edges;
}

function resolveRelativeImport(
  currentFile: string,
  specifier: string,
  knownPaths: Set<string>,
  extensions: ReadonlySet<string> = PARSABLE_EXTENSIONS
): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = normalizeRepoRelative(
    path.posix.normalize(path.posix.join(path.posix.dirname(currentFile), specifier))
  );
  return (
    ImportPathResolver.resolveIndexedFile(base, (requestedPath) => {
      const candidates = [
        requestedPath,
        ...Array.from(extensions).map((extension) => `${requestedPath}${extension}`),
        ...Array.from(extensions).map((extension) => `${requestedPath}/index${extension}`),
      ];
      return candidates.find((candidate) => knownPaths.has(candidate));
    }) ?? undefined
  );
}

function symbolKindForDeclaration(kind: string): SourceSymbolNode['kind'] {
  switch (kind) {
    case 'class':
      return 'class';
    case 'interface':
      return 'interface';
    case 'enum':
      return 'enum';
    case 'function':
      return 'function';
    case 'type':
      return 'type';
    case 'const':
    case 'let':
    case 'var':
      return 'variable';
    default:
      return 'unknown';
  }
}

function countLines(content: string): number {
  return Math.max(1, content.split(/\r\n|\n|\r/).length);
}

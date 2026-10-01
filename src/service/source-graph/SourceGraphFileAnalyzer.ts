import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowExport,
  ExtractedFileFlowImport,
} from '../../core/facts/contracts.js';
import { readFileSyntaxEvidence } from '../../core/facts/fileSyntaxEvidence.js';
import { JS_FAMILY_LANGUAGES, resolveAstParserLanguage } from '../../core/facts/parserLanguage.js';
import type {
  SourceFileNode,
  SourceFileNodeInput,
  SourceGraphDiagnosticInput,
  SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { LanguageService } from '../../shared/LanguageService.js';
import type { NormalizedIndexOptions } from './SourceGraphIndexOptions.js';
import {
  createModuleSymbol,
  type IndexedDeclaration,
  moduleSymbolId,
  projectSourceGraphSymbols,
} from './SourceGraphSymbols.js';

export interface InventoryFile {
  absolutePath: string;
  repoRelativePath: string;
  language: string;
  classification: SourceFileNodeInput['classification'];
  sizeBytes: number;
  mtimeMs: number;
  extension: string;
}

/**
 * 一个文件留给链接阶段的事实：声明（连同索引节点）、模块导入导出、调用点。
 * 链接完成后调用点即被释放，声明与导出表留作其他文件的链接目标。
 */
export interface FileLinkFacts {
  filePath: string;
  parserLanguage: string;
  moduleSymbolId: string;
  declarations: IndexedDeclaration[];
  imports: ExtractedFileFlowImport[];
  exports: ExtractedFileFlowExport[];
  defaultExportNames: string[];
  callSites?: ExtractedFileFlowCallSite[];
}

export interface AnalyzedFile {
  file: SourceFileNodeInput;
  symbols: SourceSymbolNode[];
  diagnostics: SourceGraphDiagnosticInput[];
  /** 只有完整解析的文件才参与链接；跳过、失败、超预算的文件没有这一项。 */
  facts?: FileLinkFacts;
}

/**
 * 读一次文件，产出它的索引节点与链接事实。
 *
 * 所有语言走同一条路：core/facts 的文件事实。内容哈希、符号、调用点都来自这一次读取到的文本，
 * 读取之后文件再变化不会让它们互相错位。
 */
export async function analyzeInventoryFile(
  file: InventoryFile,
  options: NormalizedIndexOptions,
  generationId: string,
  /** 只当链接目标用：只要声明与导出表，不提取导入与调用点。 */
  declarationsOnly = false
): Promise<AnalyzedFile> {
  throwIfSourceReadAborted(options);
  const content = await fs.readFile(file.absolutePath, {
    encoding: 'utf8',
    signal: options.signal,
  });
  throwIfSourceReadAborted(options);
  const lineCount = countLines(content);
  const baseFile: SourceFileNodeInput = {
    generationId,
    projectRoot: options.projectRoot,
    repoRelativePath: file.repoRelativePath,
    language: file.language,
    contentHash: crypto.createHash('sha256').update(content).digest('hex'),
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
  // 解析器只按扩展名选：语言标签更宽（.vue、.svelte 也标成 javascript），不能当作语法依据。
  const parserLanguage = resolveAstParserLanguage(file.repoRelativePath);
  if (!parserLanguage) {
    // 文档与配置进清单是为了新鲜度、模块配置与正文召回，本来就不该有符号图：不是缺口，不记诊断。
    // 没有解析器的源码语言才是"这个文件没被覆盖"，记一条提示级诊断。
    return LanguageService.isSourceExt(file.extension)
      ? skippedFile(
          baseFile,
          'unsupported-language',
          `Unsupported source graph language: ${file.language}.`
        )
      : inventoryOnlyFile(baseFile);
  }
  if (file.sizeBytes > options.maxParseBytes) {
    return partialFile(baseFile, 'File exceeded source graph parser budget.');
  }

  const evidence = readFileSyntaxEvidence(
    { text: content, filePath: file.repoRelativePath, lineCount },
    !declarationsOnly
  );
  if (evidence.symbols.unavailableReason) {
    return failedFile(baseFile, evidence.symbols.unavailableReason);
  }
  if (JS_FAMILY_LANGUAGES.has(parserLanguage) && evidence.symbols.syntaxValid === false) {
    // 带语法错误的树会产出残缺或错位的声明。其他语言的语法包对合法源码也常报错（宏、预处理），
    // 所以只对 JS 家族按失败处理，保持这条路线原有的状态语义。
    return failedFile(baseFile, 'Source graph parser found syntax errors in this file.');
  }

  let declarations: IndexedDeclaration[];
  try {
    declarations = projectSourceGraphSymbols(
      evidence.symbols.symbols,
      file.repoRelativePath,
      generationId,
      options.extractorVersion
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    Logger.warn('Source graph rejected ambiguous symbol persistence', {
      filePath: file.repoRelativePath,
      reason,
    });
    return failedFile(baseFile, reason);
  }
  const symbols = [
    createModuleSymbol({
      generationId,
      filePath: file.repoRelativePath,
      language: file.language,
      lineCount,
      extractorVersion: options.extractorVersion,
    }),
    ...new Set(declarations.map((declaration) => declaration.node)),
  ];
  const uncoveredSyntax = evidence.symbols.syntaxFeatures ?? [];
  if (uncoveredSyntax.length > 0) {
    // 这些声明形态（namespace 成员、匿名 default）没有符号；文件其余部分照常入库。
    Logger.debug('Source graph indexed a file with declaration forms it does not cover', {
      filePath: file.repoRelativePath,
      uncoveredSyntax,
    });
    baseFile.metadata = { ...baseFile.metadata, uncoveredSyntax };
  }

  if (declarationsOnly) {
    return {
      file: baseFile,
      symbols,
      diagnostics: [],
      facts: {
        filePath: file.repoRelativePath,
        parserLanguage,
        moduleSymbolId: moduleSymbolId(file.repoRelativePath),
        declarations,
        imports: [],
        exports: evidence.exports,
        defaultExportNames: evidence.defaultExportNames,
      },
    };
  }
  const flow = evidence.flow;
  if (!flow || flow.unavailableReason) {
    // 压缩或生成物形态的文件不做调用点提取；声明仍然入库，但不参与链接。
    const partial = partialFile(
      baseFile,
      flow?.unavailableReason ?? 'Source graph call extraction is unavailable.'
    );
    return { ...partial, symbols };
  }
  return {
    file: baseFile,
    symbols,
    diagnostics: [],
    facts: {
      filePath: file.repoRelativePath,
      parserLanguage,
      moduleSymbolId: moduleSymbolId(file.repoRelativePath),
      declarations,
      imports: flow.imports,
      exports: evidence.exports,
      defaultExportNames: evidence.defaultExportNames,
      callSites: flow.callSites,
    },
  };
}

/** 只进清单的文件：有内容哈希与行数，没有符号，也不算解析缺口。 */
function inventoryOnlyFile(file: SourceFileNodeInput): AnalyzedFile {
  return {
    file: {
      ...file,
      parseStatus: 'skipped',
      parseErrors: [],
      metadata: { ...file.metadata, inventoryOnly: true },
    },
    symbols: [],
    diagnostics: [],
  };
}

function skippedFile(
  file: SourceFileNodeInput,
  code: 'large-file-skipped' | 'unsupported-language',
  message: string
): AnalyzedFile {
  return {
    file: {
      ...file,
      parseStatus: 'skipped',
      parseErrors: [{ message, severity: 'warning', code }],
    },
    symbols: [],
    diagnostics: [{ code, message, filePath: file.repoRelativePath }],
  };
}

function partialFile(file: SourceFileNodeInput, message: string): AnalyzedFile {
  return {
    file: {
      ...file,
      parseStatus: 'partial',
      parseErrors: [{ message, severity: 'warning', code: 'parser-timeout' }],
    },
    symbols: [
      createModuleSymbol({
        generationId: file.generationId,
        filePath: file.repoRelativePath,
        language: file.language ?? 'unknown',
        lineCount: 1,
      }),
    ],
    diagnostics: [{ code: 'parser-timeout', message, filePath: file.repoRelativePath }],
  };
}

function failedFile(file: SourceFileNodeInput, message: string): AnalyzedFile {
  return {
    file: {
      ...file,
      parseStatus: 'failed',
      parseErrors: [{ message, severity: 'error', code: 'parse-failed' }],
    },
    symbols: [],
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
    return file.parseStatus === 'parsed' || file.metadata.inventoryOnly === true
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

function countLines(content: string): number {
  return Math.max(1, content.split(/\r\n|\n|\r/).length);
}

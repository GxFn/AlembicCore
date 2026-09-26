import { projectSourceReaderIdentity } from '../../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import { extractFileFlowFromSource, getFileFlowUnavailableReason } from '../fileFlow/extract.js';
import type { FileSymbolsExtractionResult } from '../fileSymbols/contracts.js';
import { extractFileSymbolsFromSource } from '../fileSymbols/extract.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import type { SourceSliceFileFacts, SourceSliceFileIdentity } from '../sourceSlice/contracts.js';
import type { SourceSliceFileAccessResult } from '../sourceSlice/fileAccess.js';
import { readProjectContextAst } from './astFacts.js';
import type {
  ProjectContextFileAnalysis,
  ProjectContextSymbolExtractor,
} from './SymbolExtractor.js';

interface FileExtraction {
  symbols: FileSymbolsExtractionResult;
  flow?: FileFlowExtractionResult;
}

interface PendingFileExtraction {
  callSitesPrepared: boolean;
  promise: Promise<FileExtraction>;
}

/**
 * 一次查询/显式收集批次拥有一个会话。文件身份含完整 root 与逻辑 repo，缓存不跨会话；
 * 提取缓存以本会话实际读出的 facts 对象为键，不拿短 ref hash 当全局源码身份。
 * 会话只负责源码与 AST 缓存；manifest/目录/导入存在性由注入的 source reader 记录，
 * live 会话仍保持实时读取语义，只有认证捕获显式启用完整输入记录和离线重放。
 */
export class FileAnalysisSession {
  readonly #files = new Map<
    ProjectSourceReader,
    Map<string, Promise<SourceSliceFileAccessResult>>
  >();
  readonly #readers = new Set<ProjectSourceReader>();
  #extractions = new WeakMap<SourceSliceFileFacts, PendingFileExtraction>();
  #sourceVersions = new WeakMap<SourceSliceFileFacts, SourceSliceFileFacts>();

  constructor(
    private readonly includeCallSites: boolean,
    private readonly symbolExtractor?: ProjectContextSymbolExtractor
  ) {}

  useReader(reader: ProjectSourceReader): void {
    this.#readers.add(projectSourceReaderIdentity(reader));
  }
  assertInputsComplete(): void {
    for (const reader of this.#readers) {
      reader.assertComplete();
    }
  }

  async readSourceFile(
    identity: SourceSliceFileIdentity,
    read: () => Promise<SourceSliceFileAccessResult>,
    reader: ProjectSourceReader
  ): Promise<SourceSliceFileAccessResult> {
    const key = JSON.stringify([identity.projectRoot, identity.absolutePath, identity.repoId]);
    const readerIdentity = projectSourceReaderIdentity(reader);
    // 记录与重放是不同输入视图，不能在重放验证时偷偷沿用记录阶段已计算的事实。
    let files = this.#files.get(readerIdentity);
    if (!files) {
      files = new Map();
      this.#files.set(readerIdentity, files);
    }
    let pending = files.get(key);
    if (!pending) {
      pending = read();
      files.set(key, pending);
      const started = pending;
      // 取消不成为下一次请求的永久缓存错误；已成功读取的事实仍是本批固定版本。
      void pending.catch(() => {
        if (files.get(key) === started) {
          files.delete(key);
        }
      });
    }
    const result = await pending;
    if (!result.ok || result.facts.sourceFolder === identity.sourceFolder) {
      return result;
    }
    // sourceFolder 是引用的展示/导航范围，不是另一份源码。保持调用方的原始字段，
    // 但把投影视图关联到相同的已读字节版本；例如 capture 的 '.' 与 repo 的 undefined。
    const facts = { ...result.facts, sourceFolder: identity.sourceFolder };
    this.#sourceVersions.set(facts, result.facts);
    return { ok: true, facts };
  }

  async symbols(
    facts: SourceSliceFileFacts,
    context?: { signal?: AbortSignal }
  ): Promise<FileSymbolsExtractionResult> {
    throwIfProjectContextAborted(context);
    const entry = await this.extraction(facts, this.includeCallSites, context);
    throwIfProjectContextAborted(context);
    // 归一化输出会引用 range 等对象，不能让外层修改返回值污染后续查询的缓存。
    return structuredClone(entry.symbols);
  }

  async flow(
    facts: SourceSliceFileFacts,
    context?: { signal?: AbortSignal }
  ): Promise<FileFlowExtractionResult> {
    throwIfProjectContextAborted(context);
    const entry = await this.extraction(facts, true, context);
    throwIfProjectContextAborted(context);
    // extraction(true) 同时生成两种投影，即使 flow unavailable 也返回完整诊断形态。
    return structuredClone(entry.flow!);
  }

  dispose(): void {
    this.#files.clear();
    this.#readers.clear();
    this.#extractions = new WeakMap();
    this.#sourceVersions = new WeakMap();
  }

  private async extraction(
    facts: SourceSliceFileFacts,
    includeCalls: boolean,
    context?: { signal?: AbortSignal }
  ): Promise<FileExtraction> {
    throwIfProjectContextAborted(context);
    // 病态内容仍遵守既有 flow 防线；symbols 可继续走原有不提取调用点的 AST 路径。
    const sourceVersion = this.#sourceVersions.get(facts) ?? facts;
    let pending = this.#extractions.get(sourceVersion);
    if (!pending || (includeCalls && !pending.callSitesPrepared)) {
      if (pending) {
        Logger.debug('ProjectContext analysis expands from symbols to call sites', {
          projectRoot: facts.projectRoot,
          filePath: facts.filePath,
          reason: 'additional-analysis-mode-requested',
        });
      }
      // 先发布进行中的 promise，真实并发查询才能共享同一次异步后端调用。
      pending = {
        callSitesPrepared: includeCalls,
        promise: Promise.resolve().then(() => this.createExtraction(facts, includeCalls, context)),
      };
      this.#extractions.set(sourceVersion, pending);
    }
    try {
      const result = await pending.promise;
      throwIfProjectContextAborted(context);
      return result;
    } catch (error) {
      // 失败/取消不能污染下一次同文件请求；不删除另一个已开始的扩展模式。
      if (this.#extractions.get(sourceVersion) === pending) {
        this.#extractions.delete(sourceVersion);
      }
      throw error;
    }
  }

  private async createExtraction(
    facts: SourceSliceFileFacts,
    includeCalls: boolean,
    context?: { signal?: AbortSignal }
  ): Promise<FileExtraction> {
    throwIfProjectContextAborted(context);
    const includesCalls = includeCalls && !getFileFlowUnavailableReason(facts);
    const ast = readProjectContextAst(facts, includesCalls);
    const legacy = {
      symbols: extractFileSymbolsFromSource(facts, ast),
      flow: includeCalls ? extractFileFlowFromSource(facts, ast) : undefined,
    };
    const input = {
      text: facts.text,
      filePath: facts.filePath,
      language: facts.language,
      lineCount: facts.lineCount,
    };
    let extraction: ProjectContextFileAnalysis = legacy;
    // 后端只接收取消控制；运行时context还含reader/analysis，不能越过旧注入接口边界。
    const controls = context ? { signal: context.signal } : undefined;
    if (this.symbolExtractor?.analyzeFile) {
      // 同一个后端请求同时返回符号/调用观察，不为flow再打开或查询一次SDK。
      extraction = await this.symbolExtractor.analyzeFile(input, legacy, controls);
    } else if (this.symbolExtractor) {
      Logger.debug('ProjectContext uses a symbol-only extension with the existing flow producer', {
        filePath: facts.filePath,
        reason: 'symbol-extractor-compatibility',
      });
      extraction = {
        ...legacy,
        symbols: await this.symbolExtractor.extractSymbols(input, legacy.symbols, controls),
      };
    }
    throwIfProjectContextAborted(context);
    if (legacy.flow && !extraction.flow) {
      // 可选组合接口不能让缺失flow变成成功缓存或下游TypeError；保留已验证模块语法，明确缺失调用观察。
      const reason =
        'ProjectContext analysis backend did not return requested file-flow observations.';
      Logger.warn(reason, { filePath: facts.filePath });
      extraction = {
        ...extraction,
        flow: { ...legacy.flow, callSites: [], unavailableReason: reason },
      };
    }
    // 只缓存真实消费的紧凑投影；不把完整 AST 指标/模式摘要留在整个批次中。
    // 生产方也可能复用可变结果；缓存拥有独立投影，后端的后续修改不能重写已读事实。
    const compact: FileExtraction = {
      symbols: extraction.symbols,
      flow: extraction.flow
        ? {
            callSites: extraction.flow.callSites,
            imports: extraction.flow.imports,
            exports: extraction.flow.exports,
            unavailableReason: extraction.flow.unavailableReason,
          }
        : undefined,
    };
    return this.symbolExtractor ? structuredClone(compact) : compact;
  }
}

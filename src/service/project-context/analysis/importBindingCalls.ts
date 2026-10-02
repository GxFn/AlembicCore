import { readFileSyntaxEvidence } from '../../../core/facts/fileSyntaxEvidence.js';
import {
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from '../../../core/facts/parserLanguage.js';
import {
  linkImportBoundCallSites,
  MODULE_SOURCE_EXTENSIONS,
  type ModuleDeclarations,
  type ModuleGraphAccess,
} from '../../../core/linking/index.js';
import { nodeProjectSourceReader } from '../../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import { findModuleFile, moduleFileOutsideAnalysisScope } from '../fileFlow/moduleFile.js';
import { normalizeFileSymbols } from '../fileSymbols/normalize.js';
import type { ProjectContextHandlerExecutionContext } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { createProjectContextFileRef } from '../shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceFileFacts } from '../sourceSlice/contracts.js';
import { loadSourceSliceFile } from '../sourceSlice/fileAccess.js';

/**
 * 给 JS/TS 的调用点补上经 import 绑定证明的跨文件目标。说明符可以是相对路径、
 * tsconfig / jsconfig 的路径别名，或项目内另一个包的入口；项目外的包没有目标。
 *
 * 目标文件经同一个输入读取器按需读取：live 查询读当前文件，认证捕获读冻结字节并登记消费版本，
 * 重放时得到相同结果。只读真正被引用到的文件；认证捕获里只读清单内的文件——清单之外的源码
 * 不是这次分析的输入，指向它的调用保持未解析。
 * 非 JS 语言、没有 import 绑定证据的文件原样返回。
 */
export async function linkImportBoundCalls(
  facts: SourceSliceFileFacts,
  flow: FileFlowExtractionResult,
  context?: ProjectContextHandlerExecutionContext
): Promise<FileFlowExtractionResult> {
  if (flow.unavailableReason) {
    return flow;
  }
  const language = resolveAstParserLanguage(facts.filePath, facts.language);
  if (!language || !JS_FAMILY_LANGUAGES.has(language)) {
    return flow;
  }
  const hasRuntimeBinding = flow.imports.some((record) =>
    (record.bindings ?? []).some((binding) => !binding.typeOnly)
  );
  if (!hasRuntimeBinding || !flow.callSites.some((site) => site.calleeBindingRange)) {
    return flow;
  }
  throwIfProjectContextAborted(context);

  const reader = context?.sourceReader ?? nodeProjectSourceReader;
  const sources = new Map<string, Promise<SourceSliceFileFacts | undefined>>();
  const sourceOf = (filePath: string) => {
    let pending = sources.get(filePath);
    if (!pending) {
      pending = loadSourceSliceFile({
        filePath,
        projectRoot: facts.projectRoot,
        repoId: facts.repoId,
        sourceFolder: facts.sourceFolder,
        sourceReader: reader,
        signal: context?.signal,
        analysis: context?.analysis,
        onSourceFileVersion: context?.onSourceFileVersion,
        onSourceFileRead: context?.onSourceFileRead,
      }).then((result) => (result.ok ? result.facts : undefined));
      sources.set(filePath, pending);
    }
    return pending;
  };
  const access: ModuleGraphAccess = {
    async declarations(filePath): Promise<ModuleDeclarations | undefined> {
      const target = await sourceOf(filePath);
      if (!target) {
        return undefined;
      }
      const evidence =
        context?.analysis?.declarations(target, context) ?? readFileSyntaxEvidence(target, false);
      // 目标文件语法不可用时不给目标：声明事实不完整，不能当成"没有这个导出"之外的任何结论。
      return evidence.symbols.unavailableReason
        ? undefined
        : {
            symbols: evidence.symbols.symbols,
            exports: evidence.exports,
            defaultExportNames: evidence.defaultExportNames,
          };
    },
    async resolveModule(importerFile, specifier) {
      const found = await findModuleFile({
        importerFile,
        projectRoot: facts.projectRoot,
        specifier,
        extensions: MODULE_SOURCE_EXTENSIONS,
        reader,
        signal: context?.signal,
        analysis: context?.analysis,
      });
      if (found.status !== 'found') {
        return undefined;
      }
      // 链接要读目标文件的导出表；不属于这次分析源码的文件不读，调用保持未解析。
      const outside = moduleFileOutsideAnalysisScope(
        { projectRoot: facts.projectRoot, reader },
        found.filePath
      );
      if (outside) {
        Logger.debug('ProjectContext call linking left a module outside the analysis scope', {
          importerFile,
          specifier,
          target: found.filePath,
          reason: outside,
        });
        return undefined;
      }
      return { filePath: found.filePath };
    },
  };

  const targets = await linkImportBoundCallSites({
    filePath: facts.filePath,
    imports: flow.imports,
    callSites: flow.callSites,
    access,
  });
  throwIfProjectContextAborted(context);
  if (targets.length === 0) {
    return flow;
  }

  const callSites = [...flow.callSites];
  let resolved = 0;
  for (const target of targets) {
    const targetFacts = await sourceOf(target.filePath);
    if (!targetFacts) {
      continue;
    }
    // 目标引用按本次查询的导航范围投影；声明事实来自会话缓存，不能把缓存对象暴露给调用方修改。
    const summary = normalizeFileSymbols({
      facts: targetFacts,
      fileRef: createProjectContextFileRef(targetFacts),
      symbols: [structuredClone(target.symbol)],
    }).symbols[0];
    if (!summary) {
      continue;
    }
    callSites[target.index] = { ...callSites[target.index], resolvedTarget: summary };
    resolved += 1;
  }
  Logger.debug('ProjectContext linked import-bound call targets', {
    filePath: facts.filePath,
    resolved,
    observations: flow.callSites.length,
    reader: reader.mode,
  });
  return { ...flow, callSites };
}

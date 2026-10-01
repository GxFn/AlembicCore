import { JS_FAMILY_LANGUAGES, resolveAstParserLanguage } from '../../core/facts/parserLanguage.js';
import {
  type CodeGraphIdentity,
  CodeGraphProcess,
  type CodeGraphProcessOptions,
} from '../../infrastructure/analysis/CodeGraphProcess.js';
import type {
  CodeGraphInputReader,
  CodeGraphProjectInput,
  CodeGraphProjectResult,
} from '../../infrastructure/analysis/CodeGraphProjectContract.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { normalizeCodeGraphSymbols } from '../project-context/analysis/codeGraphSymbols.js';
import type {
  ProjectContextFileAnalysis,
  ProjectContextSymbolExtractor,
} from '../project-context/analysis/SymbolExtractor.js';
import { throwIfProjectContextAborted } from '../project-context/interface/execution.js';
import { normalizeCodeGraphFlow } from './CodeGraphFlow.js';

/** 内部共享的SDK提取作用域身份；不引入图存储或ProjectContext公开envelope。 */
export interface CodeGraphAnalysisRuntime extends CodeGraphIdentity {
  runtimeRoot: string;
}
export type CodeGraphProjectRunner = (
  input: CodeGraphProjectInput,
  context: { signal?: AbortSignal; readInput: CodeGraphInputReader }
) => Promise<CodeGraphProjectResult>;

/** 两个真实消费者共用进程/取消/重开规则，只接收已经读取并绑定版本的文本。 */
export async function withCodeGraphAnalysis<T>(
  options: CodeGraphProcessOptions,
  collect: (
    extractor: ProjectContextSymbolExtractor,
    runtime: CodeGraphAnalysisRuntime,
    project: CodeGraphProjectRunner
  ) => Promise<T>
): Promise<T> {
  const initial = await CodeGraphProcess.open(options);
  const runtime = { ...initial.identity, runtimeRoot: initial.runtimeRoot };
  let worker: CodeGraphProcess | undefined = initial;
  let opening: Promise<CodeGraphProcess> | undefined;
  let retiring = Promise.resolve();
  const acquire = async (): Promise<CodeGraphProcess> => {
    throwIfProjectContextAborted(options);
    await retiring;
    throwIfProjectContextAborted(options);
    if (worker) {
      return worker;
    }
    opening ??= CodeGraphProcess.open(options).then(async (next) => {
      if (next.identity.engineHash !== runtime.engineHash) {
        await next.close(true);
        throw Object.assign(new Error('CodeGraph runtime changed within the analysis scope.'), {
          code: 'CODEGRAPH_IDENTITY',
        });
      }
      worker = next;
      Logger.debug('CodeGraph scope reopened its worker after a completed shutdown', {
        engineHash: runtime.engineHash,
      });
      return next;
    });
    const pending = opening;
    try {
      return await pending;
    } finally {
      if (opening === pending) {
        opening = undefined;
      }
    }
  };
  const retire = async (failed: CodeGraphProcess): Promise<void> => {
    if (worker === failed) {
      worker = undefined;
      retiring = failed.close(true);
    }
    await failed.close(true);
  };
  const project: CodeGraphProjectRunner = async (input, context) => {
    for (let attempt = 0; ; attempt++) {
      const active = await acquire();
      try {
        return await active.analyzeProject(input, context.signal, context.readInput);
      } catch (error) {
        await retire(active);
        if (
          error instanceof Error &&
          error.name === 'AbortError' &&
          !options.signal?.aborted &&
          !context?.signal?.aborted &&
          attempt === 0
        ) {
          Logger.debug('CodeGraph retries captured project after sibling cancellation', {
            attempt: 1,
          });
          continue;
        }
        throw error;
      }
    }
  };
  const analyzeFile: NonNullable<ProjectContextSymbolExtractor['analyzeFile']> = async (
    input,
    legacy,
    context
  ) => {
    const unavailable = (reason: string): ProjectContextFileAnalysis => ({
      symbols: { symbols: [], unavailableReason: reason },
      ...(legacy.flow
        ? { flow: { ...legacy.flow, callSites: [], unavailableReason: reason } }
        : {}),
    });
    const language = resolveAstParserLanguage(input.filePath, input.language);
    if (!language || !JS_FAMILY_LANGUAGES.has(language)) {
      Logger.debug('CodeGraph session retains the existing language producer', {
        filePath: input.filePath,
        language,
        reason: 'outside-js-analysis-migration',
      });
      return legacy;
    }
    if (legacy.symbols.syntaxValid !== true || legacy.symbols.unavailableReason) {
      return unavailable(
        `CodeGraph syntax verification failed or is unavailable for ${input.filePath}.`
      );
    }
    if (legacy.symbols.syntaxFeatures?.length) {
      Logger.debug('CodeGraph symbol coverage is unavailable for a detected declaration form', {
        filePath: input.filePath,
        features: legacy.symbols.syntaxFeatures,
        sdkVersion: runtime.engine.sdkVersion,
      });
      return unavailable(
        `CodeGraph symbol coverage unavailable for ${input.filePath} (${legacy.symbols.syntaxFeatures.join(', ')}).`
      );
    }
    for (let attempt = 0; ; attempt += 1) {
      let active: CodeGraphProcess | undefined;
      try {
        active = await acquire();
        const extracted = await active.extract(input.filePath, input.text, context?.signal);
        return {
          symbols: normalizeCodeGraphSymbols(input, extracted, legacy.symbols),
          ...(legacy.flow ? { flow: normalizeCodeGraphFlow(input, extracted, legacy.flow) } : {}),
        };
      } catch (error) {
        // repo/request取消只终止该次进程；等待真实close后才允许健康owner的下一请求重开。
        if (active) {
          await retire(active);
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (!options.signal?.aborted && !context?.signal?.aborted && attempt === 0) {
            Logger.debug(
              'CodeGraph retries an un-cancelled request after another request cancelled the worker',
              { filePath: input.filePath, attempt: 1 }
            );
            continue;
          }
          throw error;
        }
        const code =
          error instanceof Error && 'code' in error ? String(error.code) : 'CODEGRAPH_FAILED';
        Logger.warn('CodeGraph file analysis unavailable', {
          filePath: input.filePath,
          code,
          reason: error instanceof Error ? error.message : String(error),
        });
        return unavailable(`CodeGraph analysis unavailable for ${input.filePath} (${code}).`);
      }
    }
  };
  const symbolExtractor: ProjectContextSymbolExtractor = {
    analyzeFile,
    async extractSymbols(input, legacy, context) {
      return (await analyzeFile(input, { symbols: legacy }, context)).symbols;
    },
  };
  // 统一接住callback同步抛错和异步失败，关闭真实worker后再向调用方传播。
  const outcome = await Promise.resolve()
    .then(() => collect(symbolExtractor, runtime, project))
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
  try {
    await retiring;
    if (opening) {
      await opening;
    }
    await worker?.close();
  } catch (error) {
    Logger.warn('CodeGraph worker cleanup failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    if (outcome.ok) {
      throw error;
    }
  }
  if (!outcome.ok) {
    throw outcome.error;
  }
  // 进程close本身也是异步阶段，关闭期间到达的owner取消同样不能发布成功。
  throwIfProjectContextAborted(options);
  return outcome.value;
}

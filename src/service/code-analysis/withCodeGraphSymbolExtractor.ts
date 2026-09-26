import {
  type CodeGraphIdentity,
  CodeGraphProcess,
  type CodeGraphProcessOptions,
} from '../../infrastructure/analysis/CodeGraphProcess.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { normalizeCodeGraphSymbols } from '../project-context/analysis/codeGraphSymbols.js';
import type { ProjectContextSymbolExtractor } from '../project-context/analysis/SymbolExtractor.js';
import { throwIfProjectContextAborted } from '../project-context/interface/execution.js';
import {
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from '../project-context/shared/parserLanguage.js';

/** 内部共享的SDK提取作用域身份；不引入图存储或ProjectContext公开envelope。 */
export interface CodeGraphSymbolRuntime extends CodeGraphIdentity {
  runtimeRoot: string;
}

/** 两个真实消费者共用进程/取消/重开规则，只接收已经读取并绑定版本的文本。 */
export async function withCodeGraphSymbolExtractor<T>(
  options: CodeGraphProcessOptions,
  collect: (extractor: ProjectContextSymbolExtractor, runtime: CodeGraphSymbolRuntime) => Promise<T>
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
  const symbolExtractor: ProjectContextSymbolExtractor = {
    async extractSymbols(input, legacy, context) {
      const language = resolveAstParserLanguage(input.filePath, input.language);
      if (!language || !JS_FAMILY_LANGUAGES.has(language)) {
        Logger.debug('CodeGraph session retains the existing language producer', {
          filePath: input.filePath,
          language,
          reason: 'outside-js-symbol-migration',
        });
        return legacy;
      }
      if (legacy.syntaxValid !== true || legacy.unavailableReason) {
        return {
          symbols: [],
          unavailableReason: `CodeGraph syntax verification failed or is unavailable for ${input.filePath}.`,
        };
      }
      if (legacy.syntaxFeatures?.length) {
        Logger.debug('CodeGraph symbol coverage is unavailable for a detected declaration form', {
          filePath: input.filePath,
          features: legacy.syntaxFeatures,
          sdkVersion: runtime.engine.sdkVersion,
        });
        return {
          symbols: [],
          unavailableReason: `CodeGraph symbol coverage unavailable for ${input.filePath} (${legacy.syntaxFeatures.join(', ')}).`,
        };
      }
      for (let attempt = 0; ; attempt += 1) {
        let active: CodeGraphProcess | undefined;
        try {
          active = await acquire();
          const extracted = await active.extract(input.filePath, input.text, context?.signal);
          return normalizeCodeGraphSymbols(input, extracted, legacy);
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
          Logger.warn('CodeGraph symbols unavailable', {
            filePath: input.filePath,
            code,
            reason: error instanceof Error ? error.message : String(error),
          });
          return {
            symbols: [],
            unavailableReason: `CodeGraph symbols unavailable for ${input.filePath} (${code}).`,
          };
        }
      }
    },
  };
  // 统一接住callback同步抛错和异步失败，关闭真实worker后再向调用方传播。
  const outcome = await Promise.resolve()
    .then(() => collect(symbolExtractor, runtime))
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

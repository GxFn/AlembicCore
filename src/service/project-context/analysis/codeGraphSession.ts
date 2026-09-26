import type { ProjectContext } from '../../../domain/project-context/index.js';
import {
  type CodeGraphIdentity,
  type CodeGraphProcessOptions,
  getCodeGraphProjectContextIdentity,
} from '../../../infrastructure/analysis/CodeGraphProcess.js';
import { withCodeGraphSymbolExtractor } from '../../code-analysis/withCodeGraphSymbolExtractor.js';
import { withProjectContextSession } from '../ProjectContextService.js';

export { getCodeGraphProjectContextIdentity };
export type CodeGraphProjectContextOptions = CodeGraphProcessOptions;
export interface CodeGraphProjectContextRuntime extends CodeGraphIdentity {
  /** 固定私有父目录；宿主在源码范围内时须把它显式加入inventory排除策略。 */
  runtimeRoot: string;
}

/** 公开ProjectContext装配保持不变；真实SDK资源作用域由内部共享leaf统一拥有。 */
export async function withCodeGraphProjectContextSession<T>(
  options: CodeGraphProjectContextOptions,
  collect: (context: ProjectContext, runtime: CodeGraphProjectContextRuntime) => Promise<T>
): Promise<T> {
  return withCodeGraphSymbolExtractor(options, (symbolExtractor, runtime) =>
    withProjectContextSession((context) => collect(context, runtime), {
      symbolExtractor,
      signal: options.signal,
    })
  );
}

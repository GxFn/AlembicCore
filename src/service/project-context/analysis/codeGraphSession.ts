import type { ProjectContext } from '../../../domain/project-context/index.js';
import {
  type CodeGraphIdentity,
  type CodeGraphProcessOptions,
  getCodeGraphProjectContextIdentity,
} from '../../../infrastructure/analysis/CodeGraphProcess.js';
import { normalizePrivateDirectories } from '../../../infrastructure/io/ProjectInputScope.js';
import { createCapturedCodeGraphCallResolver } from '../../code-analysis/CapturedCodeGraphCalls.js';
import { withCodeGraphAnalysis } from '../../code-analysis/withCodeGraphAnalysis.js';
import { withProjectContextSession } from '../ProjectContextService.js';
import { bindProjectCallResolver } from './projectCallResolver.js';

export { getCodeGraphProjectContextIdentity };
export interface CodeGraphProjectContextOptions extends CodeGraphProcessOptions {
  /** 宿主拥有的规范化绝对目录；仅排除SDK目录/Git发现，原始reader与显式源码清单保持完整。 */
  privateDirectories?: readonly string[];
}
export interface CodeGraphProjectContextRuntime extends CodeGraphIdentity {
  /** 固定私有父目录；宿主在源码范围内时须把它显式加入inventory排除策略。 */
  runtimeRoot: string;
}

/** 公开ProjectContext装配保持不变；真实SDK资源作用域由内部共享leaf统一拥有。 */
export async function withCodeGraphProjectContextSession<T>(
  options: CodeGraphProjectContextOptions,
  collect: (context: ProjectContext, runtime: CodeGraphProjectContextRuntime) => Promise<T>
): Promise<T> {
  const privateDirectories = normalizePrivateDirectories(options.privateDirectories);
  return withCodeGraphAnalysis(options, (symbolExtractor, runtime, project) => {
    bindProjectCallResolver(
      symbolExtractor,
      createCapturedCodeGraphCallResolver(project, runtime.runtimeRoot, privateDirectories)
    );
    return withProjectContextSession((context) => collect(context, runtime), {
      symbolExtractor,
      signal: options.signal,
    });
  });
}

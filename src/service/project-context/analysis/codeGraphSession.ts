import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectContext } from '../../../domain/project-context/index.js';
import {
  type AnalysisEngineIdentity,
  getAnalysisEngineIdentity,
} from '../../../infrastructure/analysis/AnalysisEngineIdentity.js';
import { codeGraphRuntimeRoot } from '../../../infrastructure/analysis/CodeGraphNativeIndex.js';
import { normalizePrivateDirectories } from '../../../infrastructure/io/ProjectInputScope.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import { withProjectContextSession } from '../ProjectContextService.js';
import { createStrictAnalysisBackend } from './strictAnalysisBackend.js';

/**
 * 严格分析会话的入口。名字里的 CodeGraph 来自早期实现：那时会话在子进程里用 CodeGraph SDK
 * 提取 JS/TS 符号并解析导入调用。现在会话的全部事实来自自有的文件事实与链接器，不启动任何进程；
 * CodeGraph 只在 SourceGraph 索引里作为外部链接来源使用。导出的名字与签名保持不变，宿主无需改动。
 */
export interface CodeGraphProjectContextOptions {
  /** 宿主的绝对私有数据目录；会话在它下面保留一个固定的私有运行目录。 */
  dataRoot: string;
  signal?: AbortSignal;
  /** @deprecated 会话不再启动外部进程，这个值不被使用。 */
  timeoutMs?: number;
  /** 宿主拥有的规范化绝对目录。会话只校验它们的形式；清单排除由宿主的盘点策略负责。 */
  privateDirectories?: readonly string[];
}

export interface CodeGraphProjectContextRuntime extends AnalysisEngineIdentity {
  /**
   * 固定的私有运行目录。索引接入外部引擎时会在这里建临时镜像；
   * 它位于源码范围内时，宿主须把它加入清单排除策略。
   */
  runtimeRoot: string;
}

/** 分析引擎身份；宿主用它做共享构建的缓存键与认证工件的 parserHash。 */
export function getCodeGraphProjectContextIdentity(): Promise<AnalysisEngineIdentity> {
  return getAnalysisEngineIdentity();
}

/**
 * 在严格分析会话里执行一批 ProjectContext 查询。与普通会话的区别只有一点：
 * JS/TS 文件的声明覆盖不完整时返回明确的不可用，而不是部分结果（见 strictAnalysisBackend）。
 */
export async function withCodeGraphProjectContextSession<T>(
  options: CodeGraphProjectContextOptions,
  collect: (context: ProjectContext, runtime: CodeGraphProjectContextRuntime) => Promise<T>
): Promise<T> {
  throwIfProjectContextAborted(options);
  if (typeof options.dataRoot !== 'string' || !path.isAbsolute(options.dataRoot)) {
    throw new TypeError('CodeGraph dataRoot must be an absolute runtime directory.');
  }
  normalizePrivateDirectories(options.privateDirectories);
  const identity = await getAnalysisEngineIdentity();
  const requestedRoot = codeGraphRuntimeRoot(options.dataRoot);
  await mkdir(requestedRoot, { recursive: true });
  // 用 canonical 路径：/var 与 /private/var 这类别名不能让宿主的私有目录排除失效。
  const runtime = { ...identity, runtimeRoot: await realpath(requestedRoot) };
  throwIfProjectContextAborted(options);
  const result = await withProjectContextSession((context) => collect(context, runtime), {
    symbolExtractor: createStrictAnalysisBackend(),
    signal: options.signal,
  });
  // 回调期间到达的 owner 取消同样不能发布成功。
  throwIfProjectContextAborted(options);
  return result;
}

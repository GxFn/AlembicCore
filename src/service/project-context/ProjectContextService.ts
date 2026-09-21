import type {
  ProjectContext as ProjectContextContract,
  ProjectContextEnvelope,
  ProjectContextRequest,
  ProjectContextResult,
} from '../../domain/project-context/index.js';
import { nodeProjectSourceReader } from '../../infrastructure/io/ProjectSourceReader.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import { FileAnalysisSession } from './analysis/FileAnalysisSession.js';
import { anchorRangeProjectContextHandler } from './anchorRange/index.js';
import { fileFlowProjectContextHandler } from './fileFlow/index.js';
import { fileSymbolsProjectContextHandler } from './fileSymbols/index.js';
import type {
  ProjectContextHandlerExecutionContext,
  ProjectContextHandlerRegistry,
} from './interface/contracts.js';
import { createProjectContext } from './interface/projectContext.js';
import { mapProjectContextHandler } from './map/index.js';
import { moduleProjectContextHandler } from './module/index.js';
import { moduleLayersProjectContextHandler } from './moduleLayers/index.js';
import { repoProjectContextHandler } from './repo/index.js';
import { sourceSliceProjectContextHandler } from './sourceSlice/index.js';
import { spaceProjectContextHandler } from './space/index.js';

export const PROJECT_CONTEXT_DEFAULT_HANDLERS: ProjectContextHandlerRegistry = {
  'anchor-range': anchorRangeProjectContextHandler,
  'file-flow': fileFlowProjectContextHandler,
  'file-symbols': fileSymbolsProjectContextHandler,
  map: mapProjectContextHandler,
  module: moduleProjectContextHandler,
  'module-layers': moduleLayersProjectContextHandler,
  repo: repoProjectContextHandler,
  'source-slice': sourceSliceProjectContextHandler,
  space: spaceProjectContextHandler,
};

// 能力标记只授予本模块装配的完整内置实现；任意注入executor不自动获得输入闭包保证。
const sourceReaderAwareContexts = new WeakSet<ProjectContextContract>();
export function supportsProjectContextSourceReader(context: ProjectContextContract): boolean {
  return sourceReaderAwareContexts.has(context);
}

export class ProjectContextService implements ProjectContextContract {
  private readonly projectContext: ProjectContextContract;

  constructor(
    handlers: ProjectContextHandlerRegistry = {},
    private readonly analysis?: FileAnalysisSession,
    private readonly sourceReader: ProjectSourceReader = nodeProjectSourceReader
  ) {
    this.projectContext = createProjectContext(handlers);
    if (handlers === PROJECT_CONTEXT_DEFAULT_HANDLERS) {
      sourceReaderAwareContexts.add(this);
    }
  }

  async execute(
    input: ProjectContextRequest,
    context?: ProjectContextHandlerExecutionContext
  ): Promise<ProjectContextEnvelope<ProjectContextResult>> {
    const analysis =
      this.analysis ??
      new FileAnalysisSession(input?.kind !== 'file-symbols' && input?.kind !== 'source-slice');
    const sourceReader = context?.sourceReader ?? this.sourceReader;
    analysis.useReader(sourceReader);
    const execution = { ...context, analysis, sourceReader };
    try {
      const result = await this.projectContext.execute(input, execution);
      sourceReader.assertComplete();
      return result;
    } finally {
      if (!this.analysis) {
        analysis.dispose();
      }
    }
  }
}

/**
 * 宿主的整批事实收集复用一份源码/提取结果，返回后释放；普通 execute 仍每次读取新版本。
 * 同批 execute 按接收顺序执行，避免某个请求的 AbortSignal 取消另一请求共享的在途 IO。
 * finally 排空已接收请求，拒绝会话退出后的新请求；不把会话隐式挂到调用方 controls 上。
 */
export async function withProjectContextSession<T>(
  collect: (projectContext: ProjectContextContract) => Promise<T>,
  options: { sourceReader?: ProjectSourceReader } = {}
): Promise<T> {
  const analysis = new FileAnalysisSession(true);
  const service = new ProjectContextService(
    PROJECT_CONTEXT_DEFAULT_HANDLERS,
    analysis,
    options.sourceReader
  );
  let tail = Promise.resolve();
  let closed = false;
  const projectContext: ProjectContextContract = {
    execute(input, context) {
      if (closed) {
        return Promise.reject(new Error('ProjectContext analysis session is closed.'));
      }
      const pending = tail.then(() => service.execute(input, context));
      tail = pending.then(
        () => undefined,
        () => undefined
      );
      return pending;
    },
  };
  sourceReaderAwareContexts.add(projectContext);
  let failed = false;
  try {
    return await collect(projectContext);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    closed = true;
    await tail;
    try {
      // 已失败的回调保留原始错误语义（如 capture 的 retryable drift）；
      // 只有正常返回才再检查锁存，阻止调用方 catch 后把不完整输入当成成功。
      if (!failed) {
        analysis.assertInputsComplete();
      }
    } finally {
      analysis.dispose();
    }
  }
}

export const ProjectContext: ProjectContextContract = new ProjectContextService(
  PROJECT_CONTEXT_DEFAULT_HANDLERS
);

/**
 * @module DiscovererRegistry
 * @description 注册所有 Discoverer 实现，按项目根目录自动选择最佳匹配。
 *
 * 检测顺序：按 confidence 降序。多个匹配时取最高 confidence。
 * 若全部未命中，回退到 GenericDiscoverer（目录扫描兜底）。
 *
 * 支持用户偏好持久化: 当匹配模糊时，保存/加载用户选择。
 */

import { ProjectSourceInputUncapturedError } from '../../infrastructure/io/ProjectInputSnapshot.js';
import { nodeProjectSourceReader } from '../../infrastructure/io/ProjectSourceReader.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import type { ConflictResult, DetectMatch } from './DiscovererPreference.js';
import { detectConflict, loadProjectDiscovererPreference } from './DiscovererPreference.js';
import { withDiscovererSession } from './DiscovererSession.js';
import {
  type ProjectDiscoverer,
  type ProjectDiscoveryExecutionContext,
  throwIfProjectDiscoveryAborted,
} from './ProjectDiscoverer.js';

type DiscovererFactory = (context?: ProjectDiscoveryExecutionContext) => ProjectDiscoverer;

export class DiscovererRegistry {
  #discoverers: ProjectDiscoverer[] = [];
  #sessionFactories = new WeakMap<ProjectDiscoverer, DiscovererFactory>();
  #pendingDetections = new Set<Promise<unknown>>();
  #isSession = false;
  #sessionContext?: ProjectDiscoveryExecutionContext;

  /**
   * 注册一个 Discoverer 实现。可选工厂显式创建请求独立实例；不推测构造参数或复制私有字段。
   * @returns this 支持链式调用
   */
  register(discoverer: ProjectDiscoverer, createSession?: DiscovererFactory) {
    const reader = this.#sessionContext?.sourceReader;
    if (this.#isSession && reader && reader.mode !== 'live') {
      // 严格会话的注册集合在入口已确认，不能在读取途中追加一个可能仍绑定 live 的对象。
      rejectSourceReader(reader, 'discoverer-session-registration', discoverer.id);
    }
    this.#discoverers.push(discoverer);
    if (createSession) {
      this.#sessionFactories.set(discoverer, createSession);
    }
    return this;
  }

  /**
   * 在一个会话内完成检测、加载及读取；回调应返回已投影的值，不把 discoverer 留给异步调用。
   * 旧 register(instance) 保留对象身份并串行使用，内置工厂实例可并发服务不同项目。
   */
  async withSession<T>(
    read: (registry: DiscovererRegistry) => Promise<T>,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<T> {
    const resolvedContext = this.#resolveContext(context);
    // 绑定本次输入值，不保留调用者可复用/修改的 controls 对象。
    context = resolvedContext ? { ...resolvedContext } : undefined;
    throwIfProjectDiscoveryAborted(context);
    const reader = context?.sourceReader ?? nodeProjectSourceReader;
    const strict = reader.mode !== 'live';
    const registrations = this.#discoverers.map((discoverer) => ({
      discoverer,
      factory: this.#sessionFactories.get(discoverer),
    }));
    if (strict) {
      for (const { discoverer, factory } of registrations) {
        if (!factory) {
          // supportsSourceReader 不能证明旧实例绑定了本次 reader；必须由显式工厂重新装配。
          rejectSourceReader(reader, 'discoverer-factory-required', discoverer.id);
        }
      }
    }
    return withDiscovererSession(
      registrations.filter(({ factory }) => !factory).map(({ discoverer }) => discoverer),
      async () => {
        const session = new DiscovererRegistry();
        for (const { discoverer, factory } of registrations) {
          let instance: ProjectDiscoverer;
          try {
            instance = factory ? factory(context) : discoverer;
          } catch (error) {
            if (
              error instanceof Error &&
              'code' in error &&
              error.code === 'PROJECT_SOURCE_INPUT_UNCAPTURED'
            ) {
              reader.invalidate(error);
            }
            throw error;
          }
          if (strict && instance?.supportsSourceReader !== true) {
            rejectSourceReader(reader, 'discoverer-reader-unsupported', discoverer.id);
          }
          session.register(instance);
        }
        session.#isSession = true;
        session.#sessionContext = context;
        try {
          return await read(session);
        } finally {
          // Promise.all 可以先报取消；旧扩展中仍未结束的 detect 必须完成后才能释放对象。
          await Promise.all(session.#pendingDetections);
          reader.assertComplete();
        }
      },
      context
    );
  }

  /** 自动检测项目类型，返回最佳 Discoverer */
  async detect(
    projectRoot: string,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<ProjectDiscoverer> {
    context = this.#resolveContext(context);
    if (!this.#isSession && context?.sourceReader) {
      return this.withSession((session) => session.detect(projectRoot, context), context);
    }
    const results = await this.#detectAll(projectRoot, context);

    const matched = results
      .filter((r) => r.result.match)
      .sort((a, b) => b.result.confidence - a.result.confidence);

    if (matched.length > 0) {
      return matched[0].discoverer;
    }

    // 回退到 GenericDiscoverer
    const generic = this.#discoverers.find((d) => d.id === 'generic');
    if (generic) {
      return generic;
    }

    throw new Error('No Discoverer matched and no GenericDiscoverer registered');
  }

  /**
   * 检测所有匹配的 Discoverer（用于混合项目）
   * 若存在用户偏好，将偏好 Discoverer 提升到首位。
   * @returns 按 confidence 降序排列的匹配结果（偏好优先）
   */
  async detectAll(
    projectRoot: string,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<{ discoverer: ProjectDiscoverer; confidence: number }[]> {
    context = this.#resolveContext(context);
    if (!this.#isSession && context?.sourceReader) {
      return this.withSession((session) => session.detectAll(projectRoot, context), context);
    }
    const results = await this.#detectAll(projectRoot, context);

    const matched = results
      .filter((r) => r.result.match)
      .sort((a, b) => b.result.confidence - a.result.confidence)
      .map((r) => ({ discoverer: r.discoverer, confidence: r.result.confidence }));

    const preference = await loadProjectDiscovererPreference(projectRoot, context?.sourceReader);
    throwIfProjectDiscoveryAborted(context);
    if (preference?.userConfirmed) {
      const prefIdx = matched.findIndex((m) => m.discoverer.id === preference.selectedDiscoverer);
      if (prefIdx > 0) {
        const [preferred] = matched.splice(prefIdx, 1);
        matched.unshift(preferred);
      }
    }

    return matched;
  }

  /**
   * 分析检测结果的冲突/模糊性
   * @returns 冲突分析结果，含 ambiguous 标记和推荐
   */
  async analyzeConflict(
    projectRoot: string,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<ConflictResult> {
    context = this.#resolveContext(context);
    if (!this.#isSession && context?.sourceReader) {
      return this.withSession((session) => session.analyzeConflict(projectRoot, context), context);
    }
    const results = await this.#detectAll(projectRoot, context);

    const matches: DetectMatch[] = results
      .filter((r) => r.result.match)
      .sort((a, b) => b.result.confidence - a.result.confidence)
      .map((r) => ({
        discovererId: r.discoverer.id,
        displayName: r.discoverer.displayName,
        confidence: r.result.confidence,
      }));

    const preference = await loadProjectDiscovererPreference(projectRoot, context?.sourceReader);
    throwIfProjectDiscoveryAborted(context);
    if (preference?.userConfirmed) {
      return { ambiguous: false, matches, recommended: matches[0] };
    }

    return detectConflict(matches);
  }

  /** 获取所有已注册的 Discoverer */
  getAll() {
    return [...this.#discoverers];
  }

  #resolveContext(
    context?: ProjectDiscoveryExecutionContext
  ): ProjectDiscoveryExecutionContext | undefined {
    if (!this.#isSession) {
      return context;
    }
    const reader = this.#sessionContext?.sourceReader ?? nodeProjectSourceReader;
    if (context?.sourceReader && context.sourceReader !== reader) {
      const error = new ProjectSourceInputUncapturedError('discoverer-reader-mismatch', 'session');
      // 两侧都记录非法切换，调用方即便捕获普通查询异常也不能发布完整事实。
      reader.invalidate(error);
      context.sourceReader.invalidate(error);
      throw error;
    }
    return {
      ...this.#sessionContext,
      sourceReader: reader,
      signal: context?.signal ?? this.#sessionContext?.signal,
    };
  }

  #detectAll(projectRoot: string, context?: ProjectDiscoveryExecutionContext) {
    const work = this.#discoverers.map(async (discoverer) => ({
      discoverer,
      result: await detectWithCancellation(discoverer, projectRoot, context),
    }));
    // 对外保留 Promise.all 的既有错误语义，会话只用 allSettled 等待剩余 worker 收尾。
    const settled = Promise.allSettled(work);
    this.#pendingDetections.add(settled);
    void settled.then(() => {
      this.#pendingDetections.delete(settled);
    });
    return Promise.all(work);
  }
}

function rejectSourceReader(
  reader: ProjectSourceReader,
  operation: string,
  discovererId: string
): never {
  const error = new ProjectSourceInputUncapturedError(operation, discovererId);
  reader.invalidate(error);
  throw error;
}

async function detectWithCancellation(
  discoverer: ProjectDiscoverer,
  projectRoot: string,
  context?: ProjectDiscoveryExecutionContext
): Promise<{ match: boolean; confidence: number; reason: string }> {
  throwIfProjectDiscoveryAborted(context);
  try {
    const result = await discoverer.detect(projectRoot, context);
    throwIfProjectDiscoveryAborted(context);
    return result;
  } catch (_error) {
    if (context?.signal?.aborted) {
      throwIfProjectDiscoveryAborted(context);
    }
    return { confidence: 0, match: false, reason: 'detect error' };
  }
}

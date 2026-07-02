/**
 * RecipePipelineEvents — 生成链进度事件名的 wire 契约单源(C-5 最小件,2026-07-02 统一重构)。
 *
 * 这些字符串是跨进程 wire 契约:主体 BootstrapEventEmitter(Socket.io→Dashboard
 * useBootstrapSocket)与宿主 Plugin BootstrapEventEmitter(EventBus/TaskManager)两边
 * 硬编码同一组事件名,共 44 处(五仓)。收单源后:
 *   - 事件名漂移(一边改名一边不知道)从此编译期可见;
 *   - S4 概念层重命名时,本对象就是事件部分的 wire 冻结表——`bootstrap:` 前缀是
 *     已发布 wire 名,保留不改;概念层新名(Generate)只改代码符号与日志。
 * 完整 payload 类型契约(两 emitter 的 union 骨架统一)随 S4 词族批次一起 Core 化,
 * 避免对同一文件的两次搬迁。
 */
export const RECIPE_PIPELINE_EVENTS = {
  /** 生成会话启动 */
  started: 'bootstrap:started',
  /** 单维度任务开始 */
  taskStarted: 'bootstrap:task-started',
  /** 单维度任务完成(正常终态) */
  taskCompleted: 'bootstrap:task-completed',
  /** 单维度任务失败(error/timeout/blocked/degraded 等非正常终态) */
  taskFailed: 'bootstrap:task-failed',
  /** 全部维度完成 */
  allCompleted: 'bootstrap:all-completed',
  /** daemon job process 事件草稿桥(主体专属;Plugin 无 DaemonJobRunner 消费方) */
  processEvents: 'bootstrap:process-events',
  /** AI provider 不可用 */
  aiUnavailable: 'bootstrap:ai-unavailable',
} as const;

export type RecipePipelineEventName =
  (typeof RECIPE_PIPELINE_EVENTS)[keyof typeof RECIPE_PIPELINE_EVENTS];

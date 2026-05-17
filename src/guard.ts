import type { SignalBus } from './events.js';
import type { GuardKnowledgeRepo } from './search.js';
import { GuardCheckEngine } from './service/guard/GuardCheckEngine.js';

export * from './service/guard/index.js';

export interface GuardDatabaseLike {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown>;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  exec?(sql: string): void;
}

export interface GuardRuleOverride {
  severity?: string;
  exclude?: string[];
}

export interface GuardConfig {
  disabledRules?: string[];
  codeLevelThresholds?: Record<string, number | GuardRuleOverride>;
}

export interface CreateGuardCheckEngineOptions {
  cacheTTL?: number;
  guardConfig?: GuardConfig;
  signalBus?: SignalBus;
  knowledgeRepo?: GuardKnowledgeRepo;
}

export type GuardCheckEngineDatabase = GuardDatabaseLike | { getDb(): GuardDatabaseLike } | null;

/**
 * 创建 Guard 检查引擎。
 *
 * Core 只稳定规则检查、跨文件检查、报告和 ReverseGuard 闭环；MCP tool
 * schema、CLI 参数、Codex 输出格式继续由外层 adapter 包装。
 */
export function createGuardCheckEngine(
  db: GuardCheckEngineDatabase,
  options: CreateGuardCheckEngineOptions = {}
): GuardCheckEngine {
  return new GuardCheckEngine(
    db as unknown as ConstructorParameters<typeof GuardCheckEngine>[0],
    options as unknown as ConstructorParameters<typeof GuardCheckEngine>[1]
  );
}

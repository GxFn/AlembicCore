/**
 * Strict production authority public facade.
 *
 * Agent 与 Main 通过这个稳定子路径共享同一组事实、分析、持久化和恢复合同；外层不应 deep
 * import `src/service/production/**`，也不应复制这些 canonicalizer。
 */
export * from './service/production/ProductionActorIdentity.js';
export * from './service/production/ProductionPersistenceContracts.js';
export * from './service/production/StrictAnalysisContracts.js';
export * from './service/production/StrictFactExecution.js';
export * from './service/production/StrictProductionAuthority.js';

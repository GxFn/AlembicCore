/**
 * W3 词族统一:sustain 域 facade 本体迁至 src/sustain.ts。
 * '@alembic/core/evolution' 是 wire 冻结入口(docs/wire-contract.md),本文件整体转发,
 * 导出集合与 sustain.ts 恒等;外层迁移到 '@alembic/core/sustain' 后本 shim 方可评估退役。
 */
export * from './sustain.js';

/**
 * 015 — Coverage ledger（deepMining 多轮覆盖账本，U2a）。
 *
 * coverage_ledger 持久化「覆盖状态」（per module×dimension cell 的 grade/exhausted/价值/覆盖证据），
 * 是 deepMining（长广度）与 evolution（保准确）的唯一协作接口。
 * **红线：这是覆盖状态持久化、不是 plan/session 持久化**——plan 仍每轮无状态 draft→confirm；
 * 本表刻意不含任何 plan/session 字段。
 *
 * deep_mining_rounds 记每轮边际产出（new_recipes_this_round / last round），
 * 供 CoverageLedgerAdvisor 判「收益递减（<K）/ 轮次上限（≥maxRounds）」停止。
 *
 * 文件名自动发现（无 index 注册改动）；幂等 CREATE TABLE IF NOT EXISTS。
 */
type MigrationDb = {
  exec(sql: string): void;
};

export default function migrate(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_root TEXT NOT NULL,
      module_id TEXT NOT NULL,
      dimension_id TEXT NOT NULL,
      covered_count INTEGER NOT NULL DEFAULT 0,
      total_candidate_count INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'empty',
      exhausted INTEGER NOT NULL DEFAULT 0,
      exhausted_reason TEXT,
      exhausted_source TEXT,
      covered_source_refs TEXT,
      uncovered_hints TEXT,
      value_score REAL,
      last_round INTEGER,
      deferred INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS coverage_ledger_cell_unique
      ON coverage_ledger(project_root, module_id, dimension_id);
    CREATE INDEX IF NOT EXISTS idx_coverage_ledger_project
      ON coverage_ledger(project_root);
    CREATE INDEX IF NOT EXISTS idx_coverage_ledger_module
      ON coverage_ledger(project_root, module_id);

    CREATE TABLE IF NOT EXISTS deep_mining_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_root TEXT NOT NULL,
      round_index INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      new_recipes_this_round INTEGER NOT NULL DEFAULT 0,
      trigger_actor TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS deep_mining_rounds_unique
      ON deep_mining_rounds(project_root, round_index);
    CREATE INDEX IF NOT EXISTS idx_deep_mining_rounds_project
      ON deep_mining_rounds(project_root);
  `);
}

/**
 * 016 — deep_mining_rounds 增 rescan_id（RF-3）。
 *
 * rescan_id 是宿主发起 alembic_rescan 的幂等/对账键；它只标识一次
 * rescan 运行，不引入计划或会话字段。既有 015 DB 保持 round_index
 * 唯一行为，新增的 partial unique index 只约束非空 rescan_id：
 * 旧调用未传 rescan_id 时仍可按 project_root+round_index 更新。
 */
type MigrationDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
};

export default function migrate(db: MigrationDb): void {
  const columns = db.prepare("PRAGMA table_info('deep_mining_rounds')").all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('rescan_id')) {
    db.exec('ALTER TABLE deep_mining_rounds ADD COLUMN rescan_id TEXT');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS deep_mining_rounds_rescan_unique
      ON deep_mining_rounds(project_root, rescan_id)
      WHERE rescan_id IS NOT NULL;
  `);
}

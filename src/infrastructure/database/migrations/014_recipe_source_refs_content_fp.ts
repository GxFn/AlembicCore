/**
 * Migration 014 — recipe_source_refs 增 content_fp 列（U6 内容级保鲜）
 *
 * content_fp = 源文件 region 内容指纹（独立于 .md 的 computeKnowledgeHash）。
 *   - 可空：迁移后全为 NULL，由 SourceRefReconciler 首轮 reconcile 回填。
 *   - CG⑥a：首填 null→只回填 content_fp 不改 status（否则首次升级全量误判 drifted）。
 *   - drift = content_fp 变化 → status='drifted'，由下游 P3 gate 决 update/deprecate。
 *
 * 幂等：先查 PRAGMA table_info，缺列才 ALTER（仿 migration 011_guard_violations_attribution）。
 * 仅加列、不改既有列/索引/约束，对既有行字节兼容。
 */
type MigrationDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
};

export default function migrate(db: MigrationDb): void {
  const columns = db.prepare("PRAGMA table_info('recipe_source_refs')").all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('content_fp')) {
    db.exec('ALTER TABLE recipe_source_refs ADD COLUMN content_fp TEXT');
  }
}

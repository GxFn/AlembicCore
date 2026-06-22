/**
 * 013 — Durable git diff checkpoint ledger.
 *
 * Checkpoints are keyed by the rescan scope that owns a git-diff route:
 * projectRoot + scopeId + folderId. The checkpoint commit is initialized from
 * the active confirmed Plan instead of guessing HEAD^, then advanced only after
 * the caller confirms a successful route or catch-up route.
 */

type MigrationDb = {
  exec(sql: string): void;
};

export default function migrate(db: MigrationDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_diff_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_root TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      checkpoint_commit TEXT,
      initial_from_plan_commit TEXT,
      merge_base_commit TEXT,
      target_commit TEXT,
      last_route_status TEXT NOT NULL DEFAULT 'initialized',
      last_route_reason TEXT,
      last_scanned_at INTEGER,
      advanced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS git_diff_checkpoints_scope_unique
      ON git_diff_checkpoints(project_root, scope_id, folder_id);
    CREATE INDEX IF NOT EXISTS idx_git_diff_checkpoints_project
      ON git_diff_checkpoints(project_root);
    CREATE INDEX IF NOT EXISTS idx_git_diff_checkpoints_updated_at
      ON git_diff_checkpoints(updated_at);
  `);
}

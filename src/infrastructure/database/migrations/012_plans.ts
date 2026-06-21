/**
 * 012 — Plan intent ledger.
 *
 * Plan rows persist only intent and confirmation metadata. Runtime generation
 * state stays projected from knowledge_entries, recipe_source_refs,
 * evolution_proposals, and lifecycle_transition_events at read time.
 */

type MigrationDb = {
  exec(sql: string): void;
};

export default function migrate(db: MigrationDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      project_root TEXT NOT NULL,
      project_context_signature TEXT NOT NULL,
      last_updated_from_commit TEXT,
      created_by TEXT NOT NULL DEFAULT 'agent',
      confirmed_by TEXT,
      confirmed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      supersedes_plan_id TEXT,
      intent_json TEXT NOT NULL DEFAULT '{}',
      planning_brief_json TEXT,
      rationale_json TEXT NOT NULL DEFAULT '[]',
      change_log_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS plans_plan_version_unique
      ON plans(plan_id, version);
    CREATE INDEX IF NOT EXISTS idx_plans_project_status
      ON plans(project_root, status);
    CREATE INDEX IF NOT EXISTS idx_plans_updated_at
      ON plans(updated_at);
  `);
}

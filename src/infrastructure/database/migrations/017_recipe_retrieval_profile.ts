/**
 * 017 — persist canonical Recipe retrieval inputs.
 *
 * usageGuide already exists in the domain and Markdown contract but was never
 * represented in SQLite. retrievalProfile is the authored, evidence-backed
 * retrieval projection source. Both columns are additive and nullable/defaulted
 * so legacy Recipe rows remain readable without fabricating profile facts.
 */
type MigrationDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
};

export default function migrate(db: MigrationDb): void {
  const columns = db.prepare("PRAGMA table_info('knowledge_entries')").all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('usageGuide')) {
    db.exec("ALTER TABLE knowledge_entries ADD COLUMN usageGuide TEXT DEFAULT ''");
  }
  if (!names.has('retrievalProfile')) {
    db.exec('ALTER TABLE knowledge_entries ADD COLUMN retrievalProfile TEXT');
  }
}

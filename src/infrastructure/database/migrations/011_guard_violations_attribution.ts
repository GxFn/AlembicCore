/**
 * 011 — guard_violations writer attribution (Train A, misuse-harvest S2).
 *
 * The store had NO column recording which tool/surface wrote a row; the
 * only discriminator was an inconsistent summary prefix ("guard review
 * round 2" vs "Guard file check" vs "Rescan scan"). Rows become
 * attributable via two nullable columns; existing rows stay readable
 * with NULL attribution.
 */

type MigrationDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
};

export default function migrate(db: MigrationDb) {
  const columns = db.prepare("PRAGMA table_info('guard_violations')").all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('tool')) {
    db.exec('ALTER TABLE guard_violations ADD COLUMN tool TEXT');
  }
  if (!names.has('surface')) {
    db.exec('ALTER TABLE guard_violations ADD COLUMN surface TEXT');
  }
}

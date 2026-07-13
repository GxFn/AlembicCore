/**
 * DiagnosticCodes — stable diagnostic reason codes (CO3).
 *
 * Every runtime fallback / degradation / divergence that CO3 made visible
 * carries one of these codes in its log entry, diagnostic event payload, or
 * response meta. The codes are a stable observability contract: consumers
 * (Dashboard, Plugin bridge, log tooling) may match on them; renaming a code
 * is a breaking observability change and needs the same review as an API
 * rename. Codes follow `core.diagnostic.<area>.<condition>`.
 *
 * @module shared/DiagnosticCodes
 */

export const CORE_DIAGNOSTIC_CODES = {
  /** W2: .md files persisted but the DB transaction failed (file/DB divergence). */
  knowledgeFileDbDivergence: 'core.diagnostic.knowledge.file-db-divergence',
  /** R1: search index built without the knowledge table — results are degraded, not empty-by-accident. */
  searchIndexTableMissing: 'core.diagnostic.search.index-table-missing',
  /** R2: feedback store could not be read — collector starts with an empty, usable event list. */
  feedbackLoadFailed: 'core.diagnostic.feedback.load-failed',
  /** Feedback legacy-path migration failed — startup continues with the new path only. */
  feedbackMigrateFailed: 'core.diagnostic.feedback.migrate-failed',
  /** V1: an orphan vector could not be removed during reconcile. */
  vectorOrphanRemoveFailed: 'core.diagnostic.vector.orphan-remove-failed',
  /** V1: reconcile could not read knowledge entries (missing table / DB unavailable). */
  vectorReconcileDbUnavailable: 'core.diagnostic.vector.reconcile-db-unavailable',
  /** V1: reconcile aborted on an unexpected error; partial counts are in the result. */
  vectorReconcileFailed: 'core.diagnostic.vector.reconcile-failed',
  /** V1: a queued vector removal failed during batch processing. */
  vectorBatchRemoveFailed: 'core.diagnostic.vector.batch-remove-failed',
  /** Terminal Recipe truth could not be removed from every storage generation. */
  vectorRecipeTruthRemoveFailed: 'core.diagnostic.vector.recipe-truth-remove-failed',
  /** C6: similarity recipe walk stopped at the depth limit — results may be partial. */
  similarityWalkTruncated: 'core.diagnostic.similarity.walk-truncated',
  /** C7: a SQLite operation failed with SQLITE_BUSY despite busy_timeout (contention evidence). */
  sqliteBusy: 'core.diagnostic.db.sqlite-busy',
  /** AD5: a signal window hit its ring cap — oldest entries dropped; aggregates cover the capped window. */
  signalWindowOverflow: 'core.diagnostic.signal.window-overflow',
  /** C8: a timer or disposable was registered after TimerRegistry.dispose() — it will not be cleaned up. */
  timerPostDisposeRegistration: 'core.diagnostic.timer.post-dispose-registration',
  /** H1: recipes classified into dimensions outside the active set — skipped from radar counts instead of crashing. */
  dimensionClassificationMismatch: 'core.diagnostic.dimension.classification-mismatch',
} as const;

export type CoreDiagnosticCode = (typeof CORE_DIAGNOSTIC_CODES)[keyof typeof CORE_DIAGNOSTIC_CODES];

// Public entry for @alembic/core/report (RIC-2a / R2) — a narrow high-level
// facade over the report store. Outer repos (signals modules + signal HTTP
// routes) import the report TYPES from here instead of the low-level
// @alembic/core/infrastructure/report subpath. ReportStore INSTANCES keep
// flowing through DI (infra wiring, unchanged); this facade only narrows the
// type surface for read consumers.
//
// Report data is neither project structure (ProjectContext) nor recipe data
// (RecipeContext), so per §A=a's "or a clear high-level facade" branch it gets
// its own minimal surface. Read-only by intent: ReportReader exposes query/stats.

export type {
  ReportCategory,
  ReportEntry,
  ReportQueryOptions,
  ReportStore,
} from './infrastructure/report/index.js';

import type { ReportStore } from './infrastructure/report/index.js';

/** Narrow read-only view of the report store for query/stats consumers. */
export type ReportReader = Pick<ReportStore, 'query' | 'stats'>;

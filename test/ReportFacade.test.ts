// RIC-2a / R2 — the narrow @alembic/core/report facade. ReportReader is the
// read-only view (query/stats) outer signal consumers type against instead of
// importing the low-level @alembic/core/infrastructure/report subpath.

import { describe, expect, it } from 'vitest';
import type { ReportReader } from '../src/report.js';

describe('@alembic/core/report facade (RIC-2a/R2)', () => {
  it('ReportReader exposes a query/stats-only read surface satisfiable by consumers', () => {
    // Compile-time proof: a query/stats object satisfies ReportReader
    // (= Pick<ReportStore, 'query' | 'stats'>); no write/lifecycle leaks through.
    const reader: ReportReader = {
      query: async () => ({ reports: [], total: 0 }),
      stats: async () => ({}),
    };
    expect(typeof reader.query).toBe('function');
    expect(typeof reader.stats).toBe('function');
  });
});

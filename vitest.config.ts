import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    setupFiles: ['test/setup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      // Coverage RATCHET at the CO4-measured floors (P0 §6 ruling: ratchet
      // at measured, never aspirational — the previous 75/75/80/80 values
      // had never been runnable and never gated anything). Floors may never
      // go below these values; raises land with the wave that measures
      // them. Enforcement wiring into `npm run check` remains an open user
      // decision (TODO CO4-COVERAGE-ENFORCEMENT-DECISION); a `--coverage`
      // run is the regression report.
      thresholds: {
        branches: 38.06,
        functions: 49.74,
        lines: 45.95,
        statements: 45.5,
      },
    },
  },
});

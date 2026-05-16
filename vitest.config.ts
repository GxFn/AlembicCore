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
      thresholds: {
        branches: 75,
        functions: 75,
        lines: 80,
        statements: 80,
      },
    },
  },
});

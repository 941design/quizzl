import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      // v8 instrumentation — enabled with `--coverage` (see `make test-coverage`).
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: 'reports/coverage',
      // Measure the app source only; exclude test files, generated/static glue,
      // type-only modules, and config so the numbers reflect behavioural code.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/types.ts',
        'src/**/types.ts',
        'src/**/*.stories.*',
      ],
    },
  },
});

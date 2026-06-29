import { defineConfig } from 'vitest/config';

// The open-source test suite. Only the OSS tree (test/**) is run here; the private
// editor package under private/** has its own suite and is never part of the public
// mirror or the open-source test run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'out/**', 'private/**', 'viewer/**'],
  },
});

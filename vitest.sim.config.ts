import { defineConfig } from 'vitest/config';

/**
 * Fast suite: exercises the real compiled circuits in-process via
 * `@midnight-ntwrk/compact-runtime`. No Docker, no network, no proving.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/sim/**/*.test.ts'],
    testTimeout: 30_000,
    reporters: ['default'],
    sequence: { concurrent: false },
  },
});

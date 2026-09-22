import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

/**
 * End-to-end suite: deploys the compiled contract to a real network (a local
 * Docker devnet, Preview or Preprod), generates real zero-knowledge proofs
 * through a proof server, and drives a full auction.
 *
 * Requires `MIDNIGHT_NETWORK` (default `local`) and, for remote networks, a
 * funded wallet secret in a git-ignored `.env.<network>` file. Network secrets
 * are loaded from that file; the shell environment still wins.
 */

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const envFromFile = isRemote ? loadEnv(network, process.cwd(), '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/e2e/**/*.test.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    env: envFromFile,
    reporters: ['default'],
    sequence: { concurrent: false },
  },
});

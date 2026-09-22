// SPDX-License-Identifier: MIT
/**
 * CLI runner for the deployment workflow.
 *
 *   npm run deploy:local | deploy:preview | deploy:preprod
 *
 * The workflow itself lives in `src/deploy.ts` as an importable library so
 * tests can drive it; this file is the thin command-line entry point.
 */

import { deploySealedBid } from '../src/deploy.js';

deploySealedBid()
  .then((record) => {
    process.stdout.write(`\nDeployed SealedBid to ${record.network}: ${record.contractAddress}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`\nDeployment failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });

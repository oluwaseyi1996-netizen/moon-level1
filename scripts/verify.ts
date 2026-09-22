// SPDX-License-Identifier: MIT
/**
 * CLI runner for independent verification of a deployment.
 *
 *   npm run verify:local | verify:preview | verify:preprod
 *
 * The checks live in `src/verify.ts` as an importable library; this file is the
 * thin command-line entry point.
 */

import { verifySealedBid } from '../src/verify.js';

verifySealedBid()
  .then((result) => {
    process.stdout.write(
      `\n${result.verified ? 'VERIFIED' : 'NOT VERIFIED'} ` +
        `SealedBid @ ${result.contractAddress} on ${result.network}\n`,
    );
    if (!result.verified) process.exitCode = 1;
  })
  .catch((error: unknown) => {
    process.stderr.write(`\nVerification failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });

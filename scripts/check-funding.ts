// SPDX-License-Identifier: MIT
/**
 * Confirm a wallet holds NIGHT, read straight from the network indexer.
 *
 *   npm run check:preview -- mn_addr_preview1...
 *   npm run check:preprod  -- mn_addr_preprod1...
 *
 * The balance comes from the indexer's `unshieldedTransactions` subscription -
 * the same feed the wallet SDK syncs with - replayed for that address alone, so
 * the answer arrives in seconds instead of the 10-20 minutes a full sync of a
 * public network takes. The address is public data: no secret is needed, and no
 * faucet drip is attempted - this is a read-only check. Get the address with
 * scripts/derive-address.ts, from the faucet page, or from a deployment record.
 *
 * Exit codes: 0 funded, 1 not funded, 2 inconclusive.
 *
 * Env:
 *   FUNDING_CHECK_WAIT_MS     keep streaming until NIGHT arrives (default 0 = one-shot)
 *   FUNDING_CHECK_IDLE_MS     quiet period that finalises a one-shot answer (default 5000)
 *   FUNDING_CHECK_TIMEOUT_MS  overall budget (default 180000)
 */

import { getConfig } from '../src/config.js';
import {
  NIGHT_TOKEN_TYPE,
  readTipHeight,
  watchUnshieldedBalance,
  type UnshieldedBalance,
} from '../src/funding.js';
import { createLogger } from '../src/logger.js';

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got '${raw}'.`);
  }
  return value;
};

const waitMs = envInt('FUNDING_CHECK_WAIT_MS', 0);
const idleMs = envInt('FUNDING_CHECK_IDLE_MS', 5_000);
const timeoutMs = envInt('FUNDING_CHECK_TIMEOUT_MS', 180_000);

const formatTimestamp = (ms: number): string =>
  ms > 0 ? new Date(ms).toISOString() : 'timestamp unknown';

const config = getConfig();
const logger = createLogger('check-funding');

const address = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

if (!address) {
  logger.error(
    `No address given. Pass the one to check, e.g. ` +
      `\`npm run check:${config.name} -- mn_addr_${config.name}1...\`. ` +
      `scripts/derive-address.ts prints the configured wallet's address.`,
  );
  process.exit(2);
}

const tipHeight = await readTipHeight(config).catch((error: unknown) => {
  logger.warn(`Could not read the chain tip: ${error instanceof Error ? error.message : String(error)}`);
  return null;
});

// A bech32m address carries its network in the human-readable prefix, and the
// indexer rejects a mismatch inside the subscription: catch it before the
// confusing round trip. The prefix is everything before the final separator.
const addressPrefix = address.slice(0, address.lastIndexOf('1'));
const expectedPrefix = `mn_addr_${config.networkId}`;
if (addressPrefix.startsWith('mn_addr_') && addressPrefix !== expectedPrefix) {
  logger.warn(
    `Address prefix '${addressPrefix}' does not belong to '${config.name}' ` +
      `(expected '${expectedPrefix}'); the indexer will refuse it. ` +
      `Check the network, or pass the ${config.name} address instead.`,
  );
}

logger.info(`Network : ${config.name} (${config.networkId})`);
logger.info(`Indexer : ${config.indexer}`);
logger.info(`Address : ${address}`);
if (tipHeight !== null) logger.info(`Chain tip: ${tipHeight}`);
if (waitMs > 0) logger.info(`Waiting up to ${waitMs}ms for a NIGHT credit to land...`);

let result: UnshieldedBalance;
try {
  result = await watchUnshieldedBalance(config, address, {
    tipHeight,
    waitForFunding: waitMs > 0,
    idleMs,
    timeoutMs: waitMs > 0 ? waitMs : timeoutMs,
    onEvent: (event) => {
      if (event.kind !== 'transaction') return;
      for (const utxo of event.created) {
        if (utxo.owner !== address || utxo.tokenType !== NIGHT_TOKEN_TYPE) continue;
        logger.info(
          `+${utxo.value} NIGHT  tx=${event.transactionId} ${event.hash} @ ${formatTimestamp(event.timestamp)}`,
        );
      }
    },
  });
} catch (error) {
  logger.error(`COULD NOT READ ${address}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

logger.info(
  `Replayed ${result.transactionsSeen} unshielded transaction(s) for this address ` +
    `(highestTransactionId=${result.highestTransactionId})${result.caughtUp ? '' : ' - incomplete'}`,
);

if (result.balance > 0n) {
  logger.info(
    `FUNDED: ${address} holds ${result.balance} NIGHT in ${result.unspentOutputs} unspent output(s)`,
  );
  logger.info(
    `  credits=${result.credits.length} created=${result.created} spent=${result.spent}` +
      (result.tipHeight !== null ? ` tip=${result.tipHeight}` : ''),
  );
  if (!result.caughtUp) {
    logger.warn('The replay did not reach the indexer tip, so the balance is a lower bound.');
  }
} else if (result.caughtUp) {
  logger.warn(`NOT FUNDED: ${address} holds no NIGHT (history replayed to the indexer tip).`);
  logger.warn(
    `Fund it from ${config.faucetPage ?? 'the network faucet'} - the API drip is captcha-gated.`,
  );
  process.exitCode = 1;
} else {
  logger.error(
    `INCONCLUSIVE: the indexer did not finish replaying ${address} ` +
      `(timed out or disconnected after ${result.transactionsSeen} transaction(s)).`,
  );
  process.exitCode = 2;
}

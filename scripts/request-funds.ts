// SPDX-License-Identifier: MIT
/**
 * Print the configured wallet's address and request test tokens from the
 * network faucet.
 *
 *   MIDNIGHT_NETWORK=preview npx vite-node scripts/request-funds.ts
 *
 * Useful when a remote deploy fails because the wallet is empty: it derives the
 * exact address the faucet must fill, attempts the programmatic drip, then
 * reports the resulting NIGHT balance.
 */

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { waitForFunds } from '@midnight-ntwrk/testkit-js';

import { getConfig, resolveWalletSecret } from '../src/config.js';
import { ensureFunded, requestFaucetDrip, unshieldedAddress } from '../src/funding.js';
import { createLogger } from '../src/logger.js';
import { walletEnvironment } from '../src/providers.js';
import { buildWalletAndSync } from '../src/funding.js';

const config = getConfig();
const logger = createLogger('request-funds');
const env = walletEnvironment(config);

setNetworkId(config.networkId);

const wallet = await buildWalletAndSync(logger, env, resolveWalletSecret(config));
try {
  const address = unshieldedAddress(wallet);
  logger.info(`Network          : ${config.name} (${config.networkId})`);
  logger.info(`Unshielded address: ${address}`);
  if (config.faucetPage) logger.info(`Faucet page      : ${config.faucetPage}`);

  const before = await waitForFunds(wallet.wallet, env, false, wallet.unshieldedKeystore);
  logger.info(`NIGHT balance before: ${before}`);

  if (before === 0n) {
    const drip = await requestFaucetDrip(logger, config, address);
    if (!drip.ok) {
      logger.warn(
        'Programmatic drip did not succeed. Fund the address above via the faucet page, then re-run.',
      );
    }
    // Give the drip a moment to land, then register NIGHT for DUST generation.
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }

  const after = await ensureFunded(logger, wallet, config, env);
  logger.info(`NIGHT balance after : ${after}`);
  if (after === 0n) {
    logger.error('Wallet is still unfunded. Fund it via the faucet page and re-run.');
    process.exitCode = 1;
  }
} finally {
  await wallet.stop().catch((error: unknown) => logger.warn(`wallet.stop() failed: ${String(error)}`));
}

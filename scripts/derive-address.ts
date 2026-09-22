// SPDX-License-Identifier: MIT
/**
 * Derive the configured wallet's public addresses WITHOUT syncing the network.
 *
 *   MIDNIGHT_NETWORK=preview npx vite-node scripts/derive-address.ts
 *
 * Useful to learn the exact address the faucet must fill before committing to
 * the (slow) full wallet sync. No secret is printed - only public addresses.
 */

import { getConfig, resolveWalletSecret } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { walletEnvironment } from '../src/providers.js';
import { MidnightWalletProvider } from '../src/wallet.js';

const config = getConfig();
const logger = createLogger('derive-address');
const secret = resolveWalletSecret(config);

const wallet = await MidnightWalletProvider.build(logger, walletEnvironment(config), secret);

logger.info(`Network           : ${config.name} (${config.networkId})`);
logger.info(`Coin public key   : ${wallet.getCoinPublicKey()}`);
logger.info(`Encryption pubkey : ${wallet.getEncryptionPublicKey()}`);
try {
  logger.info(`Unshielded address: ${wallet.unshieldedKeystore.getBech32Address()}`);
} catch {
  logger.info('(Unshielded address not available before wallet.start(); the coin public key above is stable.)');
}

await wallet.stop().catch(() => undefined);

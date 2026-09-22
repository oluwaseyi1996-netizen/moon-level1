// SPDX-License-Identifier: MIT
/**
 * Block until the dev wallet holds at least one spendable DUST coin.
 *
 * `syncWallet` reaching `isStrictlyComplete()` means "caught up with the chain
 * tip", not "has funds". On a fresh local devnet the wallet returns at block 0
 * with zero coins, and the first transaction then fails with
 * Wallet.InsufficientFunds. This script closes that gap so `npm run test:e2e:local`
 * is reliable on a cold devnet.
 *
 *   npm run wait:dust
 *
 * Env:
 *   WAIT_FOR_DUST_MIN_COINS  (default 1)
 *   WAIT_FOR_DUST_TIMEOUT_MS (default 180000)
 */

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { firstValueFrom, throwError } from 'rxjs';
import { filter, take, tap, timeout } from 'rxjs/operators';

import { getConfig, resolveWalletSecret } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { walletEnvironment } from '../src/providers.js';
import { MidnightWalletProvider, syncWallet } from '../src/wallet.js';

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got '${raw}'.`);
  }
  return value;
};

const minCoins = envInt('WAIT_FOR_DUST_MIN_COINS', 1);
const timeoutMs = envInt('WAIT_FOR_DUST_TIMEOUT_MS', 180_000);

const config = getConfig();
const logger = createLogger('wait-for-dust');
const env = walletEnvironment(config);

setNetworkId(config.networkId);
logger.info(`Waiting for >= ${minCoins} spendable DUST coin(s) on '${config.name}' (timeout ${timeoutMs}ms)`);

const wallet = await MidnightWalletProvider.build(logger, env, resolveWalletSecret(config));
await wallet.start();

try {
  await syncWallet(logger, wallet.wallet, timeoutMs);
  await firstValueFrom(
    wallet.wallet.state().pipe(
      tap((state) =>
        logger.info(
          `dust: ${state.dust.availableCoins.length} coin(s), balance ${state.dust.balance(new Date())}`,
        ),
      ),
      filter((state) => state.dust.availableCoins.length >= minCoins),
      take(1),
      timeout({
        each: timeoutMs,
        with: () => throwError(() => new Error(`No spendable DUST coin within ${timeoutMs}ms`)),
      }),
    ),
  );
  logger.info('DUST ready.');
} catch (error) {
  logger.error(`wait-for-dust failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
} finally {
  await wallet.stop().catch((error: unknown) => logger.warn(`wallet.stop() failed: ${String(error)}`));
}

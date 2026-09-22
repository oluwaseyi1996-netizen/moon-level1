// SPDX-License-Identifier: MIT
/**
 * Adapts a Midnight wallet to the interfaces midnight-js expects
 * (`WalletProvider` + `MidnightProvider`), and provides a wallet-sync helper.
 *
 * The wallet is constructed from a seed or mnemonic supplied by the caller; this
 * module never reads, logs or persists secrets beyond handing the seed to the
 * wallet SDK.
 */

import {
  DustSecretKey,
  LedgerParameters,
  ZswapSecretKeys,
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import type { FacadeState, UnshieldedKeystore, WalletFacade } from '@midnight-ntwrk/wallet-sdk';
import {
  FluentWalletBuilder,
  type DustWalletOptions,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

import type { WalletSecret } from './config.js';

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    return await this.wallet.finalizeRecipe(recipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const base = FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions);
    const builder =
      secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);

    const { wallet, seeds, keystore } = await builder.buildWithoutStarting();

    logger.info(`Wallet built from ${secret.kind}.`);

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
  }
}

const isProgressStrictlyComplete = (progress: unknown): boolean => {
  if (!progress || typeof progress !== 'object') return false;
  const candidate = progress as { isStrictlyComplete?: unknown };
  return typeof candidate.isStrictlyComplete === 'function'
    ? (candidate.isStrictlyComplete as () => boolean)()
    : false;
};

const formatProgress = (progress: unknown): string => {
  const complete = isProgressStrictlyComplete(progress);
  if (!progress || typeof progress !== 'object') return `${complete}`;
  const p = progress as {
    appliedIndex?: bigint;
    highestRelevantWalletIndex?: bigint;
    appliedId?: bigint;
    highestTransactionId?: bigint;
  };
  const applied = p.appliedIndex ?? p.appliedId;
  const target = p.highestRelevantWalletIndex ?? p.highestTransactionId;
  if (applied === undefined || target === undefined) return `${complete}`;
  return `${complete} (${applied}/${target})`;
};

/**
 * Wait until shielded, unshielded and dust sub-wallets have all synced to the
 * chain tip. Note this means "caught up", not "has funds" - see
 * `scripts/wait-for-dust.ts` for the latter.
 */
export const syncWallet = async (
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> => {
  logger.info('Syncing wallet...');
  let emissions = 0;
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissions += 1;
        logger.info(
          `Wallet sync [${emissions}]: shielded=${formatProgress(state.shielded.state.progress)} ` +
            `unshielded=${formatProgress(state.unshielded.progress)} ` +
            `dust=${formatProgress(state.dust.state.progress)}`,
        );
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissions} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timed out after ${timeout}ms (${emissions} emissions)`),
          ),
      }),
    ),
  );
};

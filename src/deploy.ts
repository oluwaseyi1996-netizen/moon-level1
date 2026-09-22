// SPDX-License-Identifier: MIT
/**
 * Reproducible deployment workflow for SealedBid.
 *
 *   MIDNIGHT_NETWORK=preview npm run deploy:preview
 *
 * Performs, in order:
 *   1. build the wallet from the network secret and sync it to the chain tip;
 *   2. top the wallet up from the network faucet if it is empty;
 *   3. deploy the compiled contract with the configured auction parameters;
 *   4. re-read the contract state from the indexer to confirm it exists;
 *   5. write `deployment.<network>.json` with the verifiable deployment record.
 *
 * The manifest contains no secrets - only public addresses, the contract
 * address, the transaction ids and the constructor parameters.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { CompiledSealedBidContract, zkConfigPath } from '../contracts/index.js';
import { getConfig, resolveWalletSecret } from './config.js';
import { createLogger } from './logger.js';
import { buildProviders, walletEnvironment } from './providers.js';
import { buildWalletAndSync, ensureFunded, unshieldedAddress } from './funding.js';
import type { Contract } from '../contracts/managed/sealed-bid/contract/index.js';
import type { SealedBidPrivateState } from './witnesses.js';

export type DeploymentRecord = {
  readonly project: string;
  readonly contract: string;
  readonly network: string;
  readonly networkId: string;
  readonly contractAddress: string;
  readonly deployTransactionId: string;
  readonly deployerAddress: string;
  readonly coinPublicKey: string;
  readonly constructorArgs: {
    readonly reservePrice: string;
    readonly bidDeadline: string;
    readonly revealDeadline: string;
  };
  readonly indexer: string;
  readonly node: string;
  readonly proofServer: string;
  readonly compiler: string;
  readonly languageVersion: string;
  readonly deployedAt: string;
};

const PRIVATE_STATE_ID = 'SealedBidDeployerPrivateState';

const envBigInt = (name: string, fallback: bigint): bigint => {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a non-negative integer, got '${raw}'.`);
  }
  return BigInt(raw.trim());
};

export const resolveAuctionParameters = (nowSeconds = BigInt(Math.floor(Date.now() / 1000))) => {
  const DAY = 86_400n;
  const reservePrice = envBigInt('MIDNIGHT_RESERVE_PRICE', 1_000n);
  const bidDeadline = envBigInt('MIDNIGHT_BID_DEADLINE', nowSeconds + DAY);
  const revealDeadline = envBigInt('MIDNIGHT_REVEAL_DEADLINE', nowSeconds + 2n * DAY);
  return { reservePrice, bidDeadline, revealDeadline };
};

export const deploySealedBid = async (): Promise<DeploymentRecord> => {
  const config = getConfig();
  const logger = createLogger('deploy');
  const secret = resolveWalletSecret(config);
  const params = resolveAuctionParameters();

  setNetworkId(config.networkId);
  logger.info(`Deploying SealedBid to '${config.name}' (${config.networkId})`);
  logger.info(
    `Auction parameters: reservePrice=${params.reservePrice} ` +
      `bidDeadline=${params.bidDeadline} revealDeadline=${params.revealDeadline}`,
  );

  const env = walletEnvironment(config);
  const wallet = await buildWalletAndSync(logger, env, secret);
  const deployerAddress = unshieldedAddress(wallet);

  try {
    await ensureFunded(logger, wallet, config, env);

    const providers = buildProviders(wallet, zkConfigPath, config, {
      privateStateStoreName: 'sealed-bid-deployer',
    });

    const deployed: DeployedContract<Contract<SealedBidPrivateState>> = await deployContract<
      Contract<SealedBidPrivateState>
    >(providers, {
      compiledContract: CompiledSealedBidContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: { secretKey: new Uint8Array(32) },
      args: [params.reservePrice, params.bidDeadline, params.revealDeadline],
    });

    const contractAddress: ContractAddress = deployed.deployTxData.public.contractAddress;
    const deployTransactionId = String(deployed.deployTxData.public.txId);
    logger.info(`Contract deployed at: ${contractAddress}`);
    logger.info(`Deployment transaction id: ${deployTransactionId}`);

    // Independent confirmation: read the state back from the indexer rather than
    // trusting the deploy call's own return value.
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    if (state === null) {
      throw new Error(
        `Deployment could not be confirmed: the indexer has no state for ${contractAddress}.`,
      );
    }

    const record: DeploymentRecord = {
      project: 'sealed-bid',
      contract: 'SealedBidContract',
      network: config.name,
      networkId: config.networkId,
      contractAddress: String(contractAddress),
      deployTransactionId,
      deployerAddress,
      coinPublicKey: String(wallet.getCoinPublicKey()),
      constructorArgs: {
        reservePrice: params.reservePrice.toString(),
        bidDeadline: params.bidDeadline.toString(),
        revealDeadline: params.revealDeadline.toString(),
      },
      indexer: config.indexer,
      node: config.node,
      proofServer: config.proofServer,
      compiler: process.env['COMPACT_VERSION'] ?? '0.31.1',
      languageVersion: process.env['COMPACT_LANGUAGE_VERSION'] ?? '0.23',
      deployedAt: new Date().toISOString(),
    };

    const outFile = path.resolve(process.cwd(), `deployment.${config.name}.json`);
    writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    logger.info(`Wrote deployment record to ${outFile}`);
    return record;
  } finally {
    await wallet.stop().catch((error: unknown) => {
      logger.warn(`wallet.stop() failed: ${String(error)}`);
    });
  }
};

/**
 * This module is a library; the CLI runner lives in `scripts/deploy.ts`.
 * (An `import.meta.url`-style main-module check cannot work under `vite-node`,
 * which reports `process.argv[1]` as the vite-node binary, so side-effecting
 * entry points are kept out of `src/` entirely.)
 */

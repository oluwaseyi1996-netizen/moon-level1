// SPDX-License-Identifier: MIT
/**
 * Assembles the midnight-js provider bundle used for deploying and calling
 * SealedBid: indexer public data, an HTTP proof server, on-disk proving keys and
 * a LevelDB-backed private state store.
 */

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

import type { NetworkConfig } from './config.js';
import type { MidnightWalletProvider } from './wallet.js';
import type { SealedBidPrivateState } from './witnesses.js';

/** Circuit identifiers exposed by the compiled contract. */
export type SealedBidCircuit =
  | 'placeBid'
  | 'closeBidding'
  | 'revealBid'
  | 'finalize'
  | 'cancel';

export type SealedBidProviders = MidnightProviders<
  SealedBidCircuit,
  string,
  SealedBidPrivateState
>;

export const buildProviders = (
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
  options: { privateStateStoreName?: string } = {},
): SealedBidProviders => {
  const zkConfigProvider = new NodeZkConfigProvider<SealedBidCircuit>(zkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider<string, SealedBidPrivateState>({
      privateStateStoreName:
        options.privateStateStoreName ?? `sealed-bid-${config.name}-${Date.now()}`,
      privateStoragePasswordProvider: () => 'SealedBid-Private-State-Password',
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
};

/** Convert a NetworkConfig into the shape the wallet builder wants. */
export const walletEnvironment = (config: NetworkConfig): EnvironmentConfiguration => ({
  walletNetworkId: config.networkId as EnvironmentConfiguration['walletNetworkId'],
  networkId: config.networkId,
  indexer: config.indexer,
  indexerWS: config.indexerWS,
  node: config.node,
  nodeWS: config.nodeWS,
  faucet: config.faucetApi,
  proofServer: config.proofServer,
});

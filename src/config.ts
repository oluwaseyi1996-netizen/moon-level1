// SPDX-License-Identifier: MIT
/**
 * Network configuration for the three environments SealedBid supports:
 * a local Docker devnet, Preview and Preprod.
 *
 * Secrets are never stored here. A wallet's seed or mnemonic is read from the
 * environment (or from a git-ignored `.env.<network>` file) at run time.
 */

import { loadNetworkEnv } from './env.js';

/**
 * Populate `process.env` from `.env.<network>` before anything reads a secret.
 * The shell environment always wins, and the file is git-ignored.
 */
loadNetworkEnv(process.env['MIDNIGHT_NETWORK'] ?? 'local');

export type NetworkName = 'local' | 'preview' | 'preprod';

export type NetworkConfig = {
  readonly name: NetworkName;
  /** Value passed to `setNetworkId`. */
  readonly networkId: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly nodeWS: string;
  /** HTTP endpoint of a proof server; the local one works for every network. */
  readonly proofServer: string;
  /**
   * Programmatic faucet drip endpoint, when the network exposes one. Preview and
   * Preprod are captcha-gated in the browser UI, but the drip API accepts the
   * `recipientAddress`/`amount` JSON body used by the official testkit.
   */
  readonly faucetApi?: string;
  /** Human-facing faucet page, for manual top-ups. */
  readonly faucetPage?: string;
};

export const LOCAL_CONFIG: NetworkConfig = {
  name: 'local',
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
};

export const PREVIEW_CONFIG: NetworkConfig = {
  name: 'preview',
  networkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
  faucetApi: 'https://faucet.preview.midnight.network/api/drips',
  faucetPage: 'https://midnight-tmnight-preview.nethermind.dev/',
};

export const PREPROD_CONFIG: NetworkConfig = {
  name: 'preprod',
  networkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  proofServer: process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300',
  faucetApi: 'https://faucet.preprod.midnight.network/api/drips',
  faucetPage: 'https://midnight-tmnight-preprod.nethermind.dev/',
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  local: LOCAL_CONFIG,
  preview: PREVIEW_CONFIG,
  preprod: PREPROD_CONFIG,
};

export const parseNetworkName = (value: string | undefined): NetworkName => {
  const name = (value ?? 'local') as NetworkName;
  if (!Object.prototype.hasOwnProperty.call(NETWORKS, name)) {
    throw new Error(
      `Unknown network '${value}'. Expected one of: ${Object.keys(NETWORKS).join(', ')}.`,
    );
  }
  return name;
};

export const getConfig = (): NetworkConfig => NETWORKS[parseNetworkName(process.env['MIDNIGHT_NETWORK'])];

/**
 * Resolve the wallet secret for a network.
 *
 * `MIDNIGHT_<NETWORK>_MNEMONIC` or `MIDNIGHT_<NETWORK>_SEED` (exactly one).
 * The local devnet uses a well-known, publicly documented dev seed.
 */
export const DEV_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export type WalletSecret =
  | { readonly kind: 'seed'; readonly value: string }
  | { readonly kind: 'mnemonic'; readonly value: string };

export const resolveWalletSecret = (config: NetworkConfig): WalletSecret => {
  if (config.name === 'local') {
    return { kind: 'seed', value: process.env['MIDNIGHT_LOCAL_SEED']?.trim() || DEV_SEED };
  }

  const upper = config.name.toUpperCase();
  const mnemonicEnv = `MIDNIGHT_${upper}_MNEMONIC`;
  const seedEnv = `MIDNIGHT_${upper}_SEED`;
  const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
  const seed = process.env[seedEnv]?.trim();

  if (mnemonic && seed) {
    throw new Error(`Set only one of ${mnemonicEnv} or ${seedEnv}, but both are defined.`);
  }
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic };
  if (seed) {
    if (!/^[0-9a-fA-F]+$/.test(seed) || seed.length % 2 !== 0) {
      throw new Error(`${seedEnv} must be an even-length hex string with no 0x prefix.`);
    }
    return { kind: 'seed', value: seed };
  }

  throw new Error(
    `No wallet secret for '${config.name}'. Set ${seedEnv} (64-char hex) or ` +
      `${mnemonicEnv} in a git-ignored .env.${config.name} file, or export it in the shell. ` +
      `See .env.${config.name}.example.`,
  );
};

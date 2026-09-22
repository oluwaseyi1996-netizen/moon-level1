// SPDX-License-Identifier: MIT
/**
 * End-to-end: deploy SealedBid to a real network and run a complete auction with
 * real zero-knowledge proofs.
 *
 * Run with:
 *   MIDNIGHT_NETWORK=local   npm run test:e2e:local     # Docker devnet
 *   MIDNIGHT_NETWORK=preview npm run test:e2e:preview   # Preview (funded wallet)
 *
 * Design note: one funded wallet submits every transaction, while three distinct
 * *private states* hold three distinct 32-byte secrets. SealedBid derives its
 * identities from those secrets and never from the transaction signer, so this
 * genuinely exercises three independent pseudonymous participants while needing
 * only one funded account.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  findDeployedContract,
  type DeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

import {
  CompiledSealedBidContract,
  Phase,
  ledger,
  zkConfigPath,
} from '../../../contracts/index.js';
import type { Contract, Ledger } from '../../../contracts/managed/sealed-bid/contract/index.js';
import { computeCommitment, deriveBidderId, randomNonce, toHex } from '../../commitments.js';
import { getConfig, resolveWalletSecret } from '../../config.js';
import { buildWalletAndSync, ensureFunded } from '../../funding.js';
import { createLogger } from '../../logger.js';
import { buildProviders, walletEnvironment, type SealedBidProviders } from '../../providers.js';
import type { MidnightWalletProvider } from '../../wallet.js';
import type { SealedBidPrivateState } from '../../witnesses.js';

// Apollo's GraphQL subscriptions need a WebSocket implementation in Node.
// @ts-expect-error assigning the runtime WebSocket global
globalThis.WebSocket = WebSocket;

const secretFrom = (byte: string): Uint8Array =>
  Uint8Array.from(Buffer.from(byte.repeat(32), 'hex'));

const AUCTIONEER_SECRET = secretFrom('a1');
const ALICE_SECRET = secretFrom('b2');
const BOB_SECRET = secretFrom('c3');

const PRIVATE_STATE = {
  auctioneer: 'sealed-bid:e2e:auctioneer',
  alice: 'sealed-bid:e2e:alice',
  bob: 'sealed-bid:e2e:bob',
} as const;

const RESERVE_PRICE = 1_000n;

// Sealed bids handed out during the test; filled in when the bids are sealed.
let aliceNonce: Uint8Array;
let aliceCommitment: Uint8Array;
let bobNonce: Uint8Array;
let bobCommitment: Uint8Array;

describe('SealedBid end-to-end', () => {
  const config = getConfig();
  const network = config.name;
  const logger = createLogger(`e2e:${network}`);

  let wallet: MidnightWalletProvider;
  let providers: SealedBidProviders;
  let contractAddress: ContractAddress;

  const readLedger = async (): Promise<Ledger> => {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  };

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const env = walletEnvironment(config);
    const secret = resolveWalletSecret(config);

    logger.info(`Network: ${network} (${config.networkId})`);
    logger.info(`Indexer: ${config.indexer}`);

    wallet = await buildWalletAndSync(logger, env, secret);
    await ensureFunded(logger, wallet, config, env);

    providers = buildProviders(wallet, zkConfigPath, config, {
      privateStateStoreName: 'sealed-bid-e2e',
    });
  });

  afterAll(async () => {
    if (wallet) await wallet.stop().catch((error: unknown) => logger.warn(String(error)));
  });

  it('deploys the contract and starts in the BIDDING phase', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const bidDeadline = now + 3_600n;
    const revealDeadline = now + 7_200n;

    const deployed: DeployedContract<Contract<SealedBidPrivateState>> = await deployContract<
      Contract<SealedBidPrivateState>
    >(providers, {
      compiledContract: CompiledSealedBidContract,
      privateStateId: PRIVATE_STATE.auctioneer,
      initialPrivateState: { secretKey: AUCTIONEER_SECRET },
      args: [RESERVE_PRICE, bidDeadline, revealDeadline],
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at ${contractAddress}`);
    expect(contractAddress.length).toBeGreaterThan(0);

    const l = await readLedger();
    expect(l.phase).toBe(Phase.BIDDING);
    expect(l.reservePrice).toBe(RESERVE_PRICE);
    expect(l.bidCount).toBe(0n);
    expect(l.winner.is_some).toBe(false);
  }, 20 * 60_000);

  it('seals a bid from two independent pseudonymous bidders', async () => {
    const alice: FoundContract<Contract<SealedBidPrivateState>> = await findDeployedContract(
      providers,
      {
        compiledContract: CompiledSealedBidContract,
        contractAddress,
        privateStateId: PRIVATE_STATE.alice,
        initialPrivateState: { secretKey: ALICE_SECRET },
      },
    );
    const bob: FoundContract<Contract<SealedBidPrivateState>> = await findDeployedContract(
      providers,
      {
        compiledContract: CompiledSealedBidContract,
        contractAddress,
        privateStateId: PRIVATE_STATE.bob,
        initialPrivateState: { secretKey: BOB_SECRET },
      },
    );

    aliceNonce = randomNonce();
    aliceCommitment = computeCommitment(1_500n, aliceNonce, deriveBidderId(ALICE_SECRET));
    bobNonce = randomNonce();
    bobCommitment = computeCommitment(2_500n, bobNonce, deriveBidderId(BOB_SECRET));

    await alice.callTx.placeBid(aliceCommitment);
    logger.info('Alice sealed her bid');
    await bob.callTx.placeBid(bobCommitment);
    logger.info('Bob sealed his bid');

    const l = await readLedger();
    expect(l.bidCount).toBe(2n);
    expect(l.highestBid).toBe(0n);
    expect(l.validRevealCount).toBe(0n);
    expect(l.commitments.member(aliceCommitment)).toBe(true);
    expect(l.commitments.member(bobCommitment)).toBe(true);
    expect(toHex(l.commitments.lookup(bobCommitment))).toEqual(toHex(deriveBidderId(BOB_SECRET)));
  }, 20 * 60_000);

  it('closes bidding as the auctioneer', async () => {
    const auctioneer = await findDeployedContract(providers, {
      compiledContract: CompiledSealedBidContract,
      contractAddress,
      privateStateId: PRIVATE_STATE.auctioneer,
      initialPrivateState: { secretKey: AUCTIONEER_SECRET },
    });
    await auctioneer.callTx.closeBidding();

    expect((await readLedger()).phase).toBe(Phase.REVEAL);
  }, 20 * 60_000);

  it('opens both bids and records the higher one', async () => {
    const alice = await findDeployedContract(providers, {
      compiledContract: CompiledSealedBidContract,
      contractAddress,
      privateStateId: PRIVATE_STATE.alice,
      initialPrivateState: { secretKey: ALICE_SECRET },
    });
    const bob = await findDeployedContract(providers, {
      compiledContract: CompiledSealedBidContract,
      contractAddress,
      privateStateId: PRIVATE_STATE.bob,
      initialPrivateState: { secretKey: BOB_SECRET },
    });

    await alice.callTx.revealBid(1_500n, aliceNonce);
    let l = await readLedger();
    expect(l.highestBid).toBe(1_500n);
    expect(l.validRevealCount).toBe(1n);

    await bob.callTx.revealBid(2_500n, bobNonce);
    l = await readLedger();
    expect(l.highestBid).toBe(2_500n);
    expect(l.validRevealCount).toBe(2n);
    expect(toHex(l.highestBidder)).toEqual(toHex(deriveBidderId(BOB_SECRET)));
  }, 20 * 60_000);

  it('finalizes and declares Bob the winner', async () => {
    // Settlement is permissionless: the auctioneer triggers it here, but any
    // participant could.
    const auctioneer = await findDeployedContract(providers, {
      compiledContract: CompiledSealedBidContract,
      contractAddress,
      privateStateId: PRIVATE_STATE.auctioneer,
      initialPrivateState: { secretKey: AUCTIONEER_SECRET },
    });
    await auctioneer.callTx.finalize();

    const l = await readLedger();
    expect(l.phase).toBe(Phase.FINALIZED);
    expect(l.winner.is_some).toBe(true);
    expect(toHex(l.winner.value)).toEqual(toHex(deriveBidderId(BOB_SECRET)));
    expect(l.winningAmount).toBe(2_500n);
  }, 20 * 60_000);
});

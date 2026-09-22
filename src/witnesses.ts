// SPDX-License-Identifier: MIT
/**
 * Shape of the private (off-chain, prover-local) state for SealedBid, plus the
 * witness implementations that expose it to the compiled circuits.
 *
 * The private state is deliberately tiny: a single 32-byte secret. Every
 * on-chain identity is a one-way, domain-separated derivation of that secret, so
 * leaking the ledger cannot recover it.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../contracts/managed/sealed-bid/contract/index.js';

export type SealedBidPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createSealedBidPrivateState = (secretKey: Uint8Array): SealedBidPrivateState => ({
  secretKey,
});

/**
 * Compact witnesses. Each returns `[nextPrivateState, value]`; SealedBid never
 * mutates its private state, so the incoming state is returned unchanged.
 */
export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, SealedBidPrivateState>): [SealedBidPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
};

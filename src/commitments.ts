// SPDX-License-Identifier: MIT
/**
 * Client-side helpers for the commit/reveal scheme.
 *
 * These wrap the contract's `pure` circuits so that application code never has
 * to re-implement the hashing rules. Anything that computes a commitment MUST
 * come from here (or from the same pure circuits on-chain), because a mismatch
 * would make the commitment unopenable.
 */

import { pureCircuits } from '../contracts/managed/sealed-bid/contract/index.js';

/** Cryptographically random 32-byte nonce for sealing a bid. */
export const randomNonce = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

/** 32 zero bytes; a convenient, obviously-not-secret placeholder key. */
export const zeroKey = (): Uint8Array => new Uint8Array(32);

/** Derive the pseudonymous bidder identity for a secret key. */
export const deriveBidderId = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.deriveBidderId(secretKey);

/** Derive the pseudonymous auctioneer identity for a secret key. */
export const deriveAuctioneerId = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.deriveAuctioneerId(secretKey);

/** Compute the sealed bid commitment `H(domain, amount, nonce, bidderId)`. */
export const computeCommitment = (
  amount: bigint,
  nonce: Uint8Array,
  bidderId: Uint8Array,
): Uint8Array => pureCircuits.computeCommitment(amount, nonce, bidderId);

/** Compute a commitment on behalf of a secret key's identity. */
export const computeCommitmentFor = (
  amount: bigint,
  nonce: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array => pureCircuits.computeCommitmentFor(amount, nonce, secretKey);

/** Convenience: seal a bid and return everything needed to open it later. */
export const sealBid = (
  amount: bigint,
  secretKey: Uint8Array,
): { amount: bigint; nonce: Uint8Array; bidderId: Uint8Array; commitment: Uint8Array } => {
  const nonce = randomNonce();
  const bidderId = deriveBidderId(secretKey);
  return {
    amount,
    nonce,
    bidderId,
    commitment: computeCommitment(amount, nonce, bidderId),
  };
};

/** Lowercase hex, for logging and for comparing identities in tests. */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

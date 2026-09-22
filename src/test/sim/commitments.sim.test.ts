// SPDX-License-Identifier: MIT
/**
 * Tests for the contract's `pure` circuits: identity derivation and the sealed
 * bid commitment. These are the cryptographic primitives the whole scheme rests
 * on, so they are pinned down explicitly.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCommitment,
  computeCommitmentFor,
  deriveAuctioneerId,
  deriveBidderId,
  sealBid,
  toHex,
  zeroKey,
} from '../../commitments.js';
import { key } from './harness.js';

describe('identity derivation', () => {
  it('is deterministic for the same secret', () => {
    const sk = key(11);
    expect(toHex(deriveBidderId(sk))).toEqual(toHex(deriveBidderId(sk)));
    expect(toHex(deriveAuctioneerId(sk))).toEqual(toHex(deriveAuctioneerId(sk)));
  });

  it('produces 32-byte pseudonyms, never the secret itself', () => {
    const sk = key(11);
    const bidderId = deriveBidderId(sk);
    expect(bidderId).toHaveLength(32);
    expect(toHex(bidderId)).not.toEqual(toHex(sk));
  });

  it('separates the bidder and auctioneer domains for the same secret', () => {
    const sk = key(11);
    expect(toHex(deriveBidderId(sk))).not.toEqual(toHex(deriveAuctioneerId(sk)));
  });

  it('gives different identities for different secrets', () => {
    expect(toHex(deriveBidderId(key(1)))).not.toEqual(toHex(deriveBidderId(key(2))));
  });

  it('accepts the all-zero key without collision with a zero identity', () => {
    const id = deriveBidderId(zeroKey());
    expect(id).toHaveLength(32);
    expect(toHex(id)).not.toEqual(toHex(zeroKey()));
  });
});

describe('sealed bid commitments', () => {
  const sk = key(3);
  const bidderId = deriveBidderId(sk);
  const nonce = new Uint8Array(32).fill(0x5a);

  it('is deterministic', () => {
    expect(toHex(computeCommitment(1234n, nonce, bidderId))).toEqual(
      toHex(computeCommitment(1234n, nonce, bidderId)),
    );
  });

  it('binds the amount', () => {
    expect(toHex(computeCommitment(1234n, nonce, bidderId))).not.toEqual(
      toHex(computeCommitment(1235n, nonce, bidderId)),
    );
  });

  it('binds the nonce, so an equal amount by the same bidder is not linkable', () => {
    const other = new Uint8Array(32).fill(0x5b);
    expect(toHex(computeCommitment(1234n, nonce, bidderId))).not.toEqual(
      toHex(computeCommitment(1234n, other, bidderId)),
    );
  });

  it('binds the bidder identity, so commitments are not transferable', () => {
    const otherId = deriveBidderId(key(4));
    expect(toHex(computeCommitment(1234n, nonce, bidderId))).not.toEqual(
      toHex(computeCommitment(1234n, nonce, otherId)),
    );
  });

  it('returns a 32-byte digest', () => {
    expect(computeCommitment(1n, nonce, bidderId)).toHaveLength(32);
  });

  it('computeCommitmentFor matches the underlying derivation', () => {
    expect(toHex(computeCommitmentFor(999n, nonce, sk))).toEqual(
      toHex(computeCommitment(999n, nonce, bidderId)),
    );
  });

  it('sealBid produces an openable commitment with a fresh nonce', () => {
    const a = sealBid(500n, sk);
    const b = sealBid(500n, sk);
    expect(toHex(a.nonce)).not.toEqual(toHex(b.nonce));
    expect(toHex(a.commitment)).not.toEqual(toHex(b.commitment));
    expect(toHex(a.commitment)).toEqual(toHex(computeCommitment(500n, a.nonce, a.bidderId)));
  });
});

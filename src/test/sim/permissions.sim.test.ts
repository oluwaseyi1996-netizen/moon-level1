// SPDX-License-Identifier: MIT
/**
 * Authorisation: who may invoke which circuit. SealedBid has exactly one
 * privileged role (the auctioneer) and a deliberately narrow privilege set.
 */

import { describe, it, expect } from 'vitest';
import { AuctionHarness, Phase, toHex, participant } from './harness.js';
import { deriveBidderId, deriveAuctioneerId } from '../../commitments.js';

describe('auctioneer-only circuits', () => {
  it('refuses closeBidding from a non-auctioneer', () => {
    const h = new AuctionHarness();
    const intruder = participant('intruder', 9);
    expect(() => h.close.call(h)).not.toThrow(); // sanity: auctioneer can
    const h2 = new AuctionHarness();
    expect(() => h2.as(intruder).sim.closeBidding()).toThrow(
      /failed assert: Only the auctioneer can close the bidding/,
    );
  });

  it('refuses cancel from a non-auctioneer', () => {
    const h = new AuctionHarness();
    const intruder = participant('intruder', 9);
    expect(() => h.cancel(intruder)).toThrow(
      /failed assert: Only the auctioneer can cancel this auction/,
    );
    expect(h.phase).toBe(Phase.BIDDING);
  });

  it('does not confuse the auctioneer role with the bidder role for the same secret', () => {
    const h = new AuctionHarness();
    const secret = h.auctioneer.secretKey;

    // Role authority comes from holding the secret, and the two on-chain
    // pseudonyms for that secret are domain-separated, so an observer cannot
    // mistake the auctioneer for a bidder (or vice versa).
    expect(toHex(deriveBidderId(secret))).not.toEqual(toHex(deriveAuctioneerId(secret)));
    expect(toHex(h.ledger().auctioneer)).toEqual(toHex(deriveAuctioneerId(secret)));
    expect(toHex(h.ledger().auctioneer)).not.toEqual(toHex(deriveBidderId(secret)));

    // The auctioneer may also bid under their distinct bidder pseudonym, and
    // that pseudonym still confers no auctioneer authority on anyone else.
    h.commit(h.auctioneer, 500n);
    expect(h.ledger().bidCount).toBe(1n);
    expect(toHex(h.ledger().bidderCommitment.lookup(deriveBidderId(secret)))).toHaveLength(64);
  });

  it('refuses closeBidding for every wrong secret', () => {
    for (const seed of [1, 2, 3, 200, 255]) {
      const h = new AuctionHarness();
      const impostor = participant(`impostor${seed}`, seed);
      expect(() => h.as(impostor).sim.closeBidding()).toThrow(
        /failed assert: Only the auctioneer can close the bidding/,
      );
    }
  });
});

describe('permissionless circuits', () => {
  it('lets any participant finalize an auction in the reveal phase', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const anyone = participant('anyone', 77);
    const a = h.commit(alice, 10n);
    h.close().reveal(a);
    expect(() => h.finalize(anyone)).not.toThrow();
    expect(h.phase).toBe(Phase.FINALIZED);
  });

  it('lets any participant place a sealed bid', () => {
    const h = new AuctionHarness();
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(() => h.commit(participant(`p${seed}`, seed), BigInt(seed) * 1000n)).not.toThrow();
    }
    expect(h.ledger().bidCount).toBe(5n);
  });

  it('lets any committed participant open their own bid', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bid = h.commit(alice, 42n);
    h.close();
    expect(() => h.reveal(bid)).not.toThrow();
    expect(h.ledger().highestBid).toBe(42n);
  });
});

describe('privilege is not transferable', () => {
  it('does not let a bidder hijack auctioneer duties after the fact', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.commit(alice, 1000n);
    expect(() => h.as(alice).sim.cancel()).toThrow(/Only the auctioneer can cancel/);
    expect(() => h.as(alice).sim.closeBidding()).toThrow(/Only the auctioneer can close the bidding/);
  });

  it('does not let an outsider cancel an auction between phases', () => {
    const h = new AuctionHarness();
    const outsider = participant('outsider', 55);
    h.close();
    expect(() => h.cancel(outsider)).toThrow(/Only the auctioneer can cancel/);
    expect(h.phase).toBe(Phase.REVEAL);
  });
});

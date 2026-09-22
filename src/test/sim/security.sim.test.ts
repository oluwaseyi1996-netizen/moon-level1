// SPDX-License-Identifier: MIT
/**
 * Security properties, stated as falsifiable tests.
 *
 * The privacy assertions inspect the *raw* ledger state produced by the compiled
 * circuits, so they test the actual disclosure behaviour of the contract rather
 * than an assumption about it.
 */

import { describe, it, expect } from 'vitest';
import {
  AuctionHarness,
  Phase,
  ledgerStateMentionsUint64,
  littleEndianHex,
  participant,
  serializedLedgerState,
  toHex,
} from './harness.js';

/* Distinctive, high-entropy amounts (six significant bytes each) so that a
 * match in the serialised ledger can only mean a genuine disclosure, never a
 * coincidence with alignment metadata or a short structural integer. */
const WINNING_AMOUNT = 9_000_000_000_007n;
const VALID_LOSING_AMOUNT = 7_000_000_000_003n;
const BELOW_RESERVE_AMOUNT = 5_000_000_000_009n;
const RESERVE = 6_000_000_000_000n;

describe('bid secrecy', () => {
  it('publishes no bid amount during the bidding phase', () => {
    const h = new AuctionHarness({ reservePrice: RESERVE });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    h.commit(alice, WINNING_AMOUNT);
    h.commit(bob, VALID_LOSING_AMOUNT);

    const state = serializedLedgerState(h.sim);
    expect(ledgerStateMentionsUint64(state, WINNING_AMOUNT)).toBe(false);
    expect(ledgerStateMentionsUint64(state, VALID_LOSING_AMOUNT)).toBe(false);

    const l = h.ledger();
    expect(l.highestBid).toBe(0n);
    expect(l.winningAmount).toBe(0n);
    expect(l.winner.is_some).toBe(false);
    expect(l.validRevealCount).toBe(0n);
  });

  it('never publishes a losing bid amount', () => {
    const h = new AuctionHarness({ reservePrice: RESERVE });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const carol = participant('carol', 3);

    const a = h.commit(alice, WINNING_AMOUNT);
    const b = h.commit(bob, VALID_LOSING_AMOUNT);
    const c = h.commit(carol, BELOW_RESERVE_AMOUNT);

    // Alice reveals first and becomes the running best; every later reveal is a
    // losing bid and must never be disclosed.
    h.close().reveal(a).reveal(b).reveal(c).finalize();

    const state = serializedLedgerState(h.sim);
    // The winning amount is public by design...
    expect(ledgerStateMentionsUint64(state, WINNING_AMOUNT)).toBe(true);
    // ...while a valid-but-losing bid and a below-reserve bid are not.
    expect(ledgerStateMentionsUint64(state, VALID_LOSING_AMOUNT)).toBe(false);
    expect(ledgerStateMentionsUint64(state, BELOW_RESERVE_AMOUNT)).toBe(false);

    const l = h.ledger();
    expect(l.winningAmount).toBe(WINNING_AMOUNT);
    expect(l.highestBid).toBe(WINNING_AMOUNT);
    expect(l.validRevealCount).toBe(2n); // Alice and Bob met the reserve
  });

  it('publishes only commitments, so the ledger leaks no bid content', () => {
    const h = new AuctionHarness({ reservePrice: RESERVE });
    const alice = participant('alice', 1);
    const bid = h.commit(alice, WINNING_AMOUNT);
    const l = h.ledger();
    expect(l.commitments.member(bid.commitment)).toBe(true);
    expect(toHex(l.commitments.lookup(bid.commitment))).toEqual(toHex(alice.identity));
  });

  it('keeps the prover secret out of the ledger', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.commit(alice, 1000n);
    const state = serializedLedgerState(h.sim).toLowerCase();
    expect(state).not.toContain(toHex(alice.secretKey));
    expect(state).not.toContain(toHex(h.auctioneer.secretKey));
  });

  it('positive control: the privacy scan finds values that ARE on the ledger', () => {
    // Without this, a "not found" result would be meaningless. `reservePrice` is
    // deliberately public, so the scan is required to find it.
    const h = new AuctionHarness({ reservePrice: RESERVE });
    expect(ledgerStateMentionsUint64(serializedLedgerState(h.sim), RESERVE)).toBe(true);

    // After a bid commits, the commitment must also be visible, and the scan
    // must still not turn up the bid amount.
    const alice = participant('alice', 1);
    h.commit(alice, WINNING_AMOUNT);
    const state = serializedLedgerState(h.sim);
    expect(state.toLowerCase()).toContain(littleEndianHex(RESERVE));
    expect(ledgerStateMentionsUint64(state, WINNING_AMOUNT)).toBe(false);
  });

  it('littleEndianHex agrees with an independent byte-wise derivation', () => {
    // Independent derivation: build the big-endian hex string, split it into
    // byte pairs, reverse them, then drop high-order zero bytes.
    const encode = (value: bigint): string => {
      const padded = value.toString(16).padStart(2, '0');
      const even = padded.length % 2 === 0 ? padded : `0${padded}`;
      const bytes = (even.match(/../g) ?? []).reverse();
      return bytes.join('').replace(/(00)+$/, '') || '00';
    };

    for (const value of [0n, 1n, 255n, 256n, 65_535n, 9_000_000_000_007n, (1n << 64n) - 1n]) {
      expect(littleEndianHex(value)).toBe(encode(value));
    }
  });
});

describe('commitment binding', () => {
  it('cannot be opened by another participant even with the amount and nonce', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const mallory = participant('mallory', 2);

    const a = h.commit(alice, 900n);
    // Mallory also commits, so she passes the "has committed" gate and reaches
    // the binding check with Alice's real amount and nonce.
    h.commit(mallory, 5n);
    h.close();

    expect(() => h.as(mallory).sim.revealBid(a.amount, a.nonce)).toThrow(
      /failed assert: Reveal does not match the sealed bid commitment/,
    );
  });

  it('cannot be brute-forced: a guessed amount fails without the nonce', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const a = h.commit(alice, 777n);
    h.close();

    // A correct guess of the amount is not enough to open the bid.
    for (const guessNonceSeed of [1, 2, 3, 4, 5]) {
      const guess = new Uint8Array(32).fill(guessNonceSeed);
      expect(() => h.as(alice).sim.revealBid(a.amount, guess)).toThrow(
        /failed assert: Reveal does not match/,
      );
    }
    // ...and the real nonce still works.
    expect(() => h.reveal(a)).not.toThrow();
  });

  it('cannot be replayed across auctions: nonces are bound to the bidder identity', () => {
    const h1 = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const a1 = h1.commit(alice, 400n);

    const h2 = new AuctionHarness({ reservePrice: 1n });
    h2.commit(alice, 999n);
    h2.close();

    // Alice's commitment from auction 1 is meaningless in auction 2.
    expect(() => h2.as(alice).sim.revealBid(a1.amount, a1.nonce)).toThrow(
      /failed assert: Reveal does not match the sealed bid commitment/,
    );
  });
});

describe('anti-rug guarantees for committed bidders', () => {
  it('refuses cancellation once a sealed bid exists, at every phase', () => {
    const duringBidding = new AuctionHarness();
    duringBidding.commit(participant('alice', 1), 500n);
    expect(() => duringBidding.cancel()).toThrow(/Cannot cancel an auction that already has sealed bids/);

    const duringReveal = new AuctionHarness();
    duringReveal.commit(participant('alice', 1), 500n);
    duringReveal.close();
    expect(() => duringReveal.cancel()).toThrow(/Cannot cancel an auction that already has sealed bids/);
  });

  it('guarantees a committed bid a path to settlement', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bid = h.commit(alice, 123n);
    // The auctioneer cannot cancel; the only forward path is close -> reveal -> finalize.
    expect(() => h.cancel()).toThrow();
    h.close().reveal(bid).finalize();
    expect(h.phase).toBe(Phase.FINALIZED);
    expect(h.winnerIsBidder).toBe('alice');
  });
});

describe('shill resistance', () => {
  it('limits every identity to one sealed bid, so fake bids cost the same as real ones', () => {
    const h = new AuctionHarness();
    const shill = participant('shill', 1);
    h.commit(shill, 100n);
    expect(() => h.commit(shill, 200n)).toThrow(/already placed a sealed bid/);
  });

  it('requires a bid to be openable to count, so unbacked bids cannot inflate the price', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const honest = participant('honest', 1);
    const badFaith = participant('bad-faith', 2);

    const honestBid = h.commit(honest, 150n);
    h.commit(badFaith, 10_000n); // sealed, never opened
    h.close().reveal(honestBid).finalize();

    expect(h.ledger().winner.is_some).toBe(true);
    expect(h.winnerIsBidder).toBe('honest');
    expect(h.ledger().winningAmount).toBe(150n);
    expect(h.ledger().validRevealCount).toBe(1n);
  });
});

describe('state integrity', () => {
  it('cannot reach FINALIZED before REVEAL', () => {
    const h = new AuctionHarness();
    expect(() => h.finalize()).toThrow(/not in the reveal phase/);
    expect(h.phase).toBe(Phase.BIDDING);
  });

  it('cannot return to BIDDING once bidding has closed', () => {
    const h = new AuctionHarness();
    h.close();
    expect(() => h.commit(participant('late', 1), 100n)).toThrow(/Sealed bidding is not open/);
    expect(h.phase).toBe(Phase.REVEAL);
  });

  it('freezes the outcome once finalized', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const a = h.commit(alice, 10n);
    const b = h.commit(bob, 20n);
    h.close().reveal(a).reveal(b).finalize();

    const before = h.ledger();
    const beforeWinner = toHex(before.winner.value);

    expect(() => h.reveal(b)).toThrow();
    expect(() => h.commit(alice, 999n)).toThrow();
    expect(() => h.cancel()).toThrow();

    const after = h.ledger();
    expect(toHex(after.winner.value)).toEqual(beforeWinner);
    expect(after.winningAmount).toBe(before.winningAmount);
    expect(after.phase).toBe(Phase.FINALIZED);
  });
});

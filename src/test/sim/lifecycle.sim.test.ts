// SPDX-License-Identifier: MIT
/**
 * Auction lifecycle: construction, the commit -> reveal -> settle happy path,
 * reserve-price handling, tie-breaking, and the empty-auction outcome.
 */

import { describe, it, expect } from 'vitest';
import { AuctionHarness, Phase, key, participant, toHex } from './harness.js';
import { deriveAuctioneerId } from '../../commitments.js';
import { SealedBidSimulator } from '../../simulator.js';

describe('construction', () => {
  it('initialises a deterministic, empty ledger', () => {
    const a = new AuctionHarness({ reservePrice: 100n, bidDeadline: 10n, revealDeadline: 20n });
    const b = new AuctionHarness({ reservePrice: 100n, bidDeadline: 10n, revealDeadline: 20n });
    // Deterministic given the same deployer key and parameters.
    expect(toHex(a.ledger().auctioneer)).toEqual(toHex(b.ledger().auctioneer));
  });

  it('records the auction parameters and starts in BIDDING', () => {
    const h = new AuctionHarness({ reservePrice: 2500n, bidDeadline: 111n, revealDeadline: 222n });
    const l = h.ledger();
    expect(l.phase).toBe(Phase.BIDDING);
    expect(l.reservePrice).toBe(2500n);
    expect(l.bidDeadline).toBe(111n);
    expect(l.revealDeadline).toBe(222n);
    expect(l.bidCount).toBe(0n);
    expect(l.validRevealCount).toBe(0n);
    expect(l.highestBid).toBe(0n);
    expect(l.winningAmount).toBe(0n);
  });

  it('starts with no winner and empty commitment collections', () => {
    const l = new AuctionHarness().ledger();
    expect(l.winner.is_some).toBe(false);
    expect(l.commitments.size()).toBe(0n);
    expect(l.bidderCommitment.size()).toBe(0n);
    expect(l.revealedCommitments.size()).toBe(0n);
  });

  it('sets the auctioneer to the derived pseudonym of the deployer, not the secret', () => {
    const h = new AuctionHarness();
    expect(toHex(h.ledger().auctioneer)).toEqual(toHex(deriveAuctioneerId(h.auctioneer.secretKey)));
    expect(toHex(h.ledger().auctioneer)).not.toEqual(toHex(h.auctioneer.secretKey));
  });
});

describe('happy path: sealed bid auction with two bidders', () => {
  it('seals bids, opens them, and settles on the highest bidder', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);

    const aBid = h.commit(alice, 150n);
    const bBid = h.commit(bob, 250n);

    let l = h.ledger();
    expect(l.phase).toBe(Phase.BIDDING);
    expect(l.bidCount).toBe(2n);
    // Nothing about the amounts is on the ledger yet.
    expect(l.highestBid).toBe(0n);
    expect(l.validRevealCount).toBe(0n);
    expect(l.commitments.member(aBid.commitment)).toBe(true);
    expect(l.commitments.member(bBid.commitment)).toBe(true);

    h.close();
    expect(h.phase).toBe(Phase.REVEAL);

    h.reveal(aBid);
    l = h.ledger();
    expect(l.highestBid).toBe(150n);
    expect(l.validRevealCount).toBe(1n);

    h.reveal(bBid);
    l = h.ledger();
    expect(l.highestBid).toBe(250n);
    expect(l.validRevealCount).toBe(2n);
    expect(l.revealedCommitments.size()).toBe(2n);

    h.finalize();
    l = h.ledger();
    expect(l.phase).toBe(Phase.FINALIZED);
    expect(l.winner.is_some).toBe(true);
    expect(toHex(l.winner.value)).toEqual(toHex(bob.identity));
    expect(toHex(l.highestBidder)).toEqual(toHex(bob.identity));
    expect(l.winningAmount).toBe(250n);
    expect(h.winnerIsBidder).toBe('bob');
  });

  it('keeps a bid at exactly the reserve price eligible', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const alice = participant('alice', 1);
    const bid = h.commit(alice, 100n);
    h.close().reveal(bid).finalize();
    expect(h.ledger().winningAmount).toBe(100n);
    expect(h.winnerIsBidder).toBe('alice');
  });

  it('ignores a bid strictly below the reserve price', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const alice = participant('alice', 1);
    const bid = h.commit(alice, 99n);
    h.close().reveal(bid);
    expect(h.ledger().validRevealCount).toBe(0n);
    expect(h.ledger().highestBid).toBe(0n);
  });
});

describe('tie-breaking', () => {
  it('keeps the incumbent on an exactly equal bid (strictly-greater wins)', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);

    const aBid = h.commit(alice, 500n);
    const bBid = h.commit(bob, 500n);
    h.close().reveal(aBid).reveal(bBid);

    expect(toHex(h.ledger().highestBidder)).toEqual(toHex(alice.identity));
    expect(h.ledger().validRevealCount).toBe(2n);

    h.finalize();
    expect(h.winnerIsBidder).toBe('alice');
  });

  it('later reveals can overtake an earlier best bid', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const carol = participant('carol', 3);

    const a = h.commit(alice, 500n);
    const b = h.commit(bob, 600n);
    const c = h.commit(carol, 700n);
    h.close().reveal(a).reveal(c).reveal(b);

    expect(h.ledger().highestBid).toBe(700n);
    h.finalize();
    expect(h.winnerIsBidder).toBe('carol');
  });
});

describe('outcome when the reserve price is never met', () => {
  it('finalizes with no winner rather than inventing one', () => {
    const h = new AuctionHarness({ reservePrice: 1000n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const a = h.commit(alice, 10n);
    const b = h.commit(bob, 20n);

    h.close().reveal(a).reveal(b).finalize();

    const l = h.ledger();
    expect(l.phase).toBe(Phase.FINALIZED);
    expect(l.validRevealCount).toBe(0n);
    expect(l.winner.is_some).toBe(false);
    expect(l.winningAmount).toBe(0n);
    expect(h.winnerIsBidder).toBeNull();
  });

  it('finalizes with no winner when everyone sealed but nobody opened', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const alice = participant('alice', 1);
    h.commit(alice, 500n);

    h.close().finalize();

    const l = h.ledger();
    expect(l.phase).toBe(Phase.FINALIZED);
    expect(l.winner.is_some).toBe(false);
    expect(l.bidCount).toBe(1n);
    expect(l.validRevealCount).toBe(0n);
  });

  it('a single valid reveal below the reserve loses to none', () => {
    const h = new AuctionHarness({ reservePrice: 100n });
    const alice = participant('alice', 1);
    const a = h.commit(alice, 50n);
    h.close().reveal(a).finalize();
    expect(h.ledger().winner.is_some).toBe(false);
  });
});

describe('settlement is permissionless', () => {
  it('lets a non-auctioneer finalize', () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const outsider = participant('outsider', 42);
    const a = h.commit(alice, 5n);
    h.close().reveal(a);
    h.finalize(outsider);
    expect(h.phase).toBe(Phase.FINALIZED);
    expect(h.winnerIsBidder).toBe('alice');
  });
});

describe('supporting a third party as the deployer', () => {
  it('lets any secret key deploy and run an auction', () => {
    const deployer = key(0x77);
    const sim = new SealedBidSimulator({
      reservePrice: 5n,
      bidDeadline: 1n,
      revealDeadline: 2n,
      auctioneerSecretKey: deployer,
    });
    expect(sim.getLedger().phase).toBe(Phase.BIDDING);
    expect(toHex(sim.getLedger().auctioneer)).toEqual(toHex(deriveAuctioneerId(deployer)));
  });
});

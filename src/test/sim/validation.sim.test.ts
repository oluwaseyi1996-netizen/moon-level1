// SPDX-License-Identifier: MIT
/**
 * Invalid inputs, state-machine ordering violations and boundary cases.
 *
 * Every rejection here is enforced by an `assert` inside a circuit, which means
 * the offending transaction cannot be proven and therefore cannot be posted.
 */

import { describe, it, expect } from 'vitest';
import { AuctionHarness, Phase, participant } from './harness.js';
import { SealedBidSimulator } from '../../simulator.js';

describe('constructor input validation', () => {
  const build = (reserve: bigint, bidDeadline: bigint, revealDeadline: bigint) =>
    new SealedBidSimulator({
      reservePrice: reserve,
      bidDeadline,
      revealDeadline,
      auctioneerSecretKey: new Uint8Array(32).fill(0xa0),
    });

  it('rejects a zero reserve price', () => {
    expect(() => build(0n, 10n, 20n)).toThrow(/failed assert: Reserve price must be greater than zero/);
  });

  it('rejects a reveal deadline that is not after the bidding deadline', () => {
    expect(() => build(100n, 10n, 10n)).toThrow(
      /failed assert: Reveal deadline must be after the bidding deadline/,
    );
  });

  it('rejects a reveal deadline that precedes the bidding deadline', () => {
    expect(() => build(100n, 20n, 10n)).toThrow(
      /failed assert: Reveal deadline must be after the bidding deadline/,
    );
  });

  it('accepts the smallest valid configuration', () => {
    expect(() => build(1n, 0n, 1n)).not.toThrow();
  });

  it('accepts the largest representable 64-bit values', () => {
    const max = (1n << 64n) - 1n;
    expect(() => build(max, 0n, max)).not.toThrow();
  });
});

describe('bidding window enforcement', () => {
  it('rejects a sealed bid once bidding has closed', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.close();
    expect(() => h.commit(alice, 100n)).toThrow(/failed assert: Sealed bidding is not open/);
  });

  it('rejects a sealed bid after the auction is finalized', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.close().finalize();
    expect(() => h.commit(alice, 100n)).toThrow(/failed assert: Sealed bidding is not open/);
  });

  it('rejects a sealed bid after cancellation', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.cancel();
    expect(() => h.commit(alice, 100n)).toThrow(/failed assert: Sealed bidding is not open/);
  });

  it('rejects closing the bidding twice', () => {
    const h = new AuctionHarness();
    h.close();
    expect(() => h.close()).toThrow(/failed assert: Sealed bidding is already closed/);
  });

  it('rejects closing bidding after cancellation', () => {
    const h = new AuctionHarness();
    h.cancel();
    expect(() => h.close()).toThrow(/failed assert: Sealed bidding is already closed/);
  });
});

describe('sealed bid validation', () => {
  it('rejects a second sealed bid from the same identity', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    h.commit(alice, 100n);
    expect(() => h.commit(alice, 200n)).toThrow(
      /failed assert: This identity has already placed a sealed bid/,
    );
    expect(h.ledger().bidCount).toBe(1n);
  });

  it('rejects re-registering a commitment that is already on the ledger', () => {
    const h = new AuctionHarness();
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const bid = h.commit(alice, 100n);
    // Bob publishes Alice's exact commitment.
    expect(() => h.as(bob).sim.placeBid(bid.commitment)).toThrow(
      /failed assert: This sealed bid commitment was already registered/,
    );
    expect(h.ledger().bidCount).toBe(1n);
  });

  it('has no per-bidder cap: distinct identities can each place one bid', () => {
    const h = new AuctionHarness();
    for (let i = 1; i <= 10; i += 1) h.commit(participant(`p${i}`, i), BigInt(i) * 10n);
    expect(h.ledger().bidCount).toBe(10n);
    expect(h.ledger().bidderCommitment.size()).toBe(10n);
  });
});

describe('reveal validation', () => {
  const setup = () => {
    const h = new AuctionHarness({ reservePrice: 1n });
    const alice = participant('alice', 1);
    const bob = participant('bob', 2);
    const a = h.commit(alice, 100n);
    const b = h.commit(bob, 200n);
    return { h, alice, bob, a, b };
  };

  it('rejects opening before the reveal phase', () => {
    const { h, a } = setup();
    expect(() => h.reveal(a)).toThrow(/failed assert: Reveals are not open/);
  });

  it('rejects opening an amount that does not match the commitment', () => {
    const { h, a } = setup();
    h.close();
    expect(() => h.as(a.bidder).sim.revealBid(a.amount + 1n, a.nonce)).toThrow(
      /failed assert: Reveal does not match the sealed bid commitment/,
    );
  });

  it('rejects opening with a wrong nonce', () => {
    const { h, a } = setup();
    h.close();
    const wrong = new Uint8Array(32).fill(0x01);
    expect(() => h.as(a.bidder).sim.revealBid(a.amount, wrong)).toThrow(
      /failed assert: Reveal does not match the sealed bid commitment/,
    );
  });

  it('rejects opening a different amount with the correct nonce', () => {
    const { h, a } = setup();
    h.close();
    expect(() => h.as(a.bidder).sim.revealBid(a.amount * 2n, a.nonce)).toThrow(
      /failed assert: Reveal does not match the sealed bid commitment/,
    );
  });

  it('rejects an open from an identity that never placed a sealed bid', () => {
    const { h, a } = setup();
    const carol = participant('carol', 3);
    h.close();
    // Carol supplies Alice's amount and nonce, but she must open her own
    // commitment - and she has none.
    expect(() => h.as(carol).sim.revealBid(a.amount, a.nonce)).toThrow(
      /failed assert: This identity never placed a sealed bid/,
    );
  });

  it('rejects opening the same sealed bid twice', () => {
    const { h, a } = setup();
    h.close();
    h.reveal(a);
    expect(() => h.reveal(a)).toThrow(
      /failed assert: This sealed bid has already been revealed/,
    );
    expect(h.ledger().validRevealCount).toBe(1n);
  });

  it('rejects opening after the auction is finalized', () => {
    const { h, a, b } = setup();
    h.close().reveal(a).reveal(b).finalize();
    expect(() => h.reveal(a)).toThrow(/failed assert: Reveals are not open/);
  });

  it('rejects opening after cancellation', () => {
    const h = new AuctionHarness();
    h.cancel();
    const alice = participant('alice', 1);
    expect(() => h.as(alice).sim.revealBid(1n, new Uint8Array(32))).toThrow(
      /failed assert: Reveals are not open/,
    );
  });
});

describe('finalize validation', () => {
  it('rejects finalizing while bidding is still open', () => {
    const h = new AuctionHarness();
    expect(() => h.finalize()).toThrow(/failed assert: Auction is not in the reveal phase/);
  });

  it('rejects finalizing twice', () => {
    const h = new AuctionHarness();
    h.close().finalize();
    expect(() => h.finalize()).toThrow(/failed assert: Auction is not in the reveal phase/);
  });

  it('rejects finalizing a cancelled auction', () => {
    const h = new AuctionHarness();
    h.cancel();
    expect(() => h.finalize()).toThrow(/failed assert: Auction is not in the reveal phase/);
  });
});

describe('cancel validation', () => {
  it('rejects cancelling an auction that already has sealed bids', () => {
    const h = new AuctionHarness();
    h.commit(participant('alice', 1), 100n);
    expect(() => h.cancel()).toThrow(
      /failed assert: Cannot cancel an auction that already has sealed bids/,
    );
    expect(h.phase).toBe(Phase.BIDDING);
  });

  it('rejects cancelling after finalization', () => {
    const h = new AuctionHarness();
    h.close().finalize();
    expect(() => h.cancel()).toThrow(/failed assert: Auction has already concluded/);
  });

  it('rejects cancelling twice', () => {
    const h = new AuctionHarness();
    h.cancel();
    expect(() => h.cancel()).toThrow(/failed assert: Auction has already concluded/);
  });

  it('allows cancelling during the reveal phase when nothing was committed', () => {
    const h = new AuctionHarness();
    h.close();
    expect(() => h.cancel()).not.toThrow();
    expect(h.phase).toBe(Phase.CANCELLED);
  });
});

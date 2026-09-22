// SPDX-License-Identifier: MIT
/**
 * Shared harness for the simulator suite: named participants, a fluent auction
 * driver, and helpers for asserting on privacy-relevant ledger contents.
 */

import { SealedBidSimulator } from '../../simulator.js';
import { Phase, type Ledger } from '../../../contracts/managed/sealed-bid/contract/index.js';
import {
  computeCommitment,
  deriveAuctioneerId,
  deriveBidderId,
  randomNonce,
} from '../../commitments.js';

/** Deterministic 32-byte secret for a test participant. */
export const key = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);

export type Participant = {
  readonly name: string;
  readonly secretKey: Uint8Array;
  readonly identity: Uint8Array;
};

export const participant = (name: string, seed: number): Participant => {
  const secretKey = key(seed);
  return { name, secretKey, identity: deriveBidderId(secretKey) };
};

export type SealedBid = {
  readonly amount: bigint;
  readonly nonce: Uint8Array;
  readonly commitment: Uint8Array;
  readonly bidder: Participant;
};

export type HarnessOptions = {
  reservePrice?: bigint;
  bidDeadline?: bigint;
  revealDeadline?: bigint;
  time?: number;
};

/**
 * Drives a SealedBid auction through the compiled circuits, keeping track of who
 * is acting and of the sealed bids handed out to each participant.
 */
export class AuctionHarness {
  readonly sim: SealedBidSimulator;
  readonly auctioneer: Participant;
  readonly sealed = new Map<string, SealedBid>();

  constructor(options: HarnessOptions = {}) {
    this.auctioneer = participant('auctioneer', 0xa0);
    this.sim = new SealedBidSimulator({
      reservePrice: options.reservePrice ?? 100n,
      bidDeadline: options.bidDeadline ?? 1_000n,
      revealDeadline: options.revealDeadline ?? 2_000n,
      auctioneerSecretKey: this.auctioneer.secretKey,
      time: options.time ?? 1_700_000_000,
    });
  }

  /* --------------------------- actor switching -------------------------- */

  as(who: Participant): this {
    this.sim.actAs(who.secretKey);
    return this;
  }

  /* ------------------------------- actions ------------------------------ */

  /** Seal and submit a bid for `bidder`. Returns the sealed bid for later opening. */
  commit(bidder: Participant, amount: bigint): SealedBid {
    const nonce = randomNonce();
    const commitment = computeCommitment(amount, nonce, bidder.identity);
    const bid: SealedBid = { amount, nonce, commitment, bidder };
    this.as(bidder).sim.placeBid(commitment);
    this.sealed.set(bidder.name, bid);
    return bid;
  }

  /** Seal a bid without submitting it (for negative tests). */
  seal(bidder: Participant, amount: bigint, nonce = randomNonce()): SealedBid {
    return {
      amount,
      nonce,
      commitment: computeCommitment(amount, nonce, bidder.identity),
      bidder,
    };
  }

  close(): this {
    this.as(this.auctioneer).sim.closeBidding();
    return this;
  }

  reveal(bid: SealedBid): this {
    this.as(bid.bidder).sim.revealBid(bid.amount, bid.nonce);
    return this;
  }

  /** Reveal a bid as recorded for `bidder`. */
  open(bidder: Participant): this {
    const bid = this.sealed.get(bidder.name);
    if (!bid) throw new Error(`no sealed bid recorded for ${bidder.name}`);
    return this.reveal(bid);
  }

  finalize(as: Participant = this.auctioneer): this {
    this.as(as).sim.finalize();
    return this;
  }

  cancel(as: Participant = this.auctioneer): this {
    this.as(as).sim.cancel();
    return this;
  }

  ledger(): Ledger {
    return this.sim.getLedger();
  }

  get phase(): Phase {
    return this.ledger().phase;
  }

  get winnerIsBidder(): string | null {
    const l = this.ledger();
    if (!l.winner.is_some) return null;
    const hex = toHex(l.winner.value);
    for (const [, bid] of this.sealed) {
      if (toHex(bid.bidder.identity) === hex) return bid.bidder.name;
    }
    return hex;
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Complete serialisation of the raw on-chain ledger state.
 *
 * `ChargedState` is a WASM-backed handle whose only enumerable property is a
 * pointer, so it cannot be walked with `JSON.stringify`. Its `toString()`
 * implementation renders the entire state tree (every cell, map entry and set
 * member, with values in hex), which is exactly what a privacy assertion needs:
 * if a private value had leaked into the ledger it must appear in this string.
 */
export const serializedLedgerState = (sim: SealedBidSimulator): string =>
  String(sim.context.currentQueryContext.state);

/**
 * Little-endian hex encoding of an unsigned integer, which is how Compact
 * renders `Uint<N>` values inside a serialised ledger state. Leading zero bytes
 * are trimmed because the runtime prints the minimal representation.
 */
export const littleEndianHex = (value: bigint): string => {
  if (value < 0n) throw new Error('littleEndianHex expects a non-negative integer');
  const bytes: string[] = [];
  let remaining = value;
  do {
    bytes.push((remaining & 0xffn).toString(16).padStart(2, '0'));
    remaining >>= 8n;
  } while (remaining > 0n);
  return bytes.join('');
};

/**
 * True when the serialised ledger state contains `value` in any of the encodings
 * the runtime may use for a `Uint<64>`.
 */
export const ledgerStateMentionsUint64 = (serialized: string, value: bigint): boolean => {
  const full = littleEndianHex(value);
  const trimmed = full.replace(/^(00)+/, '') || '00';
  const needle = serialized.toLowerCase();
  return needle.includes(full) || needle.includes(trimmed) || needle.includes(value.toString());
};

export { Phase, deriveAuctioneerId, deriveBidderId };

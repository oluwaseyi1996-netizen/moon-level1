// SPDX-License-Identifier: MIT
/**
 * Tests for the ledger-side funding check: folding an address's unshielded
 * history into a NIGHT balance. The balance is what every "is the wallet
 * funded?" decision rests on, so the reduction is pinned down here rather than
 * only exercised against a live indexer.
 */

import { describe, it, expect } from 'vitest';
import {
  NIGHT_TOKEN_TYPE,
  applyUnshieldedEvent,
  emptyLedgerState,
  toUnshieldedBalance,
  type UnshieldedEvent,
  type UnshieldedLedgerState,
  type UnshieldedUtxo,
} from '../../funding.js';

const ADDRESS = 'mn_addr_preview1l29h770qyj5jse7j8lua7443wp8n8zmsurwh4z9ujad98e5xw36qpchln9';
const OTHER_ADDRESS = 'mn_addr_preview1qotherqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const FOREIGN_TOKEN = 'a'.repeat(64);

const utxo = (value: bigint, overrides: Partial<UnshieldedUtxo> = {}): UnshieldedUtxo => ({
  owner: ADDRESS,
  tokenType: NIGHT_TOKEN_TYPE,
  value,
  outputIndex: 0,
  intentHash: `intent-${value}`,
  ...overrides,
});

const transaction = (
  transactionId: number,
  created: readonly UnshieldedUtxo[],
  spent: readonly UnshieldedUtxo[] = [],
): UnshieldedEvent => ({
  kind: 'transaction',
  transactionId,
  hash: `hash-${transactionId}`,
  timestamp: 1_790_000_000_000 + transactionId,
  created,
  spent,
});

const fold = (events: readonly UnshieldedEvent[]): UnshieldedLedgerState =>
  events.reduce((state, event) => applyUnshieldedEvent(state, event, ADDRESS), emptyLedgerState());

describe('NIGHT token type', () => {
  it('is the all-zero token type', () => {
    expect(NIGHT_TOKEN_TYPE).toHaveLength(64);
    expect(NIGHT_TOKEN_TYPE).toEqual('0'.repeat(64));
  });
});

describe('unshielded history reduction', () => {
  it('credits a drip to the balance', () => {
    const state = fold([transaction(1, [utxo(1_000n)])]);
    expect(state.created).toEqual(1_000n);
    expect(state.spent).toEqual(0n);
    expect(state.unspent.size).toEqual(1);
    expect(toUnshieldedBalance(state, ADDRESS, 100, true).balance).toEqual(1_000n);
  });

  it('nets a spend of a credited output back to zero', () => {
    // The faucet consolidation seen on Preview: a second drip spends the first
    // output and re-creates the same amount for the same address.
    const first = utxo(5_000_000_000n, { intentHash: 'drip-1' });
    const second = utxo(5_000_000_000n, { intentHash: 'drip-1' });
    const state = fold([
      transaction(68_293, [first]),
      transaction(68_297, [utxo(5_000_000_000n, { intentHash: 'drip-2', outputIndex: 0 })], [second]),
    ]);

    expect(state.created).toEqual(10_000_000_000n);
    expect(state.spent).toEqual(5_000_000_000n);
    expect(state.unspent.size).toEqual(1);
    expect(toUnshieldedBalance(state, ADDRESS, 100, true).balance).toEqual(5_000_000_000n);
  });

  it('tracks outputs by intent and index, so a same-amount change is not conflated', () => {
    const state = fold([
      transaction(1, [utxo(10n, { intentHash: 'i', outputIndex: 0 }), utxo(10n, { intentHash: 'i', outputIndex: 1 })]),
      transaction(2, [], [utxo(10n, { intentHash: 'i', outputIndex: 0 })]),
    ]);
    expect(state.unspent.size).toEqual(1);
    expect(toUnshieldedBalance(state, ADDRESS, null, true).balance).toEqual(10n);
  });

  it('ignores outputs owned by somebody else', () => {
    const state = fold([transaction(1, [utxo(999n, { owner: OTHER_ADDRESS })])]);
    expect(state.unspent.size).toEqual(0);
    expect(state.credits).toHaveLength(0);
    expect(toUnshieldedBalance(state, ADDRESS, null, true).balance).toEqual(0n);
  });

  it('ignores non-NIGHT token types', () => {
    const state = fold([transaction(1, [utxo(999n, { tokenType: FOREIGN_TOKEN })])]);
    expect(state.unspent.size).toEqual(0);
    expect(toUnshieldedBalance(state, ADDRESS, null, true).balance).toEqual(0n);
  });

  it('never reports a negative balance for a spend it never saw created', () => {
    const state = fold([transaction(9, [], [utxo(500n, { intentHash: 'unseen' })])]);
    expect(state.spent).toEqual(500n);
    expect(toUnshieldedBalance(state, ADDRESS, null, true).balance).toEqual(0n);
  });

  it('records credits in ledger order with their transaction details', () => {
    const state = fold([transaction(7, [utxo(2n)]), transaction(8, [utxo(3n)])]);
    expect(state.credits).toHaveLength(2);
    expect(state.credits[0]).toEqual({
      value: 2n,
      transactionId: 7,
      hash: 'hash-7',
      timestamp: 1_790_000_000_007,
    });
    expect(state.credits[1]?.transactionId).toEqual(8);
    expect(state.lastTransactionId).toEqual(8);
    expect(state.transactionsSeen).toEqual(2);
  });
});

describe('progress markers', () => {
  it('advances highestTransactionId and keeps the balance untouched', () => {
    const state = fold([transaction(5, [utxo(1n)]), { kind: 'progress', highestTransactionId: 5 }]);
    expect(state.highestTransactionId).toEqual(5);
    expect(state.transactionsSeen).toEqual(1);
  });

  it('never regresses when an older marker arrives late', () => {
    const state = fold([
      { kind: 'progress', highestTransactionId: 9 },
      { kind: 'progress', highestTransactionId: 4 },
    ]);
    expect(state.highestTransactionId).toEqual(9);
  });

  it('leaves the state identical for a repeated marker', () => {
    const before = fold([{ kind: 'progress', highestTransactionId: 9 }]);
    const after = applyUnshieldedEvent(before, { kind: 'progress', highestTransactionId: 9 }, ADDRESS);
    expect(after).toBe(before);
  });
});

describe('reported answer', () => {
  it('carries the address, the tip and the caught-up flag through', () => {
    const state = fold([transaction(1, [utxo(4n)])]);
    const result = toUnshieldedBalance(state, ADDRESS, 2_707_160, false);
    expect(result).toEqual({
      address: ADDRESS,
      balance: 4n,
      created: 4n,
      spent: 0n,
      unspentOutputs: 1,
      credits: [{ value: 4n, transactionId: 1, hash: 'hash-1', timestamp: 1_790_000_000_001 }],
      transactionsSeen: 1,
      highestTransactionId: 0,
      caughtUp: false,
      tipHeight: 2_707_160,
    });
  });

  it('reports zero for an address with no history', () => {
    const result = toUnshieldedBalance(emptyLedgerState(), ADDRESS, 10, true);
    expect(result.balance).toEqual(0n);
    expect(result.unspentOutputs).toEqual(0);
    expect(result.transactionsSeen).toEqual(0);
  });
});

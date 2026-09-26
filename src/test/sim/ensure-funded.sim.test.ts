// SPDX-License-Identifier: MIT
/**
 * Regression tests for `ensureFunded`.
 *
 * The testkit's funding flow registers the wallet's NIGHT UTXOs for dust
 * generation when the wallet holds no dust. That registration spends the NIGHT
 * UTXO before recreating it in the same transaction, so the balance the testkit
 * returns - and the wallet's view right after - can read 0 for a funded wallet.
 * `ensureFunded` must wait for that registration to settle rather than reporting
 * a funded wallet as unfunded.
 *
 * The testkit is mocked so the flow between "the wallet had NIGHT" and "the
 * registration settled" can be driven deterministically, without a network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject, type Observable } from 'rxjs';
import { ensureFunded, NIGHT_TOKEN_TYPE } from '../../funding.js';

const { waitForFunds } = vi.hoisted(() => ({ waitForFunds: vi.fn() }));

vi.mock('@midnight-ntwrk/testkit-js', () => ({ waitForFunds }));

type FakeState = {
  unshielded: { balances: Record<string, bigint> };
  dust: { availableCoins: readonly unknown[] };
};

/** A facade state carrying `night` NIGHT and `dustCoins` spendable dust coins. */
const state = (night: bigint, dustCoins = 0): FakeState => ({
  unshielded: { balances: night > 0n ? { [NIGHT_TOKEN_TYPE]: night } : {} },
  dust: { availableCoins: Array.from({ length: dustCoins }, () => ({})) },
});

const makeWallet = (subject: BehaviorSubject<FakeState>) =>
  ({
    wallet: { state: (): Observable<FakeState> => subject.asObservable() },
    unshieldedKeystore: {},
  }) as never;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const previewConfig = { name: 'preview', faucetPage: 'https://faucet.example/' } as never;

beforeEach(() => {
  waitForFunds.mockReset();
  process.env['MIDNIGHT_DUST_SETTLE_TIMEOUT_MS'] = '2000';
});

afterEach(() => {
  delete process.env['MIDNIGHT_DUST_SETTLE_TIMEOUT_MS'];
});

describe('ensureFunded', () => {
  it('reports the settled balance when a dust registration transiently zeroes the wallet', async () => {
    const subject = new BehaviorSubject<FakeState>(state(5_000_000_000n, 0));
    waitForFunds.mockImplementation(async () => {
      // The registration spends the NIGHT UTXO; the testkit returns the
      // post-registration balance, which reads 0 until the tx settles.
      subject.next(state(0n, 0));
      setTimeout(() => subject.next(state(5_000_000_000n, 1)), 50);
      return 0n;
    });

    const balance = await ensureFunded(logger, makeWallet(subject), previewConfig, {} as never);
    expect(balance).toEqual(5_000_000_000n);
  });

  it('waits for the wallet to settle rather than reporting the transient zero', async () => {
    const subject = new BehaviorSubject<FakeState>(state(5_000_000_000n, 0));
    let settled = false;
    waitForFunds.mockImplementation(async () => {
      subject.next(state(0n, 0));
      setTimeout(() => {
        settled = true;
        subject.next(state(5_000_000_000n, 1));
      }, 80);
      return 0n;
    });

    const balance = await ensureFunded(logger, makeWallet(subject), previewConfig, {} as never);
    expect(settled).toBe(true);
    expect(balance).toEqual(5_000_000_000n);
  });

  it('still reports a genuinely unfunded wallet', async () => {
    const subject = new BehaviorSubject<FakeState>(state(0n, 0));
    waitForFunds.mockResolvedValue(0n);

    await expect(
      ensureFunded(logger, makeWallet(subject), previewConfig, {} as never),
    ).rejects.toThrow(/unfunded/i);
  });

  it('accepts an already-settled funded wallet without waiting', async () => {
    const subject = new BehaviorSubject<FakeState>(state(5_000_000_000n, 1));
    waitForFunds.mockResolvedValue(5_000_000_000n);

    const balance = await ensureFunded(logger, makeWallet(subject), previewConfig, {} as never);
    expect(balance).toEqual(5_000_000_000n);
  });
});

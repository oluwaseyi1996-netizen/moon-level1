// SPDX-License-Identifier: MIT
/**
 * A deterministic, in-process driver for the *real* compiled contract.
 *
 * This is not a mock. It loads the JavaScript emitted by `compact compile` and
 * executes the actual circuits against an actual ledger state using
 * `@midnight-ntwrk/compact-runtime`. What it skips is proof generation, which is
 * the slow, network-bound part. That makes it possible to exercise business
 * logic, permissions, edge cases and adversarial flows exhaustively and in
 * milliseconds, while `src/test/e2e` covers the real-made-provable path.
 *
 * `time` is threaded through the runtime context so that contract code which
 * reads `blockTime()` would work here too; SealedBid itself records deadlines as
 * advisory data because language version 0.23 exposes no on-chain clock.
 */

import {
  CostModel,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
  type CircuitResults,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger,
  pureCircuits,
  Phase,
  type Ledger,
} from '../contracts/managed/sealed-bid/contract/index.js';
import { witnesses, type SealedBidPrivateState } from './witnesses.js';

/** Coin public key used for simulated calls; not security-relevant here. */
const SIM_COIN_PUBLIC_KEY = '0'.repeat(64);

export type SimulatorOptions = {
  reservePrice: bigint;
  bidDeadline: bigint;
  revealDeadline: bigint;
  /** Secret key of the account that constructs (and therefore runs) the auction. */
  auctioneerSecretKey: Uint8Array;
  /** Simulated wall-clock seconds. */
  time?: number;
};

export class SealedBidSimulator {
  readonly contract: Contract<SealedBidPrivateState>;
  /** Current ledger + private state; replaced after every circuit call. */
  context: CircuitContext<SealedBidPrivateState>;

  private readonly contractAddress = sampleContractAddress();

  constructor(options: SimulatorOptions) {
    this.contract = new Contract<SealedBidPrivateState>(witnesses);

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(
          { secretKey: options.auctioneerSecretKey },
          SIM_COIN_PUBLIC_KEY,
        ),
        options.reservePrice,
        options.bidDeadline,
        options.revealDeadline,
      );

    this.context = createCircuitContext(
      this.contractAddress,
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
      undefined,
      CostModel.initialCostModel(),
      options.time ?? 1_700_000_000,
    );
  }

  /** Execute a circuit as the currently-selected actor and advance the ledger. */
  private call<R>(
    circuit: (context: CircuitContext<SealedBidPrivateState>) => CircuitResults<SealedBidPrivateState, R>,
  ): R {
    const results = circuit(this.context);
    this.context = results.context;
    return results.result;
  }

  /** Act as a different participant (they hold a different secret key). */
  actAs(secretKey: Uint8Array): void {
    this.context.currentPrivateState = { secretKey };
  }

  getLedger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  getPrivateState(): SealedBidPrivateState {
    return this.context.currentPrivateState;
  }

  getAddress(): string {
    return this.contractAddress;
  }

  /* ----------------------------- circuits ----------------------------- */

  placeBid(sealedBid: Uint8Array): void {
    this.call((context) => this.contract.impureCircuits.placeBid(context, sealedBid));
  }

  closeBidding(): void {
    this.call((context) => this.contract.impureCircuits.closeBidding(context));
  }

  revealBid(amount: bigint, nonce: Uint8Array): void {
    this.call((context) => this.contract.impureCircuits.revealBid(context, amount, nonce));
  }

  finalize(): void {
    this.call((context) => this.contract.impureCircuits.finalize(context));
  }

  cancel(): void {
    this.call((context) => this.contract.impureCircuits.cancel(context));
  }

  /* --------------------------- pure circuits -------------------------- */

  get pure(): typeof pureCircuits {
    return pureCircuits;
  }
}

export { Phase };

import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Phase { BIDDING = 0, REVEAL = 1, FINALIZED = 2, CANCELLED = 3 }

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  placeBid(context: __compactRuntime.CircuitContext<PS>, sealedBid_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalize(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  placeBid(context: __compactRuntime.CircuitContext<PS>, sealedBid_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalize(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  deriveBidderId(sk_0: Uint8Array): Uint8Array;
  deriveAuctioneerId(sk_0: Uint8Array): Uint8Array;
  computeCommitment(amount_0: bigint,
                    nonce_0: Uint8Array,
                    bidderId_0: Uint8Array): Uint8Array;
  computeCommitmentFor(amount_0: bigint, nonce_0: Uint8Array, sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  deriveBidderId(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  deriveAuctioneerId(context: __compactRuntime.CircuitContext<PS>,
                     sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeCommitment(context: __compactRuntime.CircuitContext<PS>,
                    amount_0: bigint,
                    nonce_0: Uint8Array,
                    bidderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeCommitmentFor(context: __compactRuntime.CircuitContext<PS>,
                       amount_0: bigint,
                       nonce_0: Uint8Array,
                       sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  placeBid(context: __compactRuntime.CircuitContext<PS>, sealedBid_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  finalize(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly phase: Phase;
  readonly auctioneer: Uint8Array;
  readonly reservePrice: bigint;
  readonly bidDeadline: bigint;
  readonly revealDeadline: bigint;
  commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  bidderCommitment: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  revealedCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly highestBid: bigint;
  readonly highestBidder: Uint8Array;
  readonly winner: { is_some: boolean, value: Uint8Array };
  readonly winningAmount: bigint;
  readonly bidCount: bigint;
  readonly validRevealCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               _reservePrice_0: bigint,
               _bidDeadline_0: bigint,
               _revealDeadline_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

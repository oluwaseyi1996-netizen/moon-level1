// SPDX-License-Identifier: MIT
/**
 * Barrel module for the compiled SealedBid contract.
 *
 * Everything that other modules need in order to talk to the contract -
 * the generated `Contract` class, the ledger decoder, the pure helper circuits
 * and the compiled-contract descriptor used by midnight-js - is re-exported
 * from here so callers never have to reach into `managed/` directly.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

export {
  Contract,
  ledger,
  pureCircuits,
  Phase,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
  type Witnesses,
} from './managed/sealed-bid/contract/index.js';
import { Contract } from './managed/sealed-bid/contract/index.js';

import { witnesses, type SealedBidPrivateState } from '../src/witnesses.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding the compiler-generated proving/verifying keys and zkir. */
export const zkConfigPath = path.resolve(currentDir, 'managed', 'sealed-bid');

/**
 * Descriptor consumed by `deployContract` / `submitCallTx`. It pairs the
 * generated circuit implementation with the witness set and the on-disk
 * proving assets produced by `compact compile`.
 */
export const CompiledSealedBidContract = CompiledContract.make<
  Contract<SealedBidPrivateState>
>('SealedBidContract', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// SPDX-License-Identifier: MIT
/**
 * Independent verification of a deployed SealedBid contract.
 *
 *   MIDNIGHT_NETWORK=preview npm run verify:preview
 *
 * Reads `deployment.<network>.json`, then re-fetches the contract state straight
 * from the network indexer - a completely separate path from the deploy code -
 * and checks that the on-chain state matches the recorded deployment.
 *
 * Exit code 0 means verified; 1 means the deployment could not be confirmed.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

import { ledger, Phase } from '../contracts/index.js';
import { getConfig } from './config.js';
import { createLogger } from './logger.js';
import type { DeploymentRecord } from './deploy.js';

export type VerificationResult = {
  readonly verified: boolean;
  readonly contractAddress: string;
  readonly network: string;
  readonly indexer: string;
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
};

const readDeploymentRecord = (network: string): DeploymentRecord => {
  const file = path.resolve(process.cwd(), `deployment.${network}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DeploymentRecord;
  } catch {
    throw new Error(
      `No deployment record at ${file}. Deploy first with 'npm run deploy:${network}'.`,
    );
  }
};

export const verifySealedBid = async (): Promise<VerificationResult> => {
  const config = getConfig();
  const logger = createLogger('verify');
  const record = readDeploymentRecord(config.name);

  setNetworkId(config.networkId);

  const publicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const state = await publicDataProvider.queryContractState(
    record.contractAddress as ContractAddress,
  );

  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  push('contract state is retrievable from the indexer', state !== null, String(state !== null));

  if (state !== null) {
    const l = ledger(state.data);
    push(
      'constructor reserve price matches the deployment record',
      l.reservePrice.toString() === record.constructorArgs.reservePrice,
      `on-chain=${l.reservePrice} record=${record.constructorArgs.reservePrice}`,
    );
    push(
      'constructor bid deadline matches the deployment record',
      l.bidDeadline.toString() === record.constructorArgs.bidDeadline,
      `on-chain=${l.bidDeadline} record=${record.constructorArgs.bidDeadline}`,
    );
    push(
      'constructor reveal deadline matches the deployment record',
      l.revealDeadline.toString() === record.constructorArgs.revealDeadline,
      `on-chain=${l.revealDeadline} record=${record.constructorArgs.revealDeadline}`,
    );
    push(
      'contract is freshly deployed in the BIDDING phase',
      l.phase === Phase.BIDDING,
      `phase=${Phase[l.phase]}`,
    );
    push('no sealed bids recorded yet', l.bidCount === 0n, `bidCount=${l.bidCount}`);
    push('no winner declared yet', l.winner.is_some === false, `winner.is_some=${l.winner.is_some}`);
  }

  const verified = checks.every((c) => c.ok);
  for (const check of checks) {
    logger.info(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  [${check.detail}]`);
  }

  return {
    verified,
    contractAddress: record.contractAddress,
    network: config.name,
    indexer: config.indexer,
    checks,
  };
};

/**
 * This module is a library; the CLI runner lives in `scripts/verify.ts`.
 * (A main-module check cannot work under `vite-node`, which reports
 * `process.argv[1]` as the vite-node binary, so side-effecting entry points
 * are kept out of `src/` entirely.)
 */

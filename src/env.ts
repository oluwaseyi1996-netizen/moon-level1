// SPDX-License-Identifier: MIT
/**
 * Minimal `.env.<network>` loader.
 *
 * Wallet secrets live in a git-ignored `.env.<network>` file (see
 * `.env.preview.example` / `.env.preprod.example`). Vitest loads that file for
 * the test suites, but plain `vite-node` scripts do not, so this module makes the
 * behaviour uniform for every entry point.
 *
 * Rules:
 *   * a value already present in the real environment always wins;
 *   * values are never logged or echoed - only the set of loaded keys is;
 *   * a missing file is not an error (the local devnet needs none).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type LoadedEnv = {
  readonly file: string | null;
  readonly keys: readonly string[];
};

const parseEnvFile = (contents: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip a single layer of matching quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }
  return result;
};

/**
 * Load `.env.<network>` from the current working directory into `process.env`,
 * without overwriting anything already defined. Safe to call repeatedly.
 */
export const loadNetworkEnv = (network: string, cwd = process.cwd()): LoadedEnv => {
  const file = path.resolve(cwd, `.env.${network}`);
  if (!existsSync(file)) return { file: null, keys: [] };

  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  const loaded: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return { file, keys: loaded };
};

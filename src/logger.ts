// SPDX-License-Identifier: MIT
/** Shared logger factory. Log level is controlled by `LOG_LEVEL` (default: info). */

import pino, { type Logger } from 'pino';

export const createLogger = (name?: string): Logger =>
  pino({
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });

export type { Logger };

/**
 * Structured logger (pino). One logger per process; modules add `child`
 * bindings so log lines are greppable per component.
 */
import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { dryRun: config.DRY_RUN },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

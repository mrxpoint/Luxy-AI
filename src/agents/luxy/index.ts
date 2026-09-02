/**
 * Luxy Main Agent — process entrypoint.
 * Consumes the `signals` queue and turns candidates into LuxyIntents.
 * Also runs the periodic strategy self-tuning pass (BLUEPRINT §5.3):
 * Luxy proposes → user approves via Telegram or the Web UI.
 * Run: pnpm dev:agent
 */
import { Worker } from 'bullmq';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { ScoredCandidate } from '../../types/index.js';
import { processCandidate } from './agent.js';
import { tuneOnce } from '../../strategy/index.js';

const log = logger.child({ module: 'luxy-agent-main' });

const worker = new Worker<{ kind: string; candidate?: ScoredCandidate }>(
  'signals',
  async (job) => {
    if (job.data.kind !== 'candidate' || !job.data.candidate) return;
    await processCandidate(job.data.candidate);
  },
  { connection: { url: config.REDIS_URL }, concurrency: 1 },
);

worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'signal processing failed'));
worker.on('completed', (job) => log.debug({ jobId: job.id }, 'signal processed'));

// Strategy self-tuning loop (default hourly, configurable via STRATEGY_TUNE_INTERVAL_MIN).
setInterval(
  () => tuneOnce().catch((err) => log.warn({ err }, 'strategy tuning pass failed')),
  Math.max(config.STRATEGY_TUNE_INTERVAL_MIN, 5) * 60_000,
);

log.info('luxy agent running — waiting for signals');

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

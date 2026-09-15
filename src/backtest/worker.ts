/**
 * Backtest queue worker — processes interactive research jobs only.
 * Never places orders (BLUEPRINT.md §10.4.7).
 */
import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { notify } from '../redis/queues.js';
import { logger } from '../utils/logger.js';
import { runBacktestJob } from './runner.js';
import type { BacktestJobRequest } from './types.js';

const log = logger.child({ module: 'backtest-worker' });

const worker = new Worker<BacktestJobRequest>(
  'backtest',
  async (job) => {
    const jobId = String(job.id);
    log.info({ jobId, venue: job.data.venue, symbol: job.data.symbolOrMarket }, 'backtest start');
    const result = await runBacktestJob(jobId, job.data);
    if (result.status === 'done' && result.metrics) {
      const m = result.metrics;
      await notify(
        `[BACKTEST] job=${jobId} done — win_rate ${(m.win_rate * 100).toFixed(0)}% sharpe ${m.sharpe.toFixed(2)} n=${m.n_trades}`,
        'info',
      );
    } else if (result.status === 'failed') {
      await notify(`[BACKTEST] job=${jobId} failed — ${result.error ?? 'unknown'}`, 'alert');
    }
    return result;
  },
  { connection: { url: config.REDIS_URL }, concurrency: 1 },
);

worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'backtest job failed'));
worker.on('completed', (job) => log.debug({ jobId: job.id }, 'backtest job completed'));

log.info('backtest worker running');

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

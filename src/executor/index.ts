/**
 * Executor process entrypoint (BLUEPRINT.md §5.1).
 * Run: pnpm dev:executor
 */
import { startExecutorWorker } from './worker.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const log = logger.child({ module: 'executor-main' });

log.info({ dryRun: config.DRY_RUN }, 'executor starting (risk guard: hardcoded limits active)');

startExecutorWorker()
  .then((worker) => {
    const shutdown = async (): Promise<void> => {
      log.info('shutting down executor...');
      await worker.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    log.fatal({ err }, 'executor failed to start');
    process.exit(1);
  });

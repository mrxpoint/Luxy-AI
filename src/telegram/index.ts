/**
 * Telegram process entrypoint — bot polling + notifications worker.
 * Run: pnpm dev:telegram
 */
import { startBot, stopBot, botConfigured } from './bot.js';
import { startNotificationsWorker } from './notifications.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'telegram-main' });

async function main(): Promise<void> {
  if (!botConfigured()) {
    log.warn('TELEGRAM_BOT_TOKEN missing — starting in drain-only mode (queue consumer, no polling)');
  } else {
    await startBot();
  }
  const worker = startNotificationsWorker();

  const shutdown = async (): Promise<void> => {
    log.info('shutting down telegram process...');
    await stopBot();
    await worker?.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'telegram process crashed');
  process.exit(1);
});

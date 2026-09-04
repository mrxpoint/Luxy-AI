/**
 * Notifications worker — consumes the `notifications` queue and delivers to
 * Telegram (1 msg/sec rate limit is enforced by the queue's rateLimiter,
 * BLUEPRINT.md §5.2).
 */
import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendTelegram } from './bot.js';
import type { NotificationJob } from '../types/index.js';

const log = logger.child({ module: 'notifications' });

export function startNotificationsWorker(): Worker<NotificationJob> | null {
  if (!config.TELEGRAM_BOT_TOKEN) {
    log.info('telegram not configured — notifications worker not started (jobs still drain)');
  }
  const worker = new Worker<NotificationJob>(
    'notifications',
    async (job) => {
      await sendTelegram(`[${job.data.type.toUpperCase()}] ${job.data.text}`);
      log.debug({ type: job.data.type }, 'notification delivered');
    },
    {
      connection: { url: config.REDIS_URL },
    },
  );
  worker.on('failed', (job, err) => log.warn({ err, jobId: job?.id }, 'notification failed'));
  return worker;
}

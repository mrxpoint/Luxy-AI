/**
 * BullMQ queue definitions (BLUEPRINT.md §5.2).
 *
 *   signals       screener/narrative → luxy-agent   (retry 3, backoff 5s)
 *   intents       luxy/perps/lp → executor          (retry 1)
 *   notifications all → telegram-bot                (retry 2, 1 msg/sec)
 */
import { Queue } from 'bullmq';
import { config } from '../config/index.js';
import type { LuxyIntent, NotificationJob, ScoredCandidate, PoolCandidate, PerpsSignal } from '../types/index.js';

const connection = { url: config.REDIS_URL };

/** Generic default job options per queue (BLUEPRINT.md §5.2). */
const signalsOpts = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
  },
};

const intentsOpts = {
  connection,
  defaultJobOptions: {
    attempts: 1, // idempotency is enforced at the executor
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
};

const notificationsOpts = {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
    // Telegram hard limit: 1 message/second per chat.
    rateLimiter: { max: 1, duration: 1_000 },
  },
};

export interface SignalJobData {
  kind: 'candidate' | 'narrative' | 'perps' | 'lp';
  candidate?: ScoredCandidate;
  narrative?: ScoredCandidate & { narrative?: unknown };
  perps?: PerpsSignal;
  pool?: PoolCandidate;
}

export const signalQueue = new Queue<SignalJobData>('signals', signalsOpts);
export const intentQueue = new Queue<LuxyIntent>('intents', intentsOpts);
export const notificationQueue = new Queue<NotificationJob>('notifications', notificationsOpts);

export async function closeQueues(): Promise<void> {
  await Promise.all([signalQueue.close(), intentQueue.close(), notificationQueue.close()]);
}

/** Fire-and-forget notification enqueue (never throws). */
export async function notify(text: string, type: NotificationJob['type'] = 'info'): Promise<void> {
  try {
    await notificationQueue.add('notify', { text, type });
  } catch {
    // swallow — notifications are best-effort by design
  }
}

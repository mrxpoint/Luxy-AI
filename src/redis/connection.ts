/**
 * Shared Redis connection helpers beyond BullMQ queues:
 *  - luxy:paused   global pause flag (BLUEPRINT.md §7.3)
 *  - price caches  short-TTL market data cache
 */
import { Redis } from 'ioredis';
import { config } from '../config/index.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  lazyConnect: false,
});

export const PAUSE_KEY = 'luxy:paused';

export async function isPaused(): Promise<boolean> {
  try {
    return (await redis.get(PAUSE_KEY)) === '1';
  } catch {
    // Fail-open for screeners, fail-closed for the executor (checked there too).
    return false;
  }
}

export async function setPaused(paused: boolean): Promise<void> {
  if (paused) await redis.set(PAUSE_KEY, '1');
  else await redis.del(PAUSE_KEY);
}

/** Simple cache-get with JSON deserialization. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Simple cache-set with TTL seconds. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // best-effort cache
  }
}

/** Dedupe helper for screeners: true if this key was seen recently. */
export async function seenRecently(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const set = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return set !== 'OK';
  } catch {
    return false;
  }
}

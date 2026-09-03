/**
 * Candle store — OHLCV persistence + caching (BLUEPRINT.md §8.1 / §8.3, Phase 4).
 *
 * The `candles` table becomes a TimescaleDB hypertable automatically when the
 * extension exists (see db/schema.sql); on plain PostgreSQL it is a normal
 * indexed table with identical behavior at this scale.
 *
 * Redis hot keys per §8.3: `price:<symbol>` (30s TTL) for the latest close.
 */
import { Pool } from 'pg';
import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { Candle } from '../types/index.js';

const log = logger.child({ module: 'candles' });

const globalStore = globalThis as unknown as { luxyCandlePool?: Pool; luxyCandleRedis?: Redis };

function pool(): Pool {
  globalStore.luxyCandlePool ??= new Pool({ connectionString: config.DATABASE_URL, max: 3 });
  return globalStore.luxyCandlePool;
}

function redis(): Redis | null {
  try {
    globalStore.luxyCandleRedis ??= new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    return globalStore.luxyCandleRedis;
  } catch {
    return null;
  }
}

export interface CandleKey {
  chain: string;
  token: string;
  timeframe?: string;
}

/** Upsert a batch of candles (idempotent — re-ingesting the same bar is a no-op). */
export async function upsertCandles(key: CandleKey, candles: Candle[]): Promise<number> {
  if (candles.length === 0) return 0;
  const timeframe = key.timeframe ?? '1h';
  let written = 0;
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    for (const c of candles) {
      const res = await client.query(
        `INSERT INTO candles (chain, token, timeframe, ts, o, h, l, c, v)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8, $9)
         ON CONFLICT (chain, token, timeframe, ts) DO NOTHING`,
        [key.chain, key.token, timeframe, c.t, c.o, c.h, c.l, c.c, c.v],
      );
      written += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    log.warn({ err }, 'candle upsert failed');
    return 0;
  } finally {
    client.release();
  }

  // Hot price cache (BLUEPRINT §8.3): price:<symbol> with 30s TTL.
  const r = redis();
  if (r && candles.length > 0) {
    const last = candles[candles.length - 1];
    r.set(`price:${key.token}`, String(last.c), 'EX', 30).catch(() => undefined);
  }
  return written;
}

/** Read candles newest→oldest ascending for a window of hours. */
export async function readCandles(key: CandleKey, hours = 48): Promise<Candle[]> {
  const timeframe = key.timeframe ?? '1h';
  try {
    const res = await pool().query<{ ts: Date; o: number; h: number; l: number; c: number; v: number }>(
      `SELECT ts, o, h, l, c, v FROM candles
       WHERE chain = $1 AND token = $2 AND timeframe = $3 AND ts >= NOW() - ($4 || ' hours')::interval
       ORDER BY ts ASC`,
      [key.chain, key.token, timeframe, String(hours)],
    );
    return res.rows.map((r) => ({
      t: new Date(r.ts).getTime(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));
  } catch (err) {
    log.warn({ err }, 'candle read failed');
    return [];
  }
}

/** Count distinct ingested series (for the ingest process health log). */
export async function candleStats(): Promise<{ series: number; rows: number } | null> {
  try {
    const res = await pool().query<{ series: string; rows: string }>(
      `SELECT COUNT(DISTINCT (chain, token, timeframe))::text AS series, COUNT(*)::text AS rows FROM candles`,
    );
    return { series: Number(res.rows[0]?.series ?? 0), rows: Number(res.rows[0]?.rows ?? 0) };
  } catch {
    return null;
  }
}

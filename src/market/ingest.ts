/**
 * Candle ingest process — TimescaleDB OHLCV feed (BLUEPRINT.md §8.1, Phase 4).
 *
 * Every CANDLES_INTERVAL_MIN minutes:
 *   1. Hyperliquid top-10 perps markets (free, no key) — the reliable feed.
 *   2. Recent Solana signal tokens via Birdeye OHLCV (when BIRDEYE_API_KEY
 *      is present).
 * Candles are upserted idempotently; a TimescaleDB hypertable is used
 * automatically when the extension is installed, else plain PostgreSQL.
 *
 * Run: pnpm dev:candles
 */
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { fetchCandles as fetchHyperliquidCandles } from '../agents/perps/hyperliquid.js';
import { upsertCandles, candleStats } from './candles.js';
import type { Candle } from '../types/index.js';

const log = logger.child({ module: 'candle-ingest' });

const PERPS_MARKETS = ['BTC', 'ETH', 'SOL', 'ARB', 'AVAX', 'DOGE', 'WIF', 'PEPE', 'BNB', 'MATIC'];

async function ingestHyperliquid(hours: number): Promise<void> {
  for (const market of PERPS_MARKETS) {
    try {
      const candles = await fetchHyperliquidCandles(market, '1h', hours);
      const written = await upsertCandles({ chain: 'hyperliquid', token: market }, candles);
      log.debug({ market, candles: candles.length, written }, 'hl candles ingested');
    } catch (err) {
      log.debug({ err, market }, 'hyperliquid candle fetch failed');
    }
  }
}

async function ingestSolanaSignals(hours: number): Promise<void> {
  // Birdeye path is optional — without a key the hyperliquid feed alone runs.
  try {
    const res = await query<{ token: string }>(
      `SELECT DISTINCT token FROM signals
       WHERE chain = 'solana' AND token IS NOT NULL AND created_at >= NOW() - interval '24 hours'
       LIMIT 10`,
    );
    for (const row of res.rows) {
      try {
        const candles = await birdeyeOhlcv(row.token, hours);
        await upsertCandles({ chain: 'solana', token: row.token }, candles);
      } catch (err) {
        log.debug({ err, token: row.token }, 'birdeye candle fetch failed');
      }
    }
  } catch (err) {
    log.debug({ err }, 'signal token query failed');
  }
}

/** Minimal Birdeye OHLCV client (unauthorized vs keyed both tolerated). */
async function birdeyeOhlcv(address: string, hours: number): Promise<Candle[]> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.BIRDEYE_API_KEY) headers['X-API-KEY'] = config.BIRDEYE_API_KEY;
  const url =
    `https://public-api.birdeye.so/defi/ohlcv?address=${address}` +
    `&type=1H&time_from=${Math.floor((Date.now() - hours * 3600_000) / 1000)}` +
    `&time_to=${Math.floor(Date.now() / 1000)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`birdeye ohlcv -> ${res.status}`);
    const data = (await res.json()) as { data?: { items?: Array<Record<string, number>> } };
    return (data.data?.items ?? []).map((i) => ({
      t: Number(i.unixTime) * 1000,
      o: Number(i.o ?? 0),
      h: Number(i.h ?? 0),
      l: Number(i.l ?? 0),
      c: Number(i.c ?? 0),
      v: Number(i.v ?? 0),
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function cycle(): Promise<void> {
  const hours = Math.min(Math.max(config.CANDLES_BACKFILL_HOURS, 6), 168);
  await ingestHyperliquid(hours);
  await ingestSolanaSignals(hours);
  const stats = await candleStats();
  log.info({ stats }, 'candle ingest cycle done');
}

async function main(): Promise<void> {
  log.info(
    { intervalMin: config.CANDLES_INTERVAL_MIN, backfillHours: config.CANDLES_BACKFILL_HOURS },
    'candle ingest starting',
  );
  await cycle().catch((err) => log.error({ err }, 'candle ingest cycle failed'));
  setInterval(
    () => cycle().catch((err) => log.error({ err }, 'candle ingest cycle failed')),
    config.CANDLES_INTERVAL_MIN * 60_000,
  );
}

main().catch((err) => {
  log.fatal({ err }, 'candle ingest crashed');
  process.exit(1);
});

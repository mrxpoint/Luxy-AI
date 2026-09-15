/**
 * Historical data fetch — cache-first (BLUEPRINT.md §9.5).
 * Hyperliquid candleSnapshot + Timescale upsert/read.
 */
import { fetchCandles as fetchHlCandles } from '../agents/perps/hyperliquid.js';
import { upsertCandles, readCandles } from './candles.js';
import { fetchOhlcv, birdeyeConfigured } from '../screener/birdeye.js';
import { logger } from '../utils/logger.js';
import type { Candle } from '../types/index.js';

const log = logger.child({ module: 'historical' });

export interface HistoricalFetchRequest {
  venue: 'hyperliquid' | 'birdeye' | 'polymarket';
  symbolOrMarket: string;
  interval?: string;
  fromMs?: number;
  toMs?: number;
  days?: number;
  resolvedOnly?: boolean;
}

export interface HistoricalFetchResult {
  venue: string;
  series: Candle[];
  cached: boolean;
  source: 'api' | 'timescaledb' | 'partial_cache';
  note?: string;
}

/** Map interval string to approximate hours coverage helper. */
function daysToHours(days: number): number {
  return Math.max(1, days) * 24;
}

/**
 * Fetch OHLCV with Timescale cache-first for Hyperliquid.
 * Birdeye/Polymarket return empty series with a note when not yet wired for range pull.
 */
export async function fetchHistorical(req: HistoricalFetchRequest): Promise<HistoricalFetchResult> {
  const interval = req.interval ?? '1h';
  const days = req.days ?? 30;
  const hours = req.fromMs && req.toMs
    ? Math.max(1, Math.ceil((req.toMs - req.fromMs) / 3600_000))
    : daysToHours(days);

  if (req.venue === 'hyperliquid') {
    const coin = req.symbolOrMarket.toUpperCase();
    const chain = 'hyperliquid';
    const cached = await readCandles({ chain, token: coin, timeframe: interval }, hours);
    const needApi = cached.length < Math.max(10, hours * 0.3);

    if (!needApi) {
      return { venue: 'hyperliquid', series: cached, cached: true, source: 'timescaledb' };
    }

    try {
      const series = await fetchHlCandles(coin, interval, hours);
      if (series.length > 0) {
        await upsertCandles({ chain, token: coin, timeframe: interval }, series);
      }
      const merged = series.length > 0 ? series : cached;
      return {
        venue: 'hyperliquid',
        series: merged,
        cached: series.length === 0 && cached.length > 0,
        source: series.length > 0 && cached.length > 0 ? 'partial_cache' : series.length > 0 ? 'api' : 'timescaledb',
      };
    } catch (err) {
      log.warn({ err, coin }, 'hyperliquid historical fetch failed');
      return {
        venue: 'hyperliquid',
        series: cached,
        cached: true,
        source: 'timescaledb',
        note: 'api failed — returned cache only',
      };
    }
  }

  if (req.venue === 'birdeye') {
    const mint = req.symbolOrMarket;
    const chain = 'solana';
    if (!birdeyeConfigured()) {
      return {
        venue: 'birdeye',
        series: [],
        cached: false,
        source: 'api',
        note: 'BIRDEYE_API_KEY not configured',
      };
    }
    const cached = await readCandles({ chain, token: mint, timeframe: interval }, hours);
    const needApi = cached.length < Math.max(10, hours * 0.3);
    if (!needApi) {
      return { venue: 'birdeye', series: cached, cached: true, source: 'timescaledb' };
    }
    try {
      const series = await fetchOhlcv(mint, hours);
      if (series.length > 0) {
        await upsertCandles({ chain, token: mint, timeframe: interval }, series);
      }
      const merged = series.length > 0 ? series : cached;
      return {
        venue: 'birdeye',
        series: merged,
        cached: series.length === 0 && cached.length > 0,
        source: series.length > 0 && cached.length > 0 ? 'partial_cache' : series.length > 0 ? 'api' : 'timescaledb',
      };
    } catch (err) {
      log.warn({ err, mint }, 'birdeye historical fetch failed');
      return {
        venue: 'birdeye',
        series: cached,
        cached: true,
        source: 'timescaledb',
        note: 'api failed — returned cache only',
      };
    }
  }

  // polymarket — only data the API provides; no fabricated series
  return {
    venue: 'polymarket',
    series: [],
    cached: false,
    source: 'api',
    note: req.resolvedOnly
      ? 'resolved market series: wire Gamma history when endpoint available for the market'
      : 'polymarket historical price series depends on Gamma/CLOB availability per market',
  };
}

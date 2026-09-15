/**
 * Perps signal computation (BLUEPRINT.md §6.4).
 *
 * Per market, every 15 minutes:
 *   1. Fetch 1h candles for the last 24h
 *   2. Compute 24h momentum, 12h SMA, 4-candle volatility
 *   3. Classify: long (mom > +5% & above SMA) / short (< -5% & below) / neutral
 */
import { fetchCandles } from './hyperliquid.js';
import { config } from '../../config/index.js';
import type { PerpsSignal } from '../../types/index.js';

export const PERPS_MARKETS = ['BTC', 'ETH', 'SOL', 'ARB', 'AVAX', 'DOGE', 'WIF', 'PEPE', 'BNB', 'MATIC'] as const;

export async function computeSignal(market: string): Promise<PerpsSignal | null> {
  const candles = await fetchCandles(market, '1h', 24);
  if (candles.length < 14) return null;

  const closes = candles.map((c) => c.c);
  const price = closes[closes.length - 1]!;
  const momentum24h = (closes[closes.length - 1]! - closes[0]!) / closes[0]!;
  const sma12h = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const last4 = candles.slice(-4);
  const volatility = last4.reduce((acc, c) => acc + (c.h - c.l) / (c.o || 1), 0) / last4.length;

  let direction: PerpsSignal['direction'] = 'neutral';
  let score = 0.3;

  if (momentum24h > 0.05 && price > sma12h) {
    direction = 'long';
    score = 0.7 + Math.min(0.2, momentum24h / 2);
  } else if (momentum24h < -0.05 && price < sma12h) {
    direction = 'short';
    score = 0.6 + Math.min(0.2, -momentum24h / 2);
  }

  return { market, direction, score: Math.min(1, score), momentum24h, sma12h, volatility, price };
}

export async function scanAllMarkets(): Promise<PerpsSignal[]> {
  const out: PerpsSignal[] = [];
  for (const m of PERPS_MARKETS) {
    try {
      const s = await computeSignal(m);
      if (s) out.push(s);
    } catch (err) {
      // per-market failures shouldn't kill the scan
      void err;
    }
  }
  return out;
}

/** Max $200 per trade — Phase 2 conservative limit (BLUEPRINT §6.4). */
export const PERPS_MAX_TRADE_USD = 200;
/** Exit thresholds managed at executor layer, never the LLM. */
export const PERPS_EXIT_LOSS_PCT = -0.08;
export const PERPS_EXIT_PROFIT_PCT = 0.15;
export const perpsDryRunFlag = (): boolean => config.DRY_RUN;

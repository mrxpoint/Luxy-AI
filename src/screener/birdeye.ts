/**
 * Birdeye client (BLUEPRINT.md §9.1) — token overview + OHLCV.
 * Free tier: 30K CU/month. Without an API key the screener degrades to
 * DexScreener-only scoring.
 */
import { getJson } from '../utils/http.js';
import { config } from '../config/index.js';
import type { Candle } from '../types/index.js';

const BASE = 'https://public-api.birdeye.so';

function headers(): Record<string, string> {
  if (!config.BIRDEYE_API_KEY) throw new Error('BIRDEYE_API_KEY not configured');
  return { 'X-API-KEY': config.BIRDEYE_API_KEY, accept: 'application/json' };
}

export function birdeyeConfigured(): boolean {
  return config.BIRDEYE_API_KEY.length > 0;
}

export interface TokenOverview {
  address: string;
  symbol: string;
  name: string;
  price: number;
  liquidity: number;
  v24hUSD: number;
  trade24h: number;
  mc?: number;
  holder?: number;
}

export async function fetchTokenOverview(address: string): Promise<TokenOverview> {
  const data = await getJson<{ data?: { value?: TokenOverview } }>(
    `${BASE}/defi/token_overview?address=${address}`,
    headers(),
  );
  const v = data.data?.value;
  if (!v) throw new Error(`birdeye token_overview empty for ${address}`);
  return v;
}

/** OHLCV candles (oldest first). `timeType` 15 = 1H candles, `type` = 24H window. */
export async function fetchOhlcv(address: string, hours = 24): Promise<Candle[]> {
  const data = await getJson<{
    data?: { items?: Array<{ unixTime: number; o: number; h: number; l: number; c: number; v: number }> };
  }>(
    `${BASE}/defi/ohlcv?address=${address}&type=1H&time_from=${Math.floor(Date.now() / 1000) - hours * 3600}&time_to=${Math.floor(Date.now() / 1000)}`,
    headers(),
  );
  return (data.data?.items ?? []).map((i) => ({
    t: i.unixTime * 1000,
    o: i.o,
    h: i.h,
    l: i.l,
    c: i.c,
    v: i.v,
  }));
}

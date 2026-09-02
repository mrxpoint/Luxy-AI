/**
 * DexScreener client (free, 300 req/min — BLUEPRINT.md §9.1).
 *
 * Used by the Meme Agent screener to discover trending Solana pairs and
 * their volume/liquidity/txn stats.
 */
import { getJson } from '../utils/http.js';
import type { Candle } from '../types/index.js';

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  marketCap?: number;
  fdv?: number;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
}

/** Search pairs by query and keep Solana-chain results. */
export async function fetchSolanaPairs(query = 'SOL'): Promise<DexPair[]> {
  const data = await getJson<{ pairs: DexPair[] | null }>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  return (data.pairs ?? []).filter((p) => p.chainId === 'solana');
}

/** Token boost / trending proxy: latest boosted tokens (mostly Solana memes). */
export async function fetchLatestProfiles(): Promise<Array<{ tokenAddress: string; chainId: string }>> {
  const data = await getJson<Array<{ tokenAddress: string; chainId: string }>>(
    'https://api.dexscreener.com/token-profiles/latest/v1',
  );
  return data.filter((t) => t.chainId === 'solana');
}

/** Batch pair lookup by token addresses (up to 30 per call). */
export async function fetchPairsByTokens(addresses: string[]): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));
  const out: DexPair[] = [];
  for (const chunk of chunks) {
    const data = await getJson<{ pairs: DexPair[] | null }>(
      `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
    );
    out.push(...(data.pairs ?? []).filter((p) => p.chainId === 'solana'));
  }
  return out;
}

/**
 * OHLCV candles are served by Birdeye (see birdeye.ts). DexScreener does not
 * expose candles on the free tier — this helper builds coarse 1h candles from
 * price snapshots if needed, otherwise returns empty and the agent falls back
 * to Birdeye.
 */
export function synthesizeCandlesFromPriceChanges(pair: DexPair): Candle[] {
  // Coarse reconstruction is unreliable; return empty to signal "no candles".
  void pair;
  return [];
}

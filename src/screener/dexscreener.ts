/**
 * DexScreener client (free, 300 req/min — BLUEPRINT.md §9.1).
 *
 * Used by the Meme Agent screener to discover trending pairs and their
 * volume/liquidity/txn stats. Chain-aware since Phase 3: Solana + Base +
 * Ethereum (BLUEPRINT.md §9.3 — EVM meme support rides the same free API).
 */
import { getJson } from '../utils/http.js';
import type { Candle } from '../types/index.js';

export type DexChainId = 'solana' | 'base' | 'ethereum';

export const SCREENER_CHAINS: DexChainId[] = ['solana', 'base', 'ethereum'];

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

/** Search pairs by query and keep the requested chain results. */
export async function fetchPairsForChains(query: string, chains: DexChainId[]): Promise<DexPair[]> {
  const data = await getJson<{ pairs: DexPair[] | null }>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  return (data.pairs ?? []).filter((p) => (chains as string[]).includes(p.chainId));
}

/** Back-compat: Solana-only search. */
export async function fetchSolanaPairs(query = 'SOL'): Promise<DexPair[]> {
  return fetchPairsForChains(query, ['solana']);
}

/** Token boost / trending proxy: latest boosted tokens per chain. */
export async function fetchLatestProfiles(chains: DexChainId[] = ['solana']): Promise<Array<{ tokenAddress: string; chainId: string }>> {
  const data = await getJson<Array<{ tokenAddress: string; chainId: string }>>(
    'https://api.dexscreener.com/token-profiles/latest/v1',
  );
  return data.filter((t) => (chains as string[]).includes(t.chainId));
}

/** Batch pair lookup by token addresses (up to 30 per call), filtered per chain. */
export async function fetchPairsByTokens(addresses: string[], chains: DexChainId[] = ['solana']): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));
  const out: DexPair[] = [];
  for (const chunk of chunks) {
    const data = await getJson<{ pairs: DexPair[] | null }>(
      `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
    );
    out.push(...(data.pairs ?? []).filter((p) => (chains as string[]).includes(p.chainId)));
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

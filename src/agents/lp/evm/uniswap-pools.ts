/**
 * Uniswap v3 pool data via The Graph subgraph (BLUEPRINT.md §9.3).
 *
 * Pool queries power the EVM Hunter; native-token pricing (from the free
 * DexScreener API) feeds the gas cost optimizer used by the EVM Healer.
 */
import { getJson, postJson } from '../../../utils/http.js';
import { config } from '../../../config/index.js';
import { EVM_TOKENS } from '../../../executor/uniswap.js';

export interface UniswapPool {
  id: string;
  chain: 'base' | 'ethereum';
  pairLabel: string;
  feeTier: number;
  tvlUsd: number;
  volume24h: number;
  fees24h: number;
  txCount24h: number;
}

interface SubgraphPool {
  id: string;
  feeTier: string;
  token0: { symbol: string };
  token1: { symbol: string };
  totalValueLockedUSD: string;
  poolDayData: Array<{ volumeUSD: string; feesUSD: string; txCount: string }>;
}

const POOLS_QUERY = `
query topPools($first: Int!) {
  pools(first: $first, orderBy: volumeUSD, orderDirection: desc, where: { liquidity_gt: "0" }) {
    id
    feeTier
    token0 { symbol }
    token1 { symbol }
    totalValueLockedUSD
    poolDayData(first: 1, orderBy: date, orderDirection: desc) {
      volumeUSD
      feesUSD
      txCount
    }
  }
}`;

/** Fetch the highest-volume Uniswap v3 pools on the given chain. */
export async function fetchUniswapPools(
  chain: 'base' | 'ethereum',
  first = 30,
): Promise<UniswapPool[]> {
  const endpoint =
    chain === 'ethereum'
      ? config.UNISWAP_SUBGRAPH_ETH
      : (process.env.UNISWAP_SUBGRAPH_BASE ?? config.UNISWAP_SUBGRAPH_ETH);
  const data = await postJson<{ data?: { pools?: SubgraphPool[] } }>(endpoint, {
    query: POOLS_QUERY,
    variables: { first },
  });
  const pools = data.data?.pools ?? [];
  return pools.map((p) => {
    const day = p.poolDayData?.[0];
    return {
      id: p.id,
      chain,
      pairLabel: `${p.token0.symbol}/${p.token1.symbol}`,
      feeTier: Number(p.feeTier),
      tvlUsd: Number(p.totalValueLockedUSD),
      volume24h: Number(day?.volumeUSD ?? 0),
      fees24h: Number(day?.feesUSD ?? 0),
      txCount24h: Number(day?.txCount ?? 0),
    };
  });
}

/** Native gas token price in USD via DexScreener (WETH on the chain). */
export async function nativeTokenPriceUsd(chain: 'base' | 'ethereum'): Promise<number> {
  const weth = EVM_TOKENS[chain].weth;
  try {
    const data = await getJson<{ pairs?: Array<{ priceUsd?: string }> }>(
      `https://api.dexscreener.com/latest/dex/tokens/${weth}`,
    );
    const pairs = (data.pairs ?? []).filter((p) => p.priceUsd);
    // Prefer the deepest liquidity pair's price (first returned is usually canonical).
    return pairs.length > 0 ? Number(pairs[0].priceUsd) : 0;
  } catch {
    return 0;
  }
}

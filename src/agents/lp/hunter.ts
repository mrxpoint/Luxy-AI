/**
 * Hunter — LP pool screener, pure bot layer (BLUEPRINT.md §6.3).
 * Scans Meteora DLMM pools and scores them on fee yield, TVL, and
 * volume/TVL organic activity. No LLM calls.
 */
import { fetchPools, poolTvlUsd, poolVolume24h, poolFees24h, type MeteoraPool } from './meteora.js';
import type { PoolCandidate } from '../../types/index.js';

export function scorePool(p: MeteoraPool): PoolCandidate {
  const tvl = poolTvlUsd(p);
  const vol = poolVolume24h(p);
  const fees = poolFees24h(p);
  const feeTvlRatio = tvl > 0 ? fees / tvl : 0;
  const volTvl = tvl > 0 ? vol / tvl : 0;

  // Organic score: volume relative to TVL + fee yield. Purely rule-based.
  let organic = 0;
  if (volTvl > 1) organic += 0.35;
  else if (volTvl > 0.3) organic += 0.2;
  if (feeTvlRatio > 0.001) organic += 0.3;
  else if (feeTvlRatio > 0.0005) organic += 0.15;
  if (tvl > 1_000_000) organic += 0.2;
  else if (tvl > 200_000) organic += 0.1;
  if (p.bin_step <= 25) organic += 0.15; // tighter bins ≈ active market

  return {
    poolId: p.address,
    chain: 'solana',
    pairLabel: p.name,
    address: p.address,
    tvlUsd: tvl,
    volume24h: vol,
    fees24h: fees,
    feeTvlRatio,
    binStep: p.bin_step,
    organicScore: organic,
    score: Math.min(1, organic),
  };
}

export async function huntCandidates(minScore = 0.5, limit = 10): Promise<PoolCandidate[]> {
  const pools = await fetchPools(60);
  return pools
    .map(scorePool)
    .filter((c) => c.score >= minScore && c.tvlUsd >= 50_000)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

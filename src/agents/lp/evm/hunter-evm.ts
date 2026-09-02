/**
 * Hunter (EVM) — Uniswap v3 pool screener, pure bot layer (BLUEPRINT.md
 * §6.3 adapted to §9.3 for Base/Ethereum). Same scoring philosophy as the
 * Meteora Hunter: fee yield, TVL, volume/TVL organic activity — no LLM.
 */
import type { PoolCandidate } from '../../../types/index.js';
import { fetchUniswapPools, type UniswapPool } from './uniswap-pools.js';

export function scoreEvmPool(p: UniswapPool): PoolCandidate {
  const feeTvlRatio = p.tvlUsd > 0 ? p.fees24h / p.tvlUsd : 0;
  const volTvl = p.tvlUsd > 0 ? p.volume24h / p.tvlUsd : 0;

  // Organic score — mirrors the Meteora Hunter thresholds.
  let organic = 0;
  if (volTvl > 1) organic += 0.35;
  else if (volTvl > 0.3) organic += 0.2;
  if (feeTvlRatio > 0.001) organic += 0.3;
  else if (feeTvlRatio > 0.0005) organic += 0.15;
  if (p.tvlUsd > 1_000_000) organic += 0.2;
  else if (p.tvlUsd > 200_000) organic += 0.1;
  if (p.txCount24h > 500) organic += 0.15;

  // feeTier ≈ binStep analog (3% → 3000 bps; tighter tiers ≈ active markets).
  const binStepAnalog = Math.round(p.feeTier / 100);

  return {
    poolId: p.id,
    chain: p.chain,
    pairLabel: `${p.pairLabel} (${(p.feeTier / 10_000).toFixed(2)}%)`,
    address: p.id,
    tvlUsd: p.tvlUsd,
    volume24h: p.volume24h,
    fees24h: p.fees24h,
    feeTvlRatio,
    binStep: binStepAnalog,
    organicScore: organic,
    score: Math.min(1, organic),
  };
}

export async function huntEvmCandidates(
  minScore = 0.5,
  limit = 6,
): Promise<PoolCandidate[]> {
  const chains: Array<'base' | 'ethereum'> = ['base', 'ethereum'];
  const results: PoolCandidate[] = [];
  for (const chain of chains) {
    try {
      const pools = await fetchUniswapPools(chain, 30);
      results.push(
        ...pools
          .map(scoreEvmPool)
          .filter((c) => c.score >= minScore && c.tvlUsd >= 100_000),
      );
    } catch {
      // subgraph unreachable — skip this chain, never crash the loop
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

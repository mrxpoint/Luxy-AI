/**
 * Rule-based candidate scoring (BLUEPRINT.md §6.2).
 * Pure function — no LLM, no I/O. Output clamped to [0, 1].
 */
import type { DexPair } from './dexscreener.js';

export interface ScoreBreakdown {
  score: number;
  deltas: Array<{ rule: string; delta: number }>;
}

export function scorePair(pair: DexPair): ScoreBreakdown {
  const deltas: Array<{ rule: string; delta: number }> = [];
  const add = (rule: string, delta: number): void => {
    deltas.push({ rule, delta });
  };

  const liquidity = pair.liquidity?.usd ?? 0;
  const volume24h = pair.volume?.h24 ?? 0;
  const txns24h = (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0);
  const vl = liquidity > 0 ? volume24h / liquidity : 0;
  const momentum = pair.priceChange?.h24 ?? 0;
  const marketCap = pair.marketCap ?? pair.fdv ?? 0;

  if (vl > 3) add('volume/liquidity > 3x', +0.25);
  else if (vl > 1) add('volume/liquidity > 1x', +0.15);

  if (liquidity > 100_000) add('liquidity > $100k', +0.20);
  else if (liquidity > 50_000) add('liquidity > $50k', +0.10);

  if (txns24h > 1000) add('txns24h > 1000', +0.15);
  else if (txns24h > 500) add('txns24h > 500', +0.08);

  if (marketCap > 0 && marketCap < 10_000_000) add('market cap < $10M', +0.10);

  if (momentum > 0) add('price momentum positive', +0.10);

  if (liquidity < 20_000) add('liquidity < $20k (rug risk)', -0.30);
  if (volume24h < 5_000) add('volume 24h < $5k', -0.20);

  const raw = deltas.reduce((acc, d) => acc + d.delta, 0);
  const score = Math.max(0, Math.min(1, raw));
  return { score, deltas };
}

/** Minimum score for a candidate to be LLM-filtered and queued (BLUEPRINT §2.2). */
export const SCORING_THRESHOLD = 0.45;

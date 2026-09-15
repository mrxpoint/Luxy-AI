/**
 * Feature engineering for LuxyEngine (BLUEPRINT.md §3.1.1).
 *
 * Pure functions over ScoredCandidate (+ optional candles). Outputs a flat
 * numeric feature map suitable for tree models and the baseline scorer.
 */
import type { ScoredCandidate } from '../types/index.js';
import type { EngineContext } from './types.js';

export function extractFeatures(
  candidate: ScoredCandidate,
  ctx: EngineContext = {},
): Record<string, number> {
  const liq = Math.max(candidate.liquidityUsd, 1);
  const vol = Math.max(candidate.volume24h, 0);
  const txns = Math.max(candidate.txns24h, 0);
  const price = Math.max(candidate.priceUsd, 1e-12);
  const mcap = candidate.marketCap && candidate.marketCap > 0 ? candidate.marketCap : liq * 10;

  const volLiq = vol / liq;
  const txnsLog = Math.log10(txns + 1);
  const liqLog = Math.log10(liq);
  const mcapLog = Math.log10(mcap);
  const ruleScore = clamp01(candidate.score);

  let verdictN = 0.5;
  if (candidate.llmVerdict === 'strong') verdictN = 1;
  else if (candidate.llmVerdict === 'moderate') verdictN = 0.7;
  else if (candidate.llmVerdict === 'weak') verdictN = 0.35;
  else if (candidate.llmVerdict === 'skip') verdictN = 0.1;

  const candles = candidate.candles ?? [];
  let ret1 = 0;
  let ret5 = 0;
  let volatility = 0;
  let volumeTrend = 0;
  if (candles.length >= 2) {
    const last = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;
    ret1 = (last.c - prev.c) / Math.max(prev.c, 1e-12);
  }
  if (candles.length >= 6) {
    const last = candles[candles.length - 1]!;
    const ago = candles[candles.length - 6]!;
    ret5 = (last.c - ago.c) / Math.max(ago.c, 1e-12);
  }
  if (candles.length >= 12) {
    const slice = candles.slice(-12);
    const closes = slice.map((c) => c.c);
    const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
    const varSum = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length;
    volatility = Math.sqrt(varSum) / Math.max(mean, 1e-12);
    const vols = slice.map((c) => c.v);
    const mid = Math.floor(vols.length / 2);
    const early = avg(vols.slice(0, mid)) || 1;
    const late = avg(vols.slice(mid)) || 0;
    volumeTrend = (late - early) / early;
  }

  const chainSolana = candidate.chain === 'solana' ? 1 : 0;
  const chainEvm = candidate.chain === 'base' || candidate.chain === 'ethereum' ? 1 : 0;
  const chainPerps = candidate.chain === 'hyperliquid' ? 1 : 0;

  return {
    rule_score: ruleScore,
    llm_verdict_n: verdictN,
    vol_liq_ratio: clamp(volLiq, 0, 50),
    log_txns_24h: txnsLog,
    log_liquidity: liqLog,
    log_mcap: mcapLog,
    price_usd: Math.min(price, 1e6),
    ret_1: clamp(ret1, -1, 1),
    ret_5: clamp(ret5, -1, 1),
    volatility_12: clamp(volatility, 0, 2),
    volume_trend_12: clamp(volumeTrend, -5, 5),
    chain_solana: chainSolana,
    chain_evm: chainEvm,
    chain_perps: chainPerps,
    open_positions: ctx.openPositions ?? 0,
    daily_drawdown_pct: clamp(ctx.dailyDrawdownPct ?? 0, 0, 1),
    hivemind_hit_rate: clamp01(ctx.hivemindHitRate ?? 0.5),
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

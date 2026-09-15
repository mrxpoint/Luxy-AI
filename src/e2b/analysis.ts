/**
 * In-session analysis tools (BLUEPRINT.md §4.4 / §4.6).
 *
 * Three analysis templates the Luxy agent must run before submitting an
 * entry intent:
 *   1. momentum backtest  → src/e2b/backtest.ts (existed since Phase 1)
 *   2. Kelly position sizing → kellySize() below
 *   3. liquidity depth check → checkLiquidityDepth() below
 *
 * When E2B is configured the equivalent Python templates are executed in
 * the sandbox (e2b/templates/*.py — identical math); without a key the
 * TypeScript implementations below run locally with the same formulas,
 * keeping dry-run parity.
 */
import type { BacktestResult } from '../types/index.js';

export interface KellySizeResult {
  kelly_fraction: number;
  fractional_kelly?: number;
  recommended_size_usd: number;
  odds_b?: number;
  reason: string;
}

/**
 * Quarter-Kelly by default. Output is advisory: the executor's hardcoded
 * 3%-of-portfolio guard always wins (BLUEPRINT.md §7).
 */
export function kellySize(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  portfolioUsd: number,
  fractionCap = 0.25,
): KellySizeResult {
  if (avgLoss <= 0 || portfolioUsd <= 0) {
    return { kelly_fraction: 0, recommended_size_usd: 0, reason: 'invalid inputs' };
  }
  const b = avgWin / avgLoss;
  const p = Math.min(Math.max(winRate, 0), 1);
  const q = 1 - p;
  const kelly = (b * p - q) / b;

  if (kelly <= 0) {
    return { kelly_fraction: 0, recommended_size_usd: 0, reason: 'negative edge — do not enter' };
  }

  const fractional = kelly * fractionCap;
  return {
    kelly_fraction: kelly,
    fractional_kelly: fractional,
    recommended_size_usd: Math.round(fractional * portfolioUsd * 100) / 100,
    odds_b: b,
    reason: 'ok',
  };
}

/** Derive Kelly inputs from a raw trade-return series (backtest output). */
export function kellyFromReturns(
  returns: number[],
  portfolioUsd: number,
  fractionCap = 0.25,
): KellySizeResult {
  if (returns.length === 0) {
    return { kelly_fraction: 0, recommended_size_usd: 0, reason: 'no trades' };
  }
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  return kellySize(
    wins.length / returns.length,
    wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
    losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1e-9,
    portfolioUsd,
    fractionCap,
  );
}

export interface LiquidityDepthResult {
  ok: boolean;
  impact: number;
  max_safe_entry_usd: number;
  liquidity_usd: number;
  entry_usd: number;
  reason: string;
}

/**
 * Constant-product depth approximation: relative impact ≈ (in / liquidity) / 2.
 * Mirrors e2b/templates/liquidity_depth.py and the executor's 2% slippage cap.
 */
export function checkLiquidityDepth(
  liquidityUsd: number,
  entryUsd: number,
  maxImpact = 0.02,
): LiquidityDepthResult {
  if (liquidityUsd <= 0 || entryUsd <= 0) {
    return {
      ok: false,
      impact: 1,
      max_safe_entry_usd: 0,
      liquidity_usd: liquidityUsd,
      entry_usd: entryUsd,
      reason: 'invalid inputs',
    };
  }
  const impact = entryUsd / (2 * liquidityUsd);
  const ok = impact <= maxImpact;
  return {
    ok,
    impact,
    max_safe_entry_usd: Math.round(maxImpact * 2 * liquidityUsd * 100) / 100,
    liquidity_usd: liquidityUsd,
    entry_usd: entryUsd,
    reason: ok ? 'ok' : `impact ${(impact * 100).toFixed(2)}% exceeds ${(maxImpact * 100).toFixed(1)}% budget`,
  };
}

/** One-shot helper: backtest → kelly → liquidity, for the agent context block. */
export function preflightAnalysis(input: {
  backtest: BacktestResult;
  tradeReturns?: number[];
  portfolioUsd: number;
  entryUsd: number;
  liquidityUsd: number;
}): {
  kelly: KellySizeResult;
  liquidity: LiquidityDepthResult;
  enterable: boolean;
  summary: string;
} {
  const kelly = input.tradeReturns?.length
    ? kellyFromReturns(input.tradeReturns, input.portfolioUsd)
    : kellySize(input.backtest.win_rate, Math.max(input.backtest.avg_return, 0.01), 0.08, input.portfolioUsd);
  const liquidity = checkLiquidityDepth(input.liquidityUsd, input.entryUsd);
  const enterable = input.backtest.win_rate >= 0.55 && input.backtest.n_trades >= 10 && liquidity.ok;
  const summary = [
    `win_rate=${(input.backtest.win_rate * 100).toFixed(0)}%`,
    `n=${input.backtest.n_trades}`,
    `kelly_size=$${kelly.recommended_size_usd}`,
    `liq_impact=${(liquidity.impact * 100).toFixed(2)}%`,
    enterable ? 'PREFLIGHT PASS' : 'PREFLIGHT FAIL',
  ].join(', ');
  return { kelly, liquidity, enterable, summary };
}

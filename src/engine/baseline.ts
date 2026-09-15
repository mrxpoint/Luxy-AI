/**
 * Baseline tabular scorer for LuxyEngine.
 *
 * Interpretable weighted linear combination with contribution breakdown.
 * Used when:
 *   - LUXY_ENGINE_BACKEND=baseline
 *   - or a heavy backend (lgbm/xgb/…) has no trained artifact loaded yet
 *
 * This is intentionally NOT claimed as a trained LightGBM model — it is a
 * production-safe default that matches the LuxyEnginePrediction interface
 * so the rest of the stack can integrate before model training lands.
 */
import type { EngineActionBias, FeatureContribution, LuxyEnginePrediction } from './types.js';

const WEIGHTS: Record<string, number> = {
  rule_score: 0.28,
  llm_verdict_n: 0.12,
  vol_liq_ratio: 0.14,
  log_txns_24h: 0.08,
  log_liquidity: 0.06,
  ret_5: 0.1,
  volume_trend_12: 0.08,
  volatility_12: -0.06,
  daily_drawdown_pct: -0.1,
  hivemind_hit_rate: 0.08,
  open_positions: -0.04,
};

const BIAS = 0.15;

export const BASELINE_MODEL_VERSION = 'baseline-v1';

export function predictBaseline(
  features: Record<string, number>,
  startedAt: number,
): LuxyEnginePrediction {
  const contributions: FeatureContribution[] = [];
  let raw = BIAS;

  for (const [name, w] of Object.entries(WEIGHTS)) {
    const x = features[name] ?? 0;
    // Normalize a few unbounded-ish features into roughly 0..1 for scoring
    let xn = x;
    if (name === 'vol_liq_ratio') xn = Math.min(x / 5, 1);
    else if (name === 'log_txns_24h') xn = Math.min(x / 4, 1);
    else if (name === 'log_liquidity') xn = Math.min(Math.max(x - 3, 0) / 5, 1);
    else if (name === 'ret_5') xn = (x + 1) / 2;
    else if (name === 'volume_trend_12') xn = (clamp(x, -1, 1) + 1) / 2;
    else if (name === 'volatility_12') xn = Math.min(x / 0.5, 1);
    else if (name === 'open_positions') xn = Math.min(x / 5, 1);

    const c = w * xn;
    raw += c;
    contributions.push({ name, contribution: c });
  }

  const score = sigmoid(raw);
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = contributions.slice(0, 8);

  const action_bias = biasFromScore(score, features);
  const confidence = Math.min(0.95, 0.35 + Math.abs(score - 0.5) * 1.2);

  return {
    score,
    confidence,
    action_bias,
    top_features: top,
    model: 'baseline',
    model_version: BASELINE_MODEL_VERSION,
    raw_features: { ...features },
    inference_ms: Math.max(0, Date.now() - startedAt),
    created_at: new Date().toISOString(),
  };
}

function biasFromScore(score: number, features: Record<string, number>): EngineActionBias {
  if ((features.daily_drawdown_pct ?? 0) >= 0.07) return 'skip';
  if (score >= 0.62) return 'entry';
  if (score >= 0.48) return 'watch';
  return 'skip';
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

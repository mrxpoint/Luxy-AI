/**
 * Train / fit LuxyEngine tabular weights from historical outcomes.
 *
 * Builds labeled feature rows from closed positions (+ optional signals),
 * runs a simple logistic gradient fit in pure TypeScript, and writes:
 *   - models/engine-baseline-<stamp>.json  (artifact)
 *   - engine_models registry row (active optional)
 *
 * This is the production-safe path without Python. For LightGBM/XGBoost,
 * use scripts/train_engine_lgbm.py on the exported JSONL (same feature keys).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { extractFeatures } from './features.js';
import type { ScoredCandidate } from '../types/index.js';
import type { EngineBackend } from './types.js';

const log = logger.child({ module: 'engine-train' });

export interface TrainedArtifact {
  backend: EngineBackend;
  version: string;
  weights: Record<string, number>;
  bias: number;
  feature_names: string[];
  metrics: { samples: number; winRate: number; logloss?: number };
  created_at: string;
}

export async function exportTrainingRows(limit = 500): Promise<
  Array<{ features: Record<string, number>; label: number; symbol?: string }>
> {
  const rows: Array<{ features: Record<string, number>; label: number; symbol?: string }> = [];

  // Prefer closed positions with stored intent/signal context when present
  try {
    const res = await query<{
      symbol: string | null;
      token: string | null;
      chain: string;
      size_usd: string | null;
      pnl_pct: number | null;
      intent: Record<string, unknown> | null;
    }>(
      `SELECT symbol, token, chain, size_usd, pnl_pct, intent
       FROM positions
       WHERE status = 'closed' AND pnl_pct IS NOT NULL
       ORDER BY closed_at DESC
       LIMIT $1`,
      [limit],
    );

    for (const r of res.rows) {
      const label = Number(r.pnl_pct) > 0 ? 1 : 0;
      const intent = r.intent ?? {};
      const candidate = synthesizeCandidate(r, intent);
      const features = extractFeatures(candidate);
      rows.push({ features, label, symbol: r.symbol ?? undefined });
    }
  } catch (err) {
    log.warn({ err }, 'export from positions failed');
  }

  if (rows.length < 20) {
    // Augment with signals: strong/moderate → pseudo-positive
    try {
      const sig = await query<{
        symbol: string | null;
        token: string | null;
        chain: string | null;
        score: number;
        llm_verdict: string | null;
        raw: Record<string, unknown> | null;
      }>(
        `SELECT symbol, token, chain, score, llm_verdict, raw
         FROM signals ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      for (const s of sig.rows) {
        const good =
          s.llm_verdict === 'strong' ||
          (s.llm_verdict === 'moderate' && Number(s.score) >= 0.65);
        const candidate: ScoredCandidate = {
          id: `sig-${s.token ?? 'x'}`,
          source: 'screener',
          agent: 'meme',
          chain: (s.chain as ScoredCandidate['chain']) || 'solana',
          token: s.token ?? 'unknown',
          symbol: s.symbol ?? 'UNK',
          priceUsd: Number(s.raw?.priceUsd ?? 1),
          liquidityUsd: Number(s.raw?.liquidityUsd ?? 50_000),
          volume24h: Number(s.raw?.volume24h ?? 10_000),
          txns24h: Number(s.raw?.txns24h ?? 100),
          score: Number(s.score) || 0.5,
          llmVerdict: (s.llm_verdict as ScoredCandidate['llmVerdict']) ?? undefined,
          rawData: s.raw ?? {},
          createdAt: new Date().toISOString(),
        };
        rows.push({ features: extractFeatures(candidate), label: good ? 1 : 0, symbol: s.symbol ?? undefined });
      }
    } catch (err) {
      log.debug({ err }, 'signal augment failed');
    }
  }

  return rows;
}

function synthesizeCandidate(
  r: {
    symbol: string | null;
    token: string | null;
    chain: string;
    size_usd: string | null;
  },
  intent: Record<string, unknown>,
): ScoredCandidate {
  return {
    id: `pos-${r.token ?? 'x'}`,
    source: 'screener',
    agent: 'meme',
    chain: (r.chain as ScoredCandidate['chain']) || 'solana',
    token: r.token ?? 'unknown',
    symbol: r.symbol ?? 'UNK',
    priceUsd: Number(intent.priceUsd ?? 1),
    liquidityUsd: Number(intent.liquidityUsd ?? 100_000),
    volume24h: Number(intent.volume24h ?? 50_000),
    txns24h: Number(intent.txns24h ?? 200),
    score: Number(intent.ruleScore ?? intent.confidence ?? 0.5),
    llmVerdict: (intent.llmVerdict as ScoredCandidate['llmVerdict']) ?? undefined,
    rawData: intent,
    createdAt: new Date().toISOString(),
  };
}

/** Logistic regression (one epoch batch GD) over feature map. */
export function fitLogisticWeights(
  rows: Array<{ features: Record<string, number>; label: number }>,
  epochs = 80,
  lr = 0.15,
): { weights: Record<string, number>; bias: number; logloss: number } {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.features)) keys.add(k);
  const feature_names = [...keys].sort();
  const weights: Record<string, number> = {};
  for (const k of feature_names) weights[k] = 0;
  let bias = 0;

  const normalize = (f: Record<string, number>): number[] =>
    feature_names.map((k) => {
      const x = f[k] ?? 0;
      if (k === 'vol_liq_ratio') return Math.min(x / 5, 1);
      if (k === 'log_txns_24h') return Math.min(x / 4, 1);
      if (k === 'log_liquidity') return Math.min(Math.max(x - 3, 0) / 5, 1);
      if (k === 'ret_5') return (x + 1) / 2;
      if (k === 'volume_trend_12') return (Math.max(-1, Math.min(1, x)) + 1) / 2;
      if (k === 'volatility_12') return Math.min(x / 0.5, 1);
      if (k === 'open_positions') return Math.min(x / 5, 1);
      return Math.max(0, Math.min(1, x));
    });

  for (let e = 0; e < epochs; e++) {
    for (const row of rows) {
      const xs = normalize(row.features);
      let z = bias;
      for (let i = 0; i < feature_names.length; i++) z += (weights[feature_names[i]!] ?? 0) * xs[i]!;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - row.label;
      bias -= lr * err;
      for (let i = 0; i < feature_names.length; i++) {
        const k = feature_names[i]!;
        weights[k] = (weights[k] ?? 0) - lr * err * xs[i]!;
      }
    }
  }

  let loss = 0;
  for (const row of rows) {
    const xs = normalize(row.features);
    let z = bias;
    for (let i = 0; i < feature_names.length; i++) z += (weights[feature_names[i]!] ?? 0) * xs[i]!;
    const p = Math.min(1 - 1e-7, Math.max(1e-7, 1 / (1 + Math.exp(-z))));
    loss += -(row.label * Math.log(p) + (1 - row.label) * Math.log(1 - p));
  }
  loss /= Math.max(rows.length, 1);

  return { weights, bias, logloss: loss };
}

export async function trainAndSaveArtifact(opts?: {
  limit?: number;
  activate?: boolean;
}): Promise<TrainedArtifact | null> {
  const rows = await exportTrainingRows(opts?.limit ?? 500);
  if (rows.length < 10) {
    log.warn({ n: rows.length }, 'not enough samples to train — need ≥10 closed positions or signals');
    return null;
  }

  const { weights, bias, logloss } = fitLogisticWeights(rows);
  const wins = rows.filter((r) => r.label === 1).length;
  const version = `fit-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const artifact: TrainedArtifact = {
    backend: 'baseline',
    version,
    weights,
    bias,
    feature_names: Object.keys(weights).sort(),
    metrics: { samples: rows.length, winRate: wins / rows.length, logloss },
    created_at: new Date().toISOString(),
  };

  const dir = resolve(process.cwd(), 'models');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `engine-${version}.json`);
  writeFileSync(path, JSON.stringify(artifact, null, 2), 'utf8');
  log.info({ path, samples: rows.length, logloss }, 'wrote engine artifact');

  try {
    if (opts?.activate) {
      await query(`UPDATE engine_models SET active = FALSE WHERE agent = 'meme'`);
    }
    await query(
      `INSERT INTO engine_models (backend, version, agent, metrics, artifact_path, active)
       VALUES ('baseline', $1, 'meme', $2::jsonb, $3, $4)
       ON CONFLICT (backend, version, agent) DO UPDATE
         SET metrics = EXCLUDED.metrics, artifact_path = EXCLUDED.artifact_path, active = EXCLUDED.active`,
      [
        version,
        JSON.stringify(artifact.metrics),
        path,
        opts?.activate === true,
      ],
    );
  } catch (err) {
    log.warn({ err }, 'engine_models registry update failed');
  }

  return artifact;
}

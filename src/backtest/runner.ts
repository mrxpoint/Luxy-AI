/**
 * Interactive backtest runner (BLUEPRINT.md §10.4) — read-only research.
 */
import { query } from '../db/pool.js';
import { fetchHistorical } from '../market/historical.js';
import { runMomentumBacktest } from '../e2b/backtest.js';
import { logger } from '../utils/logger.js';
import type { BacktestJobRequest, BacktestJobResult } from './types.js';
import type { BacktestResult } from '../types/index.js';

const log = logger.child({ module: 'backtest-runner' });

export async function runBacktestJob(
  jobId: string,
  req: BacktestJobRequest,
): Promise<BacktestJobResult> {
  const createdAt = new Date().toISOString();
  try {
    if (req.venue === 'replay_signals') {
      const metrics = await replaySignalsMetrics(req);
      await persistRun(jobId, req, metrics, 'replay');
      return {
        jobId,
        status: 'done',
        metrics,
        source: 'replay_signals',
        createdAt,
        finishedAt: new Date().toISOString(),
      };
    }

    const fromMs = req.from ? Date.parse(req.from) : undefined;
    const toMs = req.to ? Date.parse(req.to) : undefined;
    const hist = await fetchHistorical({
      venue: req.venue === 'polymarket' ? 'polymarket' : req.venue === 'birdeye' ? 'birdeye' : 'hyperliquid',
      symbolOrMarket: req.symbolOrMarket,
      interval: req.interval ?? '1h',
      days: req.days ?? 30,
      fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
      toMs: Number.isFinite(toMs) ? toMs : undefined,
      resolvedOnly: req.resolvedOnly,
    });

    if (hist.series.length < 24) {
      const err =
        hist.note ??
        `insufficient candles (${hist.series.length}) for ${req.venue}/${req.symbolOrMarket}`;
      return {
        jobId,
        status: 'failed',
        error: err,
        source: hist.source,
        createdAt,
        finishedAt: new Date().toISOString(),
      };
    }

    const metrics = runMomentumBacktest(hist.series);
    await persistRun(jobId, req, metrics, hist.source);
    return {
      jobId,
      status: 'done',
      metrics,
      chartPoints: hist.series.length,
      source: hist.source,
      createdAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.error({ err, jobId }, 'backtest job failed');
    return {
      jobId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      createdAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

async function replaySignalsMetrics(req: BacktestJobRequest): Promise<BacktestResult> {
  const days = req.days ?? 30;
  const res = await query<{ score: number; llm_verdict: string | null }>(
    `SELECT score, llm_verdict FROM signals
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     ORDER BY created_at ASC
     LIMIT 5000`,
    [String(days)],
  );
  const rows = res.rows;
  if (rows.length === 0) {
    return { win_rate: 0, avg_return: 0, sharpe: 0, max_drawdown: 0, n_trades: 0 };
  }
  // Proxy: treat strong/moderate high-score as "wins" for research dashboard only
  let wins = 0;
  const rets: number[] = [];
  for (const r of rows) {
    const good =
      r.llm_verdict === 'strong' || (r.llm_verdict === 'moderate' && Number(r.score) >= 0.6);
    if (good) wins++;
    rets.push(good ? 0.02 : -0.01);
  }
  const n = rets.length;
  const avg = rets.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - avg) ** 2, 0) / n) || 1e-9;
  return {
    win_rate: wins / n,
    avg_return: avg,
    sharpe: (avg / std) * Math.sqrt(252),
    max_drawdown: -0.05,
    n_trades: n,
  };
}

async function persistRun(
  jobId: string,
  req: BacktestJobRequest,
  metrics: BacktestResult,
  source: string,
): Promise<void> {
  try {
    await query(
      `INSERT INTO backtest_runs (signal_id, engine, params, result)
       VALUES (NULL, $1, $2::jsonb, $3::jsonb)`,
      [
        req.engine ?? 'local-ts',
        JSON.stringify({
          jobId,
          venue: req.venue,
          symbol: req.symbolOrMarket,
          interval: req.interval ?? '1h',
          days: req.days,
          from: req.from,
          to: req.to,
          source: req.source,
          userRef: req.userRef,
          dataSource: source,
        }),
        JSON.stringify(metrics),
      ],
    );
  } catch (err) {
    log.warn({ err }, 'persist backtest_runs failed');
  }
}

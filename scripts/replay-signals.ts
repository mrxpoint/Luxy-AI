/**
 * Backtest replay engine (BLUEPRINT.md §14 Phase 4).
 *
 * Replays historical signals from the `signals` table through the momentum
 * backtest engine and stores every run in `backtest_runs` (engine='replay'),
 * producing the aggregate report that powers the strategy evaluation
 * dashboard and the Phase 4 fine-tuning dataset.
 *
 * Candle sources, in order: raw_data snapshot → candles table (Timescale)
 * → Birdeye OHLCV (when keyed). Signals without candles are skipped.
 *
 * Usage:
 *   pnpm replay [--hours=168] [--limit=200] [--agent=meme]
 */
import { config } from '../src/config/index.js';
import { pool, query } from '../src/db/pool.js';
import { runMomentumBacktest } from '../src/e2b/backtest.js';
import { fetchOhlcv } from '../src/screener/birdeye.js';
import { readCandles } from '../src/market/candles.js';
import { logger } from '../src/utils/logger.js';
import type { Candle } from '../src/types/index.js';

const log = logger.child({ module: 'replay' });

interface ReplayArgs {
  hours: number;
  limit: number;
  agent: string | null;
}

function parseArgs(): ReplayArgs {
  const args: ReplayArgs = { hours: 168, limit: 200, agent: null };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'hours') args.hours = Number(value ?? 168);
    if (key === 'limit') args.limit = Number(value ?? 200);
    if (key === 'agent') args.agent = value ?? null;
  }
  return args;
}

interface ReplayRow {
  id: number;
  agent: string;
  chain: string;
  token: string | null;
  symbol: string | null;
  score: string;
  raw_data: Record<string, unknown>;
}

function candlesFromRaw(raw: Record<string, unknown>): Candle[] {
  const rawCandles = (raw as { candles?: unknown }).candles;
  if (!Array.isArray(rawCandles)) return [];
  return rawCandles
    .map((c) => {
      const item = c as Record<string, unknown>;
      return {
        t: Number(item.t ?? 0),
        o: Number(item.o ?? 0),
        h: Number(item.h ?? 0),
        l: Number(item.l ?? 0),
        c: Number(item.c ?? 0),
        v: Number(item.v ?? 0),
      };
    })
    .filter((c) => c.t > 0 && c.c > 0);
}

async function candlesFor(row: ReplayRow): Promise<Candle[]> {
  // 1. Snapshot persisted with the signal.
  let candles = candlesFromRaw(row.raw_data);
  if (candles.length >= 24 || !row.token) return candles;

  // 2. Timescale candle store.
  candles = await readCandles({ chain: row.chain, token: row.token }, 72);
  if (candles.length >= 24) return candles;

  // 3. Birdeye direct (when keyed).
  if (row.chain === 'solana' && config.BIRDEYE_API_KEY) {
    try {
      candles = await fetchOhlcv(row.token, 24);
    } catch {
      candles = [];
    }
  }
  return candles;
}

async function main(): Promise<void> {
  const args = parseArgs();
  log.info({ ...args }, 'replay starting');

  const params: unknown[] = [args.hours, args.limit];
  let filter = '';
  if (args.agent) {
    filter = ' AND agent = $3';
    params.push(args.agent);
  }
  const res = await query<ReplayRow>(
    `SELECT id, agent, chain, token, symbol, score, raw_data
     FROM signals
     WHERE created_at >= NOW() - ($1 || ' hours')::interval${filter}
     ORDER BY created_at DESC LIMIT $2`,
    params,
  );
  log.info({ signals: res.rows.length }, 'signals to replay');

  let replayed = 0;
  let skipped = 0;
  const byAgent: Record<string, { runs: number; winSum: number; sharpeSum: number; trades: number }> = {};

  for (const row of res.rows) {
    const candles = await candlesFor(row);
    if (candles.length < 24) {
      skipped++;
      continue;
    }
    const result = runMomentumBacktest(candles);
    await query(
      `INSERT INTO backtest_runs (signal_id, engine, params, result)
       VALUES ($1, 'replay', $2, $3)`,
      [
        row.id,
        JSON.stringify({
          strategy: 'momentum',
          sma: 12,
          mom: 6,
          thr: 0.03,
          agent: row.agent,
          strategy_version: 1,
          source: 'replay',
        }),
        JSON.stringify(result),
      ],
    );
    const agg = (byAgent[row.agent] ??= { runs: 0, winSum: 0, sharpeSum: 0, trades: 0 });
    agg.runs++;
    agg.winSum += result.win_rate;
    agg.sharpeSum += result.sharpe;
    agg.trades += result.n_trades;
    replayed++;
  }

  // ---- Report ----
  console.log('\n=== LUXY REPLAY REPORT ===');
  console.log(`signals considered: ${res.rows.length}, replayed: ${replayed}, skipped (no candles): ${skipped}`);
  for (const [agent, agg] of Object.entries(byAgent)) {
    const winRate = agg.runs > 0 ? agg.winSum / agg.runs : 0;
    const sharpe = agg.runs > 0 ? agg.sharpeSum / agg.runs : 0;
    console.log(
      `  ${agent.padEnd(12)} runs=${agg.runs}  avg_win_rate=${(winRate * 100).toFixed(1)}%  avg_sharpe=${sharpe.toFixed(2)}  trades=${agg.trades}`,
    );
  }
  console.log('results stored in backtest_runs (engine=replay) → visible on /evaluation\n');

  await pool.end();
}

main().catch((err) => {
  log.fatal({ err }, 'replay failed');
  process.exit(1);
});

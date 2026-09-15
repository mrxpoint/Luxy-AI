import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

const globalForPg = globalThis as unknown as { luxyPool?: Pool };

function pool(): Pool {
  if (!globalForPg.luxyPool) {
    globalForPg.luxyPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://luxy:luxy_dev_password@localhost:5432/luxydb',
      max: 5,
      connectionTimeoutMillis: 3_000,
    });
  }
  return globalForPg.luxyPool;
}

/** List recent interactive / agent backtest runs. */
export async function GET() {
  try {
    const res = await pool().query(
      `SELECT id, engine, params, result, created_at
       FROM backtest_runs
       ORDER BY created_at DESC
       LIMIT 40`,
    );
    return NextResponse.json({ offline: false, rows: res.rows });
  } catch {
    return NextResponse.json({ offline: true, rows: [] });
  }
}

/**
 * POST { venue, symbol, interval?, days?, from?, to? }
 * Runs a local momentum backtest when Redis/worker unavailable is OK —
 * the web layer persists via SQL by calling historical+metrics if we only
 * have DB access. Full enqueue needs the backend API; here we compute
 * inline using stored candles when possible.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      venue?: string;
      symbol?: string;
      interval?: string;
      days?: number;
    };
    const venue = body.venue ?? 'hyperliquid';
    const symbol = (body.symbol ?? 'BTC').toUpperCase();
    const interval = body.interval ?? '1h';
    const days = body.days ?? 30;

    // Read candles from DB (filled by ingest / historical fetch)
    const hours = days * 24;
    const candles = await pool().query(
      `SELECT EXTRACT(EPOCH FROM ts) * 1000 AS t, o, h, l, c, v
       FROM candles
       WHERE chain = $1 AND token = $2 AND timeframe = $3
         AND ts >= NOW() - ($4 || ' hours')::interval
       ORDER BY ts ASC`,
      [venue === 'hyperliquid' ? 'hyperliquid' : venue, symbol, interval, String(hours)],
    );

    if (candles.rowCount === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'No candles in DB for this range. Run candle-ingest or: pnpm luxy candles / Telegram /candles first.',
        },
        { status: 400 },
      );
    }

    const series = candles.rows.map((r: { t: number; o: number; h: number; l: number; c: number; v: number }) => ({
      t: Number(r.t),
      o: Number(r.o),
      h: Number(r.h),
      l: Number(r.l),
      c: Number(r.c),
      v: Number(r.v),
    }));

    // Inline momentum metrics (mirror src/e2b/backtest.ts logic, simplified)
    const metrics = simpleMomentum(series);
    const params = {
      jobId: `web_${Date.now()}`,
      venue,
      symbol,
      interval,
      days,
      source: 'web',
    };
    await pool().query(
      `INSERT INTO backtest_runs (signal_id, engine, params, result)
       VALUES (NULL, 'local-ts', $1::jsonb, $2::jsonb)`,
      [JSON.stringify(params), JSON.stringify(metrics)],
    );

    return NextResponse.json({
      ok: true,
      metrics,
      chartPoints: series.length,
      params,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function simpleMomentum(
  candles: Array<{ c: number }>,
): { win_rate: number; avg_return: number; sharpe: number; max_drawdown: number; n_trades: number } {
  const closes = candles.map((c) => c.c);
  if (closes.length < 30) {
    return { win_rate: 0, avg_return: 0, sharpe: 0, max_drawdown: 0, n_trades: 0 };
  }
  const returns: number[] = [];
  const wFast = 5;
  const wSlow = 20;
  for (let i = wSlow; i < closes.length - 1; i++) {
    const fast = avg(closes.slice(i - wFast, i));
    const slow = avg(closes.slice(i - wSlow, i));
    if (fast > slow) {
      const r = (closes[i + 1]! - closes[i]!) / closes[i]!;
      returns.push(r);
    }
  }
  if (returns.length === 0) {
    return { win_rate: 0, avg_return: 0, sharpe: 0, max_drawdown: 0, n_trades: 0 };
  }
  const wins = returns.filter((r) => r > 0).length;
  const m = avg(returns);
  const s = Math.sqrt(avg(returns.map((r) => (r - m) ** 2))) || 1e-9;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
  }
  return {
    win_rate: wins / returns.length,
    avg_return: m,
    sharpe: (m / s) * Math.sqrt(252),
    max_drawdown: maxDd,
    n_trades: returns.length,
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

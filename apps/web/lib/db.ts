/**
 * Server-side data access for the web UI.
 *
 * Queries Postgres directly (server components / route handlers only).
 * When the database is unreachable (dev without docker, static preview),
 * every call degrades gracefully and returns the demo dataset flagged
 * `offline: true` so the UI stays fully renderable.
 */
import { Pool } from 'pg';

const globalForPg = globalThis as unknown as { luxyPool?: Pool };

function pool(): Pool {
  if (!globalForPg.luxyPool) {
    globalForPg.luxyPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://luxy:luxy_dev_password@localhost:5432/luxydb',
      max: 5,
      connectionTimeoutMillis: 3_000,
    });
  }
  return globalForPg.luxyPool;
}

export interface SignalRow {
  id: number;
  source: string;
  agent: string;
  chain: string;
  symbol: string | null;
  score: number;
  llm_verdict: string | null;
  created_at: string;
}

export interface PositionRow {
  id: number;
  agent: string;
  chain: string;
  token: string | null;
  side: string | null;
  status: string;
  size_usd: number;
  entry_price: number | null;
  exit_price: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
  dry_run: boolean;
  opened_at: string;
  closed_at: string | null;
}

export interface StrategyRow {
  id: number;
  agent: string;
  version: number;
  params: Record<string, unknown>;
  created_by: string;
  active: boolean;
  created_at: string;
}

export interface DashboardData {
  offline: boolean;
  openPositions: number;
  closedPositions: number;
  todayPnlUsd: number;
  totalPnlUsd: number;
  signalCount24h: number;
  signals: SignalRow[];
  recentPositions: PositionRow[];
}

async function q<T>(text: string, params: unknown[] = []): Promise<T[] | null> {
  try {
    const res = await pool().query(text, params);
    return res.rows as T[];
  } catch {
    return null;
  }
}

export async function getDashboard(): Promise<DashboardData> {
  const signals = await q<SignalRow>(
    `SELECT id, source, agent, chain, symbol, score, llm_verdict, created_at
     FROM signals ORDER BY created_at DESC LIMIT 8`,
  );
  const positions = await q<PositionRow>(
    `SELECT id, agent, chain, token, side, status, size_usd, entry_price, exit_price,
            pnl_usd, pnl_pct, dry_run, opened_at, closed_at
     FROM positions ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT 8`,
  );
  const counts = await q<{
    open: number;
    closed: number;
    today_pnl: number;
    total_pnl: number;
    sig24: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status='open')::int AS open,
       COUNT(*) FILTER (WHERE status='closed')::int AS closed,
       COALESCE(SUM(pnl_usd) FILTER (WHERE status='closed' AND closed_at >= date_trunc('day', NOW())), 0)::float AS today_pnl,
       COALESCE(SUM(pnl_usd) FILTER (WHERE status='closed'), 0)::float AS total_pnl,
       (SELECT COUNT(*)::int FROM signals WHERE created_at >= NOW() - interval '24 hours') AS sig24
     FROM positions`,
  );

  if (!signals || !positions || !counts) return { ...demoDashboard(), offline: true };

  const c = counts[0]!;
  return {
    offline: false,
    openPositions: c.open,
    closedPositions: c.closed,
    todayPnlUsd: c.today_pnl,
    totalPnlUsd: c.total_pnl,
    signalCount24h: c.sig24,
    signals,
    recentPositions: positions,
  };
}

export async function getSignals(limit = 50, offset = 0): Promise<{ offline: boolean; rows: SignalRow[] }> {
  const rows = await q<SignalRow>(
    `SELECT id, source, agent, chain, symbol, score, llm_verdict, created_at
     FROM signals ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  if (!rows) return { offline: true, rows: demoSignals(limit) };
  return { offline: false, rows };
}

export async function getPositions(limit = 50): Promise<{ offline: boolean; rows: PositionRow[] }> {
  const rows = await q<PositionRow>(
    `SELECT id, agent, chain, token, side, status, size_usd, entry_price, exit_price,
            pnl_usd, pnl_pct, dry_run, opened_at, closed_at
     FROM positions ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT $1`,
    [limit],
  );
  if (!rows) return { offline: true, rows: demoPositions() };
  return { offline: false, rows };
}

export async function getStrategy(): Promise<{ offline: boolean; rows: StrategyRow[] }> {
  const rows = await q<StrategyRow>(
    `SELECT id, agent, version, params, created_by, active, created_at
     FROM strategy_config ORDER BY agent, version DESC`,
  );
  if (!rows || rows.length === 0) return { offline: true, rows: demoStrategy() };
  return { offline: false, rows };
}

// ---------------------------------------------------------------------------
// Demo datasets (used only when the DB is unreachable)
// ---------------------------------------------------------------------------

function iso(minAgo: number): string {
  return new Date(Date.now() - minAgo * 60_000).toISOString();
}

function demoSignals(n: number): SignalRow[] {
  const base = [
    { symbol: 'WIF', source: 'screener', agent: 'meme', chain: 'solana', score: 0.82, verdict: 'strong' },
    { symbol: 'BONK', source: 'screener', agent: 'meme', chain: 'solana', score: 0.71, verdict: 'moderate' },
    { symbol: 'WIF', source: 'narrative', agent: 'narrative', chain: 'solana', score: 0.79, verdict: 'strong' },
    { symbol: 'POPCAT', source: 'screener', agent: 'meme', chain: 'solana', score: 0.63, verdict: 'moderate' },
    { symbol: 'SOL', source: 'perps', agent: 'perps', chain: 'hyperliquid', score: 0.74, verdict: null },
    { symbol: 'SOL/USDC', source: 'lp', agent: 'lp', chain: 'solana', score: 0.58, verdict: null },
    { symbol: 'MEW', source: 'screener', agent: 'meme', chain: 'solana', score: 0.52, verdict: 'weak' },
  ] as const;
  return base.slice(0, Math.max(3, Math.min(n, base.length))).map((b, i) => ({
    id: 1000 + i,
    source: b.source,
    agent: b.agent,
    chain: b.chain,
    symbol: b.symbol,
    score: b.score,
    llm_verdict: b.verdict,
    created_at: iso((i + 1) * 7),
  }));
}

function demoPositions(): PositionRow[] {
  return [
    {
      id: 1,
      agent: 'meme',
      chain: 'solana',
      token: 'EKpQ…zcjm',
      side: null,
      status: 'closed',
      size_usd: 75,
      entry_price: 2.34,
      exit_price: 2.73,
      pnl_usd: 12.4,
      pnl_pct: 0.166,
      dry_run: true,
      opened_at: iso(240),
      closed_at: iso(180),
    },
    {
      id: 2,
      agent: 'perps',
      chain: 'hyperliquid',
      token: 'BTC',
      side: 'long',
      status: 'open',
      size_usd: 200,
      entry_price: 65420,
      exit_price: null,
      pnl_usd: null,
      pnl_pct: null,
      dry_run: true,
      opened_at: iso(95),
      closed_at: null,
    },
    {
      id: 3,
      agent: 'lp',
      chain: 'solana',
      token: 'SOL/USDC · bin 3420-3480',
      side: null,
      status: 'open',
      size_usd: 150,
      entry_price: null,
      exit_price: null,
      pnl_usd: null,
      pnl_pct: null,
      dry_run: true,
      opened_at: iso(60),
      closed_at: null,
    },
  ];
}

function demoStrategy(): StrategyRow[] {
  return [
    {
      id: 1,
      agent: 'meme',
      version: 1,
      params: { scoringThreshold: 0.45, maxPositions: 5, llmFilter: true },
      created_by: 'user',
      active: true,
      created_at: iso(600),
    },
    {
      id: 2,
      agent: 'perps',
      version: 1,
      params: { markets: ['BTC', 'ETH', 'SOL'], maxTradeUsd: 200, exitLossPct: -0.08, exitProfitPct: 0.15 },
      created_by: 'user',
      active: true,
      created_at: iso(590),
    },
    {
      id: 3,
      agent: 'lp',
      version: 1,
      params: { stopLossPct: -0.15, takeProfitPct: 0.2, outOfRangeMin: 30, minFeeTvl: 0.05 },
      created_by: 'user',
      active: true,
      created_at: iso(580),
    },
  ];
}

function demoDashboard(): DashboardData {
  const signals = demoSignals(8);
  const positions = demoPositions();
  return {
    offline: true,
    openPositions: 2,
    closedPositions: 1,
    todayPnlUsd: 12.4,
    totalPnlUsd: 12.4,
    signalCount24h: 7,
    signals,
    recentPositions: positions,
  };
}

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
        process.env.DATABASE_URL ?? 'postgresql://luxy:luxy_dev_password@localhost:5432/luxydb',
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
  status: string;
  rationale: string | null;
  created_at: string;
}

export interface EvaluationRow {
  agent: string;
  version: number;
  runs: number;
  avg_win_rate: number;
  avg_sharpe: number;
  avg_max_drawdown: number;
  total_trades: number;
  last_run: string;
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

export async function getSignals(
  limit = 50,
  offset = 0,
): Promise<{ offline: boolean; rows: SignalRow[] }> {
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
    `SELECT id, agent, version, params, created_by, active, status, rationale, created_at
     FROM strategy_config ORDER BY agent, version DESC`,
  );
  if (!rows || rows.length === 0) return { offline: true, rows: demoStrategy() };
  return { offline: false, rows };
}

export interface ProposalRow extends StrategyRow {}

export async function getProposals(): Promise<{ offline: boolean; rows: ProposalRow[] }> {
  const rows = await q<StrategyRow>(
    `SELECT id, agent, version, params, created_by, active, status, rationale, created_at
     FROM strategy_config WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20`,
  );
  if (!rows) return { offline: true, rows: [] };
  return { offline: false, rows };
}

export async function decideProposal(
  id: number,
  decision: 'approve' | 'reject',
): Promise<{ ok: boolean; message: string }> {
  const rows = await q<{ agent: string; version: number; status: string }>(
    `SELECT agent, version, status FROM strategy_config WHERE id = $1`,
    [id],
  );
  const row = rows?.[0];
  if (!row) return { ok: false, message: `proposal #${id} not found` };
  if (row.status !== 'pending') return { ok: false, message: `proposal #${id} is not pending` };

  if (decision === 'approve') {
    await q(`UPDATE strategy_config SET active = FALSE WHERE agent = $1 AND active = TRUE`, [
      row.agent,
    ]);
    await q(`UPDATE strategy_config SET active = TRUE, status = 'approved' WHERE id = $1`, [id]);
    await q(
      `INSERT INTO audit_log (actor, action, payload) VALUES ('user', 'strategy_approved', $1)`,
      [JSON.stringify({ id, agent: row.agent, version: row.version, via: 'web' })],
    );
    return { ok: true, message: `approved ${row.agent} v${row.version}` };
  }
  await q(`UPDATE strategy_config SET status = 'rejected', active = FALSE WHERE id = $1`, [id]);
  await q(
    `INSERT INTO audit_log (actor, action, payload) VALUES ('user', 'strategy_rejected', $1)`,
    [JSON.stringify({ id, agent: row.agent, version: row.version, via: 'web' })],
  );
  return { ok: true, message: `rejected ${row.agent} v${row.version}` };
}

export async function getEvaluation(): Promise<{ offline: boolean; rows: EvaluationRow[] }> {
  const rows = await q<EvaluationRow>(
    `SELECT sc.agent,
            sc.version,
            COUNT(br.id)::int AS runs,
            COALESCE(AVG((br.result->>'win_rate')::float), 0)::float AS avg_win_rate,
            COALESCE(AVG((br.result->>'sharpe')::float), 0)::float AS avg_sharpe,
            COALESCE(AVG((br.result->>'max_drawdown')::float), 0)::float AS avg_max_drawdown,
            COALESCE(SUM((br.result->>'n_trades')::int), 0)::int AS total_trades,
            COALESCE(MAX(br.created_at), sc.created_at) AS last_run
     FROM strategy_config sc
     LEFT JOIN backtest_runs br
       ON br.params->>'agent' = sc.agent AND br.params->>'strategy_version' = sc.version::text
     GROUP BY sc.agent, sc.version, sc.created_at
     ORDER BY sc.agent, sc.version DESC`,
  );
  if (!rows || rows.length === 0) return { offline: true, rows: demoEvaluation() };
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
    {
      symbol: 'WIF',
      source: 'screener',
      agent: 'meme',
      chain: 'solana',
      score: 0.82,
      verdict: 'strong',
    },
    {
      symbol: 'BONK',
      source: 'screener',
      agent: 'meme',
      chain: 'solana',
      score: 0.71,
      verdict: 'moderate',
    },
    {
      symbol: 'WIF',
      source: 'narrative',
      agent: 'narrative',
      chain: 'solana',
      score: 0.79,
      verdict: 'strong',
    },
    {
      symbol: 'POPCAT',
      source: 'screener',
      agent: 'meme',
      chain: 'solana',
      score: 0.63,
      verdict: 'moderate',
    },
    {
      symbol: 'SOL',
      source: 'perps',
      agent: 'perps',
      chain: 'hyperliquid',
      score: 0.74,
      verdict: null,
    },
    { symbol: 'SOL/USDC', source: 'lp', agent: 'lp', chain: 'solana', score: 0.58, verdict: null },
    {
      symbol: 'MEW',
      source: 'screener',
      agent: 'meme',
      chain: 'solana',
      score: 0.52,
      verdict: 'weak',
    },
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
      status: 'approved',
      rationale: null,
      created_at: iso(600),
    },
    {
      id: 2,
      agent: 'perps',
      version: 1,
      params: {
        markets: ['BTC', 'ETH', 'SOL'],
        maxTradeUsd: 200,
        exitLossPct: -0.08,
        exitProfitPct: 0.15,
      },
      created_by: 'user',
      active: true,
      status: 'approved',
      rationale: null,
      created_at: iso(590),
    },
    {
      id: 3,
      agent: 'lp',
      version: 1,
      params: { stopLossPct: -0.15, takeProfitPct: 0.2, outOfRangeMin: 30, minFeeTvl: 0.05 },
      created_by: 'user',
      active: true,
      status: 'approved',
      rationale: null,
      created_at: iso(580),
    },
  ];
}

function demoEvaluation(): EvaluationRow[] {
  return [
    {
      agent: 'meme',
      version: 1,
      runs: 12,
      avg_win_rate: 0.62,
      avg_sharpe: 1.4,
      avg_max_drawdown: -0.09,
      total_trades: 118,
      last_run: iso(35),
    },
    {
      agent: 'perps',
      version: 1,
      runs: 9,
      avg_win_rate: 0.57,
      avg_sharpe: 1.1,
      avg_max_drawdown: -0.12,
      total_trades: 86,
      last_run: iso(80),
    },
    {
      agent: 'lp',
      version: 1,
      runs: 5,
      avg_win_rate: 0.66,
      avg_sharpe: 1.7,
      avg_max_drawdown: -0.05,
      total_trades: 41,
      last_run: iso(120),
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

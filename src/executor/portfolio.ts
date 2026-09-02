/**
 * Portfolio state reader for risk checks.
 * In dry-run mode the portfolio is the paper balance minus open exposure.
 */
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import type { PortfolioState } from '../types/index.js';

export async function getPortfolioState(): Promise<PortfolioState> {
  const openRes = await query<{ n: number; open_usd: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(size_usd), 0)::float AS open_usd
     FROM positions WHERE status = 'open'`,
  );
  const openPositions = openRes.rows[0]?.n ?? 0;
  const openUsd = openRes.rows[0]?.open_usd ?? 0;

  const pnlRes = await query<{ pnl: number }>(
    `SELECT COALESCE(SUM(pnl_usd), 0)::float AS pnl
     FROM positions
     WHERE status = 'closed' AND closed_at >= date_trunc('day', NOW())`,
  );
  const todayRealizedPnlUsd = pnlRes.rows[0]?.pnl ?? 0;

  const portfolioUsd = config.PAPER_PORTFOLIO_USD + todayRealizedPnlUsd - openUsd;
  const startOfDayValue = config.PAPER_PORTFOLIO_USD;
  const dailyDrawdownPct =
    startOfDayValue > 0 ? Math.max(0, -todayRealizedPnlUsd / startOfDayValue) : 0;

  return { portfolioUsd, openPositions, todayRealizedPnlUsd, dailyDrawdownPct };
}
